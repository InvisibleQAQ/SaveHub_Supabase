# Feed 刷新任务

## 概述

Feed 刷新是 SaveHub 的核心功能，负责定时抓取 RSS 订阅源的新文章。

**文件位置**: `backend/app/celery_app/feed_refresh.py`

## 任务列表

| 任务名 | 行号 | 触发方式 | 功能 |
|--------|------|----------|------|
| `refresh_feed` | 237-361 | API/定时 | 刷新单个 Feed |
| `refresh_feed_batch` | 批量模式 | Chord | 批量刷新（跳过图像调度） |
| `scan_due_feeds` | Beat | 每分钟 | 扫描待刷新的 Feed |
| `schedule_user_batch_refresh` | 内部 | scan_due_feeds | 为用户创建 Chord |
| `on_user_feeds_complete` | 回调 | Chord | 批量完成后触发图像处理 |

## 两种刷新模式

### 模式 1: 单个 Feed 刷新

当用户手动刷新或添加新 Feed 时触发：

```
POST /feeds 或 POST /schedule-feed
    ↓
refresh_feed(feed_id, feed_url, user_id)
    ├─ 1. 获取任务锁
    ├─ 2. 域名速率限制
    ├─ 3. 解析 RSS
    ├─ 4. 保存文章到数据库
    ├─ 5. 调度图像处理 (schedule_image_processing)
    ├─ 6. 更新 Feed 状态
    └─ 7. 调度下次刷新
```

### 模式 2: 批量刷新（Beat 定时）

Celery Beat 每分钟触发，批量处理所有待刷新的 Feed：

```
Celery Beat (每分钟)
    ↓
scan_due_feeds()
    ├─ 查询: last_fetched + refresh_interval < now
    ├─ 按 user_id 分组
    └─ 为每个用户调度 schedule_user_batch_refresh
        ↓
    schedule_user_batch_refresh(user_id, feeds)
        ├─ 创建 Chord
        ├─ Header: [refresh_feed_batch x N]
        └─ Callback: on_user_feeds_complete
            ↓
        on_user_feeds_complete(user_id, article_ids_list)
            └─ 调度批量图像处理
```

**关键区别**: 批量模式使用 `batch_mode=True`，跳过单个 Feed 的图像调度，由批量编排器统一处理。

## refresh_feed 任务详解

**位置**: `feed_refresh.py:237-361`

```python
@app.task(
    bind=True,
    name="refresh_feed",
    max_retries=3,              # 最多重试 3 次
    default_retry_delay=2,      # 初始重试延迟 2 秒
    retry_backoff=True,         # 指数退避
    retry_backoff_max=60,       # 最大退避 60 秒
    retry_jitter=True,          # 随机抖动
    time_limit=120,             # 硬超时 2 分钟
    soft_time_limit=90,         # 软超时 1.5 分钟
)
def refresh_feed(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int,
    priority: str = "normal",
    skip_lock: bool = False,
):
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `feed_id` | str | Feed UUID |
| `feed_url` | str | RSS 订阅源 URL |
| `feed_title` | str | Feed 显示名称 |
| `user_id` | str | 用户 UUID |
| `refresh_interval` | int | 刷新间隔（分钟） |
| `priority` | str | 优先级: manual/new_feed/normal |
| `skip_lock` | bool | 重试时跳过锁检查 |

### 返回值

```python
# 成功
{"success": True, "feed_id": "...", "article_count": 5, "duration_ms": 1234}

# 失败
{"success": False, "feed_id": "...", "error": "...", "duration_ms": 1234}

# Feed 已删除
{"success": True, "feed_id": "...", "skipped": True, "reason": "feed_deleted"}
```

## 核心业务逻辑

**位置**: `feed_refresh.py:51-210` (`do_refresh_feed` 函数)

```
do_refresh_feed(feed_id, feed_url, user_id, batch_mode)
    │
    ├─ 1. 域名速率限制 (rate_limiter.wait_for_domain)
    │      └─ 防止同一域名请求过快
    │
    ├─ 2. 解析 RSS (parse_rss_feed)
    │      └─ 返回文章列表
    │
    ├─ 3. 查询已存在的文章
    │      └─ 跳过已处理的文章 (images_processed=true)
    │
    ├─ 4. Upsert 文章到数据库
    │      └─ 使用 on_conflict="id" 防止 FK 冲突
    │
    └─ 5. 调度图像处理 (非 batch_mode)
           └─ schedule_image_processing.delay(article_ids, feed_id)
```

## 错误处理

| 错误类型 | 处理方式 | 示例 |
|----------|----------|------|
| `RetryableFeedError` | 触发重试 | 网络超时、503 错误 |
| `NonRetryableFeedError` | 不重试，返回失败 | RSS 解析错误、404 |
| `Exception` | 记录异常，抛出 | 未预期的错误 |

## 任务锁机制

防止同一 Feed 被重复刷新：

```python
lock_key = f"feed:{feed_id}"
lock_ttl = 180  # 3 分钟

if not acquire_task_lock(ctx, task_lock, lock_key, lock_ttl, skip_lock):
    raise Reject(f"Feed {feed_id} is locked", requeue=False)
```

> **注意**: 重试时使用 `skip_lock=True`，因为已经持有锁。

## 调用示例

### API 触发（高优先级）

```python
# 位置: routers/feeds.py:84-94
refresh_feed.apply_async(
    kwargs={
        "feed_id": feed_data["id"],
        "feed_url": feed_data["url"],
        "feed_title": feed_data["title"],
        "user_id": service.user_id,
        "refresh_interval": feed_data.get("refresh_interval", 60),
        "priority": "new_feed",
    },
    queue="high"  # 高优先级队列
)
```

### 定时触发（普通优先级）

```python
# 位置: feed_refresh.py:397-408
refresh_feed.apply_async(
    kwargs={
        "feed_id": feed_id,
        "feed_url": feed["url"],
        "feed_title": feed["title"],
        "user_id": user_id,
        "refresh_interval": feed["refresh_interval"],
        "priority": "normal"
    },
    countdown=delay_seconds,  # 延迟执行
    queue="default"
)
```

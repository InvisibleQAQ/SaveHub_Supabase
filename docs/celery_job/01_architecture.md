# Celery 架构概览

## 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 任务队列 | Celery 5.x | 异步任务处理 |
| 消息代理 | Redis | Broker + Backend |
| 序列化 | JSON | 任务参数和结果 |
| 时区 | UTC | 统一时间处理 |

## 配置文件

**位置**: `backend/app/celery_app/celery.py`

```python
# Redis 连接
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Celery 应用
app = Celery(
    "savehub",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.celery_app.tasks",
        "app.celery_app.image_processor",
        "app.celery_app.rag_processor",
        "app.celery_app.repository_tasks",
        "app.celery_app.repo_extractor",
    ]
)
```

## 队列配置

系统使用两个队列模拟优先级：

| 队列 | 用途 | 场景 |
|------|------|------|
| `high` | 高优先级 | 手动刷新、新 Feed 添加 |
| `default` | 普通优先级 | 定时刷新、后台处理 |

```python
task_queues={
    "high": {},      # 高优先级队列
    "default": {},   # 普通优先级队列
},
```

## Beat 定时任务

**位置**: `celery.py:99-115`

| 任务 | 调度 | 功能 |
|------|------|------|
| `scan_due_feeds` | 每分钟 | 扫描待刷新的 Feed |
| `scan_pending_image_articles` | 每30分钟 | 容错：处理遗漏的图像处理 |
| `scan_pending_rag_articles` | 每30分钟 | 容错：处理遗漏的 RAG 文章 |
| `scan_pending_repo_extraction` | 每30分钟 | 容错：处理遗漏的仓库提取 |

```python
beat_schedule={
    "scan-due-feeds-every-minute": {
        "task": "scan_due_feeds",
        "schedule": crontab(minute="*"),
    },
    "scan-image-every-30-minutes": {
        "task": "scan_pending_image_articles",
        "schedule": crontab(minute="*/30"),
    },
    "scan-rag-every-30-minutes": {
        "task": "scan_pending_rag_articles",
        "schedule": crontab(minute="*/30"),
    },
    "scan-repo-extraction-every-30-minutes": {
        "task": "scan_pending_repo_extraction",
        "schedule": crontab(minute="*/30"),
    },
},
```

## Worker 配置

```python
worker_prefetch_multiplier=1,   # 公平调度，每次只取一个任务
worker_concurrency=5,           # 并发 worker 数量
task_acks_late=True,            # 任务完成后才确认
task_reject_on_worker_lost=True,# Worker 丢失时拒绝任务
task_track_started=True,        # 跟踪 STARTED 状态
```

## Chord 配置

Chord 用于并行执行多个任务，然后触发回调：

```python
result_chord_join_timeout=300,  # Chord 等待超时 5 分钟
result_chord_retry_interval=1.0,# 重试间隔 1 秒
```

## 任务模块注册

新任务模块需要在 `include` 列表中注册：

```python
include=[
    "app.celery_app.tasks",           # Feed 刷新
    "app.celery_app.image_processor", # 图像处理
    "app.celery_app.rag_processor",   # RAG 处理
    "app.celery_app.repository_tasks",# 仓库同步
    "app.celery_app.repo_extractor",  # 仓库提取
]
```

## 任务路由

每个任务可以指定默认队列：

```python
task_routes={
    "refresh_feed": {"queue": "default"},
    "process_article_images": {"queue": "default"},
    # ... 更多任务路由
}
```

> **注意**: 调用时可以通过 `queue` 参数覆盖默认队列

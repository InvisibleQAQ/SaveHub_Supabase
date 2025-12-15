# 新订阅 Feed 的数据流全解析

> 当你新订阅一个 RSS Feed 时，数据是怎么从浏览器流动到 Redis 队列，再被 Celery 处理的？

---

## 一句话总结

**用户点击"订阅" → 前端调用后端 API → FastAPI 创建 Celery 任务 → 任务丢进 Redis 队列 → Worker 取出执行 → 自动安排下次刷新**

---

## 场景设定

假设你刚刚订阅了一个新的 RSS Feed：

| 参数 | 值 |
|------|-----|
| Feed ID | `111` |
| 订阅地址 | `https://example.com/rss.xml` |
| 刷新间隔 | `30 分钟` |
| 用户 ID | `user-abc-123` |

我们来看看这个订阅请求是如何流转的。

---

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户浏览器                                     │
│                                                                          │
│   [添加订阅对话框] ─────────────────────────────────────────────────────┐ │
│         │                                                               │ │
│         │ 1. 点击"Add Feed"                                            │ │
│         ▼                                                               │ │
│   ┌─────────────┐                                                       │ │
│   │ Zustand     │  2. addFeed() 保存到数据库                            │ │
│   │ Store       │  3. scheduleFeedRefresh() 触发刷新                    │ │
│   └──────┬──────┘                                                       │ │
│          │                                                               │ │
└──────────│───────────────────────────────────────────────────────────────┘
           │
           │ 4. POST /api/backend/queue/schedule-feed
           │    body: { feed_id: "111", force_immediate: false }
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FastAPI 后端                                     │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ queue.py: schedule_feed_refresh()                               │   │
│   │                                                                  │   │
│   │  5. 验证 JWT 认证                                                │   │
│   │  6. 从 Supabase 获取 Feed 详情（URL、刷新间隔等）                │   │
│   │  7. 检查 Redis 锁：这个 Feed 是否正在刷新？                      │   │
│   │  8. 计算延迟时间（新订阅通常为 0）                               │   │
│   │  9. 创建 Celery 任务                                            │   │
│   │                                                                  │   │
│   │     refresh_feed.apply_async(                                   │   │
│   │         kwargs={                                                │   │
│   │             "feed_id": "111",                                   │   │
│   │             "feed_url": "https://example.com/rss.xml",          │   │
│   │             "user_id": "user-abc-123",                          │   │
│   │             "refresh_interval": 30,                             │   │
│   │             ...                                                 │   │
│   │         },                                                      │   │
│   │         countdown=0,  # 立即执行                                 │   │
│   │         queue="default"                                         │   │
│   │     )                                                           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ 10. 任务序列化成 JSON，推入 Redis 队列
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            Redis                                         │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        任务队列                                  │   │
│   │                                                                  │   │
│   │   celery:default  ──────────────────────────────────────────    │   │
│   │   [任务1] [任务2] [Feed111的任务] [任务4] ...                    │   │
│   │                         ▲                                        │   │
│   │                         │                                        │   │
│   │                    新任务入队                                     │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                        任务锁                                    │   │
│   │                                                                  │   │
│   │   tasklock:feed:111 = "task-xyz-789"  (TTL: 180秒)             │   │
│   │   └── 防止同一个 Feed 被重复刷新                                 │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ 11. Worker 从队列取出任务
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Celery Worker                                     │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ tasks.py: refresh_feed()                                        │   │
│   │                                                                  │   │
│   │  12. 尝试获取任务锁（tasklock:feed:111）                         │   │
│   │      → 成功：继续执行                                            │   │
│   │      → 失败：任务被拒绝（说明另一个任务正在处理）                 │   │
│   │                                                                  │   │
│   │  13. 域名限流：等待对 example.com 的请求间隔 > 1秒               │   │
│   │                                                                  │   │
│   │  14. 请求 RSS 地址，解析 XML                                     │   │
│   │                                                                  │   │
│   │  15. 保存文章到 Supabase（去重：url + user_id）                  │   │
│   │                                                                  │   │
│   │  16. 更新 Feed 状态：last_fetched = now()                        │   │
│   │                                                                  │   │
│   │  17. 安排下次刷新：                                              │   │
│   │      refresh_feed.apply_async(                                  │   │
│   │          ...,                                                   │   │
│   │          countdown=1800,  # 30分钟 = 1800秒                     │   │
│   │          queue="default"                                        │   │
│   │      )                                                          │   │
│   │                                                                  │   │
│   │  18. 释放任务锁                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ 19. 30分钟后，新任务从队列弹出
                              │     → 重复步骤 12-18
                              │     → 无限循环...
                              ▼
                         ∞ 循环刷新
```

---

## 阶段详解

### 阶段 1：前端 - 用户点击"添加订阅"

**发生了什么**：用户在对话框填写 RSS 地址，选择刷新间隔，点击"Add Feed"。

**代码位置**：`frontend/components/add-feed-dialog.tsx:68-107`

```typescript
// 简化版流程
const handleSubmit = async () => {
  // 1. 解析 RSS 获取标题和文章
  const { feed: parsedFeed, articles } = await parseRSSFeed(feedUrl, feedId)

  // 2. 构建 Feed 对象
  const feed = {
    id: "111",                    // 生成的 UUID
    url: feedUrl,                 // RSS 地址
    title: parsedFeed.title,      // 从 RSS 解析的标题
    refreshInterval: 30,          // 用户选择的刷新间隔
    lastFetched: new Date(),      // 当前时间
    // ...
  }

  // 3. 调用 Zustand Store 的 addFeed
  await addFeed(feed)

  // 4. 添加文章到 Store
  await addArticles(articles)
}
```

### 阶段 2：Zustand Store 处理

**发生了什么**：Store 把 Feed 保存到 Supabase 数据库，然后触发第一次刷新调度。

**代码位置**：`frontend/lib/store/feeds.slice.ts:20-82`

```typescript
addFeed: async (feed) => {
  // 1. 检查是否已存在（本地去重）
  const existingFeed = state.feeds.find(f => f.url === feed.url)
  if (existingFeed) {
    return { success: false, reason: 'duplicate' }
  }

  // 2. 保存到数据库（HTTP API 调用后端）
  await feedsApi.saveFeeds([feed])

  // 3. 更新本地 Store
  set({ feeds: [...state.feeds, feed] })

  // 4. 【关键】触发第一次刷新调度
  //    fire-and-forget 模式：不等返回，直接继续
  scheduleFeedRefresh(feed.id).catch(err => {
    console.error("Failed to schedule:", err)
  })

  return { success: true }
}
```

**为什么用 fire-and-forget？**
- 用户体验：订阅成功后立即显示，不用等后台任务创建完成
- 刷新是"锦上添花"：即使调度失败，Feed 已经保存，用户可以手动刷新

### 阶段 3：前端发起 HTTP 请求

**发生了什么**：调用后端 API 来创建 Celery 任务。

**代码位置**：`frontend/lib/queue-client.ts:51-74`

```typescript
export async function scheduleFeedRefresh(
  feedId: string,
  forceImmediate = false
): Promise<ScheduleFeedResponse> {
  const response = await fetch("/api/backend/queue/schedule-feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",  // 发送 Cookie（JWT 认证）
    body: JSON.stringify({
      feed_id: feedId,           // "111"
      force_immediate: false,    // 按间隔调度，不是立即刷新
    }),
  })

  return response.json()
  // 返回: { task_id: "xxx", status: "queued", delay_seconds: 0 }
}
```

**两种调度模式**：
| 参数 | 含义 | 队列 | 使用场景 |
|------|------|------|----------|
| `force_immediate: true` | 立即执行 | `high` | 用户点击"刷新"按钮 |
| `force_immediate: false` | 按间隔调度 | `default` | 新订阅、自动刷新 |

### 阶段 4：FastAPI 创建 Celery 任务

**发生了什么**：后端验证请求，从数据库获取 Feed 信息，创建异步任务。

**代码位置**：`backend/app/api/routers/queue.py:34-122`

```python
@router.post("/schedule-feed")
async def schedule_feed_refresh(request_data, auth_response=Depends(verify_auth)):
    user_id = auth_response.user.id
    feed_id = str(request_data.feed_id)  # "111"

    # 1. 从 Supabase 获取 Feed 最新数据
    result = supabase.table("feeds").select("*").eq("id", feed_id).single().execute()
    feed = result.data
    # feed = {
    #   "id": "111",
    #   "url": "https://example.com/rss.xml",
    #   "title": "Example Blog",
    #   "refresh_interval": 30,
    #   "last_fetched": "2025-01-15T10:00:00Z",
    #   ...
    # }

    # 2. 检查 Redis 锁：是否正在刷新？
    task_lock = get_task_lock()
    if task_lock.is_locked(f"feed:{feed_id}"):
        # 已有任务在执行，返回"正在运行"
        return {"task_id": None, "status": "already_running", "delay_seconds": ...}

    # 3. 计算延迟时间
    #    对于新订阅的 Feed：last_fetched 是当前时间，所以 delay_seconds ≈ 0
    delay_seconds = 0
    if feed.get("last_fetched"):
        last_fetched = parse_datetime(feed["last_fetched"])
        next_refresh = last_fetched + timedelta(minutes=feed["refresh_interval"])
        delay_seconds = max(0, (next_refresh - now()).total_seconds())

    # 4. 创建 Celery 任务
    task = refresh_feed.apply_async(
        kwargs={
            "feed_id": "111",
            "feed_url": "https://example.com/rss.xml",
            "feed_title": "Example Blog",
            "user_id": "user-abc-123",
            "refresh_interval": 30,
            "priority": "normal"
        },
        countdown=delay_seconds,  # 新订阅通常为 0，立即执行
        queue="default"           # 普通优先级队列
    )

    return {
        "task_id": task.id,       # "a1b2c3d4-..."
        "status": "queued",
        "delay_seconds": delay_seconds
    }
```

**`apply_async` 做了什么？**
1. 把任务参数序列化成 JSON
2. 生成唯一的 task_id（UUID）
3. 推入 Redis 队列
4. 如果有 `countdown`，Redis 会在指定秒数后才让任务可见

### 阶段 5：任务进入 Redis 队列

**发生了什么**：Celery 把任务数据写入 Redis。

这一步是自动的，由 `apply_async()` 内部完成。详细的 Redis 数据结构见下一节。

### 阶段 6：Celery Worker 执行任务

**发生了什么**：Worker 进程从 Redis 取出任务，执行刷新逻辑。

**代码位置**：`backend/app/celery_app/tasks.py:155-281`

```python
@app.task(bind=True, max_retries=3, time_limit=120)
def refresh_feed(self, feed_id, feed_url, user_id, refresh_interval, ...):
    task_id = self.request.id  # 当前任务的 ID

    # ═══════════════════════════════════════════════════════════════════
    # Step 1: 获取任务锁
    # ═══════════════════════════════════════════════════════════════════
    task_lock = get_task_lock()
    lock_key = f"feed:{feed_id}"  # "feed:111"

    if not task_lock.acquire(lock_key, lock_ttl=180, task_id=task_id):
        # 获取锁失败 = 另一个任务正在处理这个 Feed
        raise Reject("Feed is locked", requeue=False)

    # ═══════════════════════════════════════════════════════════════════
    # Step 2: 执行刷新
    # ═══════════════════════════════════════════════════════════════════
    try:
        result = do_refresh_feed(feed_id, feed_url, user_id)
        # do_refresh_feed 内部做的事：
        #   1. rate_limiter.wait_for_domain(feed_url)  # 限流
        #   2. parse_rss_feed(feed_url)                # 解析 RSS
        #   3. supabase.table("articles").upsert(...)  # 保存文章

        update_feed_status(feed_id, user_id, status="success")

    except Exception as e:
        update_feed_status(feed_id, user_id, status="failed", error=str(e))
        raise  # 触发重试

    # ═══════════════════════════════════════════════════════════════════
    # Step 3: 安排下次刷新
    # ═══════════════════════════════════════════════════════════════════
    schedule_next_refresh(feed_id, user_id, refresh_interval)

    # ═══════════════════════════════════════════════════════════════════
    # Step 4: 释放锁
    # ═══════════════════════════════════════════════════════════════════
    task_lock.release(lock_key, task_id)

    return {"success": True, "feed_id": feed_id, "article_count": result["count"]}
```

### 阶段 7：自动安排下次刷新

**发生了什么**：任务完成后，自动创建一个"30分钟后执行"的新任务。

**代码位置**：`backend/app/celery_app/tasks.py:283-336`

```python
def schedule_next_refresh(feed_id, user_id, refresh_interval):
    delay_seconds = refresh_interval * 60  # 30 * 60 = 1800 秒

    # 防止重复调度：获取 schedule 锁
    schedule_lock_key = f"schedule:{feed_id}"
    if not task_lock.acquire(schedule_lock_key, ttl=delay_seconds):
        return  # 已有调度任务

    # 从数据库获取最新 Feed 数据
    feed = supabase.table("feeds").select("*").eq("id", feed_id).single().execute().data

    # 创建延迟任务
    refresh_feed.apply_async(
        kwargs={
            "feed_id": feed_id,
            "feed_url": feed["url"],
            "user_id": user_id,
            "refresh_interval": feed["refresh_interval"],
            "priority": "normal"
        },
        countdown=delay_seconds,  # 1800 秒后执行
        queue="default"
    )

    logger.info(f"Scheduled next refresh for feed {feed_id} in {delay_seconds}s")
```

**这就是"自动循环刷新"的秘密**：
- 每次刷新完成 → 安排下次
- 下次刷新完成 → 再安排下次
- 无限循环，除非：
  - Feed 被删除
  - Worker 停止运行

---

## Redis 数据实例

以 `feed_id=111`，`refresh_interval=30` 为例，看看 Redis 里具体存了什么。

### 1. 任务队列

**Key**：`celery` （Celery 默认使用 Redis List）

```bash
# 查看 default 队列中的任务
redis-cli> LRANGE celery 0 -1
```

**任务数据格式**（JSON）：

```json
{
  "body": "W3siZmVlZF9pZCI6ICIxMTEiLCAi...（base64 编码的参数）",
  "content-encoding": "utf-8",
  "content-type": "application/json",
  "headers": {
    "lang": "py",
    "task": "refresh_feed",
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "root_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "parent_id": null,
    "origin": "gen12345@DESKTOP-ABC",
    "retries": 0,
    "eta": null,
    "expires": null
  },
  "properties": {
    "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "reply_to": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
    "delivery_mode": 2,
    "delivery_tag": "c3d4e5f6-a7b8-9012-cdef-345678901234"
  }
}
```

**body 解码后**：

```json
{
  "feed_id": "111",
  "feed_url": "https://example.com/rss.xml",
  "feed_title": "Example Blog",
  "user_id": "user-abc-123",
  "refresh_interval": 30,
  "priority": "normal"
}
```

### 2. 任务锁（防止重复执行）

**Key**：`tasklock:feed:111`

```bash
# 查看锁状态
redis-cli> GET tasklock:feed:111
"a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # 持有锁的任务 ID

# 查看剩余过期时间
redis-cli> TTL tasklock:feed:111
(integer) 175  # 还有 175 秒过期

# 锁不存在时
redis-cli> GET tasklock:feed:111
(nil)
```

**锁的生命周期**：

```
时刻 T+0秒:   任务开始，获取锁          SET tasklock:feed:111 "task-id" NX EX 180
时刻 T+5秒:   任务执行中...             锁存在，TTL=175
时刻 T+30秒:  任务完成，释放锁          DEL tasklock:feed:111
时刻 T+30秒:  锁消失                    GET tasklock:feed:111 → (nil)
```

**为什么 TTL 是 180 秒？**
- 任务超时限制是 120 秒（`time_limit=120`）
- 180 > 120，确保任务超时后锁也能自动过期
- 防止任务崩溃导致的死锁

### 3. 调度锁（防止重复安排下次刷新）

**Key**：`tasklock:schedule:111`

```bash
# 任务完成后，安排下次刷新前设置
redis-cli> SET tasklock:schedule:111 "1" NX EX 1800  # 30分钟
OK

# 查看状态
redis-cli> GET tasklock:schedule:111
"1"

redis-cli> TTL tasklock:schedule:111
(integer) 1795  # 还有约 30 分钟过期
```

**为什么需要调度锁？**

想象这个场景：
1. Worker A 刷新 Feed 111，准备安排下次
2. 同时，Worker B 也在处理 Feed 111 的重试任务
3. 如果没有调度锁，两个 Worker 都会安排"30分钟后刷新"
4. 结果：30分钟后执行两次刷新，浪费资源

### 4. 任务结果

**Key**：`celery-task-meta-{task_id}`

```bash
redis-cli> GET celery-task-meta-a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**返回值**（JSON）：

```json
{
  "status": "SUCCESS",
  "result": {
    "success": true,
    "feed_id": "111",
    "article_count": 15,
    "duration_ms": 2340
  },
  "traceback": null,
  "children": [],
  "date_done": "2025-01-15T10:30:45.123456+00:00",
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**TTL**：24 小时后自动删除（Celery 默认配置）

### 5. 域名限流

**Key**：`ratelimit:domain:{domain_hash}`

```bash
# 对 example.com 的请求限流
redis-cli> GET ratelimit:domain:example.com
"1736939445123"  # 上次请求的时间戳（毫秒）

redis-cli> PTTL ratelimit:domain:example.com
(integer) 850  # 还有 850 毫秒过期
```

**限流逻辑**：
- 每次请求前检查这个 Key
- 如果存在且未过期，等待直到过期
- 过期后设置新值，执行请求
- 效果：对同一域名的请求间隔 ≥ 1 秒

---

## 时序图

```
时间轴
  │
  │  T+0ms    用户点击"添加订阅"
  │     │
  │     ├──▶ [浏览器] AddFeedDialog.handleSubmit()
  │     │
  │     ├──▶ [浏览器] parseRSSFeed() 解析 RSS
  │     │
  │     ├──▶ [浏览器] Zustand: addFeed()
  │     │         │
  │     │         ├──▶ [HTTP] POST /api/backend/feeds
  │     │         │         │
  │     │         │         └──▶ [FastAPI] 保存 Feed 到 Supabase
  │     │         │
  │     │         └──▶ [浏览器] scheduleFeedRefresh() (fire-and-forget)
  │     │
  │  T+100ms  [HTTP] POST /api/backend/queue/schedule-feed
  │     │
  │     ├──▶ [FastAPI] queue.py: schedule_feed_refresh()
  │     │         │
  │     │         ├──▶ 验证 JWT
  │     │         ├──▶ 查询 Supabase 获取 Feed 详情
  │     │         ├──▶ 检查 Redis 锁
  │     │         └──▶ refresh_feed.apply_async(countdown=0)
  │     │
  │  T+150ms  [Redis] 任务入队
  │     │         │
  │     │         └──▶ LPUSH celery:default {task_json}
  │     │
  │  T+200ms  [Celery Worker] 取出任务
  │     │         │
  │     │         ├──▶ SET tasklock:feed:111 NX EX 180
  │     │         │         └── 获取锁成功
  │     │         │
  │     │         ├──▶ rate_limiter.wait_for_domain()
  │     │         │         └── 检查/等待限流
  │     │         │
  │     │         ├──▶ 请求 https://example.com/rss.xml
  │     │         │
  │     │         ├──▶ 解析 XML，提取文章
  │     │         │
  │     │         ├──▶ supabase.table("articles").upsert(...)
  │     │         │
  │     │         ├──▶ supabase.table("feeds").update(last_fetched=now)
  │     │         │
  │     │         ├──▶ schedule_next_refresh()
  │     │         │         │
  │     │         │         ├──▶ SET tasklock:schedule:111 NX EX 1800
  │     │         │         └──▶ refresh_feed.apply_async(countdown=1800)
  │     │         │
  │     │         └──▶ DEL tasklock:feed:111
  │     │                   └── 释放锁
  │     │
  │  T+5s     任务完成
  │     │
  │     └──▶ [Redis] SET celery-task-meta-xxx {result_json}
  │
  │
  │  ... 30 分钟后 ...
  │
  │
  │  T+30min  [Redis] 延迟任务变为可见
  │     │
  │     └──▶ [Celery Worker] 取出任务，重复上述流程
  │
  ▼
无限循环...
```

---

## 关键文件速查表

| 功能 | 文件路径 | 关键行号 |
|------|----------|----------|
| 添加订阅对话框 | `frontend/components/add-feed-dialog.tsx` | 68-107 |
| Zustand addFeed | `frontend/lib/store/feeds.slice.ts` | 20-82 |
| 队列客户端 | `frontend/lib/queue-client.ts` | 51-74 |
| FastAPI 调度端点 | `backend/app/api/routers/queue.py` | 34-122 |
| Celery 配置 | `backend/app/celery_app/celery.py` | 16-54 |
| 刷新任务定义 | `backend/app/celery_app/tasks.py` | 155-281 |
| 核心刷新逻辑 | `backend/app/celery_app/tasks.py` | 57-128 |
| 自动调度下次 | `backend/app/celery_app/tasks.py` | 283-336 |
| 任务锁实现 | `backend/app/celery_app/task_lock.py` | 31-60 |
| 域名限流器 | `backend/app/celery_app/rate_limiter.py` | 57-99 |

---

## 总结

**新订阅 Feed 时的数据流**：

```
用户点击 → Zustand Store → HTTP API → FastAPI → Celery → Redis 队列
                                                           ↓
                                              Celery Worker 执行
                                                           ↓
                                              解析 RSS → 保存文章
                                                           ↓
                                              自动安排 30 分钟后的下次刷新
                                                           ↓
                                              30 分钟后 → 循环往复...
```

**Redis 中的关键数据**：

| Key | 类型 | 用途 | TTL |
|-----|------|------|-----|
| `celery:default` | List | 任务队列 | 永久 |
| `celery:high` | List | 高优先级队列 | 永久 |
| `tasklock:feed:{id}` | String | 防止重复执行 | 180秒 |
| `tasklock:schedule:{id}` | String | 防止重复调度 | 1800秒 |
| `celery-task-meta-{task_id}` | String | 任务结果 | 24小时 |
| `ratelimit:domain:{domain}` | String | 域名限流 | 1秒 |

**为什么这个设计是好的？**

1. **异步解耦**：用户不用等 RSS 解析完成
2. **防重复**：Redis 锁保证同一 Feed 不会被并发刷新
3. **自动循环**：任务完成后自动安排下次，无需 cron
4. **优先级队列**：手动刷新优先于自动刷新
5. **容错**：Worker 崩溃后任务不丢失（acks_late=True）

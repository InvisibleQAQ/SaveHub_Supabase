# RSS 刷新系统完全指南

> 从点击按钮到文章入库，一文搞懂 SaveHub 的 RSS 刷新全流程

---

## 1. 先讲个故事：RSS 刷新像什么？

想象你订阅了 10 份报纸。每天早上，你有两种方式获取新闻：

**方式一：自己去报摊取（直接刷新）**
- 你亲自跑到报摊，一份一份拿回来
- 优点：马上就能看到
- 缺点：你得等着，期间啥也干不了

**方式二：让快递员送（队列刷新）**
- 你告诉快递站："帮我把这 10 份报纸取回来"
- 快递员排队处理，一份一份送到你家
- 优点：你可以继续做自己的事
- 缺点：不是立刻到手

SaveHub 的 RSS 刷新系统就是这样：
- **前端直接刷新** = 自己去报摊取
- **后端队列刷新** = 让快递员送

---

## 2. 系统全景图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户操作                                       │
│                                                                         │
│   [Ctrl+R 快捷键]     [右键菜单刷新]      [顶部刷新按钮]                   │
│         │                  │                   │                        │
└─────────┴──────────────────┴───────────────────┴────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Next.js 前端                                      │
│                                                                         │
│   ┌─────────────────────┐        ┌──────────────────────────┐          │
│   │   直接刷新模式        │        │     队列刷新模式          │          │
│   │   (parseRSSFeed)    │        │  (scheduleFeedRefresh)   │          │
│   │                     │        │                          │          │
│   │  前端直接解析RSS     │        │  发HTTP请求给后端         │          │
│   └──────────┬──────────┘        └────────────┬─────────────┘          │
│              │                                │                        │
└──────────────┼────────────────────────────────┼────────────────────────┘
               │                                │
               │ 解析结果                        │ POST /api/queue/schedule-feed
               ▼                                ▼
┌──────────────────────────┐     ┌────────────────────────────────────────┐
│      Zustand Store       │     │           FastAPI 后端                  │
│    (前端状态管理)         │     │                                        │
│                          │     │  1. 验证用户身份                        │
│  articles: [...新文章]   │     │  2. 检查 Redis 锁（是否正在刷新）        │
│  feeds: [...更新时间]    │     │  3. 创建 Celery 任务                    │
└──────────────────────────┘     │  4. 任务进入 Redis 队列                 │
                                 └──────────────┬─────────────────────────┘
                                                │
                                                ▼
                                 ┌────────────────────────────────────────┐
                                 │              Redis                     │
                                 │                                        │
                                 │   角色1: 消息队列（存待办任务）          │
                                 │   角色2: 分布式锁（防重复刷新）          │
                                 │   角色3: 结果存储（保存执行结果）        │
                                 └──────────────┬─────────────────────────┘
                                                │
                                                │ Worker 拉取任务
                                                ▼
                                 ┌────────────────────────────────────────┐
                                 │          Celery Worker                 │
                                 │                                        │
                                 │  1. 获取锁（标记"我在处理这个Feed"）     │
                                 │  2. 速率限制（别把人家网站打爆）         │
                                 │  3. 解析 RSS 获取文章                   │
                                 │  4. 保存到数据库                        │
                                 │  5. 更新 Feed 状态                      │
                                 │  6. 安排下一次刷新                      │
                                 │  7. 释放锁                             │
                                 └──────────────┬─────────────────────────┘
                                                │
                                                ▼
                                 ┌────────────────────────────────────────┐
                                 │         Supabase (PostgreSQL)          │
                                 │                                        │
                                 │   feeds 表: 更新 last_fetched          │
                                 │   articles 表: 插入新文章               │
                                 └────────────────────────────────────────┘
```

---

## 3. 前端部分详解（Next.js）

### 3.1 触发刷新的三种方式

| 方式 | 触发位置 | 代码文件 |
|-----|---------|---------|
| Ctrl+R 快捷键 | 全局 | `frontend/components/keyboard-shortcuts.tsx:104` |
| 右键菜单 "Refresh Feed" | 侧边栏 Feed 项 | `frontend/components/sidebar/feed-item.tsx:186` |
| 刷新按钮 | 侧边栏顶部 | `frontend/components/feed-refresh.tsx` |

### 3.2 快捷键是如何工作的？

```typescript
// 文件: frontend/components/keyboard-shortcuts.tsx
// 第 104-109 行

case "r":
  if (event.ctrlKey || event.metaKey) {    // Ctrl+R 或 Cmd+R
    event.preventDefault()                  // 阻止浏览器默认刷新行为
    // 发射一个自定义事件，像广播一样通知所有监听者
    document.dispatchEvent(new CustomEvent("refresh-feeds"))
  }
  break
```

**这段代码在干嘛？**
1. 监听键盘事件
2. 如果是 Ctrl+R，阻止浏览器刷新页面
3. 发射一个名为 `refresh-feeds` 的自定义事件
4. 其他组件监听这个事件，执行刷新逻辑

### 3.3 FeedRefresh 组件：刷新的核心

```typescript
// 文件: frontend/components/feed-refresh.tsx
// 简化版核心逻辑

export function FeedRefresh({ feedId, listenToGlobalEvent = false }) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { feeds, addArticles, updateFeed } = useRSSStore()

  // 刷新单个 Feed 的函数
  const refreshFeed = async (feed) => {
    // 第一步：解析 RSS（这是"自己去报摊取报纸"）
    const { articles } = await parseRSSFeed(feed.url, feed.id)

    // 第二步：把新文章加到 Zustand store
    const newArticlesCount = await addArticles(articles)

    // 第三步：更新 Feed 的"最后刷新时间"
    await updateFeed(feed.id, { lastFetched: new Date() })

    return newArticlesCount
  }

  // 点击按钮时执行
  const handleRefresh = async () => {
    if (isRefreshing) return  // 正在刷新中，别重复点
    setIsRefreshing(true)     // 显示加载动画

    try {
      if (feedId) {
        // 刷新指定的单个 Feed
        await refreshFeed(feeds.find(f => f.id === feedId))
      } else {
        // 刷新所有 Feeds（循环处理）
        for (const feed of feeds) {
          await refreshFeed(feed)
        }
      }
      toast({ title: "刷新完成！" })
    } finally {
      setIsRefreshing(false)  // 关闭加载动画
    }
  }

  // 监听全局 "refresh-feeds" 事件（Ctrl+R 触发的）
  useEffect(() => {
    if (!listenToGlobalEvent) return

    const handleGlobalRefresh = () => handleRefresh()
    document.addEventListener("refresh-feeds", handleGlobalRefresh)

    return () => document.removeEventListener("refresh-feeds", handleGlobalRefresh)
  }, [listenToGlobalEvent, handleRefresh])

  return (
    <Button onClick={handleRefresh} disabled={isRefreshing}>
      {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
    </Button>
  )
}
```

### 3.4 队列刷新：交给后端处理

当添加新 Feed 或更新 Feed 设置时，系统会调用后端队列：

```typescript
// 文件: frontend/lib/queue-client.ts

export async function scheduleFeedRefresh(
  feedId: string,
  forceImmediate = false  // true = 立即刷新，false = 按计划刷新
): Promise<ScheduleFeedResponse> {

  // 发送 HTTP POST 请求给后端
  const response = await fetch("/api/backend/queue/schedule-feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",  // 带上登录凭证（Cookie）
    body: JSON.stringify({
      feed_id: feedId,
      force_immediate: forceImmediate,
    }),
  })

  return response.json()
}

// 返回值示例：
// {
//   task_id: "abc-123-def",     // 任务ID，可以用来查询进度
//   status: "scheduled",        // 状态：scheduled/already_running/queued
//   delay_seconds: 0            // 延迟多少秒后执行
// }
```

**什么时候用队列刷新？**

```typescript
// 文件: frontend/lib/store/feeds.slice.ts

// 添加新 Feed 时 → 自动调度刷新
addFeed: async (feed) => {
  // ...保存 Feed 到数据库...

  // Fire-and-forget: 异步调度，不等待结果
  scheduleFeedRefresh(newFeed.id).catch(console.error)
}

// 更新 Feed 设置时 → 重新调度
updateFeed: async (feedId, updates) => {
  // ...更新数据库...

  // 如果改了 URL 或刷新间隔，需要重新安排刷新计划
  if (updates.url || updates.refreshInterval) {
    scheduleFeedRefresh(feedId).catch(console.error)
  }
}
```

---

## 4. 后端部分详解（FastAPI + Celery）

### 4.1 API 入口：接收刷新请求

```python
# 文件: backend/app/api/routers/queue.py
# POST /queue/schedule-feed

@router.post("/schedule-feed")
async def schedule_feed_refresh(
    request_data: ScheduleFeedRequest,  # 包含 feed_id 和 force_immediate
    request: Request,
    auth_response=Depends(verify_auth),  # 验证用户登录
):
    user_id = auth_response.user.id
    feed_id = str(request_data.feed_id)

    # 第一步：从数据库获取 Feed 信息
    feed = supabase.table("feeds").select("*").eq("id", feed_id).single().execute()

    # 第二步：检查是否已经在刷新中（防止重复）
    task_lock = get_task_lock()
    if task_lock.is_locked(f"feed:{feed_id}"):
        return {"status": "already_running", "delay_seconds": remaining_time}

    # 第三步：根据参数决定如何调度
    if request_data.force_immediate:
        # 立即刷新 → 放入高优先级队列
        task = refresh_feed.apply_async(
            kwargs={...},
            queue="high"  # 高优先级队列，插队执行
        )
        return {"task_id": task.id, "status": "scheduled", "delay_seconds": 0}
    else:
        # 按计划刷新 → 计算延迟时间
        delay = calculate_delay(feed.last_fetched, feed.refresh_interval)
        task = refresh_feed.apply_async(
            kwargs={...},
            countdown=delay,  # N 秒后执行
            queue="default"   # 普通队列
        )
        return {"task_id": task.id, "status": "queued", "delay_seconds": delay}
```

### 4.2 Celery 任务：真正干活的地方

```python
# 文件: backend/app/celery_app/tasks.py

@app.task(
    bind=True,              # 可以访问 self（任务实例）
    max_retries=3,          # 最多重试 3 次
    retry_backoff=True,     # 重试间隔指数增长（2s, 4s, 8s...）
    time_limit=120,         # 最多执行 2 分钟
    acks_late=True,         # 执行完才确认（保证可靠性）
)
def refresh_feed(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int,
    priority: str = "normal",
):
    """
    刷新单个 RSS Feed。

    这个函数由 Celery Worker 在后台执行，
    不会阻塞前端或 API 服务器。
    """
    task_id = self.request.id
    task_lock = get_task_lock()
    lock_key = f"feed:{feed_id}"

    # ═══════════════════════════════════════════════════════
    # 第一步：获取分布式锁
    # ═══════════════════════════════════════════════════════
    # 为什么要锁？
    # 假设用户疯狂点击刷新，或者定时任务和手动刷新同时触发
    # 没有锁的话，同一个 Feed 可能被同时处理多次 → 数据混乱

    if not task_lock.acquire(lock_key, ttl=180, owner=task_id):
        # 锁被别人持有，说明有另一个任务正在处理
        raise Reject("Feed is locked", requeue=False)  # 直接放弃，不重试

    try:
        # ═══════════════════════════════════════════════════════
        # 第二步：执行核心刷新逻辑
        # ═══════════════════════════════════════════════════════
        result = do_refresh_feed(feed_id, feed_url, user_id)

        # ═══════════════════════════════════════════════════════
        # 第三步：更新 Feed 状态
        # ═══════════════════════════════════════════════════════
        update_feed_status(feed_id, user_id, status="success")

        # ═══════════════════════════════════════════════════════
        # 第四步：安排下一次刷新
        # ═══════════════════════════════════════════════════════
        # 比如 refresh_interval=30 分钟
        # 那么 30 分钟后，这个 Feed 会再次被刷新
        schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {"success": True, "article_count": result["article_count"]}

    except RetryableError as e:
        # 网络超时、服务器 503 等 → 可以重试
        update_feed_status(feed_id, user_id, status="failed", error=str(e))
        raise self.retry(exc=e)  # 触发 Celery 重试机制

    except NonRetryableError as e:
        # RSS 格式错误、URL 无效等 → 不重试，直接标记失败
        update_feed_status(feed_id, user_id, status="failed", error=str(e))
        schedule_next_refresh(feed_id, user_id, refresh_interval)  # 但还是安排下次刷新
        return {"success": False, "error": str(e)}

    finally:
        # ═══════════════════════════════════════════════════════
        # 第五步：释放锁（无论成功失败都要释放）
        # ═══════════════════════════════════════════════════════
        task_lock.release(lock_key, owner=task_id)
```

### 4.3 核心刷新逻辑：解析 RSS 并保存文章

```python
# 文件: backend/app/celery_app/tasks.py

def do_refresh_feed(feed_id: str, feed_url: str, user_id: str):
    """
    核心刷新逻辑，与 Celery 框架解耦。
    这样设计的好处：可以单独进行单元测试。
    """
    from app.services.rss_parser import parse_rss_feed

    supabase = get_supabase_service()
    rate_limiter = get_rate_limiter()

    # ═══════════════════════════════════════════════════════
    # 第一步：域名速率限制
    # ═══════════════════════════════════════════════════════
    # 为什么要限制？
    # 如果你订阅了同一个网站的 10 个 RSS，
    # 同时刷新会在 1 秒内发 10 个请求，可能被网站封禁。
    # 速率限制确保同一个域名每秒最多请求 1 次。

    waited = rate_limiter.wait_for_domain(feed_url, max_wait_seconds=30)
    if waited > 0:
        logger.debug(f"速率限制：等待了 {waited:.2f} 秒")

    # ═══════════════════════════════════════════════════════
    # 第二步：解析 RSS Feed
    # ═══════════════════════════════════════════════════════
    result = parse_rss_feed(feed_url, feed_id)
    articles = result.get("articles", [])

    # ═══════════════════════════════════════════════════════
    # 第三步：保存文章到数据库
    # ═══════════════════════════════════════════════════════
    if articles:
        db_articles = []
        for article in articles:
            db_articles.append({
                "id": article.get("id") or str(uuid4()),
                "feed_id": feed_id,
                "user_id": user_id,
                "title": article.get("title", "Untitled")[:500],
                "content": article.get("content", ""),
                "summary": article.get("summary", "")[:1000],
                "url": article.get("url", ""),
                "author": article.get("author"),
                "published_at": article.get("publishedAt"),
                "is_read": False,
                "is_starred": False,
            })

        # Upsert: 有则更新，无则插入
        # on_conflict: 如果 (url, user_id) 组合已存在，跳过（去重）
        supabase.table("articles").upsert(
            db_articles,
            on_conflict="url,user_id",
            ignore_duplicates=True
        ).execute()

    return {"success": True, "article_count": len(articles)}
```

---

## 5. Redis 的三重角色

Redis 在这个系统中扮演了三个关键角色，就像一个身兼数职的员工：

### 角色 1: 消息队列（任务调度中心）

```
┌─────────────────────────────────────────────────────────────┐
│                    Redis 消息队列                           │
│                                                             │
│   "default" 列表（普通队列）                                 │
│   ┌─────┬─────┬─────┬─────┬─────┐                          │
│   │任务1│任务2│任务3│任务4│任务5│ ← 定时刷新任务排队          │
│   └─────┴─────┴─────┴─────┴─────┘                          │
│                                                             │
│   "high" 列表（高优先级队列）                                │
│   ┌─────┬─────┐                                             │
│   │任务A│任务B│ ← 手动刷新任务，Worker 优先处理              │
│   └─────┴─────┘                                             │
│                                                             │
│   Worker 从队列头部取任务，处理完再取下一个                   │
└─────────────────────────────────────────────────────────────┘
```

**配置代码：**
```python
# 文件: backend/app/celery_app/celery.py

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "savehub",
    broker=REDIS_URL,   # 消息队列地址
    backend=REDIS_URL,  # 结果存储地址
)

# 两个队列：高优先级和默认
app.conf.task_queues = {
    "high": {},      # 手动刷新
    "default": {},   # 定时刷新
}
```

### 角色 2: 分布式锁（防止重复处理）

```
场景：用户疯狂点击刷新按钮

没有锁的情况：
  Worker 1: 开始处理 Feed A...
  Worker 2: 开始处理 Feed A...  ← 重复了！
  Worker 1: 保存 10 篇文章
  Worker 2: 保存 10 篇文章      ← 可能数据冲突！

有锁的情况：
  Worker 1: 获取锁成功，开始处理 Feed A...
  Worker 2: 获取锁失败，Feed A 已被锁定，放弃
  Worker 1: 处理完成，释放锁
```

**锁的实现：**
```python
# 文件: backend/app/celery_app/task_lock.py

class TaskLock:
    def __init__(self, redis_client):
        self.redis = redis_client

    def acquire(self, key: str, ttl_seconds: int, owner: str) -> bool:
        """
        尝试获取锁。

        key: 锁的名称，如 "feed:abc-123"
        ttl_seconds: 锁的有效期（秒），防止死锁
        owner: 锁的持有者标识（任务ID）

        返回 True 表示获取成功，False 表示已被别人持有
        """
        lock_key = f"tasklock:{key}"

        # SET NX: 只在 key 不存在时设置（原子操作）
        # EX: 设置过期时间
        acquired = self.redis.set(
            lock_key,
            owner,
            nx=True,  # Not eXists: 不存在才设置
            ex=ttl_seconds
        )
        return acquired is not None

    def release(self, key: str, owner: str):
        """
        释放锁。只有锁的持有者才能释放。
        """
        lock_key = f"tasklock:{key}"

        # 检查是不是自己的锁（防止误释放别人的锁）
        current_owner = self.redis.get(lock_key)
        if current_owner == owner:
            self.redis.delete(lock_key)

    def is_locked(self, key: str) -> bool:
        """检查锁是否被持有"""
        return self.redis.exists(f"tasklock:{key}")

    def get_ttl(self, key: str) -> int:
        """获取锁的剩余有效期"""
        return self.redis.ttl(f"tasklock:{key}") or 0
```

### 角色 3: 结果存储（任务追踪）

```python
# 任务完成后，Celery 自动将结果存入 Redis
# Key 格式: celery-task-meta-{task_id}
# 有效期: 24 小时

# 查询任务状态的 API：
@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    from celery.result import AsyncResult

    result = AsyncResult(task_id)

    return {
        "task_id": task_id,
        "status": result.status,  # PENDING/STARTED/SUCCESS/FAILURE
        "result": result.result if result.ready() else None,
    }
```

**Redis 中存储的数据结构：**

| Key 模式 | 类型 | 用途 | 有效期 |
|---------|------|------|--------|
| `default` | List | 普通任务队列 | 永久 |
| `high` | List | 高优先级任务队列 | 永久 |
| `tasklock:feed:{id}` | String | 处理锁 | 180秒 |
| `schedule:feed:{id}` | String | 调度锁（防重复安排） | 1小时 |
| `ratelimit:domain:{domain}` | String | 域名速率限制 | 1秒 |
| `celery-task-meta-{id}` | String | 任务执行结果 | 24小时 |

---

## 6. 两套刷新系统的对比

SaveHub 实际上有**两套并存的刷新系统**：

| 特性 | 前端直接刷新 | 后端队列刷新 |
|-----|------------|------------|
| 触发方式 | 按钮点击、Ctrl+R | 添加Feed、更新设置 |
| 执行位置 | 浏览器 | 服务器 |
| 优点 | 即时反馈 | 后台异步，不阻塞 |
| 缺点 | 阻塞用户操作 | 需要等待 |
| 适用场景 | 用户主动刷新 | 自动定时刷新 |
| 代码入口 | `parseRSSFeed()` | `scheduleFeedRefresh()` |

```
                   ┌─────────────────────────────────────┐
                   │           用户点击刷新               │
                   └──────────────┬──────────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
┌─────────────────────────┐           ┌─────────────────────────┐
│    前端直接刷新          │           │    后端队列刷新          │
│                         │           │                         │
│  1. parseRSSFeed()      │           │  1. HTTP POST           │
│  2. addArticles()       │           │  2. Celery Task         │
│  3. updateFeed()        │           │  3. Redis Queue         │
│                         │           │  4. Worker 处理          │
│  用户等待 ←───────────── │           │  ──────────→ 后台执行    │
└─────────────────────────┘           └─────────────────────────┘
```

---

## 7. 自动调度：如何实现定时刷新？

### 7.1 前端调度器（setTimeout 方案）

```typescript
// 文件: frontend/lib/scheduler.ts
// 在应用启动时初始化

export function scheduleFeedRefresh(feed: Feed): void {
  // 计算距离下次刷新的时间
  const delay = calculateRefreshDelay(feed)

  // 设置定时器
  const timeoutId = setTimeout(async () => {
    // 执行刷新
    await refreshFeed(feed)

    // 刷新完成后，递归安排下一次刷新
    const updatedFeed = getFeedById(feed.id)
    if (updatedFeed) {
      scheduleFeedRefresh(updatedFeed)  // 递归调用
    }
  }, delay)

  // 保存定时器 ID，以便取消
  activeTimeouts.set(feed.id, timeoutId)
}

function calculateRefreshDelay(feed: Feed): number {
  const now = Date.now()
  const lastFetched = feed.lastFetched?.getTime() || now
  const intervalMs = feed.refreshInterval * 60 * 1000  // 分钟转毫秒

  // 下次刷新时间 = 上次刷新时间 + 刷新间隔
  const nextRefreshTime = lastFetched + intervalMs

  // 延迟 = 下次刷新时间 - 现在
  return Math.max(0, nextRefreshTime - now)
}
```

### 7.2 后端调度（Celery countdown 方案）

```python
# 文件: backend/app/celery_app/tasks.py

def schedule_next_refresh(feed_id: str, user_id: str, refresh_interval: int):
    """
    在当前刷新完成后，安排下一次刷新。

    比如 refresh_interval = 30（分钟）
    那么 30 * 60 = 1800 秒后，这个任务会再次执行
    """
    delay_seconds = refresh_interval * 60

    # 防止重复安排（如果已经安排了，就不要重复）
    task_lock = get_task_lock()
    schedule_lock_key = f"schedule:{feed_id}"

    if not task_lock.acquire(schedule_lock_key, ttl=delay_seconds):
        return  # 已经有安排了

    # 从数据库获取最新的 Feed 信息
    feed = supabase.table("feeds").select("*").eq("id", feed_id).single().execute()

    # 安排下一次执行
    refresh_feed.apply_async(
        kwargs={
            "feed_id": feed_id,
            "feed_url": feed["url"],
            "feed_title": feed["title"],
            "user_id": user_id,
            "refresh_interval": feed["refresh_interval"],
        },
        countdown=delay_seconds,  # N 秒后执行
        queue="default"
    )
```

---

## 8. 错误处理与重试机制

### 8.1 可重试 vs 不可重试错误

```python
# 文件: backend/app/celery_app/tasks.py

def is_retryable_error(error_msg: str) -> bool:
    """判断错误是否可以通过重试解决"""

    retryable_patterns = [
        # 网络问题 - 可能是临时的
        "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET",
        "socket hang up", "timeout", "ConnectionError", "TimeoutError",

        # 服务器临时不可用
        "503",  # Service Unavailable
        "502",  # Bad Gateway
        "429",  # Too Many Requests（速率限制）
    ]

    return any(p.lower() in error_msg.lower() for p in retryable_patterns)

# 不可重试的错误示例：
# - RSS 格式错误（重试也解析不了）
# - URL 无效（重试也访问不了）
# - 404 Not Found（页面不存在）
```

### 8.2 重试策略

```python
@app.task(
    max_retries=3,           # 最多重试 3 次
    default_retry_delay=2,   # 第一次重试延迟 2 秒
    retry_backoff=True,      # 指数退避：2s → 4s → 8s
    retry_backoff_max=60,    # 最大延迟 60 秒
    retry_jitter=True,       # 随机抖动，避免雷同
)
def refresh_feed(self, ...):
    try:
        result = do_refresh_feed(...)
    except RetryableError as e:
        # 触发重试
        raise self.retry(exc=e)
```

**重试时间线示例：**
```
第 1 次执行: 失败（网络超时）
等待 2 秒...
第 2 次执行: 失败（网络超时）
等待 4 秒...
第 3 次执行: 失败（网络超时）
等待 8 秒...
第 4 次执行: 成功！
```

---

## 9. 文件索引

快速定位代码位置：

| 功能模块 | 文件路径 | 关键行号 |
|---------|---------|---------|
| **前端** | | |
| 快捷键监听 | `frontend/components/keyboard-shortcuts.tsx` | 104-109 |
| 刷新按钮组件 | `frontend/components/feed-refresh.tsx` | 全文件 |
| 右键菜单刷新 | `frontend/components/sidebar/feed-item.tsx` | 100-127, 186-192 |
| 队列API客户端 | `frontend/lib/queue-client.ts` | 全文件 |
| 前端调度器 | `frontend/lib/scheduler.ts` | 全文件 |
| Zustand Feed Slice | `frontend/lib/store/feeds.slice.ts` | addFeed, updateFeed |
| **后端** | | |
| 队列API路由 | `backend/app/api/routers/queue.py` | 34-122 |
| Celery配置 | `backend/app/celery_app/celery.py` | 14-54 |
| 刷新任务定义 | `backend/app/celery_app/tasks.py` | 155-280 |
| 核心刷新逻辑 | `backend/app/celery_app/tasks.py` | 57-128 |
| 分布式锁实现 | `backend/app/celery_app/task_lock.py` | 全文件 |
| 速率限制器 | `backend/app/celery_app/rate_limiter.py` | 全文件 |

---

## 10. 常见问题 FAQ

**Q: 为什么有时候刷新很慢？**

A: 可能的原因：
1. 后端队列堆积（前面有其他任务在排队）
2. RSS 源响应慢
3. 触发了速率限制（同域名请求间隔 1 秒）

**Q: 为什么同一篇文章不会重复出现？**

A: 数据库有唯一约束 `(url, user_id)`，使用 `upsert` + `ignore_duplicates` 去重。

**Q: 前端刷新和后端刷新会冲突吗？**

A: 不会冲突，但可能重复刷新。前端刷新是同步的，后端有 Redis 锁防止并发。

**Q: 如何启动 Celery Worker？**

```bash
# Windows
celery -A app.celery_app worker --loglevel=info --pool=solo

# 监控面板（可选）
celery -A app.celery_app flower --port=5555
```

---

## 总结

SaveHub 的 RSS 刷新系统是一个典型的**异步任务处理架构**：

1. **前端**负责用户交互和即时反馈
2. **FastAPI**负责接收请求和任务调度
3. **Redis**负责消息队列、分布式锁、结果存储
4. **Celery Worker**负责后台执行耗时任务
5. **Supabase**负责持久化存储

这种架构的优点是：
- 用户操作不会被阻塞
- 可以水平扩展（增加 Worker 数量）
- 任务可追踪、可重试
- 有速率限制和锁机制保护

缺点是：
- 架构复杂度增加
- 需要维护 Redis 服务
- 调试相对困难

---

*文档生成时间: 2024年*
*适用于 SaveHub RSS Reader 项目*

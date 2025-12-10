# BullMQ → Celery + Redis 迁移方案 (v2)

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v2   | 2024-12 | 修复 task 调用 bug、去重机制、时区处理、连接池、回滚方案 |
| v1   | 2024-12 | 初版 |

---

## 目标

将现有的 BullMQ (Node.js) RSS 刷新队列迁移到 Celery + Redis，实现：

- Python 技术栈统一
- 成熟的任务队列框架（重试、调度、监控内置）
- 保持现有功能完整性

---

## ⚠️ 关键差异：BullMQ vs Celery

**迁移前必须理解这些本质差异，不能照搬 BullMQ 的心智模型！**

| 特性 | BullMQ | Celery | 迁移策略 |
|------|--------|--------|----------|
| 任务去重 | `jobId` 自动去重，相同 ID 任务不会重复添加 | `task_id` **不去重**，相同 ID 会报错或覆盖 | 用 Redis 锁实现 |
| 优先级 | 原生支持数字优先级 | Redis broker 不支持优先级 | 多队列模拟 |
| 延迟任务存储 | 有序集合，可查询 | ETA 任务存在 worker 内存 | 接受差异 |
| 重复任务 | `repeat` 配置，持久化 | Celery Beat，需单独进程 | 改用自调度模式 |

---

## 现有 BullMQ 架构分析

### 文件结构

```
frontend/lib/queue/
├── redis.ts          # Redis 连接管理
├── schemas.ts        # Zod 任务结构定义
├── rss-queue.ts      # BullMQ Queue 实例
├── rss-scheduler.ts  # 调度逻辑 (生产者)
├── worker.ts         # BullMQ Worker (消费者)
├── dashboard.ts      # Bull Board 监控
└── index.ts          # 模块导出
```

### 任务数据结构

```typescript
// frontend/lib/queue/schemas.ts
interface RSSRefreshTask {
  feedId: string       // UUID
  feedUrl: string      // RSS URL
  feedTitle: string    // 显示名称
  userId: string       // UUID (用户隔离)
  lastFetched: Date | null
  refreshInterval: number  // 分钟 (1-10080)
  priority: "manual" | "overdue" | "normal"
}
```

### 队列配置

| 配置项   | 当前值               | 说明              |
| -------- | -------------------- | ----------------- |
| 队列名   | `rss-refresh`        | 单队列设计        |
| 并发数   | 5                    | `CONCURRENCY`     |
| 重试次数 | 3                    | 指数退避 2s/4s/8s |
| 任务清理 | 完成保留24h/1000条   | 失败保留7天       |
| 域名限速 | 1 req/sec per domain | 防止 IP 封禁      |

---

## Celery 实现 (v2)

### 目录结构

```
backend/
├── app/
│   ├── celery_app/
│   │   ├── __init__.py          # Celery app 导出
│   │   ├── celery.py            # Celery 配置
│   │   ├── tasks.py             # 任务定义
│   │   ├── rate_limiter.py      # 域名限速器 (修复版)
│   │   ├── task_lock.py         # 任务去重锁 (新增)
│   │   └── supabase_client.py   # Supabase 连接池 (新增)
│   ├── api/routers/
│   │   └── queue.py             # 队列 API
│   └── services/
│       └── rss/
│           └── parser.py        # RSS 解析服务
├── requirements.txt
└── scripts/
    └── migrate_bullmq.py        # 迁移脚本 (新增)
```

### 依赖

```txt
# requirements.txt 新增
celery[redis]>=5.3.0     # Celery + Redis broker
flower>=2.0.0            # 监控面板
redis>=5.0.0             # Redis 客户端
feedparser>=6.0.0        # RSS 解析
```

---

### Celery 配置

```python
# backend/app/celery_app/celery.py
import os
from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "savehub",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.celery_app.tasks"]
)

app.conf.update(
    # 序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # 时区 - 统一使用 UTC
    timezone="UTC",
    enable_utc=True,

    # Worker 配置
    worker_prefetch_multiplier=1,  # 公平调度
    worker_concurrency=5,

    # 任务配置
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,  # 追踪 STARTED 状态

    # 结果过期
    result_expires=86400,  # 24h

    # 多队列配置 (模拟优先级)
    task_default_queue="default",
    task_queues={
        "high": {},      # 手动刷新
        "default": {},   # 正常调度
    },
    task_routes={
        "app.celery_app.tasks.refresh_feed": {"queue": "default"},
    },
)
```

---

### Supabase 连接池 (新增)

```python
# backend/app/celery_app/supabase_client.py
"""
Supabase 客户端单例

解决问题：每次任务都创建新连接，浪费资源
"""
import os
from functools import lru_cache
from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_supabase_service() -> Client:
    """
    获取 Service Role 客户端 (绕过 RLS)

    使用 lru_cache 确保整个进程只创建一个实例
    """
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def get_supabase_user(access_token: str) -> Client:
    """
    获取用户级别客户端 (遵守 RLS)

    每次都创建新实例，因为 token 不同
    """
    url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    client = create_client(url, anon_key)
    client.auth.set_session(access_token, "")
    return client
```

---

### 任务去重锁 (新增)

```python
# backend/app/celery_app/task_lock.py
"""
基于 Redis 的任务去重锁

解决问题：Celery 的 task_id 不像 BullMQ 的 jobId 那样自动去重

使用场景：
- 防止同一个 feed 的刷新任务重复调度
- 防止用户疯狂点击手动刷新
"""
import os
import redis
from contextlib import contextmanager
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class TaskLock:
    """分布式任务锁"""

    KEY_PREFIX = "tasklock:"

    def __init__(self, redis_url: str = None):
        self.redis = redis.from_url(
            redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )

    def acquire(
        self,
        lock_key: str,
        ttl_seconds: int = 300,  # 默认 5 分钟
        task_id: str = None
    ) -> bool:
        """
        尝试获取锁

        Args:
            lock_key: 锁的唯一标识 (如 "feed:{feed_id}")
            ttl_seconds: 锁的过期时间
            task_id: 可选，存储当前任务 ID 便于调试

        Returns:
            True 如果获取成功，False 如果已被锁定
        """
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        value = task_id or "1"

        # NX: 只在 key 不存在时设置
        # EX: 设置过期时间
        acquired = self.redis.set(full_key, value, nx=True, ex=ttl_seconds)

        if not acquired:
            # 获取失败，记录谁持有锁
            holder = self.redis.get(full_key)
            logger.debug(f"Lock {lock_key} held by {holder}")

        return bool(acquired)

    def release(self, lock_key: str, task_id: str = None) -> bool:
        """
        释放锁

        只有锁的持有者才能释放（通过 task_id 验证）
        """
        full_key = f"{self.KEY_PREFIX}{lock_key}"

        if task_id:
            # 验证是否是锁的持有者
            current = self.redis.get(full_key)
            if current != task_id:
                logger.warning(
                    f"Lock {lock_key} not held by {task_id}, current holder: {current}"
                )
                return False

        return bool(self.redis.delete(full_key))

    def is_locked(self, lock_key: str) -> bool:
        """检查是否已锁定"""
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        return self.redis.exists(full_key) > 0

    def get_ttl(self, lock_key: str) -> int:
        """获取锁的剩余 TTL (秒)"""
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        ttl = self.redis.ttl(full_key)
        return max(0, ttl)  # -1 或 -2 时返回 0

    @contextmanager
    def lock(self, lock_key: str, ttl_seconds: int = 300, task_id: str = None):
        """
        上下文管理器形式的锁

        用法:
            with task_lock.lock("feed:123") as acquired:
                if acquired:
                    do_work()
        """
        acquired = self.acquire(lock_key, ttl_seconds, task_id)
        try:
            yield acquired
        finally:
            if acquired:
                self.release(lock_key, task_id)


# 全局单例
_task_lock: Optional[TaskLock] = None


def get_task_lock() -> TaskLock:
    global _task_lock
    if _task_lock is None:
        _task_lock = TaskLock()
    return _task_lock
```

---

### 域名限速器 (修复版)

```python
# backend/app/celery_app/rate_limiter.py
"""
基于 Redis 的域名级别请求限速器

修复问题：
1. busy loop - pttl 返回 <=0 时需要短暂等待
2. 竞态条件 - 使用 Lua 脚本保证原子性
"""
import os
import time
import redis
from urllib.parse import urlparse
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class DomainRateLimiter:
    """分布式域名限速器"""

    KEY_PREFIX = "ratelimit:domain:"

    # Lua 脚本：原子性地检查并设置限速
    # 返回: 0 = 可以请求, >0 = 需要等待的毫秒数
    LUA_SCRIPT = """
    local key = KEYS[1]
    local interval_ms = tonumber(ARGV[1])

    local ttl = redis.call('PTTL', key)

    if ttl <= 0 then
        -- key 不存在或已过期，设置新的限速
        redis.call('SET', key, '1', 'PX', interval_ms)
        return 0
    else
        -- 需要等待
        return ttl
    end
    """

    def __init__(
        self,
        redis_url: str = None,
        min_interval_ms: int = 1000
    ):
        self.redis = redis.from_url(
            redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )
        self.min_interval_ms = min_interval_ms

        # 注册 Lua 脚本
        self._check_and_set = self.redis.register_script(self.LUA_SCRIPT)

    def wait_for_domain(self, url: str, max_wait_seconds: float = 30.0) -> float:
        """
        等待直到可以请求该域名

        Args:
            url: 请求 URL
            max_wait_seconds: 最大等待时间，超过则放弃

        Returns:
            实际等待的秒数

        Raises:
            TimeoutError: 如果等待超时
        """
        domain = urlparse(url).hostname or "unknown"
        key = f"{self.KEY_PREFIX}{domain}"

        total_waited = 0.0

        while total_waited < max_wait_seconds:
            # 使用 Lua 脚本原子性检查
            wait_ms = self._check_and_set(
                keys=[key],
                args=[self.min_interval_ms]
            )

            if wait_ms == 0:
                return total_waited

            # 需要等待
            wait_seconds = wait_ms / 1000.0

            # 添加小的随机抖动，避免惊群效应
            import random
            jitter = random.uniform(0, 0.1)
            actual_wait = min(wait_seconds + jitter, max_wait_seconds - total_waited)

            if actual_wait <= 0:
                break

            time.sleep(actual_wait)
            total_waited += actual_wait

        raise TimeoutError(f"Rate limit timeout for domain: {domain}")


# 全局单例
_rate_limiter: Optional[DomainRateLimiter] = None


def get_rate_limiter() -> DomainRateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = DomainRateLimiter()
    return _rate_limiter
```

---

### Celery 任务定义 (重写)

```python
# backend/app/celery_app/tasks.py
"""
RSS 刷新任务

设计原则：
1. 单一任务 + 参数区分优先级 (不用两个任务)
2. 核心逻辑抽离，方便测试
3. 正确的时区处理
4. 使用 Redis 锁实现真正的去重
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from uuid import uuid4

from celery import shared_task
from celery.exceptions import Reject

from .celery import app
from .rate_limiter import get_rate_limiter
from .task_lock import get_task_lock
from .supabase_client import get_supabase_service

logger = logging.getLogger(__name__)


# =============================================================================
# 核心业务逻辑 (与 Celery 解耦，方便单元测试)
# =============================================================================

class FeedRefreshError(Exception):
    """Feed 刷新错误基类"""
    pass


class RetryableError(FeedRefreshError):
    """可重试的错误"""
    pass


class NonRetryableError(FeedRefreshError):
    """不可重试的错误"""
    pass


def is_retryable_error(error_msg: str) -> bool:
    """判断错误是否可重试"""
    retryable_patterns = [
        "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET",
        "socket hang up", "timeout", "temporarily unavailable",
        "503", "502", "429", "ConnectionError", "TimeoutError"
    ]
    error_lower = error_msg.lower()
    return any(p.lower() in error_lower for p in retryable_patterns)


def do_refresh_feed(
    feed_id: str,
    feed_url: str,
    user_id: str,
) -> Dict[str, Any]:
    """
    执行 Feed 刷新的核心逻辑

    与 Celery 完全解耦，可直接用于单元测试

    Returns:
        {"success": True, "article_count": N}
        或 raise FeedRefreshError
    """
    from app.services.rss.parser import parse_rss_feed  # 避免循环导入

    supabase = get_supabase_service()
    rate_limiter = get_rate_limiter()

    # 1. 域名限速
    try:
        waited = rate_limiter.wait_for_domain(feed_url, max_wait_seconds=30)
        if waited > 0:
            logger.debug(f"Rate limited, waited {waited:.2f}s for {feed_url}")
    except TimeoutError as e:
        raise RetryableError(str(e))

    # 2. 解析 RSS
    try:
        result = parse_rss_feed(feed_url)
        articles = result.get("articles", [])
    except Exception as e:
        error_msg = str(e)
        if is_retryable_error(error_msg):
            raise RetryableError(error_msg)
        else:
            raise NonRetryableError(error_msg)

    # 3. 保存文章
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
                "thumbnail": article.get("thumbnail"),
            })

        # Upsert (按 url + user_id 去重)
        supabase.table("articles").upsert(
            db_articles,
            on_conflict="url,user_id",
            ignore_duplicates=True
        ).execute()

    return {"success": True, "article_count": len(articles)}


def update_feed_status(
    feed_id: str,
    user_id: str,
    status: str,
    error: Optional[str] = None
):
    """更新 Feed 状态"""
    supabase = get_supabase_service()

    update_data = {
        "last_fetched": datetime.now(timezone.utc).isoformat(),
        "last_fetch_status": status,
        "last_fetch_error": error[:500] if error else None
    }

    supabase.table("feeds").update(update_data).eq(
        "id", feed_id
    ).eq("user_id", user_id).execute()


# =============================================================================
# Celery 任务
# =============================================================================

@app.task(
    bind=True,
    name="refresh_feed",
    max_retries=3,
    default_retry_delay=2,
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=120,      # 硬超时 2 分钟
    soft_time_limit=90,  # 软超时 1.5 分钟
)
def refresh_feed(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int,
    priority: str = "normal",
    skip_lock: bool = False,  # 重试时跳过锁检查
):
    """
    刷新单个 RSS Feed

    Args:
        feed_id: Feed UUID
        feed_url: RSS URL
        feed_title: 显示名称
        user_id: 用户 UUID
        refresh_interval: 刷新间隔 (分钟)
        priority: 优先级 (manual/overdue/normal)
        skip_lock: 是否跳过锁检查 (重试时使用)
    """
    task_id = self.request.id
    attempt = self.request.retries + 1
    max_attempts = self.max_retries + 1

    logger.info(
        f"[{task_id}] Processing: {feed_title} ({feed_id}), "
        f"attempt={attempt}/{max_attempts}, priority={priority}"
    )

    start_time = datetime.now(timezone.utc)
    task_lock = get_task_lock()
    lock_key = f"feed:{feed_id}"

    # 检查任务锁 (防止重复执行)
    if not skip_lock:
        # 锁的 TTL 应该比任务超时长一点
        lock_ttl = 180  # 3 分钟
        if not task_lock.acquire(lock_key, lock_ttl, task_id):
            remaining = task_lock.get_ttl(lock_key)
            logger.info(
                f"[{task_id}] Feed {feed_id} already being processed, "
                f"lock expires in {remaining}s"
            )
            # 不重试，直接丢弃
            raise Reject(f"Feed {feed_id} is locked", requeue=False)

    try:
        # 执行刷新
        result = do_refresh_feed(feed_id, feed_url, user_id)

        # 更新状态
        update_feed_status(feed_id, user_id, "success")

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            f"[{task_id}] Completed: {feed_title}, "
            f"articles={result['article_count']}, duration={duration_ms}ms"
        )

        # 调度下次刷新
        schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {
            "success": True,
            "feed_id": feed_id,
            "article_count": result["article_count"],
            "duration_ms": duration_ms
        }

    except RetryableError as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.warning(
            f"[{task_id}] Retryable error: {feed_title}, error={e}, duration={duration_ms}ms"
        )

        update_feed_status(feed_id, user_id, "failed", str(e))

        # 重试时传入 skip_lock=True，因为我们已经持有锁
        raise self.retry(
            exc=e,
            kwargs={**self.request.kwargs, "skip_lock": True}
        )

    except NonRetryableError as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error(
            f"[{task_id}] Non-retryable error: {feed_title}, error={e}, duration={duration_ms}ms"
        )

        update_feed_status(feed_id, user_id, "failed", str(e))

        # 仍然调度下次刷新
        schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {
            "success": False,
            "feed_id": feed_id,
            "error": str(e),
            "duration_ms": duration_ms
        }

    except Exception as e:
        # 未预期的错误
        logger.exception(f"[{task_id}] Unexpected error: {feed_title}")
        update_feed_status(feed_id, user_id, "failed", str(e))
        raise

    finally:
        # 释放锁
        if not skip_lock:
            task_lock.release(lock_key, task_id)


def schedule_next_refresh(feed_id: str, user_id: str, refresh_interval: int):
    """
    调度下次刷新

    使用 countdown 而不是 ETA，因为 ETA 在 worker 重启后会丢失
    """
    delay_seconds = refresh_interval * 60
    task_lock = get_task_lock()

    # 检查是否已有待执行的调度 (用另一个锁)
    schedule_lock_key = f"schedule:{feed_id}"

    # 调度锁的 TTL 应该接近 delay_seconds
    schedule_lock_ttl = min(delay_seconds, 3600)  # 最多 1 小时

    if not task_lock.acquire(schedule_lock_key, schedule_lock_ttl):
        logger.debug(f"Feed {feed_id} already has scheduled refresh")
        return

    try:
        supabase = get_supabase_service()

        # 获取最新的 Feed 数据
        result = supabase.table("feeds").select(
            "id, url, title, refresh_interval, user_id"
        ).eq("id", feed_id).eq("user_id", user_id).single().execute()

        if not result.data:
            logger.warning(f"Feed {feed_id} not found, skipping reschedule")
            return

        feed = result.data

        # 调度任务
        refresh_feed.apply_async(
            kwargs={
                "feed_id": feed_id,
                "feed_url": feed["url"],
                "feed_title": feed["title"],
                "user_id": user_id,
                "refresh_interval": feed["refresh_interval"],
                "priority": "normal"
            },
            countdown=delay_seconds,
            queue="default"
        )

        logger.debug(f"Scheduled next refresh for {feed['title']} in {delay_seconds}s")

    except Exception as e:
        logger.error(f"Failed to schedule next refresh: {e}")
        # 释放调度锁，允许重试
        task_lock.release(schedule_lock_key)


# =============================================================================
# 批量调度任务 (分批处理版)
# =============================================================================

@app.task(name="schedule_feeds_batch")
def schedule_feeds_batch(feed_ids: list, user_id: str = None):
    """
    批量调度一组 Feed

    由 schedule_all_feeds 分批调用
    """
    supabase = get_supabase_service()

    query = supabase.table("feeds").select("*").in_("id", feed_ids)
    if user_id:
        query = query.eq("user_id", user_id)

    result = query.execute()

    if not result.data:
        return {"scheduled": 0}

    scheduled = 0
    now = datetime.now(timezone.utc)

    for feed in result.data:
        # 计算延迟
        last_fetched = None
        if feed.get("last_fetched"):
            last_fetched = datetime.fromisoformat(
                feed["last_fetched"].replace("Z", "+00:00")
            )

        if last_fetched:
            next_refresh = last_fetched + timedelta(minutes=feed["refresh_interval"])
            delay_seconds = max(0, (next_refresh - now).total_seconds())
        else:
            # 从未刷新过，添加随机延迟避免惊群
            import random
            delay_seconds = random.uniform(0, 60)

        # 调度
        refresh_feed.apply_async(
            kwargs={
                "feed_id": feed["id"],
                "feed_url": feed["url"],
                "feed_title": feed["title"],
                "user_id": feed["user_id"],
                "refresh_interval": feed["refresh_interval"],
                "priority": "normal"
            },
            countdown=int(delay_seconds),
            queue="default"
        )
        scheduled += 1

    return {"scheduled": scheduled}


@app.task(name="schedule_all_feeds")
def schedule_all_feeds(batch_size: int = 50):
    """
    调度所有 Feed 的刷新任务

    分批处理，避免任务风暴

    Args:
        batch_size: 每批处理的 Feed 数量
    """
    supabase = get_supabase_service()

    # 获取所有 Feed ID
    result = supabase.table("feeds").select("id").execute()

    if not result.data:
        logger.info("No feeds to schedule")
        return {"total": 0, "batches": 0}

    feed_ids = [f["id"] for f in result.data]
    total = len(feed_ids)

    # 分批调度
    batches = 0
    for i in range(0, total, batch_size):
        batch = feed_ids[i:i + batch_size]
        # 每批之间添加延迟，避免瞬间创建大量任务
        schedule_feeds_batch.apply_async(
            args=[batch],
            countdown=batches * 5  # 每批间隔 5 秒
        )
        batches += 1

    logger.info(f"Scheduled {total} feeds in {batches} batches")
    return {"total": total, "batches": batches}
```

---

### __init__.py

```python
# backend/app/celery_app/__init__.py
from .celery import app as celery_app

__all__ = ["celery_app"]
```

---

## 前端 Producer

### FastAPI 路由

```python
# backend/app/api/routers/queue.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from app.dependencies import verify_jwt, get_user_client
from app.celery_app.tasks import refresh_feed, schedule_all_feeds
from app.celery_app.task_lock import get_task_lock

router = APIRouter(prefix="/queue", tags=["queue"])


class ScheduleFeedRequest(BaseModel):
    feed_id: UUID
    force_immediate: bool = False


class ScheduleFeedResponse(BaseModel):
    task_id: Optional[str]
    status: str  # "scheduled" | "already_running" | "queued"
    delay_seconds: int


@router.post("/schedule-feed", response_model=ScheduleFeedResponse)
async def schedule_feed_refresh(
    request: ScheduleFeedRequest,
    user=Depends(verify_jwt),
    supabase=Depends(get_user_client)
):
    """调度 Feed 刷新任务"""
    user_id = user.user.id
    feed_id = str(request.feed_id)

    # 获取 Feed 数据
    result = supabase.table("feeds").select("*").eq(
        "id", feed_id
    ).eq("user_id", user_id).single().execute()

    if not result.data:
        raise HTTPException(404, "Feed not found")

    feed = result.data

    # 检查是否已有任务在执行
    task_lock = get_task_lock()
    if task_lock.is_locked(f"feed:{feed_id}"):
        remaining = task_lock.get_ttl(f"feed:{feed_id}")
        return ScheduleFeedResponse(
            task_id=None,
            status="already_running",
            delay_seconds=remaining
        )

    if request.force_immediate:
        # 立即刷新 (高优先级队列)
        task = refresh_feed.apply_async(
            kwargs={
                "feed_id": feed_id,
                "feed_url": feed["url"],
                "feed_title": feed["title"],
                "user_id": user_id,
                "refresh_interval": feed["refresh_interval"],
                "priority": "manual"
            },
            queue="high"  # 高优先级队列
        )
        return ScheduleFeedResponse(
            task_id=task.id,
            status="scheduled",
            delay_seconds=0
        )
    else:
        # 按计划调度
        delay_seconds = 0

        if feed.get("last_fetched"):
            last_fetched = datetime.fromisoformat(
                feed["last_fetched"].replace("Z", "+00:00")
            )
            next_refresh = last_fetched + timedelta(minutes=feed["refresh_interval"])
            now = datetime.now(timezone.utc)  # 使用 UTC！
            delay_seconds = max(0, int((next_refresh - now).total_seconds()))

        task = refresh_feed.apply_async(
            kwargs={
                "feed_id": feed_id,
                "feed_url": feed["url"],
                "feed_title": feed["title"],
                "user_id": user_id,
                "refresh_interval": feed["refresh_interval"],
                "priority": "normal"
            },
            countdown=delay_seconds,
            queue="default"
        )

        return ScheduleFeedResponse(
            task_id=task.id,
            status="queued",
            delay_seconds=delay_seconds
        )


@router.post("/schedule-all")
async def schedule_all_feeds_endpoint(user=Depends(verify_jwt)):
    """调度所有 Feed 刷新 (管理员功能)"""
    # TODO: 添加管理员权限检查
    task = schedule_all_feeds.delay()
    return {"task_id": task.id, "status": "initiated"}


@router.get("/task/{task_id}")
async def get_task_status(task_id: str, user=Depends(verify_jwt)):
    """获取任务状态"""
    from celery.result import AsyncResult

    result = AsyncResult(task_id)

    response = {
        "task_id": task_id,
        "status": result.status,
    }

    if result.ready():
        response["result"] = result.result
    elif result.failed():
        response["error"] = str(result.result)

    return response
```

### 健康检查 (优化版)

```python
# backend/app/api/routers/health.py
from fastapi import APIRouter
from datetime import datetime, timezone
import redis
import os

router = APIRouter(tags=["health"])


@router.get("/queue-health")
async def queue_health():
    """
    队列健康检查

    优化：不使用 inspect 广播，直接检查 Redis
    """
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    r = redis.from_url(redis_url, decode_responses=True)

    try:
        # 检查 Redis 连接
        r.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    # 检查队列长度 (不广播给 worker)
    # Celery 默认队列格式: celery (或自定义名称)
    default_queue_len = r.llen("default") or 0
    high_queue_len = r.llen("high") or 0

    # 如果队列积压过多，认为不健康
    total_pending = default_queue_len + high_queue_len
    is_healthy = redis_ok and total_pending < 1000

    return {
        "status": "healthy" if is_healthy else "degraded",
        "redis_connected": redis_ok,
        "queues": {
            "default": default_queue_len,
            "high": high_queue_len,
        },
        "total_pending": total_pending,
        "checked_at": datetime.now(timezone.utc).isoformat()
    }
```

### 注册路由

```python
# backend/app/main.py (添加)
from app.api.routers import queue, health

app.include_router(queue.router, prefix="/api")
app.include_router(health.router, prefix="/api")
```

---

## 迁移步骤

### 概述

```
Phase 0: 准备 (可逆)
    ↓
Phase 1: 双写期 - BullMQ + Celery 并行运行 (可逆)
    ↓
Phase 2: 切换 - 停止 BullMQ，Celery 接管 (可回滚)
    ↓
Phase 3: 清理 - 删除 BullMQ 代码 (不可逆)
```

### Phase 0: 准备工作

**目标**：安装依赖，创建文件，不影响生产

```bash
# 1. 安装依赖
cd backend
pip install "celery[redis]" flower redis

# 2. 创建目录结构
mkdir -p backend/app/celery_app
mkdir -p backend/scripts

# 3. 复制代码文件 (见上文)

# 4. 配置环境变量
# .env 添加:
# REDIS_URL=redis://localhost:6379/0
# SUPABASE_SERVICE_ROLE_KEY=xxx

# 5. 验证 Celery 可启动 (不处理任务)
cd backend
celery -A app.celery_app inspect ping
# 应该返回空 (没有 worker)
```

**回滚**：删除新文件即可，对生产无影响

### Phase 1: 双写期

**目标**：BullMQ 和 Celery 并行运行，验证 Celery 正确性

**时长**：建议 3-7 天

```bash
# 1. 启动 Celery Worker (只消费，不生产)
cd backend
celery -A app.celery_app worker --loglevel=info --queues=high,default

# 2. 启动 Flower 监控
celery -A app.celery_app flower --port=5555

# 3. 手动测试单个 Feed
# 在 Python shell 中:
from app.celery_app.tasks import refresh_feed
task = refresh_feed.delay(
    feed_id="xxx",
    feed_url="https://example.com/rss",
    feed_title="Test",
    user_id="xxx",
    refresh_interval=60
)
print(task.get(timeout=30))

# 4. 验证结果
# - 检查 Flower 面板
# - 检查 Supabase 中的 articles 表
# - 检查 feeds 表的 last_fetched 更新
```

**监控指标**：
- Celery 任务成功率 vs BullMQ 成功率
- 文章抓取数量对比
- 错误类型分布

**回滚**：停止 Celery Worker，BullMQ 继续运行

### Phase 2: 切换

**目标**：Celery 完全接管，停止 BullMQ

```bash
# 1. 停止 BullMQ Worker
# 在 frontend 目录:
# 停止 pnpm worker:dev

# 2. 清空 BullMQ 队列中的待处理任务
# (可选) 或者等待自然消费完

# 3. 注册 FastAPI 路由
# 修改 backend/app/main.py (见上文)

# 4. 配置 Next.js rewrite
# next.config.js:
# {
#   source: "/api/backend/:path*",
#   destination: "http://localhost:8000/api/:path*",
# }

# 5. 替换前端调用
# 用新的 queue-client.ts 替换 lib/queue/* 的导入

# 6. 初始化调度
curl -X POST http://localhost:8000/api/queue/schedule-all \
  -H "Authorization: Bearer YOUR_TOKEN"

# 7. 验证
# - 检查 Flower 面板任务流量
# - 检查 /api/queue-health 返回 healthy
# - 手动刷新几个 Feed 测试
```

**回滚脚本**：

```python
# backend/scripts/rollback_to_bullmq.py
"""
回滚到 BullMQ

执行此脚本后:
1. 停止 Celery Worker
2. 重启 BullMQ Worker
3. 清空 Celery 队列
"""
import redis
import os

def rollback():
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    r = redis.from_url(redis_url)

    # 清空 Celery 队列
    r.delete("default")
    r.delete("high")

    # 清空任务锁
    for key in r.scan_iter("tasklock:*"):
        r.delete(key)

    for key in r.scan_iter("ratelimit:*"):
        r.delete(key)

    print("Celery queues cleared. Now restart BullMQ worker.")

if __name__ == "__main__":
    rollback()
```

### Phase 3: 清理

**目标**：删除 BullMQ 代码

**前提**：Phase 2 稳定运行 7 天以上

```bash
# 1. 删除 BullMQ 文件
rm -rf frontend/lib/queue/

# 2. 删除 npm 依赖
cd frontend
pnpm remove bullmq ioredis @bull-board/api @bull-board/fastify

# 3. 更新文档
# - frontend/CLAUDE.md
# - README.md

# 4. 提交代码
git add -A
git commit -m "chore: remove BullMQ after Celery migration"
```

**此阶段不可回滚**，需要重新实现 BullMQ 代码才能回滚

---

## 启动命令

### 开发环境

```bash
# 终端 1: FastAPI
cd backend
uvicorn app.main:app --reload --port 8000

# 终端 2: Celery Worker
cd backend
# Linux/Mac:
celery -A app.celery_app worker --loglevel=info --queues=high,default --concurrency=5

# Windows:
celery -A app.celery_app worker --loglevel=info --queues=high,default --pool=solo

# 终端 3: Flower 监控 (可选)
cd backend
celery -A app.celery_app flower --port=5555

# 终端 4: Next.js
cd frontend
pnpm dev
```

### 生产环境 (Docker Compose)

```yaml
# docker-compose.yml
version: "3.8"

services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  fastapi:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    environment:
      - REDIS_URL=redis://redis:6379/0
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
    depends_on:
      redis:
        condition: service_healthy
    ports:
      - "8000:8000"

  celery-worker:
    build: ./backend
    command: >
      celery -A app.celery_app worker
      --loglevel=info
      --queues=high,default
      --concurrency=5
    environment:
      - REDIS_URL=redis://redis:6379/0
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    # 优雅关闭
    stop_grace_period: 30s

  flower:
    build: ./backend
    command: celery -A app.celery_app flower --port=5555
    environment:
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - celery-worker
    ports:
      - "5555:5555"

volumes:
  redis-data:
```

---

## 监控与告警

### Flower Dashboard

访问: `http://localhost:5555`

关键指标:
- **Active tasks**: 正在执行的任务数
- **Processed**: 已处理任务总数
- **Failed**: 失败任务数
- **Succeeded**: 成功任务数
- **Retried**: 重试次数

### Prometheus 指标 (可选)

```python
# backend/app/celery_app/metrics.py
from prometheus_client import Counter, Histogram, Gauge

# 任务计数
TASK_COUNTER = Counter(
    "celery_task_total",
    "Total tasks processed",
    ["task_name", "status"]
)

# 任务耗时
TASK_DURATION = Histogram(
    "celery_task_duration_seconds",
    "Task duration in seconds",
    ["task_name"]
)

# 队列长度
QUEUE_LENGTH = Gauge(
    "celery_queue_length",
    "Number of tasks in queue",
    ["queue_name"]
)
```

### 告警规则建议

| 指标 | 阈值 | 告警级别 |
|------|------|----------|
| 队列积压 | > 500 持续 5 分钟 | Warning |
| 队列积压 | > 1000 持续 5 分钟 | Critical |
| 失败率 | > 10% 过去 1 小时 | Warning |
| Worker 数量 | = 0 | Critical |
| 任务耗时 P99 | > 60s | Warning |

---

## 故障排除

### 常见问题

#### 1. Windows 上 Worker 启动失败

```bash
# 错误: billiard.exceptions.SpawnError
# 解决: 使用 solo pool
celery -A app.celery_app worker --pool=solo --loglevel=info
```

#### 2. 任务不执行

```bash
# 检查 Worker 是否连接
celery -A app.celery_app inspect ping

# 检查队列中是否有任务
redis-cli LLEN default
redis-cli LLEN high

# 检查任务路由配置
celery -A app.celery_app inspect active_queues
```

#### 3. 任务重复执行

检查:
1. `acks_late=True` 是否配置
2. 任务锁是否正常工作
3. Worker 是否异常重启

```bash
# 检查任务锁状态
redis-cli KEYS "tasklock:*"
```

#### 4. Redis 连接失败

```bash
# 测试 Redis
redis-cli ping

# 检查环境变量
echo $REDIS_URL

# 检查防火墙
telnet localhost 6379
```

#### 5. 域名限速不生效

```bash
# 检查限速锁
redis-cli KEYS "ratelimit:*"

# 手动测试
redis-cli PTTL "ratelimit:domain:example.com"
```

---

## 功能对照表

| BullMQ 功能 | Celery 实现 | 备注 |
|-------------|-------------|------|
| `queue.add(data, {delay})` | `task.apply_async(countdown=N)` | |
| `queue.add(data, {jobId})` | Redis 锁 + 检查 | 需手动实现 |
| `queue.add(data, {priority})` | 多队列 (`queue="high"`) | |
| `worker.process()` | `@app.task` 装饰器 | |
| `job.retry()` | `autoretry_for` + `retry_backoff` | |
| `queue.getWaitingCount()` | `redis.llen("queue_name")` | |
| Bull Dashboard | Flower | |
| Repeatable jobs | 自调度模式 | 不用 Celery Beat |

---

## 相关文件清单

### 新增文件

```
backend/
├── app/
│   ├── celery_app/
│   │   ├── __init__.py
│   │   ├── celery.py
│   │   ├── tasks.py
│   │   ├── rate_limiter.py
│   │   ├── task_lock.py         # 新增: 任务去重
│   │   └── supabase_client.py   # 新增: 连接池
│   └── api/routers/
│       ├── queue.py
│       └── health.py            # 新增: 健康检查
├── scripts/
│   └── rollback_to_bullmq.py    # 新增: 回滚脚本
└── requirements.txt             # 更新
```

### 删除文件 (Phase 3)

```
frontend/lib/queue/              # 整个目录
```

### 修改文件

```
frontend/lib/queue-client.ts     # 新建
frontend/CLAUDE.md               # 更新
backend/app/main.py              # 注册路由
```

---

## 附录: 前端调用客户端

```typescript
// frontend/lib/queue-client.ts

interface ScheduleFeedResponse {
  task_id: string | null
  status: "scheduled" | "already_running" | "queued"
  delay_seconds: number
}

interface QueueHealth {
  status: "healthy" | "degraded"
  redis_connected: boolean
  queues: {
    default: number
    high: number
  }
  total_pending: number
}

async function getAccessToken(): Promise<string> {
  // 从 Supabase session 获取 token
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ""
}

export async function scheduleFeedRefresh(
  feedId: string,
  forceImmediate = false
): Promise<ScheduleFeedResponse> {
  const accessToken = await getAccessToken()

  const response = await fetch("/api/backend/queue/schedule-feed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      feed_id: feedId,
      force_immediate: forceImmediate
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || "Failed to schedule feed refresh")
  }

  return response.json()
}

export async function getQueueHealth(): Promise<QueueHealth> {
  const response = await fetch("/api/backend/queue-health")
  return response.json()
}

export async function getTaskStatus(taskId: string): Promise<{
  task_id: string
  status: string
  result?: any
  error?: string
}> {
  const accessToken = await getAccessToken()

  const response = await fetch(`/api/backend/queue/task/${taskId}`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  })

  return response.json()
}
```

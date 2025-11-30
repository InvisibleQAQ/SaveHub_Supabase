# Celery 后台任务系统实现

## 概述

本文档说明如何使用 Celery 替换现有的 BullMQ 后台任务系统，实现 RSS 订阅源的定时刷新功能。

## 现有 BullMQ 实现分析

### 核心功能

**文件**: `lib/queue/worker.ts`

1. **域名限速**: 每个域名 1 秒内最多 1 次请求
2. **重试机制**: 3 次重试，指数退避
3. **优先级系统**: 手动(1) > 过期(2) > 正常(5)
4. **状态更新**: 更新 feed 的 `last_fetched`、`last_fetch_status`、`last_fetch_error`
5. **自动调度**: 任务完成后自动调度下一次刷新

### 任务 Schema

**文件**: `lib/queue/schemas.ts`

```typescript
RSSRefreshTask = {
  feedId: string
  feedUrl: string
  feedTitle: string
  userId: string
  lastFetched: Date | null
  refreshInterval: number  // 分钟
  priority: "manual" | "overdue" | "normal"
}
```

## Celery 实现

### Celery 配置

创建 `backend/app/tasks/__init__.py`：

```python
"""Celery 任务包"""
```

创建 `backend/app/tasks/celery_config.py`：

```python
"""
Celery 应用配置

配置 Celery 使用 Redis 作为消息代理和结果后端。
"""

from celery import Celery
import os
from dotenv import load_dotenv

load_dotenv()

# Redis 配置
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# 创建 Celery 应用
celery_app = Celery(
    "rss_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.rss_tasks"]  # 自动发现任务模块
)

# Celery 配置
celery_app.conf.update(
    # 序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # 时区
    timezone="UTC",
    enable_utc=True,

    # 任务确认
    task_acks_late=True,  # 任务完成后才确认
    task_reject_on_worker_lost=True,  # worker 丢失时重新入队

    # 并发控制
    worker_concurrency=5,  # 匹配 BullMQ 的并发数
    worker_prefetch_multiplier=1,  # 每次只预取一个任务

    # 结果过期
    result_expires=86400,  # 24小时后删除结果

    # 任务路由（可选，用于分离不同类型的任务）
    task_routes={
        "app.tasks.rss_tasks.*": {"queue": "rss"},
    },

    # 重试配置
    task_default_retry_delay=2,  # 默认重试延迟（秒）
    task_max_retries=3,  # 默认最大重试次数
)

# 定时任务配置（可选，使用 Celery Beat）
celery_app.conf.beat_schedule = {
    # 示例：每小时检查过期的订阅源
    # 'check-overdue-feeds': {
    #     'task': 'app.tasks.rss_tasks.check_overdue_feeds',
    #     'schedule': 3600.0,  # 每小时
    # },
}
```

### 域名限速器

创建 `backend/app/core/rate_limiter.py`：

```python
"""
域名限速器

实现基于域名的请求速率限制，防止对单个域名发送过多请求。
匹配 BullMQ worker 中的限速逻辑。
"""

import asyncio
from collections import defaultdict
from urllib.parse import urlparse
import time
from typing import Dict
import threading


class DomainRateLimiter:
    """
    基于域名的速率限制器

    每个域名每秒最多发送一个请求。
    使用线程安全的实现以支持 Celery worker。
    """

    def __init__(self, rate_limit_ms: int = 1000):
        """
        初始化限速器

        Args:
            rate_limit_ms: 同一域名两次请求的最小间隔（毫秒）
        """
        self.rate_limit_ms = rate_limit_ms
        self.domain_last_request: Dict[str, float] = defaultdict(float)
        self._lock = threading.Lock()

    def wait_for_domain(self, url: str) -> float:
        """
        等待直到可以请求指定域名

        Args:
            url: 要请求的 URL

        Returns:
            实际等待的时间（秒）
        """
        domain = urlparse(url).hostname or "unknown"

        with self._lock:
            now = time.time() * 1000  # 转换为毫秒
            last_request = self.domain_last_request[domain]

            time_since_last = now - last_request
            wait_time = 0

            if time_since_last < self.rate_limit_ms:
                wait_time = (self.rate_limit_ms - time_since_last) / 1000  # 转换为秒
                time.sleep(wait_time)

            # 更新最后请求时间
            self.domain_last_request[domain] = time.time() * 1000

        return wait_time

    async def async_wait_for_domain(self, url: str) -> float:
        """
        异步版本：等待直到可以请求指定域名

        Args:
            url: 要请求的 URL

        Returns:
            实际等待的时间（秒）
        """
        domain = urlparse(url).hostname or "unknown"

        with self._lock:
            now = time.time() * 1000
            last_request = self.domain_last_request[domain]
            time_since_last = now - last_request

            if time_since_last < self.rate_limit_ms:
                wait_time = (self.rate_limit_ms - time_since_last) / 1000
                await asyncio.sleep(wait_time)
                self.domain_last_request[domain] = time.time() * 1000
                return wait_time

            self.domain_last_request[domain] = now
            return 0

    def clear_domain(self, url: str):
        """
        清除指定域名的限速记录

        Args:
            url: 目标 URL
        """
        domain = urlparse(url).hostname
        if domain:
            with self._lock:
                self.domain_last_request.pop(domain, None)


# 全局限速器实例
rate_limiter = DomainRateLimiter()
```

### RSS 刷新任务

创建 `backend/app/tasks/rss_tasks.py`：

```python
"""
RSS 订阅源刷新任务

Celery 任务，用于在后台刷新 RSS 订阅源。
匹配 BullMQ worker 的行为：限速、重试、状态更新、自动调度。
"""

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy.orm import Session
from sqlalchemy import and_
from app.database import SessionLocal
from app.services.rss_parser import parse_rss_feed
from app.core.rate_limiter import rate_limiter
from app.models.feed import Feed
from app.models.article import Article
from datetime import datetime, timezone
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# 可重试的网络错误
RETRYABLE_ERRORS = [
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "socket hang up",
    "Connection refused",
    "Connection timed out",
    "getaddrinfo",
]


def is_retryable_error(error: Exception) -> bool:
    """判断错误是否可重试"""
    error_str = str(error).lower()
    return any(err.lower() in error_str for err in RETRYABLE_ERRORS)


@shared_task(
    bind=True,
    name="app.tasks.rss_tasks.refresh_feed",
    autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3},
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    acks_late=True,
)
def refresh_feed_task(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int = 60,
) -> dict:
    """
    刷新单个 RSS 订阅源

    Args:
        self: Celery 任务实例（用于重试）
        feed_id: 订阅源 ID
        feed_url: 订阅源 URL
        feed_title: 订阅源标题
        user_id: 用户 ID
        refresh_interval: 刷新间隔（分钟）

    Returns:
        任务结果: { success, articleCount, duration, error? }
    """
    start_time = datetime.now(timezone.utc)
    db: Optional[Session] = None

    try:
        db = SessionLocal()

        # 1. 域名限速
        wait_time = rate_limiter.wait_for_domain(feed_url)
        if wait_time > 0:
            logger.debug(f"Rate limited: waited {wait_time:.2f}s for {feed_url}")

        # 2. 解析 RSS 订阅源
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            feed_info, articles = loop.run_until_complete(
                parse_rss_feed(feed_url, feed_id)
            )
        finally:
            loop.close()

        # 3. 保存文章（去重）
        new_article_count = 0
        for article_data in articles:
            # 检查是否已存在（通过 URL + user_id 去重）
            existing = db.query(Article).filter(
                and_(
                    Article.url == article_data["url"],
                    Article.user_id == user_id,
                )
            ).first()

            if not existing:
                db_article = Article(
                    id=article_data["id"],
                    feed_id=feed_id,
                    user_id=user_id,
                    title=article_data["title"],
                    content=article_data["content"],
                    summary=article_data.get("summary"),
                    url=article_data["url"],
                    author=article_data.get("author"),
                    published_at=article_data["publishedAt"],
                    is_read=False,
                    is_starred=False,
                    thumbnail=article_data.get("thumbnail"),
                    content_hash=article_data.get("contentHash"),
                )
                db.add(db_article)
                new_article_count += 1

        # 4. 更新订阅源状态
        feed = db.query(Feed).filter(
            and_(Feed.id == feed_id, Feed.user_id == user_id)
        ).first()

        if feed:
            feed.last_fetched = datetime.now(timezone.utc)
            feed.last_fetch_status = "success"
            feed.last_fetch_error = None
            feed.unread_count = feed.unread_count + new_article_count

        db.commit()

        # 5. 计算持续时间
        duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

        logger.info(
            f"Feed refreshed: {feed_title} | "
            f"New articles: {new_article_count} | "
            f"Duration: {duration:.0f}ms"
        )

        # 6. 调度下一次刷新
        schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {
            "success": True,
            "articleCount": new_article_count,
            "duration": duration,
        }

    except Exception as e:
        duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

        logger.error(
            f"Feed refresh failed: {feed_title} | "
            f"Error: {e} | "
            f"Duration: {duration:.0f}ms"
        )

        # 更新错误状态
        if db:
            try:
                feed = db.query(Feed).filter(Feed.id == feed_id).first()
                if feed:
                    feed.last_fetched = datetime.now(timezone.utc)
                    feed.last_fetch_status = "failed"
                    feed.last_fetch_error = str(e)[:500]  # 截断错误信息
                    db.commit()
            except Exception as update_error:
                logger.error(f"Failed to update feed status: {update_error}")
                db.rollback()

        # 判断是否应该重试
        if is_retryable_error(e):
            try:
                raise self.retry(exc=e)
            except MaxRetriesExceededError:
                logger.warning(f"Max retries exceeded for {feed_title}")
                # 即使重试耗尽，也调度下一次正常刷新
                schedule_next_refresh(feed_id, user_id, refresh_interval)
        else:
            # 不可重试的错误，直接调度下一次刷新
            schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {
            "success": False,
            "error": str(e),
            "duration": duration,
        }

    finally:
        if db:
            db.close()


def schedule_next_refresh(
    feed_id: str,
    user_id: str,
    interval_minutes: int,
) -> None:
    """
    调度下一次订阅源刷新

    Args:
        feed_id: 订阅源 ID
        user_id: 用户 ID
        interval_minutes: 刷新间隔（分钟）
    """
    db = SessionLocal()
    try:
        feed = db.query(Feed).filter(Feed.id == feed_id).first()
        if not feed:
            logger.warning(f"Feed not found for scheduling: {feed_id}")
            return

        delay_seconds = interval_minutes * 60

        # 调度下一次任务
        refresh_feed_task.apply_async(
            kwargs={
                "feed_id": feed_id,
                "feed_url": feed.url,
                "feed_title": feed.title,
                "user_id": user_id,
                "refresh_interval": interval_minutes,
            },
            countdown=delay_seconds,
            task_id=f"feed-{feed_id}",  # 使用固定 task_id 便于取消
        )

        logger.debug(
            f"Scheduled next refresh for {feed.title} in {delay_seconds}s"
        )

    finally:
        db.close()


@shared_task(name="app.tasks.rss_tasks.cancel_feed_refresh")
def cancel_feed_refresh(feed_id: str) -> dict:
    """
    取消订阅源的定时刷新

    Args:
        feed_id: 订阅源 ID

    Returns:
        { success: bool }
    """
    from app.tasks.celery_config import celery_app

    task_id = f"feed-{feed_id}"

    try:
        celery_app.control.revoke(task_id, terminate=True)
        logger.info(f"Cancelled refresh for feed: {feed_id}")
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to cancel refresh for feed {feed_id}: {e}")
        return {"success": False, "error": str(e)}
```

### 调度器 API 路由

创建 `backend/app/api/routers/scheduler.py`：

```python
"""
调度器 API 路由

提供 RSS 订阅源刷新调度的 API 端点。
匹配现有 Next.js 调度器端点的行为。
"""

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.scheduler import (
    ScheduleRequest, ScheduleResponse,
    CancelRequest, CancelResponse,
)
from app.dependencies import verify_jwt
from app.tasks.rss_tasks import refresh_feed_task
from app.tasks.celery_config import celery_app
from datetime import datetime, timezone
from typing import Tuple
import logging

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])
logger = logging.getLogger(__name__)


def calculate_refresh_delay(
    last_fetched: str | None,
    refresh_interval: int,
) -> int:
    """
    计算下次刷新的延迟时间（毫秒）

    匹配 TypeScript 实现: schedule/route.ts lines 68-77

    Args:
        last_fetched: 上次刷新时间（ISO 字符串）
        refresh_interval: 刷新间隔（分钟）

    Returns:
        延迟时间（毫秒）
    """
    now = datetime.now(timezone.utc).timestamp() * 1000

    if last_fetched:
        try:
            # 解析 ISO 时间字符串
            last_time = datetime.fromisoformat(
                last_fetched.replace("Z", "+00:00")
            ).timestamp() * 1000
        except ValueError:
            last_time = now
    else:
        last_time = now

    interval_ms = refresh_interval * 60 * 1000
    next_refresh = last_time + interval_ms

    return max(0, int(next_refresh - now))


def calculate_priority(
    last_fetched: str | None,
    refresh_interval: int,
    force_immediate: bool,
) -> Tuple[str, int]:
    """
    计算任务优先级

    优先级系统（匹配 BullMQ）:
    - manual (1): 用户手动刷新
    - overdue (2): 超过 2 倍刷新间隔
    - normal (5): 正常调度

    Args:
        last_fetched: 上次刷新时间
        refresh_interval: 刷新间隔（分钟）
        force_immediate: 是否立即刷新

    Returns:
        (优先级名称, 优先级数值)
    """
    if force_immediate:
        return ("manual", 1)

    delay = calculate_refresh_delay(last_fetched, refresh_interval)

    if delay == 0 and last_fetched:
        try:
            last_time = datetime.fromisoformat(
                last_fetched.replace("Z", "+00:00")
            ).timestamp() * 1000
            now = datetime.now(timezone.utc).timestamp() * 1000
            overdue_threshold = refresh_interval * 60 * 1000 * 2  # 2倍间隔

            if now - last_time > overdue_threshold:
                return ("overdue", 2)
        except ValueError:
            pass

    return ("normal", 5)


@router.post("/schedule", response_model=ScheduleResponse)
async def schedule_feed(
    request: ScheduleRequest,
    user=Depends(verify_jwt),
):
    """
    调度订阅源刷新

    创建或更新订阅源的定时刷新任务。

    Args:
        request: 包含 feed 信息和 forceImmediate 标志
        user: 已验证的用户

    Returns:
        ScheduleResponse: { success, delaySeconds, priority }
    """
    try:
        feed = request.feed

        # 计算延迟和优先级
        delay_ms = 0 if request.forceImmediate else calculate_refresh_delay(
            feed.lastFetched,
            feed.refreshInterval,
        )

        priority_name, priority_num = calculate_priority(
            feed.lastFetched,
            feed.refreshInterval,
            request.forceImmediate,
        )

        # 取消现有任务
        task_id = f"feed-{feed.id}"
        celery_app.control.revoke(task_id, terminate=True)

        # 创建新任务
        refresh_feed_task.apply_async(
            kwargs={
                "feed_id": str(feed.id),
                "feed_url": feed.url,
                "feed_title": feed.title,
                "user_id": str(user.user.id),
                "refresh_interval": feed.refreshInterval,
            },
            countdown=delay_ms / 1000,  # 转换为秒
            task_id=task_id,
            priority=priority_num,
        )

        delay_seconds = int(delay_ms / 1000)

        logger.info(
            f"Scheduled feed: {feed.title} | "
            f"Delay: {delay_seconds}s | "
            f"Priority: {priority_name}"
        )

        return ScheduleResponse(
            success=True,
            delaySeconds=delay_seconds,
            priority=priority_name,
        )

    except Exception as e:
        logger.error(f"Failed to schedule feed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to schedule feed refresh: {str(e)}",
        )


@router.post("/cancel", response_model=CancelResponse)
async def cancel_feed(
    request: CancelRequest,
    user=Depends(verify_jwt),
):
    """
    取消订阅源刷新

    取消指定订阅源的定时刷新任务。

    Args:
        request: 包含 feedId
        user: 已验证的用户

    Returns:
        CancelResponse: { success }
    """
    try:
        task_id = f"feed-{request.feedId}"
        celery_app.control.revoke(task_id, terminate=True)

        logger.info(f"Cancelled feed refresh: {request.feedId}")

        return CancelResponse(success=True)

    except Exception as e:
        logger.error(f"Failed to cancel feed refresh: {e}")
        # 匹配 Node.js 行为：即使失败也返回成功
        return CancelResponse(success=True)
```

### Celery Worker 入口

创建 `backend/celery_worker.py`：

```python
"""
Celery Worker 入口脚本

启动命令:
    celery -A celery_worker.celery_app worker --loglevel=info

带定时任务:
    celery -A celery_worker.celery_app worker --beat --loglevel=info
"""

from app.tasks.celery_config import celery_app

if __name__ == "__main__":
    celery_app.start()
```

## 运行命令

### 启动 Worker

```bash
cd backend

# 开发环境（带日志）
poetry run celery -A celery_worker.celery_app worker --loglevel=info

# 生产环境（后台运行）
poetry run celery -A celery_worker.celery_app worker --loglevel=warning --detach

# 带定时任务调度器
poetry run celery -A celery_worker.celery_app worker --beat --loglevel=info
```

### 监控命令

```bash
# 查看活跃任务
poetry run celery -A celery_worker.celery_app inspect active

# 查看已注册任务
poetry run celery -A celery_worker.celery_app inspect registered

# 查看队列状态
poetry run celery -A celery_worker.celery_app inspect stats

# 清除所有任务
poetry run celery -A celery_worker.celery_app purge
```

### 使用 Flower 监控（可选）

```bash
# 安装 Flower
poetry add flower

# 启动 Flower Web UI
poetry run celery -A celery_worker.celery_app flower --port=5555
```

访问 `http://localhost:5555` 查看任务监控面板。

## BullMQ vs Celery 对比

| 特性 | BullMQ (Node.js) | Celery (Python) |
|------|------------------|-----------------|
| 任务定义 | 函数回调 | 装饰器 `@shared_task` |
| 任务 ID | `jobId` 参数 | `task_id` 参数 |
| 延迟执行 | `delay` (毫秒) | `countdown` (秒) |
| 重试 | `attempts` + `backoff` | `autoretry_for` + `retry_backoff` |
| 取消任务 | `job.remove()` | `app.control.revoke()` |
| 优先级 | `priority` (1-10) | `priority` (0-9) |
| 监控 | Bull Board | Flower |

## 注意事项

1. **任务序列化**: Celery 默认使用 JSON，确保所有参数可序列化

2. **数据库连接**: 每个任务使用独立的数据库 session，避免连接泄漏

3. **异步转同步**: Celery worker 是同步的，需要用 `asyncio.run()` 调用异步函数

4. **任务幂等性**: 设计任务时考虑重复执行的情况

5. **内存管理**: 长时间运行的 worker 可能积累内存，考虑使用 `--max-tasks-per-child`

## 下一步

完成 Celery 配置后，继续：
- [前端集成与代理配置](./14-frontend-integration.md)

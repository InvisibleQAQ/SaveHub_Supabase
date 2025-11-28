# RSS 任务迁移到 FastAPI + Celery

## 概述

本文档详细说明如何将现有的 BullMQ RSS 刷新任务迁移到 FastAPI + Celery 架构。

**参考项目**: `reference_repository/nextjs-starter-template/backend` - 遵循其服务层和依赖注入模式。

### 迁移对照表

| BullMQ 文件 | Celery 对应 | 说明 |
|------------|-------------|------|
| `lib/queue/worker.ts` | `backend/app/tasks/rss_tasks.py` | 核心任务处理逻辑 |
| `lib/queue/rss-queue.ts` | `backend/app/core/celery_app.py` | 队列配置 |
| `lib/queue/rss-scheduler.ts` | `backend/app/api/routers/rss.py` | 调度逻辑 |
| `lib/queue/schemas.ts` | `backend/app/schemas/rss.py` | 数据验证 |
| `lib/scheduler-client.ts` | `lib/api/backend.ts` | 前端 API 客户端 |
| `app/api/scheduler/*` | FastAPI `/api/rss/*` | API 端点 |

---

## 第一步：Celery 配置

### celery_app.py

```python
# backend/app/core/celery_app.py

from celery import Celery
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "rss_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.rss_tasks"]
)

celery_app.conf.update(
    # 序列化配置
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",

    # 任务确认
    task_acks_late=True,  # 任务完成后再确认
    worker_prefetch_multiplier=1,  # 避免任务堆积

    # 并发配置 (匹配 BullMQ 的 CONCURRENCY = 5)
    worker_concurrency=5,

    # 结果过期
    result_expires=86400,  # 24小时

    # 默认重试配置 (匹配 BullMQ: 3次重试, 指数退避)
    task_default_retry_delay=2,  # 初始重试延迟 2秒
    task_max_retries=3,
)

# Celery Beat 配置 (可选，用于定时任务)
celery_app.conf.beat_schedule = {
    # 示例: 每小时清理过期结果
    # 'cleanup-expired-results': {
    #     'task': 'app.tasks.rss_tasks.cleanup_task',
    #     'schedule': 3600.0,
    # },
}
```

---

## 第二步：RSS Schemas (Pydantic)

```python
# backend/app/schemas/rss.py

from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field
from uuid import UUID


# ============================================
# 任务相关 Schemas
# ============================================

class RSSRefreshTask(BaseModel):
    """
    RSS 刷新任务负载。
    对应 BullMQ 的 RSSRefreshTaskSchema。
    """
    feed_id: str
    feed_url: str
    feed_title: str
    user_id: str
    last_fetched: Optional[str] = None  # ISO 格式时间戳
    refresh_interval: int = 60  # 分钟
    priority: Literal["manual", "overdue", "normal"] = "normal"


class TaskResult(BaseModel):
    """
    任务执行结果。
    对应 BullMQ 的 TaskResultSchema。
    """
    success: bool
    article_count: int = 0
    error: Optional[str] = None
    duration: int = 0  # 毫秒


# ============================================
# API 请求/响应 Schemas
# ============================================

class ScheduleFeedRequest(BaseModel):
    """调度 Feed 刷新请求"""
    feed_id: str
    feed_url: str
    feed_title: str
    refresh_interval: int = Field(default=60, ge=1, le=10080)
    last_fetched: Optional[str] = None
    force_immediate: bool = False


class ScheduleFeedResponse(BaseModel):
    """调度 Feed 刷新响应"""
    success: bool
    delay_seconds: int
    priority: str
    task_id: str


class CancelFeedRequest(BaseModel):
    """取消 Feed 刷新请求"""
    feed_id: str


class CancelFeedResponse(BaseModel):
    """取消 Feed 刷新响应"""
    success: bool
    feed_id: str


class ForceRefreshRequest(BaseModel):
    """强制刷新请求"""
    feed_id: str


class ForceRefreshResponse(BaseModel):
    """强制刷新响应"""
    success: bool
    feed_id: str
    task_id: str


class InitSchedulerResponse(BaseModel):
    """初始化调度器响应"""
    success: bool
    scheduled_count: int


class SchedulerStatsResponse(BaseModel):
    """调度器统计响应"""
    active_tasks: int
    scheduled_tasks: int
    completed_tasks: int
    failed_tasks: int
```

---

## 第三步：RSS Celery 任务

这是迁移的核心部分，需要将 `lib/queue/worker.ts` 的逻辑移植到 Python。

```python
# backend/app/tasks/rss_tasks.py

import time
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse

import feedparser
import httpx
from celery import shared_task
from celery.utils.log import get_task_logger

from app.core.celery_app import celery_app
from app.dependencies import get_supabase_admin_client

logger = get_task_logger(__name__)

# ============================================
# 域名速率限制 (匹配 BullMQ: RATE_LIMIT_MS = 1000)
# ============================================
_domain_last_request: Dict[str, float] = {}
RATE_LIMIT_SECONDS = 1.0


def _rate_limit_domain(domain: str) -> None:
    """
    域名级别速率限制，防止被目标服务器封禁。
    每个域名每秒最多 1 个请求。
    """
    now = time.time()
    last = _domain_last_request.get(domain, 0)

    if now - last < RATE_LIMIT_SECONDS:
        sleep_time = RATE_LIMIT_SECONDS - (now - last)
        logger.debug(f"Rate limiting {domain}, sleeping {sleep_time:.2f}s")
        time.sleep(sleep_time)

    _domain_last_request[domain] = time.time()


def _extract_domain(url: str) -> str:
    """从 URL 提取域名"""
    try:
        parsed = urlparse(url)
        return parsed.netloc or "unknown"
    except Exception:
        return "unknown"


# ============================================
# 文章转换 (移植自 worker.ts)
# ============================================

def _extract_thumbnail(entry: Dict[str, Any]) -> Optional[str]:
    """
    提取文章缩略图。
    优先级: media:thumbnail > media:content > enclosure
    """
    # media:thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        return entry.media_thumbnail[0].get('url')

    # media:content (查找图片类型)
    if hasattr(entry, 'media_content') and entry.media_content:
        for media in entry.media_content:
            media_type = media.get('type', '')
            if media_type.startswith('image'):
                return media.get('url')

    # enclosure (查找图片类型)
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            enc_type = enc.get('type', '')
            if enc_type.startswith('image'):
                return enc.get('href')

    return None


def _extract_content(entry: Dict[str, Any]) -> str:
    """
    提取文章内容。
    优先级: content > content:encoded > description > summary
    """
    # content 数组
    if hasattr(entry, 'content') and entry.content:
        return entry.content[0].get('value', '')

    # summary (feedparser 通常将 description 映射到这里)
    if hasattr(entry, 'summary') and entry.summary:
        return entry.summary

    # description
    if hasattr(entry, 'description') and entry.description:
        return entry.description

    return ''


def _extract_author(entry: Dict[str, Any]) -> Optional[str]:
    """提取作者信息"""
    return (
        entry.get('author') or
        entry.get('creator') or
        entry.get('dc_creator')
    )


def _transform_entry(
    entry: Dict[str, Any],
    feed_id: str,
    user_id: str
) -> Dict[str, Any]:
    """
    将 RSS entry 转换为 article 记录。
    对应 BullMQ worker.ts 中的转换逻辑。
    """
    # 发布时间处理
    published_at = None
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        try:
            published_at = datetime(*entry.published_parsed[:6]).isoformat()
        except Exception:
            pass

    if not published_at and hasattr(entry, 'updated_parsed') and entry.updated_parsed:
        try:
            published_at = datetime(*entry.updated_parsed[:6]).isoformat()
        except Exception:
            pass

    if not published_at:
        published_at = datetime.utcnow().isoformat()

    # 内容和摘要
    content = _extract_content(entry)
    summary = entry.get('summary', '')[:500] if entry.get('summary') else None

    return {
        "id": str(uuid.uuid4()),
        "feed_id": feed_id,
        "user_id": user_id,
        "title": entry.get('title', 'Untitled'),
        "content": content,
        "summary": summary,
        "url": entry.get('link', ''),
        "author": _extract_author(entry),
        "published_at": published_at,
        "is_read": False,
        "is_starred": False,
        "thumbnail": _extract_thumbnail(entry),
        "created_at": datetime.utcnow().isoformat()
    }


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=2,
    autoretry_for=(httpx.RequestError, httpx.TimeoutException),
    retry_backoff=True,
    retry_backoff_max=8,
)
def refresh_feed(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    last_fetched: Optional[str] = None,
    refresh_interval: int = 60,
    priority: str = "normal"
) -> Dict[str, Any]:
    """
    刷新 RSS Feed 并更新文章。

    这是主要的 Celery 任务，对应 BullMQ worker.ts 中的处理逻辑。

    Args:
        feed_id: Feed UUID
        feed_url: RSS feed URL
        feed_title: Feed 标题
        user_id: 用户 UUID
        last_fetched: 上次获取时间 (ISO 格式)
        refresh_interval: 刷新间隔 (分钟)
        priority: 优先级 (manual/overdue/normal)

    Returns:
        TaskResult 字典
    """
    start_time = time.time()
    logger.info(f"Starting RSS refresh for feed {feed_id} ({feed_title})")

    try:
        supabase = get_supabase_admin_client()

        # 1. 域名速率限制
        domain = _extract_domain(feed_url)
        _rate_limit_domain(domain)

        # 2. 获取并解析 RSS
        logger.debug(f"Fetching RSS from {feed_url}")

        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            response = client.get(feed_url)
            response.raise_for_status()

        feed = feedparser.parse(response.text)

        # 检查解析错误
        if feed.bozo and not feed.entries:
            error_msg = str(feed.bozo_exception) if feed.bozo_exception else "Unknown parse error"
            raise ValueError(f"Invalid RSS feed: {error_msg}")

        # 3. 转换文章
        articles = []
        for entry in feed.entries:
            try:
                article = _transform_entry(entry, feed_id, user_id)
                if article.get('url'):  # 必须有 URL
                    articles.append(article)
            except Exception as e:
                logger.warning(f"Failed to transform entry: {e}")
                continue

        logger.info(f"Parsed {len(articles)} articles from {feed_title}")

        # 4. Upsert 文章 (去重: url + user_id)
        if articles:
            result = supabase.table("articles").upsert(
                articles,
                on_conflict="url,user_id",
                ignore_duplicates=True
            ).execute()

            logger.debug(f"Upserted {len(articles)} articles")

        # 5. 更新 Feed 状态
        supabase.table("feeds").update({
            "last_fetched": datetime.utcnow().isoformat(),
            "last_fetch_status": "success",
            "last_fetch_error": None
        }).eq("id", feed_id).eq("user_id", user_id).execute()

        # 6. 调度下次刷新
        _schedule_next_refresh(
            feed_id=feed_id,
            feed_url=feed_url,
            feed_title=feed_title,
            user_id=user_id,
            refresh_interval=refresh_interval
        )

        duration = int((time.time() - start_time) * 1000)
        logger.info(f"RSS refresh completed for {feed_title}: {len(articles)} articles in {duration}ms")

        return {
            "success": True,
            "article_count": len(articles),
            "duration": duration
        }

    except Exception as e:
        duration = int((time.time() - start_time) * 1000)
        error_msg = str(e)[:500]

        logger.error(f"RSS refresh failed for {feed_title}: {error_msg}")

        # 更新 Feed 错误状态
        try:
            supabase = get_supabase_admin_client()
            supabase.table("feeds").update({
                "last_fetched": datetime.utcnow().isoformat(),
                "last_fetch_status": "failed",
                "last_fetch_error": error_msg
            }).eq("id", feed_id).eq("user_id", user_id).execute()
        except Exception as update_error:
            logger.error(f"Failed to update feed error status: {update_error}")

        # 即使失败也调度下次刷新 (用户可能会修复 URL)
        _schedule_next_refresh(
            feed_id=feed_id,
            feed_url=feed_url,
            feed_title=feed_title,
            user_id=user_id,
            refresh_interval=refresh_interval
        )

        # 根据错误类型决定是否重试
        if isinstance(e, (httpx.RequestError, httpx.TimeoutException)):
            # 网络错误: 让 Celery 自动重试
            raise

        # 解析错误等: 不重试，直接返回失败
        return {
            "success": False,
            "article_count": 0,
            "error": error_msg,
            "duration": duration
        }


def _schedule_next_refresh(
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int
) -> None:
    """
    调度下次 Feed 刷新。
    实现递归调度模式，确保 Feed 持续刷新。
    """
    delay_seconds = refresh_interval * 60  # 分钟转秒
    task_id = f"feed-{feed_id}"

    # 使用固定 task_id 确保每个 feed 只有一个待执行任务
    refresh_feed.apply_async(
        kwargs={
            "feed_id": feed_id,
            "feed_url": feed_url,
            "feed_title": feed_title,
            "user_id": user_id,
            "last_fetched": datetime.utcnow().isoformat(),
            "refresh_interval": refresh_interval,
            "priority": "normal"
        },
        countdown=delay_seconds,
        task_id=task_id
    )

    logger.debug(f"Scheduled next refresh for {feed_title} in {delay_seconds}s")


# ============================================
# 辅助任务
# ============================================

@celery_app.task
def batch_schedule_feeds(feeds: List[Dict[str, Any]], user_id: str) -> Dict[str, Any]:
    """
    批量调度多个 Feed 刷新。
    用于初始化调度器。
    """
    scheduled = 0

    for feed in feeds:
        try:
            # 计算延迟
            delay = _calculate_delay(
                last_fetched=feed.get("last_fetched"),
                refresh_interval=feed.get("refresh_interval", 60)
            )

            task_id = f"feed-{feed['id']}"

            refresh_feed.apply_async(
                kwargs={
                    "feed_id": feed["id"],
                    "feed_url": feed["url"],
                    "feed_title": feed["title"],
                    "user_id": user_id,
                    "last_fetched": feed.get("last_fetched"),
                    "refresh_interval": feed.get("refresh_interval", 60),
                    "priority": "normal"
                },
                countdown=delay,
                task_id=task_id
            )
            scheduled += 1

        except Exception as e:
            logger.error(f"Failed to schedule feed {feed.get('id')}: {e}")

    return {"scheduled_count": scheduled}


def _calculate_delay(
    last_fetched: Optional[str],
    refresh_interval: int
) -> int:
    """
    计算下次刷新延迟秒数。
    对应 BullMQ rss-scheduler.ts 的延迟计算逻辑。
    """
    if not last_fetched:
        return 0  # 从未获取，立即刷新

    try:
        last = datetime.fromisoformat(last_fetched.replace('Z', '+00:00'))
        next_refresh = last + timedelta(minutes=refresh_interval)
        now = datetime.utcnow().replace(tzinfo=last.tzinfo)

        delay = (next_refresh - now).total_seconds()
        return max(0, int(delay))

    except Exception:
        return 0  # 解析失败，立即刷新
```

---

## 第四步：RSS API 路由

参考 `nextjs-starter-template` 的路由模式，使用依赖注入：

```python
# backend/app/api/routers/rss.py

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.dependencies import get_user_id, get_supabase_admin_client
from app.database import get_db
from app.schemas.rss import (
    ScheduleFeedRequest, ScheduleFeedResponse,
    CancelFeedRequest, CancelFeedResponse,
    ForceRefreshRequest, ForceRefreshResponse,
    InitSchedulerResponse,
)
from app.tasks.rss_tasks import refresh_feed, batch_schedule_feeds
from app.core.celery_app import celery_app

router = APIRouter()


@router.post("/schedule", response_model=ScheduleFeedResponse)
async def schedule_feed(
    request: ScheduleFeedRequest,
    user_id: str = Depends(get_user_id)
):
    """
    调度 Feed 刷新任务。
    替代 Next.js /api/scheduler/schedule 端点。
    """
    # 计算延迟和优先级
    if request.force_immediate:
        delay_seconds = 0
        priority = "manual"
    elif request.last_fetched:
        delay_seconds, priority = _calculate_delay_and_priority(
            request.last_fetched,
            request.refresh_interval
        )
    else:
        delay_seconds = 0
        priority = "normal"

    # 取消现有任务 (如果存在)
    task_id = f"feed-{request.feed_id}"
    celery_app.control.revoke(task_id, terminate=True)

    # 调度新任务
    refresh_feed.apply_async(
        kwargs={
            "feed_id": request.feed_id,
            "feed_url": request.feed_url,
            "feed_title": request.feed_title,
            "user_id": user_id,
            "last_fetched": request.last_fetched,
            "refresh_interval": request.refresh_interval,
            "priority": priority
        },
        countdown=delay_seconds,
        task_id=task_id
    )

    return ScheduleFeedResponse(
        success=True,
        delay_seconds=delay_seconds,
        priority=priority,
        task_id=task_id
    )


@router.post("/cancel", response_model=CancelFeedResponse)
async def cancel_feed_schedule(
    request: CancelFeedRequest,
    user_id: str = Depends(get_user_id)
):
    """
    取消 Feed 的调度任务。
    """
    task_id = f"feed-{request.feed_id}"
    celery_app.control.revoke(task_id, terminate=True)

    return CancelFeedResponse(
        success=True,
        feed_id=request.feed_id
    )


@router.post("/force-refresh", response_model=ForceRefreshResponse)
async def force_refresh_feed(
    request: ForceRefreshRequest,
    user_id: str = Depends(get_user_id)
):
    """
    强制立即刷新 Feed。
    """
    supabase = get_supabase_admin_client()

    # 获取 Feed 信息
    result = supabase.table("feeds").select("*")\
        .eq("id", request.feed_id)\
        .eq("user_id", user_id)\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    feed = result.data
    task_id = f"feed-{request.feed_id}"

    # 取消现有任务
    celery_app.control.revoke(task_id, terminate=True)

    # 立即执行新任务
    refresh_feed.apply_async(
        kwargs={
            "feed_id": feed["id"],
            "feed_url": feed["url"],
            "feed_title": feed["title"],
            "user_id": user_id,
            "last_fetched": feed.get("last_fetched"),
            "refresh_interval": feed.get("refresh_interval", 60),
            "priority": "manual"
        },
        countdown=0,
        task_id=task_id
    )

    return ForceRefreshResponse(
        success=True,
        feed_id=request.feed_id,
        task_id=task_id
    )


@router.post("/init", response_model=InitSchedulerResponse)
async def initialize_scheduler(
    user_id: str = Depends(get_user_id)
):
    """
    初始化用户的所有 Feed 调度。
    替代 Next.js 的 initializeRSSScheduler()。
    """
    supabase = get_supabase_admin_client()

    # 获取用户所有 Feed
    result = supabase.table("feeds").select("*")\
        .eq("user_id", user_id)\
        .execute()

    feeds = result.data or []

    if not feeds:
        return InitSchedulerResponse(success=True, scheduled_count=0)

    # 调度所有 Feed
    scheduled = 0
    for feed in feeds:
        try:
            delay_seconds, priority = _calculate_delay_and_priority(
                feed.get("last_fetched"),
                feed.get("refresh_interval", 60)
            )

            task_id = f"feed-{feed['id']}"

            refresh_feed.apply_async(
                kwargs={
                    "feed_id": feed["id"],
                    "feed_url": feed["url"],
                    "feed_title": feed["title"],
                    "user_id": user_id,
                    "last_fetched": feed.get("last_fetched"),
                    "refresh_interval": feed.get("refresh_interval", 60),
                    "priority": priority
                },
                countdown=delay_seconds,
                task_id=task_id
            )
            scheduled += 1

        except Exception as e:
            print(f"Failed to schedule feed {feed.get('id')}: {e}")

    return InitSchedulerResponse(
        success=True,
        scheduled_count=scheduled
    )


def _calculate_delay_and_priority(
    last_fetched: Optional[str],
    refresh_interval: int
) -> tuple[int, str]:
    """
    计算延迟时间和优先级。
    对应 BullMQ rss-scheduler.ts 的逻辑。
    """
    if not last_fetched:
        return 0, "normal"

    try:
        last = datetime.fromisoformat(last_fetched.replace('Z', '+00:00'))
        next_refresh = last + timedelta(minutes=refresh_interval)
        now = datetime.utcnow().replace(tzinfo=last.tzinfo)

        delay_seconds = max(0, int((next_refresh - now).total_seconds()))

        # 检查是否过期 (超过 2 倍间隔)
        overdue_threshold = last + timedelta(minutes=refresh_interval * 2)
        if now > overdue_threshold:
            priority = "overdue"
        else:
            priority = "normal"

        return delay_seconds, priority

    except Exception:
        return 0, "normal"
```

---

## 第五步：启动 Celery Worker

### 命令

```bash
cd backend

# 进入虚拟环境
poetry shell

# 启动 Celery Worker
celery -A app.core.celery_app worker --loglevel=info

# 或指定并发数
celery -A app.core.celery_app worker --loglevel=info --concurrency=5

# 或直接使用 poetry run
poetry run celery -A app.core.celery_app worker --loglevel=info
```

### 可选：Flower 监控

```bash
# 安装 Flower (已在 pyproject.toml 中包含)
# 如果没有，运行: poetry add flower

# 启动 Flower
poetry run celery -A app.core.celery_app flower --port=5555
# 访问 http://localhost:5555 查看任务监控
```

---

## 第六步：更新 package.json 脚本

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:all": "concurrently -n next,fastapi,celery -c blue,yellow,green \"pnpm dev\" \"pnpm fastapi:dev\" \"pnpm celery:dev\"",
    "fastapi:dev": "cd backend && poetry run uvicorn app.main:app --reload --port 8000",
    "celery:dev": "cd backend && poetry run celery -A app.core.celery_app worker --loglevel=info",
    "celery:flower": "cd backend && poetry run celery -A app.core.celery_app flower --port=5555"
  }
}
```

---

## 迁移检查清单

### 功能对等验证

| 功能 | BullMQ | Celery | 状态 |
|------|--------|--------|------|
| 任务调度 | `queue.add()` | `task.apply_async()` | |
| 延迟执行 | `delay` 选项 | `countdown` 参数 | |
| 任务取消 | `job.remove()` | `revoke()` | |
| 重试机制 | `attempts: 3` | `max_retries=3` | |
| 指数退避 | `backoff: exponential` | `retry_backoff=True` | |
| 唯一任务 ID | `jobId` | `task_id` | |
| 并发控制 | `CONCURRENCY=5` | `worker_concurrency=5` | |
| 域名速率限制 | `RATE_LIMIT_MS=1000` | 自定义 `_rate_limit_domain()` | |
| 递归调度 | 在 `completed` 事件中 | 在任务末尾 | |

### 测试验证

1. **单个 Feed 刷新**
   ```bash
   curl -X POST http://localhost:8000/api/rss/force-refresh \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"feed_id": "FEED_UUID"}'
   ```

2. **初始化调度器**
   ```bash
   curl -X POST http://localhost:8000/api/rss/init \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **查看 Celery 任务**
   ```bash
   # 查看活跃任务
   poetry run celery -A app.core.celery_app inspect active

   # 查看已调度任务
   poetry run celery -A app.core.celery_app inspect scheduled
   ```

---

## 下一步

完成 RSS 迁移后，继续：

1. **[14-frontend-integration.md](./14-frontend-integration.md)** - 前端集成，移除 BullMQ
2. **[13-chat-implementation.md](./13-chat-implementation.md)** - Chat 功能实现

---

## 故障排除

### Redis 连接失败

```
[ERROR] celery.backends.redis: Error connecting to Redis
```

**解决**: 确保 Redis 服务运行中：
```bash
redis-server
# 或使用 Docker
docker run -d -p 6379:6379 redis
```

### 任务未执行

**检查**:
1. Worker 是否启动: `poetry run celery -A app.core.celery_app inspect ping`
2. 任务是否注册: `poetry run celery -A app.core.celery_app inspect registered`
3. 查看 Worker 日志

### 数据库连接失败

**检查**:
1. `DATABASE_URL` 格式是否正确
2. Supabase 是否允许外部连接
3. 防火墙设置

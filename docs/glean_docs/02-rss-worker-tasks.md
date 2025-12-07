# 后台任务与任务队列

本文档详细介绍 Glean 的后台 Worker 如何处理 RSS Feed 的定时更新。

## 技术栈

- **arq**: Python 异步任务队列框架
- **Redis**: 任务消息中间件
- **httpx**: 异步 HTTP 客户端

## Worker 配置

### 入口文件

**文件路径**: `backend/apps/worker/glean_worker/main.py`

```python
"""
Glean Worker - arq task queue entry point.

This module configures the arq worker with task functions,
cron jobs, and Redis connection settings.
"""

from typing import Any

from arq import cron
from arq.connections import RedisSettings

from glean_database.session import init_database

from .config import settings
from .tasks import bookmark_metadata, cleanup, feed_fetcher


async def startup(ctx: dict[str, Any]) -> None:
    """
    Worker startup handler.
    """
    print("=" * 60)
    print("Starting Glean Worker")
    init_database(settings.database_url)
    print("Database initialized")
    print("Registered task functions:")
    print("  - fetch_feed_task")
    print("  - fetch_all_feeds")
    print("  - cleanup_read_later")
    print("  - fetch_bookmark_metadata_task")
    print("Scheduled cron jobs:")
    print("  - scheduled_fetch (every 15 minutes: 0, 15, 30, 45)")
    print("  - scheduled_cleanup (hourly at minute 0)")
    print("=" * 60)


async def shutdown(ctx: dict[str, Any]) -> None:
    """Worker shutdown handler."""
    print("Shutting down Glean Worker")


class WorkerSettings:
    """
    arq Worker configuration.
    """

    # 注册的任务函数
    functions = [
        feed_fetcher.fetch_feed_task,
        feed_fetcher.fetch_all_feeds,
        cleanup.cleanup_read_later,
        bookmark_metadata.fetch_bookmark_metadata_task,
    ]

    # 定时 Cron 任务
    cron_jobs = [
        # Feed 拉取 (每 15 分钟)
        cron(feed_fetcher.scheduled_fetch, minute={0, 15, 30, 45}),
        # Read-later 清理 (每小时整点)
        cron(cleanup.scheduled_cleanup, minute=0),
    ]

    # 生命周期钩子
    on_startup = startup
    on_shutdown = shutdown

    # Redis 连接
    redis_settings = RedisSettings.from_dsn(settings.redis_url)

    # Worker 参数
    max_jobs = 20        # 最大并发任务数
    job_timeout = 300    # 单任务超时 (5分钟)
    keep_result = 3600   # 结果保留时间 (1小时)
```

### 配置项说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_jobs` | 20 | Worker 最大并发处理任务数 |
| `job_timeout` | 300 秒 | 单个任务最长执行时间 |
| `keep_result` | 3600 秒 | 任务结果在 Redis 中保留时长 |
| Cron: Feed 拉取 | 每 15 分钟 | minute={0, 15, 30, 45} |
| Cron: 清理任务 | 每小时 | minute=0 |

### 环境配置

**文件路径**: `backend/apps/worker/glean_worker/config.py`

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://glean:changeme@localhost:5432/glean"
    redis_url: str = "redis://localhost:6379/0"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

## Feed 拉取任务

### 任务调用链

```
Cron (每15分钟)
    │
    ▼
scheduled_fetch(ctx)
    │
    ▼
fetch_all_feeds(ctx)
    │ 查询需要拉取的 Feed
    │
    ▼
enqueue_job("fetch_feed_task", feed_id)  ─► 入队到 Redis
    │
    ▼
fetch_feed_task(ctx, feed_id)
    │ 独立执行，处理单个 Feed
    │
    ▼
返回结果
```

### 核心代码

**文件路径**: `backend/apps/worker/glean_worker/tasks/feed_fetcher.py`

#### 1. 定时入口

```python
async def scheduled_fetch(ctx: dict[str, Any]) -> dict[str, int]:
    """
    Scheduled task to fetch all feeds (runs every 15 minutes).
    """
    print("[scheduled_fetch] Running scheduled feed fetch (every 15 minutes)")
    return await fetch_all_feeds(ctx)
```

#### 2. 查询并分发任务

```python
async def fetch_all_feeds(ctx: dict[str, Any]) -> dict[str, int]:
    """
    Fetch all active feeds.
    """
    print("[fetch_all_feeds] Starting to fetch all active feeds")
    async for session in get_session():
        # 查询所有需要拉取的 Feed
        now = datetime.now(UTC)
        stmt = select(Feed).where(
            Feed.status == FeedStatus.ACTIVE,
            (Feed.next_fetch_at.is_(None)) | (Feed.next_fetch_at <= now),
        )
        result = await session.execute(stmt)
        feeds = result.scalars().all()

        print(f"[fetch_all_feeds] Found {len(feeds)} feeds to fetch")

        # 为每个 Feed 入队独立任务
        for feed in feeds:
            print(f"[fetch_all_feeds] Queueing feed: {feed.url} (ID: {feed.id})")
            await ctx["redis"].enqueue_job("fetch_feed_task", feed.id)

        return {"feeds_queued": len(feeds)}

    return {"feeds_queued": 0}
```

#### 3. 单个 Feed 拉取任务

```python
from arq import Retry
from glean_rss import fetch_feed, parse_feed


async def fetch_feed_task(ctx: dict[str, Any], feed_id: str) -> dict[str, str | int]:
    """
    Fetch and parse a single RSS feed.
    """
    print(f"[fetch_feed_task] Starting fetch for feed_id: {feed_id}")
    async for session in get_session():
        try:
            # 1. 从数据库获取 Feed
            stmt = select(Feed).where(Feed.id == feed_id)
            result = await session.execute(stmt)
            feed = result.scalar_one_or_none()

            if not feed:
                return {"status": "error", "message": "Feed not found"}

            # 2. HTTP 请求 (带条件头)
            fetch_result = await fetch_feed(feed.url, feed.etag, feed.last_modified)

            if fetch_result is None:
                # 304 Not Modified
                feed.last_fetched_at = datetime.now(UTC)
                await session.commit()
                return {"status": "not_modified", "new_entries": 0}

            content, cache_headers = fetch_result

            # 3. 解析 RSS 内容
            parsed_feed = await parse_feed(content, feed.url)

            # 4. 更新 Feed 元数据
            feed.title = parsed_feed.title or feed.title
            feed.description = parsed_feed.description or feed.description
            feed.site_url = parsed_feed.site_url or feed.site_url
            feed.language = parsed_feed.language or feed.language
            feed.icon_url = parsed_feed.icon_url or feed.icon_url
            feed.status = FeedStatus.ACTIVE
            feed.error_count = 0
            feed.fetch_error_message = None
            feed.last_fetched_at = datetime.now(UTC)

            # 5. 更新缓存头
            if cache_headers and "etag" in cache_headers:
                feed.etag = cache_headers["etag"]
            if cache_headers and "last-modified" in cache_headers:
                feed.last_modified = cache_headers["last-modified"]

            # 6. 处理文章条目
            new_entries = 0
            latest_entry_time = feed.last_entry_at

            for parsed_entry in parsed_feed.entries:
                # 按 GUID 检查是否已存在
                stmt = select(Entry).where(
                    Entry.feed_id == feed.id, Entry.guid == parsed_entry.guid
                )
                result = await session.execute(stmt)
                existing_entry = result.scalar_one_or_none()

                if existing_entry:
                    continue

                # 创建新条目
                entry = Entry(
                    feed_id=feed.id,
                    guid=parsed_entry.guid,
                    url=parsed_entry.url,
                    title=parsed_entry.title,
                    author=parsed_entry.author,
                    content=parsed_entry.content,
                    summary=parsed_entry.summary,
                    published_at=parsed_entry.published_at,
                )
                session.add(entry)
                new_entries += 1

                # 记录最新条目时间
                if parsed_entry.published_at and (
                    latest_entry_time is None or parsed_entry.published_at > latest_entry_time
                ):
                    latest_entry_time = parsed_entry.published_at

            # 7. 更新下次拉取时间
            if latest_entry_time:
                feed.last_entry_at = latest_entry_time
            feed.next_fetch_at = datetime.now(UTC) + timedelta(minutes=15)

            await session.commit()

            return {
                "status": "success",
                "feed_id": feed_id,
                "new_entries": new_entries,
                "total_entries": len(parsed_feed.entries),
            }

        except Exception as e:
            # 错误处理 (见下文)
            ...
```

## 错误处理与重试

### 错误处理逻辑

```python
except Exception as e:
    print(f"[fetch_feed_task] ERROR: {type(e).__name__}: {str(e)}")

    # 更新 Feed 错误状态
    stmt = select(Feed).where(Feed.id == feed_id)
    result = await session.execute(stmt)
    feed = result.scalar_one_or_none()

    if feed:
        feed.error_count += 1
        feed.fetch_error_message = str(e)
        feed.last_fetched_at = datetime.now(UTC)

        # 连续 10 次失败后禁用 Feed
        if feed.error_count >= 10:
            print(f"[fetch_feed_task] DISABLED: Feed disabled after 10 errors")
            feed.status = FeedStatus.ERROR

        # 指数退避重试间隔
        # 15 → 30 → 60 → 60 → 60 ... (最大 60 分钟)
        retry_minutes = min(60, 15 * (2 ** min(feed.error_count - 1, 5)))
        feed.next_fetch_at = datetime.now(UTC) + timedelta(minutes=retry_minutes)

        await session.commit()

    # 通过 arq 的 Retry 机制在 5 分钟后重试
    raise Retry(defer=timedelta(minutes=5)) from None
```

### 重试策略

| 失败次数 | next_fetch_at 延迟 | 任务重试 |
|----------|-------------------|---------|
| 1 | 15 分钟 | 5 分钟后 |
| 2 | 30 分钟 | 5 分钟后 |
| 3 | 60 分钟 | 5 分钟后 |
| 4-9 | 60 分钟 | 5 分钟后 |
| 10+ | Feed 禁用 | 不再拉取 |

## 启动 Worker

```bash
# 进入 backend 目录
cd backend

# 使用 uv 运行 Worker
uv run arq glean_worker.main.WorkerSettings

# 或通过 Makefile
make worker
```

## 依赖关系

**文件路径**: `backend/apps/worker/pyproject.toml`

```toml
[project]
name = "glean-worker"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    "arq>=0.25.0",           # 任务队列
    "httpx>=0.27.0",         # HTTP 客户端
    "structlog>=24.1.0",     # 日志
    "pydantic-settings>=2.2.0",  # 配置管理
    "glean-database",        # 数据库模型
    "glean-rss",             # RSS 解析
]

[tool.uv.sources]
glean-database = { workspace = true }
glean-rss = { workspace = true }
```

## 相关文档

- [系统概述](./01-rss-overview.md)
- [RSS 解析模块](./03-rss-parsing.md)
- [数据库模型](./04-rss-database.md)

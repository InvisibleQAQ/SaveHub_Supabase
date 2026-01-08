# Celery App Module

Background task processing using Celery with Redis as broker/backend.

## Two Task Chain Modes

### Mode 1: New Feed (Single Feed Chain)

When a new RSS Feed is added via `POST /feeds`:

```
POST /feeds (auto-trigger)
    |
    v
refresh_feed (parse RSS, save articles)
    |
    v
schedule_image_processing (Celery chord)
    |
    +---> [parallel] process_article_images x N
    |                      |
    v                      v
    +<---- chord waits for all ----+
    |
    v
on_images_complete (callback)
    |
    v
schedule_rag_for_articles
    |
    v
[staggered] process_article_rag x N
```

### Mode 2: Scheduled Batch (Global Ordering)

Celery Beat scans feeds every minute and triggers batch refresh with global ordering:

```
Celery Beat (every minute)
    |
    v
scan_due_feeds
    | filter: last_fetched + refresh_interval < now
    | group by user_id
    v
schedule_user_batch_refresh (per user)
    |
    v
Chord 1: [refresh_feed_batch x N feeds] (parallel)
    |      uses batch_mode=True (no image scheduling)
    v      collects all article_ids
on_user_feeds_complete
    |
    v
Chord 2: schedule_batch_image_processing
    |
    +---> [parallel] process_article_images x M articles
    |                      |
    v                      v
    +<---- chord waits for all ----+
    |
    v
on_batch_images_complete
    |
    v
schedule_rag_for_articles (reuse existing)
    |
    v
[staggered] process_article_rag x M
```

**Key Difference**: Mode 2 waits for ALL feeds to complete before starting ANY image processing, then waits for ALL images to complete before starting ANY RAG processing.

## Key Files

| File | Purpose |
|------|---------|
| `celery.py` | Celery app configuration, beat_schedule |
| `task_utils.py` | **Shared utilities**: unified error hierarchy, `TaskContext`, `build_task_result` |
| `tasks.py` | Feed refresh tasks, batch scheduling orchestration |
| `image_processor.py` | Image processing tasks (single + batch) |
| `rag_processor.py` | RAG embedding tasks |
| `repo_extractor.py` | GitHub repo extraction from articles |
| `repository_tasks.py` | GitHub starred repo sync + AI analysis |
| `task_lock.py` | Redis-based task locking (prevent duplicates) |
| `rate_limiter.py` | Domain-based rate limiting for RSS fetches |
| `supabase_client.py` | Service-role Supabase client (bypasses RLS) |
| `async_utils.py` | Async-to-sync bridge (`run_async`) for Celery tasks |

## Shared Task Utilities (`task_utils.py`)

All Celery tasks use shared utilities from `task_utils.py` for consistent error handling and logging.

### Unified Error Hierarchy

```python
TaskError (base)
├── RetryableError          # Triggers task retry
│   ├── RetryableFeedError
│   ├── RetryableImageError
│   ├── EmbeddingError
│   └── RateLimitError
└── NonRetryableError       # No retry, return failure
    ├── NonRetryableFeedError
    ├── NonRetryableImageError
    ├── ConfigError
    └── ChunkingError
```

### TaskContext Usage

```python
from .task_utils import task_context, build_task_result, NonRetryableImageError

@app.task(bind=True, name="my_task")
def my_task(self, article_id: str):
    with task_context(self, article_id=article_id) as ctx:
        ctx.log_start("Processing article")

        try:
            result = do_work(article_id)
            ctx.log_success(f"Completed: {result['count']} items")
            return build_task_result(ctx, success=True, **result)

        except NonRetryableImageError as e:
            ctx.log_error(e)
            return build_task_result(ctx, success=False, error=str(e))

        except Exception as e:
            ctx.log_exception(e)
            return build_task_result(ctx, success=False, error=str(e))
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `task_context(task, **extra)` | Context manager for task execution (timing, logging) |
| `build_task_result(ctx, success, **kwargs)` | Build standardized result dict with `duration_ms` |
| `is_retryable(error)` | Check if error should trigger retry |
| `is_retryable_message(msg)` | Check error message for retryable patterns |

## Task Reference

### tasks.py

| Task | Mode | Description |
|------|------|-------------|
| `refresh_feed` | Single | Refresh one feed, trigger image chain, schedule next |
| `refresh_feed_batch` | Batch | Refresh one feed with `batch_mode=True`, no chaining |
| `scan_due_feeds` | Beat | Scan feeds due for refresh, group by user |
| `schedule_user_batch_refresh` | Batch | Create chord for user's feeds |
| `on_user_feeds_complete` | Batch | Chord callback, collect article_ids, trigger images |

### image_processor.py

| Task | Mode | Description |
|------|------|-------------|
| `process_article_images` | Both | Process single article's images |
| `schedule_image_processing` | Single | Create chord with feed_id, callback to RAG |
| `schedule_batch_image_processing` | Batch | Create chord with user_id, callback to RAG |
| `on_batch_images_complete` | Batch | Chord callback, trigger RAG processing |

### rag_processor.py

| Task | Mode | Description |
|------|------|-------------|
| `process_article_rag` | Both | Generate embeddings for one article |
| `on_images_complete` | Single | Chord callback from single feed chain |
| `schedule_rag_for_articles` | Both | Schedule RAG tasks with staggered delays |
| `scan_pending_rag_articles` | Fallback | Beat task, scan missed articles |

### repo_extractor.py

| Task | Mode | Description |
|------|------|-------------|
| `extract_article_repos` | Both | Extract GitHub repos from article, auto-triggers `sync_repositories` |
| `schedule_repo_extraction_for_articles` | Both | Schedule extraction for batch of articles |
| `scan_pending_repo_extraction` | Fallback | Beat task, scan missed extractions |

### repository_tasks.py

| Task | Mode | Description |
|------|------|-------------|
| `sync_repositories` | Both | Sync GitHub starred repos + fill README for starred & extracted repos + AI analysis |

## Beat Schedule

| Task | Schedule | Purpose |
|------|----------|---------|
| `scan_due_feeds` | Every minute | Trigger batch refresh for due feeds |
| `scan_pending_rag_articles` | Every 30 min | Fallback for missed RAG processing |

## Error Handling

- Single feed/article failure does NOT block the chain
- All tasks return `{"success": bool, ...}` instead of raising exceptions
- `scan_pending_rag_articles` runs every 30min as fallback for missed articles

## Conflict Prevention

1. **Feed-level lock**: `refresh_feed` and `refresh_feed_batch` share same lock key `feed:{feed_id}`
2. **Beat overlap lock**: `scan_due_feeds` uses lock with 55s TTL
3. **New feed handling**: `POST /feeds` sets `last_fetched = now` before scheduling, preventing Beat re-trigger
4. **Deleted feed handling**: Tasks check if feed exists before refresh; if deleted, skip with `feed_deleted` and terminate chain (tasks.py:286-302, 671-680)

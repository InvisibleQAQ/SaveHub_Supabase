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
| `tasks.py` | Feed refresh tasks, batch scheduling orchestration |
| `image_processor.py` | Image processing tasks (single + batch) |
| `rag_processor.py` | RAG embedding tasks |
| `task_lock.py` | Redis-based task locking (prevent duplicates) |
| `rate_limiter.py` | Domain-based rate limiting for RSS fetches |
| `supabase_client.py` | Service-role Supabase client (bypasses RLS) |

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
| `sync_repositories` | Both | Sync GitHub starred repos + fill README + AI analysis |

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

# Celery App Module

Background task processing using Celery with Redis as broker/backend.

## Task Chain Architecture

When a new RSS Feed is added, tasks execute in sequence:

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

## Key Files

| File | Purpose |
|------|---------|
| `celery.py` | Celery app configuration |
| `tasks.py` | Feed refresh tasks (`refresh_feed`, `schedule_next_refresh`) |
| `image_processor.py` | Image download/compress/upload (`process_article_images`, `schedule_image_processing`) |
| `rag_processor.py` | RAG embedding tasks (`process_article_rag`, `on_images_complete`, `schedule_rag_for_articles`) |
| `task_lock.py` | Redis-based task locking (prevent duplicates) |
| `rate_limiter.py` | Domain-based rate limiting for RSS fetches |
| `supabase_client.py` | Service-role Supabase client (bypasses RLS) |

## Task Chain Implementation

**Celery Chord Pattern** (in `image_processor.py:schedule_image_processing`):
```python
chord(
    group(process_article_images.s(article_id=aid) for aid in article_ids)
)(
    on_images_complete.s(article_ids=article_ids, feed_id=feed_id)
)
```

- All image tasks run in parallel
- Callback (`on_images_complete`) executes only after ALL complete
- Tasks return `{"success": bool, ...}` instead of raising exceptions to ensure callback fires

## Error Handling

- Single article failure does NOT block the chain
- Image/RAG tasks catch all exceptions and return `{"success": False, "error": "..."}`
- `scan_pending_rag_articles` runs every 30min as fallback for missed articles

## Queues

| Queue | Priority | Used By |
|-------|----------|---------|
| `high` | High | New feed refresh, manual refresh |
| `default` | Normal | Scheduled refresh, image/RAG processing |

## Adding New Tasks

1. Define in appropriate file (`tasks.py`, `image_processor.py`, or `rag_processor.py`)
2. Use `@app.task` decorator with appropriate settings
3. Return dict result (don't raise exceptions if part of a chord)
4. Add to `__init__.py` exports if needed externally

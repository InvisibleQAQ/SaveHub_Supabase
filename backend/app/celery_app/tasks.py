"""
RSS refresh Celery tasks.

Design principles:
1. Single task + parameter for priority (not two separate tasks)
2. Core logic extracted for testability
3. Correct timezone handling (UTC)
4. Redis lock for true deduplication
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
# Core business logic (decoupled from Celery for unit testing)
# =============================================================================

class FeedRefreshError(Exception):
    """Base error for feed refresh."""
    pass


class RetryableError(FeedRefreshError):
    """Retryable error (network issues, rate limits)."""
    pass


class NonRetryableError(FeedRefreshError):
    """Non-retryable error (invalid feed, parse errors)."""
    pass


def is_retryable_error(error_msg: str) -> bool:
    """Determine if an error should be retried."""
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
    Core feed refresh logic.

    Completely decoupled from Celery for unit testing.

    Returns:
        {"success": True, "article_count": N}
        or raises FeedRefreshError
    """
    # Import here to avoid circular imports
    from app.services.rss_parser import parse_rss_feed

    supabase = get_supabase_service()
    rate_limiter = get_rate_limiter()

    # 1. Domain rate limiting
    try:
        waited = rate_limiter.wait_for_domain(feed_url, max_wait_seconds=30)
        if waited > 0:
            logger.debug(f"Rate limited, waited {waited:.2f}s for {feed_url}")
    except TimeoutError as e:
        raise RetryableError(str(e))

    # 2. Parse RSS feed
    try:
        # Note: existing rss_parser.py requires feed_id parameter
        result = parse_rss_feed(feed_url, feed_id)
        articles = result.get("articles", [])
    except Exception as e:
        error_msg = str(e)
        if is_retryable_error(error_msg):
            raise RetryableError(error_msg)
        else:
            raise NonRetryableError(error_msg)

    # 3. Save articles to database
    if articles:
        db_articles = []
        for article in articles:
            # Map camelCase fields from rss_parser.py to snake_case for database
            published_at = article.get("publishedAt")
            if isinstance(published_at, datetime):
                published_at = published_at.isoformat()

            db_articles.append({
                "id": article.get("id") or str(uuid4()),
                "feed_id": feed_id,  # Use parameter, not article's feedId
                "user_id": user_id,
                "title": article.get("title", "Untitled")[:500],
                "content": article.get("content", ""),
                "summary": article.get("summary", "")[:1000] if article.get("summary") else "",
                "url": article.get("url", ""),
                "author": article.get("author"),
                "published_at": published_at,
                "is_read": False,
                "is_starred": False,
                "thumbnail": article.get("thumbnail"),
            })

        # Upsert (dedupe by url + user_id)
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
    """Update feed status after refresh attempt."""
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
# Celery tasks
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
    time_limit=120,      # Hard timeout 2 minutes
    soft_time_limit=90,  # Soft timeout 1.5 minutes
)
def refresh_feed(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int,
    priority: str = "normal",
    skip_lock: bool = False,  # Skip lock check on retry
):
    """
    Refresh a single RSS feed.

    Args:
        feed_id: Feed UUID
        feed_url: RSS URL
        feed_title: Display name
        user_id: User UUID
        refresh_interval: Refresh interval in minutes
        priority: Priority level (manual/overdue/normal)
        skip_lock: Skip lock check (used during retries)
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

    # Check task lock (prevent duplicate execution)
    if not skip_lock:
        # Lock TTL should be longer than task timeout
        lock_ttl = 180  # 3 minutes
        if not task_lock.acquire(lock_key, lock_ttl, task_id):
            remaining = task_lock.get_ttl(lock_key)
            logger.info(
                f"[{task_id}] Feed {feed_id} already being processed, "
                f"lock expires in {remaining}s"
            )
            # Don't retry, just reject
            raise Reject(f"Feed {feed_id} is locked", requeue=False)

    try:
        # Execute refresh
        result = do_refresh_feed(feed_id, feed_url, user_id)

        # Update status
        update_feed_status(feed_id, user_id, "success")

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            f"[{task_id}] Completed: {feed_title}, "
            f"articles={result['article_count']}, duration={duration_ms}ms"
        )

        # Schedule next refresh
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

        # Retry with skip_lock=True since we already hold the lock
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

        # Still schedule next refresh
        schedule_next_refresh(feed_id, user_id, refresh_interval)

        return {
            "success": False,
            "feed_id": feed_id,
            "error": str(e),
            "duration_ms": duration_ms
        }

    except Exception as e:
        # Unexpected error
        logger.exception(f"[{task_id}] Unexpected error: {feed_title}")
        update_feed_status(feed_id, user_id, "failed", str(e))
        raise

    finally:
        # Release lock
        if not skip_lock:
            task_lock.release(lock_key, task_id)


def schedule_next_refresh(feed_id: str, user_id: str, refresh_interval: int):
    """
    Schedule next refresh.

    Uses countdown instead of ETA because ETA tasks are lost on worker restart.
    """
    delay_seconds = refresh_interval * 60
    task_lock = get_task_lock()

    # Check if there's already a pending schedule (use separate lock)
    schedule_lock_key = f"schedule:{feed_id}"

    # Schedule lock TTL should be close to delay_seconds
    schedule_lock_ttl = min(delay_seconds, 3600)  # Max 1 hour

    if not task_lock.acquire(schedule_lock_key, schedule_lock_ttl):
        logger.debug(f"Feed {feed_id} already has scheduled refresh")
        return

    try:
        supabase = get_supabase_service()

        # Get latest feed data
        result = supabase.table("feeds").select(
            "id, url, title, refresh_interval, user_id"
        ).eq("id", feed_id).eq("user_id", user_id).single().execute()

        if not result.data:
            logger.warning(f"Feed {feed_id} not found, skipping reschedule")
            return

        feed = result.data

        # Schedule task
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
        # Release schedule lock to allow retry
        task_lock.release(schedule_lock_key)


# =============================================================================
# Batch scheduling tasks
# =============================================================================

@app.task(name="schedule_feeds_batch")
def schedule_feeds_batch(feed_ids: list, user_id: str = None):
    """
    Batch schedule a group of feeds.

    Called by schedule_all_feeds in batches.
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
        # Calculate delay
        last_fetched = None
        if feed.get("last_fetched"):
            last_fetched = datetime.fromisoformat(
                feed["last_fetched"].replace("Z", "+00:00")
            )

        if last_fetched:
            next_refresh = last_fetched + timedelta(minutes=feed["refresh_interval"])
            delay_seconds = max(0, (next_refresh - now).total_seconds())
        else:
            # Never fetched, add random delay to avoid thundering herd
            import random
            delay_seconds = random.uniform(0, 60)

        # Schedule
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
    Schedule refresh tasks for all feeds.

    Processes in batches to avoid task storm.

    Args:
        batch_size: Number of feeds per batch
    """
    supabase = get_supabase_service()

    # Get all feed IDs
    result = supabase.table("feeds").select("id").execute()

    if not result.data:
        logger.info("No feeds to schedule")
        return {"total": 0, "batches": 0}

    feed_ids = [f["id"] for f in result.data]
    total = len(feed_ids)

    # Schedule in batches
    batches = 0
    for i in range(0, total, batch_size):
        batch = feed_ids[i:i + batch_size]
        # Add delay between batches to avoid creating too many tasks at once
        schedule_feeds_batch.apply_async(
            args=[batch],
            countdown=batches * 5  # 5 seconds between batches
        )
        batches += 1

    logger.info(f"Scheduled {total} feeds in {batches} batches")
    return {"total": total, "batches": batches}

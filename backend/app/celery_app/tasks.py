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
from urllib.parse import urlparse
from uuid import uuid4

from celery import shared_task
from celery.exceptions import Reject

from .celery import app
from .rate_limiter import get_rate_limiter
from ..schemas.feeds import _validate_image_url
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
    Core feed refresh logic: parse RSS + save articles.

    Image scheduling and full-text fetch are handled by callers.

    Args:
        feed_id: Feed UUID
        feed_url: RSS URL
        user_id: User UUID

    Returns:
        {"success": True, "article_count": N, "article_ids": [...]}
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

    # 2.5 Extract feed_image for caller to merge into status update
    feed_image = _validate_image_url(result.get("feed", {}).get("image"))
    if not feed_image:
        try:
            hostname = urlparse(feed_url).hostname
            if hostname:
                feed_image = f"https://www.google.com/s2/favicons?domain={hostname}&sz=32"
        except Exception as exc:
            logger.debug("Failed to build favicon URL for %s: %s", feed_url, exc)

    # 2.6 Transfer feed image to Supabase Storage (skip if already transferred)
    if feed_image:
        # Check DB: if current feed_image is already a Supabase URL, skip transfer
        current = supabase.table("feeds").select("feed_image").eq(
            "id", feed_id
        ).eq("user_id", user_id).maybe_single().execute()
        current_image = (current.data or {}).get("feed_image") or ""
        if "supabase.co/storage" not in current_image:
            from .image_processor import transfer_feed_image
            transferred = transfer_feed_image(feed_image, user_id, feed_id)
            if transferred:
                feed_image = transferred
        else:
            feed_image = current_image

    # 3. Save articles to database
    logger.info(f"[IMAGE_DEBUG] Parsed {len(articles)} articles from feed {feed_id}")
    if articles:
        # Collect all article URLs for batch query
        article_urls = [a.get("url", "") for a in articles if a.get("url")]

        # Query ALL existing articles to get their IDs and processing status
        # CRITICAL: Must reuse existing IDs to avoid FK violations with all_embeddings
        existing_articles = {}  # url -> {"id": ..., "images_processed": ...}
        if article_urls:
            existing_result = supabase.table("articles").select(
                "id, url, images_processed"
            ).eq("feed_id", feed_id).in_(
                "url", article_urls
            ).execute()

            for a in (existing_result.data or []):
                existing_articles[a["url"]] = {
                    "id": a["id"],
                    "images_processed": a.get("images_processed", False)
                }

        # Build articles to upsert (skip successfully processed ones)
        articles_to_upsert = []
        for article in articles:
            url = article.get("url", "")

            existing = existing_articles.get(url)
            if existing and existing["images_processed"]:
                # Successfully processed article: skip to protect replaced content
                logger.debug(f"Skipping successfully processed article: {url[:80]}")
                continue

            # Reuse existing ID if article exists, otherwise generate new one
            # This prevents FK violations when all_embeddings references the old ID
            article_id = existing["id"] if existing else (article.get("id") or str(uuid4()))

            published_at = article.get("publishedAt")
            if isinstance(published_at, datetime):
                published_at = published_at.isoformat()

            articles_to_upsert.append({
                "id": article_id,
                "feed_id": feed_id,
                "user_id": user_id,
                "title": article.get("title", "Untitled")[:500],
                "content": article.get("content", ""),
                "summary": article.get("summary", "")[:1000] if article.get("summary") else "",
                "url": url,
                "author": article.get("author"),
                "published_at": published_at,
                "is_read": False,
                "is_starred": False,
                "thumbnail": article.get("thumbnail"),
            })

        # Upsert new, unprocessed, or failed articles
        # CRITICAL: Use on_conflict="id" to prevent FK violations with all_embeddings
        # Using "feed_id,url" causes PostgreSQL to UPDATE the id field when URL matching
        # fails, which violates FK constraint (no ON UPDATE CASCADE)
        if articles_to_upsert:
            from postgrest.exceptions import APIError
            try:
                upsert_result = supabase.table("articles").upsert(
                    articles_to_upsert,
                    on_conflict="id"
                ).execute()
            except APIError as e:
                # Handle unique constraint violation (URL matching failed)
                if "23505" in str(e):
                    logger.warning(f"Unique constraint violation, retrying with URL lookup")
                    # Re-query existing articles by URL to get correct IDs
                    for article in articles_to_upsert:
                        existing = supabase.table("articles").select("id").eq(
                            "feed_id", feed_id
                        ).eq("url", article["url"]).maybeSingle().execute()
                        if existing.data:
                            article["id"] = existing.data["id"]
                    # Retry upsert with corrected IDs
                    supabase.table("articles").upsert(
                        articles_to_upsert,
                        on_conflict="id"
                    ).execute()
                else:
                    raise
            article_ids = [a["id"] for a in articles_to_upsert]
        else:
            article_ids = []

        skipped_count = sum(1 for a in existing_articles.values() if a["images_processed"])
        logger.info(f"Upserted {len(articles_to_upsert)} articles, skipped {skipped_count} processed")
    else:
        article_ids = []
        logger.debug(f"No articles parsed from feed {feed_id}")

    return {"success": True, "article_count": len(articles), "article_ids": article_ids, "feed_image": feed_image}


def update_feed_status(
    feed_id: str,
    user_id: str,
    status: str,
    error: Optional[str] = None,
    feed_image: Optional[str] = None
):
    """Update feed status after refresh attempt."""
    supabase = get_supabase_service()

    update_data = {
        "last_fetched": datetime.now(timezone.utc).isoformat(),
        "last_fetch_status": status,
        "last_fetch_error": error[:500] if error else None
    }
    if feed_image:
        update_data["feed_image"] = feed_image
    supabase.table("feeds").update(update_data).eq(
        "id", feed_id
    ).eq("user_id", user_id).execute()


def do_serial_full_text_fetch(article_ids: list) -> Dict[str, Any]:
    """
    Serial full-text fetch for articles with auto-fetch enabled feeds.

    Fetches each article's source URL via readability extraction,
    writes full_content / fetch_status to DB. Single failure does not
    block the pipeline.

    Returns:
        {"fetched": int, "failed": int}
    """
    import asyncio
    from app.services.full_text_fetch import fetch_full_content_html, FullTextFetchError

    if not article_ids:
        return {"fetched": 0, "failed": 0}

    supabase = get_supabase_service()
    fetched = 0
    failed = 0

    # Load article URLs in one query
    result = supabase.table("articles").select(
        "id, url, fetch_status"
    ).in_("id", article_ids).execute()

    for article in (result.data or []):
        aid = article["id"]
        url = (article.get("url") or "").strip()

        # Skip already-fetched or no-URL articles
        if article.get("fetch_status") == "success" or not url:
            continue

        try:
            html = asyncio.run(fetch_full_content_html(url, timeout_seconds=30.0))
            now_iso = datetime.now(timezone.utc).isoformat()
            supabase.table("articles").update({
                "full_content": html,
                "full_content_fetched_at": now_iso,
                "fetch_status": "success",
            }).eq("id", aid).execute()
            fetched += 1
            logger.info(f"[FULL_TEXT] Fetched {len(html)} chars for article {aid}")
        except (FullTextFetchError, Exception) as e:
            supabase.table("articles").update({
                "fetch_status": "failed",
            }).eq("id", aid).execute()
            failed += 1
            logger.warning(f"[FULL_TEXT] Failed for article {aid}: {e}")

    logger.info(f"[FULL_TEXT] Serial fetch done: fetched={fetched}, failed={failed}")
    return {"fetched": fetched, "failed": failed}


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
        f"Processing: attempt={attempt}/{max_attempts}, priority={priority}",
        extra={
            'task_id': task_id,
            'feed_id': feed_id,
            'user_id': user_id,
            'feed_url': feed_url,
            'feed_title': feed_title,
            'refresh_interval': refresh_interval,
        }
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
        # Check if feed still exists and get auto-fetch flag
        supabase = get_supabase_service()
        feed_check = supabase.table("feeds").select(
            "id, enable_auto_fetch_full_content"
        ).eq("id", feed_id).eq("user_id", user_id).execute()

        if not feed_check.data:
            # Feed no longer exists, skip and terminate task chain
            logger.info(
                f"Feed {feed_id} no longer exists, skipping refresh",
                extra={
                    'task_id': task_id,
                    'feed_id': feed_id,
                    'user_id': user_id,
                    'reason': 'feed_deleted'
                }
            )
            return {
                "success": True,
                "feed_id": feed_id,
                "skipped": True,
                "reason": "feed_deleted"
            }

        # Execute refresh
        result = do_refresh_feed(feed_id, feed_url, user_id)

        # Update status (includes feed_image if available)
        update_feed_status(feed_id, user_id, "success", feed_image=result.get("feed_image"))

        article_ids = result.get("article_ids", [])

        # Auto full-text fetch (serial, before image processing)
        auto_fetch = feed_check.data[0].get("enable_auto_fetch_full_content", False)
        if auto_fetch and article_ids:
            try:
                do_serial_full_text_fetch(article_ids)
            except Exception as e:
                logger.error(f"[FULL_TEXT] Error in serial fetch: {e}")

        # Schedule image processing (moved from do_refresh_feed)
        if article_ids:
            try:
                from .image_processor import schedule_image_processing
                schedule_image_processing.delay(article_ids, feed_id)
            except Exception as e:
                logger.error(f"Failed to schedule image processing: {e}")

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            "Completed successfully",
            extra={
                'task_id': task_id,
                'feed_id': feed_id,
                'user_id': user_id,
                'feed_url': feed_url,
                'feed_title': feed_title,
                'success': 'true',
                'duration_ms': duration_ms,
                'articles_count': result['article_count'],
                'refresh_interval': refresh_interval,
            }
        )

        return {
            "success": True,
            "feed_id": feed_id,
            "article_count": result["article_count"],
            "duration_ms": duration_ms
        }

    except RetryableError as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.warning(
            f"Retryable error: {e}",
            extra={
                'task_id': task_id,
                'feed_id': feed_id,
                'user_id': user_id,
                'feed_url': feed_url,
                'feed_title': feed_title,
                'success': 'false',
                'error': str(e),
                'duration_ms': duration_ms,
                'refresh_interval': refresh_interval,
            }
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
            f"Non-retryable error: {e}",
            extra={
                'task_id': task_id,
                'feed_id': feed_id,
                'user_id': user_id,
                'feed_url': feed_url,
                'feed_title': feed_title,
                'success': 'false',
                'error': str(e),
                'duration_ms': duration_ms,
                'refresh_interval': refresh_interval,
            }
        )

        update_feed_status(feed_id, user_id, "failed", str(e))

        return {
            "success": False,
            "feed_id": feed_id,
            "error": str(e),
            "duration_ms": duration_ms
        }

    except Exception as e:
        # Unexpected error
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.exception(
            f"Unexpected error: {e}",
            extra={
                'task_id': task_id,
                'feed_id': feed_id,
                'user_id': user_id,
                'feed_url': feed_url,
                'feed_title': feed_title,
                'success': 'false',
                'error': str(e),
                'duration_ms': duration_ms,
                'refresh_interval': refresh_interval,
            }
        )
        update_feed_status(feed_id, user_id, "failed", str(e))
        raise

    finally:
        # Release lock
        if not skip_lock:
            task_lock.release(lock_key, task_id)


# =============================================================================
# Beat-driven batch refresh tasks
# =============================================================================

@app.task(
    bind=True,
    name="refresh_feed_batch",
    max_retries=2,
    default_retry_delay=5,
    retry_backoff=True,
    retry_backoff_max=60,
    time_limit=120,
    soft_time_limit=90,
)
def refresh_feed_batch(
    self,
    feed_id: str,
    feed_url: str,
    feed_title: str,
    user_id: str,
    refresh_interval: int,
):
    """
    Batch mode feed refresh task (used by Beat scan_due_feeds).

    Returns article_ids + enable_auto_fetch_full_content for batch orchestrator.
    Image scheduling and full-text fetch are handled by on_user_feeds_complete.

    Args:
        feed_id: Feed UUID
        feed_url: RSS URL
        feed_title: Display name
        user_id: User UUID
        refresh_interval: Refresh interval in minutes
    """
    task_id = self.request.id
    task_lock = get_task_lock()
    lock_key = f"feed:{feed_id}"
    lock_ttl = 180

    # Check task lock (prevent duplicate execution)
    if not task_lock.acquire(lock_key, lock_ttl, task_id):
        logger.info(f"[BATCH] Feed {feed_id} already being processed, skipping")
        return {
            "success": True,
            "feed_id": feed_id,
            "skipped": True,
            "reason": "locked",
            "article_ids": []
        }

    start_time = datetime.now(timezone.utc)

    try:
        # Check if feed still exists and get auto-fetch flag
        supabase = get_supabase_service()
        feed_check = supabase.table("feeds").select(
            "id, enable_auto_fetch_full_content"
        ).eq("id", feed_id).eq("user_id", user_id).execute()

        if not feed_check.data:
            logger.info(f"[BATCH] Feed {feed_id} no longer exists, skipping")
            return {
                "success": True,
                "feed_id": feed_id,
                "skipped": True,
                "reason": "feed_deleted",
                "article_ids": []
            }

        auto_fetch = feed_check.data[0].get("enable_auto_fetch_full_content", False)

        # Execute refresh (no image scheduling — handled by batch orchestrator)
        result = do_refresh_feed(feed_id, feed_url, user_id)

        update_feed_status(feed_id, user_id, "success", feed_image=result.get("feed_image"))

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            f"[BATCH] Feed {feed_id} completed: {result['article_count']} articles, {duration_ms}ms"
        )

        return {
            "success": True,
            "feed_id": feed_id,
            "article_count": result["article_count"],
            "article_ids": result.get("article_ids", []),
            "enable_auto_fetch_full_content": auto_fetch,
            "duration_ms": duration_ms
        }

    except RetryableError as e:
        update_feed_status(feed_id, user_id, "failed", str(e))
        raise self.retry(exc=e)

    except NonRetryableError as e:
        update_feed_status(feed_id, user_id, "failed", str(e))
        return {
            "success": False,
            "feed_id": feed_id,
            "error": str(e),
            "article_ids": []
        }

    except Exception as e:
        update_feed_status(feed_id, user_id, "failed", str(e))
        logger.exception(f"[BATCH] Unexpected error for feed {feed_id}: {e}")
        return {
            "success": False,
            "feed_id": feed_id,
            "error": str(e),
            "article_ids": []
        }

    finally:
        task_lock.release(lock_key, task_id)


@app.task(name="scan_due_feeds")
def scan_due_feeds():
    """
    Celery Beat task: Scan feeds due for refresh every minute.

    Refresh criteria: last_fetched + refresh_interval < now
    or last_fetched IS NULL (never refreshed)

    Groups feeds by user_id and schedules batch refresh per user.
    """
    task_lock = get_task_lock()

    # Prevent overlapping execution (Beat may trigger again before previous completes)
    if not task_lock.acquire("scan_due_feeds", ttl_seconds=55):
        logger.debug("[SCAN] scan_due_feeds already running, skipping")
        return {"skipped": True}

    try:
        supabase = get_supabase_service()
        now = datetime.now(timezone.utc)

        # Query all feeds (Supabase doesn't support complex time calculations)
        result = supabase.table("feeds").select(
            "id, url, title, user_id, refresh_interval, last_fetched"
        ).execute()

        if not result.data:
            return {"due_feeds": 0, "users_scheduled": 0}

        # Filter feeds due for refresh in code
        due_feeds = []
        for feed in result.data:
            try:
                if feed.get("last_fetched"):
                    last_fetched = datetime.fromisoformat(
                        feed["last_fetched"].replace("Z", "+00:00")
                    )
                    next_refresh = last_fetched + timedelta(minutes=int(feed["refresh_interval"]))
                    if next_refresh <= now:
                        due_feeds.append(feed)
                else:
                    # Never fetched, needs refresh
                    due_feeds.append(feed)
            except Exception as e:
                logger.warning(
                    f"[SCAN] Skipping feed {feed.get('id')} due to invalid data: {e}",
                    extra={
                        "feed_id": feed.get("id"),
                        "last_fetched": feed.get("last_fetched"),
                        "refresh_interval": feed.get("refresh_interval"),
                    },
                )

        if not due_feeds:
            logger.debug("[SCAN] No feeds due for refresh")
            return {"due_feeds": 0, "users_scheduled": 0}

        # Group by user_id
        user_feeds = {}
        for feed in due_feeds:
            uid = feed["user_id"]
            if uid not in user_feeds:
                user_feeds[uid] = []
            user_feeds[uid].append(feed)

        # Schedule batch refresh for each user
        for user_id, feeds in user_feeds.items():
            schedule_user_batch_refresh.delay(user_id, feeds)

        logger.info(f"[SCAN] Scheduled batch refresh: {len(due_feeds)} feeds for {len(user_feeds)} users")
        return {
            "due_feeds": len(due_feeds),
            "users_scheduled": len(user_feeds)
        }

    finally:
        task_lock.release("scan_due_feeds")


@app.task(name="schedule_user_batch_refresh")
def schedule_user_batch_refresh(user_id: str, feeds: list):
    """
    Schedule batch feed refresh for a single user.

    Creates a Chord: all feeds refresh in parallel -> on_user_feeds_complete callback

    Args:
        user_id: User UUID
        feeds: List of feed dicts with id, url, title, refresh_interval
    """
    from celery import chord, group

    if not feeds:
        return {"scheduled": 0}

    logger.info(f"[BATCH] Scheduling batch refresh for user {user_id}: {len(feeds)} feeds")

    # Build feed refresh task group
    refresh_tasks = group(
        refresh_feed_batch.s(
            feed_id=feed["id"],
            feed_url=feed["url"],
            feed_title=feed["title"],
            user_id=user_id,
            refresh_interval=feed["refresh_interval"],
        )
        for feed in feeds
    )

    # Chord: all refreshes complete -> callback collects results
    workflow = chord(refresh_tasks)(
        on_user_feeds_complete.s(user_id=user_id)
    )

    return {
        "scheduled": len(feeds),
        "chord_id": workflow.id,
        "user_id": user_id
    }


@app.task(name="on_user_feeds_complete", bind=True)
def on_user_feeds_complete(self, refresh_results: list, user_id: str):
    """
    Callback after all feed refreshes complete for a user.

    Collects all new article IDs and triggers batch image processing.

    Args:
        refresh_results: List of results from refresh_feed_batch tasks
        user_id: User UUID
    """
    task_id = self.request.id

    # Count results
    success_count = sum(1 for r in refresh_results if r and r.get("success"))
    failed_count = len(refresh_results) - success_count

    # Collect all new article IDs + auto-fetch subset
    all_article_ids = []
    auto_fetch_article_ids = []
    for r in refresh_results:
        if r and r.get("success") and not r.get("skipped"):
            ids = r.get("article_ids", [])
            all_article_ids.extend(ids)
            if r.get("enable_auto_fetch_full_content"):
                auto_fetch_article_ids.extend(ids)

    logger.info(
        f"[BATCH_CALLBACK] User {user_id} feeds complete: "
        f"{success_count}/{len(refresh_results)} succeeded, "
        f"{len(all_article_ids)} new articles, "
        f"{len(auto_fetch_article_ids)} for auto full-text"
    )

    if not all_article_ids:
        return {
            "user_id": user_id,
            "feeds_success": success_count,
            "feeds_failed": failed_count,
            "articles": 0,
            "image_processing": "skipped"
        }

    # Serial full-text fetch for auto-fetch feeds (before image processing)
    if auto_fetch_article_ids:
        try:
            do_serial_full_text_fetch(auto_fetch_article_ids)
        except Exception as e:
            logger.error(f"[FULL_TEXT] Batch serial fetch error: {e}")

    # Trigger batch image processing
    from .image_processor import schedule_batch_image_processing
    schedule_batch_image_processing.delay(all_article_ids, user_id)

    return {
        "user_id": user_id,
        "feeds_success": success_count,
        "feeds_failed": failed_count,
        "articles": len(all_article_ids),
        "image_processing": "scheduled"
    }

"""Feeds API router for CRUD operations."""

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, Request

from app.dependencies import create_service_dependency, require_exists, extract_update_data
from app.exceptions import DuplicateError, ValidationError
from app.schemas.feeds import (
    FeedCreate,
    FeedUpdate,
    FeedResponse,
    FeedDeleteResponse,
)
from app.services.db.feeds import FeedService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["feeds"])


get_feed_service = create_service_dependency(FeedService)


@router.get("", response_model=List[FeedResponse])
async def get_feeds(service: FeedService = Depends(get_feed_service)):
    """
    Get all feeds for the authenticated user.

    Returns:
        List of feeds ordered by order field.
    """
    feeds = service.load_feeds()
    logger.debug(f"Retrieved {len(feeds)} feeds")
    return feeds


@router.post("", response_model=dict)
async def create_feeds(
    feeds: List[FeedCreate],
    service: FeedService = Depends(get_feed_service),
):
    """
    Create or upsert multiple feeds.

    Supports bulk creation/update of feeds.
    Automatically schedules refresh_feed task for each new feed.

    Args:
        feeds: List of feeds to create/update

    Returns:
        Success status with optional error message.
    """
    feed_dicts = [feed.model_dump() for feed in feeds]
    result = service.save_feeds(feed_dicts)

    if not result.get("success"):
        error = result.get("error", "Unknown error")
        if error == "duplicate":
            raise DuplicateError("feed URL")
        raise ValidationError(error)

    # Auto-schedule refresh for each saved feed
    saved_feeds = result.get("data", [])
    if saved_feeds:
        from datetime import datetime, timezone
        from app.celery_app.tasks import refresh_feed
        from app.celery_app.supabase_client import get_supabase_service

        # Set last_fetched = now for new feeds to prevent Beat from re-triggering
        # (POST /feeds auto-schedules refresh_feed, Beat should not duplicate it)
        supabase_service = get_supabase_service()
        now_iso = datetime.now(timezone.utc).isoformat()

        for feed_data in saved_feeds:
            try:
                # Set last_fetched to prevent Beat from re-triggering
                supabase_service.table("feeds").update({
                    "last_fetched": now_iso
                }).eq("id", feed_data["id"]).execute()

                refresh_feed.apply_async(
                    kwargs={
                        "feed_id": feed_data["id"],
                        "feed_url": feed_data["url"],
                        "feed_title": feed_data["title"],
                        "user_id": service.user_id,
                        "refresh_interval": feed_data.get("refresh_interval", 60),
                        "priority": "new_feed",
                    },
                    queue="high"  # New feeds get high priority
                )
                logger.info(f"Scheduled refresh for new feed: {feed_data['id']}")
            except Exception as e:
                logger.error(f"Failed to schedule refresh for feed {feed_data['id']}: {e}")
                # Don't fail the whole request if scheduling fails

    logger.info(f"Created/updated {len(feeds)} feeds")
    return {"success": True, "count": len(feeds)}


@router.get("/{feed_id}", response_model=FeedResponse)
async def get_feed(
    feed_id: UUID,
    service: FeedService = Depends(get_feed_service),
):
    """
    Get a single feed by ID.

    Args:
        feed_id: UUID of the feed

    Returns:
        Feed details if found.

    Raises:
        404 if feed not found.
    """
    feed = require_exists(service.get_feed(str(feed_id)), "Feed")
    return feed


@router.put("/{feed_id}", response_model=dict)
async def update_feed(
    feed_id: UUID,
    feed_update: FeedUpdate,
    service: FeedService = Depends(get_feed_service),
):
    """
    Update a feed by ID.

    Supports partial updates - only provided fields will be updated.

    Args:
        feed_id: UUID of the feed to update
        feed_update: Fields to update

    Returns:
        Success status.

    Raises:
        404 if feed not found.
    """
    # First check if feed exists
    require_exists(service.get_feed(str(feed_id)), "Feed")

    # Filter out None values for partial update
    update_data = extract_update_data(feed_update)

    if not update_data:
        return {"success": True, "message": "No fields to update"}

    result = service.update_feed(str(feed_id), update_data)

    if not result.get("success"):
        error = result.get("error", "Unknown error")
        if error == "duplicate":
            raise DuplicateError("feed URL")
        raise ValidationError(error)

    logger.info(f"Updated feed {feed_id}")
    return {"success": True}


@router.delete("/{feed_id}", response_model=FeedDeleteResponse)
async def delete_feed(
    feed_id: UUID,
    service: FeedService = Depends(get_feed_service),
):
    """
    Delete a feed and all its articles.

    Args:
        feed_id: UUID of the feed to delete

    Returns:
        Deletion statistics (articles_deleted, feed_deleted).

    Raises:
        404 if feed not found.
    """
    # First check if feed exists
    require_exists(service.get_feed(str(feed_id)), "Feed")

    result = service.delete_feed(str(feed_id))
    logger.info(f"Deleted feed {feed_id} with {result['articles_deleted']} articles")
    return FeedDeleteResponse(**result)

"""Feeds API router for CRUD operations."""

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.feeds import (
    FeedCreate,
    FeedUpdate,
    FeedResponse,
    FeedDeleteResponse,
)
from app.services.db.feeds import FeedService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["feeds"])


def get_feed_service(request: Request, user=Depends(verify_auth)) -> FeedService:
    """Create FeedService instance with authenticated user's session."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    client = get_supabase_client(access_token)
    return FeedService(client, user.user.id)


@router.get("", response_model=List[FeedResponse])
async def get_feeds(service: FeedService = Depends(get_feed_service)):
    """
    Get all feeds for the authenticated user.

    Returns:
        List of feeds ordered by order field.
    """
    try:
        feeds = service.load_feeds()
        logger.debug(f"Retrieved {len(feeds)} feeds")
        return feeds
    except Exception as e:
        logger.error(f"Failed to get feeds: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve feeds")


@router.post("", response_model=dict)
async def create_feeds(
    feeds: List[FeedCreate],
    service: FeedService = Depends(get_feed_service),
):
    """
    Create or upsert multiple feeds.

    Supports bulk creation/update of feeds.

    Args:
        feeds: List of feeds to create/update

    Returns:
        Success status with optional error message.
    """
    try:
        feed_dicts = [feed.model_dump() for feed in feeds]
        result = service.save_feeds(feed_dicts)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            if error == "duplicate":
                raise HTTPException(status_code=409, detail="Duplicate feed URL")
            raise HTTPException(status_code=400, detail=error)

        logger.info(f"Created/updated {len(feeds)} feeds")
        return {"success": True, "count": len(feeds)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create feeds: {e}")
        raise HTTPException(status_code=500, detail="Failed to create feeds")


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
    try:
        feed = service.get_feed(str(feed_id))
        if not feed:
            raise HTTPException(status_code=404, detail="Feed not found")
        return feed
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get feed {feed_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve feed")


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
    try:
        # First check if feed exists
        existing = service.get_feed(str(feed_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Feed not found")

        # Filter out None values for partial update
        update_data = {k: v for k, v in feed_update.model_dump().items() if v is not None}

        if not update_data:
            return {"success": True, "message": "No fields to update"}

        result = service.update_feed(str(feed_id), update_data)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            if error == "duplicate":
                raise HTTPException(status_code=409, detail="Duplicate feed URL")
            raise HTTPException(status_code=400, detail=error)

        logger.info(f"Updated feed {feed_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update feed {feed_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update feed")


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
    try:
        # First check if feed exists
        existing = service.get_feed(str(feed_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Feed not found")

        result = service.delete_feed(str(feed_id))
        logger.info(f"Deleted feed {feed_id} with {result['articles_deleted']} articles")
        return FeedDeleteResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete feed {feed_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete feed")

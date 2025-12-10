"""
Queue management API endpoints.

Provides endpoints for scheduling feed refresh tasks and querying task status.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from app.dependencies import verify_auth
from app.supabase_client import get_supabase_client
from app.celery_app.tasks import refresh_feed, schedule_all_feeds
from app.celery_app.task_lock import get_task_lock

router = APIRouter(prefix="/queue", tags=["queue"])


class ScheduleFeedRequest(BaseModel):
    """Request model for scheduling a feed refresh."""
    feed_id: UUID
    force_immediate: bool = False


class ScheduleFeedResponse(BaseModel):
    """Response model for schedule feed endpoint."""
    task_id: Optional[str]
    status: str  # "scheduled" | "already_running" | "queued"
    delay_seconds: int


@router.post("/schedule-feed", response_model=ScheduleFeedResponse)
async def schedule_feed_refresh(
    request: ScheduleFeedRequest,
    auth_response=Depends(verify_auth),
):
    """
    Schedule a feed refresh task.

    If force_immediate is True, the feed will be refreshed immediately
    using the high priority queue. Otherwise, it will be scheduled
    according to its refresh interval.
    """
    user = auth_response.user
    user_id = user.id
    feed_id = str(request.feed_id)

    # Get Supabase client with user token
    access_token = auth_response.session.access_token if auth_response.session else None
    supabase = get_supabase_client(access_token)

    # Get feed data
    result = supabase.table("feeds").select("*").eq(
        "id", feed_id
    ).eq("user_id", user_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    feed = result.data

    # Check if task is already running
    task_lock = get_task_lock()
    if task_lock.is_locked(f"feed:{feed_id}"):
        remaining = task_lock.get_ttl(f"feed:{feed_id}")
        return ScheduleFeedResponse(
            task_id=None,
            status="already_running",
            delay_seconds=remaining
        )

    if request.force_immediate:
        # Immediate refresh (high priority queue)
        task = refresh_feed.apply_async(
            kwargs={
                "feed_id": feed_id,
                "feed_url": feed["url"],
                "feed_title": feed["title"],
                "user_id": user_id,
                "refresh_interval": feed["refresh_interval"],
                "priority": "manual"
            },
            queue="high"  # High priority queue
        )
        return ScheduleFeedResponse(
            task_id=task.id,
            status="scheduled",
            delay_seconds=0
        )
    else:
        # Schedule according to interval
        delay_seconds = 0

        if feed.get("last_fetched"):
            last_fetched = datetime.fromisoformat(
                feed["last_fetched"].replace("Z", "+00:00")
            )
            next_refresh = last_fetched + timedelta(minutes=feed["refresh_interval"])
            now = datetime.now(timezone.utc)  # Use UTC!
            delay_seconds = max(0, int((next_refresh - now).total_seconds()))

        task = refresh_feed.apply_async(
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

        return ScheduleFeedResponse(
            task_id=task.id,
            status="queued",
            delay_seconds=delay_seconds
        )


@router.post("/schedule-all")
async def schedule_all_feeds_endpoint(auth_response=Depends(verify_auth)):
    """
    Schedule refresh tasks for all feeds.

    This is an admin function that schedules all feeds in the system.
    """
    # TODO: Add admin permission check
    task = schedule_all_feeds.delay()
    return {"task_id": task.id, "status": "initiated"}


@router.get("/task/{task_id}")
async def get_task_status(task_id: str, auth_response=Depends(verify_auth)):
    """
    Get the status of a task.

    Returns the current status and result (if completed) or error (if failed).
    """
    from celery.result import AsyncResult

    result = AsyncResult(task_id)

    response = {
        "task_id": task_id,
        "status": result.status,
    }

    if result.ready():
        response["result"] = result.result
    elif result.failed():
        response["error"] = str(result.result)

    return response

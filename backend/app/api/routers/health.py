"""
Queue health check endpoint.

Provides health status for the Celery queue infrastructure.
"""

from fastapi import APIRouter
from datetime import datetime, timezone
import redis
import os

router = APIRouter(tags=["health"])


@router.get("/queue-health")
async def queue_health():
    """
    Queue health check.

    Optimized: Doesn't use inspect broadcast, directly checks Redis.

    Returns:
        Health status including Redis connectivity and queue lengths.
    """
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    r = redis.from_url(redis_url, decode_responses=True)

    try:
        # Check Redis connection
        r.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    # Check queue lengths (no broadcast to workers)
    # Celery queue format: list with queue name
    default_queue_len = r.llen("default") or 0
    high_queue_len = r.llen("high") or 0

    # If queues are too backed up, consider unhealthy
    total_pending = default_queue_len + high_queue_len
    is_healthy = redis_ok and total_pending < 1000

    return {
        "status": "healthy" if is_healthy else "degraded",
        "redis_connected": redis_ok,
        "queues": {
            "default": default_queue_len,
            "high": high_queue_len,
        },
        "total_pending": total_pending,
        "checked_at": datetime.now(timezone.utc).isoformat()
    }

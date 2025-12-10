"""
Redis-based task deduplication lock.

Solves the problem that Celery's task_id doesn't auto-deduplicate like BullMQ's jobId.

Use cases:
- Prevent duplicate refresh tasks for the same feed
- Prevent users from spamming manual refresh
"""

import os
import redis
from contextlib import contextmanager
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class TaskLock:
    """Distributed task lock using Redis."""

    KEY_PREFIX = "tasklock:"

    def __init__(self, redis_url: str = None):
        self.redis = redis.from_url(
            redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )

    def acquire(
        self,
        lock_key: str,
        ttl_seconds: int = 300,  # Default 5 minutes
        task_id: str = None
    ) -> bool:
        """
        Try to acquire a lock.

        Args:
            lock_key: Unique lock identifier (e.g., "feed:{feed_id}")
            ttl_seconds: Lock expiration time
            task_id: Optional, store current task ID for debugging

        Returns:
            True if lock acquired, False if already locked
        """
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        value = task_id or "1"

        # NX: Only set if key doesn't exist
        # EX: Set expiration time
        acquired = self.redis.set(full_key, value, nx=True, ex=ttl_seconds)

        if not acquired:
            # Failed to acquire, log who holds the lock
            holder = self.redis.get(full_key)
            logger.debug(f"Lock {lock_key} held by {holder}")

        return bool(acquired)

    def release(self, lock_key: str, task_id: str = None) -> bool:
        """
        Release a lock.

        Only the lock holder can release (verified by task_id).

        Args:
            lock_key: Lock identifier
            task_id: Task ID to verify ownership

        Returns:
            True if released, False otherwise
        """
        full_key = f"{self.KEY_PREFIX}{lock_key}"

        if task_id:
            # Verify this task holds the lock
            current = self.redis.get(full_key)
            if current != task_id:
                logger.warning(
                    f"Lock {lock_key} not held by {task_id}, current holder: {current}"
                )
                return False

        return bool(self.redis.delete(full_key))

    def is_locked(self, lock_key: str) -> bool:
        """Check if a lock is held."""
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        return self.redis.exists(full_key) > 0

    def get_ttl(self, lock_key: str) -> int:
        """Get remaining TTL of a lock (seconds)."""
        full_key = f"{self.KEY_PREFIX}{lock_key}"
        ttl = self.redis.ttl(full_key)
        return max(0, ttl)  # Return 0 for -1 or -2

    @contextmanager
    def lock(self, lock_key: str, ttl_seconds: int = 300, task_id: str = None):
        """
        Context manager for lock.

        Usage:
            with task_lock.lock("feed:123") as acquired:
                if acquired:
                    do_work()
        """
        acquired = self.acquire(lock_key, ttl_seconds, task_id)
        try:
            yield acquired
        finally:
            if acquired:
                self.release(lock_key, task_id)


# Global singleton
_task_lock: Optional[TaskLock] = None


def get_task_lock() -> TaskLock:
    """Get the global TaskLock instance."""
    global _task_lock
    if _task_lock is None:
        _task_lock = TaskLock()
    return _task_lock

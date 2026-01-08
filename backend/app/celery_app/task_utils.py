"""
Shared utilities for Celery tasks.

Provides:
- Unified error hierarchy with Retryable/NonRetryable pattern
- Task execution context for timing and logging
- Duration calculation utility
- Result builder for standardized task returns
"""

import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Generator

logger = logging.getLogger(__name__)


# =============================================================================
# Unified Error Hierarchy
# =============================================================================

class TaskError(Exception):
    """
    Base error for all Celery task errors.

    Subclass this for domain-specific errors.
    """
    pass


class RetryableError(TaskError):
    """
    Error that should trigger task retry.

    Examples: network timeouts, rate limits, temporary unavailability.
    """
    pass


class NonRetryableError(TaskError):
    """
    Error that should NOT trigger retry.

    Examples: invalid input, missing config, parse errors.
    """
    pass


# =============================================================================
# Domain-specific errors: Feed Refresh
# =============================================================================

class FeedRefreshError(TaskError):
    """Feed refresh errors."""
    pass


class RetryableFeedError(FeedRefreshError, RetryableError):
    """Retryable feed refresh error (network issues, rate limits)."""
    pass


class NonRetryableFeedError(FeedRefreshError, NonRetryableError):
    """Non-retryable feed refresh error (invalid feed, parse errors)."""
    pass


# =============================================================================
# Domain-specific errors: Image Processing
# =============================================================================

class ImageProcessingError(TaskError):
    """Image processing errors."""
    pass


class RetryableImageError(ImageProcessingError, RetryableError):
    """Retryable image processing error (network issues)."""
    pass


class NonRetryableImageError(ImageProcessingError, NonRetryableError):
    """Non-retryable image processing error (invalid image, SSRF blocked)."""
    pass


# =============================================================================
# Domain-specific errors: RAG Processing
# =============================================================================

class RagProcessingError(TaskError):
    """RAG processing errors."""
    pass


class ConfigError(RagProcessingError, NonRetryableError):
    """Configuration error (user hasn't configured API)."""
    pass


class ChunkingError(RagProcessingError, NonRetryableError):
    """Text chunking error."""
    pass


class EmbeddingError(RagProcessingError, RetryableError):
    """Embedding generation error (often retryable - API )."""
    pass


# =============================================================================
# Domain-specific errors: Repository Extraction
# =============================================================================

class RepoExtractionError(TaskError):
    """Repository extraction errors."""
    pass


class GitHubAPIError(RepoExtractionError):
    """GitHub API errors."""
    pass


class RateLimitError(GitHubAPIError, RetryableError):
    """Rate limit exceeded (retryable after delay)."""
    pass


# =============================================================================
# Error Classification Utilities
# =============================================================================

def is_retryable(error: Exception) -> bool:
    """
    Check if an error should trigger retry.

    Args:
        error: The exception to check

    Returns:
        True if error is retryable
    """
    return isinstance(error, RetryableError)


def is_retryable_message(error_msg: str) -> bool:
    """
    Determine if an error message indicates a retryable condition.

    Used for errors from external libraries that don't use our hierarchy.

    Args:
        error_msg: Error message string

    Returns:
        True if the error message suggests a retryable condition
    """
    retryable_patterns = [
        "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET",
        "socket hang up", "timeout", "temporarily unavailable",
        "503", "502", "429", "ConnectionError", "TimeoutError"
    ]
    error_lower = error_msg.lower()
    return any(p.lower() in error_lower for p in retryable_patterns)


# =============================================================================
# Duration Calculation
# =============================================================================

def calculate_duration_ms(start_time: datetime) -> int:
    """
    Calculate duration in milliseconds from start_time to now.

    Args:
        start_time: UTC datetime when operation started

    Returns:
        Duration in milliseconds
    """
    return int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)


# =============================================================================
# Task Execution Context
# =============================================================================

@dataclass
class TaskContext:
    """
    Execution context for a Celery task.

    Captures task metadata and timing for consistent logging.

    Usage:
        with task_context(self, article_id=article_id) as ctx:
            ctx.log_start("Processing article")
            result = do_work()
            ctx.log_success("Completed")
            return build_task_result(ctx, success=True, **result)
    """
    task_id: str
    task_name: str
    attempt: int
    max_attempts: int
    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    extra: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_celery_task(cls, task, **extra) -> "TaskContext":
        """
        Create context from a bound Celery task.

        Args:
            task: The Celery task instance (self in @app.task(bind=True))
            **extra: Additional context fields (feed_id, article_id, etc.)
        """
        return cls(
            task_id=task.request.id or "unknown",
            task_name=task.name or "unknown",
            attempt=task.request.retries + 1,
            max_attempts=task.max_retries + 1,
            extra=extra,
        )

    @property
    def duration_ms(self) -> int:
        """Calculate duration from start_time to now."""
        return calculate_duration_ms(self.start_time)

    def log_extra(self, **kwargs) -> Dict[str, Any]:
        """
        Build extra dict for structured logging.

        Merges task context with additional fields.
        """
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            **self.extra,
            **kwargs,
        }

    def log_start(self, message: str = None):
        """Log task start with context."""
        msg = message or f"Starting {self.task_name}"
        logger.info(
            f"{msg}: attempt={self.attempt}/{self.max_attempts}",
            extra=self.log_extra()
        )

    def log_success(self, message: str = None, **kwargs):
        """Log task success with duration."""
        msg = message or f"Completed {self.task_name}"
        logger.info(
            msg,
            extra=self.log_extra(
                success=True,
                duration_ms=self.duration_ms,
                **kwargs
            )
        )

    def log_error(self, error: Exception, message: str = None, **kwargs):
        """Log task error with duration."""
        msg = message or f"Error in {self.task_name}: {error}"
        log_func = logger.warning if is_retryable(error) else logger.error
        log_func(
            msg,
            extra=self.log_extra(
                success=False,
                error=str(error),
                error_type=type(error).__name__,
                retryable=is_retryable(error),
                duration_ms=self.duration_ms,
                **kwargs
            )
        )

    def log_exception(self, error: Exception, message: str = None, **kwargs):
        """Log unexpected exception with traceback."""
        msg = message or f"Unexpected error in {self.task_name}: {error}"
        logger.exception(
            msg,
            extra=self.log_extra(
                success=False,
                error=str(error),
                error_type=type(error).__name__,
                duration_ms=self.duration_ms,
                **kwargs
            )
        )


@contextmanager
def task_context(task, **extra) -> Generator[TaskContext, None, None]:
    """
    Context manager for task execution.

    Usage:
        @app.task(bind=True, name="my_task")
        def my_task(self, article_id: str):
            with task_context(self, article_id=article_id) as ctx:
                ctx.log_start()
                result = do_work(article_id)
                ctx.log_success(articles=result["count"])
                return build_task_result(ctx, success=True, **result)

    Args:
        task: Bound Celery task instance
        **extra: Additional context fields

    Yields:
        TaskContext instance
    """
    ctx = TaskContext.from_celery_task(task, **extra)
    yield ctx


# =============================================================================
# Result Builder
# =============================================================================

def build_task_result(
    ctx: TaskContext,
    success: bool,
    error: str = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Build standardized task result dict.

    Args:
        ctx: Task context
        success: Whether task succeeded
        error: Error message if failed
        **kwargs: Additional result fields

    Returns:
        Standardized result dict with duration_ms
    """
    result = {
        "success": success,
        "duration_ms": ctx.duration_ms,
        **kwargs,
    }
    if error:
        result["error"] = error
    return result


# =============================================================================
# Task Scheduling Constants
# =============================================================================

# Staggered delay constants (seconds between scheduled tasks)
# Used to avoid API rate limits and thundering herd
STAGGER_DELAY_TRIGGER = 1    # Quick trigger (e.g., RAG -> repo extraction)
STAGGER_DELAY_FAST = 2       # Fast tasks (repo extraction batch)
STAGGER_DELAY_NORMAL = 3     # Normal tasks (RAG processing, scan fallback)
STAGGER_DELAY_BATCH = 5      # Batch scheduling (feed batches, RAG scan)
STAGGER_DELAY_MERGE = 30     # Merge window (sync trigger debounce)


# =============================================================================
# Task Lock Helpers
# =============================================================================

def acquire_task_lock(
    ctx: TaskContext,
    task_lock,
    lock_key: str,
    lock_ttl: int,
    skip_lock: bool = False,
) -> bool:
    """
    Acquire task lock with consistent logging.

    Args:
        ctx: Task context for logging
        task_lock: TaskLock instance from get_task_lock()
        lock_key: Redis lock key
        lock_ttl: Lock TTL in seconds
        skip_lock: Skip lock acquisition (for retries)

    Returns:
        True if lock acquired or skipped, False if locked by another task
    """
    if skip_lock:
        return True

    if task_lock.acquire(lock_key, lock_ttl, ctx.task_id):
        return True

    remaining = task_lock.get_ttl(lock_key)
    logger.info(
        f"Task locked: {lock_key}, expires in {remaining}s",
        extra=ctx.log_extra(lock_key=lock_key, remaining_ttl=remaining)
    )
    return False


def check_resource_exists(
    supabase,
    table: str,
    resource_id: str,
    user_id: str,
    id_column: str = "id",
) -> bool:
    """
    Check if a resource exists in database.

    Args:
        supabase: Supabase client
        table: Table name
        resource_id: Resource ID to check
        user_id: User ID for RLS
        id_column: ID column name (default: "id")

    Returns:
        True if resource exists
    """
    result = supabase.table(table).select("id").eq(
        id_column, resource_id
    ).eq("user_id", user_id).execute()
    return bool(result.data)

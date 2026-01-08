"""
Async utilities for Celery tasks.

Provides safe async-to-sync bridge for running coroutines in Celery's
synchronous task context.
"""

import asyncio
from typing import TypeVar, Coroutine, Any

T = TypeVar('T')


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    """
    Safely run async code in sync context (Celery tasks).

    Properly cleans up pending tasks before closing the event loop
    to avoid 'Event loop is closed' errors from httpx AsyncClient.

    Args:
        coro: Coroutine to execute

    Returns:
        Result of the coroutine
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        # Cancel all pending tasks to allow proper cleanup
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            # Allow cancelled tasks to complete
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
        except Exception:
            pass
        # Shutdown async generators
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()

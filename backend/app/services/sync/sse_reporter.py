"""
SSE (Server-Sent Events) progress reporter implementation.

Bridges the sync service with FastAPI's StreamingResponse.
"""

import asyncio
import json
from typing import Any

from .progress import ProgressReporter, SyncPhase


class SSEProgressReporter:
    """
    Progress reporter that pushes events to an asyncio.Queue for SSE streaming.

    Usage:
        queue = asyncio.Queue()
        reporter = SSEProgressReporter(queue)
        sync_service = RepositorySyncService(..., progress=reporter)

        # In SSE generator:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"event: {item['event']}\\ndata: {json.dumps(item['data'])}\\n\\n"
    """

    def __init__(self, queue: asyncio.Queue):
        self.queue = queue

    async def report_phase(self, phase: SyncPhase, **data: Any) -> None:
        """Report a phase transition."""
        await self.queue.put({
            "event": "progress",
            "data": {"phase": phase.value, **data},
        })

    async def report_error(self, message: str) -> None:
        """Report an error."""
        await self.queue.put({
            "event": "error",
            "data": {"message": message},
        })

    async def report_done(self, result: dict) -> None:
        """Report completion."""
        await self.queue.put({
            "event": "done",
            "data": result,
        })

    async def signal_end(self) -> None:
        """Signal end of stream."""
        await self.queue.put(None)

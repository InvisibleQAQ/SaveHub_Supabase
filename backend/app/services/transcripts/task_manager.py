"""In-memory task manager for transcript jobs."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.schemas.transcripts import (
    TranscriptArtifact,
    TranscriptProcessRequest,
    TranscriptStage,
    TranscriptTaskSnapshotResponse,
    TranscriptTaskStatus,
)


class TaskNotFoundError(Exception):
    """Raised when task_id does not exist or has expired."""


class TaskOwnershipError(Exception):
    """Raised when task exists but does not belong to caller user_id."""


@dataclass
class TranscriptTaskRecord:
    """Mutable in-memory record for a transcript task."""

    task_id: str
    user_id: str
    request: TranscriptProcessRequest
    status: TranscriptTaskStatus
    stage: TranscriptStage
    progress: int
    message: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    result: TranscriptArtifact | None = None
    error: dict[str, Any] | None = None
    runner: asyncio.Task[None] | None = None
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)

    def to_snapshot(self) -> TranscriptTaskSnapshotResponse:
        return TranscriptTaskSnapshotResponse(
            task_id=self.task_id,
            status=self.status,
            stage=self.stage,
            progress=self.progress,
            message=self.message,
            created_at=self.created_at,
            updated_at=self.updated_at,
            expires_at=self.expires_at,
        )


class TranscriptTaskManager:
    """Thread-safe async manager for task metadata and SSE subscriber queues."""

    def __init__(
        self,
        *,
        task_ttl_seconds: int = 3600,
        queue_maxsize: int = 200,
    ):
        self._records: dict[str, TranscriptTaskRecord] = {}
        self._lock = asyncio.Lock()
        self._task_ttl_seconds = task_ttl_seconds
        self._queue_maxsize = queue_maxsize

    async def create_task(
        self,
        *,
        user_id: str,
        request: TranscriptProcessRequest,
    ) -> TranscriptTaskRecord:
        """Create and store a new queued task."""
        now = datetime.now(timezone.utc)
        task_id = uuid4().hex
        record = TranscriptTaskRecord(
            task_id=task_id,
            user_id=user_id,
            request=request,
            status="queued",
            stage="queued",
            progress=0,
            message="任务已创建，等待执行",
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(seconds=self._task_ttl_seconds),
        )
        async with self._lock:
            self._records[task_id] = record
        return record

    async def attach_runner(
        self,
        *,
        task_id: str,
        user_id: str,
        runner: asyncio.Task[None],
    ) -> None:
        """Attach background asyncio runner task to an existing record."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        async with self._lock:
            record.runner = runner

    async def snapshot(self, *, task_id: str, user_id: str) -> TranscriptTaskSnapshotResponse:
        """Return current task snapshot."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        return record.to_snapshot()

    async def terminal_data(self, *, task_id: str, user_id: str) -> dict[str, Any]:
        """Return terminal result/error payload for completed tasks."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        return {
            "status": record.status,
            "stage": record.stage,
            "result": record.result,
            "error": record.error,
            "updated_at": record.updated_at,
        }

    async def subscribe(
        self,
        *,
        task_id: str,
        user_id: str,
    ) -> asyncio.Queue[dict[str, Any]]:
        """Register SSE subscriber queue for a task."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._queue_maxsize)
        async with self._lock:
            record.subscribers.add(queue)
        return queue

    async def unsubscribe(
        self,
        *,
        task_id: str,
        user_id: str,
        queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        """Unregister SSE subscriber queue."""
        try:
            record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        except (TaskNotFoundError, TaskOwnershipError):
            return
        async with self._lock:
            record.subscribers.discard(queue)

    async def mark_running(self, *, task_id: str, user_id: str, message: str) -> None:
        """Move task to running state."""
        await self.mark_progress(
            task_id=task_id,
            user_id=user_id,
            stage="queued",
            progress=1,
            message=message,
            status="running",
        )

    async def mark_progress(
        self,
        *,
        task_id: str,
        user_id: str,
        stage: TranscriptStage,
        progress: int,
        message: str,
        status: TranscriptTaskStatus = "running",
    ) -> None:
        """Update stage/progress/status without terminal result."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        now = datetime.now(timezone.utc)
        async with self._lock:
            record.stage = stage
            record.progress = max(0, min(progress, 100))
            record.status = status
            record.message = message
            record.updated_at = now
            record.expires_at = now + timedelta(seconds=self._task_ttl_seconds)

    async def mark_result(
        self,
        *,
        task_id: str,
        user_id: str,
        result: TranscriptArtifact,
    ) -> None:
        """Attach final result before terminal completed state."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        now = datetime.now(timezone.utc)
        async with self._lock:
            record.result = result
            record.updated_at = now
            record.expires_at = now + timedelta(seconds=self._task_ttl_seconds)

    async def mark_completed(self, *, task_id: str, user_id: str, message: str) -> None:
        """Mark task terminal success state."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        now = datetime.now(timezone.utc)
        async with self._lock:
            record.stage = "completed"
            record.status = "completed"
            record.progress = 100
            record.message = message
            record.updated_at = now
            record.expires_at = now + timedelta(seconds=self._task_ttl_seconds)

    async def mark_failed(
        self,
        *,
        task_id: str,
        user_id: str,
        stage: TranscriptStage,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Mark task terminal failed state."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        now = datetime.now(timezone.utc)
        async with self._lock:
            record.stage = "failed"
            record.status = "failed"
            record.message = message
            record.error = {
                "stage": stage,
                "code": code,
                "message": message,
                "details": details or {},
                "failed_at": now.isoformat(),
            }
            record.updated_at = now
            record.expires_at = now + timedelta(seconds=self._task_ttl_seconds)

    async def publish_event(
        self,
        *,
        task_id: str,
        user_id: str,
        event: str,
        data: dict[str, Any],
    ) -> None:
        """Fan-out event payload to active subscribers."""
        record = await self._get_owned_record(task_id=task_id, user_id=user_id)
        async with self._lock:
            subscribers = list(record.subscribers)

        payload = {"event": event, "data": data}
        for queue in subscribers:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    continue

    async def evict_expired(self) -> list[str]:
        """Evict expired terminal task records and return removed IDs."""
        now = datetime.now(timezone.utc)
        removed: list[str] = []
        async with self._lock:
            for task_id, record in list(self._records.items()):
                is_terminal = record.status in {"completed", "failed", "expired"}
                if not is_terminal:
                    continue
                if record.expires_at <= now:
                    if record.runner and not record.runner.done():
                        record.runner.cancel()
                    del self._records[task_id]
                    removed.append(task_id)
        return removed

    async def _get_owned_record(
        self,
        *,
        task_id: str,
        user_id: str,
    ) -> TranscriptTaskRecord:
        async with self._lock:
            record = self._records.get(task_id)
            if not record:
                raise TaskNotFoundError(f"Task not found: {task_id}")
            if record.user_id != user_id:
                raise TaskOwnershipError(f"Task does not belong to user: {task_id}")
            if record.status in {"completed", "failed", "expired"} and record.expires_at <= datetime.now(timezone.utc):
                del self._records[task_id]
                raise TaskNotFoundError(f"Task expired: {task_id}")
            return record

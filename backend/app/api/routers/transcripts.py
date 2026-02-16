"""Transcript processing router."""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.dependencies import COOKIE_NAME_ACCESS, verify_auth
from app.schemas.transcripts import (
    TranscriptAcceptedEventData,
    TranscriptDoneEventData,
    TranscriptErrorEventData,
    TranscriptHeartbeatEventData,
    TranscriptProcessRequest,
    TranscriptProcessResponse,
    TranscriptResultEventData,
    TranscriptSseEventName,
)
from app.services.transcripts import (
    MediaService,
    PipelineRuntimeConfig,
    SubtitleService,
    TaskNotFoundError,
    TaskOwnershipError,
    TranscriptPipelineService,
    TranscriptTaskManager,
    WhisperTranscriber,
)
from app.supabase_client import get_supabase_client

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


_runtime = PipelineRuntimeConfig(
    temp_dir=Path(os.getenv("TRANSCRIPTS_TEMP_DIR", "/tmp/savehub-transcripts")),
    max_concurrent_tasks=int(os.getenv("TRANSCRIPTS_MAX_CONCURRENT_TASKS", "2")),
    executor_max_workers=int(os.getenv("TRANSCRIPTS_EXECUTOR_MAX_WORKERS", "4")),
    task_ttl_seconds=int(os.getenv("TRANSCRIPTS_TASK_TTL_SECONDS", "3600")),
    keep_temp_files=os.getenv("TRANSCRIPTS_KEEP_TEMP_FILES", "false").lower() == "true",
    idle_heartbeat_seconds=int(os.getenv("TRANSCRIPTS_SSE_HEARTBEAT_SECONDS", "15")),
)
_task_manager = TranscriptTaskManager(
    task_ttl_seconds=_runtime.task_ttl_seconds,
    queue_maxsize=int(os.getenv("TRANSCRIPTS_SSE_QUEUE_MAXSIZE", "200")),
)
_pipeline = TranscriptPipelineService(
    task_manager=_task_manager,
    runtime_config=_runtime,
    media_service=MediaService(),
    subtitle_service=SubtitleService(),
    whisper_transcriber=WhisperTranscriber(
        model_size=os.getenv("WHISPER_MODEL_SIZE", "base"),
        device="cpu",
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    ),
)


def get_transcript_task_manager() -> TranscriptTaskManager:
    """Dependency provider for transcript task manager."""
    return _task_manager


def get_transcript_pipeline() -> TranscriptPipelineService:
    """Dependency provider for transcript pipeline."""
    return _pipeline


def _encode_sse(event_name: TranscriptSseEventName, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post(
    "/process",
    response_model=TranscriptProcessResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def process_transcript(
    request: Request,
    body: TranscriptProcessRequest,
    auth_response=Depends(verify_auth),
    pipeline: TranscriptPipelineService = Depends(get_transcript_pipeline),
):
    """Create transcript task and return task_id + stream URL."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    if not access_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            access_token = auth_header[7:]
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)

    task_id = await pipeline.enqueue(
        user_id=user_id,
        request=body,
        supabase=supabase,
    )
    return TranscriptProcessResponse(
        task_id=task_id,
        status="accepted",
        stream_url=f"/api/transcripts/stream/{task_id}",
    )


@router.get("/stream/{task_id}")
async def stream_transcript(
    task_id: str,
    auth_response=Depends(verify_auth),
    task_manager: TranscriptTaskManager = Depends(get_transcript_task_manager),
    pipeline: TranscriptPipelineService = Depends(get_transcript_pipeline),
):
    """SSE stream endpoint for transcript task lifecycle events."""
    await task_manager.evict_expired()
    user_id = str(auth_response.user.id)

    try:
        snapshot = await task_manager.snapshot(task_id=task_id, user_id=user_id)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail="任务不存在或已过期") from exc
    except TaskOwnershipError as exc:
        raise HTTPException(status_code=403, detail="无权访问该任务") from exc

    async def event_generator() -> AsyncGenerator[str, None]:
        queue = await task_manager.subscribe(task_id=task_id, user_id=user_id)
        try:
            yield ": stream-open\n\n"
            yield _encode_sse(
                "accepted",
                TranscriptAcceptedEventData(
                    task_id=snapshot.task_id,
                    status=snapshot.status,
                    stage=snapshot.stage,
                    progress=snapshot.progress,
                    message=snapshot.message,
                    created_at=snapshot.created_at,
                ).model_dump(mode="json"),
            )

            terminal_received = snapshot.status in {"completed", "failed", "expired"}
            if terminal_received:
                terminal = await task_manager.terminal_data(task_id=task_id, user_id=user_id)
                updated_at = terminal["updated_at"]

                if terminal["status"] == "completed" and terminal.get("result"):
                    result = terminal["result"]
                    yield _encode_sse(
                        "result",
                        TranscriptResultEventData(
                            task_id=task_id,
                            status="completed",
                            stage="completed",
                            result=result,
                            completed_at=updated_at,
                        ).model_dump(mode="json"),
                    )
                    yield _encode_sse(
                        "done",
                        TranscriptDoneEventData(
                            task_id=task_id,
                            status="completed",
                            stage="completed",
                            completed_at=updated_at,
                        ).model_dump(mode="json"),
                    )

                if terminal["status"] == "failed" and terminal.get("error"):
                    error = terminal["error"]
                    failed_at = error.get("failed_at")
                    failed_time = datetime.now(timezone.utc)
                    if isinstance(failed_at, str):
                        try:
                            failed_time = datetime.fromisoformat(failed_at)
                        except ValueError:
                            failed_time = datetime.now(timezone.utc)

                    yield _encode_sse(
                        "error",
                        TranscriptErrorEventData(
                            task_id=task_id,
                            status="failed",
                            stage=error.get("stage", "failed"),
                            code=error.get("code", "unknown_error"),
                            message=error.get("message", "任务失败"),
                            retryable=False,
                            details=error.get("details") or {},
                            failed_at=failed_time,
                        ).model_dump(mode="json"),
                    )
                return

            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(),
                        timeout=pipeline.idle_heartbeat_seconds,
                    )
                    event_name = item.get("event")
                    payload = item.get("data", {})
                    if event_name not in {
                        "accepted",
                        "progress",
                        "artifact",
                        "result",
                        "done",
                        "error",
                        "heartbeat",
                    }:
                        continue

                    yield _encode_sse(event_name, payload)
                    if event_name in {"done", "error"}:
                        break
                except asyncio.TimeoutError:
                    yield _encode_sse(
                        "heartbeat",
                        TranscriptHeartbeatEventData(
                            task_id=task_id,
                            server_time=datetime.now(timezone.utc),
                        ).model_dump(mode="json"),
                    )
        finally:
            await task_manager.unsubscribe(task_id=task_id, user_id=user_id, queue=queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "identity",
        },
    )


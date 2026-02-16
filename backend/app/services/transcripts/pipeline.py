"""Transcript orchestration pipeline."""

import asyncio
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, TypeVar

from supabase import Client

from app.schemas.transcripts import (
    TranscriptArtifact,
    TranscriptArtifactEventData,
    TranscriptDoneEventData,
    TranscriptErrorEventData,
    TranscriptProcessRequest,
    TranscriptProgressEventData,
    TranscriptResultEventData,
    TranscriptStage,
)
from app.services.ai import ConfigError

from .ai_text import TranscriptAiTextService
from .media import MediaDownloadError, MediaService
from .subtitle import SubtitleDownloadError, SubtitleService, SubtitleUnavailableError
from .task_manager import TranscriptTaskManager
from .whisper import WhisperTranscriber, WhisperTranscriptionError

_T = TypeVar("_T")
_logger = logging.getLogger(__name__)


class PipelineStageError(Exception):
    """Structured stage-level exception with explicit code/retryability."""

    def __init__(
        self,
        *,
        stage: TranscriptStage,
        code: str,
        message: str,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.stage = stage
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}


@dataclass
class PipelineRuntimeConfig:
    """Runtime controls for concurrency, threads, timeouts, and retention."""

    temp_dir: Path
    max_concurrent_tasks: int = 2
    executor_max_workers: int = 4
    task_ttl_seconds: int = 3600
    keep_temp_files: bool = False
    idle_heartbeat_seconds: int = 15
    stage_timeout_seconds: dict[str, int] = field(
        default_factory=lambda: {
            "subtitle_probe": 120,
            "subtitle_download": 180,
            "audio_download": 900,
            "transcribe": 3600,
            "optimize": 600,
            "translate": 600,
            "summarize": 600,
            "finalize": 120,
        }
    )


class TranscriptPipelineService:
    """Orchestrator with semaphore + executor + fallback policy."""

    def __init__(
        self,
        *,
        task_manager: TranscriptTaskManager,
        runtime_config: PipelineRuntimeConfig,
        media_service: MediaService,
        subtitle_service: SubtitleService,
        whisper_transcriber: WhisperTranscriber,
    ):
        self._task_manager = task_manager
        self._runtime = runtime_config
        self._media = media_service
        self._subtitle = subtitle_service
        self._whisper = whisper_transcriber
        self._semaphore = asyncio.Semaphore(self._runtime.max_concurrent_tasks)
        self._executor = ThreadPoolExecutor(max_workers=self._runtime.executor_max_workers)
        self._runtime.temp_dir.mkdir(parents=True, exist_ok=True)

    @property
    def idle_heartbeat_seconds(self) -> int:
        """Expose SSE heartbeat interval to router."""
        return self._runtime.idle_heartbeat_seconds

    def shutdown(self) -> None:
        """Shutdown executor pool. Call on application teardown."""
        self._executor.shutdown(wait=False)

    async def enqueue(
        self,
        *,
        user_id: str,
        request: TranscriptProcessRequest,
        supabase: Client,
    ) -> str:
        """Create task and start detached runner."""
        record = await self._task_manager.create_task(user_id=user_id, request=request)
        runner = asyncio.create_task(
            self._run_task(
                task_id=record.task_id,
                user_id=user_id,
                request=request,
                supabase=supabase,
            )
        )
        await self._task_manager.attach_runner(
            task_id=record.task_id,
            user_id=user_id,
            runner=runner,
        )
        return record.task_id

    async def _run_task(
        self,
        *,
        task_id: str,
        user_id: str,
        request: TranscriptProcessRequest,
        supabase: Client,
    ) -> None:
        ai_service: TranscriptAiTextService | None = None
        work_dir = self._runtime.temp_dir / task_id
        work_dir.mkdir(parents=True, exist_ok=True)

        try:
            await self._task_manager.mark_running(
                task_id=task_id,
                user_id=user_id,
                message="任务已启动",
            )

            async with self._semaphore:
                await self._publish_progress(
                    task_id=task_id,
                    user_id=user_id,
                    stage="subtitle_probe",
                    progress=5,
                    message="正在检测内置字幕",
                )

                raw_transcript, video_title, detected_language, source_type = await self._resolve_source_text(
                    task_id=task_id,
                    user_id=user_id,
                    request=request,
                    work_dir=work_dir,
                )

                if request.enable_optimize or request.enable_summary or request.enable_translation:
                    try:
                        ai_service = TranscriptAiTextService.from_user_config(
                            supabase=supabase,
                            user_id=user_id,
                        )
                    except ConfigError as exc:
                        raise PipelineStageError(
                            stage="optimize",
                            code="missing_chat_config",
                            message="未配置可用 Chat API",
                            retryable=False,
                            details={"missing_types": exc.missing_types},
                        ) from exc

                optimized = raw_transcript
                if request.enable_optimize and ai_service:
                    await self._publish_progress(
                        task_id=task_id,
                        user_id=user_id,
                        stage="optimize",
                        progress=60,
                        message="正在优化转录文本",
                    )
                    try:
                        optimized = await self._run_stage_timeout(
                            stage="optimize",
                            coroutine=ai_service.optimize_transcript(raw_transcript=raw_transcript),
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        optimized = raw_transcript

                    await self._task_manager.publish_event(
                        task_id=task_id,
                        user_id=user_id,
                        event="artifact",
                        data=TranscriptArtifactEventData(
                            task_id=task_id,
                            stage="optimize",
                            artifact="optimized_transcript",
                            content=optimized,
                        ).model_dump(mode="json"),
                    )

                translation: str | None = None
                if request.enable_translation and ai_service and request.translation_language:
                    await self._publish_progress(
                        task_id=task_id,
                        user_id=user_id,
                        stage="translate",
                        progress=75,
                        message="正在翻译转录文本",
                    )
                    try:
                        translation = await self._run_stage_timeout(
                            stage="translate",
                            coroutine=ai_service.translate_transcript(
                                transcript=optimized,
                                target_language=request.translation_language,
                                source_language=detected_language,
                            ),
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        translation = None

                    if translation:
                        await self._task_manager.publish_event(
                            task_id=task_id,
                            user_id=user_id,
                            event="artifact",
                            data=TranscriptArtifactEventData(
                                task_id=task_id,
                                stage="translate",
                                artifact="translation",
                                content=translation,
                            ).model_dump(mode="json"),
                        )

                summary: str | None = None
                if request.enable_summary and ai_service:
                    await self._publish_progress(
                        task_id=task_id,
                        user_id=user_id,
                        stage="summarize",
                        progress=88,
                        message="正在生成摘要",
                    )
                    try:
                        summary = await self._run_stage_timeout(
                            stage="summarize",
                            coroutine=ai_service.summarize_transcript(
                                transcript=optimized,
                                target_language=request.summary_language,
                                video_title=video_title,
                            ),
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        summary = None

                    if summary:
                        await self._task_manager.publish_event(
                            task_id=task_id,
                            user_id=user_id,
                            event="artifact",
                            data=TranscriptArtifactEventData(
                                task_id=task_id,
                                stage="summarize",
                                artifact="summary",
                                content=summary,
                            ).model_dump(mode="json"),
                        )

                await self._publish_progress(
                    task_id=task_id,
                    user_id=user_id,
                    stage="finalize",
                    progress=96,
                    message="正在整理结果",
                )

                result = TranscriptArtifact(
                    source_url=request.url,
                    source_type=source_type,
                    video_title=video_title,
                    detected_language=detected_language,
                    transcript_raw=raw_transcript,
                    transcript_optimized=optimized,
                    summary=summary,
                    translation=translation,
                    summary_language=request.summary_language,
                    translation_language=request.translation_language,
                )
                await self._task_manager.mark_result(
                    task_id=task_id,
                    user_id=user_id,
                    result=result,
                )

                completed_at = datetime.now(timezone.utc)
                await self._task_manager.publish_event(
                    task_id=task_id,
                    user_id=user_id,
                    event="result",
                    data=TranscriptResultEventData(
                        task_id=task_id,
                        status="completed",
                        stage="completed",
                        result=result,
                        completed_at=completed_at,
                    ).model_dump(mode="json"),
                )
                await self._task_manager.mark_completed(
                    task_id=task_id,
                    user_id=user_id,
                    message="处理完成",
                )
                await self._task_manager.publish_event(
                    task_id=task_id,
                    user_id=user_id,
                    event="done",
                    data=TranscriptDoneEventData(
                        task_id=task_id,
                        status="completed",
                        stage="completed",
                        completed_at=completed_at,
                    ).model_dump(mode="json"),
                )
        except PipelineStageError as exc:
            await self._handle_failure(
                task_id=task_id,
                user_id=user_id,
                stage=exc.stage,
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                details=exc.details,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _logger.exception(
                "Unexpected pipeline error for task %s", task_id,
            )
            await self._handle_failure(
                task_id=task_id,
                user_id=user_id,
                stage="failed",
                code="unexpected_error",
                message="处理过程中发生意外错误",
                retryable=False,
                details={"error_type": type(exc).__name__},
            )
        finally:
            if ai_service:
                await ai_service.aclose()
            if not self._runtime.keep_temp_files:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    self._executor,
                    lambda: shutil.rmtree(work_dir, ignore_errors=True),
                )

    async def _resolve_source_text(
        self,
        *,
        task_id: str,
        user_id: str,
        request: TranscriptProcessRequest,
        work_dir: Path,
    ) -> tuple[str, str | None, str | None, str]:
        """Subtitle-first extraction, then Whisper fallback."""
        subtitle_result = None
        try:
            subtitle_result = await self._run_stage_timeout(
                stage="subtitle_probe",
                coroutine=self._subtitle_first_path(
                    task_id=task_id,
                    user_id=user_id,
                    request=request,
                    work_dir=work_dir,
                ),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            subtitle_result = None

        if subtitle_result:
            return subtitle_result

        await self._publish_progress(
            task_id=task_id,
            user_id=user_id,
            stage="audio_download",
            progress=20,
            message="字幕不可用，回退到 Whisper",
        )

        try:
            audio = await self._run_stage_timeout(
                stage="audio_download",
                coroutine=self._media.download_audio(
                    url=request.url,
                    work_dir=work_dir,
                    executor=self._executor,
                ),
            )
        except MediaDownloadError as exc:
            raise PipelineStageError(
                stage="audio_download",
                code="audio_download_failed",
                message=str(exc),
                retryable=True,
            ) from exc

        await self._publish_progress(
            task_id=task_id,
            user_id=user_id,
            stage="transcribe",
            progress=40,
            message="正在进行语音转录",
        )

        try:
            transcript = await self._run_stage_timeout(
                stage="transcribe",
                coroutine=self._whisper.transcribe_audio(
                    audio_path=audio.audio_path,
                    language=request.whisper_language,
                    executor=self._executor,
                ),
            )
        except WhisperTranscriptionError as exc:
            raise PipelineStageError(
                stage="transcribe",
                code="whisper_failed",
                message=f"Whisper 转录失败: {exc}",
                retryable=True,
            ) from exc

        await self._task_manager.publish_event(
            task_id=task_id,
            user_id=user_id,
            event="artifact",
            data=TranscriptArtifactEventData(
                task_id=task_id,
                stage="transcribe",
                artifact="raw_transcript",
                content=transcript,
            ).model_dump(mode="json"),
        )

        detected = self._whisper.detect_language(markdown_text=transcript)
        return transcript, audio.video_title, detected, "whisper"

    async def _subtitle_first_path(
        self,
        *,
        task_id: str,
        user_id: str,
        request: TranscriptProcessRequest,
        work_dir: Path,
    ) -> tuple[str, str | None, str | None, str] | None:
        video_title, tracks = await self._subtitle.probe_tracks(
            url=request.url,
            executor=self._executor,
        )
        if not tracks:
            return None

        try:
            track = self._subtitle.select_best_track(
                tracks=tracks,
                preferred_lang=request.summary_language,
            )
        except SubtitleUnavailableError:
            return None

        await self._publish_progress(
            task_id=task_id,
            user_id=user_id,
            stage="subtitle_download",
            progress=12,
            message="检测到字幕，正在下载字幕轨道",
        )

        try:
            subtitle_path = await self._run_stage_timeout(
                stage="subtitle_download",
                coroutine=self._subtitle.download_track(
                    url=request.url,
                    track=track,
                    work_dir=work_dir,
                    executor=self._executor,
                ),
            )
        except (SubtitleUnavailableError, SubtitleDownloadError):
            return None

        loop = asyncio.get_running_loop()
        transcript = await loop.run_in_executor(
            self._executor,
            lambda: self._subtitle.parse_to_markdown(
                subtitle_path=subtitle_path,
                language=track.lang_code,
            ),
        )

        too_short = await loop.run_in_executor(
            self._executor,
            lambda: self._subtitle.is_content_too_short(markdown_text=transcript),
        )
        if too_short:
            return None

        await self._task_manager.publish_event(
            task_id=task_id,
            user_id=user_id,
            event="artifact",
            data=TranscriptArtifactEventData(
                task_id=task_id,
                stage="subtitle_download",
                artifact="raw_transcript",
                content=transcript,
            ).model_dump(mode="json"),
        )
        return transcript, video_title, track.lang_code, "subtitle"

    async def _publish_progress(
        self,
        *,
        task_id: str,
        user_id: str,
        stage: TranscriptStage,
        progress: int,
        message: str,
    ) -> None:
        await self._task_manager.mark_progress(
            task_id=task_id,
            user_id=user_id,
            stage=stage,
            progress=progress,
            message=message,
            status="running",
        )
        await self._task_manager.publish_event(
            task_id=task_id,
            user_id=user_id,
            event="progress",
            data=TranscriptProgressEventData(
                task_id=task_id,
                status="running",
                stage=stage,
                progress=progress,
                message=message,
                updated_at=datetime.now(timezone.utc),
            ).model_dump(mode="json"),
        )

    async def _handle_failure(
        self,
        *,
        task_id: str,
        user_id: str,
        stage: TranscriptStage,
        code: str,
        message: str,
        retryable: bool,
        details: dict[str, Any] | None,
    ) -> None:
        await self._task_manager.mark_failed(
            task_id=task_id,
            user_id=user_id,
            stage=stage,
            code=code,
            message=message,
            details=details,
        )
        await self._task_manager.publish_event(
            task_id=task_id,
            user_id=user_id,
            event="error",
            data=TranscriptErrorEventData(
                task_id=task_id,
                status="failed",
                stage=stage,
                code=code,
                message=message,
                retryable=retryable,
                details=details,
                failed_at=datetime.now(timezone.utc),
            ).model_dump(mode="json"),
        )

    async def _run_stage_timeout(
        self,
        *,
        stage: TranscriptStage,
        coroutine: Awaitable[_T],
    ) -> _T:
        timeout = self._runtime.stage_timeout_seconds.get(stage, 600)
        try:
            async with asyncio.timeout(timeout):
                return await coroutine
        except TimeoutError as exc:
            raise PipelineStageError(
                stage=stage,
                code="stage_timeout",
                message=f"{stage} exceeded timeout {timeout}s",
                retryable=True,
            ) from exc


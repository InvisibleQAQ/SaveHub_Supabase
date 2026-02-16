"""Transcript pipeline request/response/event schemas."""

import ipaddress
import re
from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator


# SSRF 防护：禁止内网/环回/链路本地地址
_BLOCKED_HOSTNAMES = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}
_BLOCKED_SUFFIXES = (".local", ".internal", ".localhost")


def _validate_video_url(url: str) -> str:
    """校验 URL 协议和主机，防止 SSRF。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("仅支持 http/https 协议")
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("URL 缺少主机名")
    if hostname in _BLOCKED_HOSTNAMES or any(hostname.endswith(s) for s in _BLOCKED_SUFFIXES):
        raise ValueError("不允许访问内网地址")
    try:
        addr = ipaddress.ip_address(hostname)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            raise ValueError("不允许访问内网地址")
    except ValueError as exc:
        if "不允许" in str(exc):
            raise
        # hostname 不是 IP，跳过
    # 简单格式检查：至少有域名部分
    if "." not in hostname and ":" not in hostname:
        raise ValueError("无效的主机名")
    return url


TranscriptStage = Literal[
    "queued",
    "subtitle_probe",
    "subtitle_download",
    "audio_download",
    "transcribe",
    "optimize",
    "translate",
    "summarize",
    "finalize",
    "completed",
    "failed",
]


TranscriptTaskStatus = Literal["queued", "running", "completed", "failed", "expired"]


TranscriptSseEventName = Literal[
    "accepted",
    "progress",
    "artifact",
    "result",
    "done",
    "error",
    "heartbeat",
]


class TranscriptProcessRequest(BaseModel):
    """POST /api/transcripts/process request model."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., min_length=8, max_length=2048, description="视频 URL")

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        return _validate_video_url(v)
    summary_language: str = Field(
        default="zh",
        min_length=2,
        max_length=16,
        description="摘要目标语言",
    )
    translation_language: str | None = Field(
        default=None,
        min_length=2,
        max_length=16,
        description="翻译目标语言（enable_translation=true 时使用）",
    )
    whisper_language: str | None = Field(
        default=None,
        min_length=2,
        max_length=16,
        description="Whisper 指定语言（可选）",
    )
    enable_optimize: bool = Field(default=True, description="是否执行转录文本优化")
    enable_summary: bool = Field(default=True, description="是否生成摘要")
    enable_translation: bool = Field(default=False, description="是否生成翻译")


class TranscriptProcessResponse(BaseModel):
    """POST /api/transcripts/process response model."""

    task_id: str
    status: Literal["accepted"]
    stream_url: str


class TranscriptArtifact(BaseModel):
    """Final transcript artifact payload."""

    source_url: str
    source_type: Literal["subtitle", "whisper"]
    video_title: str | None = None
    detected_language: str | None = None
    transcript_raw: str
    transcript_optimized: str | None = None
    summary: str | None = None
    translation: str | None = None
    summary_language: str
    translation_language: str | None = None


class TranscriptTaskSnapshotResponse(BaseModel):
    """Task snapshot used by stream bootstrap."""

    task_id: str
    status: TranscriptTaskStatus
    stage: TranscriptStage
    progress: int = Field(ge=0, le=100)
    message: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime


class TranscriptAcceptedEventData(BaseModel):
    task_id: str
    status: TranscriptTaskStatus
    stage: TranscriptStage
    progress: int = Field(ge=0, le=100)
    message: str
    created_at: datetime


class TranscriptProgressEventData(BaseModel):
    task_id: str
    status: TranscriptTaskStatus
    stage: TranscriptStage
    progress: int = Field(ge=0, le=100)
    message: str
    updated_at: datetime


class TranscriptArtifactEventData(BaseModel):
    task_id: str
    stage: TranscriptStage
    artifact: Literal["raw_transcript", "optimized_transcript", "summary", "translation"]
    content: str


class TranscriptResultEventData(BaseModel):
    task_id: str
    status: Literal["completed"]
    stage: Literal["completed"]
    result: TranscriptArtifact
    completed_at: datetime


class TranscriptDoneEventData(BaseModel):
    task_id: str
    status: Literal["completed"]
    stage: Literal["completed"]
    completed_at: datetime


class TranscriptErrorEventData(BaseModel):
    task_id: str
    status: Literal["failed"]
    stage: TranscriptStage
    code: str
    message: str
    retryable: bool = False
    details: dict[str, Any] | None = None
    failed_at: datetime


class TranscriptHeartbeatEventData(BaseModel):
    task_id: str
    server_time: datetime


class TranscriptSseEnvelope(BaseModel):
    """Logical envelope for SSE event/data payload."""

    event: TranscriptSseEventName
    data: dict[str, Any]


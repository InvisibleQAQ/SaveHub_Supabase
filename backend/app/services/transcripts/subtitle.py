"""Subtitle stage: probe/select/download/parse subtitle tracks."""

import asyncio
import html
import re
from concurrent.futures import Executor
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yt_dlp


class SubtitleUnavailableError(Exception):
    """Raised when no subtitle track is available."""


class SubtitleDownloadError(Exception):
    """Raised when subtitle track download fails."""


@dataclass(frozen=True)
class SubtitleTrack:
    """Normalized subtitle track descriptor."""

    lang_code: str
    track_key: str
    source_type: str
    formats: list[dict]


class SubtitleService:
    """Subtitle processing service."""

    def __init__(self):
        self._probe_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "listsubtitles": True,
        }
        self._default_format = "vtt/srt/best"
        self._invalid_tokens = ("live_chat", "chat", "comments")

    async def probe_tracks(
        self,
        *,
        url: str,
        executor: Executor | None = None,
    ) -> tuple[str, list[SubtitleTrack]]:
        """Probe subtitle and auto-caption tracks for a video URL."""
        loop = asyncio.get_running_loop()

        def _sync() -> tuple[str, list[SubtitleTrack]]:
            with yt_dlp.YoutubeDL(self._probe_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            video_title = info.get("title", "unknown")
            subtitles = info.get("subtitles") or {}
            auto = info.get("automatic_captions") or {}

            tracks: list[SubtitleTrack] = []
            for lang_code, formats in subtitles.items():
                if self._is_non_transcript_track(lang_code):
                    continue
                tracks.append(
                    SubtitleTrack(
                        lang_code=lang_code,
                        track_key=lang_code,
                        source_type="manual",
                        formats=formats or [],
                    )
                )

            for lang_code, formats in auto.items():
                if self._is_non_transcript_track(lang_code):
                    continue
                tracks.append(
                    SubtitleTrack(
                        lang_code=lang_code,
                        track_key=lang_code,
                        source_type="automatic",
                        formats=formats or [],
                    )
                )

            return video_title, tracks

        return await loop.run_in_executor(executor, _sync)

    def select_best_track(
        self,
        *,
        tracks: list[SubtitleTrack],
        preferred_lang: str,
    ) -> SubtitleTrack:
        """Select best subtitle track by source and language fit."""
        if not tracks:
            raise SubtitleUnavailableError("No subtitle tracks available")

        preferred_norm = self._normalize_lang(preferred_lang)
        preferred_base = preferred_norm.split("-")[0] if preferred_norm else ""

        def _rank(track: SubtitleTrack) -> tuple[int, int, str]:
            source_priority = 0 if track.source_type == "manual" else 1
            lang_norm = self._normalize_lang(track.lang_code)
            lang_base = lang_norm.split("-")[0] if lang_norm else ""
            if preferred_norm and lang_norm == preferred_norm:
                lang_priority = 0
            elif preferred_base and lang_base == preferred_base:
                lang_priority = 1
            else:
                lang_priority = 2
            return source_priority, lang_priority, track.lang_code

        return sorted(tracks, key=_rank)[0]

    async def download_track(
        self,
        *,
        url: str,
        track: SubtitleTrack,
        work_dir: Path,
        executor: Executor | None = None,
    ) -> Path:
        """Download selected track into local filesystem."""
        work_dir.mkdir(parents=True, exist_ok=True)
        loop = asyncio.get_running_loop()
        token = uuid4().hex[:8]
        output_template = str(work_dir / f"subtitle_{token}.%(ext)s")

        def _sync() -> Path:
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "outtmpl": output_template,
                "writesubtitles": track.source_type == "manual",
                "writeautomaticsub": track.source_type == "automatic",
                "subtitleslangs": [track.track_key or track.lang_code],
                "subtitlesformat": self._default_format,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            for ext in ("vtt", "srt"):
                candidates = sorted(work_dir.glob(f"subtitle_{token}*.{ext}"))
                if candidates:
                    return candidates[0]

            raise SubtitleDownloadError("Subtitle downloaded but local file not found")

        return await loop.run_in_executor(executor, _sync)

    def parse_to_markdown(self, *, subtitle_path: Path, language: str) -> str:
        """Parse SRT/VTT subtitle into normalized transcript markdown."""
        suffix = subtitle_path.suffix.lower().lstrip(".")
        if suffix == "vtt":
            segments = self._parse_vtt(subtitle_path)
        elif suffix == "srt":
            segments = self._parse_srt(subtitle_path)
        else:
            raise ValueError(f"Unsupported subtitle format: {suffix}")

        if not segments:
            raise ValueError("Subtitle parse produced no segments")

        deduped: list[tuple[float, float, str]] = []
        for start, end, text in segments:
            cleaned = text.strip()
            if not cleaned:
                continue
            if deduped and deduped[-1][2] == cleaned:
                continue
            deduped.append((start, end, cleaned))

        if not deduped:
            raise ValueError("Subtitle parse produced empty content")

        normalized_lang = self._normalize_lang(language) or "unknown"
        lines = [
            "# Video Transcription",
            "",
            f"**Detected Language:** {normalized_lang}",
            "**Language Probability:** 1.00",
            "**Source:** subtitle",
            "",
            "## Transcription Content",
            "",
        ]

        for start, end, text in deduped:
            lines.append(f"**[{self._format_time(start)} - {self._format_time(end)}]**")
            lines.append("")
            lines.append(text)
            lines.append("")

        return "\n".join(lines)

    def is_content_too_short(
        self,
        *,
        markdown_text: str,
        min_chars: int = 50,
        min_segments: int = 2,
    ) -> bool:
        """Validate subtitle quality threshold before trusting subtitle path."""
        if not markdown_text:
            return True

        ts_pattern = re.compile(
            r"^\*\*\[\d{2}:\d{2}(?::\d{2})?\s-\s\d{2}:\d{2}(?::\d{2})?\]\*\*$"
        )
        segment_count = 0
        content_chars = 0
        skip_prefixes = ("#", "**Detected Language:**", "**Language Probability:**", "**Source:**")

        for line in markdown_text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if any(stripped.startswith(prefix) for prefix in skip_prefixes):
                continue
            if ts_pattern.match(stripped):
                segment_count += 1
                continue
            content_chars += len(stripped)

        return segment_count < min_segments or content_chars < min_chars

    def _is_non_transcript_track(self, lang_code: str) -> bool:
        code = (lang_code or "").lower().strip()
        return any(token in code for token in self._invalid_tokens)

    @staticmethod
    def _normalize_lang(lang_code: Optional[str]) -> str:
        if not lang_code:
            return ""
        return lang_code.strip().lower().replace("_", "-")

    def _parse_vtt(self, subtitle_path: Path) -> list[tuple[float, float, str]]:
        lines = subtitle_path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        return self._parse_subtitle_lines(lines)

    def _parse_srt(self, subtitle_path: Path) -> list[tuple[float, float, str]]:
        lines = subtitle_path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        return self._parse_subtitle_lines(lines)

    def _parse_subtitle_lines(self, lines: list[str]) -> list[tuple[float, float, str]]:
        segments: list[tuple[float, float, str]] = []
        current_start: float | None = None
        current_end: float | None = None
        current_text: list[str] = []

        def flush() -> None:
            nonlocal current_start, current_end, current_text
            if current_start is not None and current_end is not None and current_text:
                text = self._clean_subtitle_text(" ".join(current_text))
                if text:
                    segments.append((current_start, current_end, text))
            current_start = None
            current_end = None
            current_text = []

        for raw in lines:
            line = raw.strip()
            if not line:
                flush()
                continue
            if line.startswith("WEBVTT") or line.startswith("NOTE") or line.startswith("STYLE"):
                continue
            if line.isdigit():
                continue
            if "-->" in line:
                flush()
                left, right = line.split("-->", 1)
                current_start = self._parse_timestamp(left.strip())
                current_end = self._parse_timestamp(right.strip().split()[0])
                continue
            if current_start is not None:
                current_text.append(line)

        flush()
        return segments

    @staticmethod
    def _parse_timestamp(value: str) -> float:
        value = value.replace(",", ".")
        parts = value.split(":")
        if len(parts) == 3:
            hours, minutes, seconds = parts
        elif len(parts) == 2:
            hours = "0"
            minutes, seconds = parts
        else:
            raise ValueError(f"Invalid subtitle timestamp: {value}")
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    @staticmethod
    def _clean_subtitle_text(text: str) -> str:
        cleaned = re.sub(r"<[^>]+>", "", text or "")
        cleaned = html.unescape(cleaned)
        return re.sub(r"\s+", " ", cleaned).strip()

    @staticmethod
    def _format_time(seconds: float) -> str:
        total = int(seconds)
        hours = total // 3600
        minutes = (total % 3600) // 60
        secs = total % 60
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"


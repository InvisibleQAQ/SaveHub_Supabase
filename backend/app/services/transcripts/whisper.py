"""Faster-Whisper CPU transcription service."""

import asyncio
import threading
from concurrent.futures import Executor
from pathlib import Path
from typing import Optional

from faster_whisper import WhisperModel


class WhisperTranscriptionError(Exception):
    """Raised when whisper model loading or transcription fails."""


class WhisperTranscriber:
    """Lazy-loaded faster-whisper adapter."""

    def __init__(
        self,
        *,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
    ):
        self._model_size = model_size
        self._device = device
        self._compute_type = compute_type
        self._model: WhisperModel | None = None
        self._model_lock = threading.Lock()
        self._last_detected_language: str | None = None

    async def transcribe_audio(
        self,
        *,
        audio_path: Path,
        language: Optional[str] = None,
        executor: Executor | None = None,
    ) -> str:
        """Transcribe audio into markdown transcript."""
        if not audio_path.exists():
            raise WhisperTranscriptionError(f"Audio file not found: {audio_path}")

        loop = asyncio.get_running_loop()

        def _sync() -> str:
            model = self._get_model()
            segments, info = model.transcribe(
                str(audio_path),
                language=language,
                beam_size=5,
                best_of=5,
                temperature=[0.0, 0.2, 0.4],
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 900, "speech_pad_ms": 300},
                no_speech_threshold=0.7,
                compression_ratio_threshold=2.3,
                log_prob_threshold=-1.0,
                condition_on_previous_text=False,
            )

            detected = info.language
            self._last_detected_language = detected

            lines = [
                "# Video Transcription",
                "",
                f"**Detected Language:** {detected}",
                f"**Language Probability:** {info.language_probability:.2f}",
                "**Source:** whisper",
                "",
                "## Transcription Content",
                "",
            ]

            for segment in segments:
                start = self._format_time(segment.start)
                end = self._format_time(segment.end)
                text = segment.text.strip()
                lines.append(f"**[{start} - {end}]**")
                lines.append("")
                lines.append(text)
                lines.append("")

            return "\n".join(lines)

        try:
            return await loop.run_in_executor(executor, _sync)
        except Exception as exc:
            raise WhisperTranscriptionError(f"Whisper transcribe failed: {exc}") from exc

    def detect_language(self, *, markdown_text: str | None = None) -> str | None:
        """Extract detected language from transcript markdown when possible."""
        if markdown_text and "**Detected Language:**" in markdown_text:
            for line in markdown_text.splitlines():
                if "**Detected Language:**" in line:
                    return line.split(":")[-1].strip()
        return self._last_detected_language

    def _get_model(self) -> WhisperModel:
        if self._model is not None:
            return self._model

        with self._model_lock:
            if self._model is None:
                self._model = WhisperModel(
                    self._model_size,
                    device=self._device,
                    compute_type=self._compute_type,
                )

        return self._model

    @staticmethod
    def _format_time(seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"


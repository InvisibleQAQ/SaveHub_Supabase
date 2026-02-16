"""ChatClient adapter for transcript optimize/summary/translate."""

from dataclasses import dataclass
from typing import Optional

from supabase import Client

from app.services.ai import ChatClient, ConfigError, get_user_ai_configs


@dataclass
class AiTextRuntimeConfig:
    """AI text stage runtime tuning."""

    optimize_chunk_chars: int = 4000
    translate_chunk_chars: int = 4000
    summarize_chunk_chars: int = 4000
    optimize_max_tokens: int = 2200
    translate_max_tokens: int = 2200
    summarize_max_tokens: int = 3000


class TranscriptAiTextService:
    """AI stage service for transcript text operations."""

    def __init__(self, *, chat_client: ChatClient, runtime: AiTextRuntimeConfig | None = None):
        self._chat = chat_client
        self._runtime = runtime or AiTextRuntimeConfig()

    @classmethod
    def from_user_config(
        cls,
        *,
        supabase: Client,
        user_id: str,
        runtime: AiTextRuntimeConfig | None = None,
    ) -> "TranscriptAiTextService":
        """Build service from per-user encrypted active chat config."""
        configs = get_user_ai_configs(supabase, user_id)
        chat = configs.get("chat")
        if not chat:
            raise ConfigError("Missing required AI configs: chat", missing_types=["chat"])
        return cls(chat_client=ChatClient(**chat), runtime=runtime)

    async def aclose(self) -> None:
        """Close underlying ChatClient."""
        await self._chat.aclose()

    async def optimize_transcript(self, *, raw_transcript: str) -> str:
        """Optimize transcript quality while preserving source language and meaning."""
        text = self._remove_timestamps_and_meta(raw_transcript)
        if not text.strip():
            return raw_transcript

        chunks = self._split_chunks(text, self._runtime.optimize_chunk_chars)
        optimized_chunks: list[str] = []

        for chunk in chunks:
            system_prompt = (
                "你是专业的转录文本优化助手。保留原意与原语言，不翻译，不删减事实。"
                "仅修正明显错别字、标点和断句。输出纯文本段落。"
            )
            user_prompt = f"请优化以下转录文本：\n\n{chunk}"
            try:
                content = await self._chat.complete(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                    max_tokens=self._runtime.optimize_max_tokens,
                )
                optimized_chunks.append(content.strip())
            except Exception:
                optimized_chunks.append(chunk)

        result = "\n\n".join(part for part in optimized_chunks if part).strip()
        return result or raw_transcript

    async def summarize_transcript(
        self,
        *,
        transcript: str,
        target_language: str,
        video_title: str | None = None,
    ) -> str:
        """Generate summary from transcript."""
        language_name = self._language_name(target_language)
        chunks = self._split_chunks(transcript, self._runtime.summarize_chunk_chars)

        try:
            if len(chunks) == 1:
                summary = await self._summarize_single(chunks[0], language_name)
            else:
                partials: list[str] = []
                for chunk in chunks:
                    partials.append(await self._summarize_single(chunk, language_name))
                summary = await self._integrate_summaries(partials, language_name)
            return self._format_summary(summary, video_title)
        except Exception:
            return self._fallback_summary(
                transcript=transcript,
                language_name=language_name,
                video_title=video_title,
            )

    async def translate_transcript(
        self,
        *,
        transcript: str,
        target_language: str,
        source_language: Optional[str] = None,
    ) -> str:
        """Translate transcript into target language."""
        source = source_language or self._detect_language_from_transcript(transcript)
        if not self.should_translate(source_language=source, target_language=target_language):
            return transcript

        target_name = self._language_name(target_language)
        source_name = self._language_name(source)
        chunks = self._split_chunks(transcript, self._runtime.translate_chunk_chars)
        translated_chunks: list[str] = []

        for chunk in chunks:
            system_prompt = (
                f"你是专业翻译助手。请将{source_name}准确翻译为{target_name}。"
                "保持原始结构，不要添加额外解释。"
            )
            user_prompt = f"请翻译以下文本：\n\n{chunk}"
            try:
                translated = await self._chat.complete(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                    max_tokens=self._runtime.translate_max_tokens,
                )
                translated_chunks.append(translated.strip())
            except Exception:
                translated_chunks.append(chunk)

        merged = "\n\n".join(part for part in translated_chunks if part).strip()
        return merged or transcript

    @staticmethod
    def should_translate(*, source_language: str | None, target_language: str | None) -> bool:
        """Return whether translation stage should run."""
        if not source_language or not target_language:
            return False

        source = source_language.lower().strip()
        target = target_language.lower().strip()
        if source == target:
            return False

        zh_variants = {"zh", "zh-cn", "zh-hans", "chinese"}
        if source in zh_variants and target in zh_variants:
            return False
        return True

    async def _summarize_single(self, text: str, language_name: str) -> str:
        content = await self._chat.complete(
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"你是内容分析助手。请用{language_name}生成结构清晰、信息完整的摘要。"
                    ),
                },
                {"role": "user", "content": text},
            ],
            temperature=0.3,
            max_tokens=self._runtime.summarize_max_tokens,
        )
        return content.strip()

    async def _integrate_summaries(self, partials: list[str], language_name: str) -> str:
        merged = "\n\n".join(
            f"[Part {index + 1}]\n{part}" for index, part in enumerate(partials)
        )
        content = await self._chat.complete(
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"你是摘要整合助手。请将多个分段摘要整合为一份完整的{language_name}摘要。"
                    ),
                },
                {"role": "user", "content": merged},
            ],
            temperature=0.2,
            max_tokens=2400,
        )
        return content.strip()

    @staticmethod
    def _remove_timestamps_and_meta(text: str) -> str:
        lines: list[str] = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("**[") and stripped.endswith("]**"):
                continue
            if stripped.startswith("**Detected Language:**"):
                continue
            if stripped.startswith("**Language Probability:**"):
                continue
            if stripped.startswith("**Source:**"):
                continue
            if stripped.startswith("# "):
                continue
            lines.append(line)
        return "\n".join(lines).strip()

    @staticmethod
    def _split_chunks(text: str, max_chars: int) -> list[str]:
        if len(text) <= max_chars:
            return [text]

        chunks: list[str] = []
        current = ""
        paragraphs = [part for part in text.split("\n\n") if part.strip()]
        for paragraph in paragraphs:
            candidate = (current + "\n\n" + paragraph).strip() if current else paragraph
            if len(candidate) > max_chars and current:
                chunks.append(current.strip())
                current = paragraph
            else:
                current = candidate
        if current.strip():
            chunks.append(current.strip())
        return chunks or [text]

    @staticmethod
    def _detect_language_from_transcript(transcript: str) -> str:
        for line in transcript.splitlines():
            if "**Detected Language:**" in line:
                return line.split(":")[-1].strip()
        return "en"

    @staticmethod
    def _language_name(code: str | None) -> str:
        mapping = {
            "zh": "中文（简体）",
            "zh-cn": "中文（简体）",
            "en": "English",
            "ja": "日本語",
            "ko": "한국어",
            "es": "Español",
            "fr": "Français",
            "de": "Deutsch",
        }
        key = (code or "en").lower()
        return mapping.get(key, code or "English")

    @staticmethod
    def _format_summary(summary: str, video_title: str | None) -> str:
        if not video_title:
            return summary
        return f"# {video_title}\n\n{summary}"

    @staticmethod
    def _fallback_summary(*, transcript: str, language_name: str, video_title: str | None) -> str:
        title = video_title or "Summary"
        char_count = len(transcript)
        return (
            f"# {title}\n\n"
            f"语言: {language_name}\n\n"
            "摘要生成失败，返回降级结果。\n\n"
            f"原文长度: {char_count} 字符。"
        )


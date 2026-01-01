"""
AI Service for repository analysis.

Analyzes README content using OpenAI-compatible API to extract:
- Summary: Brief description of the repository
- Tags: Technical tags/keywords
- Platforms: Supported platforms (Windows, macOS, Linux, Web, etc.)
"""

import logging
import httpx
import json
from typing import Optional

from app.services.encryption import decrypt, is_encrypted

logger = logging.getLogger(__name__)

# System prompt for repository analysis
ANALYSIS_PROMPT = """你是一个专业的GitHub仓库分析助手。请分析以下仓库的README内容，并提取关键信息。

请以JSON格式返回以下信息：
1. summary: 用中文简洁描述这个仓库的主要功能和用途（50-100字）
2. tags: 提取3-5个技术标签（如：React, TypeScript, CLI, API等）
3. platforms: 识别支持的平台（可选值：Windows, macOS, Linux, iOS, Android, Web, CLI, Docker）

只返回JSON，不要有其他内容。格式示例：
{
  "summary": "这是一个...",
  "tags": ["React", "TypeScript", "UI"],
  "platforms": ["Web", "macOS", "Windows"]
}

如果无法确定某个字段，使用空数组或空字符串。"""


class AIService:
    """Service for AI-powered repository analysis."""

    def __init__(self, api_key: str, api_base: str, model: str):
        """
        Initialize AI service.

        Args:
            api_key: Decrypted API key
            api_base: Decrypted API base URL
            model: Model name to use
        """
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.model = model

    async def analyze_repository(
        self,
        readme_content: str,
        repo_name: str,
        description: Optional[str] = None
    ) -> dict:
        """
        Analyze repository README content.

        Args:
            readme_content: README markdown content
            repo_name: Repository full name (owner/repo)
            description: Optional repository description

        Returns:
            Dict with summary, tags, platforms
        """
        # Build user message
        user_message = f"仓库名称: {repo_name}\n"
        if description:
            user_message += f"仓库描述: {description}\n"
        user_message += f"\nREADME内容:\n{readme_content[:8000]}"  # Limit content

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": ANALYSIS_PROMPT},
                            {"role": "user", "content": user_message},
                        ],
                        "temperature": 0.3,
                        "max_tokens": 500,
                    },
                )

                if response.status_code != 200:
                    logger.error(
                        f"AI API error: {response.status_code}",
                        extra={"response": response.text[:500]}
                    )
                    raise Exception(f"AI API error: {response.status_code}")

                data = response.json()
                content = data["choices"][0]["message"]["content"]

                # Parse JSON response
                result = self._parse_response(content)
                logger.info(
                    f"Repository analyzed: {repo_name}",
                    extra={"tags": result.get("tags", [])}
                )
                return result

        except httpx.TimeoutException:
            logger.error(f"AI API timeout for {repo_name}")
            raise Exception("AI API timeout")
        except Exception as e:
            logger.error(f"AI analysis failed: {e}", exc_info=True)
            raise

    def _parse_response(self, content: str) -> dict:
        """Parse AI response JSON."""
        try:
            # Try to extract JSON from response
            content = content.strip()

            # Handle markdown code blocks
            if content.startswith("```"):
                lines = content.split("\n")
                json_lines = []
                in_json = False
                for line in lines:
                    if line.startswith("```") and not in_json:
                        in_json = True
                        continue
                    elif line.startswith("```") and in_json:
                        break
                    elif in_json:
                        json_lines.append(line)
                content = "\n".join(json_lines)

            result = json.loads(content)

            # Validate and normalize
            return {
                "ai_summary": result.get("summary", ""),
                "ai_tags": result.get("tags", [])[:10],  # Limit tags
                "ai_platforms": self._normalize_platforms(
                    result.get("platforms", [])
                ),
            }
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse AI response: {e}")
            return {
                "ai_summary": content[:200] if content else "",
                "ai_tags": [],
                "ai_platforms": [],
            }

    def _normalize_platforms(self, platforms: list) -> list:
        """Normalize platform names."""
        valid_platforms = {
            "windows", "macos", "linux", "ios", "android",
            "web", "cli", "docker"
        }
        normalized = []
        for p in platforms:
            p_lower = p.lower().strip()
            # Map common variations
            if p_lower in ("mac", "osx"):
                p_lower = "macos"
            elif p_lower in ("win", "win32", "win64"):
                p_lower = "windows"
            elif p_lower in ("terminal", "shell", "command-line"):
                p_lower = "cli"

            if p_lower in valid_platforms and p_lower not in normalized:
                normalized.append(p_lower.capitalize())

        return normalized[:6]  # Limit platforms


def create_ai_service_from_config(config: dict) -> AIService:
    """
    Create AIService from API config dict.

    Handles decryption of api_key and api_base if encrypted.
    """
    api_key = config["api_key"]
    api_base = config["api_base"]

    # Decrypt if encrypted
    if is_encrypted(api_key):
        api_key = decrypt(api_key)
    if is_encrypted(api_base):
        api_base = decrypt(api_base)

    return AIService(
        api_key=api_key,
        api_base=api_base,
        model=config["model"],
    )

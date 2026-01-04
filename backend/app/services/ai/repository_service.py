"""
Repository AI analysis service.

Analyzes README content using ChatClient to extract:
- Summary: Brief description of the repository
- Tags: Technical tags/keywords
- Platforms: Supported platforms (Windows, macOS, Linux, Web, etc.)
"""

import logging
import asyncio
import json
from typing import Optional, Callable, Awaitable

from .clients import ChatClient

logger = logging.getLogger(__name__)


def _format_error_chain(e: Exception) -> str:
    """Extract full error chain for detailed logging."""
    def format_single(ex: Exception) -> str:
        name = type(ex).__name__
        msg = str(ex)
        if not msg and ex.args:
            msg = str(ex.args[0]) if len(ex.args) == 1 else str(ex.args)
        if not msg:
            msg = repr(ex)
        return f"{name}: {msg}"

    parts = [format_single(e)]
    seen = {id(e)}

    current = e
    while True:
        next_ex = current.__cause__ or current.__context__
        if next_ex is None or id(next_ex) in seen:
            break
        seen.add(id(next_ex))
        parts.append(f" <- {format_single(next_ex)}")
        current = next_ex

    return "".join(parts)


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


class RepositoryAnalyzerService:
    """Service for AI-powered repository analysis."""

    # Language to platform mapping for fallback analysis
    LANG_PLATFORM_MAP = {
        "JavaScript": ["Web", "Cli"],
        "TypeScript": ["Web", "Cli"],
        "Python": ["Linux", "Macos", "Windows", "Cli"],
        "Java": ["Linux", "Macos", "Windows"],
        "Go": ["Linux", "Macos", "Windows", "Cli"],
        "Rust": ["Linux", "Macos", "Windows", "Cli"],
        "C++": ["Linux", "Macos", "Windows"],
        "C": ["Linux", "Macos", "Windows"],
        "Swift": ["Ios", "Macos"],
        "Kotlin": ["Android"],
        "Dart": ["Ios", "Android"],
        "Shell": ["Linux", "Macos", "Cli"],
        "PHP": ["Web", "Linux"],
        "Ruby": ["Web", "Linux", "Macos"],
    }

    # Keyword to platform mapping for fallback analysis
    KEYWORD_PLATFORM_MAP = {
        "web": ["Web"],
        "frontend": ["Web"],
        "browser": ["Web"],
        "react": ["Web"],
        "vue": ["Web"],
        "angular": ["Web"],
        "ios": ["Ios"],
        "iphone": ["Ios"],
        "ipad": ["Ios"],
        "android": ["Android"],
        "mobile": ["Ios", "Android"],
        "desktop": ["Windows", "Macos", "Linux"],
        "electron": ["Windows", "Macos", "Linux"],
        "tauri": ["Windows", "Macos", "Linux"],
        "cli": ["Cli"],
        "terminal": ["Cli"],
        "command-line": ["Cli"],
        "docker": ["Docker"],
        "container": ["Docker"],
        "kubernetes": ["Docker"],
        "windows": ["Windows"],
        "macos": ["Macos"],
        "mac": ["Macos"],
        "linux": ["Linux"],
        "ubuntu": ["Linux"],
    }

    def __init__(self, api_key: str, api_base: str, model: str):
        """
        Initialize the repository analyzer service.

        Args:
            api_key: API key (already decrypted)
            api_base: API base URL (already normalized)
            model: Model name to use
        """
        self.chat_client = ChatClient(
            api_key=api_key,
            api_base=api_base,
            model=model,
        )

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
            Dict with ai_summary, ai_tags, ai_platforms
        """
        # Build user message
        user_message = f"仓库名称: {repo_name}\n"
        if description:
            user_message += f"仓库描述: {description}\n"
        user_message += f"\nREADME内容:\n{readme_content[:8000]}"

        try:
            content = await self.chat_client.complete(
                messages=[
                    {"role": "system", "content": ANALYSIS_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.3,
                max_tokens=2048,
            )

            result = self._parse_response(content)
            logger.info(
                f"Repository analyzed: {repo_name}",
                extra={"tags": result.get("ai_tags", [])}
            )
            return result

        except Exception as e:
            logger.warning(
                f"AI analysis failed for {repo_name}: "
                f"{_format_error_chain(e)}"
            )
            raise

    def _parse_response(self, content: str) -> dict:
        """Parse AI response JSON."""
        try:
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

            return {
                "ai_summary": result.get("summary", ""),
                "ai_tags": result.get("tags", [])[:10],
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
            if p_lower in ("mac", "osx"):
                p_lower = "macos"
            elif p_lower in ("win", "win32", "win64"):
                p_lower = "windows"
            elif p_lower in ("terminal", "shell", "command-line"):
                p_lower = "cli"

            if p_lower in valid_platforms and p_lower not in normalized:
                normalized.append(p_lower.capitalize())

        return normalized[:6]

    def fallback_analysis(self, repo: dict) -> dict:
        """
        Fallback analysis based on language and keywords.
        Used when AI API is unavailable or README is missing.
        """
        language = repo.get("language") or ""
        description = (repo.get("description") or "").lower()
        name = (repo.get("name") or "").lower()
        search_text = f"{description} {name}"

        platforms = []

        # Infer from programming language
        if language in self.LANG_PLATFORM_MAP:
            platforms.extend(self.LANG_PLATFORM_MAP[language])

        # Infer from keywords
        for keyword, plats in self.KEYWORD_PLATFORM_MAP.items():
            if keyword in search_text:
                platforms.extend(plats)

        # Deduplicate and limit
        seen = set()
        unique_platforms = []
        for p in platforms:
            if p not in seen:
                seen.add(p)
                unique_platforms.append(p)

        return {
            "ai_summary": "",
            "ai_tags": [],
            "ai_platforms": unique_platforms[:6],
        }

    async def analyze_repositories_batch(
        self,
        repos: list[dict],
        concurrency: int = 5,
        use_fallback: bool = True,
        on_progress: Optional[Callable[[str, int, int], Awaitable[None]]] = None,
    ) -> dict[str, dict]:
        """
        Batch analyze repositories with concurrency control.

        Args:
            repos: List of repo dicts with id, full_name, description, readme_content, language
            concurrency: Max concurrent AI API calls
            use_fallback: Use fallback analysis when AI fails or no README
            on_progress: Optional async callback(repo_name, completed, total)

        Returns:
            Dict mapping repo_id to {"success": bool, "data": dict}
        """
        semaphore = asyncio.Semaphore(concurrency)
        results: dict[str, dict] = {}
        completed_count = [0]
        total = len(repos)

        async def analyze_one(repo: dict):
            async with semaphore:
                repo_id = repo["id"]
                repo_name = repo["full_name"]
                try:
                    if repo.get("readme_content"):
                        result = await self.analyze_repository(
                            readme_content=repo["readme_content"],
                            repo_name=repo_name,
                            description=repo.get("description"),
                        )
                        results[repo_id] = {"success": True, "data": result}
                    elif use_fallback:
                        result = self.fallback_analysis(repo)
                        results[repo_id] = {"success": True, "data": result, "fallback": True}
                        logger.info(f"Fallback analysis for {repo_name} (no README)")
                    else:
                        results[repo_id] = {"success": False, "error": "No README"}
                except Exception as e:
                    if use_fallback:
                        result = self.fallback_analysis(repo)
                        results[repo_id] = {"success": True, "data": result, "fallback": True}
                        logger.warning(f"Fallback analysis for {repo_name} (AI failed: {_format_error_chain(e)})")
                    else:
                        results[repo_id] = {"success": False, "error": str(e)}

                completed_count[0] += 1
                if on_progress:
                    try:
                        await on_progress(repo_name, completed_count[0], total)
                    except Exception as e:
                        logger.warning(f"Progress callback failed: {e}")

                await asyncio.sleep(0.1)

        tasks = [analyze_one(repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

        return results

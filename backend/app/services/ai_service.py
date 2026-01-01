"""
AI Service for repository analysis.

Analyzes README content using OpenAI-compatible API to extract:
- Summary: Brief description of the repository
- Tags: Technical tags/keywords
- Platforms: Supported platforms (Windows, macOS, Linux, Web, etc.)
"""

import logging
import asyncio
import httpx
import json
from typing import Optional, Callable, Awaitable

from app.services.encryption import decrypt, is_encrypted

logger = logging.getLogger(__name__)


def _format_error_chain(e: Exception) -> str:
    """
    Extract full error chain for detailed logging.

    Checks __cause__ (explicit), __context__ (implicit), and args.
    """
    def format_single(ex: Exception) -> str:
        """Format a single exception with all available info."""
        name = type(ex).__name__
        msg = str(ex)

        # If str(ex) is empty, try args
        if not msg and ex.args:
            msg = str(ex.args[0]) if len(ex.args) == 1 else str(ex.args)

        # If still empty, try repr
        if not msg:
            msg = repr(ex)

        return f"{name}: {msg}"

    parts = [format_single(e)]
    seen = {id(e)}

    # Walk both __cause__ and __context__
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


class AIService:
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
        "cli": ["Cli"],
        "command": ["Cli"],
        "docker": ["Docker"],
        "container": ["Docker"],
        "android": ["Android"],
        "ios": ["Ios"],
        "macos": ["Macos"],
        "mac": ["Macos"],
        "windows": ["Windows"],
        "linux": ["Linux"],
    }

    def __init__(self, api_key: str, api_base: str, model: str):
        """
        Initialize AI service.

        Args:
            api_key: Decrypted API key
            api_base: Decrypted API base URL (e.g., https://api.openai.com/v1)
            model: Model name to use
        """
        self.api_key = api_key
        # Normalize api_base: remove trailing slash and /chat/completions if present
        api_base = api_base.rstrip("/")
        if api_base.endswith("/chat/completions"):
            api_base = api_base[:-len("/chat/completions")]
        self.api_base = api_base
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

        # Retry with exponential backoff for transient SSL/network errors
        max_retries = 3

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=90.0) as client:
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
                            "max_tokens": 2048,
                        },
                    )

                    if response.status_code != 200:
                        logger.error(
                            f"AI API error: {response.status_code} | "
                            f"URL: {self.api_base}/chat/completions | "
                            f"Model: {self.model} | "
                            f"Response: {response.text[:500]}"
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
                logger.warning(f"AI API timeout for {repo_name} (90s)")
                raise Exception("AI API timeout")
            except (httpx.ConnectError, httpx.RemoteProtocolError) as e:
                # SSL/connection errors - retry with backoff
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) + 0.5  # 1.5s, 2.5s, 4.5s
                    logger.warning(
                        f"AI API connection error for {repo_name} "
                        f"(attempt {attempt + 1}/{max_retries}), "
                        f"retrying in {wait_time}s: {type(e).__name__}"
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.warning(
                        f"AI API request error for {repo_name}: "
                        f"{_format_error_chain(e)}"
                    )
                    raise
            except httpx.RequestError as e:
                logger.warning(
                    f"AI API request error for {repo_name}: "
                    f"{_format_error_chain(e)}"
                )
                raise
            except Exception as e:
                logger.warning(
                    f"AI analysis failed for {repo_name}: "
                    f"{type(e).__name__}: {e}"
                )
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
            on_progress: Optional async callback(repo_name, completed, total) called after each repo

        Returns:
            Dict mapping repo_id to {"success": bool, "data": dict}
        """
        semaphore = asyncio.Semaphore(concurrency)
        results: dict[str, dict] = {}
        completed_count = [0]  # Use list for mutable closure
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

                # Update progress
                completed_count[0] += 1
                if on_progress:
                    try:
                        await on_progress(repo_name, completed_count[0], total)
                    except Exception as e:
                        logger.warning(f"Progress callback failed: {e}")

                await asyncio.sleep(0.1)  # Rate limiting

        tasks = [analyze_one(repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

        return results


def create_ai_service_from_config(config: dict) -> AIService:
    """
    Create AIService from API config dict.

    Handles decryption of api_key and api_base if encrypted.
    Uses try-except pattern for reliable decryption (same as rag_processor.py).
    """
    api_key = config["api_key"]
    api_base = config["api_base"]

    # Try to decrypt, use original value if decryption fails (not encrypted)
    try:
        api_key = decrypt(api_key)
    except Exception:
        pass  # Not encrypted or decryption failed, use original

    try:
        api_base = decrypt(api_base)
    except Exception:
        pass  # Not encrypted or decryption failed, use original

    return AIService(
        api_key=api_key,
        api_base=api_base,
        model=config["model"],
    )

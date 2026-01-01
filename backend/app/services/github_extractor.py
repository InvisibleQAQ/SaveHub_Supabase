"""
GitHub link extractor service.

Extracts GitHub repository URLs from article content and parses them
into (owner, repo_name, original_url) tuples.
"""

import re
import logging
from typing import List, Tuple, Set, Optional
from urllib.parse import urlparse, unquote

logger = logging.getLogger(__name__)

# GitHub paths that are NOT repositories
EXCLUDED_PATHS = {
    'about', 'pricing', 'features', 'enterprise', 'sponsors',
    'marketplace', 'explore', 'topics', 'trending', 'collections',
    'events', 'security', 'settings', 'notifications', 'login',
    'join', 'organizations', 'orgs', 'users', 'apps', 'search',
    'pulls', 'issues', 'gist', 'gists', 'stars', 'watching',
    'followers', 'following', 'achievements', 'codespaces',
    'copilot', 'readme', 'new', 'account', 'customer-stories',
}


def parse_github_url(url: str) -> Optional[Tuple[str, str]]:
    """
    Parse a GitHub URL to extract owner and repo name.

    Args:
        url: A URL string that may be a GitHub repository URL

    Returns:
        Tuple of (owner, repo_name) or None if not a valid repo URL
    """
    try:
        # Decode URL-encoded characters
        url = unquote(url.strip())
        parsed = urlparse(url)

        # Check if it's a GitHub URL
        if parsed.netloc.lower() not in ('github.com', 'www.github.com'):
            return None

        # Split path: /owner/repo/...
        parts = [p for p in parsed.path.split('/') if p]

        if len(parts) < 2:
            return None

        owner, repo = parts[0], parts[1]

        # Exclude non-repo paths
        if owner.lower() in EXCLUDED_PATHS:
            return None

        # Clean repo name (remove .git suffix)
        repo = repo.removesuffix('.git')

        # Validate owner format (GitHub username rules)
        # - Can contain alphanumeric and hyphens
        # - Cannot start or end with hyphen
        # - Max 39 characters
        if not re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$', owner):
            # Allow single character usernames
            if not re.match(r'^[a-zA-Z0-9]$', owner):
                return None

        # Validate repo name format
        # - Can contain alphanumeric, hyphens, underscores, dots
        if not re.match(r'^[a-zA-Z0-9._-]+$', repo):
            return None

        return (owner, repo)

    except Exception as e:
        logger.debug(f"Failed to parse GitHub URL '{url}': {e}")
        return None


def extract_github_repos(
    content: str,
    summary: Optional[str] = None
) -> List[Tuple[str, str, str]]:
    """
    Extract GitHub repository references from article content.

    Parses HTML content to find GitHub URLs in:
    1. href attributes of <a> tags
    2. Plain text URLs in content

    Args:
        content: HTML content of the article
        summary: Optional article summary text

    Returns:
        List of tuples: (owner, repo_name, original_url)
        Deduplicated by (owner, repo_name) - case insensitive
    """
    from bs4 import BeautifulSoup

    if not content:
        return []

    # Parse HTML
    soup = BeautifulSoup(content, 'html.parser')

    # Collect all URLs to check
    urls_to_check: Set[str] = set()

    # 1. Extract from href attributes in <a> tags
    for link in soup.find_all('a', href=True):
        href = link['href']
        if 'github.com' in href.lower():
            urls_to_check.add(href)

    # 2. Extract from plain text (URLs not wrapped in <a> tags)
    text_content = soup.get_text(separator=' ')
    if summary:
        text_content += ' ' + summary

    # Regex to find GitHub URLs in plain text
    url_pattern = r'https?://(?:www\.)?github\.com/[^\s<>"\')\]\},]+'
    for match in re.finditer(url_pattern, text_content, re.IGNORECASE):
        urls_to_check.add(match.group())

    # Parse and deduplicate repos
    seen_repos: Set[Tuple[str, str]] = set()
    results: List[Tuple[str, str, str]] = []

    for url in urls_to_check:
        parsed = parse_github_url(url)
        if parsed:
            owner, repo = parsed
            # Case-insensitive deduplication
            key = (owner.lower(), repo.lower())
            if key not in seen_repos:
                seen_repos.add(key)
                results.append((owner, repo, url))

    logger.debug(f"Extracted {len(results)} unique GitHub repos from content")
    return results


# =============================================================================
# AI-Enhanced Extraction Constants
# =============================================================================

AI_EXTRACTION_TIMEOUT = 60.0  # seconds
MAX_CONTENT_LENGTH = 6000     # chars sent to AI
MAX_AI_REPOS = 10             # limit AI results

IMPLICIT_REPO_PROMPT = """你是一个 GitHub 仓库识别专家。分析文章内容，识别其中隐式提及的软件项目/库/工具。

重要规则：
1. 只识别明确提到名称的项目
2. 不要包含文章中已有链接的仓库
3. 如果不确定 owner/repo，跳过
4. 联网搜索以确保 owner/repo 准确
5. 只输出文章主要描述的仓库, 忽略非重点提到的仓库

返回 JSON 数组，格式：[{"owner": "facebook", "repo": "react"}]
如果没有找到，返回：[]
只返回有效 JSON，不要其他文字。"""


def _parse_ai_response(content: str) -> List[Tuple[str, str]]:
    """
    Parse AI response JSON to list of (owner, repo) tuples.

    Handles markdown code blocks and validates each repo.
    """
    import json

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

        data = json.loads(content)
        if not isinstance(data, list):
            return []

        results = []
        for item in data[:MAX_AI_REPOS]:
            if isinstance(item, dict):
                owner = item.get("owner", "").strip()
                repo = item.get("repo", "").strip()
                if owner and repo:
                    # Validate with existing function
                    url = f"https://github.com/{owner}/{repo}"
                    if parse_github_url(url):
                        results.append((owner, repo))

        return results

    except json.JSONDecodeError:
        logger.warning("Failed to parse AI response as JSON")
        return []
    except Exception as e:
        logger.warning(f"Error parsing AI response: {e}")
        return []


async def extract_implicit_repos_with_ai(
    content: str,
    summary: Optional[str],
    api_key: str,
    api_base: str,
    model: str,
    timeout: float = AI_EXTRACTION_TIMEOUT,
) -> List[Tuple[str, str]]:
    """
    Use AI to extract implicitly mentioned GitHub repos.

    Args:
        content: Article HTML content
        summary: Optional article summary
        api_key: Decrypted API key
        api_base: API base URL
        model: Model name
        timeout: Request timeout in seconds

    Returns:
        List of (owner, repo) tuples for implicitly mentioned repos.
        Returns empty list on any error (silent fallback).
    """
    import httpx
    from bs4 import BeautifulSoup

    try:
        # Extract text from HTML
        soup = BeautifulSoup(content, 'html.parser')
        text_content = soup.get_text(separator=' ')[:MAX_CONTENT_LENGTH]

        # Build user message
        user_message = f"文章内容（前{MAX_CONTENT_LENGTH}字符）：\n{text_content}"
        if summary:
            user_message += f"\n\n摘要：{summary}"
        user_message += "\n\n请识别文章中隐式提及但未直接链接的 GitHub 仓库。"

        # Normalize API base URL (same logic as ai_service.py)
        api_base = api_base.rstrip('/')
        if api_base.endswith('/chat/completions'):
            api_base = api_base[:-len('/chat/completions')]
        if not api_base.startswith('http'):
            api_base = f"https://{api_base}"

        # Call AI API
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": IMPLICIT_REPO_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 2048,
                },
            )

            if response.status_code != 200:
                logger.warning(f"AI API error {response.status_code}: {response.text[:200]}")
                return []

            data = response.json()
            ai_content = data["choices"][0]["message"]["content"]
            return _parse_ai_response(ai_content)

    except httpx.TimeoutException:
        logger.warning("AI extraction timeout")
        return []
    except Exception as e:
        logger.warning(f"AI extraction error: {e}")
        return []


def merge_repos(
    explicit: List[Tuple[str, str, str]],
    implicit: List[Tuple[str, str]],
) -> List[Tuple[str, str, str]]:
    """
    Merge explicit and implicit repos, deduplicate by (owner.lower(), repo.lower()).

    Explicit repos take precedence (preserve original URL).
    For implicit repos, construct URL as https://github.com/{owner}/{repo}.

    Args:
        explicit: List of (owner, repo, url) from BeautifulSoup extraction
        implicit: List of (owner, repo) from AI extraction

    Returns:
        Merged and deduplicated list of (owner, repo, url) tuples
    """
    seen_repos: Set[Tuple[str, str]] = set()
    results: List[Tuple[str, str, str]] = []

    # Add explicit repos first (they have original URLs)
    for owner, repo, url in explicit:
        key = (owner.lower(), repo.lower())
        if key not in seen_repos:
            seen_repos.add(key)
            results.append((owner, repo, url))

    # Add implicit repos (construct URL)
    for owner, repo in implicit:
        key = (owner.lower(), repo.lower())
        if key not in seen_repos:
            seen_repos.add(key)
            url = f"https://github.com/{owner}/{repo}"
            results.append((owner, repo, url))

    return results

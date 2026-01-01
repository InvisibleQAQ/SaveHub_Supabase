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

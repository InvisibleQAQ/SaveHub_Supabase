"""
GitHub repository extraction Celery tasks.

Extracts GitHub repository links from article content,
fetches repo data from GitHub API, and creates article-repository links.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any, List

from celery import shared_task

from .celery import app
from .supabase_client import get_supabase_service

logger = logging.getLogger(__name__)

# =============================================================================
# Constants
# =============================================================================

BATCH_SIZE = 50  # Max articles per scan
GITHUB_API_TIMEOUT = 30  # Seconds
MAX_REPOS_PER_ARTICLE = 20  # Limit repos extracted per article


# =============================================================================
# Errors
# =============================================================================

class RepoExtractionError(Exception):
    """Base error for repo extraction."""
    pass


class GitHubAPIError(RepoExtractionError):
    """GitHub API errors."""
    pass


class RateLimitError(GitHubAPIError):
    """Rate limit exceeded."""
    pass


# =============================================================================
# GitHub API Helper
# =============================================================================

def fetch_github_repo(owner: str, repo: str, token: str = None) -> Dict[str, Any] | None:
    """
    Fetch repository data from GitHub API.

    Args:
        owner: Repository owner
        repo: Repository name
        token: Optional GitHub token for higher rate limits

    Returns:
        Repository data dict or None on failure
    """
    import httpx

    url = f"https://api.github.com/repos/{owner}/{repo}"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "SaveHub-RSS-Reader",
    }
    if token:
        headers["Authorization"] = f"token {token}"

    try:
        with httpx.Client(timeout=GITHUB_API_TIMEOUT) as client:
            response = client.get(url, headers=headers)

            if response.status_code == 404:
                logger.debug(f"Repo not found: {owner}/{repo}")
                return None

            if response.status_code == 403:
                remaining = response.headers.get("X-RateLimit-Remaining", "0")
                if remaining == "0":
                    raise RateLimitError("GitHub API rate limit exceeded")
                logger.warning(f"GitHub API 403: {response.text[:200]}")
                return None

            if response.status_code != 200:
                logger.warning(f"GitHub API error {response.status_code}: {response.text[:200]}")
                return None

            return response.json()

    except httpx.TimeoutException:
        logger.warning(f"GitHub API timeout for {owner}/{repo}")
        return None
    except RateLimitError:
        raise
    except Exception as e:
        logger.error(f"GitHub API error for {owner}/{repo}: {e}")
        return None


# =============================================================================
# Core Logic
# =============================================================================

def do_extract_article_repos(article_id: str, user_id: str) -> Dict[str, Any]:
    """
    Extract GitHub repos from article content.

    Args:
        article_id: Article UUID
        user_id: User UUID

    Returns:
        {"success": bool, "extracted": int, "linked": int, "error": str|None}
    """
    from app.services.github_extractor import extract_github_repos
    from app.services.db.articles import ArticleService
    from app.services.db.repositories import RepositoryService
    from app.services.db.article_repositories import ArticleRepositoryService
    from app.services.db.settings import SettingsService

    supabase = get_supabase_service()
    article_service = ArticleService(supabase, user_id)
    repo_service = RepositoryService(supabase, user_id)
    link_service = ArticleRepositoryService(supabase, user_id)

    try:
        # 1. Get article content
        result = supabase.table("articles").select(
            "id, content, summary"
        ).eq("id", article_id).eq("user_id", user_id).single().execute()

        if not result.data:
            logger.warning(f"Article not found: {article_id}")
            return {"success": False, "error": "Article not found"}

        article = result.data
        content = article.get("content", "")
        summary = article.get("summary")

        # 2. Extract GitHub URLs
        repos = extract_github_repos(content, summary)

        if not repos:
            article_service.mark_repos_extracted(article_id, success=True)
            return {"success": True, "extracted": 0, "linked": 0}

        # Limit repos per article
        repos = repos[:MAX_REPOS_PER_ARTICLE]

        # 3. Get user's GitHub token (if available)
        settings_service = SettingsService(supabase, user_id)
        settings = settings_service.load_settings()
        github_token = settings.get("github_token") if settings else None

        # 4. Process each repo
        extracted_count = 0
        linked_count = 0
        repo_links = []

        for owner, repo_name, original_url in repos:
            # Check if repo already exists
            full_name = f"{owner}/{repo_name}"
            existing = repo_service.get_by_full_name(full_name)

            if existing:
                repo_id = existing["id"]
            else:
                # Fetch from GitHub API
                repo_data = fetch_github_repo(owner, repo_name, github_token)
                if not repo_data:
                    continue

                # Upsert to database
                saved = repo_service.upsert_extracted_repository(repo_data)
                if not saved:
                    continue

                repo_id = saved["id"]
                extracted_count += 1

            repo_links.append({
                "repository_id": repo_id,
                "extracted_url": original_url,
            })

        # 5. Create article-repository links
        if repo_links:
            linked_count = link_service.bulk_link_repos(article_id, repo_links)

        # 6. Mark article as processed
        article_service.mark_repos_extracted(article_id, success=True)

        return {
            "success": True,
            "extracted": extracted_count,
            "linked": linked_count,
        }

    except RateLimitError as e:
        logger.warning(f"Rate limit hit for article {article_id}: {e}")
        return {"success": False, "error": "rate_limit", "retry": True}

    except Exception as e:
        logger.exception(f"Error extracting repos from {article_id}: {e}")
        article_service.mark_repos_extracted(article_id, success=False)
        return {"success": False, "error": str(e)}


# =============================================================================
# Celery Tasks
# =============================================================================

@app.task(
    bind=True,
    name="extract_article_repos",
    max_retries=2,
    default_retry_delay=120,
    retry_backoff=True,
    time_limit=300,
    soft_time_limit=270,
)
def extract_article_repos(self, article_id: str, user_id: str):
    """
    Celery task: Extract GitHub repos from article.
    """
    task_id = self.request.id
    logger.info(f"Extracting repos from article {article_id}", extra={"task_id": task_id})

    start_time = datetime.now(timezone.utc)
    result = do_extract_article_repos(article_id, user_id)
    duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

    logger.info(
        f"Repo extraction complete: {result}",
        extra={"task_id": task_id, "duration_ms": duration_ms}
    )

    return {"article_id": article_id, "duration_ms": duration_ms, **result}


@app.task(name="schedule_repo_extraction_for_articles")
def schedule_repo_extraction_for_articles(article_ids: List[str]) -> Dict[str, Any]:
    """
    Schedule repo extraction for a batch of articles.
    """
    if not article_ids:
        return {"scheduled": 0}

    supabase = get_supabase_service()

    # Get user_ids for articles
    result = supabase.table("articles").select(
        "id, user_id"
    ).in_("id", article_ids).execute()

    if not result.data:
        return {"scheduled": 0}

    scheduled = 0
    for i, article in enumerate(result.data):
        extract_article_repos.apply_async(
            kwargs={
                "article_id": article["id"],
                "user_id": article["user_id"],
            },
            countdown=i * 2,  # 2 second delay between each
            queue="default",
        )
        scheduled += 1

    logger.info(f"Scheduled repo extraction for {scheduled} articles")
    return {"scheduled": scheduled}


@app.task(name="scan_pending_repo_extraction")
def scan_pending_repo_extraction():
    """
    Beat task: Scan for articles needing repo extraction.
    Runs every 30 minutes as fallback.
    """
    logger.info("Scanning for pending repo extraction...")

    supabase = get_supabase_service()

    # Get articles needing extraction
    result = supabase.table("articles") \
        .select("id, user_id") \
        .eq("images_processed", True) \
        .is_("repos_extracted", "null") \
        .order("created_at", desc=True) \
        .limit(BATCH_SIZE) \
        .execute()

    if not result.data:
        logger.info("No pending articles for repo extraction")
        return {"scheduled": 0}

    scheduled = 0
    for i, article in enumerate(result.data):
        extract_article_repos.apply_async(
            kwargs={
                "article_id": article["id"],
                "user_id": article["user_id"],
            },
            countdown=i * 3,
            queue="default",
        )
        scheduled += 1

    logger.info(f"Scheduled repo extraction for {scheduled} articles")
    return {"scheduled": scheduled}

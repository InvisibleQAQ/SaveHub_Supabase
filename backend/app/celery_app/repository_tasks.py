"""
GitHub repository sync Celery tasks.

Design:
1. Manual sync triggers task + schedules next auto-sync in 1 hour
2. Auto-sync completes and schedules next auto-sync in 1 hour
3. If user manually syncs before auto-sync, reset timer to 1 hour from manual sync
"""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List

import httpx
from celery import shared_task
from celery.exceptions import Reject

from .celery import app
from .task_lock import get_task_lock
from .supabase_client import get_supabase_service
from app.services.repository_analyzer import analyze_new_repositories
from app.services.db.repositories import RepositoryService

logger = logging.getLogger(__name__)

# Sync interval: 1 hour
REPO_SYNC_INTERVAL_SECONDS = 3600


# =============================================================================
# Core business logic
# =============================================================================

def do_sync_repositories(user_id: str, github_token: str) -> Dict[str, Any]:
    """
    Core repository sync logic.

    Fetches starred repos from GitHub and upserts to database.
    Only adds/updates, never deletes (preserves unstarred repos).

    Args:
        user_id: User UUID
        github_token: GitHub personal access token

    Returns:
        {"total": N, "new_count": N, "updated_count": N}
    """
    # Run async code in sync context
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        all_repos = loop.run_until_complete(_fetch_all_starred_repos(github_token))
        readme_map = loop.run_until_complete(
            _fetch_all_readmes(github_token, all_repos, concurrency=10)
        )
    finally:
        loop.close()

    # Merge readme_content into repo data
    for repo in all_repos:
        github_id = repo.get("id") or repo.get("github_id")
        repo["readme_content"] = readme_map.get(github_id)

    # Upsert to database using RepositoryService
    supabase = get_supabase_service()
    result = RepositoryService.upsert_repositories_static(supabase, user_id, all_repos)

    return result


def do_ai_analysis(user_id: str, new_count: int) -> Dict[str, Any]:
    """
    AI analyze newly synced repositories.
    Wrapper that runs async analyze_new_repositories in sync context.

    Args:
        user_id: User UUID
        new_count: Number of new repositories to analyze

    Returns:
        {"analyzed": N, "failed": N, "skipped": bool}
    """
    supabase = get_supabase_service()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            analyze_new_repositories(
                supabase=supabase,
                user_id=user_id,
                limit=new_count,
                on_progress=None,
            )
        )
    finally:
        loop.close()

    return result


async def _fetch_all_starred_repos(token: str) -> List[dict]:
    """Fetch all starred repositories from GitHub API with pagination."""
    all_repos = []
    page = 1
    per_page = 100

    async with httpx.AsyncClient() as client:
        while True:
            response = await client.get(
                "https://api.github.com/user/starred",
                params={"page": page, "per_page": per_page, "sort": "updated"},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github.star+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                timeout=30.0
            )

            if response.status_code == 401:
                raise ValueError("Invalid GitHub token")
            if response.status_code == 403:
                raise ValueError("GitHub API rate limit exceeded")
            if response.status_code != 200:
                raise ValueError(f"GitHub API error: {response.status_code}")

            repos = response.json()
            if not repos:
                break

            for item in repos:
                repo = item.get("repo", item)
                repo["starred_at"] = item.get("starred_at")
                all_repos.append(repo)

            if len(repos) < per_page:
                break

            page += 1
            await asyncio.sleep(0.1)

    logger.info(f"Fetched {len(all_repos)} starred repositories from GitHub")
    return all_repos


async def _fetch_readme(
    client: httpx.AsyncClient,
    token: str,
    full_name: str
) -> str | None:
    """Fetch README content for a single repository."""
    try:
        response = await client.get(
            f"https://api.github.com/repos/{full_name}/readme",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.raw+json",
                "X-GitHub-Api-Version": "2022-11-28"
            },
            timeout=10.0
        )
        if response.status_code == 200:
            return response.text
        return None
    except Exception as e:
        logger.debug(f"Failed to fetch README for {full_name}: {e}")
        return None


async def _fetch_all_readmes(
    token: str,
    repos: List[dict],
    concurrency: int = 10
) -> dict[int, str]:
    """Fetch README content for all repositories with concurrency control."""
    semaphore = asyncio.Semaphore(concurrency)
    results: dict[int, str] = {}

    async def fetch_one(client: httpx.AsyncClient, repo: dict):
        async with semaphore:
            github_id = repo.get("id") or repo.get("github_id")
            full_name = repo.get("full_name")
            content = await _fetch_readme(client, token, full_name)
            if content:
                results[github_id] = content
            await asyncio.sleep(0.05)

    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(f"Fetched README for {len(results)}/{len(repos)} repositories")
    return results


# =============================================================================
# Celery tasks
# =============================================================================

@app.task(
    bind=True,
    name="sync_repositories",
    max_retries=2,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=300,
    acks_late=True,
    time_limit=600,      # Hard timeout 10 minutes (README fetching is slow)
    soft_time_limit=540,  # Soft timeout 9 minutes
)
def sync_repositories(
    self,
    user_id: str,
    trigger: str = "auto",  # "manual" or "auto"
):
    """
    Sync GitHub starred repositories for a user.

    Args:
        user_id: User UUID
        trigger: "manual" (user clicked sync) or "auto" (scheduled)
    """
    task_id = self.request.id
    task_lock = get_task_lock()
    lock_key = f"repo_sync:{user_id}"
    lock_ttl = 660  # 11 minutes (longer than task timeout)

    logger.info(
        f"[REPO_SYNC] Starting sync for user {user_id}, trigger={trigger}",
        extra={'task_id': task_id, 'user_id': user_id, 'trigger': trigger}
    )

    # Acquire lock to prevent duplicate execution
    if not task_lock.acquire(lock_key, lock_ttl, task_id):
        remaining = task_lock.get_ttl(lock_key)
        logger.info(f"[REPO_SYNC] User {user_id} sync already running, lock expires in {remaining}s")
        raise Reject(f"Repo sync for user {user_id} is locked", requeue=False)

    start_time = datetime.now(timezone.utc)

    try:
        # Get GitHub token from settings
        supabase = get_supabase_service()
        settings_result = supabase.table("settings") \
            .select("github_token") \
            .eq("user_id", user_id) \
            .single() \
            .execute()

        if not settings_result.data or not settings_result.data.get("github_token"):
            logger.warning(f"[REPO_SYNC] No GitHub token for user {user_id}")
            return {
                "success": False,
                "user_id": user_id,
                "error": "GitHub token not configured"
            }

        github_token = settings_result.data["github_token"]

        # Execute sync
        result = do_sync_repositories(user_id, github_token)

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.info(
            f"[REPO_SYNC] Completed for user {user_id}: "
            f"{result['total']} total, {result['new_count']} new, {duration_ms}ms",
            extra={
                'task_id': task_id,
                'user_id': user_id,
                'trigger': trigger,
                'total': result['total'],
                'new_count': result['new_count'],
                'duration_ms': duration_ms,
            }
        )

        # AI analyze new repositories
        ai_result = {"ai_analyzed": 0, "ai_failed": 0}
        if result["new_count"] > 0:
            try:
                ai_analysis = do_ai_analysis(user_id, result["new_count"])
                ai_result["ai_analyzed"] = ai_analysis["analyzed"]
                ai_result["ai_failed"] = ai_analysis["failed"]
            except Exception as e:
                logger.warning(f"AI analysis during sync failed: {e}")

        # Schedule next auto-sync in 1 hour
        schedule_next_repo_sync(user_id)

        return {
            "success": True,
            "user_id": user_id,
            "total": result["total"],
            "new_count": result["new_count"],
            "updated_count": result["updated_count"],
            "duration_ms": duration_ms,
            **ai_result,
        }

    except ValueError as e:
        # Non-retryable errors (invalid token, rate limit)
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error(
            f"[REPO_SYNC] Failed for user {user_id}: {e}",
            extra={'task_id': task_id, 'user_id': user_id, 'error': str(e)}
        )
        return {
            "success": False,
            "user_id": user_id,
            "error": str(e),
            "duration_ms": duration_ms
        }

    except Exception as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.exception(
            f"[REPO_SYNC] Unexpected error for user {user_id}: {e}",
            extra={'task_id': task_id, 'user_id': user_id, 'error': str(e)}
        )
        # Retry on unexpected errors
        raise self.retry(exc=e)

    finally:
        task_lock.release(lock_key, task_id)


# =============================================================================
# Scheduling functions
# =============================================================================

def schedule_next_repo_sync(user_id: str):
    """
    Schedule next repository sync in 1 hour.

    If there's already a scheduled sync, cancel it first (reset timer).
    This ensures manual sync resets the auto-sync timer.
    """
    task_lock = get_task_lock()
    redis = task_lock.redis

    # Cancel any existing scheduled sync first
    cancel_repo_sync(user_id)

    # Schedule new sync
    task = sync_repositories.apply_async(
        kwargs={
            "user_id": user_id,
            "trigger": "auto"
        },
        countdown=REPO_SYNC_INTERVAL_SECONDS,
        queue="default"
    )

    # Store task ID in Redis for later cancellation
    task_id_key = f"repo_sync_task:{user_id}"
    task_ttl = REPO_SYNC_INTERVAL_SECONDS + 300  # TTL = 1 hour + 5 min buffer
    redis.setex(task_id_key, task_ttl, task.id)

    logger.info(
        f"[REPO_SYNC] Scheduled next sync for user {user_id} "
        f"in {REPO_SYNC_INTERVAL_SECONDS}s (task_id={task.id})"
    )


def cancel_repo_sync(user_id: str) -> bool:
    """
    Cancel scheduled repository sync for a user.

    Called before scheduling new sync to reset timer,
    or when user removes GitHub token.
    """
    task_lock = get_task_lock()
    redis = task_lock.redis

    task_id_key = f"repo_sync_task:{user_id}"
    task_id = redis.get(task_id_key)

    revoked = False
    if task_id:
        if isinstance(task_id, bytes):
            task_id = task_id.decode('utf-8')

        app.control.revoke(task_id, terminate=False)
        logger.info(f"[REPO_SYNC] Revoked scheduled task {task_id} for user {user_id}")
        revoked = True

    # Clean up Redis key
    redis.delete(task_id_key)

    return revoked

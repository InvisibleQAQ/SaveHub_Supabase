"""
GitHub repositories API endpoints.

Provides endpoints for fetching and syncing user's starred repositories.
"""

import logging
import asyncio
import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
import httpx

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.repositories import (
    RepositoryResponse,
    RepositoryUpdateRequest,
)
from app.services.db.repositories import RepositoryService
from app.services.db.settings import SettingsService
from app.services.repository_analyzer import analyze_repositories_needing_analysis
from app.celery_app.repository_tasks import schedule_next_repo_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/repositories", tags=["repositories"])


def get_repository_service(request: Request, user=Depends(verify_auth)) -> RepositoryService:
    """Create RepositoryService instance with authenticated user's session."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    return RepositoryService(supabase, user.user.id)


@router.get("", response_model=List[RepositoryResponse])
async def get_repositories(
    service: RepositoryService = Depends(get_repository_service)
):
    """Get all starred repositories for current user."""
    repos = service.load_repositories()
    return repos


@router.post("/sync")
async def sync_repositories(
    request: Request,
    user=Depends(verify_auth)
):
    """
    Sync starred repositories from GitHub.
    Returns SSE stream with progress updates.

    Events:
    - progress: {phase: "fetching"|"fetched"|"analyzing"|"saving", ...}
    - done: {total, new_count, updated_count}
    - error: {message}
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = user.user.id

    # Get GitHub token from settings (validate before starting SSE)
    settings_service = SettingsService(supabase, user_id)
    settings = settings_service.load_settings()

    github_token = settings.get("github_token")
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail="GitHub token not configured. Please add it in Settings."
        )

    # Create progress queue for SSE
    progress_queue: asyncio.Queue = asyncio.Queue()

    async def sync_task():
        """Execute sync and push progress to queue."""
        try:
            # Phase: fetching
            await progress_queue.put({
                "event": "progress",
                "data": {"phase": "fetching"}
            })

            all_repos = await _fetch_all_starred_repos(github_token)

            # Phase: fetched
            await progress_queue.put({
                "event": "progress",
                "data": {"phase": "fetched", "total": len(all_repos)}
            })

            # Fetch README content
            readme_map = await _fetch_all_readmes(github_token, all_repos, concurrency=10)

            # Merge readme_content into repo data
            for repo in all_repos:
                github_id = repo.get("id") or repo.get("github_id")
                repo["readme_content"] = readme_map.get(github_id)

            # Upsert to database
            repo_service = RepositoryService(supabase, user_id)
            result = repo_service.upsert_repositories(all_repos)

            # AI analyze repositories needing analysis (no condition check)
            try:
                async def on_progress(repo_name: str, completed: int, total: int):
                    await progress_queue.put({
                        "event": "progress",
                        "data": {
                            "phase": "analyzing",
                            "current": repo_name,
                            "completed": completed,
                            "total": total
                        }
                    })

                async def on_save_progress(saved_count: int, save_total: int):
                    await progress_queue.put({
                        "event": "progress",
                        "data": {
                            "phase": "saving",
                            "savedCount": saved_count,
                            "saveTotal": save_total
                        }
                    })

                await analyze_repositories_needing_analysis(
                    supabase=supabase,
                    user_id=user_id,
                    on_progress=on_progress,
                    on_save_progress=on_save_progress,
                )
            except Exception as e:
                logger.warning(f"AI analysis during sync failed: {e}")

            # Schedule next auto-sync
            try:
                schedule_next_repo_sync(user_id)
                logger.info(f"Scheduled next repo sync for user {user_id} in 1 hour")
            except Exception as e:
                logger.warning(f"Failed to schedule next repo sync: {e}")

            # Done
            await progress_queue.put({
                "event": "done",
                "data": result
            })

        except HTTPException as e:
            await progress_queue.put({
                "event": "error",
                "data": {"message": e.detail}
            })
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            await progress_queue.put({
                "event": "error",
                "data": {"message": str(e)}
            })
        finally:
            await progress_queue.put(None)  # End signal

    async def generate_events():
        """SSE event generator."""
        task = asyncio.create_task(sync_task())
        try:
            while True:
                item = await progress_queue.get()
                if item is None:
                    break
                yield f"event: {item['event']}\ndata: {json.dumps(item['data'])}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


async def _fetch_all_starred_repos(token: str) -> List[dict]:
    """
    Fetch all starred repositories from GitHub API.
    Uses pagination (100 per page) with rate limiting protection.
    """
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
                raise HTTPException(status_code=401, detail="Invalid GitHub token")
            if response.status_code == 403:
                raise HTTPException(status_code=403, detail="GitHub API rate limit exceeded")
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"GitHub API error: {response.status_code}")

            repos = response.json()
            if not repos:
                break

            # Extract repo data with starred_at
            for item in repos:
                repo = item.get("repo", item)
                repo["starred_at"] = item.get("starred_at")
                all_repos.append(repo)

            if len(repos) < per_page:
                break

            page += 1
            await asyncio.sleep(0.1)  # Rate limiting protection

    logger.info(f"Fetched {len(all_repos)} starred repositories from GitHub")
    return all_repos


async def _fetch_readme(
    client: httpx.AsyncClient,
    token: str,
    full_name: str
) -> str | None:
    """
    Fetch README content for a single repository.
    Returns raw markdown content or None if not found.
    """
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
    """
    Fetch README content for all repositories with concurrency control.
    Returns {github_id: readme_content} mapping.
    """
    semaphore = asyncio.Semaphore(concurrency)
    results: dict[int, str] = {}

    async def fetch_one(client: httpx.AsyncClient, repo: dict):
        async with semaphore:
            github_id = repo.get("id") or repo.get("github_id")
            full_name = repo.get("full_name")
            content = await _fetch_readme(client, token, full_name)
            if content:
                results[github_id] = content
            await asyncio.sleep(0.05)  # 50ms delay to avoid rate limiting

    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(f"Fetched README for {len(results)}/{len(repos)} repositories")
    return results


@router.patch("/{repo_id}", response_model=RepositoryResponse)
async def update_repository(
    repo_id: str,
    data: RepositoryUpdateRequest,
    service: RepositoryService = Depends(get_repository_service)
):
    """Update repository custom fields (description, tags, category)."""
    update_data = data.model_dump(exclude_none=True)

    result = service.update_repository(repo_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Repository not found")

    return result


@router.post("/{repo_id}/analyze", response_model=RepositoryResponse)
async def analyze_repository(
    repo_id: str,
    request: Request,
    user=Depends(verify_auth)
):
    """
    Analyze repository using AI.

    Uses the user's active chat API config to analyze README content.
    Returns updated repository with AI summary, tags, and platforms.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = user.user.id

    repo_service = RepositoryService(supabase, user_id)
    api_config_service = ApiConfigService(supabase, user_id)

    # Get repository
    repo = repo_service.get_repository_by_id(repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Check if README exists
    if not repo.get("readme_content"):
        raise HTTPException(
            status_code=400,
            detail="Repository has no README content to analyze"
        )

    # Get active chat API config
    config = api_config_service.get_active_config("chat")
    if not config:
        raise HTTPException(
            status_code=400,
            detail="No active chat API configured. Please add one in Settings."
        )

    try:
        # Create AI service and analyze
        ai_service = create_ai_service_from_config(config)
        analysis = await ai_service.analyze_repository(
            readme_content=repo["readme_content"],
            repo_name=repo["full_name"],
            description=repo.get("description"),
        )

        # Update repository with analysis results
        result = repo_service.update_ai_analysis(repo_id, analysis)
        if not result:
            raise HTTPException(status_code=500, detail="Failed to save analysis")

        logger.info(f"AI analysis completed for {repo['full_name']}")
        return result

    except Exception as e:
        # Mark analysis as failed
        repo_service.mark_analysis_failed(repo_id)
        logger.error(f"AI analysis failed for {repo['full_name']}: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")

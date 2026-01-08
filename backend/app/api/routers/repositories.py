"""
GitHub repositories API endpoints.

Provides endpoints for fetching and syncing user's starred repositories.
"""

import logging
import asyncio
import json
from typing import List
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
import httpx

from app.dependencies import (
    verify_auth,
    get_access_token,
    create_service_dependency,
    require_exists,
    COOKIE_NAME_ACCESS,
)
from app.exceptions import (
    AppException,
    NotFoundError,
    ConfigurationError,
    ValidationError,
    AuthenticationError,
    RateLimitError,
    ExternalServiceError,
)
from app.supabase_client import get_supabase_client
from app.schemas.repositories import (
    RepositoryResponse,
    RepositoryUpdateRequest,
)
from app.services.db.repositories import RepositoryService
from app.services.db.settings import SettingsService
from app.services.db.api_configs import ApiConfigService
from app.services.repository_analyzer import analyze_repositories_needing_analysis
from app.celery_app.repository_tasks import schedule_next_repo_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/repositories", tags=["repositories"])


get_repository_service = create_service_dependency(RepositoryService)


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
        raise ConfigurationError("GitHub", "token")

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

            starred_repos = await _fetch_all_starred_repos(github_token)

            # Get existing repo info to detect changes
            repo_service = RepositoryService(supabase, user_id)
            existing_repo_info = repo_service.get_existing_pushed_at()

            # Find starred repos needing README fetch (new or pushed_at changed)
            starred_github_ids = set()
            starred_ids_needing_readme = set()
            for repo in starred_repos:
                github_id = repo.get("id") or repo.get("github_id")
                starred_github_ids.add(github_id)
                new_pushed_at = repo.get("pushed_at")

                if github_id not in existing_repo_info:
                    # New repo
                    starred_ids_needing_readme.add(github_id)
                else:
                    info = existing_repo_info[github_id]
                    if info["pushed_at"] != new_pushed_at:
                        # pushed_at changed (code update)
                        starred_ids_needing_readme.add(github_id)

            # Find db repos without readme (excluding starred repos)
            db_repos_without_readme = repo_service.get_repos_without_readme()
            db_repos_needing_readme = [
                r for r in db_repos_without_readme
                if r["github_id"] not in starred_github_ids
            ]

            # Phase: fetched
            total_needing_readme = len(starred_ids_needing_readme) + len(db_repos_needing_readme)
            await progress_queue.put({
                "event": "progress",
                "data": {
                    "phase": "fetched",
                    "total": len(starred_repos),
                    "needsReadme": total_needing_readme
                }
            })

            # Fetch README for repos that need it (starred + db repos)
            readme_map = {}
            if total_needing_readme > 0:
                # Build list of repos to fetch README for
                repos_to_fetch = []

                # Add starred repos needing README
                for repo in starred_repos:
                    github_id = repo.get("id") or repo.get("github_id")
                    if github_id in starred_ids_needing_readme:
                        repos_to_fetch.append(repo)

                # Add db repos needing README (use full_name for fetching)
                for db_repo in db_repos_needing_readme:
                    repos_to_fetch.append({
                        "id": db_repo["github_id"],
                        "full_name": db_repo["full_name"]
                    })

                readme_map = await _fetch_all_readmes(github_token, repos_to_fetch, concurrency=10)

            # Merge readme_content into starred_repos
            for repo in starred_repos:
                github_id = repo.get("id") or repo.get("github_id")
                if github_id in starred_ids_needing_readme:
                    repo["readme_content"] = readme_map.get(github_id)

            # Upsert starred_repos to database
            result = repo_service.upsert_repositories(starred_repos)

            # Update readme_content for db repos (not in starred)
            for db_repo in db_repos_needing_readme:
                readme_content = readme_map.get(db_repo["github_id"])
                if readme_content:
                    repo_service.update_readme_content(db_repo["id"], readme_content)

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

            # Fetch OpenRank for all repositories
            try:
                from app.services.openrank_service import fetch_all_openranks

                await progress_queue.put({
                    "event": "progress",
                    "data": {"phase": "openrank"}
                })

                all_repos = repo_service.get_all_repos_for_openrank()
                openrank_map = await fetch_all_openranks(all_repos, concurrency=5)

                if openrank_map:
                    repo_service.batch_update_openrank(openrank_map)
                    logger.info(f"OpenRank updated for {len(openrank_map)} repositories")
            except Exception as e:
                logger.warning(f"OpenRank fetch during sync failed: {e}")

            # Generate embeddings for repositories
            try:
                from app.celery_app.repository_tasks import do_repository_embedding
                import functools

                async def on_embedding_progress(repo_name: str, completed: int, total: int):
                    await progress_queue.put({
                        "event": "progress",
                        "data": {
                            "phase": "embedding",
                            "current": repo_name,
                            "completed": completed,
                            "total": total
                        }
                    })

                # 创建同步回调包装器
                loop = asyncio.get_event_loop()

                def sync_progress_callback(repo_name: str, completed: int, total: int):
                    asyncio.run_coroutine_threadsafe(
                        on_embedding_progress(repo_name, completed, total),
                        loop
                    )

                embedding_result = await loop.run_in_executor(
                    None,
                    functools.partial(do_repository_embedding, user_id, sync_progress_callback)
                )
                logger.info(
                    f"Repository embedding completed: "
                    f"{embedding_result.get('embedding_processed', 0)} processed"
                )
            except Exception as e:
                logger.warning(f"Repository embedding during sync failed: {e}")

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

        except AppException as e:
            await progress_queue.put({
                "event": "error",
                "data": {"message": e.message}
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
                raise AuthenticationError("GitHub token")
            if response.status_code == 403:
                raise RateLimitError("GitHub API")
            if response.status_code != 200:
                raise ExternalServiceError("GitHub API", f"status {response.status_code}")

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
        raise NotFoundError("Repository")

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
    repo = require_exists(repo_service.get_repository_by_id(repo_id), "Repository")

    # Check if README exists
    if not repo.get("readme_content"):
        raise ValidationError("Repository has no README content to analyze")

    # Get active chat API config
    config = api_config_service.get_active_config("chat")
    if not config:
        raise ConfigurationError("chat", "API")

    from app.services.ai.repository_service import create_ai_service_from_config

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
        raise NotFoundError("Repository")

    logger.info(f"AI analysis completed for {repo['full_name']}")
    return result

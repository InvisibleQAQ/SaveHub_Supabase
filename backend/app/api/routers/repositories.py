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

from app.dependencies import (
    verify_auth,
    create_service_dependency,
    require_exists,
    COOKIE_NAME_ACCESS,
)
from app.exceptions import (
    AppException,
    NotFoundError,
    ConfigurationError,
    ValidationError,
)
from app.supabase_client import get_supabase_client
from app.schemas.repositories import (
    RepositoryResponse,
    RepositoryUpdateRequest,
)
from app.services.db.repositories import RepositoryService
from app.services.db.settings import SettingsService
from app.services.db.api_configs import ApiConfigService
from app.services.sync import RepositorySyncService, SSEProgressReporter

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

    # Validate GitHub token before starting SSE
    settings_service = SettingsService(supabase, user_id)
    settings = settings_service.load_settings()

    github_token = settings.get("github_token")
    if not github_token:
        raise ConfigurationError("GitHub", "token")

    # Create progress queue and reporter for SSE
    progress_queue: asyncio.Queue = asyncio.Queue()
    progress_reporter = SSEProgressReporter(progress_queue)

    async def sync_task():
        """Execute sync using the sync service."""
        try:
            sync_service = RepositorySyncService(
                supabase=supabase,
                user_id=user_id,
                github_token=github_token,
                progress=progress_reporter,
            )
            result = await sync_service.sync()
            await progress_reporter.report_done(result)
        except AppException as e:
            await progress_reporter.report_error(e.message)
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            await progress_reporter.report_error(str(e))
        finally:
            await progress_reporter.signal_end()

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
            "X-Accel-Buffering": "no",
        }
    )


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

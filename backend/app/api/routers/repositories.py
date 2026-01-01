"""
GitHub repositories API endpoints.

Provides endpoints for fetching and syncing user's starred repositories.
"""

import logging
import asyncio
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
import httpx

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.repositories import RepositoryResponse, SyncResponse
from app.services.db.repositories import RepositoryService
from app.services.db.settings import SettingsService

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


@router.post("/sync", response_model=SyncResponse)
async def sync_repositories(
    request: Request,
    user=Depends(verify_auth)
):
    """
    Sync starred repositories from GitHub.

    Fetches all starred repos using pagination and upserts to database.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = user.user.id

    # Get GitHub token from settings
    settings_service = SettingsService(supabase, user_id)
    settings = settings_service.load_settings()

    github_token = settings.get("github_token")
    if not github_token:
        raise HTTPException(
            status_code=400,
            detail="GitHub token not configured. Please add it in Settings."
        )

    # Fetch all starred repos from GitHub
    all_repos = await _fetch_all_starred_repos(github_token)

    # Upsert to database
    repo_service = RepositoryService(supabase, user_id)
    result = repo_service.upsert_repositories(all_repos)

    return SyncResponse(**result)


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

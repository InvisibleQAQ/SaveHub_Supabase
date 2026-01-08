"""
Repository sync service.

Orchestrates GitHub repository synchronization with clean separation of concerns.
Each phase is a separate method, making the code testable and maintainable.
"""

import asyncio
import functools
import logging
from typing import Any, List, Optional

import httpx
from supabase import Client

from app.exceptions import (
    AuthenticationError,
    RateLimitError,
    ExternalServiceError,
)
from app.services.db.repositories import RepositoryService
from app.services.repository_analyzer import analyze_repositories_needing_analysis
from .progress import ProgressReporter, SyncPhase

logger = logging.getLogger(__name__)


def _normalize_github_id(repo: dict) -> int:
    """
    Extract github_id from repo dict, handling both API and DB formats.

    GitHub API returns 'id', DB stores 'github_id'.
    This eliminates the repeated `repo.get("id") or repo.get("github_id")` pattern.
    """
    return repo.get("id") or repo.get("github_id")


class RepositorySyncService:
    """
    Orchestrates GitHub repository synchronization.

    Phases:
    1. Fetch starred repos from GitHub
    2. Detect changes (new repos, updated repos)
    3. Fetch README for changed repos
    4. Save to database
    5. AI analysis (optional, silent failure)
    6. OpenRank fetch (optional, silent failure)
    7. Embedding generation (optional, silent failure)
    8. Schedule next sync

    Each phase is a separate method for testability.
    """

    def __init__(
        self,
        supabase: Client,
        user_id: str,
        github_token: str,
        progress: Optional[ProgressReporter] = None,
    ):
        self.supabase = supabase
        self.user_id = user_id
        self.github_token = github_token
        self.progress = progress
        self._repo_service = RepositoryService(supabase, user_id)

    # =========================================================================
    # Main Entry Point
    # =========================================================================

    async def sync(self) -> dict:
        """
        Execute full sync workflow.

        Returns:
            Sync result dict with counts
        """
        # Phase 1: Fetch starred repos
        await self._report_phase(SyncPhase.FETCHING)
        starred_repos = await self._fetch_starred_repos()

        # Phase 2: Detect changes
        starred_ids_needing_readme, db_repos_needing_readme = self._detect_changes(starred_repos)

        # Phase 3: Report fetched
        total_needing_readme = len(starred_ids_needing_readme) + len(db_repos_needing_readme)
        await self._report_phase(
            SyncPhase.FETCHED,
            total=len(starred_repos),
            needsReadme=total_needing_readme,
        )

        # Phase 4: Fetch README (pass starred_repos for full_name lookup)
        readme_map = await self._fetch_readmes(
            starred_repos, starred_ids_needing_readme, db_repos_needing_readme
        )

        # Phase 5: Save to database
        result = self._save_repositories(
            starred_repos, starred_ids_needing_readme, readme_map, db_repos_needing_readme
        )

        # Phase 6-8: Optional phases (silent failure)
        await self._run_optional_phases()

        return result

    # =========================================================================
    # Phase 1: Fetch Starred Repos
    # =========================================================================

    async def _fetch_starred_repos(self) -> List[dict]:
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
                        "Authorization": f"Bearer {self.github_token}",
                        "Accept": "application/vnd.github.star+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                    timeout=30.0,
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

    # =========================================================================
    # Phase 2: Detect Changes
    # =========================================================================

    def _detect_changes(self, starred_repos: List[dict]) -> tuple[set[int], List[dict]]:
        """
        Detect which repos need README fetch.

        Returns:
            (starred_ids_needing_readme, db_repos_needing_readme)
        """
        existing_info = self._repo_service.get_existing_pushed_at()

        starred_github_ids = set()
        starred_ids_needing_readme = set()

        for repo in starred_repos:
            github_id = _normalize_github_id(repo)
            starred_github_ids.add(github_id)
            new_pushed_at = repo.get("pushed_at")

            if github_id not in existing_info:
                # New repo
                starred_ids_needing_readme.add(github_id)
            elif existing_info[github_id]["pushed_at"] != new_pushed_at:
                # Code updated
                starred_ids_needing_readme.add(github_id)

        # Find DB repos without README (excluding starred)
        db_repos_without_readme = self._repo_service.get_repos_without_readme()
        db_repos_needing_readme = [
            r for r in db_repos_without_readme
            if r["github_id"] not in starred_github_ids
        ]

        return starred_ids_needing_readme, db_repos_needing_readme

    # =========================================================================
    # Phase 3: Fetch README
    # =========================================================================

    async def _fetch_readmes(
        self,
        starred_repos: List[dict],
        starred_ids_needing_readme: set[int],
        db_repos_needing_readme: List[dict],
    ) -> dict[int, str]:
        """Fetch README for repos that need it."""
        if not starred_ids_needing_readme and not db_repos_needing_readme:
            return {}

        # Build list of repos to fetch
        repos_to_fetch = []

        # Add starred repos needing README
        for repo in starred_repos:
            github_id = _normalize_github_id(repo)
            if github_id in starred_ids_needing_readme:
                repos_to_fetch.append(repo)

        # Add DB repos needing README
        for db_repo in db_repos_needing_readme:
            repos_to_fetch.append({
                "id": db_repo["github_id"],
                "full_name": db_repo["full_name"],
            })

        return await self._fetch_all_readmes(repos_to_fetch)

    async def _fetch_all_readmes(
        self,
        repos: List[dict],
        concurrency: int = 10,
    ) -> dict[int, str]:
        """Fetch README content for multiple repos with concurrency control."""
        if not repos:
            return {}

        semaphore = asyncio.Semaphore(concurrency)
        results: dict[int, str] = {}

        async def fetch_one(client: httpx.AsyncClient, repo: dict):
            async with semaphore:
                github_id = _normalize_github_id(repo)
                full_name = repo.get("full_name")
                content = await self._fetch_single_readme(client, full_name)
                if content:
                    results[github_id] = content
                await asyncio.sleep(0.05)

        async with httpx.AsyncClient() as client:
            tasks = [fetch_one(client, repo) for repo in repos]
            await asyncio.gather(*tasks, return_exceptions=True)

        logger.info(f"Fetched README for {len(results)}/{len(repos)} repositories")
        return results

    async def _fetch_single_readme(
        self,
        client: httpx.AsyncClient,
        full_name: str,
    ) -> Optional[str]:
        """Fetch README content for a single repository."""
        try:
            response = await client.get(
                f"https://api.github.com/repos/{full_name}/readme",
                headers={
                    "Authorization": f"Bearer {self.github_token}",
                    "Accept": "application/vnd.github.raw+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                timeout=10.0,
            )
            if response.status_code == 200:
                return response.text
            return None
        except Exception as e:
            logger.debug(f"Failed to fetch README for {full_name}: {e}")
            return None

    # =========================================================================
    # Helper: Progress Reporting
    # =========================================================================

    async def _report_phase(self, phase: SyncPhase, **data: Any) -> None:
        """Report phase if progress reporter is available."""
        if self.progress:
            await self.progress.report_phase(phase, **data)

    # =========================================================================
    # Phase 4: Save Repositories
    # =========================================================================

    def _save_repositories(
        self,
        starred_repos: List[dict],
        starred_ids_needing_readme: set[int],
        readme_map: dict[int, str],
        db_repos_needing_readme: List[dict],
    ) -> dict:
        """Save repositories to database."""
        # Merge readme_content into starred_repos
        for repo in starred_repos:
            github_id = _normalize_github_id(repo)
            if github_id in starred_ids_needing_readme:
                repo["readme_content"] = readme_map.get(github_id)

        # Upsert starred repos
        result = self._repo_service.upsert_repositories(starred_repos)

        # Update readme for DB repos (not in starred)
        for db_repo in db_repos_needing_readme:
            readme_content = readme_map.get(db_repo["github_id"])
            if readme_content:
                self._repo_service.update_readme_content(db_repo["id"], readme_content)

        return result

    # =========================================================================
    # Phase 5-8: Optional Phases (Silent Failure)
    # =========================================================================

    async def _run_optional_phases(self) -> None:
        """Run optional phases with silent failure."""
        await self._run_ai_analysis()
        await self._run_openrank_fetch()
        await self._run_embedding_generation()
        self._schedule_next_sync()

    async def _run_ai_analysis(self) -> None:
        """Run AI analysis on repositories needing it."""
        try:
            async def on_progress(repo_name: str, completed: int, total: int):
                await self._report_phase(
                    SyncPhase.ANALYZING,
                    current=repo_name,
                    completed=completed,
                    total=total,
                )

            async def on_save_progress(saved_count: int, save_total: int):
                await self._report_phase(
                    SyncPhase.SAVING,
                    savedCount=saved_count,
                    saveTotal=save_total,
                )

            await analyze_repositories_needing_analysis(
                supabase=self.supabase,
                user_id=self.user_id,
                on_progress=on_progress,
                on_save_progress=on_save_progress,
            )
        except Exception as e:
            logger.warning(f"AI analysis during sync failed: {e}")

    async def _run_openrank_fetch(self) -> None:
        """Fetch OpenRank for all repositories."""
        try:
            from app.services.openrank_service import fetch_all_openranks

            await self._report_phase(SyncPhase.OPENRANK)

            all_repos = self._repo_service.get_all_repos_for_openrank()
            openrank_map = await fetch_all_openranks(all_repos, concurrency=5)

            if openrank_map:
                self._repo_service.batch_update_openrank(openrank_map)
                logger.info(f"OpenRank updated for {len(openrank_map)} repositories")
        except Exception as e:
            logger.warning(f"OpenRank fetch during sync failed: {e}")

    async def _run_embedding_generation(self) -> None:
        """Generate embeddings for repositories."""
        try:
            from app.celery_app.repository_tasks import do_repository_embedding

            async def on_embedding_progress(repo_name: str, completed: int, total: int):
                await self._report_phase(
                    SyncPhase.EMBEDDING,
                    current=repo_name,
                    completed=completed,
                    total=total,
                )

            loop = asyncio.get_event_loop()

            def sync_progress_callback(repo_name: str, completed: int, total: int):
                asyncio.run_coroutine_threadsafe(
                    on_embedding_progress(repo_name, completed, total),
                    loop,
                )

            embedding_result = await loop.run_in_executor(
                None,
                functools.partial(do_repository_embedding, self.user_id, sync_progress_callback),
            )
            logger.info(
                f"Repository embedding completed: "
                f"{embedding_result.get('embedding_processed', 0)} processed"
            )
        except Exception as e:
            logger.warning(f"Repository embedding during sync failed: {e}")

    def _schedule_next_sync(self) -> None:
        """Schedule next auto-sync."""
        try:
            from app.celery_app.repository_tasks import schedule_next_repo_sync

            schedule_next_repo_sync(self.user_id)
            logger.info(f"Scheduled next repo sync for user {self.user_id} in 1 hour")
        except Exception as e:
            logger.warning(f"Failed to schedule next repo sync: {e}")

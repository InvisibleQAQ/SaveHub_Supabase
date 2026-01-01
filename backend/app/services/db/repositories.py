"""
Repository database service using Supabase Python SDK.

Handles CRUD operations for GitHub starred repositories.
"""

import logging
from typing import List
from supabase import Client

logger = logging.getLogger(__name__)


class RepositoryService:
    """Service for repository database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    @classmethod
    def upsert_repositories_static(
        cls, supabase: Client, user_id: str, repos: List[dict]
    ) -> dict:
        """
        Static method for upsert - used by Celery tasks.
        Allows Celery tasks to use service_role client without full service instantiation.
        """
        service = cls(supabase, user_id)
        return service.upsert_repositories(repos)

    def get_existing_pushed_at(self) -> dict[int, str | None]:
        """
        Get existing repositories' github_id -> github_pushed_at mapping.
        Used to detect which repos need README re-fetch.
        """
        response = self.supabase.table("repositories") \
            .select("github_id, github_pushed_at") \
            .eq("user_id", self.user_id) \
            .execute()
        return {row["github_id"]: row.get("github_pushed_at") for row in (response.data or [])}

    def load_repositories(self) -> List[dict]:
        """
        Load all repositories for current user.
        Returns repositories ordered by starred_at descending.
        """
        logger.debug("Loading repositories", extra={'user_id': self.user_id})

        response = self.supabase.table("repositories") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .order("starred_at", desc=True) \
            .execute()

        repos = []
        for row in response.data or []:
            repos.append(self._row_to_dict(row))

        logger.debug(f"Loaded {len(repos)} repositories", extra={'user_id': self.user_id})
        return repos

    def upsert_repositories(self, repos: List[dict]) -> dict:
        """
        Upsert multiple repositories.

        Only upserts repos that have changes:
        - New repos: always upsert
        - Existing repos: only upsert if readme_content changed

        Args:
            repos: List of repository dictionaries from GitHub API

        Returns:
            dict with total, new_count, updated_count, changed_github_ids, skipped_count
        """
        if not repos:
            return {"total": 0, "new_count": 0, "updated_count": 0, "changed_github_ids": [], "skipped_count": 0}

        # Get existing github_ids, github_pushed_at, and readme_content
        existing_response = self.supabase.table("repositories") \
            .select("github_id, github_pushed_at, readme_content") \
            .eq("user_id", self.user_id) \
            .execute()

        existing_map = {
            row["github_id"]: {
                "github_pushed_at": row.get("github_pushed_at"),
                "readme_content": row.get("readme_content"),
            }
            for row in (existing_response.data or [])
        }

        # Prepare rows for upsert and detect changes
        db_rows = []
        new_count = 0
        changed_github_ids = []
        skipped_count = 0

        for repo in repos:
            github_id = repo.get("id") or repo.get("github_id")
            new_pushed_at = repo.get("pushed_at")
            new_readme = repo.get("readme_content")
            is_new = github_id not in existing_map

            if is_new:
                new_count += 1
            else:
                existing = existing_map[github_id]
                old_readme = existing.get("readme_content")

                # Skip if no new readme fetched (None means not fetched)
                if new_readme is None:
                    skipped_count += 1
                    continue

                # Skip if readme_content unchanged
                if new_readme == old_readme:
                    skipped_count += 1
                    continue

                # Detect pushed_at change (code update) for AI analysis reset
                old_pushed_at = existing.get("github_pushed_at")
                if old_pushed_at is not None and old_pushed_at != new_pushed_at:
                    changed_github_ids.append(github_id)

            row = {
                "user_id": self.user_id,
                "github_id": github_id,
                "name": repo.get("name"),
                "full_name": repo.get("full_name"),
                "description": repo.get("description"),
                "html_url": repo.get("html_url"),
                "stargazers_count": repo.get("stargazers_count", 0),
                "language": repo.get("language"),
                "topics": repo.get("topics", []),
                "owner_login": repo.get("owner", {}).get("login", ""),
                "owner_avatar_url": repo.get("owner", {}).get("avatar_url"),
                "starred_at": repo.get("starred_at"),
                "github_created_at": repo.get("created_at"),
                "github_updated_at": repo.get("updated_at"),
                "github_pushed_at": new_pushed_at,
                "readme_content": repo.get("readme_content"),
                "is_starred": True,  # Mark as starred repo
            }

            # Clear AI fields for repos with pushed_at change
            if github_id in changed_github_ids:
                row["ai_summary"] = None
                row["ai_tags"] = None
                row["ai_platforms"] = None
                row["analyzed_at"] = None
                row["analysis_failed"] = None

            db_rows.append(row)

        logger.info(
            f"Upserting {len(db_rows)} repositories ({new_count} new, {len(changed_github_ids)} changed, {skipped_count} skipped)",
            extra={'user_id': self.user_id}
        )

        # Skip upsert if no rows to insert (Supabase doesn't support empty array)
        if not db_rows:
            return {
                "total": 0,
                "new_count": 0,
                "updated_count": 0,
                "changed_github_ids": [],
                "skipped_count": skipped_count,
            }

        # Upsert with conflict on (user_id, github_id)
        response = self.supabase.table("repositories") \
            .upsert(db_rows, on_conflict="user_id,github_id") \
            .execute()

        total = len(response.data or [])
        updated_count = total - new_count

        logger.info(
            f"Upserted {total} repositories",
            extra={'user_id': self.user_id}
        )

        return {
            "total": total,
            "new_count": new_count,
            "updated_count": updated_count,
            "changed_github_ids": changed_github_ids,
            "skipped_count": skipped_count,
        }

    def get_count(self) -> int:
        """Get total repository count for user."""
        response = self.supabase.table("repositories") \
            .select("id", count="exact") \
            .eq("user_id", self.user_id) \
            .execute()

        return response.count or 0

    def get_repository_by_id(self, repo_id: str) -> dict | None:
        """Get a single repository by ID."""
        response = self.supabase.table("repositories") \
            .select("*") \
            .eq("id", repo_id) \
            .eq("user_id", self.user_id) \
            .single() \
            .execute()

        if response.data:
            return self._row_to_dict(response.data)
        return None

    def get_by_github_id(self, github_id: int) -> dict | None:
        """
        Get a repository by GitHub ID.

        Args:
            github_id: GitHub's numeric repository ID

        Returns:
            Repository dict or None if not found
        """
        response = self.supabase.table("repositories") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .eq("github_id", github_id) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return self._row_to_dict(response.data[0])
        return None

    def get_by_full_name(self, full_name: str) -> dict | None:
        """
        Get a repository by full_name (owner/repo).

        Args:
            full_name: Repository full name (e.g., "owner/repo")

        Returns:
            Repository dict or None if not found
        """
        response = self.supabase.table("repositories") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .eq("full_name", full_name) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return self._row_to_dict(response.data[0])
        return None

    def update_repository(self, repo_id: str, data: dict) -> dict | None:
        """
        Update repository custom fields.

        Args:
            repo_id: Repository UUID
            data: Dict with custom_description, custom_tags, custom_category
        """
        from datetime import datetime, timezone

        update_data = {"last_edited": datetime.now(timezone.utc).isoformat()}

        if "custom_description" in data:
            update_data["custom_description"] = data["custom_description"]
        if "custom_tags" in data:
            update_data["custom_tags"] = data["custom_tags"]
        if "custom_category" in data:
            update_data["custom_category"] = data["custom_category"]

        response = self.supabase.table("repositories") \
            .update(update_data) \
            .eq("id", repo_id) \
            .eq("user_id", self.user_id) \
            .execute()

        if response.data:
            return self._row_to_dict(response.data[0])
        return None

    def update_ai_analysis(self, repo_id: str, analysis: dict, is_fallback: bool = False) -> dict | None:
        """
        Update repository AI analysis results.

        Args:
            repo_id: Repository UUID
            analysis: Dict with ai_summary, ai_tags, ai_platforms
            is_fallback: If True, marks analysis_failed=True (AI failed, used fallback)
        """
        from datetime import datetime, timezone

        update_data = {
            "ai_summary": analysis.get("ai_summary"),
            "ai_tags": analysis.get("ai_tags", []),
            "ai_platforms": analysis.get("ai_platforms", []),
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_failed": is_fallback,
        }

        logger.info(
            f"Updating AI analysis for repo {repo_id}: "
            f"summary_len={len(analysis.get('ai_summary', '') or '')}, "
            f"tags={analysis.get('ai_tags', [])}"
        )

        response = self.supabase.table("repositories") \
            .update(update_data) \
            .eq("id", repo_id) \
            .eq("user_id", self.user_id) \
            .execute()

        if response.data:
            logger.info(f"AI analysis saved for repo {repo_id}")
            return self._row_to_dict(response.data[0])

        logger.warning(f"AI analysis update returned no data for repo {repo_id}")
        return None

    def mark_analysis_failed(self, repo_id: str) -> dict | None:
        """Mark repository AI analysis as failed."""
        from datetime import datetime, timezone

        update_data = {
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_failed": True,
        }

        response = self.supabase.table("repositories") \
            .update(update_data) \
            .eq("id", repo_id) \
            .eq("user_id", self.user_id) \
            .execute()

        if response.data:
            return self._row_to_dict(response.data[0])
        return None

    def reset_analysis_failed(self, repo_id: str) -> None:
        """Reset analysis_failed flag before retry."""
        self.supabase.table("repositories") \
            .update({"analysis_failed": False, "analyzed_at": None}) \
            .eq("id", repo_id) \
            .eq("user_id", self.user_id) \
            .execute()

    def get_unanalyzed_repositories(self, limit: int = 50) -> List[dict]:
        """
        Get repositories that haven't been analyzed yet.

        Args:
            limit: Max number of repositories to return

        Returns:
            List of repo dicts with id, full_name, description, readme_content, language, name
        """
        response = self.supabase.table("repositories") \
            .select("id, full_name, description, readme_content, language, name") \
            .eq("user_id", self.user_id) \
            .is_("analyzed_at", "null") \
            .eq("analysis_failed", False) \
            .limit(limit) \
            .execute()

        return response.data or []

    def get_repositories_needing_analysis(self) -> List[dict]:
        """
        Get repositories that need AI analysis.

        Conditions (OR):
        - ai_summary IS NULL
        - ai_tags IS NULL OR ai_tags = ''
        - analysis_failed = TRUE (retry)

        Returns:
            List of repo dicts with id, full_name, description, readme_content, language, name, analysis_failed
        """
        response = self.supabase.table("repositories") \
            .select("id, full_name, description, readme_content, language, name, analysis_failed") \
            .eq("user_id", self.user_id) \
            .or_("ai_summary.is.null,ai_tags.is.null,ai_tags.eq.{},analysis_failed.eq.true") \
            .execute()

        return response.data or []

    def upsert_extracted_repository(self, repo_data: dict) -> dict | None:
        """
        Upsert a repository extracted from article content.

        Sets is_extracted=True. If repo already exists, updates is_extracted flag.

        Args:
            repo_data: Dict with github_id, name, full_name, description,
                      html_url, stargazers_count, language, topics, owner, etc.

        Returns:
            Upserted repository dict or None on failure
        """
        github_id = repo_data.get("id") or repo_data.get("github_id")
        if not github_id:
            logger.error("Cannot upsert extracted repo: missing github_id")
            return None

        row = {
            "user_id": self.user_id,
            "github_id": github_id,
            "name": repo_data.get("name"),
            "full_name": repo_data.get("full_name"),
            "description": repo_data.get("description"),
            "html_url": repo_data.get("html_url"),
            "stargazers_count": repo_data.get("stargazers_count", 0),
            "language": repo_data.get("language"),
            "topics": repo_data.get("topics", []),
            "owner_login": repo_data.get("owner", {}).get("login", ""),
            "owner_avatar_url": repo_data.get("owner", {}).get("avatar_url"),
            "github_created_at": repo_data.get("created_at"),
            "github_updated_at": repo_data.get("updated_at"),
            "github_pushed_at": repo_data.get("pushed_at"),
            "readme_content": repo_data.get("readme_content"),
            "is_extracted": True,
        }

        try:
            response = self.supabase.table("repositories") \
                .upsert(row, on_conflict="user_id,github_id") \
                .execute()

            if response.data and len(response.data) > 0:
                logger.info(f"Upserted extracted repo: {repo_data.get('full_name')}")
                return self._row_to_dict(response.data[0])
            return None

        except Exception as e:
            logger.error(f"Failed to upsert extracted repo: {e}")
            return None

    def _row_to_dict(self, row: dict) -> dict:
        """Convert database row to response dict."""
        return {
            "id": row["id"],
            "github_id": row["github_id"],
            "name": row["name"],
            "full_name": row["full_name"],
            "description": row.get("description"),
            "html_url": row["html_url"],
            "stargazers_count": row.get("stargazers_count", 0),
            "language": row.get("language"),
            "topics": row.get("topics") or [],
            "owner_login": row["owner_login"],
            "owner_avatar_url": row.get("owner_avatar_url"),
            "starred_at": row.get("starred_at"),
            "github_updated_at": row.get("github_updated_at"),
            "github_pushed_at": row.get("github_pushed_at"),
            "readme_content": row.get("readme_content"),
            # AI analysis fields
            "ai_summary": row.get("ai_summary"),
            "ai_tags": row.get("ai_tags") or [],
            "ai_platforms": row.get("ai_platforms") or [],
            "analyzed_at": row.get("analyzed_at"),
            "analysis_failed": row.get("analysis_failed") or False,
            # Custom edit fields
            "custom_description": row.get("custom_description"),
            "custom_tags": row.get("custom_tags") or [],
            "custom_category": row.get("custom_category"),
            "last_edited": row.get("last_edited"),
            # Source tracking fields
            "is_starred": row.get("is_starred") or False,
            "is_extracted": row.get("is_extracted") or False,
        }

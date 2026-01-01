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

        Args:
            repos: List of repository dictionaries from GitHub API

        Returns:
            dict with total, new_count, updated_count
        """
        if not repos:
            return {"total": 0, "new_count": 0, "updated_count": 0}

        # Get existing github_ids
        existing_response = self.supabase.table("repositories") \
            .select("github_id") \
            .eq("user_id", self.user_id) \
            .execute()

        existing_ids = {row["github_id"] for row in (existing_response.data or [])}

        # Prepare rows for upsert
        db_rows = []
        new_count = 0
        for repo in repos:
            github_id = repo.get("id") or repo.get("github_id")
            if github_id not in existing_ids:
                new_count += 1

            db_rows.append({
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
                "readme_content": repo.get("readme_content"),
            })

        logger.info(
            f"Upserting {len(db_rows)} repositories ({new_count} new)",
            extra={'user_id': self.user_id}
        )

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
            "updated_count": updated_count
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

    def update_ai_analysis(self, repo_id: str, analysis: dict) -> dict | None:
        """
        Update repository AI analysis results.

        Args:
            repo_id: Repository UUID
            analysis: Dict with ai_summary, ai_tags, ai_platforms
        """
        from datetime import datetime, timezone

        update_data = {
            "ai_summary": analysis.get("ai_summary"),
            "ai_tags": analysis.get("ai_tags", []),
            "ai_platforms": analysis.get("ai_platforms", []),
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_failed": False,
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
        }

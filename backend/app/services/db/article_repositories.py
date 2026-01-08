"""
Article-Repository junction table service.

Manages the many-to-many relationship between articles and repositories.
"""

import logging
from typing import List, Optional

from .base import BaseDbService

logger = logging.getLogger(__name__)


class ArticleRepositoryService(BaseDbService):
    """Service for article-repository junction operations."""

    table_name = "article_repositories"

    def link_article_to_repo(
        self,
        article_id: str,
        repository_id: str,
        extracted_url: str
    ) -> Optional[dict]:
        """
        Create a link between an article and a repository.

        Args:
            article_id: Article UUID
            repository_id: Repository UUID
            extracted_url: Original URL found in article

        Returns:
            Created record or None if already exists
        """
        try:
            record = self._dict_to_row({
                "article_id": article_id,
                "repository_id": repository_id,
                "extracted_url": extracted_url,
            })

            response = self._table().upsert(
                record,
                on_conflict="article_id,repository_id"
            ).execute()

            if response.data:
                logger.debug(
                    f"Linked article {article_id} to repo {repository_id}"
                )
                return response.data[0]
            return None

        except Exception as e:
            logger.error(f"Failed to link article to repo: {e}")
            return None

    def bulk_link_repos(
        self,
        article_id: str,
        repo_links: List[dict]
    ) -> int:
        """
        Bulk create links between an article and multiple repositories.

        Args:
            article_id: Article UUID
            repo_links: List of dicts with 'repository_id' and 'extracted_url'

        Returns:
            Number of links created
        """
        if not repo_links:
            return 0

        records = [
            self._dict_to_row({
                "article_id": article_id,
                "repository_id": link["repository_id"],
                "extracted_url": link["extracted_url"],
            })
            for link in repo_links
        ]

        try:
            response = self._table().upsert(
                records,
                on_conflict="article_id,repository_id"
            ).execute()

            count = len(response.data) if response.data else 0
            logger.info(f"Bulk linked {count} repos to article {article_id}")
            return count

        except Exception as e:
            logger.error(f"Failed to bulk link repos: {e}")
            return 0

    def get_repos_for_article(self, article_id: str) -> List[dict]:
        """
        Get all repositories linked to an article.

        Args:
            article_id: Article UUID

        Returns:
            List of repository records with junction data
        """
        response = self._query("*, repositories(*)") \
            .eq("article_id", article_id) \
            .execute()

        return response.data or []

    def get_articles_for_repo(self, repository_id: str) -> List[dict]:
        """
        Get all articles that reference a repository.

        Args:
            repository_id: Repository UUID

        Returns:
            List of article records with junction data
        """
        response = self._query("*, articles(id, title, url, published_at)") \
            .eq("repository_id", repository_id) \
            .order("created_at", desc=True) \
            .execute()

        return response.data or []

    def get_repo_count_for_article(self, article_id: str) -> int:
        """Get count of repositories linked to an article."""
        response = self._query("id") \
            .eq("article_id", article_id) \
            .execute()

        return len(response.data) if response.data else 0

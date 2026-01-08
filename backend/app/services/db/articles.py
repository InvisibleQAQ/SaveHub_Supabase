"""
Article database service using Supabase Python SDK.

Mirrors the functionality of lib/db/articles.ts
"""

import logging
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from .base import BaseDbService

logger = logging.getLogger(__name__)


class ArticleService(BaseDbService):
    """Service for article database operations."""

    table_name = "articles"

    # Fields allowed in update operations
    UPDATE_FIELDS = {
        "is_read", "is_starred", "title", "content", "summary",
        "url", "author", "published_at", "thumbnail",
    }

    def _row_to_dict(self, row: dict) -> dict:
        """Convert database row to article dict."""
        return {
            "id": row["id"],
            "feed_id": row["feed_id"],
            "title": row["title"],
            "content": row["content"],
            "summary": row.get("summary"),
            "url": row["url"],
            "author": row.get("author"),
            "published_at": row["published_at"],
            "is_read": row["is_read"],
            "is_starred": row["is_starred"],
            "thumbnail": row.get("thumbnail"),
            "content_hash": row.get("content_hash"),
            "user_id": row["user_id"],
            "created_at": row.get("created_at"),
        }

    def save_articles(self, articles: List[dict]) -> None:
        """
        Save multiple articles to database.
        Upserts articles with current user ownership.

        Args:
            articles: List of article dictionaries
        """
        db_rows = []
        for article in articles:
            db_rows.append(self._dict_to_row({
                "id": str(article.get("id")) if article.get("id") else None,
                "feed_id": str(article["feed_id"]),
                "title": article["title"],
                "content": article["content"],
                "summary": article.get("summary"),
                "url": article["url"],
                "author": article.get("author"),
                "published_at": article.get("published_at"),
                "is_read": article.get("is_read", False),
                "is_starred": article.get("is_starred", False),
                "thumbnail": article.get("thumbnail"),
                "content_hash": article.get("content_hash"),
            }))

        logger.debug(f"Saving {len(articles)} articles for user {self.user_id}")

        response = self._table().upsert(
            db_rows,
            on_conflict="feed_id,content_hash"
        ).execute()

        logger.info(f"Saved {len(response.data or [])} articles for user {self.user_id}")

    def load_articles(
        self,
        feed_id: Optional[str] = None,
        limit: Optional[int] = None
    ) -> List[dict]:
        """
        Load articles for current user.
        Can filter by feedId and limit results.

        Args:
            feed_id: Optional feed UUID to filter by
            limit: Optional max number of articles to return

        Returns:
            List of article dictionaries
        """
        logger.debug(f"Loading articles: feed_id={feed_id}, limit={limit}")

        # Use custom query for JOIN with article_repositories
        query = self._query("*, article_repositories(count)") \
            .order("published_at", desc=True)

        if feed_id:
            query = query.eq("feed_id", feed_id)

        if limit:
            query = query.limit(limit)

        response = query.execute()

        articles = []
        for row in response.data or []:
            # Extract repository count from JOIN
            repo_count = 0
            if row.get("article_repositories"):
                repo_count = row["article_repositories"][0].get("count", 0)

            article = self._row_to_dict(row)
            article["repository_count"] = repo_count
            articles.append(article)

        logger.debug(f"Loaded {len(articles)} articles")
        return articles

    def get_article(self, article_id: str) -> Optional[dict]:
        """Get a single article by ID."""
        return self._get_one({"id": article_id})

    def update_article(self, article_id: str, updates: dict) -> None:
        """
        Update specific fields of an article.
        Only updates provided fields, leaves others unchanged.

        Args:
            article_id: Article UUID
            updates: Dictionary of fields to update
        """
        update_data = self._prepare_update_data(updates, self.UPDATE_FIELDS)

        logger.debug(f"Updating article {article_id}: {list(update_data.keys())}")

        self._update_one(article_id, update_data)

        logger.debug(f"Updated article {article_id}")

    def delete_article(self, article_id: str) -> None:
        """Delete a single article."""
        self._delete_one(article_id)

        logger.info(f"Deleted article {article_id}")

    def clear_old_articles(self, days_to_keep: int = 30) -> int:
        """
        Delete old read articles that are not starred.
        Returns number of articles deleted.

        Args:
            days_to_keep: Number of days to keep articles (default 30)

        Returns:
            Number of articles deleted
        """
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)

        logger.debug(f"Clearing articles older than {cutoff_date.isoformat()}")

        response = (
            self._table()
            .delete()
            .eq("user_id", self.user_id)
            .lt("published_at", cutoff_date.isoformat())
            .eq("is_read", True)
            .eq("is_starred", False)
            .execute()
        )

        deleted_count = len(response.data or [])
        logger.info(f"Cleared {deleted_count} old articles")
        return deleted_count

    def get_article_stats(self) -> dict:
        """
        Get article statistics for current user.
        Returns total, unread, starred counts and per-feed breakdown.

        Returns:
            dict with total, unread, starred, and by_feed stats
        """
        logger.debug(f"Calculating article statistics for user {self.user_id}")

        response = self._query("id, feed_id, is_read, is_starred").execute()

        stats = {
            "total": len(response.data or []),
            "unread": 0,
            "starred": 0,
            "by_feed": {},
        }

        for article in response.data or []:
            if not article["is_read"]:
                stats["unread"] += 1
            if article["is_starred"]:
                stats["starred"] += 1

            feed_id = article["feed_id"]
            if feed_id not in stats["by_feed"]:
                stats["by_feed"][feed_id] = {"total": 0, "unread": 0}

            stats["by_feed"][feed_id]["total"] += 1
            if not article["is_read"]:
                stats["by_feed"][feed_id]["unread"] += 1

        logger.debug(f"Stats: total={stats['total']}, unread={stats['unread']}, starred={stats['starred']}")
        return stats

    def get_articles_needing_repo_extraction(self, limit: int = 50) -> List[dict]:
        """
        Get articles that need GitHub repo extraction.

        Conditions:
        - images_processed = true (content is finalized)
        - repos_extracted IS NULL (not yet attempted)

        Args:
            limit: Max number of articles to return

        Returns:
            List of dicts with id, user_id, content, summary
        """
        response = (
            self._query("id, user_id, content, summary")
            .eq("images_processed", True)
            .is_("repos_extracted", "null")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        return response.data or []

    def mark_repos_extracted(self, article_id: str, success: bool) -> None:
        """
        Update article's repo extraction status.

        Args:
            article_id: Article UUID
            success: True if extraction succeeded, False if failed
        """
        update_data = {
            "repos_extracted": success,
            "repos_extracted_at": datetime.now(timezone.utc).isoformat(),
        }

        self._update_one(article_id, update_data)

        logger.debug(f"Marked article {article_id} repos_extracted={success}")

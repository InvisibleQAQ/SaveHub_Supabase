"""
Feed database service using Supabase Python SDK.

Mirrors the functionality of lib/db/feeds.ts
"""

import logging
from typing import Optional, List
from datetime import datetime
from supabase import Client

logger = logging.getLogger(__name__)


def _cancel_feed_task(feed_id: str):
    """Cancel Celery refresh task for a feed (lazy import to avoid circular deps)."""
    try:
        from app.celery_app.tasks import cancel_feed_refresh
        cancel_feed_refresh(feed_id)
    except Exception as e:
        logger.warning(f"Failed to cancel feed task {feed_id}: {e}")


class FeedService:
    """Service for feed database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    def save_feeds(self, feeds: List[dict]) -> dict:
        """
        Save multiple feeds to database.
        Upserts feeds with current user ownership.

        Args:
            feeds: List of feed dictionaries

        Returns:
            dict with success status and optional error
        """
        db_rows = []
        for feed in feeds:
            # Convert datetime to ISO string for JSON serialization
            last_fetched = feed.get("last_fetched")
            if isinstance(last_fetched, datetime):
                last_fetched = last_fetched.isoformat()

            db_rows.append({
                "id": str(feed.get("id")) if feed.get("id") else None,
                "title": feed["title"],
                "url": feed["url"],
                "description": feed.get("description"),
                "category": feed.get("category"),
                "folder_id": str(feed["folder_id"]) if feed.get("folder_id") else None,
                "order": feed.get("order", 0),
                "unread_count": feed.get("unread_count", 0),
                "refresh_interval": feed.get("refresh_interval", 60),
                "user_id": self.user_id,
                "last_fetched": last_fetched,
                "last_fetch_status": feed.get("last_fetch_status"),
                "last_fetch_error": feed.get("last_fetch_error"),
                "enable_deduplication": feed.get("enable_deduplication", False),
            })

        logger.debug(
            f"Saving {len(feeds)} feeds",
            extra={'user_id': self.user_id}
        )

        try:
            response = self.supabase.table("feeds").upsert(db_rows).execute()

            if response.data:
                logger.info(
                    f"Saved {len(response.data)} feeds",
                    extra={'user_id': self.user_id}
                )
                return {"success": True}
            return {"success": True}
        except Exception as e:
            logger.error(
                "Failed to save feeds",
                extra={'user_id': self.user_id, 'error': str(e)}
            )
            if "23505" in str(e):
                return {"success": False, "error": "duplicate"}
            raise

    def load_feeds(self) -> List[dict]:
        """
        Load all feeds for current user.
        Returns feeds ordered by order field.
        """
        logger.debug("Loading feeds", extra={'user_id': self.user_id})

        response = self.supabase.table("feeds") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .order("order", desc=False) \
            .execute()

        feeds = []
        for row in response.data or []:
            feeds.append({
                "id": row["id"],
                "title": row["title"],
                "url": row["url"],
                "description": row.get("description"),
                "category": row.get("category"),
                "folder_id": row.get("folder_id"),
                "order": row["order"],
                "unread_count": row["unread_count"],
                "refresh_interval": row["refresh_interval"],
                "user_id": row["user_id"],
                "last_fetched": row.get("last_fetched"),
                "last_fetch_status": row.get("last_fetch_status"),
                "last_fetch_error": row.get("last_fetch_error"),
                "enable_deduplication": row.get("enable_deduplication", False),
                "created_at": row.get("created_at"),
            })

        logger.debug(f"Loaded {len(feeds)} feeds", extra={'user_id': self.user_id})
        return feeds

    def get_feed(self, feed_id: str) -> Optional[dict]:
        """Get a single feed by ID."""
        try:
            # Use limit(1) instead of single() to avoid exception when no data found
            response = self.supabase.table("feeds") \
                .select("*") \
                .eq("id", feed_id) \
                .eq("user_id", self.user_id) \
                .limit(1) \
                .execute()
        except Exception as e:
            logger.error(
                f"Database error getting feed {feed_id}",
                extra={'user_id': self.user_id, 'error': str(e)}
            )
            return None

        if response.data and len(response.data) > 0:
            row = response.data[0]
            return {
                "id": row["id"],
                "title": row["title"],
                "url": row["url"],
                "description": row.get("description"),
                "category": row.get("category"),
                "folder_id": row.get("folder_id"),
                "order": row["order"],
                "unread_count": row["unread_count"],
                "refresh_interval": row["refresh_interval"],
                "user_id": row["user_id"],
                "last_fetched": row.get("last_fetched"),
                "last_fetch_status": row.get("last_fetch_status"),
                "last_fetch_error": row.get("last_fetch_error"),
                "enable_deduplication": row.get("enable_deduplication", False),
                "created_at": row.get("created_at"),
            }
        return None

    def update_feed(self, feed_id: str, updates: dict) -> dict:
        """
        Update a single feed.
        Allows partial updates of feed properties.

        Args:
            feed_id: Feed UUID
            updates: Dictionary of fields to update

        Returns:
            dict with success status and optional error
        """
        logger.info(
            f"update_feed called: feed_id={feed_id}, updates={updates}",
            extra={'user_id': self.user_id}
        )

        update_data = {}

        field_mapping = {
            "title": "title",
            "url": "url",
            "description": "description",
            "category": "category",
            "folder_id": "folder_id",
            "order": "order",
            "unread_count": "unread_count",
            "refresh_interval": "refresh_interval",
            "last_fetched": "last_fetched",
            "last_fetch_status": "last_fetch_status",
            "last_fetch_error": "last_fetch_error",
            "enable_deduplication": "enable_deduplication",
        }

        for key, db_key in field_mapping.items():
            if key in updates and updates[key] is not None:
                value = updates[key]
                # Convert datetime to ISO string for Supabase
                if isinstance(value, datetime):
                    value = value.isoformat()
                update_data[db_key] = value

        logger.info(
            f"Updating feed {feed_id} with data: {update_data}",
            extra={'user_id': self.user_id}
        )

        if not update_data:
            logger.warning(
                f"No valid update data for feed {feed_id}",
                extra={'user_id': self.user_id}
            )
            return {"success": True, "message": "No fields to update"}

        try:
            response = self.supabase.table("feeds") \
                .update(update_data) \
                .eq("id", feed_id) \
                .eq("user_id", self.user_id) \
                .execute()

            logger.info(
                f"Updated feed {feed_id}, response data: {response.data}",
                extra={'user_id': self.user_id}
            )
            return {"success": True}
        except Exception as e:
            logger.error(
                f"Failed to update feed {feed_id}",
                extra={'user_id': self.user_id, 'error': str(e)}
            )
            if "23505" in str(e):
                return {"success": False, "error": "duplicate"}
            raise

    def delete_feed(self, feed_id: str) -> dict:
        """
        Delete a feed and all its articles.
        Returns deletion statistics.

        Args:
            feed_id: Feed UUID

        Returns:
            dict with articles_deleted and feed_deleted
        """
        logger.debug(
            f"Starting feed deletion: {feed_id}",
            extra={'user_id': self.user_id}
        )

        # Step 0: Cancel scheduled Celery refresh task
        _cancel_feed_task(feed_id)

        # Step 1: Count and delete articles
        articles_response = self.supabase.table("articles") \
            .select("id") \
            .eq("feed_id", feed_id) \
            .eq("user_id", self.user_id) \
            .execute()

        article_count = len(articles_response.data or [])
        logger.debug(
            f"Found {article_count} articles to delete for feed {feed_id}",
            extra={'user_id': self.user_id}
        )

        articles_deleted = 0
        if article_count > 0:
            self.supabase.table("articles") \
                .delete() \
                .eq("feed_id", feed_id) \
                .eq("user_id", self.user_id) \
                .execute()
            articles_deleted = article_count
            logger.info(
                f"Deleted {articles_deleted} articles for feed {feed_id}",
                extra={'user_id': self.user_id}
            )

        # Step 2: Delete the feed
        self.supabase.table("feeds") \
            .delete() \
            .eq("id", feed_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(
            f"Deleted feed {feed_id} with {articles_deleted} articles",
            extra={'user_id': self.user_id}
        )
        return {"articles_deleted": articles_deleted, "feed_deleted": True}

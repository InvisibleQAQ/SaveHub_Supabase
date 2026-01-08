"""
Settings database service using Supabase Python SDK.

Mirrors the functionality of lib/db/settings.ts
"""

import logging
from typing import Optional
from datetime import datetime

from .base import BaseDbService

logger = logging.getLogger(__name__)

# Default settings matching the frontend
DEFAULT_SETTINGS = {
    "theme": "system",
    "font_size": 16,
    "auto_refresh": True,
    "refresh_interval": 30,
    "articles_retention_days": 30,
    "mark_as_read_on_scroll": False,
    "show_thumbnails": True,
    "sidebar_pinned": False,
}


class SettingsService(BaseDbService):
    """Service for settings database operations."""

    table_name = "settings"

    # Fields allowed in update operations
    UPDATE_FIELDS = {
        "theme", "font_size", "auto_refresh", "refresh_interval",
        "articles_retention_days", "mark_as_read_on_scroll",
        "show_thumbnails", "sidebar_pinned", "github_token"
    }

    def _row_to_dict(self, row: dict) -> dict:
        """Convert database row to settings dict."""
        return {
            "user_id": row["user_id"],
            "theme": row["theme"],
            "font_size": row["font_size"],
            "auto_refresh": row["auto_refresh"],
            "refresh_interval": row["refresh_interval"],
            "articles_retention_days": row["articles_retention_days"],
            "mark_as_read_on_scroll": row["mark_as_read_on_scroll"],
            "show_thumbnails": row["show_thumbnails"],
            "sidebar_pinned": row.get("sidebar_pinned", False),
            "github_token": row.get("github_token"),
            "updated_at": row.get("updated_at"),
        }

    def save_settings(self, settings: dict) -> None:
        """
        Save user settings to database.
        Upserts settings for current user.

        Args:
            settings: Settings dictionary
        """
        db_settings = self._dict_to_row({
            "theme": settings.get("theme", DEFAULT_SETTINGS["theme"]),
            "font_size": settings.get("font_size", DEFAULT_SETTINGS["font_size"]),
            "auto_refresh": settings.get("auto_refresh", DEFAULT_SETTINGS["auto_refresh"]),
            "refresh_interval": settings.get("refresh_interval", DEFAULT_SETTINGS["refresh_interval"]),
            "articles_retention_days": settings.get("articles_retention_days", DEFAULT_SETTINGS["articles_retention_days"]),
            "mark_as_read_on_scroll": settings.get("mark_as_read_on_scroll", DEFAULT_SETTINGS["mark_as_read_on_scroll"]),
            "show_thumbnails": settings.get("show_thumbnails", DEFAULT_SETTINGS["show_thumbnails"]),
            "sidebar_pinned": settings.get("sidebar_pinned", DEFAULT_SETTINGS["sidebar_pinned"]),
            "github_token": settings.get("github_token"),
            "updated_at": datetime.utcnow(),
        })

        logger.debug(f"Saving settings for user {self.user_id}")

        self._table().upsert(db_settings).execute()

        logger.info(f"Saved settings for user {self.user_id}")

    def load_settings(self) -> Optional[dict]:
        """
        Load user settings from database.
        Returns None if no settings found for user.

        Returns:
            Settings dictionary or None
        """
        return self._get_one({}, not_found_ok=True)

    def update_settings(self, updates: dict) -> None:
        """
        Update specific fields of settings.
        Only updates provided fields.

        Args:
            updates: Dictionary of fields to update
        """
        update_data = {"updated_at": datetime.utcnow().isoformat()}

        # Special handling: allow None values (to delete github_token)
        for key in self.UPDATE_FIELDS:
            if key in updates:
                update_data[key] = updates[key]

        logger.debug(f"Updating settings: {list(update_data.keys())}")

        self._table().update(update_data).eq("user_id", self.user_id).execute()

        logger.info(f"Updated settings for user {self.user_id}")

    def delete_settings(self) -> None:
        """Delete user settings."""
        self._table().delete().eq("user_id", self.user_id).execute()

        logger.info(f"Deleted settings for user {self.user_id}")

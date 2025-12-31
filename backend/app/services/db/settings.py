"""
Settings database service using Supabase Python SDK.

Mirrors the functionality of lib/db/settings.ts
"""

import logging
from typing import Optional
from datetime import datetime
from supabase import Client

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


class SettingsService:
    """Service for settings database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    def save_settings(self, settings: dict) -> None:
        """
        Save user settings to database.
        Upserts settings for current user.

        Args:
            settings: Settings dictionary
        """
        db_settings = {
            "user_id": self.user_id,
            "theme": settings.get("theme", DEFAULT_SETTINGS["theme"]),
            "font_size": settings.get("font_size", DEFAULT_SETTINGS["font_size"]),
            "auto_refresh": settings.get("auto_refresh", DEFAULT_SETTINGS["auto_refresh"]),
            "refresh_interval": settings.get("refresh_interval", DEFAULT_SETTINGS["refresh_interval"]),
            "articles_retention_days": settings.get("articles_retention_days", DEFAULT_SETTINGS["articles_retention_days"]),
            "mark_as_read_on_scroll": settings.get("mark_as_read_on_scroll", DEFAULT_SETTINGS["mark_as_read_on_scroll"]),
            "show_thumbnails": settings.get("show_thumbnails", DEFAULT_SETTINGS["show_thumbnails"]),
            "sidebar_pinned": settings.get("sidebar_pinned", DEFAULT_SETTINGS["sidebar_pinned"]),
            "github_token": settings.get("github_token"),
            "updated_at": datetime.utcnow().isoformat(),
        }

        logger.debug(f"Saving settings for user {self.user_id}")

        self.supabase.table("settings").upsert(db_settings).execute()

        logger.info(f"Saved settings for user {self.user_id}")

    def load_settings(self) -> Optional[dict]:
        """
        Load user settings from database.
        Returns None if no settings found for user.

        Returns:
            Settings dictionary or None
        """
        try:
            response = self.supabase.table("settings") \
                .select("*") \
                .eq("user_id", self.user_id) \
                .single() \
                .execute()

            if response.data:
                row = response.data
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
            return None
        except Exception as e:
            # PGRST116 = no rows found
            if "PGRST116" in str(e):
                return None
            logger.error(f"Failed to load settings: {e}")
            raise

    def update_settings(self, updates: dict) -> None:
        """
        Update specific fields of settings.
        Only updates provided fields.

        Args:
            updates: Dictionary of fields to update
        """
        update_data = {"updated_at": datetime.utcnow().isoformat()}

        field_mapping = {
            "theme": "theme",
            "font_size": "font_size",
            "auto_refresh": "auto_refresh",
            "refresh_interval": "refresh_interval",
            "articles_retention_days": "articles_retention_days",
            "mark_as_read_on_scroll": "mark_as_read_on_scroll",
            "show_thumbnails": "show_thumbnails",
            "sidebar_pinned": "sidebar_pinned",
            "github_token": "github_token",
        }

        for key, db_key in field_mapping.items():
            if key in updates:
                # Support explicit None to delete token
                update_data[db_key] = updates[key]

        logger.debug(f"Updating settings: {list(update_data.keys())}")

        self.supabase.table("settings") \
            .update(update_data) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Updated settings for user {self.user_id}")

    def delete_settings(self) -> None:
        """Delete user settings."""
        self.supabase.table("settings") \
            .delete() \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Deleted settings for user {self.user_id}")

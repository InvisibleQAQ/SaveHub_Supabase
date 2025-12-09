"""
Folder database service using Supabase Python SDK.

Mirrors the functionality of lib/db/folders.ts
"""

import logging
from typing import Optional, List
from datetime import datetime
from supabase import Client

logger = logging.getLogger(__name__)


class FolderService:
    """Service for folder database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    def save_folders(self, folders: List[dict]) -> dict:
        """
        Save multiple folders to database.
        Upserts folders with current user ownership.

        Args:
            folders: List of folder dictionaries

        Returns:
            dict with success status and optional error
        """
        db_rows = []
        for folder in folders:
            created_at = folder.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            elif created_at is None:
                created_at = datetime.utcnow().isoformat()

            db_rows.append({
                "id": str(folder.get("id")) if folder.get("id") else None,
                "name": folder["name"],
                "order": folder.get("order", 0),
                "user_id": self.user_id,
                "created_at": created_at,
            })

        logger.debug(f"Saving {len(folders)} folders for user {self.user_id}")

        try:
            response = self.supabase.table("folders").upsert(db_rows).execute()

            logger.info(f"Saved {len(response.data or [])} folders")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to save folders: {e}")
            if "23505" in str(e):
                return {"success": False, "error": "duplicate"}
            raise

    def load_folders(self) -> List[dict]:
        """
        Load all folders for current user.
        Returns folders ordered by order field.
        """
        response = self.supabase.table("folders") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .order("order", desc=False) \
            .execute()

        folders = []
        for row in response.data or []:
            folders.append({
                "id": row["id"],
                "name": row["name"],
                "order": row["order"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
            })

        logger.debug(f"Loaded {len(folders)} folders")
        return folders

    def get_folder(self, folder_id: str) -> Optional[dict]:
        """Get a single folder by ID."""
        response = self.supabase.table("folders") \
            .select("*") \
            .eq("id", folder_id) \
            .eq("user_id", self.user_id) \
            .single() \
            .execute()

        if response.data:
            row = response.data
            return {
                "id": row["id"],
                "name": row["name"],
                "order": row["order"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
            }
        return None

    def update_folder(self, folder_id: str, updates: dict) -> dict:
        """
        Update a single folder.

        Args:
            folder_id: Folder UUID
            updates: Dictionary of fields to update

        Returns:
            dict with success status
        """
        update_data = {}

        if "name" in updates and updates["name"] is not None:
            update_data["name"] = updates["name"]
        if "order" in updates and updates["order"] is not None:
            update_data["order"] = updates["order"]

        logger.debug(f"Updating folder {folder_id}: {list(update_data.keys())}")

        self.supabase.table("folders") \
            .update(update_data) \
            .eq("id", folder_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Updated folder {folder_id}")
        return {"success": True}

    def delete_folder(self, folder_id: str) -> None:
        """
        Delete a folder.
        Note: Feeds in this folder will have their folder_id set to null.

        Args:
            folder_id: Folder UUID
        """
        logger.debug(f"Deleting folder {folder_id}")

        self.supabase.table("folders") \
            .delete() \
            .eq("id", folder_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Deleted folder {folder_id}")

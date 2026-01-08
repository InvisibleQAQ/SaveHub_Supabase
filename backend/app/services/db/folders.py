"""
Folder database service using Supabase Python SDK.

Mirrors the functionality of lib/db/folders.ts
"""

import logging
from typing import Optional, List
from datetime import datetime

from .base import BaseDbService

logger = logging.getLogger(__name__)


class FolderService(BaseDbService):
    """Service for folder database operations."""

    table_name = "folders"

    # Fields allowed in update operations
    UPDATE_FIELDS = {"name", "order"}

    def _row_to_dict(self, row: dict) -> dict:
        """Convert database row to folder dict."""
        return {
            "id": row["id"],
            "name": row["name"],
            "order": row["order"],
            "user_id": row["user_id"],
            "created_at": row["created_at"],
        }

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
            if created_at is None:
                created_at = datetime.utcnow()

            db_rows.append(self._dict_to_row({
                "id": str(folder.get("id")) if folder.get("id") else None,
                "name": folder["name"],
                "order": folder.get("order", 0),
                "created_at": created_at,
            }))

        logger.debug(f"Saving {len(folders)} folders for user {self.user_id}")

        try:
            response = self._table().upsert(db_rows).execute()

            logger.info(f"Saved {len(response.data or [])} folders")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to save folders: {e}")
            if self._is_duplicate_error(e):
                return {"success": False, "error": "duplicate"}
            raise

    def load_folders(self) -> List[dict]:
        """
        Load all folders for current user.
        Returns folders ordered by order field.
        """
        return self._get_many(order_by="order", order_desc=False)

    def get_folder(self, folder_id: str) -> Optional[dict]:
        """Get a single folder by ID."""
        return self._get_one({"id": folder_id})

    def update_folder(self, folder_id: str, updates: dict) -> dict:
        """
        Update a single folder.

        Args:
            folder_id: Folder UUID
            updates: Dictionary of fields to update

        Returns:
            dict with success status
        """
        update_data = self._prepare_update_data(updates, self.UPDATE_FIELDS)

        logger.debug(f"Updating folder {folder_id}: {list(update_data.keys())}")

        self._update_one(folder_id, update_data)

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

        self._delete_one(folder_id)

        logger.info(f"Deleted folder {folder_id}")

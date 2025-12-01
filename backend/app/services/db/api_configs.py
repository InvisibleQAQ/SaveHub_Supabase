"""
API Config database service using Supabase Python SDK.

Mirrors the functionality of lib/db/api-configs.ts

Note: This version does NOT include encryption/decryption.
If encryption is needed, implement using cryptography library.
"""

import logging
from typing import Optional, List
from datetime import datetime
from supabase import Client

logger = logging.getLogger(__name__)


class ApiConfigService:
    """Service for API config database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    def save_api_configs(self, configs: List[dict]) -> dict:
        """
        Save multiple API configs to database.

        Note: In the frontend, apiKey and apiBase are encrypted.
        This backend version stores them as-is. Add encryption if needed.

        Args:
            configs: List of API config dictionaries

        Returns:
            dict with success status and optional error
        """
        db_rows = []
        for config in configs:
            created_at = config.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()

            db_rows.append({
                "id": str(config.get("id")) if config.get("id") else None,
                "name": config["name"],
                "api_key": config["api_key"],  # Consider encrypting
                "api_base": config["api_base"],  # Consider encrypting
                "model": config["model"],
                "is_default": config.get("is_default", False),
                "is_active": config.get("is_active", True),
                "user_id": self.user_id,
                "created_at": created_at,
            })

        logger.debug(f"Saving {len(configs)} API configs for user {self.user_id}")

        try:
            response = self.supabase.table("api_configs").upsert(db_rows).execute()

            logger.info(f"Saved {len(response.data or [])} API configs")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to save API configs: {e}")
            return {"success": False, "error": str(e)}

    def load_api_configs(self) -> List[dict]:
        """
        Load all API configs for current user.

        Note: In the frontend, apiKey and apiBase are decrypted after loading.
        This backend version returns them as-is. Add decryption if needed.

        Returns:
            List of API config dictionaries
        """
        logger.debug(f"Loading API configs for user {self.user_id}")

        response = self.supabase.table("api_configs") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .order("created_at", desc=True) \
            .execute()

        configs = []
        for row in response.data or []:
            configs.append({
                "id": row["id"],
                "name": row["name"],
                "api_key": row["api_key"],  # Consider decrypting
                "api_base": row["api_base"],  # Consider decrypting
                "model": row["model"],
                "is_default": row["is_default"],
                "is_active": row["is_active"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
            })

        logger.info(f"Loaded {len(configs)} API configs")
        return configs

    def get_api_config(self, config_id: str) -> Optional[dict]:
        """Get a single API config by ID."""
        response = self.supabase.table("api_configs") \
            .select("*") \
            .eq("id", config_id) \
            .eq("user_id", self.user_id) \
            .single() \
            .execute()

        if response.data:
            row = response.data
            return {
                "id": row["id"],
                "name": row["name"],
                "api_key": row["api_key"],
                "api_base": row["api_base"],
                "model": row["model"],
                "is_default": row["is_default"],
                "is_active": row["is_active"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
            }
        return None

    def get_default_config(self) -> Optional[dict]:
        """Get the default API config for current user."""
        response = self.supabase.table("api_configs") \
            .select("*") \
            .eq("user_id", self.user_id) \
            .eq("is_default", True) \
            .eq("is_active", True) \
            .single() \
            .execute()

        if response.data:
            row = response.data
            return {
                "id": row["id"],
                "name": row["name"],
                "api_key": row["api_key"],
                "api_base": row["api_base"],
                "model": row["model"],
                "is_default": row["is_default"],
                "is_active": row["is_active"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
            }
        return None

    def update_api_config(self, config_id: str, updates: dict) -> dict:
        """
        Update a single API config.

        Args:
            config_id: API config UUID
            updates: Dictionary of fields to update

        Returns:
            dict with success status
        """
        update_data = {}

        field_mapping = {
            "name": "name",
            "api_key": "api_key",
            "api_base": "api_base",
            "model": "model",
            "is_default": "is_default",
            "is_active": "is_active",
        }

        for key, db_key in field_mapping.items():
            if key in updates and updates[key] is not None:
                update_data[db_key] = updates[key]

        logger.debug(f"Updating API config {config_id}: {list(update_data.keys())}")

        self.supabase.table("api_configs") \
            .update(update_data) \
            .eq("id", config_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Updated API config {config_id}")
        return {"success": True}

    def delete_api_config(self, config_id: str) -> None:
        """
        Delete an API config.

        Args:
            config_id: API config UUID
        """
        logger.debug(f"Deleting API config {config_id}")

        self.supabase.table("api_configs") \
            .delete() \
            .eq("id", config_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Deleted API config {config_id}")

    def set_default_config(self, config_id: str) -> None:
        """
        Set a config as the default, unsetting any previous default.

        Args:
            config_id: API config UUID to set as default
        """
        # First, unset all defaults for this user
        self.supabase.table("api_configs") \
            .update({"is_default": False}) \
            .eq("user_id", self.user_id) \
            .execute()

        # Then set the new default
        self.supabase.table("api_configs") \
            .update({"is_default": True}) \
            .eq("id", config_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Set API config {config_id} as default")

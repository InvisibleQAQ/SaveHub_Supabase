"""
API Config database service using Supabase Python SDK.

Supports three API types: chat, embedding, rerank.
Each type can have multiple configs but only one active per user.

Note: This version does NOT include encryption/decryption.
Router layer handles encryption before save and decryption after load.
"""

import logging
from typing import Optional, List

from .base import BaseDbService

logger = logging.getLogger(__name__)


class ApiConfigService(BaseDbService):
    """Service for API config database operations."""

    table_name = "api_configs"

    # Fields allowed in update operations
    UPDATE_FIELDS = {"name", "api_key", "api_base", "model", "type", "is_active"}

    def _row_to_dict(self, row: dict) -> dict:
        """Convert database row to dict."""
        return {
            "id": row["id"],
            "name": row["name"],
            "api_key": row["api_key"],
            "api_base": row["api_base"],
            "model": row["model"],
            "type": row["type"],
            "is_active": row["is_active"],
            "user_id": row["user_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def load_api_configs(self, config_type: Optional[str] = None) -> List[dict]:
        """
        Load API configs for current user, optionally filtered by type.

        Args:
            config_type: Optional filter by type ('chat', 'embedding', 'rerank')

        Returns:
            List of API config dictionaries
        """
        logger.debug(f"Loading API configs for user {self.user_id}, type={config_type}")

        filters = {"type": config_type} if config_type else None
        configs = self._get_many(
            filters=filters,
            order_by="created_at",
            order_desc=True,
        )

        logger.info(f"Loaded {len(configs)} API configs")
        return configs

    def get_api_config(self, config_id: str) -> Optional[dict]:
        """Get a single API config by ID."""
        return self._get_one({"id": config_id})

    def get_active_config(self, config_type: str) -> Optional[dict]:
        """
        Get the active config for a specific type.

        Args:
            config_type: 'chat', 'embedding', or 'rerank'

        Returns:
            Active config dict or None
        """
        return self._get_one({"type": config_type, "is_active": True})

    def create_api_config(self, config: dict) -> dict:
        """
        Create a new API config.

        If is_active=True, deactivates other configs of same type first.

        Args:
            config: API config data

        Returns:
            Created config dict
        """
        config_type = config.get("type", "chat")
        is_active = config.get("is_active", True)

        # If activating, deactivate others of same type first
        if is_active:
            self._deactivate_others(config_type)

        db_row = self._dict_to_row({
            "name": config["name"],
            "api_key": config["api_key"],
            "api_base": config["api_base"],
            "model": config["model"],
            "type": config_type,
            "is_active": is_active,
        })

        response = self._table().insert(db_row).execute()

        if response.data:
            logger.info(f"Created API config: {response.data[0]['id']} (type={config_type})")
            return self._row_to_dict(response.data[0])
        raise Exception("Failed to create API config")

    def update_api_config(self, config_id: str, updates: dict) -> dict:
        """
        Update an API config.

        If is_active is set to True, deactivates other configs of same type.

        Args:
            config_id: API config UUID
            updates: Fields to update

        Returns:
            Updated config dict
        """
        # Get existing config to know its type
        existing = self.get_api_config(config_id)
        if not existing:
            raise ValueError(f"Config {config_id} not found")

        config_type = updates.get("type", existing["type"])

        # If activating, deactivate others first
        if updates.get("is_active") is True:
            self._deactivate_others(config_type, exclude_id=config_id)

        update_data = self._prepare_update_data(updates, self.UPDATE_FIELDS)

        if not update_data:
            return existing

        logger.debug(f"Updating API config {config_id}: {list(update_data.keys())}")

        response = (
            self._table()
            .update(update_data)
            .eq("id", config_id)
            .eq("user_id", self.user_id)
            .execute()
        )

        if response.data:
            logger.info(f"Updated API config {config_id}")
            return self._row_to_dict(response.data[0])
        raise Exception(f"Failed to update API config {config_id}")

    def delete_api_config(self, config_id: str) -> None:
        """Delete an API config."""
        logger.debug(f"Deleting API config {config_id}")

        self._delete_one(config_id)

        logger.info(f"Deleted API config {config_id}")

    def set_active_config(self, config_id: str) -> None:
        """
        Activate a config, auto-deactivating others of same type.

        Args:
            config_id: API config UUID to activate
        """
        # Get the config to find its type
        config = self.get_api_config(config_id)
        if not config:
            raise ValueError(f"Config {config_id} not found")

        config_type = config["type"]

        # Deactivate all configs of same type
        self._deactivate_others(config_type)

        # Activate the target config
        self._update_one(config_id, {"is_active": True})

        logger.info(f"Activated API config {config_id} (type={config_type})")

    def _deactivate_others(self, config_type: str, exclude_id: Optional[str] = None) -> None:
        """
        Deactivate all configs of a given type for current user.

        Args:
            config_type: 'chat', 'embedding', or 'rerank'
            exclude_id: Optional config ID to exclude from deactivation
        """
        query = (
            self._table()
            .update({"is_active": False})
            .eq("user_id", self.user_id)
            .eq("type", config_type)
        )

        if exclude_id:
            query = query.neq("id", exclude_id)

        query.execute()
        logger.debug(f"Deactivated other {config_type} configs")

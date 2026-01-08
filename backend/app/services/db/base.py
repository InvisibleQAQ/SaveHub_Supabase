"""
Base database service with unified patterns.

Provides:
- Automatic user isolation via _query()
- Unified single/multiple record fetching
- Consistent datetime handling
- Standardized error detection

Usage:
    class FolderService(BaseDbService):
        table_name = "folders"

        def _row_to_dict(self, row: dict) -> dict:
            return {"id": row["id"], "name": row["name"], ...}

        def get_folder(self, folder_id: str) -> Optional[dict]:
            return self._get_one({"id": folder_id})
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, TypeVar

from supabase import Client

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=dict)


class BaseDbService:
    """
    Base class for all database services.

    Subclasses should:
    - Set `table_name` class attribute
    - Override `_row_to_dict()` for custom row conversion
    """

    table_name: str = ""  # Subclass must override

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    # =========================================================================
    # Query Builders (automatic user isolation)
    # =========================================================================

    def _table(self):
        """Get table reference."""
        return self.supabase.table(self.table_name)

    def _query(self, select: str = "*"):
        """Start a user-scoped SELECT query."""
        return self._table().select(select).eq("user_id", self.user_id)

    # =========================================================================
    # Unified Record Fetching
    # =========================================================================

    def _get_one(
        self,
        filters: Dict[str, Any],
        select: str = "*",
        not_found_ok: bool = True,
    ) -> Optional[T]:
        """
        Get a single record with unified error handling.

        Uses .limit(1) instead of .single() to avoid exceptions on empty results.

        Args:
            filters: Additional filters beyond user_id (e.g., {"id": "xxx"})
            select: Fields to select
            not_found_ok: If True, return None when not found; if False, raise

        Returns:
            Converted dict or None
        """
        try:
            query = self._query(select)
            for key, value in filters.items():
                query = query.eq(key, value)

            response = query.limit(1).execute()

            if response.data and len(response.data) > 0:
                return self._row_to_dict(response.data[0])

            if not not_found_ok:
                raise ValueError(f"{self.table_name} not found: {filters}")
            return None

        except ValueError:
            raise
        except Exception as e:
            if not_found_ok and self._is_not_found_error(e):
                return None
            logger.error(
                f"Error fetching {self.table_name}",
                extra={"user_id": self.user_id, "filters": filters, "error": str(e)},
            )
            raise

    def _get_many(
        self,
        filters: Optional[Dict[str, Any]] = None,
        select: str = "*",
        order_by: Optional[str] = None,
        order_desc: bool = False,
        limit: Optional[int] = None,
    ) -> List[T]:
        """
        Get multiple records with optional filtering and ordering.

        Args:
            filters: Additional filters beyond user_id
            select: Fields to select
            order_by: Field to order by
            order_desc: If True, order descending
            limit: Max records to return

        Returns:
            List of converted dicts
        """
        query = self._query(select)

        if filters:
            for key, value in filters.items():
                query = query.eq(key, value)

        if order_by:
            query = query.order(order_by, desc=order_desc)

        if limit:
            query = query.limit(limit)

        response = query.execute()
        return [self._row_to_dict(row) for row in response.data or []]

    # =======================================================================
    # Update Helpers
    # =========================================================================

    def _prepare_update_data(
        self,
        updates: Dict[str, Any],
        allowed_fields: Optional[set] = None,
    ) -> Dict[str, Any]:
        """
        Prepare update data with datetime conversion and field filtering.

        Args:
            updates: Raw update dict from caller
            allowed_fields: If provided, only these fields are allowed

        Returns:
            Cleaned update dict ready for Supabase
        """
        update_data = {}

        for key, value in updates.items():
            # Skip None values
            if value is None:
                continue

            # Check allowed fields
            if allowed_fields and key not in allowed_fields:
                continue

            # Convert datetime to ISO string
            if isinstance(value, datetime):
                value = value.isoformat()

            update_data[key] = value

        return update_data

    def _update_one(
        self, record_id: str, updates: Dict[str, Any], id_field: str = "id"
    ) -> bool:
        """
        Update a single record by ID.

        Args:
            record_id: The record's ID
            updates: Fields to update (already prepared)
            id_field: Name of the ID field (default "id")

        Returns:
            True if update succeeded
        """
        if not updates:
            return True  # Nothing to update

        response = (
            self._table()
            .update(updates)
            .eq(id_field, record_id)
            .eq("user_id", self.user_id)
            .execute()
        )

        return bool(response.data)

    def _delete_one(self, record_id: str, id_field: str = "id") -> bool:
        """
        Delete a single record by ID.

        Args:
            record_id: The record's ID
            id_field: Name of the ID field (default "id")

        Returns:
            True if delete succeeded
        """
        response = (
            self._table()
            .delete()
            .eq(id_field, record_id)
            .eq("user_id", self.user_id)
            .execute()
        )

        return bool(response.data)

    # =========================================================================
    # Row Conversion (subclass should override)
    # =========================================================================

    def _row_to_dict(self, row: dict) -> T:
        """
        Convert database row to output dict.

        Default implementation returns row as-is.
        Subclasses should override for custom conversion.

        Args:
            row: Raw database row

        Returns:
            Converted dict
        """
        return row

    def _dict_to_row(self, data: dict) -> dict:
        """
        Convert input dict to database row.

        Handles:
        - Adding user_id
        - Converting datetime to ISO string

        Args:
            data: Input dict

        Returns:
            Database row dict
        """
        row = {"user_id": self.user_id}

        for key, value in data.items():
            if isinstance(value, datetime):
                value = value.isoformat()
            row[key] = value

        return row

    # =========================================================================
    # Error Detection
    # =========================================================================

    @staticmethod
    def _is_not_found_error(e: Exception) -> bool:
        """Check if exception is a 'not found' error (PGRST116)."""
        return "PGRST116" in str(e)

    @staticmethod
    def _is_duplicate_error(e: Exception) -> bool:
        """Check if exception is a duplicate key error (23505)."""
        return "23505" in str(e)

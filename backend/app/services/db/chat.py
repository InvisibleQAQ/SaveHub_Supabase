"""Chat database services."""

import logging
from typing import List, Optional

from .base import BaseDbService

logger = logging.getLogger(__name__)


class ChatSessionService(BaseDbService):
    """Service for chat session operations."""

    table_name = "chat_sessions"

    def _row_to_dict(self, row: dict) -> dict:
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def get_sessions(self) -> List[dict]:
        """Get all sessions for user, ordered by updated_at desc."""
        return self._get_many(order_by="updated_at", order_desc=True)

    def get_session(self, session_id: str) -> Optional[dict]:
        """Get a single session by ID."""
        return self._get_one({"id": session_id})

    def create_session(self, session_id: str, title: str = "New Chat") -> dict:
        """Create a new session."""
        row = self._dict_to_row({"id": session_id, "title": title})
        response = self._table().insert(row).execute()
        return self._row_to_dict(response.data[0])

    def update_title(self, session_id: str, title: str) -> bool:
        """Update session title."""
        return self._update_one(session_id, {"title": title})

    def delete_session(self, session_id: str) -> bool:
        """Delete a session (messages cascade deleted)."""
        return self._delete_one(session_id)


class MessageService(BaseDbService):
    """Service for message operations."""

    table_name = "messages"

    def _row_to_dict(self, row: dict) -> dict:
        return {
            "id": row["id"],
            "session_id": row["session_id"],
            "user_id": row["user_id"],
            "role": row["role"],
            "content": row["content"],
            "sources": row.get("sources"),
            "created_at": row["created_at"],
        }

    def get_messages(self, session_id: str) -> List[dict]:
        """Get all messages for a session."""
        return self._get_many(
            filters={"session_id": session_id},
            order_by="created_at",
            order_desc=False,
        )

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: Optional[List[dict]] = None,
    ) -> dict:
        """Add a message to a session."""
        row = self._dict_to_row(
            {
                "session_id": session_id,
                "role": role,
                "content": content,
                "sources": sources,
            }
        )
        response = self._table().insert(row).execute()
        return self._row_to_dict(response.data[0])

    def count_messages(self, session_id: str) -> int:
        """Count messages in a session."""
        messages = self._get_many(filters={"session_id": session_id})
        return len(messages)

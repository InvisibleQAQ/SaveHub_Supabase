"""
WebSocket Connection Manager for real-time synchronization.

Manages WebSocket connections per user, supporting multi-tab scenarios
where a single user can have multiple active connections.
"""

import logging
from typing import Any
from collections import defaultdict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections for real-time updates.

    Each user can have multiple connections (multi-tab support).
    Messages are broadcast to all connections for a specific user.
    """

    def __init__(self):
        # user_id -> list of WebSocket connections
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        """Accept WebSocket connection and register it for the user."""
        await websocket.accept()
        self._connections[user_id].append(websocket)
        logger.info(
            f"WebSocket connected: user={user_id}, "
            f"total_connections={len(self._connections[user_id])}"
        )

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        """Remove WebSocket connection for the user."""
        if user_id in self._connections:
            try:
                self._connections[user_id].remove(websocket)
                logger.info(
                    f"WebSocket disconnected: user={user_id}, "
                    f"remaining_connections={len(self._connections[user_id])}"
                )
                # Clean up empty user entry
                if not self._connections[user_id]:
                    del self._connections[user_id]
            except ValueError:
                logger.warning(f"WebSocket not found for user={user_id}")

    async def send_to_user(self, user_id: str, message: dict[str, Any]) -> None:
        """
        Send message to all connections for a specific user.

        Args:
            user_id: Target user ID
            message: JSON-serializable message dict
        """
        if user_id not in self._connections:
            return

        disconnected = []
        for websocket in self._connections[user_id]:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to user={user_id}: {e}")
                disconnected.append(websocket)

        # Clean up broken connections
        for ws in disconnected:
            self.disconnect(ws, user_id)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """
        Broadcast message to all connected users.

        Args:
            message: JSON-serializable message dict
        """
        for user_id in list(self._connections.keys()):
            await self.send_to_user(user_id, message)

    def get_connection_count(self, user_id: str) -> int:
        """Get number of active connections for a user."""
        return len(self._connections.get(user_id, []))

    def get_total_connections(self) -> int:
        """Get total number of active WebSocket connections."""
        return sum(len(conns) for conns in self._connections.values())

    def get_connected_users(self) -> list[str]:
        """Get list of user IDs with active connections."""
        return list(self._connections.keys())


# Singleton instance for app-wide use
connection_manager = ConnectionManager()

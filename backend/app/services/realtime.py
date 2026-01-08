"""
WebSocket Connection Manager for real-time synchronization.

Manages WebSocket connections per user, supporting multi-tab scenarios
where a single user can have multiple active connections.

Features:
- Per-user connection limit (prevents resource exhaustion)
- Activity tracking (for zombie detection)
- Periodic zombie cleanup
- Total connection limit (server protection)
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from collections import defaultdict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class ConnectionInfo:
    """Connection metadata for tracking and cleanup."""
    websocket: WebSocket
    connected_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)


class ConnectionManager:
    """
    Manages WebSocket connections for real-time updates.

    Each user can have multiple connections (multi-tab supp).
    Messages are broadcast to all connections for a specific user.

    Limits:
    - MAX_CONNECTIONS_PER_USER: Prevents single user from exhausting resources
    - MAX_TOTAL_CONNECTIONS: Protects server from overload
    - ZOMBIE_TIMEOUT: Connections inactive for this long are cleaned up
    """

    # Configuration
    MAX_CONNECTIONS_PER_USER = 10
    MAX_TOTAL_CONNECTIONS = 1000
    ZOMBIE_TIMEOUT = 120  # seconds
    CLEANUP_INTERVAL = 60  # seconds

    def __init__(self):
        # user_id -> list of ConnectionInfo
        self._connections: dict[str, list[ConnectionInfo]] = defaultdict(list)
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start_cleanup_task(self) -> None:
        """Start periodic zombie connection cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._periodic_cleanup())
            logger.info("Started WebSocket connection cleanup task")

    async def stop_cleanup_task(self) -> None:
        """Stop the cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Stopped WebSocket connection cleanup task")

    async def _periodic_cleanup(self) -> None:
        """Periodically clean up zombie connections."""
        while True:
            try:
                await asyncio.sleep(self.CLEANUP_INTERVAL)
                await self._cleanup_zombie_connections()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")

    async def _cleanup_zombie_connections(self) -> None:
        """Clean up connections that have been inactive too long."""
        now = time.time()
        total_cleaned = 0

        for user_id in list(self._connections.keys()):
            zombies = []
            for conn_info in self._connections[user_id]:
                if now - conn_info.last_activity > self.ZOMBIE_TIMEOUT:
                    zombies.append(conn_info)

            for zombie in zombies:
                logger.warning(
                    f"Cleaning up zombie connection: user={user_id}, "
                    f"inactive_for={now - zombie.last_activity:.0f}s"
                )
                try:
                    await zombie.websocket.close(code=4003, reason="Zombie cleanup")
                except Exception:
                    pass
                self._connections[user_id].remove(zombie)
                total_cleaned += 1

            # Clean up empty user entry
            if not self._connections[user_id]:
                del self._connections[user_id]

        if total_cleaned > 0:
            logger.info(f"Cleaned up {total_cleaned} zombie connections")

    async def connect(self, websocket: WebSocket, user_id: str) -> bool:
        """
        Accept WebSocket connection and register it for the user.

        Returns:
            True if connection was accepted, False if rejected due to limits.
        """
        # Check total connection limit
        total = self.get_total_connections()
        if total >= self.MAX_TOTAL_CONNECTIONS:
            logger.warning(
                f"Rejecting connection: server at capacity "
                f"({total}/{self.MAX_TOTAL_CONNECTIONS})"
            )
            await websocket.close(code=4004, reason="Server at capacity")
            return False

        # Check per-user connection limit
        user_conns = len(self._connections[user_id])
        if user_conns >= self.MAX_CONNECTIONS_PER_USER:
            # Close oldest connection to make room
            oldest = self._connections[user_id][0]
            logger.info(
                f"User {user_id} at max connections ({user_conns}), closing oldest"
            )
            try:
                await oldest.websocket.close(code=4005, reason="Too many connections")
            except Exception:
                pass
            self._connections[user_id].remove(oldest)

        # Accept and register connection
        await websocket.accept()
        conn_info = ConnectionInfo(websocket=websocket)
        self._connections[user_id].append(conn_info)

        logger.info(
            f"WebSocket connected: user={user_id}, "
            f"user_connections={len(self._connections[user_id])}, "
            f"total_connections={self.get_total_connections()}"
        )
        return True

    def update_activity(self, websocket: WebSocket, user_id: str) -> None:
        """Update last activity timestamp for a connection."""
        if user_id in self._connections:
            for conn_info in self._connections[user_id]:
                if conn_info.websocket is websocket:
                    conn_info.last_activity = time.time()
                    return

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        """Remove WebSocket connection for the user."""
        if user_id in self._connections:
            # Find and remove the connection
            self._connections[user_id] = [
                c for c in self._connections[user_id]
                if c.websocket is not websocket
            ]

            remaining = len(self._connections[user_id])
            logger.info(
                f"WebSocket disconnected: user={user_id}, "
                f"remaining_connections={remaining}"
            )

            # Clean up empty user entry
            if not self._connections[user_id]:
                del self._connections[user_id]

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
        for conn_info in self._connections[user_id]:
            try:
                await conn_info.websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to user={user_id}: {e}")
                disconnected.append(conn_info.websocket)

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

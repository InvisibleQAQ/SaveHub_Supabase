"""
Supabase Realtime Forwarder for WebSocket synchronization.

Subscribes to Supabase postgres_changes and forwards events
to connected WebSocket clients via ConnectionManager.
"""

import asyncio
import logging
import os
from typing import Any, Callable, Optional

from realtime import RealtimeSubscribeStates
from supabase import create_client, Client

from app.services.realtime import connection_manager

logger = logging.getLogger(__name__)

# Tables to subscribe for realtime changes
REALTIME_TABLES = ["feeds", "articles", "folders"]


class SupabaseRealtimeForwarder:
    """
    Subscribes to Supabase postgres_changes and forwards events to WebSocket clients.

    Each table change event contains user_id, which is used to route
    the message to the correct user's WebSocket connections.
    """

    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None):
        """
        Initialize the forwarder.

        Args:
            supabase_url: Supabase project URL (defaults to env SUPABASE_URL)
            supabase_key: Supabase anon key (defaults to env SUPABASE_ANON_KEY)
        """
        self._url = supabase_url or os.environ.get("SUPABASE_URL", "")
        self._key = supabase_key or os.environ.get("SUPABASE_ANON_KEY", "")
        self._client: Optional[Client] = None
        self._channel = None
        self._is_running = False

    def _get_client(self) -> Client:
        """Get or create Supabase client."""
        if self._client is None:
            if not self._url or not self._key:
                raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
            self._client = create_client(self._url, self._key)
        return self._client

    def _create_callback(self, table: str, event: str) -> Callable[[dict[str, Any]], None]:
        """
        Create a callback function for postgres_changes events.

        Args:
            table: Table name (feeds, articles, folders)
            event: Event type (INSERT, UPDATE, DELETE)

        Returns:
            Callback function that forwards the event to WebSocket clients
        """

        def callback(payload: dict[str, Any]) -> None:
            """Forward postgres_changes event to WebSocket clients."""
            try:
                # Extract user_id from the record
                # For INSERT/UPDATE, user_id is in 'new'
                # For DELETE, user_id is in 'old'
                record = payload.get("new") or payload.get("old") or {}
                user_id = record.get("user_id")

                if not user_id:
                    logger.warning(
                        f"Received {event} on {table} without user_id: {payload}"
                    )
                    return

                # Build message for WebSocket clients
                message = {
                    "type": "postgres_changes",
                    "table": table,
                    "event": event,
                    "payload": {
                        "new": payload.get("new"),
                        "old": payload.get("old"),
                    },
                }

                logger.debug(
                    f"Forwarding {event} on {table} to user={user_id}"
                )

                # Forward to user's WebSocket connections
                # Schedule coroutine in the event loop
                asyncio.create_task(
                    connection_manager.send_to_user(user_id, message)
                )

            except Exception as e:
                logger.error(f"Error in realtime callback: {e}", exc_info=True)

        return callback

    async def start(self) -> None:
        """
        Start subscribing to Supabase postgres_changes.

        Creates a single channel that listens to all configured tables
        for INSERT, UPDATE, and DELETE events.
        """
        if self._is_running:
            logger.warning("SupabaseRealtimeForwarder is already running")
            return

        client = self._get_client()

        # Create a channel for all postgres changes
        self._channel = client.channel("backend-realtime")

        # Subscribe to each table for all event types
        for table in REALTIME_TABLES:
            for event in ["INSERT", "UPDATE", "DELETE"]:
                self._channel.on_postgres_changes(
                    event,
                    schema="public",
                    table=table,
                    callback=self._create_callback(table, event),
                )
                logger.info(f"Subscribed to {event} on {table}")

        # Subscribe to the channel
        def on_subscribe(status: RealtimeSubscribeStates, err: Optional[Exception]) -> None:
            if status == RealtimeSubscribeStates.SUBSCRIBED:
                logger.info("Successfully subscribed to Supabase Realtime")
                self._is_running = True
            elif err:
                logger.error(f"Failed to subscribe to Supabase Realtime: {err}")
            else:
                logger.info(f"Supabase Realtime subscription status: {status}")

        self._channel.subscribe(on_subscribe)

    async def stop(self) -> None:
        """Stop subscribing to Supabase postgres_changes."""
        if not self._is_running:
            return

        try:
            if self._channel and self._client:
                self._client.remove_channel(self._channel)
                logger.info("Unsubscribed from Supabase Realtime")
        except Exception as e:
            logger.error(f"Error stopping realtime forwarder: {e}")
        finally:
            self._channel = None
            self._is_running = False

    @property
    def is_running(self) -> bool:
        """Check if the forwarder is currently running."""
        return self._is_running


# Singleton instance for app-wide use
realtime_forwarder = SupabaseRealtimeForwarder()

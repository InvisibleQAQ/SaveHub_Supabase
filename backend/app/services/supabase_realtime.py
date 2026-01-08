"""
Supabase Realtime Forwarder for WebSocket synchronization.

Subscribes to Supabase postgres_changes and forwards events
to connected WebSocket clients via ConnectionManager.

Features:
- Automatic reconnection with exponential backoff
- Graceful handling of connection errors
- Status tracking for monitoring
"""

import asyncio
import logging
import os
import random
from typing import Any, Callable, Optional

from realtime import RealtimeSubscribeStates
from supabase import acreate_client, AsyncClient

from app.services.realtime import connection_manager

logger = logging.getLogger(__name__)

# Tables to subscribe for realtime changes
REALTIME_TABLES = ["feeds", "articles", "folders"]


class SupabaseRealtimeForwarder:
    """
    Subscribes to Supabase postgres_changes and forwards events to WebSocket clients.

    Each table change event contains user_id, which is used to route
    the message to the correct user's WebSocket connections.

    Reconnection:
    - Automatically reconnects on CHANNEL_ERROR, TIMED_OUT, or CLOSED
    - Uses exponential backoff with jitter (1s -> 60s max)
    - Gives up after MAX_RECONNECT_ATTEMPTS consecutive failures
    """

    # Reconnection configuration
    MAX_RECONNECT_ATTEMPTS = 10
    BASE_RECONNECT_DELAY = 1.0  # seconds
    MAX_RECONNECT_DELAY = 60.0  # seconds

    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None):
        """
        Initialize the forwarder.

        Args:
            supabase_url: Supabase project URL (defaults to env SUPABASE_URL)
            supabase_key: Supabase anon key (defaults to env SUPABASE_ANON_KEY)
        """
        self._url = supabase_url or os.environ.get("SUPABASE_URL", "")
        self._key = supabase_key or os.environ.get("SUPABASE_ANON_KEY", "")
        self._client: Optional[AsyncClient] = None
        self._channel = None
        self._is_running = False
        self._should_run = False  # Flag to control reconnection
        self._reconnect_attempts = 0
        self._reconnect_task: Optional[asyncio.Task] = None

    async def _get_client(self) -> AsyncClient:
        """Get or create async Supabase client."""
        if self._client is None:
            if not self._url or not self._key:
                raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
            self._client = await acreate_client(self._url, self._key)
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

    def _schedule_reconnect(self) -> None:
        """Schedule a reconnection attempt with exponential backoff."""
        if not self._should_run:
            logger.info("Reconnection disabled, not scheduling reconnect")
            return

        if self._reconnect_attempts >= self.MAX_RECONNECT_ATTEMPTS:
            logger.error(
                f"Max reconnect attempts ({self.MAX_RECONNECT_ATTEMPTS}) reached, "
                "giving up on Supabase Realtime"
            )
            self._is_running = False
            return

        # Calculate delay with exponential backoff and jitter
        delay = min(
            self.BASE_RECONNECT_DELAY * (2 ** self._reconnect_attempts) + random.uniform(0, 1),
            self.MAX_RECONNECT_DELAY
        )
        self._reconnect_attempts += 1

        logger.info(
            f"Scheduling Supabase Realtime reconnect in {delay:.1f}s "
            f"(attempt {self._reconnect_attempts}/{self.MAX_RECONNECT_ATTEMPTS})"
        )

        # Schedule reconnection
        self._reconnect_task = asyncio.create_task(self._reconnect_after_delay(delay))

    async def _reconnect_after_delay(self, delay: float) -> None:
        """Wait for delay then attempt to reconnect."""
        try:
            await asyncio.sleep(delay)

            if not self._should_run:
                return

            # Clean up old connection
            await self._cleanup_channel()

            # Attempt to reconnect
            logger.info("Attempting to reconnect to Supabase Realtime...")
            await self._connect()

        except asyncio.CancelledError:
            logger.debug("Reconnect task cancelled")
        except Exception as e:
            logger.error(f"Error during reconnection: {e}")
            # Schedule another reconnect attempt
            self._schedule_reconnect()

    async def _cleanup_channel(self) -> None:
        """Clean up existing channel subscription."""
        if self._channel and self._client:
            try:
                await self._client.remove_channel(self._channel)
            except Exception as e:
                logger.warning(f"Error removing old channel: {e}")
        self._channel = None
        self._is_running = False

    async def _connect(self) -> None:
        """Internal method to establish connection."""
        client = await self._get_client()

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

        # Subscribe to the channel with status handling
        def on_subscribe(status: RealtimeSubscribeStates, err: Optional[Exception]) -> None:
            if status == RealtimeSubscribeStates.SUBSCRIBED:
                logger.info("Successfully subscribed to Supabase Realtime")
                self._is_running = True
                self._reconnect_attempts = 0  # Reset on successful connection

            elif status == RealtimeSubscribeStates.CHANNEL_ERROR:
                logger.error(f"Supabase Realtime channel error: {err}")
                self._is_running = False
                self._schedule_reconnect()

            elif status == RealtimeSubscribeStates.TIMED_OUT:
                logger.error("Supabase Realtime subscription timed out")
                self._is_running = False
                self._schedule_reconnect()

            elif status == RealtimeSubscribeStates.CLOSED:
                logger.warning("Supabase Realtime channel closed")
                self._is_running = False
                if self._should_run:
                    self._schedule_reconnect()

            else:
                logger.info(f"Supabase Realtime subscription status: {status}")

        await self._channel.subscribe(on_subscribe)

    async def start(self) -> None:
        """
        Start subscribing to Supabase postgres_changes.

        Creates a single channel that listens to all configured tables
        for INSERT, UPDATE, and DELETE events.
        """
        if self._is_running:
            logger.warning("SupabaseRealtimeForwarder is already running")
            return

        self._should_run = True
        self._reconnect_attempts = 0

        logger.info(f"Starting Supabase Realtime subscription for tables: {REALTIME_TABLES}")
        await self._connect()

    async def stop(self) -> None:
        """Stop subscribing to Supabase postgres_changes."""
        self._should_run = False

        # Cancel any pending reconnect task
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None

        # Clean up channel
        await self._cleanup_channel()
        logger.info("Stopped Supabase Realtime forwarder")

    @property
    def is_running(self) -> bool:
        """Check if the forwarder is currently running."""
        return self._is_running


# Singleton instance for app-wide use
realtime_forwarder = SupabaseRealtimeForwarder()

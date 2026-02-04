"""WebSocket router for real-time synchronization.

Provides WebSocket endpoint that authenticates via cookie and
forwards Supabase postgres_changes to connected clients.
"""

import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from supabase import create_client, Client
import os

from app.services.realtime import connection_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# Cookie names (must match auth router)
COOKIE_NAME_ACCESS = "sb_access_token"

# Heartbeat timeout: client sends ping every 30s, allow 3 missed heartbeats
HEARTBEAT_TIMEOUT = 90  # seconds


def get_supabase_client() -> Client:
    """Get Supabase client for auth verification."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)


async def authenticate_websocket(websocket: WebSocket) -> str | None:
    """
    Authenticate WebSocket connection via cookie or query parameter.

    Supports two authentication methods:
    1. Cookie: sb_access_token (same-origin requests)
    2. Query parameter: ?token=xxx (cross-origin requests)

    Args:
        websocket: WebSocket connection (not yet accepted)

    Returns:
        user_id if authenticated, None otherwise
    """
    # Try cookie first (same-origin)
    access_token = websocket.cookies.get(COOKIE_NAME_ACCESS)

    # Fallback to query parameter (cross-origin)
    if not access_token:
        access_token = websocket.query_params.get("token")

    if not access_token:
        logger.debug("WebSocket auth failed: no access token in cookie or query param")
        return None

    try:
        client = get_supabase_client()
        user_response = client.auth.get_user(access_token)
        user = user_response.user

        if not user:
            logger.debug("WebSocket auth failed: invalid token")
            return None

        return user.id

    except Exception as e:
        logger.warning(f"WebSocket auth error: {e}")
        return None


@router.websocket("/realtime")
async def websocket_realtime(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Authentication is via HttpOnly cookie (sb_access_token).
    Once connected, receives postgres_changes events for:
    - feeds (INSERT, UPDATE, DELETE)
    - articles (INSERT, UPDATE, DELETE)
    - folders (INSERT, UPDATE, DELETE)

    Message format:
    {
        "type": "postgres_changes",
        "table": "feeds" | "articles" | "folders",
        "event": "INSERT" | "UPDATE" | "DELETE",
        "payload": {
            "new": {...} | null,
            "old": {...} | null
        }
    }

    Client can send:
    - {"type": "ping"} - Server responds with {"type": "pong"}
    """
    # Authenticate before accepting
    user_id = await authenticate_websocket(websocket)

    if not user_id:
        # Reject connection with 4001 (unauthorized)
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Accept connection and register
    await connection_manager.connect(websocket, user_id)

    try:
        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages with timeout
                # Client should send ping every 30s, timeout after 90s (3 missed heartbeats)
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=HEARTBEAT_TIMEOUT
                )

                # Update activity timestamp
                connection_manager.update_activity(websocket, user_id)

                # Handle ping
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

            except asyncio.TimeoutError:
                # No message received within timeout, close connection
                logger.warning(f"WebSocket heartbeat timeout: user={user_id}")
                await websocket.close(code=4002, reason="Heartbeat timeout")
                break

            except WebSocketDisconnect:
                logger.info(f"WebSocket client disconnected: user={user_id}")
                break

            except Exception as e:
                logger.warning(f"WebSocket receive error: {e}")
                break

    finally:
        # Clean up connection
        connection_manager.disconnect(websocket, user_id)

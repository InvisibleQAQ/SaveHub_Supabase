"""WebSocket router for real-time synchronization.

Provides WebSocket endpoint that authenticates via cookie and
forwards Supabase postgres_changes to connected clients.
"""

import os
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.supabase_auth import supabase_auth_client, is_network_error
from app.services.realtime import connection_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])

# Cookie names (must match auth router)
COOKIE_NAME_ACCESS = "sb_access_token"

WS_AUTH_MAX_RETRIES = int(os.environ.get("WS_AUTH_MAX_RETRIES", "2"))
WS_AUTH_RETRY_BASE_DELAY = float(os.environ.get("WS_AUTH_RETRY_BASE_DELAY", "0.3"))


async def authenticate_websocket(websocket: WebSocket) -> tuple[str | None, bool]:
    """
    Authenticate WebSocket connection via cookie.

    Args:
        websocket: WebSocket connection (not yet accepted)

    Returns:
        (user_id if authenticated else None, network_failure)
    """
    access_token = websocket.cookies.get(COOKIE_NAME_ACCESS)

    if not access_token:
        logger.debug("WebSocket auth failed: no access token cookie")
        return None, False

    for attempt in range(WS_AUTH_MAX_RETRIES):
        try:
            with supabase_auth_client() as client:
                user_response = client.auth.get_user(access_token)

            user = user_response.user
            if not user:
                logger.debug("WebSocket auth failed: invalid token")
                return None, False

            return user.id, False

        except Exception as error:
            if is_network_error(error):
                if attempt < WS_AUTH_MAX_RETRIES - 1:
                    delay = WS_AUTH_RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "WebSocket auth retry %s/%s in %.1fs: %s",
                        attempt + 1,
                        WS_AUTH_MAX_RETRIES,
                        delay,
                        error,
                    )
                    await asyncio.sleep(delay)
                    continue

                logger.warning("WebSocket auth temporary network error: %s", error)
                return None, True

            logger.warning(f"WebSocket auth error: {error}")
            return None, False

    return None, False


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
    user_id, network_failure = await authenticate_websocket(websocket)

    if not user_id:
        await websocket.accept()
        if network_failure:
            await websocket.send_json(
                {"type": "error", "message": "Authentication service unavailable"}
            )
            await websocket.close(code=1013, reason="Auth unavailable")
        else:
            await websocket.close(code=4001, reason="Unauthorized")
        return

    # Accept connection and register
    await connection_manager.connect(websocket, user_id)

    try:
        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages (ping/pong, etc.)
                data = await websocket.receive_json()

                # Handle ping
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

            except WebSocketDisconnect:
                logger.info(f"WebSocket client disconnected: user={user_id}")
                break

            except Exception as error:
                logger.warning(f"WebSocket receive error: {error}")
                break

    finally:
        # Clean up connection
        connection_manager.disconnect(websocket, user_id)

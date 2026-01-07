import os
import time
import logging
from typing import Optional, Tuple, Any, Type, TypeVar, Callable
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from dotenv import load_dotenv, find_dotenv

_ = load_dotenv(find_dotenv())  # read local .env file

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
security = HTTPBearer(auto_error=False)

# Cookie names (must match auth router)
COOKIE_NAME_ACCESS = "sb_access_token"
COOKIE_NAME_REFRESH = "sb_refresh_token"

# Auth retry configuration
AUTH_MAX_RETRIES = 3
AUTH_RETRY_BASE_DELAY = 0.5  # seconds


def _is_network_error(error: Exception) -> bool:
    """Check if error is network/SSL related (retryable)."""
    error_str = str(error).lower()
    patterns = ["ssl", "handshake", "timed out", "timeout", "connection"]
    return any(p in error_str for p in patterns)


def _verify_token_with_retry(token: str) -> Tuple[Any, str | None]:
    """
    Verify token with exponential backoff retry for network errors.

    Returns:
        (user_response, error_message) - error_message is None on success
    """
    last_error = None
    for attempt in range(AUTH_MAX_RETRIES):
        try:
            user_response = supabase.auth.get_user(token)
            if user_response and user_response.user:
                return user_response, None
            return None, "Invalid token response"
        except Exception as e:
            last_error = e
            if _is_network_error(e) and attempt < AUTH_MAX_RETRIES - 1:
                delay = AUTH_RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    f"Auth retry {attempt + 1}/{AUTH_MAX_RETRIES} in {delay}s: {e}"
                )
                time.sleep(delay)
            else:
                break

    if _is_network_error(last_error):
        return None, f"Network timeout after {AUTH_MAX_RETRIES} retries: {last_error}"
    return None, f"Token validation failed: {last_error}"


def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Verify JWT from Authorization header (Bearer token).
    Kept for backward compatibility with existing endpoints.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="No credentials provided")
    token = credentials.credentials
    try:
        user = supabase.auth.get_user(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


def verify_cookie_auth(request: Request):
    """
    Verify JWT from HttpOnly cookie.
    Use this for cookie-based authentication.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)

    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        user_response = supabase.auth.get_user(access_token)
        user = user_response.user

        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")

        return user_response

    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


def get_access_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    """
    Extract access token from either cookie or Authorization header.
    Prioritizes cookie-based auth, falls back to header-based auth.

    Returns:
        Access token string

    Raises:
        HTTPException: 401 if no token found
    """
    # First try cookie
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    if access_token:
        return access_token

    # Then try Authorization header
    if credentials:
        return credentials.credentials

    raise HTTPException(
        status_code=401,
        detail="No access token found (no cookie or Authorization header)"
    )


def verify_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """
    Verify authentication from either cookie or Authorization header.
    Prioritizes cookie-based auth, falls back to header-based auth.
    Includes retry logic for network/SSL timeout errors.
    """
    cookie_error = None
    header_error = None

    # First try cookie with retry
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    if access_token:
        user_response, error = _verify_token_with_retry(access_token)
        if user_response:
            return user_response
        cookie_error = error
        logger.warning(f"Cookie auth failed: {cookie_error}")

    # Then try Authorization header with retry
    if credentials:
        user_response, error = _verify_token_with_retry(credentials.credentials)
        if user_response:
            return user_response
        header_error = error
        logger.warning(f"Header auth failed: {header_error}")

    # Build detailed error message with clear distinction
    if not access_token and not credentials:
        detail = "No credentials provided (no cookie or header)"
    elif cookie_error:
        if "Network timeout" in cookie_error:
            detail = f"Authentication service unavailable: {cookie_error}"
        else:
            detail = f"Token expired or invalid: {cookie_error}"
    elif header_error:
        detail = f"Header auth failed: {header_error}"
    else:
        detail = "Not authenticated"

    logger.warning(f"Auth failed for {request.method} {request.url.path}: {detail}")
    raise HTTPException(status_code=401, detail=detail)


# =============================================================================
# Service Dependency Factory & Utilities
# =============================================================================

T = TypeVar("T")


def create_service_dependency(service_class: Type[T]) -> Callable[..., T]:
    """
    Factory function to create service dependency injectors.

    Eliminates boilerplate for service instantiation pattern:
        access_token = request.cookies.get(COOKIE_NAME_ACCESS)
        client = get_supabase_client(access_token)
        return ServiceClass(client, user.user.id)

    Usage:
        get_feed_service = create_service_dependency(FeedService)

        @router.get("")
        async def get_feeds(service: FeedService = Depends(get_feed_service)):
            ...

    Args:
        service_class: Service class with __init__(supabase, user_id) signature

    Returns:
        FastAPI dependency function that creates the service instance
    """
    from app.supabase_client import get_supabase_client

    def dependency(
        access_token: str = Depends(get_access_token),
        user=Depends(verify_auth),
    ) -> T:
        client = get_supabase_client(access_token)
        return service_class(client, user.user.id)

    return dependency


def require_exists(item: Any, detail: str = "Resource not found") -> Any:
    """
    Raise 404 if item is None/falsy.

    Eliminates boilerplate:
        existing = service.get_xxx(id)
        if not existing:
            raise HTTPException(status_code=404, detail="Xxx not found")

    Usage:
        feed = require_exists(service.get_feed(id), "Feed not found")

    Args:
        item: The item to check (typically from a service.get_xxx() call)
        detail: Error message for 404 response

    Returns:
        The item if it exists

    Raises:
        HTTPException: 404 if item is None/falsy
    """
    if not item:
        raise HTTPException(status_code=404, detail=detail)
    return item


def extract_update_data(update_model: BaseModel) -> dict:
    """
    Extract non-None fields from a Pydantic update model.

    Eliminates boilerplate:
        update_data = {k: v for k, v in model.model_dump().items() if v is not None}

    Usage:
        update_data = extract_update_data(feed_update)
        if not update_data:
            return {"success": True, "message": "No fields to update"}

    Args:
        update_model: Pydantic model with update fields

    Returns:
        Dict of fields to update (excluding None values)
    """
    return {k: v for k, v in update_model.model_dump().items() if v is not None}

import time
import logging
from typing import Optional, Tuple, Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv, find_dotenv

from app.core.supabase_auth import supabase_auth_client, is_network_error

_ = load_dotenv(find_dotenv())  # read local .env file

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# Cookie names (must match auth router)
COOKIE_NAME_ACCESS = "sb_access_token"
COOKIE_NAME_REFRESH = "sb_refresh_token"

# Auth retry configuration
AUTH_MAX_RETRIES = 3
AUTH_RETRY_BASE_DELAY = 0.5  # seconds


def _verify_token_with_retry(token: str) -> Tuple[Any, str | None, bool]:
    """
    Verify token with exponential backoff retry for network errors.

    Returns:
        (user_response, error_message, is_network_failure)
    """
    last_error = None
    for attempt in range(AUTH_MAX_RETRIES):
        try:
            with supabase_auth_client() as client:
                user_response = client.auth.get_user(token)

            if user_response and user_response.user:
                return user_response, None, False

            return None, "Invalid token response", False
        except Exception as error:
            last_error = error
            if is_network_error(error) and attempt < AUTH_MAX_RETRIES - 1:
                delay = AUTH_RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    f"Auth retry {attempt + 1}/{AUTH_MAX_RETRIES} in {delay}s: {error}"
                )
                time.sleep(delay)
            else:
                break

    if last_error and is_network_error(last_error):
        return (
            None,
            f"Network timeout after {AUTH_MAX_RETRIES} retries: {last_error}",
            True,
        )

    return None, f"Token validation failed: {last_error}", False


def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Verify JWT from Authorization header (Bearer token).
    Kept for backward compatibility with existing endpoints.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="No credentials provided")

    user_response, error, network_failure = _verify_token_with_retry(
        credentials.credentials
    )

    if user_response:
        return user_response

    if network_failure:
        raise HTTPException(status_code=503, detail=error)

    raise HTTPException(status_code=401, detail=error)


def verify_cookie_auth(request: Request):
    """
    Verify JWT from HttpOnly cookie.
    Use this for cookie-based authentication.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)

    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_response, error, network_failure = _verify_token_with_retry(access_token)

    if user_response:
        return user_response

    if network_failure:
        raise HTTPException(status_code=503, detail=error)

    raise HTTPException(status_code=401, detail=error)


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
        detail="No access token found (no cookie or Authorization header)",
    )


def verify_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """
    Verify authentication from either cookie or Authorization header.
    Prioritizes cookie-based auth, falls back to header-based auth.
    Includes retry logic for network timeout errors.
    """
    cookie_error = None
    header_error = None
    saw_network_failure = False

    # First try cookie with retry
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    if access_token:
        user_response, error, network_failure = _verify_token_with_retry(access_token)
        if user_response:
            return user_response

        cookie_error = error
        saw_network_failure = saw_network_failure or network_failure
        logger.warning(f"Cookie auth failed: {cookie_error}")

    # Then try Authorization header with retry
    if credentials:
        user_response, error, network_failure = _verify_token_with_retry(
            credentials.credentials
        )
        if user_response:
            return user_response

        header_error = error
        saw_network_failure = saw_network_failure or network_failure
        logger.warning(f"Header auth failed: {header_error}")

    # Build detailed error message with clear distinction
    if not access_token and not credentials:
        detail = "No credentials provided (no cookie or header)"
        status_code = 401
    elif saw_network_failure:
        detail = cookie_error or header_error or "Authentication service unavailable"
        status_code = 503
    elif cookie_error:
        detail = f"Token expired or invalid: {cookie_error}"
        status_code = 401
    elif header_error:
        detail = f"Header auth failed: {header_error}"
        status_code = 401
    else:
        detail = "Not authenticated"
        status_code = 401

    logger.warning(f"Auth failed for {request.method} {request.url.path}: {detail}")
    raise HTTPException(status_code=status_code, detail=detail)

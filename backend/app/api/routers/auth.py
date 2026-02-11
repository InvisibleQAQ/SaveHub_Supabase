"""Authentication router with HttpOnly cookie-based token management."""

import os
import time
import logging
from typing import Callable, Any

from fastapi import APIRouter, HTTPException, Response, Request
from dotenv import load_dotenv, find_dotenv

try:
    from supabase_auth.errors import AuthApiError as SupabaseAuthApiError
except ImportError:
    SupabaseAuthApiError = None

try:
    from gotrue.errors import AuthApiError as GoTrueAuthApiError
except ImportError:
    GoTrueAuthApiError = None

from app.core.supabase_auth import supabase_auth_client, is_network_error
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    AuthResponse,
    SessionResponse,
    RefreshResponse,
    LogoutResponse,
)

_ = load_dotenv(find_dotenv())

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie settings
COOKIE_NAME_ACCESS = "sb_access_token"
COOKIE_NAME_REFRESH = "sb_refresh_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
COOKIE_HTTPONLY = True
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = "lax"

AUTH_MAX_RETRIES = int(os.environ.get("AUTH_MAX_RETRIES", "3"))
AUTH_RETRY_BASE_DELAY = float(os.environ.get("AUTH_RETRY_BASE_DELAY", "0.5"))

AUTH_API_ERRORS = tuple(
    error_type
    for error_type in (SupabaseAuthApiError, GoTrueAuthApiError)
    if error_type is not None
)


def get_auth_error_status(error: Exception, default_status: int) -> int:
    """Extract HTTP-like status from Supabase auth exceptions safely."""
    status = getattr(error, "status", None)
    if isinstance(status, int) and 100 <= status <= 599:
        return status
    return default_status


def run_auth_operation_with_retry(
    operation_name: str,
    operation: Callable[[Any], Any],
) -> Any:
    """Run auth operation with retries for transient network failures."""
    last_error: Exception | None = None

    for attempt in range(AUTH_MAX_RETRIES):
        try:
            with supabase_auth_client() as client:
                return operation(client)
        except AUTH_API_ERRORS:
            raise
        except Exception as error:
            last_error = error

            if is_network_error(error) and attempt < AUTH_MAX_RETRIES - 1:
                delay = AUTH_RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Auth op %s retry %s/%s in %.1fs: %s",
                    operation_name,
                    attempt + 1,
                    AUTH_MAX_RETRIES,
                    delay,
                    error,
                )
                time.sleep(delay)
                continue

            break

    if last_error:
        raise last_error

    raise RuntimeError(f"Auth operation failed without error: {operation_name}")


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """Set HttpOnly cookies for access and refresh tokens."""
    response.set_cookie(
        key=COOKIE_NAME_ACCESS,
        value=access_token,
        max_age=COOKIE_MAX_AGE,
        httponly=COOKIE_HTTPONLY,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )
    response.set_cookie(
        key=COOKIE_NAME_REFRESH,
        value=refresh_token,
        max_age=COOKIE_MAX_AGE,
        httponly=COOKIE_HTTPONLY,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )


def clear_auth_cookies(response: Response) -> None:
    """Clear authentication cookies."""
    response.delete_cookie(key=COOKIE_NAME_ACCESS)
    response.delete_cookie(key=COOKIE_NAME_REFRESH)


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, response: Response):
    """
    Login with email and password.
    Sets HttpOnly cookies with access and refresh tokens.
    """
    try:
        auth_response = run_auth_operation_with_retry(
            "login",
            lambda client: client.auth.sign_in_with_password(
                {
                    "email": request.email,
                    "password": request.password,
                }
            ),
        )

        user = auth_response.user
        session = auth_response.session

        if not user or not session:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        set_auth_cookies(response, session.access_token, session.refresh_token)

        logger.info(f"User logged in: {user.email}")

        return AuthResponse(
            user_id=user.id,
            email=user.email or "",
            access_token=session.access_token,
            refresh_token=session.refresh_token,
        )

    except AUTH_API_ERRORS as error:
        status_code = get_auth_error_status(error, 401)
        logger.warning(f"Login failed for {request.email}: {str(error)}")
        raise HTTPException(status_code=status_code, detail=str(error))
    except HTTPException:
        raise
    except Exception as error:
        if is_network_error(error):
            logger.warning("Login temporary auth service error: %s", error)
            raise HTTPException(
                status_code=503,
                detail="Authentication service unavailable. Please retry.",
            )

        logger.error(f"Login error: {str(error)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest, response: Response):
    """
    Register a new user with email and password.
    Sets HttpOnly cookies with access and refresh tokens.
    """
    try:
        auth_response = run_auth_operation_with_retry(
            "register",
            lambda client: client.auth.sign_up(
                {
                    "email": request.email,
                    "password": request.password,
                }
            ),
        )

        user = auth_response.user
        session = auth_response.session

        if not user:
            raise HTTPException(status_code=400, detail="Registration failed")

        # If email confirmation is required, session may be None
        if session:
            set_auth_cookies(response, session.access_token, session.refresh_token)

        logger.info(f"User registered: {user.email}")

        return AuthResponse(
            user_id=user.id,
            email=user.email or "",
            access_token=session.access_token if session else None,
            refresh_token=session.refresh_token if session else None,
        )

    except AUTH_API_ERRORS as error:
        status_code = get_auth_error_status(error, 400)
        logger.warning(f"Registration failed for {request.email}: {str(error)}")
        raise HTTPException(status_code=status_code, detail=str(error))
    except HTTPException:
        raise
    except Exception as error:
        if is_network_error(error):
            logger.warning("Register temporary auth service error: %s", error)
            raise HTTPException(
                status_code=503,
                detail="Authentication service unavailable. Please retry.",
            )

        logger.error(f"Registration error: {str(error)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/logout", response_model=LogoutResponse)
async def logout(response: Response):
    """
    Logout user and clear authentication cookies.
    """
    try:
        clear_auth_cookies(response)

        logger.info("User logged out")

        return LogoutResponse(success=True)

    except Exception as error:
        logger.error(f"Logout error: {str(error)}")
        clear_auth_cookies(response)
        return LogoutResponse(success=True, message="Logged out (with errors)")


@router.get("/session", response_model=SessionResponse)
async def get_session(request: Request, response: Response):
    """
    Check current session status by verifying access token.
    If access token is expired but refresh token is valid, auto-refresh cookies.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    refresh_token_cookie = request.cookies.get(COOKIE_NAME_REFRESH)

    if not access_token and not refresh_token_cookie:
        return SessionResponse(authenticated=False)

    if access_token:
        try:
            user_response = run_auth_operation_with_retry(
                "session.get_user",
                lambda client: client.auth.get_user(access_token),
            )
            user = user_response.user

            if user:
                return SessionResponse(
                    authenticated=True,
                    user_id=user.id,
                    email=user.email,
                    access_token=access_token,
                    refresh_token=refresh_token_cookie,
                )

        except AUTH_API_ERRORS as auth_error:
            status_code = get_auth_error_status(auth_error, 401)
            if status_code not in {400, 401, 403}:
                logger.warning(
                    "Session check failed with non-auth status %s",
                    status_code,
                    exc_info=True,
                )
                return SessionResponse(authenticated=False)
        except Exception as error:
            if is_network_error(error):
                logger.warning("Session check temporary auth service error: %s", error)
                return SessionResponse(authenticated=False)

            logger.warning("Session check failed", exc_info=True)
            return SessionResponse(authenticated=False)

    if not refresh_token_cookie:
        clear_auth_cookies(response)
        return SessionResponse(authenticated=False)

    try:
        refresh_response = run_auth_operation_with_retry(
            "session.refresh",
            lambda client: client.auth.refresh_session(refresh_token_cookie),
        )
        session = refresh_response.session

        if not session:
            clear_auth_cookies(response)
            return SessionResponse(authenticated=False)

        set_auth_cookies(response, session.access_token, session.refresh_token)

        user_response = run_auth_operation_with_retry(
            "session.get_user_after_refresh",
            lambda client: client.auth.get_user(session.access_token),
        )
        user = user_response.user

        if not user:
            clear_auth_cookies(response)
            return SessionResponse(authenticated=False)

        return SessionResponse(
            authenticated=True,
            user_id=user.id,
            email=user.email,
            access_token=session.access_token,
            refresh_token=session.refresh_token,
        )

    except AUTH_API_ERRORS as error:
        status_code = get_auth_error_status(error, 401)
        if status_code in {400, 401, 403}:
            clear_auth_cookies(response)
        logger.warning("Session refresh failed: %s", error)
        return SessionResponse(authenticated=False)
    except Exception as error:
        if is_network_error(error):
            logger.warning("Session refresh temporary auth service error: %s", error)
            return SessionResponse(authenticated=False)

        logger.warning("Session refresh failed", exc_info=True)
        return SessionResponse(authenticated=False)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(request: Request, response: Response):
    """
    Refresh the access token using the refresh token cookie.
    Updates the access token cookie with the new token.
    """
    refresh_token_cookie = request.cookies.get(COOKIE_NAME_REFRESH)

    if not refresh_token_cookie:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        auth_response = run_auth_operation_with_retry(
            "refresh",
            lambda client: client.auth.refresh_session(refresh_token_cookie),
        )
        session = auth_response.session

        if not session:
            clear_auth_cookies(response)
            raise HTTPException(status_code=401, detail="Failed to refresh session")

        set_auth_cookies(response, session.access_token, session.refresh_token)

        logger.debug("Token refreshed successfully")

        return RefreshResponse(success=True, message="Token refreshed")

    except AUTH_API_ERRORS as error:
        status_code = get_auth_error_status(error, 401)
        if status_code == 429:
            logger.warning("Token refresh rate limited")
            raise HTTPException(
                status_code=429,
                detail="Too many refresh attempts. Please retry shortly.",
                headers={"Retry-After": "1"},
            )

        logger.warning(f"Token refresh failed: {str(error)}")
        if status_code in {400, 401, 403}:
            clear_auth_cookies(response)

        raise HTTPException(status_code=status_code, detail=str(error))
    except HTTPException:
        raise
    except Exception as error:
        if is_network_error(error):
            logger.warning("Token refresh temporary auth service error: %s", error)
            raise HTTPException(
                status_code=503,
                detail="Authentication service unavailable. Please retry.",
            )

        logger.error("Token refresh error", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

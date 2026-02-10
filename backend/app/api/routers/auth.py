"""Authentication router with HttpOnly cookie-based token management."""

import os
import logging
from fastapi import APIRouter, HTTPException, Response, Request
from dotenv import load_dotenv, find_dotenv
from supabase import create_client, Client

try:
    from supabase_auth.errors import AuthApiError as SupabaseAuthApiError
except ImportError:
    SupabaseAuthApiError = None

try:
    from gotrue.errors import AuthApiError as GoTrueAuthApiError
except ImportError:
    GoTrueAuthApiError = None

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

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie settings
COOKIE_NAME_ACCESS = "sb_access_token"
COOKIE_NAME_REFRESH = "sb_refresh_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
COOKIE_HTTPONLY = True
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = "lax"

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
        auth_response = supabase.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password,
        })

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

    except AUTH_API_ERRORS as e:
        status_code = get_auth_error_status(e, 401)
        logger.warning(f"Login failed for {request.email}: {str(e)}")
        raise HTTPException(status_code=status_code, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest, response: Response):
    """
    Register a new user with email and password.
    Sets HttpOnly cookies with access and refresh tokens.
    """
    try:
        auth_response = supabase.auth.sign_up({
            "email": request.email,
            "password": request.password,
        })

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

    except AUTH_API_ERRORS as e:
        status_code = get_auth_error_status(e, 400)
        logger.warning(f"Registration failed for {request.email}: {str(e)}")
        raise HTTPException(status_code=status_code, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/logout", response_model=LogoutResponse)
async def logout(request: Request, response: Response):
    """
    Logout user and clear authentication cookies.
    """
    try:
        # Try to sign out from Supabase if we have a valid token
        access_token = request.cookies.get(COOKIE_NAME_ACCESS)
        if access_token:
            try:
                # Create a client with the user's token to sign out
                supabase.auth.sign_out()
            except Exception:
                # Ignore errors during sign out, we'll clear cookies anyway
                pass

        clear_auth_cookies(response)

        logger.info("User logged out")

        return LogoutResponse(success=True)

    except Exception as e:
        logger.error(f"Logout error: {str(e)}")
        # Still clear cookies even if there's an error
        clear_auth_cookies(response)
        return LogoutResponse(success=True, message="Logged out (with errors)")


@router.get("/session", response_model=SessionResponse)
async def get_session(request: Request):
    """
    Check current session status by verifying the access token cookie.
    Returns tokens for frontend Supabase SDK initialization.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    refresh_token_cookie = request.cookies.get(COOKIE_NAME_REFRESH)

    if not access_token:
        return SessionResponse(authenticated=False)

    try:
        user_response = supabase.auth.get_user(access_token)
        user = user_response.user

        if not user:
            return SessionResponse(authenticated=False)

        return SessionResponse(
            authenticated=True,
            user_id=user.id,
            email=user.email,
            access_token=access_token,
            refresh_token=refresh_token_cookie,
        )

    except Exception as e:
        logger.warning("Session check failed", exc_info=True)
        return SessionResponse(authenticated=False)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(request: Request, response: Response):
    """
    Refresh the access token using the refresh token cookie.
    Updates the access token cookie with the new token.
    """
    refresh_token = request.cookies.get(COOKIE_NAME_REFRESH)

    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        auth_response = supabase.auth.refresh_session(refresh_token)
        session = auth_response.session

        if not session:
            clear_auth_cookies(response)
            raise HTTPException(status_code=401, detail="Failed to refresh session")

        set_auth_cookies(response, session.access_token, session.refresh_token)

        logger.debug("Token refreshed successfully")

        return RefreshResponse(success=True, message="Token refreshed")

    except AUTH_API_ERRORS as e:
        status_code = get_auth_error_status(e, 401)
        if status_code == 429:
            logger.warning("Token refresh rate limited")
            raise HTTPException(
                status_code=429,
                detail="Too many refresh attempts. Please retry shortly.",
                headers={"Retry-After": "1"},
            )

        logger.warning(f"Token refresh failed: {str(e)}")
        if status_code in {400, 401, 403}:
            clear_auth_cookies(response)

        raise HTTPException(status_code=status_code, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Token refresh error", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

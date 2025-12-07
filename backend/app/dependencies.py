import os
from typing import Optional
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
from dotenv import load_dotenv, find_dotenv

_ = load_dotenv(find_dotenv())  # read local .env file

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
security = HTTPBearer(auto_error=False)

# Cookie names (must match auth router)
COOKIE_NAME_ACCESS = "sb_access_token"
COOKIE_NAME_REFRESH = "sb_refresh_token"


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


def verify_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """
    Verify authentication from either cookie or Authorization header.
    Prioritizes cookie-based auth, falls back to header-based auth.
    """
    # First try cookie
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    if access_token:
        try:
            user_response = supabase.auth.get_user(access_token)
            if user_response and user_response.user:
                return user_response
        except Exception:
            pass  # Fall through to try header auth

    # Then try Authorization header
    if credentials:
        try:
            user_response = supabase.auth.get_user(credentials.credentials)
            if user_response and user_response.user:
                return user_response
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Not authenticated")

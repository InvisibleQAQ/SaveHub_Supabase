"""Authentication Pydantic schemas for request/response validation."""

from pydantic import BaseModel, EmailStr
from typing import Optional


class LoginRequest(BaseModel):
    """Request model for user login."""
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    """Request model for user registration."""
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    """Response model for successful authentication."""
    user_id: str
    email: str
    # Tokens for frontend Supabase SDK initialization
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    # Token validity period in seconds (from Supabase session)
    expires_in: Optional[int] = None


class SessionResponse(BaseModel):
    """Response model for session check."""
    authenticated: bool
    user_id: Optional[str] = None
    email: Optional[str] = None
    # Tokens for frontend Supabase SDK initialization (on page reload)
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    # Token validity period in seconds
    expires_in: Optional[int] = None


class RefreshResponse(BaseModel):
    """Response model for token refresh."""
    success: bool
    message: Optional[str] = None
    # Token validity period in seconds (from refreshed session)
    expires_in: Optional[int] = None


class LogoutResponse(BaseModel):
    """Response model for logout."""
    success: bool
    message: str = "Logged out successfully"

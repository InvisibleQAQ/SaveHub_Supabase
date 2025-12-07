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


class SessionResponse(BaseModel):
    """Response model for session check."""
    authenticated: bool
    user_id: Optional[str] = None
    email: Optional[str] = None


class RefreshResponse(BaseModel):
    """Response model for token refresh."""
    success: bool
    message: Optional[str] = None


class LogoutResponse(BaseModel):
    """Response model for logout."""
    success: bool
    message: str = "Logged out successfully"

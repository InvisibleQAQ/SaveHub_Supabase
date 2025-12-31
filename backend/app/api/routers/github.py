"""
GitHub API integration endpoints.

Provides GitHub token validation and related functionality.
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/github", tags=["github"])


class ValidateTokenRequest(BaseModel):
    """Request model for token validation."""
    token: str


class ValidateTokenResponse(BaseModel):
    """Response model for token validation."""
    valid: bool
    username: str | None = None
    error: str | None = None


@router.post("/validate-token", response_model=ValidateTokenResponse)
async def validate_github_token(request: ValidateTokenRequest):
    """
    Validate a GitHub Personal Access Token.

    Calls GitHub API /user endpoint to verify token validity.

    Args:
        request: Token to validate

    Returns:
        Validation result with username if valid
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {request.token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                timeout=10.0
            )

            if response.status_code == 200:
                user_data = response.json()
                return ValidateTokenResponse(
                    valid=True,
                    username=user_data.get("login")
                )
            elif response.status_code == 401:
                return ValidateTokenResponse(
                    valid=False,
                    error="Invalid token"
                )
            elif response.status_code == 403:
                return ValidateTokenResponse(
                    valid=False,
                    error="Token lacks required permissions or rate limit exceeded"
                )
            else:
                return ValidateTokenResponse(
                    valid=False,
                    error=f"GitHub API returned status {response.status_code}"
                )

    except httpx.TimeoutException:
        logger.error("GitHub API timeout")
        raise HTTPException(status_code=504, detail="GitHub API timeout")
    except Exception as e:
        logger.error(f"Failed to validate GitHub token: {e}")
        raise HTTPException(status_code=500, detail="Failed to validate token")

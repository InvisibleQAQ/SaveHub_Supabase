"""Settings API router for user preferences."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.settings import (
    SettingsUpdate,
    SettingsResponse,
    DEFAULT_SETTINGS,
)
from app.services.db.settings import SettingsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


def get_settings_service(request: Request, user=Depends(verify_auth)) -> SettingsService:
    """Create SettingsService instance with authenticated user's session."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    client = get_supabase_client(access_token)
    return SettingsService(client, user.user.id)


@router.get("", response_model=SettingsResponse)
async def get_settings(service: SettingsService = Depends(get_settings_service)):
    """
    Get user settings.

    Returns default settings if none exist for the user.

    Returns:
        User settings or defaults.
    """
    try:
        settings = service.load_settings()
        if settings:
            return settings

        # Return defaults with user_id if no settings found
        return SettingsResponse(
            user_id=service.user_id,
            **DEFAULT_SETTINGS.model_dump(),
        )
    except Exception as e:
        logger.error(f"Failed to get settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve settings")


@router.put("", response_model=SettingsResponse)
async def update_settings(
    settings_update: SettingsUpdate,
    service: SettingsService = Depends(get_settings_service),
):
    """
    Update user settings.

    Creates settings if they don't exist (upsert).
    Supports partial updates - only provided fields will be updated.

    Args:
        settings_update: Fields to update

    Returns:
        Updated settings.
    """
    try:
        # Check if settings exist
        existing = service.load_settings()

        # Filter out None values
        update_data = {k: v for k, v in settings_update.model_dump().items() if v is not None}

        if existing:
            # Update existing settings
            if update_data:
                service.update_settings(update_data)
        else:
            # Create new settings with defaults + updates
            new_settings = DEFAULT_SETTINGS.model_dump()
            new_settings.update(update_data)
            service.save_settings(new_settings)

        # Return updated settings
        settings = service.load_settings()
        if settings:
            return settings

        # Fallback (should not happen)
        return SettingsResponse(
            user_id=service.user_id,
            **DEFAULT_SETTINGS.model_dump(),
        )
    except Exception as e:
        logger.error(f"Failed to update settings: {e}")
        raise HTTPException(status_code=500, detail="Failed to update settings")

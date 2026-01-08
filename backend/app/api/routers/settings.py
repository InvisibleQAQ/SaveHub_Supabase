"""Settings API router for user preferences."""

import logging
from fastapi import APIRouter, Depends

from app.dependencies import create_service_dependency
from app.schemas.settings import (
    SettingsUpdate,
    SettingsResponse,
    DEFAULT_SETTINGS,
)
from app.services.db.settings import SettingsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


get_settings_service = create_service_dependency(SettingsService)


@router.get("", response_model=SettingsResponse)
async def get_settings(service: SettingsService = Depends(get_settings_service)):
    """
    Get user settings.

    Returns default settings if none exist for the user.

    Returns:
        User settings or defaults.
    """
    settings = service.load_settings()
    if settings:
        return settings

    # Return defaults with user_id if no settings found
    return SettingsResponse(
        user_id=service.user_id,
        **DEFAULT_SETTINGS.model_dump(),
    )


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
    # Check if settings exist
    existing = service.load_settings()

    # Convert to dict, keeping None values for fields that need to be deleted
    update_data = settings_update.model_dump(exclude_unset=True)

    logger.debug(f"Update data: {update_data}")

    if existing:
        # Update existing settings
        if update_data:
            service.update_settings(update_data)
    else:
        # Create new settings with defaults + updates
        new_settings = DEFAULT_SETTINGS.model_dump()
        # Filter out None values for creation
        filtered_updates = {k: v for k, v in update_data.items() if v is not None}
        new_settings.update(filtered_updates)
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

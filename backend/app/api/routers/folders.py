"""Folders API router for CRUD operations."""

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends

from app.dependencies import create_service_dependency, require_exists, extract_update_data
from app.exceptions import DuplicateError, ValidationError
from app.schemas.folders import (
    FolderCreate,
    FolderCreateWithId,
    FolderUpdate,
    FolderResponse,
)
from app.services.db.folders import FolderService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])


get_folder_service = create_service_dependency(FolderService)


@router.get("", response_model=List[FolderResponse])
async def get_folders(service: FolderService = Depends(get_folder_service)):
    """
    Get all folders for the authenticated user.

    Returns:
        List of folders ordered by order field.
    """
    folders = service.load_folders()
    logger.debug(f"Retrieved {len(folders)} folders")
    return folders


@router.post("", response_model=dict)
async def create_folders(
    folders: List[FolderCreateWithId],
    service: FolderService = Depends(get_folder_service),
):
    """
    Create or upsert multiple folders.

    Supports bulk creation/update of folders.

    Args:
        folders: List of folders to create/update

    Returns:
        Success status with count.
    """
    folder_dicts = [folder.model_dump() for folder in folders]
    result = service.save_folders(folder_dicts)

    if not result.get("success"):
        error = result.get("error", "Unknown error")
        if error == "duplicate":
            raise DuplicateError("folder name")
        raise ValidationError(error)

    logger.info(f"Created/updated {len(folders)} folders")
    return {"success": True, "count": len(folders)}


@router.put("/{folder_id}", response_model=dict)
async def update_folder(
    folder_id: UUID,
    folder_update: FolderUpdate,
    service: FolderService = Depends(get_folder_service),
):
    """
    Update a folder by ID.

    Supports partial updates - only provided fields will be updated.

    Args:
        folder_id: UUID of the folder to update
        folder_update: Fields to update

    Returns:
        Success status.

    Raises:
        404 if folder not found.
    """
    require_exists(service.get_folder(str(folder_id)), "Folder")

    update_data = extract_update_data(folder_update)

    if not update_data:
        return {"success": True, "message": "No fields to update"}

    result = service.update_folder(str(folder_id), update_data)

    if not result.get("success"):
        error = result.get("error", "Unknown error")
        raise ValidationError(error)

    logger.info(f"Updated folder {folder_id}")
    return {"success": True}


@router.delete("/{folder_id}", response_model=dict)
async def delete_folder(
    folder_id: UUID,
    service: FolderService = Depends(get_folder_service),
):
    """
    Delete a folder.

    Note: Feeds in this folder wave their folder_id set to null.

    Args:
        folder_id: UUID of the folder to delete

    Returns:
        Success status.

    Raises:
        404 if folder not found.
    """
    require_exists(service.get_folder(str(folder_id)), "Folder")

    service.delete_folder(str(folder_id))
    logger.info(f"Deleted folder {folder_id}")
    return {"success": True}

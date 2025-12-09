"""Folders API router for CRUD operations."""

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.folders import (
    FolderCreate,
    FolderCreateWithId,
    FolderUpdate,
    FolderResponse,
)
from app.services.db.folders import FolderService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])


def get_folder_service(request: Request, user=Depends(verify_auth)) -> FolderService:
    """Create FolderService instance with authenticated user's session."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    client = get_supabase_client(access_token)
    return FolderService(client, user.user.id)


@router.get("", response_model=List[FolderResponse])
async def get_folders(service: FolderService = Depends(get_folder_service)):
    """
    Get all folders for the authenticated user.

    Returns:
        List of folders ordered by order field.
    """
    try:
        folders = service.load_folders()
        logger.debug(f"Retrieved {len(folders)} folders")
        return folders
    except Exception as e:
        logger.error(f"Failed to get folders: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve folders")


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
    try:
        folder_dicts = [folder.model_dump() for folder in folders]
        result = service.save_folders(folder_dicts)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            if error == "duplicate":
                raise HTTPException(status_code=409, detail="Duplicate folder name")
            raise HTTPException(status_code=400, detail=error)

        logger.info(f"Created/updated {len(folders)} folders")
        return {"success": True, "count": len(folders)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create folders: {e}")
        raise HTTPException(status_code=500, detail="Failed to create folders")


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
    try:
        existing = service.get_folder(str(folder_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")

        update_data = {k: v for k, v in folder_update.model_dump().items() if v is not None}

        if not update_data:
            return {"success": True, "message": "No fields to update"}

        result = service.update_folder(str(folder_id), update_data)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            raise HTTPException(status_code=400, detail=error)

        logger.info(f"Updated folder {folder_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update folder")


@router.delete("/{folder_id}", response_model=dict)
async def delete_folder(
    folder_id: UUID,
    service: FolderService = Depends(get_folder_service),
):
    """
    Delete a folder.

    Note: Feeds in this folder will have their folder_id set to null.

    Args:
        folder_id: UUID of the folder to delete

    Returns:
        Success status.

    Raises:
        404 if folder not found.
    """
    try:
        existing = service.get_folder(str(folder_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")

        service.delete_folder(str(folder_id))
        logger.info(f"Deleted folder {folder_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete folder")

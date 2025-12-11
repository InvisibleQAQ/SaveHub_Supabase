"""API Configs router for CRUD operations with encryption."""

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.api_configs import (
    ApiConfigCreate,
    ApiConfigUpdate,
    ApiConfigResponse,
)
from app.services.db.api_configs import ApiConfigService
from app.services.encryption import encrypt, decrypt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api-configs", tags=["api-configs"])


def get_api_config_service(
    request: Request, user=Depends(verify_auth)
) -> ApiConfigService:
    """Create ApiConfigService instance with authenticated user's session."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    client = get_supabase_client(access_token)
    return ApiConfigService(client, user.user.id)


def _decrypt_config(config: dict) -> dict:
    """Decrypt sensitive fields in a config dict."""
    result = config.copy()
    if result.get("api_key"):
        try:
            result["api_key"] = decrypt(result["api_key"])
        except ValueError:
            # Already decrypted or invalid, leave as-is
            logger.warning(f"Failed to decrypt api_key for config {result.get('id')}")
    if result.get("api_base"):
        try:
            result["api_base"] = decrypt(result["api_base"])
        except ValueError:
            # Already decrypted or invalid, leave as-is
            logger.warning(f"Failed to decrypt api_base for config {result.get('id')}")
    return result


def _encrypt_sensitive_fields(data: dict) -> dict:
    """Encrypt sensitive fields in a config dict."""
    result = data.copy()
    if "api_key" in result and result["api_key"]:
        result["api_key"] = encrypt(result["api_key"])
    if "api_base" in result and result["api_base"]:
        result["api_base"] = encrypt(result["api_base"])
    return result


@router.get("", response_model=List[ApiConfigResponse])
async def get_api_configs(service: ApiConfigService = Depends(get_api_config_service)):
    """
    Get all API configs for the authenticated user.

    Returns configs with decrypted api_key and api_base fields.
    """
    try:
        configs = service.load_api_configs()
        # Decrypt sensitive fields before returning
        decrypted_configs = [_decrypt_config(config) for config in configs]
        logger.debug(f"Retrieved {len(decrypted_configs)} API configs")
        return decrypted_configs
    except Exception as e:
        logger.error(f"Failed to get API configs: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve API configs")


@router.post("", response_model=ApiConfigResponse)
async def create_api_config(
    data: ApiConfigCreate,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Create a new API config.

    Encrypts api_key and api_base before storing.
    """
    try:
        # Convert to dict and encrypt sensitive fields
        config_data = data.model_dump()
        encrypted_data = _encrypt_sensitive_fields(config_data)

        # Save using upsert (single item list)
        result = service.save_api_configs([encrypted_data])

        if not result.get("success"):
            raise HTTPException(
                status_code=400, detail=result.get("error", "Failed to create config")
            )

        # Reload to get the created config with ID
        configs = service.load_api_configs()
        if configs:
            # Return the most recently created one (sorted by created_at desc)
            created_config = _decrypt_config(configs[0])
            logger.info(f"Created API config: {created_config.get('id')}")
            return created_config

        raise HTTPException(status_code=500, detail="Config created but not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create API config: {e}")
        raise HTTPException(status_code=500, detail="Failed to create API config")


@router.get("/{config_id}", response_model=ApiConfigResponse)
async def get_api_config(
    config_id: UUID,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Get a single API config by ID.

    Returns config with decrypted api_key and api_base fields.
    """
    try:
        config = service.get_api_config(str(config_id))
        if not config:
            raise HTTPException(status_code=404, detail="API config not found")
        return _decrypt_config(config)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get API config {config_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve API config")


@router.put("/{config_id}", response_model=ApiConfigResponse)
async def update_api_config(
    config_id: UUID,
    data: ApiConfigUpdate,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Update an API config by ID.

    Supports partial updates. Encrypts api_key and api_base if provided.
    """
    try:
        # First check if config exists
        existing = service.get_api_config(str(config_id))
        if not existing:
            raise HTTPException(status_code=404, detail="API config not found")

        # Filter out None values for partial update
        update_data = {k: v for k, v in data.model_dump().items() if v is not None}

        if not update_data:
            # No fields to update, return existing config
            return _decrypt_config(existing)

        # Encrypt sensitive fields if provided
        encrypted_data = _encrypt_sensitive_fields(update_data)

        result = service.update_api_config(str(config_id), encrypted_data)

        if not result.get("success"):
            raise HTTPException(
                status_code=400, detail=result.get("error", "Failed to update config")
            )

        # Reload to return updated config
        updated_config = service.get_api_config(str(config_id))
        if updated_config:
            logger.info(f"Updated API config: {config_id}")
            return _decrypt_config(updated_config)

        raise HTTPException(status_code=500, detail="Config updated but not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update API config {config_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update API config")


@router.delete("/{config_id}")
async def delete_api_config(
    config_id: UUID,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """Delete an API config by ID."""
    try:
        # First check if config exists
        existing = service.get_api_config(str(config_id))
        if not existing:
            raise HTTPException(status_code=404, detail="API config not found")

        service.delete_api_config(str(config_id))
        logger.info(f"Deleted API config: {config_id}")
        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete API config {config_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete API config")


@router.post("/{config_id}/set-default")
async def set_default_config(
    config_id: UUID,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Set an API config as the default.

    Unsets any previously default config for this user.
    """
    try:
        # First check if config exists
        existing = service.get_api_config(str(config_id))
        if not existing:
            raise HTTPException(status_code=404, detail="API config not found")

        service.set_default_config(str(config_id))
        logger.info(f"Set API config {config_id} as default")
        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set default API config {config_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to set default config")

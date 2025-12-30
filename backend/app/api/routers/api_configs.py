"""API Configs router for CRUD operations with encryption.

Supports three API types: chat, embedding, rerank.
Each type can have multiple configs but only one active per user.
"""

import logging
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.supabase_client import get_supabase_client
from app.schemas.api_configs import (
    ApiConfigCreate,
    ApiConfigUpdate,
    ApiConfigResponse,
    ApiConfigsGroupedResponse,
    ApiValidationRequest,
    ApiValidationResponse,
    ApiValidationDetails,
)
from app.services.db.api_configs import ApiConfigService
from app.services.encryption import encrypt, decrypt
from app.services.api_validation import validate_api

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
async def get_api_configs(
    type: Optional[str] = Query(None, description="Filter by type: chat, embedding, rerank"),
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Get all API configs for the authenticated user.

    Optionally filter by type. Returns configs with decrypted fields.
    """
    try:
        if type and type not in ("chat", "embedding", "rerank"):
            raise HTTPException(status_code=400, detail="Invalid config type")

        configs = service.load_api_configs(config_type=type)
        decrypted_configs = [_decrypt_config(config) for config in configs]
        logger.debug(f"Retrieved {len(decrypted_configs)} API configs (type={type})")
        return decrypted_configs
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get API configs: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve API configs")


@router.get("/grouped", response_model=ApiConfigsGroupedResponse)
async def get_api_configs_grouped(
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Get all API configs grouped by type.

    Returns: {chat: [...], embedding: [...], rerank: [...]}
    """
    try:
        logger.debug(f"get_api_configs_grouped called for user {service.user_id}")
        all_configs = service.load_api_configs()
        logger.debug(f"Loaded {len(all_configs)} configs, decrypting...")
        decrypted = [_decrypt_config(c) for c in all_configs]
        logger.debug(f"Decrypted {len(decrypted)} configs")

        grouped = {
            "chat": [c for c in decrypted if c.get("type") == "chat"],
            "embedding": [c for c in decrypted if c.get("type") == "embedding"],
            "rerank": [c for c in decrypted if c.get("type") == "rerank"],
        }

        logger.debug(f"Retrieved grouped configs: chat={len(grouped['chat'])}, "
                     f"embedding={len(grouped['embedding'])}, rerank={len(grouped['rerank'])}")
        return grouped
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get grouped API configs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve grouped API configs: {str(e)}")


@router.get("/active/{config_type}", response_model=Optional[ApiConfigResponse])
async def get_active_config(
    config_type: str,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Get the active config for a specific type.

    Returns null if no active config exists for that type.
    """
    try:
        if config_type not in ("chat", "embedding", "rerank"):
            raise HTTPException(status_code=400, detail="Invalid config type")

        config = service.get_active_config(config_type)
        if config:
            return _decrypt_config(config)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get active {config_type} config: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve active config")


@router.post("", response_model=ApiConfigResponse)
async def create_api_config(
    data: ApiConfigCreate,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Create a new API config.

    Encrypts api_key and api_base before storing.
    If is_active=True, deactivates other configs of same type.
    """
    try:
        config_data = data.model_dump()
        encrypted_data = _encrypt_sensitive_fields(config_data)

        created = service.create_api_config(encrypted_data)
        logger.info(f"Created API config: {created.get('id')} (type={created.get('type')})")
        return _decrypt_config(created)

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
    """Get a single API config by ID."""
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

    Supports partial updates. If is_active=True, deactivates others of same type.
    """
    try:
        existing = service.get_api_config(str(config_id))
        if not existing:
            raise HTTPException(status_code=404, detail="API config not found")

        update_data = {k: v for k, v in data.model_dump().items() if v is not None}

        if not update_data:
            return _decrypt_config(existing)

        encrypted_data = _encrypt_sensitive_fields(update_data)
        updated = service.update_api_config(str(config_id), encrypted_data)

        logger.info(f"Updated API config: {config_id}")
        return _decrypt_config(updated)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
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


@router.post("/{config_id}/activate")
async def activate_config(
    config_id: UUID,
    service: ApiConfigService = Depends(get_api_config_service),
):
    """
    Activate a config, auto-deactivating others of same type.

    This is the preferred way to change active config.
    """
    try:
        existing = service.get_api_config(str(config_id))
        if not existing:
            raise HTTPException(status_code=404, detail="API config not found")

        service.set_active_config(str(config_id))
        logger.info(f"Activated API config {config_id} (type={existing.get('type')})")
        return {"success": True}

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to activate API config {config_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to activate config")


@router.post("/validate", response_model=ApiValidationResponse)
async def validate_api_config(
    data: ApiValidationRequest,
    _user=Depends(verify_auth),
):
    """
    Validate API credentials and model using LangChain.

    Supports chat, embedding, and rerank API types.
    Makes a test request to verify the configuration works.
    """
    try:
        logger.info(f"Validating {data.type} API: model={data.model}, base={data.api_base}")

        success, error, latency = await validate_api(
            api_key=data.api_key,
            api_base=data.api_base,
            model=data.model,
            api_type=data.type,
        )

        if success:
            logger.info(f"API validation successful: {data.type}/{data.model} ({latency}ms)")
            return ApiValidationResponse(
                success=True,
                details=ApiValidationDetails(
                    latency=latency,
                    model_supported=True,
                ),
            )
        else:
            logger.warning(f"API validation failed: {data.type}/{data.model} - {error}")
            return ApiValidationResponse(
                success=False,
                error=error,
            )

    except Exception as e:
        logger.error(f"Unexpected error during API validation: {e}", exc_info=True)
        return ApiValidationResponse(
            success=False,
            error=f"验证过程中发生未知错误: {str(e)[:100]}",
        )

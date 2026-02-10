"""
AI服务配置管理。

职责：
1. URL规范化（统一处理各种格式的api_base）
2. 配置获取和解密
3. 配置验证
"""

import logging
from typing import Dict, Optional, Sequence

from supabase import Client

from app.services.encryption import decrypt

logger = logging.getLogger(__name__)


class ConfigError(Exception):
    """AI配置错误"""

    def __init__(
        self,
        message: str,
        missing_types: Optional[Sequence[str]] = None,
    ):
        super().__init__(message)
        self.missing_types = list(missing_types or [])


SUPPORTED_CONFIG_TYPES = ("chat", "embedding", "rerank")


def normalize_base_url(url: str) -> str:
    """
    规范化 OpenAI 兼容 API 的 base_url。

    OpenAI SDK 会自动追加 /embeddings、/chat/completions 等路径，
    所以 base_url 应该以 /v1 结尾。

    处理规则：
    1. 确保有 https:// 前缀
    2. 移除尾部斜杠
    3. 移除常见端点后缀（/embeddings, /chat/completions）
    4. 如果不以 /v1 结尾，追加 /v1

    Examples:
        https://api.example.com/v1/chat/completions -> https://api.example.com/v1
        https://api.example.com/v1/embeddings -> https://api.example.com/v1
        https://api.example.com -> https://api.example.com/v1
        api.example.com/v1 -> https://api.example.com/v1
    """
    if not url:
        return url

    url = url.strip()

    # 确保有协议前缀
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    # 移除尾部斜杠
    url = url.rstrip("/")

    # 移除常见的端点后缀（OpenAI SDK 会自动添加这些）
    endpoint_suffixes = [
        "/embeddings",
        "/chat/completions",
        "/completions",
    ]

    for suffix in endpoint_suffixes:
        if url.endswith(suffix):
            url = url[: -len(suffix)]
            break

    # 再次移除可能的尾部斜杠
    url = url.rstrip("/")

    # 确保以 /v1 结尾
    if not url.endswith("/v1"):
        url = f"{url}/v1"

    return url


def get_decrypted_config(config: dict) -> dict:
    """
    解密API配置中的敏感字段。

    Args:
        config: 原始配置 {api_key, api_base, model, ...}

    Returns:
        解密后的配置，api_base 已规范化
    """
    result = config.copy()

    # 解密 api_key
    if result.get("api_key"):
        try:
            result["api_key"] = decrypt(result["api_key"])
        except ValueError:
            logger.warning(f"Failed to decrypt api_key for config {result.get('id')}")

    # 解密 api_base
    if result.get("api_base"):
        try:
            result["api_base"] = decrypt(result["api_base"])
        except ValueError:
            logger.warning(f"Failed to decrypt api_base for config {result.get('id')}")

    # 规范化 api_base
    if result.get("api_base"):
        result["api_base"] = normalize_base_url(result["api_base"])

    return result


def get_user_ai_configs(supabase: Client, user_id: str) -> Dict[str, dict]:
    """
    获取用户的所有激活AI配置。

    Args:
        supabase: Supabase客户端
        user_id: 用户ID

    Returns:
        {
            "chat": {"api_key": "...", "api_base": "...", "model": "..."},
            "embedding": {"api_key": "...", "api_base": "...", "model": "..."},
        }

    Raises:
        ConfigError: 配置不存在或不完整
    """
    configs: Dict[str, dict] = {}

    for config_type in ["chat", "embedding"]:
        try:
            response = (
                supabase.table("api_configs")
                .select("*")
                .eq("user_id", user_id)
                .eq("type", config_type)
                .eq("is_active", True)
                .single()
                .execute()
            )

            if response.data:
                decrypted = get_decrypted_config(response.data)
                configs[config_type] = {
                    "api_key": decrypted["api_key"],
                    "api_base": decrypted["api_base"],
                    "model": decrypted["model"],
                }
        except Exception as e:
            logger.debug(f"No active {config_type} config for user {user_id}: {e}")

    return configs


def get_active_config(
    supabase: Client, user_id: str, config_type: str
) -> Optional[dict]:
    """
    获取用户指定类型的激活配置。

    Args:
        supabase: Supabase客户端
        user_id: 用户ID
        config_type: 配置类型 ('chat', 'embedding', 'rerank')

    Returns:
        解密后的配置字典，或 None
    """
    try:
        response = (
            supabase.table("api_configs")
            .select("*")
            .eq("user_id", user_id)
            .eq("type", config_type)
            .eq("is_active", True)
            .single()
            .execute()
        )

        if response.data:
            decrypted = get_decrypted_config(response.data)
            return {
                "api_key": decrypted["api_key"],
                "api_base": decrypted["api_base"],
                "model": decrypted["model"],
            }
    except Exception as e:
        logger.debug(f"No active {config_type} config for user {user_id}: {e}")

    return None


def get_required_ai_configs(
    supabase: Client,
    user_id: str,
    required_types: Sequence[str],
) -> Dict[str, dict]:
    """
    获取并校验必需的 AI 配置。

    Args:
        supabase: Supabase客户端
        user_id: 用户ID
        required_types: 必需的配置类型序列（如 ["chat", "embedding"]）

    Returns:
        按配置类型组织的解密且规范化后的配置

    Raises:
        ConfigError: 缺少配置或类型非法
    """
    configs: Dict[str, dict] = {}
    missing_types = []

    for config_type in required_types:
        if config_type not in SUPPORTED_CONFIG_TYPES:
            raise ConfigError(f"Unsupported config type: {config_type}")

        config = get_active_config(supabase, user_id, config_type)
        if config:
            configs[config_type] = config
        else:
            missing_types.append(config_type)

    if missing_types:
        raise ConfigError(
            f"Missing required AI configs: {', '.join(missing_types)}",
            missing_types=missing_types,
        )

    return configs

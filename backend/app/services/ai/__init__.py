"""
统一AI服务模块。

Usage:
    from app.services.ai import (
        ChatClient,
        EmbeddingClient,
        get_user_ai_configs,
        get_active_config,
        normalize_base_url,
    )

    # 获取配置
    configs = get_user_ai_configs(supabase, user_id)

    # 创建客户端
    chat = ChatClient(**configs["chat"])
    embedding = EmbeddingClient(**configs["embedding"])

    # 使用
    response = await chat.complete(messages)
    vector = await embedding.embed(text)
"""

from .config import (
    normalize_base_url,
    get_decrypted_config,
    get_user_ai_configs,
    get_active_config,
    ConfigError,
)
from .clients import (
    ChatClient,
    EmbeddingClient,
    RerankClient,
    ChatError,
    EmbeddingError,
    AIClientError,
    CAPTION_PROMPT,
)
from .repository_service import RepositoryAnalyzerService

# 从 errors 模块导入新的异常类
from app.services.errors import (
    ChatServiceError,
    EmbeddingServiceError,
    VisionServiceError,
    AIServiceError,
)

__all__ = [
    # Config
    "normalize_base_url",
    "get_decrypted_config",
    "get_user_ai_configs",
    "get_active_config",
    "ConfigError",
    # Clients
    "ChatClient",
    "EmbeddingClient",
    "RerankClient",
    # Repository Analysis
    "RepositoryAnalyzerService",
    # Errors (backward compatible aliases)
    "ChatError",
    "EmbeddingError",
    "AIClientError",
    # Errors (new)
    "ChatServiceError",
    "EmbeddingServiceError",
    "VisionServiceError",
    "AIServiceError",
    # Constants
    "CAPTION_PROMPT",
]

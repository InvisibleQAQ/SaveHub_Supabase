"""
统一的服务层错误处理工具。

提供：
1. AI 服务异常类（包含结构化信息）
2. 错误处理工具函数
3. 日志格式化工具
"""

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional, Type, TypeVar

from openai import (
    APIError as OpenAIAPIError,
    APIStatusError,
    APIConnectionError,
    APITimeoutError,
    AuthenticationError as OpenAIAuthError,
    RateLimitError as OpenAIRateLimitError,
    BadRequestError,
    NotFoundError as OpenAINotFoundError,
    InternalServerError,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Structured Error Info
# =============================================================================

@dataclass
class AIErrorInfo:
    """AI 服务错误的结构化信息"""

    error_type: str  # 错误类型: "rate_limit", "auth", "timeout", etc.
    message: str  # 用户友好的错误消息
    status_code: Optional[int] = None
    request_id: Optional[str] = None
    error_code: Optional[str] = None  # OpenAI error code
    error_param: Optional[str] = None  # OpenAI error param
    raw_body: Optional[Any] = None  # 原始响应体

    def to_log_dict(self) -> Dict[str, Any]:
        """转换为日志字典（排除 None 值）"""
        return {
            k: v
            for k, v in {
                "error_type": self.error_type,
                "status_code": self.status_code,
                "request_id": self.request_id,
                "error_code": self.error_code,
                "error_param": self.error_param,
            }.items()
            if v is not None
        }


# =============================================================================
# AI Service Exceptions (Enhanced)
# =============================================================================

class AIServiceError(Exception):
    """
    AI 服务错误基类（增强版）。

    包含结构化错误信息，便于日志记录和调试。
    """

    def __init__(self, message: str, info: Optional[AIErrorInfo] = None):
        super().__init__(message)
        self.message = message
        self.info = info or AIErrorInfo(error_type="unknown", message=message)

    @property
    def status_code(self) -> Optional[int]:
        return self.info.status_code

    @property
    def request_id(self) -> Optional[str]:
        return self.info.request_id

    def __str__(self) -> str:
        parts = [self.message]
        if self.info.status_code:
            parts.append(f"[status={self.info.status_code}]")
        if self.info.request_id:
            parts.append(f"[request_id={self.info.request_id}]")
        return " ".join(parts)


class ChatServiceError(AIServiceError):
    """Chat Completion 服务错误"""
    pass


class EmbeddingServiceError(AIServiceError):
    """Embedding 服务错误"""
    pass


class VisionServiceError(AIServiceError):
    """Vision 服务错误"""
    pass


# =============================================================================
# Error Classification
# =============================================================================

def _extract_error_message(e: APIStatusError) -> Optional[str]:
    """从 OpenAI 错误响应中提取用户友好的错误消息"""
    if not e.body:
        return None

    if isinstance(e.body, dict):
        error = e.body.get("error", {})
        if isinstance(error, dict):
            return error.get("message")
        if isinstance(error, str):
            return error
        # 处理非标准格式: {'code': -1, 'msg': 'xxx'}
        msg = e.body.get("msg") or e.body.get("message")
        if msg:
            return msg

    return None


def classify_openai_error(e: Exception) -> AIErrorInfo:
    """
    将 OpenAI SDK 异常分类为结构化错误信息。

    Args:
        e: OpenAI SDK 抛出的异常

    Returns:
        AIErrorInfo 结构化错误信息
    """
    # Rate Limit
    if isinstance(e, OpenAIRateLimitError):
        return AIErrorInfo(
            error_type="rate_limit",
            message="API 请求频率超限，请稍后重试",
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            raw_body=e.body,
        )

    # Authentication
    if isinstance(e, OpenAIAuthError):
        return AIErrorInfo(
            error_type="authentication",
            message="API Key 无效或已过期",
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            raw_body=e.body,
        )

    # Bad Request (400)
    if isinstance(e, BadRequestError):
        msg = _extract_error_message(e) or "请求参数错误"
        return AIErrorInfo(
            error_type="bad_request",
            message=msg,
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            error_param=getattr(e, "param", None),
            raw_body=e.body,
        )

    # Not Found (404)
    if isinstance(e, OpenAINotFoundError):
        return AIErrorInfo(
            error_type="not_found",
            message="模型或资源不存在，请检查配置",
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            raw_body=e.body,
        )

    # Internal Server Error (5xx)
    if isinstance(e, InternalServerError):
        msg = _extract_error_message(e) or "AI 服务暂时不可用，请稍后重试"
        return AIErrorInfo(
            error_type="server_error",
            message=msg,
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            raw_body=e.body,
        )

    # Timeout
    if isinstance(e, APITimeoutError):
        return AIErrorInfo(
            error_type="timeout",
            message="请求超时，请检查网络或稍后重试",
        )

    # Connection Error
    if isinstance(e, APIConnectionError):
        return AIErrorInfo(
            error_type="connection",
            message="无法连接到 AI 服务，请检查网络",
        )

    # Generic API Status Error
    if isinstance(e, APIStatusError):
        msg = _extract_error_message(e) or f"API 错误 (HTTP {e.status_code})"
        return AIErrorInfo(
            error_type="api_error",
            message=msg,
            status_code=e.status_code,
            request_id=getattr(e, "request_id", None),
            error_code=getattr(e, "code", None),
            raw_body=e.body,
        )

    # Generic OpenAI API Error
    if isinstance(e, OpenAIAPIError):
        return AIErrorInfo(
            error_type="api_error",
            message=str(e) or "AI API 调用失败",
            error_code=getattr(e, "code", None),
            raw_body=getattr(e, "body", None),
        )

    # Unknown error - 提供完整的异常信息
    return AIErrorInfo(
        error_type="unknown",
        message=f"{type(e).__name__}: {str(e)}" if str(e) else type(e).__name__,
    )


# =============================================================================
# Error Handling Utilities
# =============================================================================

E = TypeVar("E", bound=AIServiceError)


def handle_openai_error(
    e: Exception,
    operation: str,
    error_class: Type[E] = AIServiceError,
    context: Optional[Dict[str, Any]] = None,
) -> E:
    """
    统一处理 OpenAI SDK 异常。

    1. 分类错误
    2. 记录结构化日志
    3. 返回适当的异常实例

    Args:
        e: 原始异常
        operation: 操作描述（如 "chat completion", "embedding"）
        error_class: 要抛出的异常类
        context: 额外的日志上下文

    Returns:
        error_class 实例

    Usage:
        try:
            response = await client.chat.completions.create(...)
        except Exception as e:
            raise handle_openai_error(e, "chat completion", ChatServiceError)
    """
    info = classify_openai_error(e)

    # 构建日志消息
    log_data = info.to_log_dict()
    if context:
        log_data.update(context)

    log_msg = f"{operation} failed: {info.message}"
    if log_data:
        log_msg += f" | {log_data}"

    # 根据错误类型选择日志级别
    if info.error_type in ("rate_limit", "timeout", "connection"):
        logger.warning(log_msg)
    else:
        logger.error(log_msg)

    # 创建并返回异常
    return error_class(f"{operation} failed: {info.message}", info=info)


def format_error_message(e: Exception, default: str = "") -> str:
    """
    格式化异常为用户友好的错误消息。

    消除 "Unknown error" 的使用，提供有意义的错误信息。

    Args:
        e: 异常实例
        default: 默认消息（仅当无法提取任何信息时使用）

    Returns:
        格式化的错误消息
    """
    # 已经是我们的异常类型
    if isinstance(e, AIServiceError):
        return e.message

    # OpenAI SDK 异常
    if isinstance(e, OpenAIAPIError):
        info = classify_openai_error(e)
        return info.message

    # 有消息的异常
    msg = str(e)
    if msg:
        return f"{type(e).__name__}: {msg}"

    # 只有类型名
    if default:
        return f"{default} ({type(e).__name__})"

    return type(e).__name__

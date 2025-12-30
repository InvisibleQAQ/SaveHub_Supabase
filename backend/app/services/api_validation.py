"""API validation service using direct HTTP requests.

Validates chat, embedding, and rerank API configurations by making
test requests to the full endpoint URL provided by user.

User provides complete endpoint URLs like:
- https://api.example.com/v1/chat/completions
- https://api.example.com/v1/embeddings
- https://api.example.com/v1/rerank
"""

import logging
import time
from typing import Optional, Tuple
import httpx

logger = logging.getLogger(__name__)


async def validate_chat_api(
    api_key: str,
    api_base: str,
    model: str,
) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    Validate chat API by sending a test request to the full endpoint URL.

    Args:
        api_key: API key
        api_base: Full endpoint URL (e.g., https://api.example.com/v1/chat/completions)
        model: Model name

    Returns: (success, error_message, latency_ms)
    """
    try:
        start_time = time.time()

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                api_base,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                    "temperature": 0,
                },
            )

            if not response.is_success:
                error_text = response.text
                return False, _parse_http_error(response.status_code, error_text, "chat"), None

        latency = int((time.time() - start_time) * 1000)
        return True, None, latency

    except httpx.TimeoutException:
        return False, "网络连接超时，请检查API端点URL", None
    except httpx.ConnectError:
        return False, "无法连接到API服务器，请检查网络和API端点URL", None
    except Exception as e:
        error_msg = _parse_error(e, "chat")
        logger.warning(f"Chat API validation failed: {e}")
        return False, error_msg, None


async def validate_embedding_api(
    api_key: str,
    api_base: str,
    model: str,
) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    Validate embedding API by sending a test request to the full endpoint URL.

    Args:
        api_key: API key
        api_base: Full endpoint URL (e.g., https://api.example.com/v1/embeddings)
        model: Model name

    Returns: (success, error_message, latency_ms)
    """
    try:
        start_time = time.time()

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                api_base,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": "test",
                },
            )

            if not response.is_success:
                error_text = response.text
                return False, _parse_http_error(response.status_code, error_text, "embedding"), None

        latency = int((time.time() - start_time) * 1000)
        return True, None, latency

    except httpx.TimeoutException:
        return False, "网络连接超时，请检查API端点URL", None
    except httpx.ConnectError:
        return False, "无法连接到API服务器，请检查网络和API端点URL", None
    except Exception as e:
        error_msg = _parse_error(e, "embedding")
        logger.warning(f"Embedding API validation failed: {e}")
        return False, error_msg, None


async def validate_rerank_api(
    api_key: str,
    api_base: str,
    model: str,
) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    Validate rerank API by sending a test request to the full endpoint URL.

    Args:
        api_key: API key
        api_base: Full endpoint URL (e.g., https://api.example.com/v1/rerank)
        model: Model name

    Returns: (success, error_message, latency_ms)
    """
    try:
        start_time = time.time()

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                api_base,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "query": "test query",
                    "documents": ["test document"],
                    "top_n": 1,
                },
            )

            if not response.is_success:
                error_text = response.text
                return False, _parse_http_error(response.status_code, error_text, "rerank"), None

        latency = int((time.time() - start_time) * 1000)
        return True, None, latency

    except httpx.TimeoutException:
        return False, "网络连接超时，请检查API端点URL", None
    except httpx.ConnectError:
        return False, "无法连接到API服务器，请检查网络和API端点URL", None
    except Exception as e:
        error_msg = _parse_error(e, "rerank")
        logger.warning(f"Rerank API validation failed: {e}")
        return False, error_msg, None


async def validate_api(
    api_key: str,
    api_base: str,
    model: str,
    api_type: str = "chat",
) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    Unified API validation entry point.

    Args:
        api_key: API key
        api_base: Full endpoint URL (not just base, but complete endpoint)
        model: Model name to validate
        api_type: One of 'chat', 'embedding', 'rerank'

    Returns: (success, error_message, latency_ms)
    """
    if api_type == "chat":
        return await validate_chat_api(api_key, api_base, model)
    elif api_type == "embedding":
        return await validate_embedding_api(api_key, api_base, model)
    elif api_type == "rerank":
        return await validate_rerank_api(api_key, api_base, model)
    else:
        return False, f"不支持的API类型: {api_type}", None


def _parse_error(error: Exception, api_type: str) -> str:
    """Parse exception into user-friendly error message."""
    error_str = str(error).lower()

    if "unauthorized" in error_str or "401" in error_str or "invalid api key" in error_str:
        return "API Key无效或已过期"

    if "not found" in error_str or "404" in error_str:
        return "端点不存在，请检查API端点URL是否正确"

    if "rate limit" in error_str or "429" in error_str:
        return "API请求频率限制，请稍后重试"

    if "quota" in error_str or "billing" in error_str or "insufficient" in error_str:
        return "API配额不足或账单问题"

    if "timeout" in error_str:
        return "网络连接超时，请检查API端点URL"

    if "connection" in error_str or "connect" in error_str:
        return "无法连接到API服务器，请检查网络和API端点URL"

    if "400" in error_str or "bad request" in error_str:
        return f"请求格式错误，请检查模型名称是否正确"

    # Return original error for debugging
    return f"验证失败: {str(error)[:200]}"


def _parse_http_error(status_code: int, error_text: str, api_type: str) -> str:
    """Parse HTTP error response into user-friendly message."""
    if status_code == 401:
        return "API Key无效或权限不足"
    if status_code == 404:
        return "端点不存在，请检查API端点URL是否正确"
    if status_code == 429:
        return "API请求频率限制，请稍后重试"
    if status_code == 400:
        # Try to extract error message from response
        try:
            import json
            error_json = json.loads(error_text)
            if "error" in error_json:
                err = error_json["error"]
                if isinstance(err, dict) and "message" in err:
                    return f"请求错误: {err['message'][:100]}"
                elif isinstance(err, str):
                    return f"请求错误: {err[:100]}"
        except:
            pass
        return f"请求格式错误: {error_text[:100]}"
    if status_code >= 500:
        return "API服务器内部错误，请稍后重试"

    return f"HTTP {status_code}: {error_text[:100]}"

"""
图片 Caption 生成服务。

使用 Vision 模型（如 GPT-4o）分析图片并生成描述性文本。
复用用户配置的 chat 模型来实现 vision 功能。
"""

import base64
import logging
from typing import Optional, Tuple

import httpx
from openai import OpenAI

logger = logging.getLogger(__name__)

# Vision 提示词
CAPTION_PROMPT = """你是一个专业的图片描述生成器。请仔细分析这张图片，用中文生成详细但简洁的描述。

要求：
1. 描述图片中的主要元素、场景和布局
2. 如果图片中有文字，请准确提取出来
3. 如果是图表或数据可视化，描述其类型和关键信息
4. 如果是代码截图，描述代码的语言和大致功能
5. 描述要信息完整但不超过200字

请直接输出描述内容，不要添加前缀或标签。"""

# 下载配置（与 image_processor.py 对齐）
DOWNLOAD_TIMEOUT = 15
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/avif", "image/bmp",
}


class VisionError(Exception):
    """Vision 处理错误"""
    pass


class ImageDownloadError(VisionError):
    """图片下载错误"""
    pass


class CaptionGenerationError(VisionError):
    """Caption 生成错误"""
    pass


def download_image_for_vision(url: str) -> Tuple[bytes, str]:
    """
    下载图片用于 Vision 处理。

    复用 image_processor.py 的下载逻辑，但不做 SSRF 检查
    （图片已经过 image_processor 处理，URL 可能是 Supabase Storage）。

    Args:
        url: 图片 URL

    Returns:
        (image_bytes, content_type)

    Raises:
        ImageDownloadError: 下载失败
    """
    try:
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )

            if response.status_code != 200:
                raise ImageDownloadError(f"HTTP {response.status_code}")

            content_type = response.headers.get("content-type", "").split(";")[0].strip()

            # 验证内容类型
            if content_type not in ALLOWED_CONTENT_TYPES:
                if not content_type.startswith("image/"):
                    raise ImageDownloadError(f"Invalid content type: {content_type}")

            content = response.content
            if len(content) > MAX_IMAGE_SIZE:
                raise ImageDownloadError("Image too large (>10MB)")

            return content, content_type

    except httpx.TimeoutException:
        raise ImageDownloadError("Download timeout")
    except httpx.RequestError as e:
        raise ImageDownloadError(f"Request error: {e}")
    except ImageDownloadError:
        raise
    except Exception as e:
        raise ImageDownloadError(f"Download failed: {e}")


def get_media_type(content_type: str) -> str:
    """
    将 Content-Type 转换为 OpenAI API 需要的 media_type。
    """
    mapping = {
        "image/jpeg": "image/jpeg",
        "image/jpg": "image/jpeg",
        "image/png": "image/png",
        "image/gif": "image/gif",
        "image/webp": "image/webp",
    }
    return mapping.get(content_type, "image/jpeg")


def generate_image_caption(
    image_url: str,
    api_key: str,
    api_base: str,
    model: str,
    max_tokens: int = 300,
) -> str:
    """
    使用 Vision 模型生成图片 caption。

    流程：
    1. 下载图片
    2. Base64 编码
    3. 调用 Vision API
    4. 返回生成的描述

    Args:
        image_url: 图片 URL
        api_key: API Key
        api_base: API Base URL
        model: 模型名称（需支持 vision，如 gpt-4o）
        max_tokens: 最大生成 token 数

    Returns:
        生成的图片描述文本

    Raises:
        VisionError: 处理失败
    """
    try:
        # 1. 下载图片
        logger.debug(f"Downloading image: {image_url[:100]}")
        image_bytes, content_type = download_image_for_vision(image_url)

        # 2. Base64 编码
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
        media_type = get_media_type(content_type)

        # 3. 调用 Vision API
        client = OpenAI(api_key=api_key, base_url=api_base)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": CAPTION_PROMPT,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{media_type};base64,{base64_image}",
                                "detail": "auto",  # 自动选择分辨率
                            },
                        },
                    ],
                }
            ],
            max_tokens=max_tokens,
        )

        caption = response.choices[0].message.content
        if not caption:
            raise CaptionGenerationError("Empty caption returned")

        logger.info(f"Generated caption for {image_url[:50]}...: {caption[:50]}...")
        return caption.strip()

    except ImageDownloadError:
        raise
    except Exception as e:
        logger.error(f"Caption generation failed for {image_url[:100]}: {e}")
        raise CaptionGenerationError(f"Failed to generate caption: {e}")


def generate_image_caption_safe(
    image_url: str,
    api_key: str,
    api_base: str,
    model: str,
) -> Optional[str]:
    """
    安全版本的 caption 生成，失败时返回 None 而非抛出异常。

    Args:
        image_url: 图片 URL
        api_key: API Key
        api_base: API Base URL
        model: 模型名称

    Returns:
        生成的描述，失败时返回 None
    """
    try:
        return generate_image_caption(image_url, api_key, api_base, model)
    except VisionError as e:
        logger.warning(f"Caption generation failed (safe mode): {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error in caption generation: {e}")
        return None

"""
图片 Caption 生成服务。

使用 Vision 模型分析图片并生成描述性文本。
直接传递图片 URL 给 Vision API，由模型端下载处理。
"""

import logging
from typing import Optional

from openai import OpenAI

logger = logging.getLogger(__name__)


def _normalize_base_url(base_url: str) -> str:
    """
    清理 base_url，移除用户可能误加的路径后缀。

    OpenAI SDK 会自动在 base_url 后追加 /chat/completions，
    如果用户配置时已经包含了这个路径，会导致重复。

    Examples:
        https://xxx/v1/chat/completions -> https://xxx/v1
        https://xxx/v1/embeddings -> https://xxx/v1
        https://xxx/v1 -> https://xxx/v1 (不变)
    """
    suffixes_to_remove = [
        "/chat/completions",
        "/embeddings",
    ]
    for suffix in suffixes_to_remove:
        if base_url.endswith(suffix):
            return base_url[:-len(suffix)]
    return base_url


# Vision 提示词
CAPTION_PROMPT = """你是一个专业的图片描述生成器。请仔细分析这张图片，用中文生成详细但简洁的描述。

要求：
1. 描述图片中的主要元素、场景和布局
2. 如果图片中有文字，请准确提取出来
3. 如果是图表或数据可视化，描述其类型和关键信息
4. 如果是代码截图，描述代码的语言和大致功能
5. 描述要信息完整但不超过200字

请直接输出描述内容，不要添加前缀或标签。"""


class VisionError(Exception):
    """Vision 处理错误"""
    pass


class CaptionGenerationError(VisionError):
    """Caption 生成错误"""
    pass


def generate_image_caption(
    image_url: str,
    api_key: str,
    api_base: str,
    model: str,
    max_tokens: int = 500,
) -> str:
    """
    使用 Vision 模型生成图片 caption。

    直接传递图片 URL 给 Vision API，由模型端下载并处理图片。

    Args:
        image_url: 图片 URL（需为公开可访问的 URL）
        api_key: API Key
        api_base: API Base URL
        model: 模型名称（需支持 vision，如 qwen-vl-plus）
        max_tokens: 最大生成 token 数

    Returns:
        生成的图片描述文本

    Raises:
        CaptionGenerationError: 生成失败
    """
    try:
        logger.debug(f"Generating caption for: {image_url[:100]}")

        normalized_base = _normalize_base_url(api_base)
        client = OpenAI(api_key=api_key, base_url=normalized_base)

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
                                "url": image_url,
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

        logger.info(f"Generated caption for {image_url}...: {caption}...")
        return caption.strip()

    except Exception as e:
        logger.error(f"Caption generation failed for {image_url}: {e}")
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

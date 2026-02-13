"""
统一的AI客户端。

所有客户端：
- 使用 AsyncOpenAI SDK
- 接受已解密、已规范化的配置
- 提供类型安全的接口
"""

import logging
import re
from typing import List, Dict, Any, AsyncGenerator, Optional

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 网络配置
DEFAULT_TIMEOUT = httpx.Timeout(90.0, connect=30.0)
DEFAULT_MAX_RETRIES = 3

# 批处理配置
DEFAULT_BATCH_SIZE = 100
OPENAI_COMPAT_SAFE_BATCH_SIZE = 10

# Vision 提示词
CAPTION_PROMPT = """你是一个专业的图片描述生成器。请仔细分析这张图片，用中文生成详细但简洁的描述。

要求：
1. 描述图片中的主要元素、场景和布局
2. 如果图片中有文字，请准确提取出来
3. 如果是图表或数据可视化，描述其类型和关键信息
4. 如果是代码截图，描述代码的语言和大致功能
5. 描述要信息完整但不超过200字

请直接输出描述内容，不要添加前缀或标签。"""


class AIClientError(Exception):
    """AI客户端错误基类"""
    pass


class ChatError(AIClientError):
    """Chat Completion 错误"""
    pass


class EmbeddingError(AIClientError):
    """Embedding 生成错误"""
    pass


class ChatClient:
    """
    Chat Completion 客户端（包括 Vision）。

    Usage:
        client = ChatClient(api_key, api_base, model)

        # 普通对话
        response = await client.complete(messages)

        # 流式对话
        async for chunk in client.stream(messages):
            print(chunk)

        # Vision（图片描述）
        caption = await client.vision_caption(image_url)
    """

    def __init__(self, api_key: str, api_base: str, model: str):
        """
        初始化 Chat 客户端。

        Args:
            api_key: API密钥（已解密）
            api_base: API基础URL（已规范化，以/v1结尾）
            model: 模型名称
        """
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=api_base,
            timeout=DEFAULT_TIMEOUT,
            max_retries=DEFAULT_MAX_RETRIES,
        )
        self.model = model

    async def complete(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """
        非流式对话。

        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            temperature: 温度参数
            max_tokens: 最大生成token数

        Returns:
            生成的文本内容

        Raises:
            ChatError: 生成失败
        """
        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content
            return content or ""
        except Exception as e:
            logger.error(f"Chat completion failed: {e}")
            raise ChatError(f"Chat completion failed: {e}") from e

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        """
        流式对话。

        Args:
            messages: 消息列表
            temperature: 温度参数
            max_tokens: 最大生成token数

        Yields:
            生成的文本片段

        Raises:
            ChatError: 生成失败
        """
        try:
            stream = await self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            logger.error(f"Chat stream failed: {e}")
            raise ChatError(f"Chat stream failed: {e}") from e

    async def vision_caption(
        self,
        image_url: str,
        prompt: str = CAPTION_PROMPT,
        max_tokens: int = 4096,
    ) -> str:
        """
        生成图片描述。

        Args:
            image_url: 图片URL（需为公开可访问的URL）
            prompt: 提示词
            max_tokens: 最大生成token数

        Returns:
            生成的图片描述

        Raises:
            ChatError: 生成失败
        """
        try:
            logger.debug(f"Generating caption for: {image_url[:100]}")

            response = await self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                max_tokens=max_tokens,
            )

            caption = response.choices[0].message.content
            if not caption:
                raise ChatError("Empty caption returned")

            logger.info(f"Generated caption for {image_url[:50]}...")
            return caption.strip()

        except Exception as e:
            logger.error(f"Vision caption failed for {image_url}: {e}")
            raise ChatError(f"Vision caption failed: {e}") from e

    async def vision_caption_safe(
        self,
        image_url: str,
        prompt: str = CAPTION_PROMPT,
        max_tokens: int = 4096,
    ) -> Optional[str]:
        """
        安全版本的图片描述生成，失败时返回 None。

        Args:
            image_url: 图片URL
            prompt: 提示词
            max_tokens: 最大生成token数

        Returns:
            生成的描述，失败时返回 None
        """
        try:
            return await self.vision_caption(image_url, prompt, max_tokens)
        except ChatError as e:
            logger.warning(f"Vision caption failed (safe mode): {e}")
            return None
        except Exception as e:
            logger.warning(f"Unexpected error in vision caption: {e}")
            return None


class EmbeddingClient:
    """
    Embedding 客户端。

    Usage:
        client = EmbeddingClient(api_key, api_base, model)

        # 单文本
        vector = await client.embed(text)

        # 批量
        vectors = await client.embed_batch(texts)
    """

    def __init__(self, api_key: str, api_base: str, model: str):
        """
        初始化 Embedding 客户端。

        Args:
            api_key: API密钥（已解密）
            api_base: API基础URL（已规范化，以/v1结尾）
            model: 模型名称
        """
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=api_base,
            timeout=DEFAULT_TIMEOUT,
            max_retries=DEFAULT_MAX_RETRIES,
        )
        self.api_base = api_base
        self.model = model

    @staticmethod
    def _extract_batch_limit(error_message: str) -> Optional[int]:
        """从 provider 错误信息中提取批量上限（如果存在）。"""
        match = re.search(r"not be larger than\s*(\d+)", error_message, re.IGNORECASE)
        if not match:
            return None

        try:
            return int(match.group(1))
        except ValueError:
            return None

    def _get_provider_safe_batch_size(self, requested_batch_size: int) -> int:
        """根据 provider 特性返回安全批大小。"""
        safe_batch_size = max(1, requested_batch_size)
        api_base_lower = (self.api_base or "").lower()

        if "dashscope" in api_base_lower or "aliyuncs" in api_base_lower:
            return min(safe_batch_size, OPENAI_COMPAT_SAFE_BATCH_SIZE)

        return safe_batch_size

    async def embed(self, text: str, dimensions: int = 1536) -> List[float]:
        """
        生成单个文本的 embedding。

        Args:
            text: 输入文本
            dimensions: 向量维度

        Returns:
            向量列表

        Raises:
            EmbeddingError: 生成失败
        """
        if not text or not text.strip():
            raise EmbeddingError("Empty text provided")

        try:
            response = await self._client.embeddings.create(
                model=self.model,
                input=text.strip(),
                dimensions=dimensions,
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding failed for text (len={len(text)}): {e}")
            raise EmbeddingError(f"Failed to generate embedding: {e}") from e

    async def embed_batch(
        self,
        texts: List[str],
        dimensions: int = 1536,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> List[List[float]]:
        """
        批量生成文本的 embeddings。

        Args:
            texts: 输入文本列表
            dimensions: 向量维度
            batch_size: 每批处理的文本数量

        Returns:
            与输入顺序对应的向量列表

        Raises:
            EmbeddingError: 生成失败
        """
        if not texts:
            return []

        # 过滤空文本并记录原始索引
        valid_texts = []
        valid_indices = []
        for i, text in enumerate(texts):
            if text and text.strip():
                valid_texts.append(text.strip())
                valid_indices.append(i)

        if not valid_texts:
            logger.warning("All texts are empty, returning empty embeddings")
            return [[] for _ in texts]

        try:
            async def _embed_with_batch_size(effective_batch_size: int) -> List[List[float]]:
                all_embeddings: List[Optional[List[float]]] = [None] * len(texts)

                for batch_start in range(0, len(valid_texts), effective_batch_size):
                    batch_end = min(batch_start + effective_batch_size, len(valid_texts))
                    batch_texts = valid_texts[batch_start:batch_end]
                    batch_indices = valid_indices[batch_start:batch_end]

                    logger.debug(
                        f"Processing batch {batch_start}-{batch_end} of {len(valid_texts)}"
                    )

                    response = await self._client.embeddings.create(
                        model=self.model,
                        input=batch_texts,
                        dimensions=dimensions,
                    )

                    for j, emb_data in enumerate(response.data):
                        original_idx = batch_indices[j]
                        all_embeddings[original_idx] = emb_data.embedding

                result = []
                for emb in all_embeddings:
                    result.append(emb if emb is not None else [])

                logger.info(
                    f"Generated embeddings: total={len(texts)}, "
                    f"valid={len(valid_texts)}, "
                    f"batches={len(range(0, len(valid_texts), effective_batch_size))}"
                )

                return result

            effective_batch_size = self._get_provider_safe_batch_size(batch_size)

            try:
                return await _embed_with_batch_size(effective_batch_size)
            except Exception as first_error:
                retry_batch_limit = self._extract_batch_limit(str(first_error))
                if retry_batch_limit and retry_batch_limit < effective_batch_size:
                    logger.warning(
                        "Embedding provider batch limit detected (%s), retrying with smaller batches",
                        retry_batch_limit,
                    )
                    return await _embed_with_batch_size(retry_batch_limit)

                raise first_error

        except Exception as e:
            logger.error(f"Batch embedding failed: {e}")
            raise EmbeddingError(f"Failed to generate embeddings: {e}") from e


class RerankClient:
    """
    Rerank 客户端（预留接口）。

    暂不实现，仅定义接口。
    """

    def __init__(self, api_key: str, api_base: str, model: str):
        raise NotImplementedError("Rerank client not implemented yet")

    async def rerank(
        self,
        query: str,
        documents: List[str],
        top_n: int = 10,
    ) -> List[Dict[str, Any]]:
        """重排序文档"""
        raise NotImplementedError()

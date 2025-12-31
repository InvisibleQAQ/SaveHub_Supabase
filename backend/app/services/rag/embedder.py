"""
向量嵌入生成服务。

使用 OpenAI 兼容的 Embedding API 将文本转换为向量。
支持批量处理以减少 API 调用次数。
"""

import logging
from typing import List, Optional

from openai import OpenAI

logger = logging.getLogger(__name__)

# 批处理配置
DEFAULT_BATCH_SIZE = 100  # OpenAI 建议的批量大小
MAX_TOKENS_PER_BATCH = 8000  # 每批最大 token 数（估算）


class EmbeddingError(Exception):
    """Embedding 生成错误"""
    pass


def embed_text(
    text: str,
    api_key: str,
    api_base: str,
    model: str,
) -> List[float]:
    """
    生成单个文本的 embedding。

    Args:
        text: 输入文本
        api_key: API Key
        api_base: API Base URL
        model: Embedding 模型名称

    Returns:
        1536 维向量列表

    Raises:
        EmbeddingError: 生成失败
    """
    if not text or not text.strip():
        raise EmbeddingError("Empty text provided")

    try:
        client = OpenAI(api_key=api_key, base_url=api_base)
        response = client.embeddings.create(
            model=model,
            input=text.strip(),
        )
        return response.data[0].embedding

    except Exception as e:
        logger.error(f"Embedding failed for text (len={len(text)}): {e}")
        raise EmbeddingError(f"Failed to generate embedding: {e}")


def embed_texts(
    texts: List[str],
    api_key: str,
    api_base: str,
    model: str,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> List[List[float]]:
    """
    批量生成文本的 embeddings。

    使用批处理减少 API 调用次数，提高效率。

    Args:
        texts: 输入文本列表
        api_key: API Key
        api_base: API Base URL
        model: Embedding 模型名称
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
        client = OpenAI(api_key=api_key, base_url=api_base)
        all_embeddings: List[Optional[List[float]]] = [None] * len(texts)

        # 分批处理
        for batch_start in range(0, len(valid_texts), batch_size):
            batch_end = min(batch_start + batch_size, len(valid_texts))
            batch_texts = valid_texts[batch_start:batch_end]
            batch_indices = valid_indices[batch_start:batch_end]

            logger.debug(f"Processing batch {batch_start}-{batch_end} of {len(valid_texts)}")

            response = client.embeddings.create(
                model=model,
                input=batch_texts,
            )

            # 将结果放回原始位置
            for j, emb_data in enumerate(response.data):
                original_idx = batch_indices[j]
                all_embeddings[original_idx] = emb_data.embedding

        # 填充空文本位置为空列表
        result = []
        for emb in all_embeddings:
            if emb is None:
                result.append([])
            else:
                result.append(emb)

        logger.info(
            f"Generated embeddings: total={len(texts)}, "
            f"valid={len(valid_texts)}, batches={len(range(0, len(valid_texts), batch_size))}"
        )

        return result

    except Exception as e:
        logger.error(f"Batch embedding failed: {e}")
        raise EmbeddingError(f"Failed to generate embeddings: {e}")


def estimate_token_count(text: str) -> int:
    """
    估算文本的 token 数量。

    使用简单的规则进行估算（中文约 1.5 字符/token，英文约 4 字符/token）。

    Args:
        text: 输入文本

    Returns:
        估算的 token 数量
    """
    if not text:
        return 0

    # 简单估算：中文字符数 + 英文单词数
    chinese_chars = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    non_chinese = len(text) - chinese_chars

    # 中文约 1.5 字/token，英文约 4 字符/token
    estimated = int(chinese_chars / 1.5) + int(non_chinese / 4)

    return max(1, estimated)


def chunk_texts_for_embedding(
    texts: List[str],
    max_tokens_per_batch: int = MAX_TOKENS_PER_BATCH,
) -> List[List[int]]:
    """
    根据 token 数量将文本分组，确保每批不超过限制。

    Args:
        texts: 输入文本列表
        max_tokens_per_batch: 每批最大 token 数

    Returns:
        分组后的索引列表
    """
    batches = []
    current_batch = []
    current_tokens = 0

    for i, text in enumerate(texts):
        tokens = estimate_token_count(text)

        if current_tokens + tokens > max_tokens_per_batch and current_batch:
            batches.append(current_batch)
            current_batch = []
            current_tokens = 0

        current_batch.append(i)
        current_tokens += tokens

    if current_batch:
        batches.append(current_batch)

    return batches

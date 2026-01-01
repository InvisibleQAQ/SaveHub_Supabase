"""
RAG (Retrieval-Augmented Generation) 服务模块。

提供多模态 RAG 功能：
- chunker: HTML 内容解析和语义分块
- vision: 图片 caption 生成
- embedder: 向量嵌入生成
- retriever: pgvector 向量检索
"""

from .chunker import (
    ParsedArticle,
    TextElement,
    ImageElement,
    parse_article_content,
    chunk_text_semantic,
    fallback_chunk_text,
)
from .vision import generate_image_caption, generate_image_caption_safe
from .embedder import embed_texts, embed_text
from .retriever import search_embeddings

__all__ = [
    "ParsedArticle",
    "TextElement",
    "ImageElement",
    "parse_article_content",
    "chunk_text_semantic",
    "fallback_chunk_text",
    "generate_image_caption",
    "generate_image_caption_safe",
    "embed_texts",
    "embed_text",
    "search_embeddings",
]

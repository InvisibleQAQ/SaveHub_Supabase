# RAG Services Module

RAG pipeline for article processing: HTML parsing, semantic chunking, and vector retrieval.

**Note**: Embedding and Vision功能已迁移到 `app.services.ai` 模块。

## File Overview

| File | Purpose |
|------|---------|
| `chunker.py` | HTML parsing, URL resolution, semantic text chunking |
| `retriever.py` | Similarity search for RAG queries |

## Key Flow

```
Article HTML → chunker.parse_article_content(base_url)
    ↓
ParsedArticle (TextElement + ImageElement with resolved URLs)
    ↓
ChatClient.vision_caption() → generate captions (from app.services.ai)
    ↓
Full text with [图片描述: caption] markers
    ↓
Semantic chunking → EmbeddingClient.embed_batch() → database
```

## URL Resolution (chunker.py)

**Critical**: Image URLs in RSS feeds may be relative paths.

```python
parsed = parse_article_content(title, author, content, article_url)
```

**Functions**:
- `parse_article_content(title, author, html, base_url)`: Main entry point
- `chunk_text_semantic(text, api_key, api_base, model)`: Semantic chunking
- `fallback_chunk_text(text)`: Fallback chunking

## AI Services (migrated)

Embedding and Vision功能现在在 `app.services.ai` 模块：

```python
from app.services.ai import ChatClient, EmbeddingClient

# Vision caption
chat = ChatClient(api_key, api_base, model)
caption = await chat.vision_caption(image_url)

# Embedding
embedding = EmbeddingClient(api_key, api_base, model)
vectors = await embedding.embed_batch(texts)
```

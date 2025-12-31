# RAG Services Module

Multimodal RAG pipeline for article processing: HTML parsing, image captioning, semantic chunking, and embedding generation.

## File Overview

| File | Purpose |
|------|---------|
| `chunker.py` | HTML parsing, URL resolution, semantic text chunking |
| `vision.py` | Image caption generation via Vision API |
| `embedder.py` | Text embedding generation |
| `retriever.py` | Similarity search for RAG queries |

## Key Flow

```
Article HTML → chunker.parse_article_content(base_url)
    ↓
ParsedArticle (TextElement + ImageElement with resolved URLs)
    ↓
Vision API → generate captions for images
    ↓
Full text with [图片描述: caption] markers
    ↓
Semantic chunking → embeddings → database
```

## URL Resolution (chunker.py)

**Critical**: Image URLs in RSS feeds may be relative paths. `parse_article_content` accepts `base_url` parameter to resolve them:

```python
# Relative URL examples:
# /images/foo.png → https://example.com/images/foo.png
# images/foo.png → https://example.com/path/images/foo.png
# //cdn.example.com/foo.png → https://cdn.example.com/foo.png

parsed = parse_article_content(title, author, content, article_url)
```

**Functions**:
- `_is_absolute_url(url)`: Check if URL has scheme and netloc
- `_resolve_url(src, base_url)`: Convert relative to absolute URL using `urljoin`
- `parse_html_to_elements(html, base_url)`: Extract text/images with URL resolution
- `parse_article_content(title, author, html, base_url)`: Main entry point

## Vision API (vision.py)

Direct URL passthrough to Vision model - requires absolute URLs:

```python
caption = generate_image_caption(
    image_url,      # Must be absolute URL
    api_key,
    api_base,
    model,          # e.g., qwen-vl-plus
)
```

## Caller Reference

`rag_processor.py` (Celery task) queries article `url` field and passes to chunker:

```python
result = supabase.table("articles").select(
    "id, user_id, title, author, content, url, rag_processed"
)...
parsed_article = parse_article_content(title, author, content, article_url)
```

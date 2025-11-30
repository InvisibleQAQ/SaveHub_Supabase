# RSS 功能迁移详细步骤

## 概述

本文档详细说明如何将 RSS 解析功能从 Next.js API Routes（使用 `rss-parser`）迁移到 FastAPI（使用 `feedparser`）。

## 现有实现分析

### Next.js RSS 验证端点

**文件**: `app/api/rss/validate/route.ts`

```typescript
export async function POST(request: Request) {
  const { url } = await request.json()

  const parser = new Parser()
  const feed = await parser.parseURL(url)

  return NextResponse.json({ valid: feed.items.length > 0 })
}
```

### Next.js RSS 解析端点

**文件**: `app/api/rss/parse/route.ts`

关键逻辑：

1. **缩略图提取优先级**:
   - `media:thumbnail`
   - `media:content`
   - `enclosure`（类型为 image/*）

2. **摘要处理**:
   - 截断到 200 字符
   - 添加省略号

3. **日期解析**:
   - 优先 `pubDate`
   - 回退到 `isoDate`
   - 最后使用当前时间

## FastAPI 实现

### RSS 解析服务

创建 `backend/app/services/rss_parser.py`：

```python
"""
RSS 解析服务

使用 feedparser 库解析 RSS/Atom 订阅源。
匹配现有 Next.js 实现的行为，确保前端兼容性。
"""

import feedparser
from uuid import uuid4
from datetime import datetime, timezone
from typing import Optional, List, Tuple, Dict, Any
from urllib.parse import urlparse
import hashlib
import logging

logger = logging.getLogger(__name__)


def extract_thumbnail(entry: Dict[str, Any]) -> Optional[str]:
    """
    从 feed entry 中提取缩略图 URL

    提取优先级（匹配 TypeScript 实现）:
    1. media:thumbnail
    2. media:content
    3. enclosure (image/* 类型)

    Args:
        entry: feedparser 解析的 entry 对象

    Returns:
        缩略图 URL 或 None
    """
    # 1. 检查 media:thumbnail
    if 'media_thumbnail' in entry:
        thumbs = entry.get('media_thumbnail', [])
        if thumbs and len(thumbs) > 0:
            return thumbs[0].get('url')

    # 2. 检查 media:content
    if 'media_content' in entry:
        contents = entry.get('media_content', [])
        if contents and len(contents) > 0:
            url = contents[0].get('url')
            if url:
                return url

    # 3. 检查 enclosure
    if 'enclosures' in entry:
        for enc in entry.get('enclosures', []):
            enc_type = enc.get('type', '')
            if enc_type.startswith('image/'):
                return enc.get('href') or enc.get('url')

    # 4. 检查 links 中的 enclosure
    for link in entry.get('links', []):
        if link.get('rel') == 'enclosure':
            link_type = link.get('type', '')
            if link_type.startswith('image/'):
                return link.get('href')

    return None


def parse_published_date(entry: Dict[str, Any]) -> datetime:
    """
    解析发布日期，带有多重回退

    Args:
        entry: feedparser 解析的 entry 对象

    Returns:
        发布日期的 datetime 对象
    """
    # 尝试 published_parsed
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        except (TypeError, ValueError):
            pass

    # 尝试 updated_parsed
    if hasattr(entry, 'updated_parsed') and entry.updated_parsed:
        try:
            return datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
        except (TypeError, ValueError):
            pass

    # 回退到当前时间
    return datetime.now(timezone.utc)


def extract_content(entry: Dict[str, Any]) -> str:
    """
    提取文章内容

    优先级:
    1. content 字段
    2. description 字段
    3. summary 字段

    Args:
        entry: feedparser 解析的 entry 对象

    Returns:
        文章内容字符串
    """
    # 检查 content 字段（可能是列表）
    if 'content' in entry and entry['content']:
        contents = entry['content']
        if isinstance(contents, list) and len(contents) > 0:
            return contents[0].get('value', '')
        elif isinstance(contents, str):
            return contents

    # 回退到 description
    if 'description' in entry and entry['description']:
        return entry['description']

    # 回退到 summary
    if 'summary' in entry and entry['summary']:
        return entry['summary']

    return ''


def truncate_summary(text: str, max_length: int = 200) -> str:
    """
    截断摘要文本

    Args:
        text: 原始文本
        max_length: 最大长度（默认 200）

    Returns:
        截断后的文本（超长则添加省略号）
    """
    if not text:
        return ''
    if len(text) <= max_length:
        return text
    return text[:max_length] + '...'


def compute_content_hash(title: str, content: str) -> str:
    """
    计算内容哈希值用于去重

    Args:
        title: 文章标题
        content: 文章内容

    Returns:
        SHA-256 哈希值
    """
    combined = f"{title}{content}"
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


async def parse_rss_feed(url: str, feed_id: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    解析 RSS 订阅源并提取文章

    Args:
        url: RSS 订阅源 URL
        feed_id: 订阅源 ID（用于关联文章）

    Returns:
        元组: (feed_info, articles)
        - feed_info: 订阅源元数据
        - articles: 文章列表

    Raises:
        ValueError: 当 feed 无效或解析失败时
    """
    logger.info(f"Parsing RSS feed: {url}")

    # 解析 feed
    parsed = feedparser.parse(url)

    # 检查解析错误
    if parsed.bozo and not parsed.entries:
        error_msg = str(parsed.bozo_exception) if hasattr(parsed, 'bozo_exception') else 'Unknown error'
        logger.error(f"Feed parse error: {error_msg}")
        raise ValueError(f"Invalid RSS feed: {error_msg}")

    # 提取 feed 元数据
    hostname = urlparse(url).hostname or 'Unknown'
    feed_info = {
        'title': parsed.feed.get('title', hostname),
        'description': parsed.feed.get('description', ''),
        'link': parsed.feed.get('link', url),
        'image': None,
    }

    # 提取 feed 图片
    if 'image' in parsed.feed:
        feed_info['image'] = parsed.feed.image.get('href')

    # 解析文章
    articles = []
    for entry in parsed.entries:
        content = extract_content(entry)
        summary_text = entry.get('summary', '') or entry.get('description', '')

        article = {
            'id': str(uuid4()),
            'feedId': feed_id,
            'title': entry.get('title', 'Untitled'),
            'content': content,
            'summary': truncate_summary(summary_text),
            'url': entry.get('link', ''),
            'author': entry.get('author') or entry.get('dc_creator'),
            'publishedAt': parse_published_date(entry),
            'isRead': False,
            'isStarred': False,
            'thumbnail': extract_thumbnail(entry),
            'contentHash': compute_content_hash(
                entry.get('title', ''),
                content
            ),
        }
        articles.append(article)

    logger.info(f"Parsed {len(articles)} articles from {url}")
    return feed_info, articles


async def validate_rss_url(url: str) -> bool:
    """
    验证 URL 是否为有效的 RSS 订阅源

    Args:
        url: 要验证的 URL

    Returns:
        True 如果是有效的 RSS feed，否则 False
    """
    try:
        parsed = feedparser.parse(url)

        # 检查是否有 entries 或者是有效的 feed 结构
        if parsed.entries:
            return True

        # 即使没有 entries，也检查是否有有效的 feed 结构
        if hasattr(parsed, 'feed') and parsed.feed:
            if parsed.feed.get('title') or parsed.feed.get('link'):
                return True

        return False

    except Exception as e:
        logger.warning(f"RSS validation failed for {url}: {e}")
        return False
```

### RSS API 路由

创建 `backend/app/api/routers/rss.py`：

```python
"""
RSS API 路由

提供 RSS 订阅源验证和解析的 API 端点。
"""

from fastapi import APIRouter, HTTPException, Depends
from app.schemas.rss import (
    ValidateRequest, ValidateResponse,
    ParseRequest, ParseResponse, ParsedFeed, ParsedArticle
)
from app.services.rss_parser import parse_rss_feed, validate_rss_url
from app.dependencies import verify_jwt
import logging

router = APIRouter(prefix="/rss", tags=["RSS"])
logger = logging.getLogger(__name__)


@router.post("/validate", response_model=ValidateResponse)
async def validate_feed(
    request: ValidateRequest,
    user=Depends(verify_jwt)
):
    """
    验证 RSS 订阅源 URL

    检查给定 URL 是否指向有效的 RSS/Atom 订阅源。

    Args:
        request: 包含 url 字段的请求体
        user: 已验证的用户（通过 JWT）

    Returns:
        ValidateResponse: { valid: boolean }
    """
    try:
        is_valid = await validate_rss_url(str(request.url))
        logger.info(f"RSS validation for {request.url}: {is_valid}")
        return ValidateResponse(valid=is_valid)
    except Exception as e:
        logger.warning(f"RSS validation error for {request.url}: {e}")
        return ValidateResponse(valid=False)


@router.post("/parse", response_model=ParseResponse)
async def parse_feed(
    request: ParseRequest,
    user=Depends(verify_jwt)
):
    """
    解析 RSS 订阅源并提取文章

    解析给定 URL 的 RSS/Atom 订阅源，返回订阅源元数据和文章列表。

    Args:
        request: 包含 url 和 feedId 的请求体
        user: 已验证的用户（通过 JWT）

    Returns:
        ParseResponse: { feed: {...}, articles: [...] }

    Raises:
        HTTPException: 解析失败时返回 500 错误
    """
    try:
        feed_info, articles = await parse_rss_feed(
            str(request.url),
            str(request.feedId)
        )

        return ParseResponse(
            feed=ParsedFeed(**feed_info),
            articles=[ParsedArticle(**a) for a in articles]
        )

    except ValueError as e:
        # 预期的验证错误
        logger.warning(f"RSS parse validation error for {request.url}: {e}")
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )
    except Exception as e:
        # 非预期错误
        logger.error(f"RSS parse error for {request.url}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse RSS feed: {str(e)}"
        )
```

### 注册路由

修改 `backend/app/main.py`：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import chat, rss  # 添加 rss
from app.database import engine, Base
import os
from dotenv import load_dotenv

load_dotenv()

# OpenAI 配置
os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY", "")

app = FastAPI(title="SaveHub Backend")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 启动时创建表
@app.on_event("startup")
async def startup():
    Base.metadata.create_all(bind=engine)

# 注册路由
app.include_router(chat.router, prefix="/api")
app.include_router(rss.router, prefix="/api")  # 新增
```

## 响应格式对比

### 验证端点

**请求**:
```json
{
  "url": "https://example.com/feed.xml"
}
```

**响应** (TypeScript 和 Python 相同):
```json
{
  "valid": true
}
```

### 解析端点

**请求**:
```json
{
  "url": "https://example.com/feed.xml",
  "feedId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**响应**:
```json
{
  "feed": {
    "title": "Example Blog",
    "description": "A sample blog",
    "link": "https://example.com",
    "image": "https://example.com/logo.png"
  },
  "articles": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "feedId": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Article Title",
      "content": "<p>Full article content...</p>",
      "summary": "Article summary truncated to 200 characters...",
      "url": "https://example.com/article-1",
      "author": "John Doe",
      "publishedAt": "2024-01-15T10:30:00Z",
      "isRead": false,
      "isStarred": false,
      "thumbnail": "https://example.com/image.jpg"
    }
  ]
}
```

## 测试

### 单元测试

创建 `backend/tests/test_rss_parser.py`：

```python
import pytest
from app.services.rss_parser import (
    extract_thumbnail,
    parse_published_date,
    truncate_summary,
    compute_content_hash,
)

def test_truncate_summary_short():
    """短文本不应被截断"""
    text = "Short text"
    assert truncate_summary(text) == text

def test_truncate_summary_long():
    """长文本应被截断并添加省略号"""
    text = "a" * 250
    result = truncate_summary(text)
    assert len(result) == 203  # 200 + '...'
    assert result.endswith('...')

def test_compute_content_hash():
    """相同内容应产生相同哈希"""
    hash1 = compute_content_hash("Title", "Content")
    hash2 = compute_content_hash("Title", "Content")
    hash3 = compute_content_hash("Title", "Different")

    assert hash1 == hash2
    assert hash1 != hash3

def test_extract_thumbnail_media_thumbnail():
    """应从 media_thumbnail 提取缩略图"""
    entry = {
        'media_thumbnail': [{'url': 'https://example.com/thumb.jpg'}]
    }
    assert extract_thumbnail(entry) == 'https://example.com/thumb.jpg'
```

### 集成测试

```python
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_validate_endpoint():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/rss/validate",
            json={"url": "https://example.com/feed.xml"},
            headers={"Authorization": "Bearer test_token"}
        )
        assert response.status_code == 200
        assert "valid" in response.json()
```

## 差异说明

### feedparser vs rss-parser

| 特性 | rss-parser (Node.js) | feedparser (Python) |
|------|---------------------|---------------------|
| 媒体命名空间 | `itunes:image` | `media_thumbnail` |
| 内容字段 | `content:encoded` | `content` (列表) |
| 日期解析 | `pubDate`, `isoDate` | `published_parsed` |
| 错误处理 | 抛出异常 | `bozo` 标志 |

### 注意事项

1. **字段名映射**: feedparser 使用下划线命名（`media_thumbnail`），而非冒号（`media:thumbnail`）

2. **日期格式**: feedparser 返回 `time.struct_time`，需要转换为 `datetime`

3. **错误处理**: feedparser 使用 `bozo` 标志标记格式问题，而非直接抛出异常

4. **内容编码**: feedparser 自动处理编码，无需手动转换

## 下一步

完成 RSS 端点迁移后，继续：
- [Celery 后台任务系统实现](./13-celery-background-jobs.md)

# RSS 解析模块

本文档详细介绍 `glean_rss` 包如何解析 RSS/Atom 格式的订阅源。

## 技术栈

- **feedparser**: RSS/Atom 解析核心库
- **httpx**: 异步 HTTP 客户端
- **BeautifulSoup + lxml**: HTML 解析，用于 Feed 发现

## 包结构

```
backend/packages/rss/
├── glean_rss/
│   ├── __init__.py      # 导出接口
│   ├── parser.py        # RSS 解析
│   ├── discoverer.py    # Feed 发现与 HTTP 请求
│   ├── opml.py          # OPML 导入导出
│   └── utils.py         # HTML 清理工具
├── tests/
│   ├── test_parser.py
│   └── test_opml.py
└── pyproject.toml
```

## 依赖项

**文件路径**: `backend/packages/rss/pyproject.toml`

```toml
[project]
name = "glean-rss"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    "feedparser>=6.0.0",    # RSS/Atom 解析
    "httpx>=0.27.0",        # 异步 HTTP
    "beautifulsoup4>=4.12.0",  # HTML 解析
    "lxml>=5.1.0",          # XML 解析后端
]
```

## 核心功能

### 1. Feed 解析

**文件路径**: `backend/packages/rss/glean_rss/parser.py`

#### ParsedFeed 类

```python
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import feedparser
from feedparser import FeedParserDict


def _get_favicon_url(site_url: str | None) -> str | None:
    """
    从网站 URL 生成 favicon URL。
    使用 Google Favicon 服务获取图标。
    """
    if not site_url:
        return None

    try:
        parsed = urlparse(site_url)
        if not parsed.scheme or not parsed.netloc:
            return None

        domain = parsed.netloc
        return f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
    except Exception:
        return None


class ParsedFeed:
    """解析后的 Feed 元数据"""

    title: str           # Feed 标题
    description: str     # Feed 描述
    site_url: str        # 网站 URL
    language: str | None # 语言代码
    icon_url: str | None # 图标 URL
    entries: list["ParsedEntry"]  # 条目列表

    def __init__(self, data: FeedParserDict):
        feed_info: dict[str, Any] = dict(data.get("feed", {}))
        self.title = str(feed_info.get("title", ""))
        self.description = str(feed_info.get("description", ""))
        self.site_url = str(feed_info.get("link", ""))
        self.language = feed_info.get("language")

        # 尝试从 feed 获取图标，否则使用 favicon
        icon = feed_info.get("icon") or feed_info.get("logo")
        self.icon_url = str(icon) if icon else _get_favicon_url(self.site_url)

        # 解析所有条目
        entries_data: list[dict[str, Any]] = list(data.get("entries", []))
        self.entries = [ParsedEntry(entry) for entry in entries_data]
```

#### ParsedEntry 类

```python
class ParsedEntry:
    """解析后的条目数据"""

    def __init__(self, data: dict[str, Any]):
        # GUID: 优先使用 id，否则使用 link
        self.guid = data.get("id") or data.get("link", "")
        self.url = data.get("link", "")
        self.title = data.get("title", "")
        self.author = data.get("author")
        self.summary = data.get("summary")

        # 内容: 优先使用 content，否则使用 summary
        content_list = data.get("content", [])
        if content_list:
            self.content = content_list[0].get("value")
        else:
            self.content = data.get("summary")

        # 解析发布时间
        published = data.get("published_parsed") or data.get("updated_parsed")
        if published:
            try:
                # feedparser 返回 time.struct_time，转换为 datetime
                self.published_at = datetime(*published[:6], tzinfo=UTC)
            except (TypeError, ValueError):
                self.published_at = None
        else:
            self.published_at = None
```

#### 解析函数

```python
async def parse_feed(content: str, url: str) -> ParsedFeed:
    """
    解析 RSS/Atom Feed 内容。

    Args:
        content: Feed XML 内容
        url: Feed URL (用于相对链接解析)

    Returns:
        ParsedFeed 对象

    Raises:
        ValueError: 解析失败时
    """
    data = feedparser.parse(content)

    # bozo 标志表示解析出错
    if data.get("bozo", False) and not data.get("entries"):
        raise ValueError(f"Failed to parse feed: {data.get('bozo_exception', 'Unknown error')}")

    return ParsedFeed(data)
```

### 2. Feed 发现与获取

**文件路径**: `backend/packages/rss/glean_rss/discoverer.py`

#### Feed 发现

```python
import httpx
from bs4 import BeautifulSoup

from .parser import parse_feed


async def discover_feed(url: str, timeout: int = 30) -> tuple[str, str]:
    """
    从 URL 发现 RSS Feed。

    策略:
    1. 尝试直接作为 RSS 解析
    2. 若是 HTML 页面，搜索 RSS 链接标签

    Args:
        url: 要发现的 URL
        timeout: 请求超时 (秒)

    Returns:
        (feed_url, feed_title) 元组

    Raises:
        ValueError: 未找到 Feed 或请求失败
    """
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers={"User-Agent": "Glean/1.0"}
    ) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as e:
            raise ValueError(f"Failed to fetch URL: {e}") from e

        content_type = response.headers.get("content-type", "").lower()

        # 尝试直接解析为 RSS
        if "xml" in content_type or "rss" in content_type or "atom" in content_type:
            try:
                feed = await parse_feed(response.text, url)
                return url, str(feed.title)
            except ValueError:
                pass

        # 在 HTML 中搜索 RSS 链接
        if "html" in content_type or not content_type:
            soup = BeautifulSoup(response.content, "lxml")

            # 查找 RSS/Atom link 标签
            feed_links = soup.find_all(
                "link",
                attrs={"type": ["application/rss+xml", "application/atom+xml", "application/xml"]},
            )

            for link in feed_links:
                href = link.get("href")
                if href:
                    feed_url_str = str(href) if not isinstance(href, str) else href

                    # 转换为绝对 URL
                    if not feed_url_str.startswith("http"):
                        from urllib.parse import urljoin
                        feed_url_str = urljoin(url, feed_url_str)

                    # 验证 Feed 可解析
                    try:
                        feed_response = await client.get(feed_url_str)
                        feed_response.raise_for_status()
                        feed = await parse_feed(feed_response.text, feed_url_str)
                        return feed_url_str, str(feed.title)
                    except (httpx.HTTPError, ValueError):
                        continue

        raise ValueError("No RSS feed found at this URL")
```

#### 条件 HTTP 请求

```python
async def fetch_feed(
    url: str, etag: str | None = None, last_modified: str | None = None
) -> tuple[str, dict[str, str] | None] | None:
    """
    带条件请求支持的 Feed 获取。

    使用 ETag 和 Last-Modified 头实现增量更新，
    当服务器返回 304 时表示内容未变更。

    Args:
        url: Feed URL
        etag: 上次请求的 ETag
        last_modified: 上次请求的 Last-Modified

    Returns:
        (content, headers) 若有更新
        None 若返回 304 Not Modified

    Raises:
        ValueError: 请求失败
    """
    headers = {"User-Agent": "Glean/1.0"}

    # 添加条件请求头
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified

    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
        try:
            response = await client.get(url)

            # 304 Not Modified - 内容未变更
            if response.status_code == 304:
                return None

            response.raise_for_status()

            # 提取缓存头供下次使用
            cache_headers = {}
            if "etag" in response.headers:
                cache_headers["etag"] = response.headers["etag"]
            if "last-modified" in response.headers:
                cache_headers["last-modified"] = response.headers["last-modified"]

            return response.text, cache_headers

        except httpx.HTTPError as e:
            raise ValueError(f"Failed to fetch feed: {e}") from e
```

### 3. OPML 导入导出

**文件路径**: `backend/packages/rss/glean_rss/opml.py`

#### OPML 解析

```python
class OPMLFeed:
    """OPML 中的 Feed 项"""
    title: str          # Feed 标题
    xml_url: str        # Feed URL
    html_url: str | None  # 网站 URL
    folder: str | None  # 所属文件夹


def parse_opml_with_folders(content: str) -> OPMLParseResult:
    """
    解析带文件夹结构的 OPML。

    解析策略:
    - 有 xmlUrl 属性的 <outline> 是 Feed
    - 没有 xmlUrl 但有子元素的 <outline> 是文件夹
    - 递归处理嵌套结构

    Returns:
        OPMLParseResult 包含 feeds 列表和 folders 列表
    """
    # 实现详见源码
    ...
```

#### OPML 生成

```python
def generate_opml(
    feeds: list[dict[str, Any]],
    title: str = "Glean Subscriptions"
) -> str:
    """
    从订阅列表生成 OPML XML。

    输入格式:
    {
        "title": str,
        "url": str,
        "site_url": str (可选),
        "folder": str (可选)
    }

    生成的 OPML:
    - 按文件夹分组
    - 无文件夹的 Feed 在顶层
    - 包含 dateCreated 时间戳
    """
    # 实现详见源码
    ...
```

### 4. HTML 工具

**文件路径**: `backend/packages/rss/glean_rss/utils.py`

```python
def strip_html_tags(html: str | None, max_length: int = 300) -> str | None:
    """
    从 HTML 中提取纯文本。

    功能:
    - 移除 <script>, <style>, <img>, <iframe>, <svg> 等标签
    - 规范化空白字符
    - 截断到指定长度并添加省略号
    """
    # 实现详见源码
    ...
```

## 导出接口

**文件路径**: `backend/packages/rss/glean_rss/__init__.py`

```python
__all__ = [
    "parse_feed",              # 解析 RSS/Atom
    "ParsedFeed",              # Feed 数据类
    "ParsedEntry",             # Entry 数据类
    "discover_feed",           # Feed 发现
    "fetch_feed",              # HTTP 获取 (带条件请求)
    "parse_opml",              # OPML 解析 (旧版)
    "parse_opml_with_folders", # OPML 解析 (带文件夹)
    "generate_opml",           # OPML 生成
    "OPMLFeed",               # OPML Feed 类
    "OPMLParseResult",        # OPML 结果类
    "strip_html_tags",        # HTML 清理
]
```

## 使用示例

### 解析 Feed

```python
from glean_rss import fetch_feed, parse_feed

# 获取 Feed 内容
result = await fetch_feed("https://example.com/feed.xml")
if result is None:
    print("Feed 未变更 (304)")
else:
    content, headers = result
    feed = await parse_feed(content, "https://example.com/feed.xml")

    print(f"标题: {feed.title}")
    print(f"描述: {feed.description}")
    print(f"条目数: {len(feed.entries)}")

    for entry in feed.entries:
        print(f"  - {entry.title} ({entry.published_at})")
```

### 发现 Feed

```python
from glean_rss import discover_feed

# 从网站首页发现 RSS
feed_url, feed_title = await discover_feed("https://example.com")
print(f"发现 Feed: {feed_title} at {feed_url}")
```

### 条件请求

```python
from glean_rss import fetch_feed

# 首次请求
result = await fetch_feed("https://example.com/feed.xml")
content, headers = result

# 保存 ETag 和 Last-Modified
etag = headers.get("etag")
last_modified = headers.get("last-modified")

# 后续请求 (增量更新)
result = await fetch_feed(
    "https://example.com/feed.xml",
    etag=etag,
    last_modified=last_modified
)
if result is None:
    print("内容未变更，无需重新解析")
```

## 相关文档

- [系统概述](./01-rss-overview.md)
- [后台任务](./02-rss-worker-tasks.md)
- [数据库模型](./04-rss-database.md)

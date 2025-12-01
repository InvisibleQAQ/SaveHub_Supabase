"""
RSS parsing service.

Uses feedparser library to parse RSS/Atom feeds.
Matches existing Next.js implementation behavior for frontend compatibility.
"""

import feedparser
from uuid import uuid4
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from urllib.parse import urlparse
import hashlib
import logging
import re
from html.parser import HTMLParser

logger = logging.getLogger(__name__)


class HTMLStripper(HTMLParser):
    """Strip HTML tags and decode entities."""

    def __init__(self):
        super().__init__()
        self.reset()
        self.fed = []

    def handle_data(self, data):
        self.fed.append(data)

    def get_data(self):
        return ''.join(self.fed)


def strip_html_tags(html: str) -> str:
    """
    Strip HTML tags and normalize whitespace.

    Args:
        html: HTML string

    Returns:
        Plain text with normalized whitespace
    """
    if not html:
        return ''

    # Use HTMLParser to strip tags
    stripper = HTMLStripper()
    stripper.feed(html)
    text = stripper.get_data()

    # Normalize whitespace (collapse multiple spaces/newlines)
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def extract_thumbnail(entry: Dict[str, Any]) -> Optional[str]:
    """
    Extract thumbnail URL from feed entry.

    Priority (matches TypeScript implementation):
    1. media:thumbnail
    2. media:content
    3. enclosure (image/* type)

    Args:
        entry: feedparser parsed entry object

    Returns:
        Thumbnail URL or None
    """
    # 1. Check media:thumbnail
    if 'media_thumbnail' in entry:
        thumbs = entry.get('media_thumbnail', [])
        if thumbs and len(thumbs) > 0:
            return thumbs[0].get('url')

    # 2. Check media:content
    if 'media_content' in entry:
        contents = entry.get('media_content', [])
        if contents and len(contents) > 0:
            url = contents[0].get('url')
            if url:
                return url

    # 3. Check enclosure
    if 'enclosures' in entry:
        for enc in entry.get('enclosures', []):
            enc_type = enc.get('type', '')
            if enc_type.startswith('image/'):
                return enc.get('href') or enc.get('url')

    # 4. Check links with enclosure rel
    for link in entry.get('links', []):
        if link.get('rel') == 'enclosure':
            link_type = link.get('type', '')
            if link_type.startswith('image/'):
                return link.get('href')

    return None


def parse_published_date(entry: Dict[str, Any]) -> datetime:
    """
    Parse published date with multiple fallbacks.

    Args:
        entry: feedparser parsed entry object

    Returns:
        Published datetime object
    """
    # Try published_parsed
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        except (TypeError, ValueError):
            pass

    # Try updated_parsed
    if hasattr(entry, 'updated_parsed') and entry.updated_parsed:
        try:
            return datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
        except (TypeError, ValueError):
            pass

    # Fallback to current time
    return datetime.now(timezone.utc)


def extract_content(entry: Dict[str, Any]) -> str:
    """
    Extract article content.

    Priority:
    1. content field
    2. description field
    3. summary field

    Args:
        entry: feedparser parsed entry object

    Returns:
        Article content string
    """
    # Check content field (may be a list)
    if 'content' in entry and entry['content']:
        contents = entry['content']
        if isinstance(contents, list) and len(contents) > 0:
            return contents[0].get('value', '')
        elif isinstance(contents, str):
            return contents

    # Fallback to description
    if 'description' in entry and entry['description']:
        return entry['description']

    # Fallback to summary
    if 'summary' in entry and entry['summary']:
        return entry['summary']

    return ''


def truncate_summary(text: str, max_length: int = 200) -> str:
    """
    Truncate summary text.

    Args:
        text: Original text
        max_length: Maximum length (default 200)

    Returns:
        Truncated text (with ellipsis if exceeded)
    """
    if not text:
        return ''
    if len(text) <= max_length:
        return text
    return text[:max_length] + '...'


def compute_content_hash(title: str, content: str) -> str:
    """
    Compute content hash for deduplication.

    Args:
        title: Article title
        content: Article content

    Returns:
        SHA-256 hash value
    """
    combined = f"{title}{content}"
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


def parse_rss_feed(url: str, feed_id: str) -> Dict[str, Any]:
    """
    Parse RSS feed and extract articles.

    Args:
        url: RSS feed URL
        feed_id: Feed ID (for associating articles)

    Returns:
        Dict with 'feed' (metadata) and 'articles' (list)

    Raises:
        ValueError: When feed is invalid or parsing fails
    """
    logger.info(f"Parsing RSS feed: {url}")

    # Parse feed
    parsed = feedparser.parse(url)

    # Check for parse errors
    if parsed.bozo and not parsed.entries:
        error_msg = str(parsed.bozo_exception) if hasattr(parsed, 'bozo_exception') else 'Unknown error'
        logger.error(f"Feed parse error: {error_msg}")
        raise ValueError(f"Invalid RSS feed: {error_msg}")

    # Extract feed metadata
    hostname = urlparse(url).hostname or 'Unknown'
    feed_info = {
        'title': parsed.feed.get('title', hostname),
        'description': parsed.feed.get('description', ''),
        'link': parsed.feed.get('link', url),
        'image': None,
    }

    # Extract feed image
    if 'image' in parsed.feed:
        feed_info['image'] = parsed.feed.image.get('href')

    # Parse articles
    articles = []
    for entry in parsed.entries:
        content = extract_content(entry)
        summary_text = strip_html_tags(
            entry.get('summary', '') or entry.get('description', '')
        )

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
    return {'feed': feed_info, 'articles': articles}

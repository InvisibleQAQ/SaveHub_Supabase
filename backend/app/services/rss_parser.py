"""RSS feed parser service using feedparser library."""

import re
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import feedparser


def parse_rss_feed(url: str, feed_id: str) -> dict:
    """
    Parse RSS feed and return feed metadata and articles.

    Args:
        url: RSS feed URL
        feed_id: UUID of the feed in database

    Returns:
        dict with 'feed' metadata and 'articles' list

    Raises:
        ValueError: If feed cannot be parsed
    """
    parsed = feedparser.parse(url)

    # Check for parse errors
    if parsed.bozo and not parsed.entries:
        error_msg = str(parsed.bozo_exception) if parsed.bozo_exception else "Unknown parse error"
        raise ValueError(f"Failed to parse RSS feed: {error_msg}")

    hostname = urlparse(url).hostname or "Unknown"

    # Extract feed metadata
    feed = {
        "title": parsed.feed.get("title", hostname),
        "description": parsed.feed.get("description", ""),
        "link": parsed.feed.get("link", url),
        "image": _extract_feed_image(parsed.feed)
    }

    # Extract articles
    articles = [_parse_article(item, feed_id) for item in parsed.entries]

    return {"feed": feed, "articles": articles}


def _extract_feed_image(feed) -> Optional[str]:
    """Extract feed image URL."""
    if hasattr(feed, 'image') and feed.image:
        if isinstance(feed.image, dict):
            return feed.image.get('href') or feed.image.get('url')
        # feedparser may return FeedParserDict
        if hasattr(feed.image, 'href'):
            return feed.image.href
        if hasattr(feed.image, 'url'):
            return feed.image.url
    return None


def _extract_thumbnail(item) -> Optional[str]:
    """
    Extract thumbnail URL with priority:
    1. media:thumbnail
    2. media:content (if image)
    3. enclosure (if image)
    """
    # 1. media:thumbnail
    if hasattr(item, 'media_thumbnail') and item.media_thumbnail:
        thumbs = item.media_thumbnail
        if isinstance(thumbs, list) and thumbs:
            return thumbs[0].get('url')

    # 2. media:content
    if hasattr(item, 'media_content') and item.media_content:
        for media in item.media_content:
            medium = media.get('medium', '')
            media_type = media.get('type', '')
            if medium == 'image' or media_type.startswith('image/'):
                return media.get('url')

    # 3. enclosure (if image type)
    if hasattr(item, 'enclosures') and item.enclosures:
        for enc in item.enclosures:
            enc_type = enc.get('type', '')
            if enc_type.startswith('image/'):
                return enc.get('href') or enc.get('url')

    return None


def _extract_content(item) -> str:
    """
    Extract article content with priority:
    1. content
    2. description
    3. summary
    """
    # 1. content (may be a list)
    if hasattr(item, 'content') and item.content:
        if isinstance(item.content, list) and item.content:
            return item.content[0].get('value', '')

    # 2. description
    if hasattr(item, 'description') and item.description:
        return item.description

    # 3. summary
    if hasattr(item, 'summary') and item.summary:
        return item.summary

    return ''


def _generate_summary(content: str, max_length: int = 200) -> str:
    """
    Generate summary by stripping HTML and truncating.

    Args:
        content: HTML content
        max_length: Maximum summary length (default 200)

    Returns:
        Plain text summary
    """
    # Strip HTML tags
    text = re.sub(r'<[^>]+>', '', content)
    # Normalize whitespace
    text = ' '.join(text.split())
    # Truncate with ellipsis
    if len(text) > max_length:
        return text[:max_length] + '...'
    return text


def _parse_date(item) -> datetime:
    """
    Parse article publish date.
    Falls back to current time if no date found.
    """
    # Try published_parsed first
    if hasattr(item, 'published_parsed') and item.published_parsed:
        try:
            return datetime(*item.published_parsed[:6])
        except (TypeError, ValueError):
            pass

    # Try updated_parsed
    if hasattr(item, 'updated_parsed') and item.updated_parsed:
        try:
            return datetime(*item.updated_parsed[:6])
        except (TypeError, ValueError):
            pass

    # Fallback to current time
    return datetime.utcnow()


def _parse_article(item, feed_id: str) -> dict:
    """
    Parse a single RSS item into article dict.

    Args:
        item: feedparser entry
        feed_id: Parent feed UUID

    Returns:
        Article dict matching ParsedArticle schema
    """
    content = _extract_content(item)

    # Extract author (try multiple fields)
    author = None
    if hasattr(item, 'author') and item.author:
        author = item.author
    elif hasattr(item, 'creator') and item.creator:
        author = item.creator
    elif item.get('author'):
        author = item.get('author')
    elif item.get('dc_creator'):
        author = item.get('dc_creator')

    return {
        "id": str(uuid.uuid4()),
        "feedId": feed_id,
        "title": item.get('title', 'Untitled'),
        "content": content,
        "summary": _generate_summary(content),
        "url": item.get('link', ''),
        "author": author,
        "publishedAt": _parse_date(item),
        "isRead": False,
        "isStarred": False,
        "thumbnail": _extract_thumbnail(item)
    }

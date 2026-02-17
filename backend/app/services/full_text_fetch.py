"""
Full text fetch service using readability-lxml.

Fetches original article URL and extracts readable content.
No SSRF protection in this phase (deferred).
"""

import logging
import re
from html import unescape

import httpx
from readability import Document

logger = logging.getLogger(__name__)


class FullTextFetchError(Exception):
    """Error during full text fetch with HTTP status code mapping."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MB limit for fetched HTML

ALLOWED_CONTENT_TYPES = {"text/html", "application/xhtml+xml", "application/xml", "text/xml"}


def has_meaningful_extracted_text(html_content: str) -> bool:
    """Return whether extracted HTML contains readable text content."""
    if not html_content:
        return False

    text_content = re.sub(
        r"<(script|style|noscript)\b[^>]*>.*?</\1>",
        " ",
        html_content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    text_content = re.sub(r"<[^>]+>", " ", text_content)
    text_content = unescape(text_content)
    text_content = re.sub(r"\s+", " ", text_content).strip()

    return bool(text_content)


async def fetch_full_content_html(url: str, timeout_seconds: float = 30.0) -> str:
    """
    Fetch and extract readable content from a URL.

    1. HTTP GET with timeout and redirect following
    2. Content-Type and size validation
    3. readability-lxml extraction
    4. Return clean HTML (frontend sanitizeHTML handles XSS)

    Args:
        url: Article source URL
        timeout_seconds: Total request timeout

    Returns:
        Extracted HTML string

    Raises:
        FullTextFetchError: With appropriate HTTP status code
    """
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; SaveHub/1.0; +https://github.com/savehub)",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5,zh-CN;q=0.3",
                },
            )
            response.raise_for_status()

    except httpx.TimeoutException:
        logger.warning(f"Timeout fetching {url}")
        raise FullTextFetchError(504, f"Timeout fetching URL (>{timeout_seconds}s)")
    except httpx.HTTPStatusError as e:
        logger.warning(f"HTTP {e.response.status_code} fetching {url}")
        raise FullTextFetchError(502, f"Upstream returned HTTP {e.response.status_code}")
    except httpx.RequestError as e:
        logger.error(f"Request error fetching {url}: {e}")
        raise FullTextFetchError(502, f"Failed to connect: {type(e).__name__}")

    # Validate Content-Type
    content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise FullTextFetchError(422, f"Unsupported Content-Type: {content_type}")

    # Validate response size
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_RESPONSE_BYTES:
                raise FullTextFetchError(422, f"Response too large ({int(content_length)} bytes, max {MAX_RESPONSE_BYTES})")
        except ValueError:
            pass  # Malformed Content-Length header, fall through to body check
    if len(response.content) > MAX_RESPONSE_BYTES:
        raise FullTextFetchError(422, f"Response too large (>{MAX_RESPONSE_BYTES} bytes)")

    try:
        doc = Document(response.text)
        full_content = (doc.summary(html_partial=True) or "").strip()
    except Exception as e:
        logger.error(f"Readability extraction failed for {url}: {e}")
        raise FullTextFetchError(422, f"Content extraction failed: {type(e).__name__}")

    if not full_content:
        raise FullTextFetchError(422, "Extracted content is empty")

    if not has_meaningful_extracted_text(full_content):
        raise FullTextFetchError(422, "Extracted content has no readable text")

    logger.info(f"Extracted {len(full_content)} chars from {url}")
    return full_content

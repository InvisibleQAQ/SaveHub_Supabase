"""
Article image processing Celery task.

Downloads external images, compresses them, uploads to Supabase Storage,
and updates article content with new URLs.
"""

import hashlib
import logging
import socket
import ipaddress
from datetime import datetime, timezone
from typing import Dict, Any, List, Tuple
from urllib.parse import urlparse, unquote

import httpx
from bs4 import BeautifulSoup

from .celery import app
from .supabase_client import get_supabase_service
from app.services.image_compressor import compress_image, get_image_extension

logger = logging.getLogger(__name__)

# =============================================================================
# Constants (aligned with proxy.py)
# =============================================================================

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
DOWNLOAD_TIMEOUT = 15  # seconds
ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/svg+xml", "image/avif", "image/bmp",
}
BUCKET_NAME = "article-images"


# =============================================================================
# Errors
# =============================================================================

class ImageProcessingError(Exception):
    """Base error for image processing."""
    pass


class RetryableImageError(ImageProcessingError):
    """Retryable error (network issues)."""
    pass


class NonRetryableImageError(ImageProcessingError):
    """Non-retryable error (invalid image, SSRF blocked)."""
    pass


# =============================================================================
# Core Logic (decoupled from Celery for testing)
# =============================================================================

def is_private_ip(hostname: str) -> bool:
    """Check if hostname resolves to private IP (SSRF protection)."""
    try:
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved
    except socket.gaierror:
        return False


def download_image(url: str) -> Tuple[bytes, str]:
    """
    Download image from URL.

    Args:
        url: Image URL

    Returns:
        Tuple of (image_bytes, content_type)

    Raises:
        RetryableImageError: Network issues
        NonRetryableImageError: Invalid URL, SSRF blocked, wrong content type
    """
    decoded_url = unquote(url)
    parsed = urlparse(decoded_url)

    # Validate URL
    if parsed.scheme not in ("http", "https"):
        raise NonRetryableImageError(f"Invalid scheme: {parsed.scheme}")

    hostname = parsed.netloc.split(":")[0]
    if not hostname:
        raise NonRetryableImageError("Missing hostname")

    # SSRF protection
    if is_private_ip(hostname):
        raise NonRetryableImageError(f"Private IP blocked: {hostname}")

    try:
        with httpx.Client(
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = client.get(
                decoded_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": f"{parsed.scheme}://{parsed.netloc}/",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )

            if response.status_code != 200:
                if response.status_code in (502, 503, 504, 429):
                    raise RetryableImageError(f"HTTP {response.status_code}")
                raise NonRetryableImageError(f"HTTP {response.status_code}")

            # Validate content type
            content_type = response.headers.get("content-type", "").split(";")[0].strip()
            if content_type not in ALLOWED_CONTENT_TYPES:
                if not content_type.startswith("image/"):
                    raise NonRetryableImageError(f"Invalid content type: {content_type}")

            content = response.content
            if len(content) > MAX_IMAGE_SIZE:
                raise NonRetryableImageError("Image too large (>10MB)")

            return content, content_type

    except httpx.TimeoutException:
        raise RetryableImageError("Download timeout")
    except httpx.ConnectError as e:
        raise RetryableImageError(f"Connection error: {e}")
    except (RetryableImageError, NonRetryableImageError):
        raise
    except Exception as e:
        raise NonRetryableImageError(f"Download failed: {e}")


def upload_to_storage(
    image_bytes: bytes,
    user_id: str,
    article_id: str,
    extension: str,
) -> str:
    """
    Upload image to Supabase Storage.

    Args:
        image_bytes: Image content
        user_id: User ID
        article_id: Article ID
        extension: File extension (e.g., "webp")

    Returns:
        Public URL of uploaded image
    """
    supabase = get_supabase_service()

    # Generate hash for filename
    image_hash = hashlib.md5(image_bytes).hexdigest()[:12]  # First 12 chars
    path = f"{user_id}/{article_id}/{image_hash}.{extension}"

    # Content type mapping
    content_types = {
        "webp": "image/webp",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
    }
    content_type = content_types.get(extension, "application/octet-stream")

    # Upload (upsert mode)
    try:
        supabase.storage.from_(BUCKET_NAME).upload(
            path=path,
            file=image_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        logger.debug(f"Uploaded image to storage: {path}")
    except Exception as e:
        logger.error(f"Storage upload failed for {path}: {e}")
        raise

    # Get public URL
    base_url = supabase.storage.from_(BUCKET_NAME).get_public_url(path)

    return base_url


def extract_and_process_images(
    content: str,
    user_id: str,
    article_id: str,
) -> Tuple[str, int, int]:
    """
    Extract images from HTML, process them, and update content.

    Args:
        content: HTML content
        user_id: User ID
        article_id: Article ID

    Returns:
        Tuple of (updated_content, success_count, total_count)
    """
    soup = BeautifulSoup(content, "html.parser")
    img_tags = soup.find_all("img", src=True)

    total = len(img_tags)
    success = 0

    for img in img_tags:
        original_url = img["src"]

        # Skip data URLs and already-processed URLs
        if original_url.startswith("data:"):
            continue
        if "supabase.co/storage" in original_url:
            success += 1  # Already processed
            continue

        try:
            # Download
            image_bytes, content_type = download_image(original_url)

            # Compress
            try:
                compressed, ext = compress_image(image_bytes)
            except ValueError as e:
                # Compression failed, use original with original extension
                logger.warning(f"Compression failed for {original_url[:100]}: {e}")
                compressed = image_bytes
                ext = get_image_extension(content_type) or "jpg"

            # Upload
            new_url = upload_to_storage(compressed, user_id, article_id, ext)

            # Replace URL
            img["src"] = new_url
            success += 1

            logger.debug(f"Processed image: {original_url[:80]} -> {new_url}")

        except NonRetryableImageError as e:
            logger.warning(f"Skipping image {original_url[:100]}: {e}")
            # Keep original URL
        except RetryableImageError as e:
            logger.warning(f"Retryable error for {original_url[:100]}: {e}")
            # Keep original URL for now, don't propagate to allow other images to process

    return str(soup), success, total


def do_process_article_images(article_id: str) -> Dict[str, Any]:
    """
    Core article image processing logic.

    Args:
        article_id: Article UUID

    Returns:
        {"success": bool, "processed": int, "total": int}

    Raises:
        NonRetryableImageError: For invalid article
    """
    supabase = get_supabase_service()

    # Fetch article
    result = supabase.table("articles").select(
        "id, user_id, content, images_processed"
    ).eq("id", article_id).single().execute()

    if not result.data:
        raise NonRetryableImageError(f"Article not found: {article_id}")

    article = result.data

    # Skip if already processed
    if article.get("images_processed") is not None:
        logger.info(f"Article {article_id} already processed, skipping")
        return {"success": True, "processed": 0, "total": 0, "skipped": True}

    content = article.get("content", "")
    user_id = article["user_id"]

    if not content:
        # No content, mark as processed
        supabase.table("articles").update({
            "images_processed": True,
            "images_processed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", article_id).execute()
        return {"success": True, "processed": 0, "total": 0}

    # Process images
    new_content, success_count, total_count = extract_and_process_images(
        content, user_id, article_id
    )

    # Determine status
    # true = at least one success or no images to process
    # false = all failed (total > 0 and success == 0)
    if total_count == 0:
        images_processed = True
    else:
        images_processed = success_count > 0

    # Update article
    supabase.table("articles").update({
        "content": new_content,
        "images_processed": images_processed,
        "images_processed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", article_id).execute()

    return {
        "success": images_processed,
        "processed": success_count,
        "total": total_count,
    }


# =============================================================================
# Celery Task
# =============================================================================

@app.task(
    bind=True,
    name="process_article_images",
    max_retries=2,
    default_retry_delay=30,
    retry_backoff=True,
    retry_backoff_max=120,
    retry_jitter=True,
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=180,       # Hard timeout 3 minutes
    soft_time_limit=150,  # Soft timeout 2.5 minutes
)
def process_article_images(
    self,
    article_id: str,
):
    """
    Process images in a single article.

    Downloads external images, compresses to WebP, uploads to Storage,
    and updates article content with new URLs.

    Args:
        article_id: Article UUID
    """
    task_id = self.request.id
    attempt = self.request.retries + 1
    max_attempts = self.max_retries + 1

    logger.info(
        f"Processing article images: attempt={attempt}/{max_attempts}",
        extra={
            "task_id": task_id,
            "article_id": article_id,
        }
    )

    start_time = datetime.now(timezone.utc)

    try:
        result = do_process_article_images(article_id)

        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

        logger.info(
            f"Completed: processed={result['processed']}/{result['total']}",
            extra={
                "task_id": task_id,
                "article_id": article_id,
                "success": str(result["success"]).lower(),
                "processed_count": result["processed"],
                "total_count": result["total"],
                "duration_ms": duration_ms,
            }
        )

        return {
            "success": True,
            "article_id": article_id,
            **result,
            "duration_ms": duration_ms,
        }

    except NonRetryableImageError as e:
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.error(
            f"Non-retryable error: {e}",
            extra={
                "task_id": task_id,
                "article_id": article_id,
                "error": str(e),
                "duration_ms": duration_ms,
            }
        )
        return {
            "success": False,
            "article_id": article_id,
            "error": str(e),
            "duration_ms": duration_ms,
        }

    except Exception as e:
        # Don't raise - return failure result to allow chord callback to execute
        duration_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        logger.exception(
            f"Unexpected error: {e}",
            extra={
                "task_id": task_id,
                "article_id": article_id,
                "error": str(e),
                "duration_ms": duration_ms,
            }
        )
        return {
            "success": False,
            "article_id": article_id,
            "error": str(e),
            "duration_ms": duration_ms,
        }


# =============================================================================
# Batch Scheduling (called after refresh_feed)
# =============================================================================

@app.task(name="schedule_image_processing")
def schedule_image_processing(article_ids: List[str], feed_id: str = None):
    """
    Schedule image processing for multiple articles using Celery chord.

    After all image processing tasks complete, automatically triggers
    RAG processing via the on_images_complete callback.

    Args:
        article_ids: List of article UUIDs
        feed_id: Feed ID (for logging and traceability)
    """
    from celery import chord, group

    if not article_ids:
        logger.info("No articles to process")
        return {"scheduled": 0}

    logger.info(f"[CHORD_DEBUG] Creating chord for {len(article_ids)} articles, feed_id={feed_id}")

    try:
        # Build parallel task group
        image_tasks = group(
            process_article_images.s(article_id=aid)
            for aid in article_ids
        )

        # Import callback task
        from .rag_processor import on_images_complete

        # Create callback signature
        callback = on_images_complete.s(article_ids=article_ids, feed_id=feed_id)
        logger.info(f"[CHORD_DEBUG] Callback task name: {callback.task}")

        # Use chord: all image tasks complete -> trigger RAG callback
        workflow = chord(image_tasks)(callback)

        logger.info(
            f"[CHORD_DEBUG] Chord created successfully: "
            f"{len(article_ids)} image tasks -> {callback.task} "
            f"(feed_id={feed_id}, chord_id={workflow.id})"
        )
        return {"scheduled": len(article_ids), "chord_id": workflow.id}

    except Exception as e:
        logger.exception(f"[CHORD_DEBUG] Failed to create chord: {e}")
        raise

"""
Image Proxy Router

Proxies image requests to bypass CORS and hotlink protection.
"""

import logging
import socket
import ipaddress
from urllib.parse import urlparse, unquote

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/proxy", tags=["proxy"])
logger = logging.getLogger(__name__)

# Constants
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
TIMEOUT = 15  # seconds
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/x-icon",
    "image/bmp",
    "image/tiff",
    "image/avif",
}


def is_private_ip(hostname: str) -> bool:
    """Check if hostname resolves to private IP (SSRF protection)."""
    try:
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved
    except socket.gaierror:
        return False


@router.get("/image")
async def proxy_image(
    url: str = Query(..., description="Original image URL (URL encoded)"),
):
    """
    Proxy image requests to bypass CORS and hotlink protection.

    - Validates URL and blocks private IPs (SSRF protection)
    - Sets User-Agent and Referer headers to bypass hotlink protection
    - Validates Content-Type to ensure only images are returned
    - Returns proxied image with 24h browser cache

    Args:
        url: Original image URL (must be URL encoded)

    Returns:
        Proxied image response with correct Content-Type
    """
    # 1. Decode and validate URL
    decoded_url = unquote(url)
    parsed = urlparse(decoded_url)

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP(S) URLs allowed")

    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL: missing hostname")

    # 2. SSRF protection - block private IPs
    if is_private_ip(parsed.netloc.split(":")[0]):
        logger.warning(f"SSRF attempt blocked: {decoded_url[:100]}")
        raise HTTPException(status_code=403, detail="Private IPs not allowed")

    # 3. Fetch image with spoofed headers
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            response = await client.get(
                decoded_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Referer": f"{parsed.scheme}://{parsed.netloc}/",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )

            if response.status_code != 200:
                logger.warning(
                    f"Image proxy failed: {response.status_code} for {decoded_url[:100]}"
                )
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Upstream returned {response.status_code}",
                )

            # 4. Validate Content-Type
            content_type = response.headers.get("content-type", "").split(";")[0].strip()
            if content_type not in ALLOWED_CONTENT_TYPES:
                # Some servers return wrong content-type, try to be lenient
                if not content_type.startswith("image/"):
                    logger.warning(
                        f"Invalid content type: {content_type} for {decoded_url[:100]}"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid content type: {content_type}",
                    )

            # 5. Check size
            content_length = int(response.headers.get("content-length", 0))
            if content_length > MAX_IMAGE_SIZE:
                raise HTTPException(status_code=413, detail="Image too large (>10MB)")

            # Also check actual content size for chunked responses
            content = response.content
            if len(content) > MAX_IMAGE_SIZE:
                raise HTTPException(status_code=413, detail="Image too large (>10MB)")

            # 6. Return proxied response with cache headers
            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",  # 24h browser cache
                    "X-Proxy-Source": parsed.netloc,
                },
            )

    except httpx.TimeoutException:
        logger.warning(f"Image proxy timeout: {decoded_url[:100]}")
        raise HTTPException(status_code=504, detail="Upstream timeout")
    except httpx.ConnectError as e:
        logger.warning(f"Image proxy connect error: {decoded_url[:100]} - {e}")
        raise HTTPException(status_code=502, detail="Cannot connect to upstream")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image proxy unexpected error: {decoded_url[:100]} - {e}")
        raise HTTPException(status_code=500, detail="Internal proxy error")

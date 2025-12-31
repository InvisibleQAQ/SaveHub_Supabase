"""
Image compression service using Pillow.

Converts images to WebP format with size constraints for optimal storage.
"""

import io
import logging
from typing import Tuple, Optional

from PIL import Image

logger = logging.getLogger(__name__)

# Constants
MAX_DIMENSION = 1080  # Max width or height (optimized for mobile)
WEBP_QUALITY = 70     # WebP quality (0-100, balanced compression)


def compress_image(
    image_bytes: bytes,
    max_dimension: int = MAX_DIMENSION,
    quality: int = WEBP_QUALITY,
) -> Tuple[bytes, str]:
    """
    Compress image to WebP format.

    Args:
        image_bytes: Original image bytes
        max_dimension: Maximum width or height
        quality: WebP quality (0-100)

    Returns:
        Tuple of (compressed_bytes, extension)
        Extension is always "webp"

    Raises:
        ValueError: If image cannot be processed
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Cannot open image: {e}")

    # Convert RGBA/P to RGB for WebP compatibility
    if img.mode in ("RGBA", "P"):
        # Create white background for transparency
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[3])  # Use alpha channel as mask
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize if too large
    width, height = img.size
    if width > max_dimension or height > max_dimension:
        ratio = min(max_dimension / width, max_dimension / height)
        new_size = (int(width * ratio), int(height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
        logger.debug(f"Resized image from {width}x{height} to {new_size}")

    # Compress to WebP
    output = io.BytesIO()
    img.save(output, format="WEBP", quality=quality, method=4)

    compressed = output.getvalue()

    # Log compression ratio
    original_size = len(image_bytes)
    compressed_size = len(compressed)
    if original_size > 0:
        ratio = (1 - compressed_size / original_size) * 100
        logger.debug(
            f"Compressed {original_size} -> {compressed_size} bytes ({ratio:.1f}% reduction)"
        )

    return compressed, "webp"


def get_image_extension(content_type: str) -> Optional[str]:
    """
    Get file extension from content-type.

    Used as fallback when compression fails.
    """
    mapping = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "image/avif": "avif",
        "image/bmp": "bmp",
    }
    return mapping.get(content_type.lower())

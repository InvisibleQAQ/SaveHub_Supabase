"""
AES-256-GCM encryption service for API keys and sensitive data.

Ported from frontend/lib/encryption.ts to ensure compatibility.
Uses PBKDF2 key derivation + AES-GCM encryption.

IMPORTANT: Must use identical parameters to frontend for cross-compatibility:
- Salt: 'rssreader-salt' (fixed)
- Iterations: 100000
- IV: 12 bytes (random)
- Format: base64(iv + ciphertext)
"""

import os
import base64
import logging
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

logger = logging.getLogger(__name__)

# Must match frontend encryption.ts
SALT = b"rssreader-salt"
ITERATIONS = 100000
KEY_LENGTH = 32  # 256 bits


def _get_encryption_secret() -> str:
    """Get encryption secret from environment variable."""
    secret = os.getenv("ENCRYPTION_SECRET")
    if not secret:
        raise ValueError(
            "ENCRYPTION_SECRET is not set. Generate one with: openssl rand -base64 32"
        )
    if len(secret) < 32:
        raise ValueError("ENCRYPTION_SECRET must be at least 32 characters")
    return secret


def _derive_key(secret: str) -> bytes:
    """
    Derive a 256-bit AES key using PBKDF2.

    Must match frontend deriveKey() function:
    - Uses first 32 bytes of secret as key material
    - Fixed salt 'rssreader-salt'
    - 100000 iterations
    - SHA-256 hash
    """
    # Use first 32 bytes of secret (matching frontend keyMaterial.slice(0, 32))
    key_material = secret.encode("utf-8")[:32]

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LENGTH,
        salt=SALT,
        iterations=ITERATIONS,
    )
    return kdf.derive(key_material)


def encrypt(plaintext: str) -> str:
    """
    Encrypt a plaintext string using AES-256-GCM.

    Args:
        plaintext: The string to encrypt

    Returns:
        Base64-encoded string containing iv + ciphertext

    Note:
        Format is compatible with frontend decrypt() function.
    """
    if not plaintext:
        return ""

    try:
        secret = _get_encryption_secret()
        key = _derive_key(secret)
        aesgcm = AESGCM(key)

        # Generate 12-byte random IV (96 bits for GCM)
        iv = os.urandom(12)

        # Encrypt
        ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)

        # Combine IV + ciphertext and encode as base64
        combined = iv + ciphertext
        encrypted = base64.b64encode(combined).decode("utf-8")

        logger.debug(
            "Data encrypted",
            extra={
                "plaintext_length": len(plaintext),
                "encrypted_length": len(encrypted),
            },
        )
        return encrypted

    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise ValueError("Encryption failed") from e


def decrypt(encrypted_data: str) -> str:
    """
    Decrypt a base64-encoded encrypted string.

    Args:
        encrypted_data: Base64-encoded string containing iv + ciphertext

    Returns:
        Decrypted plaintext string

    Note:
        Format is compatible with frontend encrypt() function.
    """
    if not encrypted_data:
        return ""

    try:
        secret = _get_encryption_secret()
        key = _derive_key(secret)
        aesgcm = AESGCM(key)

        # Decode base64
        combined = base64.b64decode(encrypted_data)

        # Extract IV (first 12 bytes) and ciphertext (rest)
        iv = combined[:12]
        ciphertext = combined[12:]

        # Decrypt
        plaintext = aesgcm.decrypt(iv, ciphertext, None)

        logger.debug(
            "Data decrypted",
            extra={
                "encrypted_length": len(encrypted_data),
                "decrypted_length": len(plaintext),
            },
        )
        return plaintext.decode("utf-8")

    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise ValueError("Decryption failed") from e


def is_encrypted(data: str) -> bool:
    """
    Check if a string appears to be encrypted (base64 format check).

    Args:
        data: String to check

    Returns:
        True if data appears to be encrypted
    """
    if not data:
        return False

    try:
        decoded = base64.b64decode(data)
        # Must be at least IV length (12 bytes) + some ciphertext
        return len(decoded) > 12
    except Exception:
        return False

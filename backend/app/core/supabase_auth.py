"""Utilities for stable Supabase auth client creation."""

import os
from contextlib import contextmanager
from typing import Iterator

import httpx
from supabase import Client, ClientOptions, create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]

AUTH_TIMEOUT_SECONDS = float(
    os.environ.get("SUPABASE_AUTH_TIMEOUT", os.environ.get("HTTPX_TIMEOUT", "30"))
)
AUTH_POOL_TIMEOUT_SECONDS = float(os.environ.get("SUPABASE_AUTH_POOL_TIMEOUT", "10"))
AUTH_MAX_CONNECTIONS = int(os.environ.get("SUPABASE_AUTH_MAX_CONNECTIONS", "200"))
AUTH_MAX_KEEPALIVE_CONNECTIONS = int(
    os.environ.get("SUPABASE_AUTH_MAX_KEEPALIVE_CONNECTIONS", "50")
)
AUTH_KEEPALIVE_EXPIRY_SECONDS = float(
    os.environ.get("SUPABASE_AUTH_KEEPALIVE_EXPIRY", "30")
)


def _build_httpx_client() -> httpx.Client:
    timeout = httpx.Timeout(
        timeout=AUTH_TIMEOUT_SECONDS,
        pool=AUTH_POOL_TIMEOUT_SECONDS,
    )
    limits = httpx.Limits(
        max_connections=AUTH_MAX_CONNECTIONS,
        max_keepalive_connections=AUTH_MAX_KEEPALIVE_CONNECTIONS,
        keepalive_expiry=AUTH_KEEPALIVE_EXPIRY_SECONDS,
    )
    return httpx.Client(timeout=timeout, limits=limits)


@contextmanager
def supabase_auth_client() -> Iterator[Client]:
    """Create a short-lived Supabase client for auth operations."""
    http_client = _build_httpx_client()
    options = ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        httpx_client=http_client,
    )
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY, options=options)

    try:
        yield client
    finally:
        http_client.close()


def is_network_error(error: Exception) -> bool:
    """Check whether an auth exception is likely network related."""
    if isinstance(error, httpx.TimeoutException):
        return True
    if isinstance(error, httpx.NetworkError):
        return True

    error_str = str(error).lower()
    patterns = ["ssl", "handshake", "timed out", "timeout", "connection", "pool"]
    return any(pattern in error_str for pattern in patterns)


"""
Supabase client singleton for Celery workers.

Uses lru_cache to ensure only one client instance is created per process,
avoiding connection overhead for each task.
"""

import os
from functools import lru_cache
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_supabase_service() -> Client:
    """
    Get Service Role client (bypasses RLS).

    Uses lru_cache to ensure only one instance is created per process.
    This is suitable for Celery workers that run as long-lived processes.

    Returns:
        Supabase Client instance with service role privileges
    """
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def get_supabase_user(access_token: str) -> Client:
    """
    Get user-level client (respects RLS).

    Creates a new instance each time because tokens differ per user.

    Args:
        access_token: User's JWT access token

    Returns:
        Supabase Client instance with user privileges
    """
    url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    client = create_client(url, anon_key)
    client.postgrest.auth(access_token)
    return client

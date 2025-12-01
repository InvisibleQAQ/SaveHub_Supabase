"""
Supabase 客户端配置

提供两种客户端：
1. get_supabase_client(access_token) - 用于 API 请求（RLS 生效）
2. get_service_client() - 用于后台任务（绕过 RLS）
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def get_supabase_client(access_token: str | None = None) -> Client:
    """
    获取 Supabase 客户端

    Args:
        access_token: 用户的 JWT token（可选）

    Returns:
        Supabase Client 实例

    Usage:
        - 带 access_token: 用于 API 请求（RLS 生效）
        - 不带 token: 使用 anon key
    """
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    if access_token:
        client.postgrest.auth(access_token)
    return client


def get_service_client() -> Client:
    """
    获取 Service Role 客户端（绕过 RLS）

    仅用于后台任务（Celery workers）等需要绕过 RLS 的场景。

    Returns:
        Supabase Client 实例（Service Role）
    """
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

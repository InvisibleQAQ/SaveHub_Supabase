"""
OpenRank API service for fetching repository influence metrics.

API: https://oss.open-digger.cn/github/{owner}/{repo}/openrank.json
Response: {"2024Q1": 1.23, "2024Q2": 1.45, ...}
"""

import logging
import asyncio
from typing import Dict, List

import httpx

logger = logging.getLogger(__name__)

OPENRANK_API_BASE = "https://oss.open-digger.cn/github"


async def fetch_openrank(
    client: httpx.AsyncClient,
    full_name: str
) -> float | None:
    """
    Fetch OpenRank value for a single repository.

    Args:
        client: HTTP client instance
        full_name: Repository full name (owner/repo)

    Returns:
        Latest quarter's OpenRank value, or None if unavailable
    """
    try:
        url = f"{OPENRANK_API_BASE}/{full_name}/openrank.json"
        response = await client.get(url, timeout=10.0)

        if response.status_code != 200:
            return None

        data = response.json()
        if not data or not isinstance(data, dict):
            return None

        # Get latest quarter (keys are like "2024Q1", "2024Q2")
        # Sort by key to get chronologically latest
        sorted_quarters = sorted(data.keys())
        if not sorted_quarters:
            return None

        latest_quarter = sorted_quarters[-1]
        value = data[latest_quarter]

        return float(value) if value is not None else None

    except Exception as e:
        logger.debug(f"Failed to fetch OpenRank for {full_name}: {e}")
        return None


async def fetch_all_openranks(
    repos: List[dict],
    concurrency: int = 5
) -> Dict[int, float]:
    """
    Fetch OpenRank values for all repositories with concurrency control.

    Args:
        repos: List of repo dicts with github_id and full_name
        concurrency: Max concurrent requests (default 5)

    Returns:
        {github_id: openrank_value} mapping (only successful fetches)
    """
    semaphore = asyncio.Semaphore(concurrency)
    results: Dict[int, float] = {}

    async def fetch_one(client: httpx.AsyncClient, repo: dict):
        async with semaphore:
            github_id = repo.get("github_id")
            full_name = repo.get("full_name")

            if not github_id or not full_name:
                return

            value = await fetch_openrank(client, full_name)
            if value is not None:
                results[github_id] = value
            await asyncio.sleep(0.05)  # 50ms delay between requests

    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, repo) for repo in repos]
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(f"Fetched OpenRank for {len(results)}/{len(repos)} repositories")
    return results

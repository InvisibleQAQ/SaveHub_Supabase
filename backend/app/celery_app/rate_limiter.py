"""
Redis-based domain-level request rate limiter.

Fixes:
1. busy loop - sleep briefly when pttl returns <=0
2. race conditions - use Lua script for atomicity
"""

import os
import time
import redis
import random
from urllib.parse import urlparse
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class DomainRateLimiter:
    """Distributed domain rate limiter using Redis."""

    KEY_PREFIX = "ratelimit:domain:"

    # Lua script: atomically check and set rate limit
    # Returns: 0 = can proceed, >0 = milliseconds to wait
    LUA_SCRIPT = """
    local key = KEYS[1]
    local interval_ms = tonumber(ARGV[1])

    local ttl = redis.call('PTTL', key)

    if ttl <= 0 then
        -- Key doesn't exist or expired, set new rate limit
        redis.call('SET', key, '1', 'PX', interval_ms)
        return 0
    else
        -- Need to wait
        return ttl
    end
    """

    def __init__(
        self,
        redis_url: str = None,
        min_interval_ms: int = 1000
    ):
        self.redis = redis.from_url(
            redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )
        self.min_interval_ms = min_interval_ms

        # Register Lua script
        self._check_and_set = self.redis.register_script(self.LUA_SCRIPT)

    def wait_for_domain(self, url: str, max_wait_seconds: float = 30.0) -> float:
        """
        Wait until we can request this domain.

        Args:
            url: Request URL
            max_wait_seconds: Maximum wait time, give up if exceeded

        Returns:
            Actual seconds waited

        Raises:
            TimeoutError: If wait times out
        """
        domain = urlparse(url).hostname or "unknown"
        key = f"{self.KEY_PREFIX}{domain}"

        total_waited = 0.0

        while total_waited < max_wait_seconds:
            # Use Lua script for atomic check
            wait_ms = self._check_and_set(
                keys=[key],
                args=[self.min_interval_ms]
            )

            if wait_ms == 0:
                return total_waited

            # Need to wait
            wait_seconds = wait_ms / 1000.0

            # Add small random jitter to avoid thundering herd
            jitter = random.uniform(0, 0.1)
            actual_wait = min(wait_seconds + jitter, max_wait_seconds - total_waited)

            if actual_wait <= 0:
                break

            time.sleep(actual_wait)
            total_waited += actual_wait

        raise TimeoutError(f"Rate limit timeout for domain: {domain}")


# Global singleton
_rate_limiter: Optional[DomainRateLimiter] = None


def get_rate_limiter() -> DomainRateLimiter:
    """Get the global DomainRateLimiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = DomainRateLimiter()
    return _rate_limiter

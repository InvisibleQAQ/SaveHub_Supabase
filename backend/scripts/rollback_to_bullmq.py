"""
Rollback script to return to BullMQ.

Execute this script after:
1. Stopping Celery Worker
2. Before restarting BullMQ Worker

This script clears all Celery-related Redis keys.
"""

import os
import sys
import redis
from dotenv import load_dotenv

load_dotenv()


def rollback():
    """Clear all Celery queues and locks."""
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    r = redis.from_url(redis_url, decode_responses=True)

    print(f"Connecting to Redis: {redis_url}")

    # Test connection
    try:
        r.ping()
        print("Redis connection OK")
    except Exception as e:
        print(f"Redis connection failed: {e}")
        sys.exit(1)

    # Clear Celery queues
    queues_cleared = 0
    for queue_name in ["default", "high", "celery"]:
        deleted = r.delete(queue_name)
        if deleted:
            print(f"Cleared queue: {queue_name}")
            queues_cleared += 1

    # Clear task locks
    task_locks_cleared = 0
    for key in r.scan_iter("tasklock:*"):
        r.delete(key)
        task_locks_cleared += 1
    if task_locks_cleared:
        print(f"Cleared {task_locks_cleared} task locks")

    # Clear rate limit locks
    rate_limits_cleared = 0
    for key in r.scan_iter("ratelimit:*"):
        r.delete(key)
        rate_limits_cleared += 1
    if rate_limits_cleared:
        print(f"Cleared {rate_limits_cleared} rate limit keys")

    # Clear Celery result backend keys (optional)
    celery_keys_cleared = 0
    for key in r.scan_iter("celery-task-meta-*"):
        r.delete(key)
        celery_keys_cleared += 1
    if celery_keys_cleared:
        print(f"Cleared {celery_keys_cleared} Celery result keys")

    print("\n" + "=" * 50)
    print("Rollback complete!")
    print("=" * 50)
    print("\nNext steps:")
    print("1. Ensure Celery Worker is stopped")
    print("2. Restart BullMQ Worker: cd frontend && pnpm worker:dev")
    print("3. Verify BullMQ is processing tasks")


if __name__ == "__main__":
    print("=" * 50)
    print("BullMQ Rollback Script")
    print("=" * 50)
    print("\nThis will clear all Celery queues and locks.")

    # Confirm before proceeding
    if len(sys.argv) > 1 and sys.argv[1] == "--force":
        rollback()
    else:
        response = input("\nProceed? (y/N): ").strip().lower()
        if response == "y":
            rollback()
        else:
            print("Aborted.")
            sys.exit(0)

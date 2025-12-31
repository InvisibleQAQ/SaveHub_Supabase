"""
Celery application configuration.

Configures the Celery app with Redis broker, JSON serialization,
UTC timezone, and multi-queue support for priority handling.
"""

import os
from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger
from celery.schedules import crontab
from dotenv import load_dotenv

load_dotenv()


@after_setup_logger.connect
@after_setup_task_logger.connect
def setup_celery_logging(logger, *args, **kwargs):
    """Configure Celery worker logging via signal."""
    from app.core.logging_config import setup_logging
    setup_logging()

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "savehub",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.celery_app.tasks",
        "app.celery_app.image_processor",
        "app.celery_app.rag_processor",
    ]
)

app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # Timezone - use UTC for consistency
    timezone="UTC",
    enable_utc=True,

    # Worker configuration
    worker_prefetch_multiplier=1,  # Fair scheduling
    worker_concurrency=5,
    worker_hijack_root_logger=False,  # Don't hijack root logger

    # Task configuration
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,  # Track STARTED state

    # Result expiration
    result_expires=86400,  # 24h

    # Multi-queue configuration (simulates priority)
    task_default_queue="default",
    task_queues={
        "high": {},      # Manual refresh (high priority)
        "default": {},   # Scheduled refresh (normal priority)
    },
    task_routes={
        "app.celery_app.tasks.refresh_feed": {"queue": "default"},
        "process_article_images": {"queue": "default"},
        "schedule_image_processing": {"queue": "default"},
        "process_article_rag": {"queue": "default"},
        "scan_pending_rag_articles": {"queue": "default"},
    },

    # Celery Beat schedule
    beat_schedule={
        "scan-rag-every-30-minutes": {
            "task": "scan_pending_rag_articles",
            "schedule": crontab(minute="*/30"),
        },
    },
)

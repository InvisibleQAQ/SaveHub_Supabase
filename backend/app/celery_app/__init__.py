"""
Celery application module.

Exports the Celery app instance for use by workers and task schedulers.
"""

from .celery import app as celery_app

__all__ = ["celery_app"]

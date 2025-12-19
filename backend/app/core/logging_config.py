"""
Logging configuration module.

Design principles:
- Standard library only, no new dependencies
- Dual output: console (readable text) + file (CSV for analysis)
- Daily rotation, keep 30 days history
"""

import csv
import io
import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# Log directory (relative to backend/)
LOG_DIR = Path(__file__).parent.parent.parent / "logs"

# Console format: human-readable
CONSOLE_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# CSV fields (15 columns) - first 4 columns match console format
CSV_FIELDS = [
    'timestamp', 'level', 'module', 'message',
    'task_id', 'feed_id', 'user_id', 'feed_url', 'feed_title',
    'success', 'error', 'duration_ms', 'articles_count',
    'refresh_interval', 'last_fetched'
]


class CsvFormatter(logging.Formatter):
    """
    CSV format logger - auto-handles quotes and commas.

    Usage:
        logger.info("message", extra={'task_id': 'xxx', 'feed_id': 'yyy'})
    """

    def format(self, record):
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        row = [
            self.formatTime(record, self.datefmt),   # timestamp
            record.levelname,                         # level
            record.name,                              # module
            record.getMessage(),                      # message
            getattr(record, 'task_id', ''),           # task_id
            getattr(record, 'feed_id', ''),           # feed_id
            getattr(record, 'user_id', ''),           # user_id
            getattr(record, 'feed_url', ''),          # feed_url
            getattr(record, 'feed_title', ''),        # feed_title
            getattr(record, 'success', ''),           # success
            getattr(record, 'error', ''),             # error
            getattr(record, 'duration_ms', ''),       # duration_ms
            getattr(record, 'articles_count', ''),    # articles_count
            getattr(record, 'refresh_interval', ''),  # refresh_interval
            getattr(record, 'last_fetched', ''),      # last_fetched
        ]
        writer.writerow(row)
        return output.getvalue().strip()


class CsvRotatingFileHandler(TimedRotatingFileHandler):
    """
    Timed rotating file handler with CSV header support.

    Writes CSV header when creating new log file.
    """

    def _open(self):
        # Check if file is new or empty (needs header)
        is_new = not os.path.exists(self.baseFilename) or \
                 os.path.getsize(self.baseFilename) == 0

        stream = super()._open()

        if is_new:
            # Write CSV header
            stream.write(','.join(CSV_FIELDS) + '\n')
            stream.flush()

        return stream


def setup_logging(level: int = logging.INFO) -> None:
    """
    Configure logging system.

    Called by both FastAPI and Celery worker.
    Idempotent: repeated calls won't create duplicate handlers.
    """
    # Ensure log directory exists
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    root_logger = logging.getLogger()

    # Idempotent check: skip if already configured
    if any(isinstance(h, CsvRotatingFileHandler) for h in root_logger.handlers):
        return

    root_logger.setLevel(level)

    # Handler 1: Console output (human-readable for debugging)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(CONSOLE_FORMAT, DATE_FORMAT))
    root_logger.addHandler(console_handler)

    # Handler 2: CSV file output (for analysis in Excel/Numbers)
    # Daily rotation at midnight, keep 30 days
    csv_handler = CsvRotatingFileHandler(
        filename=LOG_DIR / "rss_refresh.csv",
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8"
    )
    csv_handler.setFormatter(CsvFormatter(datefmt=DATE_FORMAT))
    root_logger.addHandler(csv_handler)

    # Suppress noisy loggers
    logging.getLogger("realtime").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

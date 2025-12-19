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
from datetime import datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# Log directory (relative to backend/)
LOG_DIR = Path(__file__).parent.parent.parent / "logs"

# Console format: human-readable
CONSOLE_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# CSV fields (6 columns) - core logging fields only
CSV_FIELDS = ['timestamp', 'level', 'module', 'message', 'user_id', 'error']


class CsvFormatter(logging.Formatter):
    """
    CSV format logger - auto-handles quotes and commas.

    Usage:
        logger.info("message", extra={'user_id': 'xxx', 'error': 'yyy'})
    """

    def format(self, record):
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        row = [
            self.formatTime(record, self.datefmt),   # timestamp
            record.levelname,                         # level
            record.name,                              # module
            record.getMessage(),                      # message
            getattr(record, 'user_id', ''),           # user_id
            getattr(record, 'error', ''),             # error
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
    # Filename includes date: rss_refresh_2025_12_19.csv
    # Daily rotation at midnight, keep 30 days
    today = datetime.now().strftime("%Y_%m_%d")
    csv_handler = CsvRotatingFileHandler(
        filename=LOG_DIR / f"rss_refresh_{today}.csv",
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

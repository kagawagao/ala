"""Centralised logging configuration for ALA backend.

Sets up:
- Console handler (stderr) — always active
- TimedRotatingFileHandler — daily rotation, kept for 30 days, written to ``settings.log_dir``

Call ``setup_logging()`` once at application startup (``main.py``).
Individual modules obtain their logger with ``logging.getLogger(__name__)``.
"""

import logging
import logging.handlers
from pathlib import Path


def setup_logging(log_level: str = "INFO", log_dir: str = "logs") -> None:
    """Configure root logger with console + rotating file handlers.

    Parameters
    ----------
    log_level:
        Minimum severity to record. Accepted values (case-insensitive):
        ``DEBUG``, ``INFO``, ``WARNING``, ``ERROR``, ``CRITICAL``.
    log_dir:
        Directory for log files. Created automatically when it does not exist.
    """
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    log_fmt = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    # Avoid adding duplicate handlers when the function is called more than once
    # (e.g. during testing).
    if root_logger.handlers:
        root_logger.handlers.clear()

    # ── Console handler ────────────────────────────────────────────────────────
    console_handler = logging.StreamHandler()
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(log_fmt)
    root_logger.addHandler(console_handler)

    # ── Rotating file handler ──────────────────────────────────────────────────
    log_path = Path(log_dir)
    try:
        log_path.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.TimedRotatingFileHandler(
            filename=log_path / "ala.log",
            when="midnight",
            interval=1,
            backupCount=30,
            encoding="utf-8",
        )
        file_handler.setLevel(numeric_level)
        file_handler.setFormatter(log_fmt)
        root_logger.addHandler(file_handler)
    except OSError as exc:
        # Non-fatal: log directory may not be writable (read-only filesystem,
        # containerised deployment without a volume, etc.)
        root_logger.warning("Could not create log directory %r: %s — file logging disabled", log_dir, exc)

    # Suppress overly-verbose third-party loggers at DEBUG level
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)

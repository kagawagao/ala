"""ALA Backend FastAPI application."""

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import chat, health, logs, models, projects, trace
from .api import config as config_router
from .config import settings
from .logging_config import setup_logging
from .mcp.server import mcp
from .services.database import get_db

# Initialise logging as early as possible so every subsequent import can log.
setup_logging(log_level=settings.log_level, log_dir=settings.log_dir)

logger = logging.getLogger(__name__)

# Resolve the bundled frontend directory when running as a PyInstaller executable.
# sys._MEIPASS is set by PyInstaller to the temp extraction directory.
_FROZEN = getattr(sys, "frozen", False)
_FRONTEND_DIR: Path | None = None
if _FROZEN:
    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass:
        _candidate = Path(_meipass) / "frontend_dist"
        if _candidate.is_dir():
            _FRONTEND_DIR = _candidate


class _SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to index.html for missing paths (SPA routing)."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def _cleanup_temp_on_startup() -> None:
    """Delete temp log session directories older than 24 hours on startup."""
    import os
    import shutil
    import time
    from pathlib import Path

    max_age_hours = int(os.environ.get("ALA_TEMP_MAX_AGE_HOURS", "24"))
    env_dir = os.environ.get("ALA_TEMP_DIR")
    temp_dir = Path(env_dir) if env_dir else Path.home() / ".ala" / "temp_logs"

    if not temp_dir.exists():
        return

    cutoff = time.time() - (max_age_hours * 3600)
    for entry in temp_dir.iterdir():
        if entry.is_dir():
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry)
                    logger.info("Cleaned up old temp session on startup: %s", entry.name)
            except OSError:
                logger.warning("Failed to clean up temp dir on startup: %s", entry)


def create_app() -> FastAPI:
    # Build one MCP HTTP sub-application per FastAPI app instance so repeated
    # TestClient create/teardown cycles can safely create fresh app instances.
    mcp_http_app = mcp.http_app(path="/")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(
            "ALA backend starting — host=%s port=%d log_level=%s",
            settings.host,
            settings.port,
            settings.log_level,
        )
        # Trigger DB initialization and migration
        get_db()

        # Clean up old temp log files on startup
        _cleanup_temp_on_startup()

        # Start the FastMCP session-manager task-group alongside the FastAPI app.
        # The mcp_http_app lifespan initialises StreamableHTTPSessionManager.run()
        # which is required before any MCP request can be handled.
        async with mcp_http_app.lifespan(mcp_http_app):
            yield
        logger.info("ALA backend stopped.")

    app = FastAPI(
        title="ALA Backend",
        description="Android Log Analyzer backend API",
        version="2.3.4",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
    app.include_router(trace.router, prefix="/api/trace", tags=["trace"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(config_router.router, prefix="/api/config", tags=["config"])
    app.include_router(models.router, prefix="/api/models", tags=["models"])
    app.include_router(projects.router, prefix="/api/projects", tags=["projects"])

    # Mount the MCP server at /mcp – available at http://<host>:<port>/mcp
    # MCP clients should connect to http://<host>:<port>/mcp
    app.mount("/mcp", mcp_http_app)

    # When running as a frozen executable, serve the bundled React SPA.
    # This must come AFTER all API routers and /mcp mount so that API paths
    # are matched first and only unrecognised paths fall through to the SPA.
    if _FRONTEND_DIR is not None:
        # Serve the entire frontend dist directory; _SPAStaticFiles falls back
        # to index.html for any path that doesn't resolve to an actual file,
        # enabling React client-side routing while still serving static assets
        # (e.g. /guide/zh.md, /assets/...) directly.
        app.mount(
            "/",
            _SPAStaticFiles(directory=str(_FRONTEND_DIR), html=True),
            name="spa",
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ala.main:app", host=settings.host, port=settings.port, reload=settings.debug)

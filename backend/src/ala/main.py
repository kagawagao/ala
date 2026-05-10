"""ALA Backend FastAPI application."""

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import chat, health, logs, models, pcap, projects, trace
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
        # Start the FastMCP session-manager task-group alongside the FastAPI app.
        # The mcp_http_app lifespan initialises StreamableHTTPSessionManager.run()
        # which is required before any MCP request can be handled.
        async with mcp_http_app.lifespan(mcp_http_app):
            yield
        logger.info("ALA backend stopped.")

    app = FastAPI(
        title="ALA Backend",
        description="Android Log Analyzer backend API",
        version="2.2.0",
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
    app.include_router(pcap.router, prefix="/api/pcap", tags=["pcap"])
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
        # Serve static assets (JS/CSS/images etc.)
        app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIR / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str, request: Request) -> FileResponse:  # noqa: ARG001
            """Return index.html for every non-API path (React client-side routing)."""
            index = _FRONTEND_DIR / "index.html"  # type: ignore[operator]
            return FileResponse(str(index))

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ala.main:app", host=settings.host, port=settings.port, reload=settings.debug)

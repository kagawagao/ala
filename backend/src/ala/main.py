"""ALA Backend FastAPI application."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import chat, health, logs, projects, trace
from .api import config as config_router
from .config import settings
from .mcp.server import mcp

# Build the MCP HTTP sub-application once so we can share the instance between
# the lifespan (which must start its internal task-group) and app.mount().
_mcp_http_app = mcp.http_app(path="/")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the FastMCP session-manager task-group alongside the FastAPI app.
    # The mcp_http_app lifespan initialises StreamableHTTPSessionManager.run()
    # which is required before any MCP request can be handled.
    async with _mcp_http_app.lifespan(_mcp_http_app):
        yield


app = FastAPI(
    title="ALA Backend",
    description="Android Log Analyzer backend API",
    version="1.1.0",
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
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])

# Mount the MCP server at /mcp – available at http://<host>:<port>/mcp
# MCP clients should connect to http://<host>:<port>/mcp
app.mount("/mcp", _mcp_http_app)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ala.main:app", host=settings.host, port=settings.port, reload=settings.debug)

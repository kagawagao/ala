"""ALA Backend FastAPI application."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import chat, health, logs, trace
from .api import config as config_router
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
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

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ala.main:app", host=settings.host, port=settings.port, reload=settings.debug)

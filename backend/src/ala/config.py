"""ALA Backend configuration."""

import json
import sys
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings

# When running as a PyInstaller executable, also look for .env next to the binary
# so users can configure AI_API_KEY without recompiling.
_FROZEN = getattr(sys, "frozen", False)
_EXE_ENV: str | None = None
if _FROZEN:
    exe_dir = Path(sys.executable).parent
    candidate = exe_dir / ".env"
    if candidate.exists():
        _EXE_ENV = str(candidate)


class Settings(BaseSettings):
    host: str = "127.0.0.1" if _FROZEN else "0.0.0.0"
    port: int = 8000
    debug: bool = False
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    # Logging
    log_level: str = "INFO"  # DEBUG | INFO | WARNING | ERROR
    log_dir: str = "logs"  # directory for rotating log files; relative to CWD or absolute

    # AI defaults (user can override via API)
    ai_api_endpoint: str = "https://api.anthropic.com"
    ai_api_key: str = ""
    ai_model: str = "claude-sonnet-4-20250514"
    ai_temperature: float = 0.7
    ai_thinking_mode: str = "off"  # off | auto | on
    ai_thinking_budget_tokens: int = 8000

    # Session management
    max_sessions: int = 100

    # AI agent behaviour
    ai_max_tool_rounds: int = 50  # max iterations in agentic tool-calling loop

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    model_config = {
        "env_file": _EXE_ENV or ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()

"""ALA Backend configuration."""
import json

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ]

    # AI defaults (user can override via API)
    ai_api_endpoint: str = "https://api.anthropic.com"
    ai_api_key: str = ""
    ai_model: str = "claude-sonnet-4-20250514"
    ai_temperature: float = 0.7

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()

"""AI configuration endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings

router = APIRouter()


class AIConfig(BaseModel):
    api_endpoint: str
    api_key: str
    model: str
    temperature: float = 0.7
    thinking_mode: str = "off"  # off | auto | on
    thinking_budget_tokens: int = 8000
    anthropic_compatible: bool | None = None  # None = auto-detect from endpoint


# Runtime mutable config (overrides default settings)
_runtime_ai_config: AIConfig | None = None


def get_ai_config() -> AIConfig:
    if _runtime_ai_config:
        return _runtime_ai_config
    return AIConfig(
        api_endpoint=settings.ai_api_endpoint,
        api_key=settings.ai_api_key,
        model=settings.ai_model,
        temperature=settings.ai_temperature,
        thinking_mode=settings.ai_thinking_mode,
        thinking_budget_tokens=settings.ai_thinking_budget_tokens,
    )


@router.get("", response_model=AIConfig)
async def get_config():
    cfg = get_ai_config()
    # Mask the API key in response
    return AIConfig(
        api_endpoint=cfg.api_endpoint,
        api_key="***" if cfg.api_key else "",
        model=cfg.model,
        temperature=cfg.temperature,
        thinking_mode=cfg.thinking_mode,
        thinking_budget_tokens=cfg.thinking_budget_tokens,
        anthropic_compatible=cfg.anthropic_compatible,
    )


@router.put("", response_model=dict)
async def update_config(config: AIConfig):
    global _runtime_ai_config
    # Preserve existing API key if the client echoed back the masked placeholder
    if not config.api_key or config.api_key == "***":
        config.api_key = get_ai_config().api_key
    _runtime_ai_config = config
    return {"success": True}

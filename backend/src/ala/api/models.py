"""API endpoints for AI model preset management."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.model_manager import ModelPreset as _ModelPreset
from ..services.model_manager import model_manager

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class ModelPresetOut(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    api_endpoint: str
    description: str = ""
    builtin: bool = False
    anthropic_compatible: bool | None = None
    supports_thinking: bool = False

    @classmethod
    def from_preset(cls, p: _ModelPreset) -> "ModelPresetOut":
        return cls(
            id=p.id,
            name=p.name,
            provider=p.provider,
            model_id=p.model_id,
            api_endpoint=p.api_endpoint,
            description=p.description,
            builtin=p.builtin,
            anthropic_compatible=p.anthropic_compatible,
            supports_thinking=p.supports_thinking,
        )


class CreateModelRequest(BaseModel):
    name: str
    provider: str = "Custom"
    model_id: str
    api_endpoint: str
    description: str = ""
    anthropic_compatible: bool | None = None
    supports_thinking: bool = False


class UpdateModelRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_id: str | None = None
    api_endpoint: str | None = None
    description: str | None = None
    anthropic_compatible: bool | None | str = "unset"  # "unset" = leave unchanged
    supports_thinking: bool | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ModelPresetOut])
async def list_models():
    """Return all model presets (built-in + custom)."""
    return [ModelPresetOut.from_preset(m) for m in model_manager.list_models()]


@router.post("", response_model=ModelPresetOut, status_code=201)
async def create_model(req: CreateModelRequest):
    """Add a new custom model preset."""
    preset = model_manager.create_model(
        name=req.name,
        provider=req.provider,
        model_id=req.model_id,
        api_endpoint=req.api_endpoint,
        description=req.description,
        anthropic_compatible=req.anthropic_compatible,
        supports_thinking=req.supports_thinking,
    )
    logger.info("Created custom model: %s (%s)", preset.name, preset.id)
    return ModelPresetOut.from_preset(preset)


@router.put("/{preset_id}", response_model=ModelPresetOut)
async def update_model(preset_id: str, req: UpdateModelRequest):
    """Update a custom model preset.  Built-in models cannot be modified."""
    from ..services.model_manager import _UNSET  # noqa: PLC0415

    # Only pass anthropic_compatible if it was explicitly provided in the request
    # (not the sentinel "unset" string)
    compat = _UNSET if req.anthropic_compatible == "unset" else req.anthropic_compatible
    try:
        preset = model_manager.update_model(
            preset_id=preset_id,
            name=req.name,
            provider=req.provider,
            model_id=req.model_id,
            api_endpoint=req.api_endpoint,
            description=req.description,
            anthropic_compatible=compat,
            supports_thinking=req.supports_thinking,
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not preset:
        raise HTTPException(status_code=404, detail="Model not found")
    logger.info("Updated model: %s", preset_id)
    return ModelPresetOut.from_preset(preset)


@router.delete("/{preset_id}", response_model=dict)
async def delete_model(preset_id: str):
    """Delete a custom model preset.  Built-in models cannot be deleted."""
    try:
        deleted = model_manager.delete_model(preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")
    logger.info("Deleted model: %s", preset_id)
    return {"success": True}


@router.post("/reload", response_model=dict)
async def reload_models():
    """Reload model list from the JSON file on disk."""
    model_manager.reload()
    count = len(model_manager.list_models())
    logger.info("Reloaded models from disk: %d total", count)
    return {"success": True, "count": count}

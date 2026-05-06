"""Persistent model manager backed by a JSON file in ~/.ala/models.json."""

import json
import logging
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

# Sentinel to distinguish "not provided" from explicit None in update_model
_UNSET = object()

logger = logging.getLogger(__name__)


def _default_storage_path() -> Path:
    """Use ~/.ala/models.json as the default storage location."""
    return Path.home() / ".ala" / "models.json"


# ---------------------------------------------------------------------------
# Built-in model presets (mirrors frontend BUILTIN_MODELS)
# ---------------------------------------------------------------------------

_BUILTIN_MODELS_DATA: list[dict] = [
    # ── Anthropic ──────────────────────────────────────────────────────────
    {
        "id": "claude-opus-4.7",
        "name": "Claude Opus 4.7",
        "provider": "Anthropic",
        "model_id": "claude-opus-4-7",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Most capable, adaptive thinking",
        "builtin": True,
        "anthropic_compatible": True,
        "supports_thinking": True,
    },
    {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6",
        "provider": "Anthropic",
        "model_id": "claude-sonnet-4-6",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Speed & intelligence, extended thinking",
        "builtin": True,
        "anthropic_compatible": True,
        "supports_thinking": True,
    },
    {
        "id": "claude-haiku-4.5",
        "name": "Claude Haiku 4.5",
        "provider": "Anthropic",
        "model_id": "claude-haiku-4-5-20251001",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Fastest near-frontier",
        "builtin": True,
        "anthropic_compatible": True,
        "supports_thinking": False,
    },
    # ── OpenAI ─────────────────────────────────────────────────────────────
    {
        "id": "gpt-5.5",
        "name": "GPT-5.5",
        "provider": "OpenAI",
        "model_id": "gpt-5.5",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Frontier, 1.05M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "gpt-5.4",
        "name": "GPT-5.4",
        "provider": "OpenAI",
        "model_id": "gpt-5.4",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Unified Codex+GPT, 1.05M",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "provider": "OpenAI",
        "model_id": "gpt-4.1",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Flagship, 1M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "o3",
        "name": "o3",
        "provider": "OpenAI",
        "model_id": "o3",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Advanced reasoning",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "o4-mini",
        "name": "o4-mini",
        "provider": "OpenAI",
        "model_id": "o4-mini",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Compact reasoning",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Google Gemini ──────────────────────────────────────────────────────
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro",
        "provider": "Google",
        "model_id": "gemini-2.5-pro-preview-03-25",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Most capable Gemini",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider": "Google",
        "model_id": "gemini-2.5-flash-preview-04-17",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Fast & capable",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash",
        "provider": "Google",
        "model_id": "gemini-2.0-flash",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Fast, efficient",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── DeepSeek ───────────────────────────────────────────────────────────
    {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek-V4 Pro",
        "provider": "DeepSeek",
        "model_id": "deepseek-v4-pro",
        "api_endpoint": "https://api.deepseek.com",
        "description": "Flagship reasoning MoE",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek-V4 Flash",
        "provider": "DeepSeek",
        "model_id": "deepseek-v4-flash",
        "api_endpoint": "https://api.deepseek.com",
        "description": "Fast & efficient",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    # ── xAI (Grok) ─────────────────────────────────────────────────────────
    {
        "id": "grok-4.20",
        "name": "Grok 4.20",
        "provider": "xAI",
        "model_id": "grok-4.20",
        "api_endpoint": "https://api.x.ai/v1",
        "description": "Flagship, 2M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "grok-4.1-fast",
        "name": "Grok 4.1 Fast",
        "provider": "xAI",
        "model_id": "grok-4-1-fast",
        "api_endpoint": "https://api.x.ai/v1",
        "description": "Fast, 2M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Mistral AI ─────────────────────────────────────────────────────────
    {
        "id": "mistral-large",
        "name": "Mistral Large 3",
        "provider": "Mistral",
        "model_id": "mistral-large-latest",
        "api_endpoint": "https://api.mistral.ai/v1",
        "description": "Most capable Mistral",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "mistral-small",
        "name": "Mistral Small 4",
        "provider": "Mistral",
        "model_id": "mistral-small-latest",
        "api_endpoint": "https://api.mistral.ai/v1",
        "description": "Fast & efficient",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "codestral",
        "name": "Codestral",
        "provider": "Mistral",
        "model_id": "codestral-latest",
        "api_endpoint": "https://api.mistral.ai/v1",
        "description": "Code-optimised",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Cohere ─────────────────────────────────────────────────────────────
    {
        "id": "command-r-plus",
        "name": "Command R+",
        "provider": "Cohere",
        "model_id": "command-r-plus",
        "api_endpoint": "https://api.cohere.com/v1",
        "description": "Advanced RAG",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Kimi (Moonshot AI) ─────────────────────────────────────────────────
    {
        "id": "kimi-k2",
        "name": "Kimi K2",
        "provider": "Kimi",
        "model_id": "kimi-k2",
        "api_endpoint": "https://api.moonshot.cn/v1",
        "description": "Latest flagship",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "kimi-k2-thinking",
        "name": "Kimi K2 Thinking",
        "provider": "Kimi",
        "model_id": "kimi-k2-thinking",
        "api_endpoint": "https://api.moonshot.cn/v1",
        "description": "Extended reasoning",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── MiniMax ────────────────────────────────────────────────────────────
    {
        "id": "minimax-m2.7",
        "name": "MiniMax-M2.7",
        "provider": "MiniMax",
        "model_id": "minimax-m2.7",
        "api_endpoint": "https://api.minimax.io/v1",
        "description": "Latest",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Qwen (DashScope) ───────────────────────────────────────────────────
    {
        "id": "qwen-max",
        "name": "Qwen Max",
        "provider": "Qwen",
        "model_id": "qwen-max-latest",
        "api_endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "description": "Most capable",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "qwen-plus",
        "name": "Qwen Plus",
        "provider": "Qwen",
        "model_id": "qwen-plus-latest",
        "api_endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "description": "Balanced",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
]


@dataclass
class ModelPreset:
    id: str
    name: str
    provider: str
    model_id: str
    api_endpoint: str
    description: str = ""
    builtin: bool = False
    anthropic_compatible: bool | None = None
    supports_thinking: bool = False


def _make_builtin_presets() -> list[ModelPreset]:
    presets = []
    for d in _BUILTIN_MODELS_DATA:
        presets.append(ModelPreset(**d))
    return presets


class ModelManager:
    """Manages AI model presets persisted in a JSON file.

    Built-in models are always present and cannot be deleted.  Custom models
    are stored in the JSON file and survive server restarts.  The file is
    re-written on every mutation so callers always see the latest state.
    """

    def __init__(self, storage_path: Path | None = None):
        self._storage_path = storage_path or _default_storage_path()
        # Ordered dict: id -> ModelPreset (builtin first, then custom)
        self._models: dict[str, ModelPreset] = {}
        self._load()

    # ── persistence ────────────────────────────────────────────────────────

    def _load(self) -> None:
        """Load models from disk.  Built-in models are always refreshed from
        the hard-coded list so they stay up-to-date; custom models from file."""
        builtin_map = {m.id: m for m in _make_builtin_presets()}

        custom_models: list[ModelPreset] = []
        needs_save = False
        if self._storage_path.exists():
            try:
                data: list[dict] = json.loads(self._storage_path.read_text(encoding="utf-8"))
                for item in data:
                    if item.get("builtin"):
                        # Refresh builtin from hard-coded list, but tolerate
                        # unknown ids (in case built-ins were removed from code).
                        existing = builtin_map.get(item["id"])
                        if existing:
                            builtin_map[item["id"]] = existing
                    else:
                        try:
                            custom_models.append(ModelPreset(**item))
                        except TypeError:
                            logger.warning("Skipping malformed model entry: %s", item.get("id"))
            except (json.JSONDecodeError, TypeError):
                logger.warning("models.json is corrupt – using defaults")
                needs_save = True
        else:
            # File does not exist yet – write defaults on first startup
            needs_save = True

        self._models = {}
        for m in builtin_map.values():
            self._models[m.id] = m
        for m in custom_models:
            self._models[m.id] = m

        if needs_save:
            self._save()
        logger.info(
            "Loaded %d models (%d builtin, %d custom)",
            len(self._models),
            len(builtin_map),
            len(custom_models),
        )

    def _save(self) -> None:
        """Persist models to disk (builtin + custom).

        Logs a warning and continues with in-memory state if the file cannot
        be written (e.g. read-only filesystem, missing $HOME in containers).
        """
        try:
            self._storage_path.parent.mkdir(parents=True, exist_ok=True)
            data = [asdict(m) for m in self._models.values()]
            self._storage_path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except OSError as exc:
            logger.warning(
                "Could not write models to %s: %s – running with in-memory state only",
                self._storage_path,
                exc,
            )

    def reload(self) -> None:
        """Re-read the JSON file and refresh in-memory state."""
        self._load()

    # ── read ───────────────────────────────────────────────────────────────

    def list_models(self) -> list[ModelPreset]:
        return list(self._models.values())

    def get_model(self, model_id: str) -> ModelPreset | None:
        return self._models.get(model_id)

    # ── write ──────────────────────────────────────────────────────────────

    def create_model(
        self,
        name: str,
        provider: str,
        model_id: str,
        api_endpoint: str,
        description: str = "",
        anthropic_compatible: bool | None = None,
        supports_thinking: bool = False,
    ) -> ModelPreset:
        preset = ModelPreset(
            id=f"custom-{uuid.uuid4().hex[:8]}",
            name=name,
            provider=provider or "Custom",
            model_id=model_id,
            api_endpoint=api_endpoint,
            description=description,
            builtin=False,
            anthropic_compatible=anthropic_compatible,
            supports_thinking=supports_thinking,
        )
        self._models[preset.id] = preset
        self._save()
        return preset

    def update_model(
        self,
        preset_id: str,
        name: str | None = None,
        provider: str | None = None,
        model_id: str | None = None,
        api_endpoint: str | None = None,
        description: str | None = None,
        anthropic_compatible: object = _UNSET,
        supports_thinking: bool | None = None,
    ) -> ModelPreset | None:
        preset = self._models.get(preset_id)
        if not preset:
            return None
        if preset.builtin:
            raise ValueError("Built-in models cannot be modified")
        if name is not None:
            preset.name = name
        if provider is not None:
            preset.provider = provider
        if model_id is not None:
            preset.model_id = model_id
        if api_endpoint is not None:
            preset.api_endpoint = api_endpoint
        if description is not None:
            preset.description = description
        if anthropic_compatible is not _UNSET:
            preset.anthropic_compatible = anthropic_compatible  # type: ignore[assignment]
        if supports_thinking is not None:
            preset.supports_thinking = supports_thinking
        self._save()
        return preset

    def delete_model(self, preset_id: str) -> bool:
        preset = self._models.get(preset_id)
        if not preset:
            return False
        if preset.builtin:
            raise ValueError("Built-in models cannot be deleted")
        del self._models[preset_id]
        self._save()
        return True


# Module-level singleton created once when the server starts.
# Other modules import this instance directly.
model_manager = ModelManager()

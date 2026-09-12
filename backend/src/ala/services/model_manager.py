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

# Model ids whose provider documents image (vision) input support.
# Sourced from each vendor's official model documentation:
#   Anthropic — all current models accept text + image input
#   OpenAI    — all latest models support text + image input / vision
#   Google    — Gemini 3.x pro & flash accept image input
#   DeepSeek  — V4.1 Flash (`deepseek-flash`) only; V4 Pro is text-only
#   xAI       — Grok language models declare TEXT + IMAGE input modalities
#   Mistral   — multimodal frontier models (Medium 3 family); Large/Small are
#               inferred from the same generation — adjust if a vendor differs
#   Cohere    — Command A+ combines vision input with agentic + reasoning
#   Kimi      — Chat Completions API documents vision input
#   MiniMax   — M3 is a frontier multimodal model
#   Qwen      — Qwen3.8 series supports vision
_VISION_CAPABLE_IDS: frozenset[str] = frozenset(
    {
        # Anthropic
        "claude-fable-5.1",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4.5",
        # OpenAI
        "gpt-6-astra",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        # Google
        "gemini-3.1-pro",
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        # DeepSeek
        "deepseek-flash",
        # xAI
        "grok-4.6",
        "grok-4.5",
        "grok-4.20",
        # Mistral
        "mistral-large",
        "mistral-small",
        # Cohere
        "command-a-plus",
        # Kimi
        "kimi-k3",
        # MiniMax
        "minimax-m3",
        # Qwen
        "qwen3.8-max",
        "qwen3.8-flash",
    }
)

_BUILTIN_MODELS_DATA: list[dict] = [
    # ── Anthropic ──────────────────────────────────────────────────────────
    {
        "id": "claude-fable-5.1",
        "name": "Claude Fable 5.1",
        "provider": "Anthropic",
        "model_id": "claude-fable-5-1",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Most capable — deep reasoning & long-horizon agents",
        "builtin": True,
        "anthropic_compatible": True,
        "supports_thinking": True,
    },
    {
        "id": "claude-opus-5",
        "name": "Claude Opus 5",
        "provider": "Anthropic",
        "model_id": "claude-opus-5",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Complex agentic coding & enterprise work",
        "builtin": True,
        "anthropic_compatible": True,
        "supports_thinking": True,
    },
    {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5",
        "provider": "Anthropic",
        "model_id": "claude-sonnet-5",
        "api_endpoint": "https://api.anthropic.com",
        "description": "Best speed/intelligence balance, 1M context",
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
        "supports_thinking": True,
    },
    # ── OpenAI ─────────────────────────────────────────────────────────────
    {
        "id": "gpt-6-astra",
        "name": "GPT-6 Astra",
        "provider": "OpenAI",
        "model_id": "gpt-6-astra",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Most capable, built for hardest end-to-end work",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "gpt-5.6-sol",
        "name": "GPT-5.6 Sol",
        "provider": "OpenAI",
        "model_id": "gpt-5.6-sol",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Flagship for complex professional work, 1M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "gpt-5.6-terra",
        "name": "GPT-5.6 Terra",
        "provider": "OpenAI",
        "model_id": "gpt-5.6-terra",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Balances intelligence and cost",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "gpt-5.6-luna",
        "name": "GPT-5.6 Luna",
        "provider": "OpenAI",
        "model_id": "gpt-5.6-luna",
        "api_endpoint": "https://api.openai.com/v1",
        "description": "Cost-sensitive, high-volume workloads",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Google Gemini ──────────────────────────────────────────────────────
    {
        "id": "gemini-3.1-pro",
        "name": "Gemini 3.1 Pro",
        "provider": "Google",
        "model_id": "gemini-3.1-pro-preview",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Advanced intelligence, agentic & vibe coding (preview)",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash",
        "provider": "Google",
        "model_id": "gemini-3.8-flash",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Frontier-class performance at a fraction of the cost",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite",
        "provider": "Google",
        "model_id": "gemini-3.5-flash-lite",
        "api_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "description": "Fastest, most economical",
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
        "description": "Pro reasoning MoE (retiring Sep 2026)",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "deepseek-flash",
        "name": "DeepSeek-V4.1 Flash",
        "provider": "DeepSeek",
        "model_id": "deepseek-flash",
        "api_endpoint": "https://api.deepseek.com",
        "description": "Flagship — vision, 1M context, thinking by default",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    # ── xAI (Grok) ─────────────────────────────────────────────────────────
    {
        "id": "grok-4.6",
        "name": "Grok 4.6",
        "provider": "xAI",
        "model_id": "grok-4.6",
        "api_endpoint": "https://api.x.ai/v1",
        "description": "Most intelligent and fastest, 500K context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "grok-4.5",
        "name": "Grok 4.5",
        "provider": "xAI",
        "model_id": "grok-4.5",
        "api_endpoint": "https://api.x.ai/v1",
        "description": "Balanced flagship, 500K context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
    },
    {
        "id": "grok-4.20",
        "name": "Grok 4.20",
        "provider": "xAI",
        "model_id": "grok-4.20",
        "api_endpoint": "https://api.x.ai/v1",
        "description": "Long-context reasoning, 1M context",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": True,
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
        "id": "command-a-plus",
        "name": "Command A+",
        "provider": "Cohere",
        "model_id": "command-a-plus",
        "api_endpoint": "https://api.cohere.com/v1",
        "description": "Latest flagship, agentic & RAG",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Kimi (Moonshot AI) ─────────────────────────────────────────────────
    {
        "id": "kimi-k3",
        "name": "Kimi K3",
        "provider": "Kimi",
        "model_id": "kimi-k3",
        "api_endpoint": "https://api.moonshot.cn/v1",
        "description": "Latest flagship",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code",
        "provider": "Kimi",
        "model_id": "kimi-k2.7-code",
        "api_endpoint": "https://api.moonshot.cn/v1",
        "description": "Code-optimised",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── MiniMax ────────────────────────────────────────────────────────────
    {
        "id": "minimax-m3",
        "name": "MiniMax-M3",
        "provider": "MiniMax",
        "model_id": "MiniMax-M3",
        "api_endpoint": "https://api.minimax.io/v1",
        "description": "Latest",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    # ── Qwen (DashScope) ───────────────────────────────────────────────────
    {
        "id": "qwen3.8-max",
        "name": "Qwen3.8 Max",
        "provider": "Qwen",
        "model_id": "qwen3.8-max",
        "api_endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "description": "Most capable",
        "builtin": True,
        "anthropic_compatible": False,
        "supports_thinking": False,
    },
    {
        "id": "qwen3.8-flash",
        "name": "Qwen3.8 Flash",
        "provider": "Qwen",
        "model_id": "qwen3.8-flash",
        "api_endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "description": "Fast & efficient",
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
    supports_vision: bool = False
    enabled: bool = True


def _make_builtin_presets() -> list[ModelPreset]:
    presets = []
    for d in _BUILTIN_MODELS_DATA:
        presets.append(ModelPreset(**d, supports_vision=d["id"] in _VISION_CAPABLE_IDS))
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
                            # Drop unknown keys for forward-compat and fill missing fields
                            # type: ignore[attr-defined]
                            known = {f.name for f in ModelPreset.__dataclass_fields__.values()}
                            filtered = {k: v for k, v in item.items() if k in known}
                            custom_models.append(ModelPreset(**filtered))
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
        supports_vision: bool = False,
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
            supports_vision=supports_vision,
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
        supports_vision: bool | None = None,
        enabled: bool | None = None,
    ) -> ModelPreset | None:
        preset = self._models.get(preset_id)
        if not preset:
            return None
        # enabled may be changed on builtin models too; all other fields are
        # restricted to custom models only.
        if enabled is not None:
            preset.enabled = enabled
        if preset.builtin:
            if (
                any(
                    v is not None
                    for v in [
                        name,
                        provider,
                        model_id,
                        api_endpoint,
                        description,
                        supports_thinking,
                        supports_vision,
                    ]
                )
                or anthropic_compatible is not _UNSET
            ):
                raise ValueError("Built-in models cannot be modified")
            self._save()
            return preset
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
            # type: ignore[assignment]
            preset.anthropic_compatible = anthropic_compatible
        if supports_thinking is not None:
            preset.supports_thinking = supports_thinking
        if supports_vision is not None:
            preset.supports_vision = supports_vision
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

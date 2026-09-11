"""Multi-turn chat with streaming SSE."""

import base64
import binascii
import json
import logging
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..services.ai_service import (
    MAX_IMAGE_ATTACHMENTS,
    MAX_IMAGE_BYTES,
    SUPPORTED_IMAGE_MEDIA_TYPES,
    AIService,
)
from ..services.log_analyzer import LogAnalyzer, PathTraversalError
from ..services.model_manager import model_manager
from ..services.session_manager import SessionManager
from .config import get_ai_config
from .projects import get_project_manager

router = APIRouter()
_session_manager = SessionManager(max_sessions=settings.max_sessions)
logger = logging.getLogger(__name__)


def _sse_encode(chunk: str) -> str:
    """Encode a chunk for SSE, properly handling embedded newlines."""
    lines = chunk.split("\n")
    return "\n".join(f"data: {line}" for line in lines) + "\n\n"


class Attachment(BaseModel):
    """An inline image attachment sent alongside a chat message."""

    type: Literal["image"] = "image"
    media_type: str  # e.g. "image/png"
    data: str  # base64-encoded payload (a "data:" URL prefix is also accepted)


class ChatMessage(BaseModel):
    role: str
    content: str
    parts: str | None = None  # JSON array of structured message parts
    attachments: list[Attachment] | None = None


class Session(BaseModel):
    id: str
    title: str
    messages: list[ChatMessage]  # Always empty — history managed by frontend localStorage
    created_at: str
    context_type: str  # "log" | "trace" | "pcap" | "general"
    project_id: str | None = None


class CreateSessionRequest(BaseModel):
    title: str = "New Session"
    context_type: str = "general"
    project_id: str | None = None


class ModelOverride(BaseModel):
    model: str
    api_endpoint: str
    api_key: str | None = None
    temperature: float | None = None
    thinking_mode: str | None = None
    thinking_budget_tokens: int | None = None
    anthropic_compatible: bool | None = None  # None = auto-detect from endpoint


class SendMessageRequest(BaseModel):
    message: str
    context: str | None = None  # Serialized log/trace context
    attachments: list[Attachment] | None = None  # Inline images for multimodal models
    model_override: ModelOverride | None = None
    # UI language for AI responses (e.g. "en", "zh")
    language: str | None = None
    # Conversation history from frontend localStorage (empty for new sessions)
    history: list[ChatMessage] | None = None
    # Raw provider-specific API messages for tool-call resumption
    raw_api_messages: list[dict] | None = None
    raw_api_messages_provider: str | None = None  # "anthropic" | "openai"


class SetTraceRequest(BaseModel):
    summary: dict


# REMOVED: entries→file refactor — SetFilePathRequest renamed to SetSourcePathRequest
class SetSourcePathRequest(BaseModel):
    """Set universal source path for file-based analysis."""

    source_path: str


# REMOVED: entries→file refactor — SetLogsRequest, SetPcapRequest, SetHciRequest removed


def _session_to_response(session) -> Session:
    """Convert a SessionManager Session to an API response model.

    Messages are not included — conversation history is managed by the frontend."""
    return Session(
        id=session.id,
        title=session.title,
        messages=[],  # Always empty — history managed by frontend localStorage
        created_at=session.created_at,
        context_type=session.context_type,
        project_id=session.project_id,
    )


def _normalize_attachment(att: Attachment) -> dict:
    """Validate a single image attachment and return a provider-ready dict."""
    media_type = (att.media_type or "").strip().lower()
    data = (att.data or "").strip()

    # Tolerate full data URLs by extracting the declared media type + payload.
    if data.startswith("data:"):
        header, _, payload = data.partition(",")
        if not payload:
            raise HTTPException(status_code=400, detail="Malformed attachment data URL.")
        media_type = header[len("data:") :].split(";")[0].strip().lower() or media_type
        data = payload.strip()

    if media_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
        supported = ", ".join(sorted(SUPPORTED_IMAGE_MEDIA_TYPES))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{att.media_type}'. Supported types: {supported}.",
        )
    if not data:
        raise HTTPException(status_code=400, detail="Attachment payload is empty.")

    try:
        decoded = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="Attachment payload is not valid base64."
        ) from exc

    if not decoded:
        raise HTTPException(status_code=400, detail="Attachment payload is empty.")
    if len(decoded) > MAX_IMAGE_BYTES:
        limit_mb = MAX_IMAGE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"Image exceeds the {limit_mb} MB limit ({len(decoded)} bytes).",
        )
    return {"type": "image", "media_type": media_type, "data": data}


def _validate_attachments(attachments: list[Attachment] | None) -> list[dict]:
    """Validate an attachment list, enforcing count and per-image limits."""
    if not attachments:
        return []
    if len(attachments) > MAX_IMAGE_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images ({len(attachments)}). Maximum is "
            f"{MAX_IMAGE_ATTACHMENTS} per message.",
        )
    return [_normalize_attachment(att) for att in attachments]


def _assert_vision_capable(model_id: str) -> None:
    """Reject image attachments for models known to be text-only.

    Unknown (custom) model ids pass through — the provider remains the authority
    for anything we hold no metadata for.
    """
    for preset in model_manager.list_models():
        if preset.model_id == model_id:
            if not preset.supports_vision:
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{preset.name}' does not accept image input. "
                    "Select a vision-capable model or remove the images.",
                )
            return


@router.post("/sessions", response_model=Session)
async def create_session(req: CreateSessionRequest):
    session = _session_manager.create_session(req.title, req.context_type, req.project_id)
    return _session_to_response(session)


@router.get("/sessions", response_model=list[Session])
async def list_sessions():
    return [_session_to_response(s) for s in _session_manager.list_sessions()]


@router.get("/sessions/{session_id}", response_model=Session)
async def get_session(session_id: str):
    session = _session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_to_response(session)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    ok = _session_manager.delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@router.delete("/sessions")
async def delete_all_sessions():
    count = _session_manager.delete_all_sessions()
    return {"success": True, "deleted": count}


@router.put("/sessions/{session_id}/trace")
async def set_session_trace(session_id: str, req: SetTraceRequest):
    """Store a trace summary in the session for agentic tool access."""
    ok = _session_manager.set_trace_summary(session_id, req.summary)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


# REMOVED: entries→file refactor — PUT /sessions/{session_id}/file-path renamed to /source-path
@router.put("/sessions/{session_id}/source-path")
async def set_session_source_path(session_id: str, req: SetSourcePathRequest):
    """Register a local file or directory for lazy AI-driven analysis.

    Sets the source_path on the session (universal path for all file types).
    """
    # Empty path clears the session path
    raw_path = req.source_path.strip() if req.source_path else ""
    if not raw_path:
        ok = _session_manager.clear_source_path(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"success": True, "source_path": None}

    # Validate path and use canonical (normalized) path
    try:
        canonical = LogAnalyzer._validate_path(raw_path, allow_directory=True)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    ok = _session_manager.set_source_path(session_id, canonical)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "source_path": canonical}


# REMOVED: entries→file refactor — PUT /sessions/{session_id}/logs endpoint removed
# REMOVED: entries→file refactor — PUT /sessions/{session_id}/pcap endpoint removed
# REMOVED: entries→file refactor — PUT /sessions/{session_id}/hci endpoint removed


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest, request: Request):
    session = _session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ai_config = get_ai_config()
    ov = req.model_override
    effective_api_key = (
        ov.api_key if ov and ov.api_key and ov.api_key != "***" else ai_config.api_key
    )
    if not effective_api_key:
        raise HTTPException(status_code=400, detail="AI not configured. Please set API key.")

    ai_service = AIService(
        api_endpoint=ov.api_endpoint if ov else ai_config.api_endpoint,
        api_key=effective_api_key,
        model=ov.model if ov else ai_config.model,
        temperature=ov.temperature if ov and ov.temperature is not None else ai_config.temperature,
        thinking_mode=ov.thinking_mode
        if ov and ov.thinking_mode is not None
        else ai_config.thinking_mode,
        thinking_budget_tokens=ov.thinking_budget_tokens
        if ov and ov.thinking_budget_tokens is not None
        else ai_config.thinking_budget_tokens,
        use_anthropic=ov.anthropic_compatible
        if ov and ov.anthropic_compatible is not None
        else ai_config.anthropic_compatible,
    )

    # Build messages list from frontend-provided history.
    # The frontend manages conversation history in localStorage and sends
    # the full list with each request. For new sessions this is an empty list.
    # Inline images are validated up front so bad payloads fail fast, before any
    # provider call is made.
    message_attachments = _validate_attachments(req.attachments)
    if message_attachments:
        _assert_vision_capable(ov.model if ov else ai_config.model)

    messages: list[dict] = []
    if req.context:
        messages.append({"role": "system", "content": req.context})

    history = req.history or []
    for msg in history:
        entry: dict = {"role": msg.role, "content": msg.content}
        prior_attachments = _validate_attachments(msg.attachments)
        if prior_attachments:
            # Keep images from earlier turns attached so visual context persists.
            entry["attachments"] = prior_attachments
        messages.append(entry)

    user_message: dict = {"role": "user", "content": req.message}
    if message_attachments:
        user_message["attachments"] = message_attachments
    messages.append(user_message)

    # Resolve project (if any) and trace/data for agentic mode
    project = None
    if session.project_id:
        pm = get_project_manager()
        project = pm.get_project(session.project_id)

    trace_summary = session.trace_summary
    source_path = session.source_path

    logger.debug(
        "send_message — session=%s model=%s images=%d",
        session_id,
        ov.model if ov else ai_config.model,
        len(message_attachments),
    )

    async def event_stream():
        full_response = ""
        api_messages_out: list[dict] = []
        can_resume = (
            req.raw_api_messages
            and req.raw_api_messages_provider
            and req.raw_api_messages_provider
            == ("anthropic" if ai_service._use_anthropic else "openai")
        )
        try:
            async for chunk in ai_service.stream_chat_agentic(
                messages,
                project=project,
                trace_summary=trace_summary,
                source_path=source_path,
                api_messages_out=api_messages_out,
                resume_messages=req.raw_api_messages if can_resume else None,
                resume_provider=req.raw_api_messages_provider if can_resume else None,
                language=req.language,
            ):
                if await request.is_disconnected():
                    logger.debug(
                        "Client disconnected — stopping agentic stream for session %s",
                        session_id,
                    )
                    return
                if chunk.startswith("{"):
                    try:
                        event = json.loads(chunk)
                        if event.get("type") in (
                            "tool_call",
                            "tool_result",
                            "thinking",
                            "agent_meta",
                            "max_rounds_reached",
                        ):
                            yield _sse_encode(chunk)
                            continue
                    except json.JSONDecodeError:
                        pass
                full_response += chunk
                yield _sse_encode(chunk)

            yield _sse_encode(json.dumps({"_done": True}))
        except Exception as e:
            # ── Build rich error context for diagnosis ──────────────────────────
            exc_type = type(e).__name__
            exc_repr = repr(e)
            # Truncate extremely long repr strings (e.g. large response bodies)
            if len(exc_repr) > 4000:
                exc_repr = exc_repr[:4000] + f"... [truncated, total={len(exc_repr)}]"

            # Extract API-level details when the exception carries them
            # (anthropic.APIStatusError / openai.APIStatusError both expose these)
            api_status = getattr(e, "status_code", None)
            api_message = getattr(e, "message", None)
            api_body = getattr(e, "body", None)
            api_request_id = getattr(e, "request_id", None)

            effective_model = ov.model if ov else ai_config.model
            # Mask API key hostname from endpoint to avoid leaking it in logs
            effective_endpoint = (
                ov.api_endpoint if ov and ov.api_endpoint else ai_config.api_endpoint
            )
            try:
                endpoint_host = urlparse(effective_endpoint).hostname or "unknown"
            except Exception:
                endpoint_host = "unknown"

            logger.exception(
                "Error streaming AI response — "
                "session=%s model=%s endpoint=%s "
                "provider=%s api_spec=%s thinking=%s "
                "exc_type=%s exc_repr=%s "
                "api_status=%s api_message=%s api_body=%s request_id=%s "
                "history_msgs=%d has_project=%s has_source_path=%s",
                session_id,
                effective_model,
                endpoint_host,
                ai_service._provider,
                ai_service._api_spec,
                ov.thinking_mode
                if ov and ov.thinking_mode is not None
                else ai_config.thinking_mode,
                exc_type,
                exc_repr,
                api_status,
                api_message,
                api_body,
                api_request_id,
                len(history),
                bool(project),
                bool(source_path),
            )
            if not await request.is_disconnected():
                # Include exception type and status in the frontend error so the
                # user can see what went wrong without digging through logs.
                user_msg_parts = [f"[{exc_type}]"]
                if api_status:
                    user_msg_parts.append(f"(HTTP {api_status})")
                user_msg_parts.append(str(e))
                yield f"data: [ERROR] {' '.join(user_msg_parts)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

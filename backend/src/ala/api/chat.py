"""Multi-turn chat with streaming SSE."""

import json
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..services.ai_service import AIService
from ..services.log_analyzer import LogAnalyzer, PathTraversalError
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


class ChatMessage(BaseModel):
    role: str
    content: str


class Session(BaseModel):
    id: str
    title: str
    messages: list[ChatMessage]
    created_at: str
    context_type: str  # "log" | "trace" | "general"
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
    model_override: ModelOverride | None = None
    language: str | None = None  # UI language for AI responses (e.g. "en", "zh")


class SetTraceRequest(BaseModel):
    summary: dict


class SetFilePathRequest(BaseModel):
    """Set local file path for lazy log analysis (FEAT-LAZY-LOG)."""

    file_path: str


class SetLogsRequest(BaseModel):
    entries: list[dict]


def _session_to_response(session) -> Session:
    return Session(
        id=session.id,
        title=session.title,
        messages=[ChatMessage(role=m.role, content=m.content) for m in session.messages],
        created_at=session.created_at,
        context_type=session.context_type,
        project_id=session.project_id,
    )


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


@router.put("/sessions/{session_id}/trace")
async def set_session_trace(session_id: str, req: SetTraceRequest):
    """Store a trace summary in the session for agentic tool access."""
    ok = _session_manager.set_trace_summary(session_id, req.summary)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@router.put("/sessions/{session_id}/file-path")
async def set_session_file_path(session_id: str, req: SetFilePathRequest):
    """Register a local log file for lazy AI-driven analysis (FEAT-LAZY-LOG).

    Sets the file_path on the session and clears any previously loaded
    log_entries (they are mutually exclusive).
    """
    # Empty path clears the session file
    raw_path = req.file_path.strip() if req.file_path else ""
    if not raw_path:
        _session_manager.clear_file_path(session_id)
        return {"success": True, "file_path": None}

    # Validate path and use canonical (normalized) path
    try:
        canonical = LogAnalyzer._validate_path(raw_path)
    except PathTraversalError as e:
        raise HTTPException(status_code=403, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    ok = _session_manager.set_file_path(session_id, canonical)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "file_path": canonical}


@router.put("/sessions/{session_id}/logs")
async def set_session_logs(session_id: str, req: SetLogsRequest):
    """Store log entries in the session for agentic tool access (no hard limit).

    All entries from the frontend are stored in full.  The app is a desktop
    single-user tool, so per-session memory (~100 KB per 1 K log lines) is
    bounded by what a single user uploads, not by concurrent tenants.
    """
    entries = req.entries
    ok = _session_manager.set_log_entries(session_id, entries)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "stored": len(entries)}


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest, request: Request):
    session = _session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ai_config = get_ai_config()
    ov = req.model_override
    effective_api_key = ov.api_key if ov and ov.api_key else ai_config.api_key
    if not effective_api_key:
        raise HTTPException(status_code=400, detail="AI not configured. Please set API key.")

    # Add user message to session
    _session_manager.add_message(session_id, "user", req.message)

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

    # Build messages list including context if provided
    messages: list[dict] = []
    if req.context:
        messages.append({"role": "system", "content": req.context})

    for msg in session.messages:
        messages.append({"role": msg.role, "content": msg.content})

    # Resolve project (if any) and trace/log data for agentic mode
    project = None
    if session.project_id:
        pm = get_project_manager()
        project = pm.get_project(session.project_id)

    trace_summary = session.trace_summary
    log_entries = session.log_entries
    file_path = session.file_path

    logger.debug(
        "send_message — session=%s model=%s agentic=%s",
        session_id,
        ov.model if ov else ai_config.model,
        bool(project or trace_summary or log_entries is not None),
    )

    async def event_stream():
        full_response = ""
        api_messages_out: list[dict] = []
        current_provider = "anthropic" if ai_service._use_anthropic else "openai"
        try:
            if project or trace_summary or log_entries is not None or file_path is not None:
                # Agentic mode: project, trace, log, or lazy local file tools.
                # Resume from stored raw API messages if available and provider matches.
                async for chunk in ai_service.stream_chat_agentic(
                    messages,
                    project=project,
                    trace_summary=trace_summary,
                    log_entries=log_entries,
                    log_index=session.log_index,
                    file_path=file_path,
                    api_messages_out=api_messages_out,
                    resume_messages=session.raw_api_messages,
                    resume_provider=session.raw_api_messages_provider,
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
            else:
                # Simple streaming mode (thinking events still forwarded)
                async for chunk in ai_service.stream_chat(messages):
                    if await request.is_disconnected():
                        logger.debug(
                            "Client disconnected — stopping stream for session %s", session_id
                        )
                        return
                    if chunk.startswith("{"):
                        try:
                            event = json.loads(chunk)
                            if event.get("type") == "thinking":
                                yield _sse_encode(chunk)
                                continue
                        except json.JSONDecodeError:
                            pass
                    full_response += chunk
                    yield _sse_encode(chunk)

            # Save assistant message
            _session_manager.add_message(session_id, "assistant", full_response)
            # Persist full API message history (with tool-call blocks) for continuation.
            if api_messages_out:
                _session_manager.set_raw_api_messages(
                    session_id, api_messages_out, current_provider
                )
            yield "data: [DONE]\n\n"
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
                "provider=%s thinking=%s "
                "exc_type=%s exc_repr=%s "
                "api_status=%s api_message=%s api_body=%s request_id=%s "
                "session_msgs=%d has_project=%s has_file_path=%s has_log_entries=%s",
                session_id,
                effective_model,
                endpoint_host,
                "anthropic" if ai_service._use_anthropic else "openai",
                ov.thinking_mode
                if ov and ov.thinking_mode is not None
                else ai_config.thinking_mode,
                exc_type,
                exc_repr,
                api_status,
                api_message,
                api_body,
                api_request_id,
                len(session.messages),
                bool(project),
                bool(file_path),
                log_entries is not None,
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

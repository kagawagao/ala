"""Multi-turn chat with streaming SSE."""

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.ai_service import AIService
from ..services.session_manager import SessionManager
from .config import get_ai_config
from .projects import get_project_manager

router = APIRouter()
_session_manager = SessionManager()


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


class SendMessageRequest(BaseModel):
    message: str
    context: str | None = None  # Serialized log/trace context
    model_override: ModelOverride | None = None


class SetTraceRequest(BaseModel):
    summary: dict


class SetLogsRequest(BaseModel):
    entries: list[dict]


# Maximum number of log entries stored per session (tail-biased to catch recent errors)
_MAX_SESSION_LOGS = 10_000


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


@router.put("/sessions/{session_id}/logs")
async def set_session_logs(session_id: str, req: SetLogsRequest):
    """Store log entries in the session for agentic tool access (capped at MAX_SESSION_LOGS)."""
    entries = req.entries
    if len(entries) > _MAX_SESSION_LOGS:
        # Keep the tail (most recent entries are most likely to contain errors)
        entries = entries[-_MAX_SESSION_LOGS:]
    ok = _session_manager.set_log_entries(session_id, entries)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "stored": len(entries)}


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest):
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
        thinking_mode=ov.thinking_mode if ov and ov.thinking_mode else ai_config.thinking_mode,
        thinking_budget_tokens=ov.thinking_budget_tokens if ov and ov.thinking_budget_tokens is not None else ai_config.thinking_budget_tokens,
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

    async def event_stream():
        full_response = ""
        try:
            if project or trace_summary or log_entries is not None:
                # Agentic mode: project tools, trace tools, log tools, or any combination
                async for chunk in ai_service.stream_chat_agentic(
                    messages, project=project, trace_summary=trace_summary, log_entries=log_entries
                ):
                    if chunk.startswith("{"):
                        try:
                            event = json.loads(chunk)
                            if event.get("type") in ("tool_call", "tool_result", "thinking"):
                                yield _sse_encode(chunk)
                                continue
                        except json.JSONDecodeError:
                            pass
                    full_response += chunk
                    yield _sse_encode(chunk)
            else:
                # Simple streaming mode (thinking events still forwarded)
                async for chunk in ai_service.stream_chat(messages):
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
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

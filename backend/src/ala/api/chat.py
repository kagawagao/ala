"""Multi-turn chat with streaming SSE."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.ai_service import AIService
from ..services.session_manager import SessionManager
from .config import get_ai_config

router = APIRouter()
_session_manager = SessionManager()


class ChatMessage(BaseModel):
    role: str
    content: str


class Session(BaseModel):
    id: str
    title: str
    messages: list[ChatMessage]
    created_at: str
    context_type: str  # "log" | "trace" | "general"


class CreateSessionRequest(BaseModel):
    title: str = "New Session"
    context_type: str = "general"


class SendMessageRequest(BaseModel):
    message: str
    context: str | None = None  # Serialized log/trace context


def _session_to_response(session) -> Session:
    return Session(
        id=session.id,
        title=session.title,
        messages=[ChatMessage(role=m.role, content=m.content) for m in session.messages],
        created_at=session.created_at,
        context_type=session.context_type,
    )


@router.post("/sessions", response_model=Session)
async def create_session(req: CreateSessionRequest):
    session = _session_manager.create_session(req.title, req.context_type)
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


@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: SendMessageRequest):
    session = _session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ai_config = get_ai_config()
    if not ai_config.api_key:
        raise HTTPException(status_code=400, detail="AI not configured. Please set API key.")

    # Add user message to session
    _session_manager.add_message(session_id, "user", req.message)

    ai_service = AIService(
        api_endpoint=ai_config.api_endpoint,
        api_key=ai_config.api_key,
        model=ai_config.model,
        temperature=ai_config.temperature,
    )

    # Build messages list including context if provided
    messages: list[dict] = []
    if req.context:
        messages.append({"role": "system", "content": req.context})

    for msg in session.messages:
        messages.append({"role": msg.role, "content": msg.content})

    async def event_stream():
        full_response = ""
        try:
            async for chunk in ai_service.stream_chat(messages):
                full_response += chunk
                yield f"data: {chunk}\n\n"
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

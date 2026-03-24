"""In-memory session manager."""
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Message:
    role: str
    content: str
    timestamp: str = field(default_factory=_utcnow)


@dataclass
class Session:
    id: str
    title: str
    context_type: str
    messages: list[Message] = field(default_factory=list)
    created_at: str = field(default_factory=_utcnow)


class SessionManager:
    def __init__(self, max_sessions: int = 100):
        self._sessions: dict[str, Session] = {}
        self._max_sessions = max_sessions

    def create_session(self, title: str = "New Session", context_type: str = "general") -> Session:
        if len(self._sessions) >= self._max_sessions:
            # Remove oldest session
            oldest = next(iter(self._sessions))
            del self._sessions[oldest]
        session = Session(id=str(uuid.uuid4()), title=title, context_type=context_type)
        self._sessions[session.id] = session
        return session

    def get_session(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def list_sessions(self) -> list[Session]:
        return list(self._sessions.values())

    def delete_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def add_message(self, session_id: str, role: str, content: str) -> Message | None:
        session = self._sessions.get(session_id)
        if not session:
            return None
        msg = Message(role=role, content=content)
        session.messages.append(msg)
        return msg

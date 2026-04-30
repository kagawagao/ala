"""In-memory session manager."""

import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .agent_tools import LogIndex, build_log_index


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
    project_id: str | None = None
    messages: list[Message] = field(default_factory=list)
    created_at: str = field(default_factory=_utcnow)
    trace_summary: dict | None = None
    log_entries: list[dict[str, Any]] | None = None
    file_path: str | None = None  # FEAT-LAZY-LOG: local file path for lazy analysis
    log_index: LogIndex | None = None
    # Raw provider-specific API message history (including tool-call blocks).
    # Stored after each agentic exchange so follow-up messages can resume with
    # full tool-call context instead of text-only history.
    raw_api_messages: list[dict] | None = None
    raw_api_messages_provider: str | None = None  # "anthropic" | "openai"


class SessionManager:
    def __init__(self, max_sessions: int = 100):
        self._sessions: OrderedDict[str, Session] = OrderedDict()
        self._max_sessions = max_sessions

    def create_session(
        self,
        title: str = "New Session",
        context_type: str = "general",
        project_id: str | None = None,
    ) -> Session:
        if len(self._sessions) >= self._max_sessions:
            # Remove oldest session
            oldest = next(iter(self._sessions))
            del self._sessions[oldest]
        session = Session(
            id=str(uuid.uuid4()), title=title, context_type=context_type, project_id=project_id
        )
        self._sessions[session.id] = session
        return session

    def get_session(self, session_id: str) -> Session | None:
        session = self._sessions.get(session_id)
        if session is not None:
            self._sessions.move_to_end(session_id)
        return session

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

    def set_trace_summary(self, session_id: str, summary: dict) -> bool:
        """Store a parsed trace summary in the session for agentic tool access."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.trace_summary = summary
        return True

    def set_file_path(self, session_id: str, path: str) -> bool:
        """Set local file path for lazy analysis. Clears log_entries and log_index."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.file_path = path
        session.log_entries = None
        session.log_index = None
        return True

    def get_file_path(self, session_id: str) -> str | None:
        """Get the local file path for the session, if set."""
        session = self._sessions.get(session_id)
        if not session:
            return None
        return session.file_path

    def clear_file_path(self, session_id: str) -> bool:
        """Clear the file path from the session. Returns False if session not found."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.file_path = None
        return True

    def set_log_entries(self, session_id: str, entries: list[dict[str, Any]]) -> bool:
        """Store log entries in the session for agentic tool access."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.log_entries = entries
        session.file_path = None  # Mutually exclusive with file_path
        session.log_index = build_log_index(entries)
        return True

    def set_raw_api_messages(self, session_id: str, messages: list[dict], provider: str) -> bool:
        """Persist the raw provider-specific API message list (including tool-call
        blocks) so that subsequent agentic requests can resume with full context."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.raw_api_messages = messages
        session.raw_api_messages_provider = provider
        return True

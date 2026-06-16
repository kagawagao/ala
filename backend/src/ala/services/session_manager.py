"""Session manager — stores session metadata + context data in SQLite.
Conversation history is managed by the frontend (localStorage); the backend
receives the full message list with each request.
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .agent_tools import LogIndex, build_log_index
from .database import get_db


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Message:
    role: str
    content: str
    timestamp: str = field(default_factory=_utcnow)
    parts: str | None = None  # JSON array of structured message parts


@dataclass
class Session:
    id: str
    title: str
    context_type: str
    project_id: str | None = None
    created_at: str = field(default_factory=_utcnow)
    trace_summary: dict | None = None
    log_entries: list[dict[str, Any]] | None = None
    pcap_entries: list[dict[str, Any]] | None = None  # Network capture packets
    hci_entries: list[dict[str, Any]] | None = None  # Bluetooth HCI packets
    file_path: str | None = None  # FEAT-LAZY-LOG: local file path for lazy analysis
    log_index: LogIndex | None = None


class SessionManager:
    def __init__(self, max_sessions: int = 100, db=None):
        self._max_sessions = max_sessions
        self._db = db if db is not None else get_db()
        self._log_index_cache: dict[str, LogIndex] = {}

    def _row_to_session(self, row) -> Session:
        """Reconstruct a Session dataclass from a sqlite3.Row (or dict)."""
        sid = row["id"]
        return Session(
            id=sid,
            title=row["title"],
            context_type=row["context_type"],
            project_id=row["project_id"],
            created_at=row["created_at"],
            trace_summary=json.loads(row["trace_summary"]) if row["trace_summary"] else None,
            log_entries=json.loads(row["log_entries"]) if row["log_entries"] else None,
            pcap_entries=json.loads(row["pcap_entries"]) if row["pcap_entries"] else None,
            hci_entries=json.loads(row["hci_entries"]) if row["hci_entries"] else None,
            file_path=row["file_path"],
            log_index=self._log_index_cache.get(sid),
        )

    def create_session(
        self,
        title: str = "New Session",
        context_type: str = "general",
        project_id: str | None = None,
    ) -> Session:
        # LRU eviction: if at capacity, delete oldest and clean cache
        cur = self._db.execute("SELECT COUNT(*) FROM sessions")
        if cur.fetchone()[0] >= self._max_sessions:
            evict_cur = self._db.execute("SELECT id FROM sessions ORDER BY created_at ASC LIMIT 1")
            evict_row = evict_cur.fetchone()
            if evict_row:
                evicted_id = evict_row[0]
                self._db.execute("DELETE FROM sessions WHERE id = ?", (evicted_id,))
                self._log_index_cache.pop(evicted_id, None)
        session = Session(
            id=str(uuid.uuid4()), title=title, context_type=context_type, project_id=project_id
        )
        self._db.execute(
            "INSERT INTO sessions (id, title, context_type, project_id, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                session.id,
                session.title,
                session.context_type,
                session.project_id,
                session.created_at,
            ),
        )
        self._db.commit()
        return session

    def get_session(self, session_id: str) -> Session | None:
        row = self._db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_session(row)

    def list_sessions(self) -> list[Session]:
        rows = self._db.execute("SELECT * FROM sessions ORDER BY created_at DESC").fetchall()
        return [self._row_to_session(row) for row in rows]

    def delete_session(self, session_id: str) -> bool:
        cur = self._db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        self._db.commit()
        self._log_index_cache.pop(session_id, None)
        return cur.rowcount > 0

    def delete_all_sessions(self) -> int:
        cur = self._db.execute("DELETE FROM sessions")
        self._db.commit()
        self._log_index_cache.clear()
        return cur.rowcount

    def set_trace_summary(self, session_id: str, summary: dict) -> bool:
        cur = self._db.execute(
            "UPDATE sessions SET trace_summary = ? WHERE id = ?",
            (json.dumps(summary), session_id),
        )
        self._db.commit()
        return cur.rowcount > 0

    def set_file_path(self, session_id: str, path: str) -> bool:
        """Set local file path for lazy analysis (keeps existing log_entries if any)."""
        cur = self._db.execute(
            "UPDATE sessions SET file_path = ? WHERE id = ?",
            (path, session_id),
        )
        self._db.commit()
        self._log_index_cache.pop(session_id, None)
        return cur.rowcount > 0

    def get_file_path(self, session_id: str) -> str | None:
        """Get the local file path for the session, if set."""
        row = self._db.execute(
            "SELECT file_path FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return row["file_path"]

    def clear_file_path(self, session_id: str) -> bool:
        """Clear the file path from the session. Returns False if session not found."""
        cur = self._db.execute("UPDATE sessions SET file_path = NULL WHERE id = ?", (session_id,))
        self._db.commit()
        return cur.rowcount > 0

    def set_log_entries(self, session_id: str, entries: list[dict[str, Any]]) -> bool:
        """Store log entries in the session for agentic tool access (keeps existing file_path if any)."""
        # Verify session exists first
        exists = self._db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            return False
        self._db.execute(
            "UPDATE sessions SET log_entries = ? WHERE id = ?",
            (json.dumps(entries), session_id),
        )
        self._db.commit()
        # Build and cache the runtime log index
        self._log_index_cache[session_id] = build_log_index(entries)
        return True

    def set_pcap_entries(self, session_id: str, entries: list[dict[str, Any]]) -> bool:
        """Store PCAP entries in the session for agentic tool access."""
        # Verify session exists first
        exists = self._db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            return False
        self._db.execute(
            "UPDATE sessions SET pcap_entries = ? WHERE id = ?",
            (json.dumps(entries), session_id),
        )
        self._db.commit()
        return True

    def set_hci_entries(self, session_id: str, entries: list[dict[str, Any]]) -> bool:
        """Store HCI entries in the session for agentic tool access."""
        exists = self._db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not exists:
            return False
        self._db.execute(
            "UPDATE sessions SET hci_entries = ? WHERE id = ?",
            (json.dumps(entries), session_id),
        )
        self._db.commit()
        return True

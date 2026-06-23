"""Session manager — stores session metadata + context data in SQLite.
Conversation history is managed by the frontend (localStorage); the backend
receives the full message list with each request.
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

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
    # REMOVED: entries→file refactor — log_entries, pcap_entries, hci_entries, log_index fields removed
    source_path: str | None = None  # Universal file/directory path for all analysis


class SessionManager:
    def __init__(self, max_sessions: int = 100, db=None):
        self._max_sessions = max_sessions
        self._db = db if db is not None else get_db()

    def _row_to_session(self, row) -> Session:
        """Reconstruct a Session dataclass from a sqlite3.Row (or dict)."""
        sid = row["id"]
        # REMOVED: entries→file refactor — log_entries, pcap_entries, hci_entries, log_index deserialization removed
        return Session(
            id=sid,
            title=row["title"],
            context_type=row["context_type"],
            project_id=row["project_id"],
            created_at=row["created_at"],
            trace_summary=json.loads(row["trace_summary"]) if row["trace_summary"] else None,
            source_path=row["source_path"] if "source_path" in row.keys() else None,
        )

    def create_session(
        self,
        title: str = "New Session",
        context_type: str = "general",
        project_id: str | None = None,
    ) -> Session:
        # LRU eviction: if at capacity, delete oldest
        cur = self._db.execute("SELECT COUNT(*) FROM sessions")
        if cur.fetchone()[0] >= self._max_sessions:
            evict_cur = self._db.execute("SELECT id FROM sessions ORDER BY created_at ASC LIMIT 1")
            evict_row = evict_cur.fetchone()
            if evict_row:
                evicted_id = evict_row[0]
                self._db.execute("DELETE FROM sessions WHERE id = ?", (evicted_id,))
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
        return cur.rowcount > 0

    def delete_all_sessions(self) -> int:
        cur = self._db.execute("DELETE FROM sessions")
        self._db.commit()
        return cur.rowcount

    def set_trace_summary(self, session_id: str, summary: dict) -> bool:
        cur = self._db.execute(
            "UPDATE sessions SET trace_summary = ? WHERE id = ?",
            (json.dumps(summary), session_id),
        )
        self._db.commit()
        return cur.rowcount > 0

    def set_source_path(self, session_id: str, path: str) -> bool:
        """Set universal source path for file-based analysis."""
        cur = self._db.execute(
            "UPDATE sessions SET source_path = ? WHERE id = ?",
            (path, session_id),
        )
        self._db.commit()
        return cur.rowcount > 0

    def get_source_path(self, session_id: str) -> str | None:
        """Get the source path for the session, if set."""
        row = self._db.execute(
            "SELECT source_path FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return row["source_path"]

    def clear_source_path(self, session_id: str) -> bool:
        """Clear the source path from the session. Returns False if session not found."""
        cur = self._db.execute("UPDATE sessions SET source_path = NULL WHERE id = ?", (session_id,))
        self._db.commit()
        return cur.rowcount > 0

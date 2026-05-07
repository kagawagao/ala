"""SQLite database singleton with auto-migration and JSON import."""

import json
import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)

_db: sqlite3.Connection | None = None


def _db_path() -> Path:
    return Path.home() / ".ala" / "ala.db"


def _projects_json_path() -> Path:
    return Path.home() / ".ala" / "projects.json"


def _migrate(conn: sqlite3.Connection) -> None:
    """Create all tables if they don't exist (idempotent)."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'New Session',
            context_type TEXT NOT NULL DEFAULT 'general',
            project_id TEXT,
            created_at TEXT NOT NULL,
            trace_summary TEXT,
            log_entries TEXT,
            file_path TEXT,
            raw_api_messages TEXT,
            raw_api_messages_provider TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, timestamp);

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            filter_presets TEXT
        );

        CREATE TABLE IF NOT EXISTS project_paths (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            ordering INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_project_paths_project_id ON project_paths(project_id);

        CREATE TABLE IF NOT EXISTS project_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            pattern TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('include', 'exclude')),
            ordering INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_project_patterns_project_id ON project_patterns(project_id);

        CREATE TABLE IF NOT EXISTS _ala_schema_version (
            version INTEGER PRIMARY KEY
        );
    """
    )
    # Record schema version if not already set
    cur = conn.execute("SELECT COUNT(*) FROM _ala_schema_version")
    if cur.fetchone()[0] == 0:
        conn.execute("INSERT INTO _ala_schema_version (version) VALUES (1)")


def _import_projects_json(conn: sqlite3.Connection) -> None:
    """If DB has no projects and ~/.ala/projects.json exists, import it."""
    cur = conn.execute("SELECT COUNT(*) FROM projects")
    if cur.fetchone()[0] > 0:
        return  # Already have projects

    json_path = _projects_json_path()
    if not json_path.exists():
        return

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return
    except (json.JSONDecodeError, OSError):
        logger.warning("Failed to read projects.json for import", exc_info=True)
        return

    imported = 0
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            pid = item["id"]
            name = item["name"]
            created_at = item.get("created_at", "")
            filter_presets = (
                json.dumps(item.get("filter_presets", [])) if item.get("filter_presets") else None
            )
            paths = item.get("paths", [])
            include_patterns = item.get("include_patterns", [])
            exclude_patterns = item.get("exclude_patterns", [])

            conn.execute(
                "INSERT INTO projects (id, name, created_at, filter_presets) VALUES (?, ?, ?, ?)",
                (pid, name, created_at, filter_presets),
            )
            for i, p in enumerate(paths):
                conn.execute(
                    "INSERT INTO project_paths (project_id, path, ordering) VALUES (?, ?, ?)",
                    (pid, p, i),
                )
            for i, p in enumerate(include_patterns):
                conn.execute(
                    "INSERT INTO project_patterns (project_id, pattern, type, ordering) VALUES (?, ?, 'include', ?)",
                    (pid, p, i),
                )
            for i, p in enumerate(exclude_patterns):
                conn.execute(
                    "INSERT INTO project_patterns (project_id, pattern, type, ordering) VALUES (?, ?, 'exclude', ?)",
                    (pid, p, i),
                )
            imported += 1
        except (KeyError, sqlite3.Error):
            logger.warning("Skipping malformed project entry during import", exc_info=True)

    if imported > 0:
        conn.commit()
        logger.info("Imported %d projects from projects.json → SQLite", imported)


def get_db() -> sqlite3.Connection:
    """Return the singleton SQLite connection, initializing on first call."""
    global _db
    if _db is not None:
        return _db

    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    _db = sqlite3.connect(str(path), check_same_thread=False)
    _db.row_factory = sqlite3.Row
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute("PRAGMA foreign_keys=ON")

    _migrate(_db)
    _import_projects_json(_db)

    logger.info("SQLite database initialized at %s", path)
    return _db

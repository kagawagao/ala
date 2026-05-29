"""Test configuration — provides isolated in-memory SQLite DB for all tests."""

import os
import sqlite3

import pytest

from ala.services import database
from ala.services.project_manager import ProjectManager
from ala.services.session_manager import SessionManager


def _make_memory_db():
    """Create a fresh in-memory SQLite database with full schema."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    database._migrate(conn)
    return conn


# ── Pre-import isolation ──
# Test modules that import `ala.main` (e.g. test_api.py) trigger the creation
# of the *persistent* DB via ProjectManager() → get_db().  That also runs
# _import_projects_json() which copies legacy projects.json into the DB.
# Monkeypatch get_db() at conftest load time so the very first call already
# uses an in-memory database — no persistent DB is ever touched by tests.
_SHARED_MEM_DB = _make_memory_db()
database._db = _SHARED_MEM_DB
database.get_db = lambda: _SHARED_MEM_DB  # type: ignore[assignment]


@pytest.fixture(autouse=True)
def _isolate_db(monkeypatch):
    """Replace the DB singleton and API singletons with fresh instances per test."""
    conn = _make_memory_db()
    monkeypatch.setattr(database, "_db", conn)
    monkeypatch.setattr(database, "get_db", lambda: conn)

    import ala.api.chat
    import ala.api.projects

    monkeypatch.setattr(
        ala.api.chat,
        "_session_manager",
        SessionManager(max_sessions=10),
    )
    monkeypatch.setattr(
        ala.api.projects,
        "_project_manager",
        ProjectManager(db=conn),
    )

    yield
    conn.close()


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "benchmark: performance benchmark tests; set ALA_RUN_BENCHMARKS=1 to enable",
    )


def pytest_collection_modifyitems(items):
    if os.environ.get("ALA_RUN_BENCHMARKS") == "1":
        return

    skip_benchmark = pytest.mark.skip(reason="set ALA_RUN_BENCHMARKS=1 to run benchmark tests")
    for item in items:
        if "benchmark" in item.keywords:
            item.add_marker(skip_benchmark)

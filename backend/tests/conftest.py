"""Test configuration — provides isolated in-memory SQLite DB for all tests."""

import os
import sqlite3

import pytest

from ala.services import database


def _make_memory_db():
    """Create a fresh in-memory SQLite database with full schema."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    database._migrate(conn)
    return conn


@pytest.fixture(autouse=True)
def _isolate_db(monkeypatch):
    """Replace the DB singleton with an in-memory database for each test."""
    conn = _make_memory_db()
    monkeypatch.setattr(database, "_db", conn)
    monkeypatch.setattr(database, "get_db", lambda: conn)
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

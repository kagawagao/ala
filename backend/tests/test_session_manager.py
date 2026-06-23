"""Tests for the session manager."""

import pytest

from ala.services.session_manager import Message, Session, SessionManager

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mgr():
    """Return a fresh SessionManager for each test."""
    return SessionManager(max_sessions=10)


@pytest.fixture
def session(mgr):
    """Create a single session and return (mgr, session)."""
    s = mgr.create_session("Test Session", "general")
    return mgr, s


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------


class TestCreateSession:
    def test_create_returns_session(self, mgr):
        s = mgr.create_session("My Session", "log")
        assert isinstance(s, Session)
        assert s.title == "My Session"
        assert s.context_type == "log"
        assert s.id
        assert s.created_at

    def test_create_with_project_id(self, mgr):
        s = mgr.create_session("Project Session", "general", project_id="proj-1")
        assert s.project_id == "proj-1"

    def test_create_defaults(self, mgr):
        s = mgr.create_session()
        assert s.title == "New Session"
        assert s.context_type == "general"

    def test_create_evicts_oldest_when_full(self):
        mgr = SessionManager(max_sessions=2)
        s1 = mgr.create_session("S1")
        s2 = mgr.create_session("S2")
        s3 = mgr.create_session("S3")

        # s1 should be evicted
        assert mgr.get_session(s1.id) is None
        assert mgr.get_session(s2.id) is not None
        assert mgr.get_session(s3.id) is not None


class TestGetSession:
    def test_get_existing(self, session):
        mgr, s = session
        found = mgr.get_session(s.id)
        assert found is not None
        assert found.id == s.id
        assert found.title == "Test Session"

    def test_get_nonexistent_returns_none(self, mgr):
        assert mgr.get_session("nonexistent-id") is None


class TestListSessions:
    def test_list_empty(self, mgr):
        assert mgr.list_sessions() == []

    def test_list_multiple(self, mgr):
        s1 = mgr.create_session("S1")
        s2 = mgr.create_session("S2")
        sessions = mgr.list_sessions()
        assert len(sessions) == 2
        ids = {s.id for s in sessions}
        assert s1.id in ids
        assert s2.id in ids


class TestDeleteSession:
    def test_delete_existing(self, session):
        mgr, s = session
        ok = mgr.delete_session(s.id)
        assert ok is True
        assert mgr.get_session(s.id) is None

    def test_delete_nonexistent_returns_false(self, mgr):
        ok = mgr.delete_session("nonexistent-id")
        assert ok is False


# ---------------------------------------------------------------------------
# Context binding
# ---------------------------------------------------------------------------


class TestSourcePathContext:
    """Tests for the unified source_path (renamed from file_path)."""

    def test_set_source_path(self, session):
        mgr, s = session
        ok = mgr.set_source_path(s.id, "/var/log/system.log")
        assert ok is True
        found = mgr.get_session(s.id)
        assert found.source_path == "/var/log/system.log"

    def test_get_source_path(self, session):
        mgr, s = session
        mgr.set_source_path(s.id, "/tmp/test.log")
        path = mgr.get_source_path(s.id)
        assert path == "/tmp/test.log"

    def test_get_source_path_nonexistent(self, mgr):
        assert mgr.get_source_path("nonexistent-id") is None

    def test_clear_source_path(self, session):
        mgr, s = session
        mgr.set_source_path(s.id, "/tmp/test.log")
        ok = mgr.clear_source_path(s.id)
        assert ok is True
        assert mgr.get_session(s.id).source_path is None

    def test_clear_source_path_nonexistent(self, mgr):
        ok = mgr.clear_source_path("nonexistent-id")
        assert ok is False

    def test_set_source_path_nonexistent(self, mgr):
        ok = mgr.set_source_path("nonexistent-id", "/tmp/test.log")
        assert ok is False


class TestTraceContext:
    def test_set_trace_summary(self, session):
        mgr, s = session
        summary = {"format": "json_trace", "processes": [{"name": "app"}]}
        ok = mgr.set_trace_summary(s.id, summary)
        assert ok is True
        found = mgr.get_session(s.id)
        assert found.trace_summary == summary

    def test_set_trace_summary_nonexistent(self, mgr):
        ok = mgr.set_trace_summary("nonexistent-id", {})
        assert ok is False


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_session_with_all_fields(self, mgr):
        s = mgr.create_session("Full", "log", project_id="p1")
        mgr.set_trace_summary(s.id, {"format": "json_trace"})
        mgr.set_source_path(s.id, "/tmp/test.log")

        found = mgr.get_session(s.id)
        assert found.title == "Full"
        assert found.context_type == "log"
        assert found.project_id == "p1"
        assert found.trace_summary is not None
        assert found.source_path == "/tmp/test.log"

    def test_message_dataclass(self):
        msg = Message(role="user", content="test")
        assert msg.role == "user"
        assert msg.content == "test"
        assert msg.timestamp

    def test_session_dataclass_initial_state(self):
        s = Session(
            id="test-id",
            title="Test",
            context_type="general",
        )
        assert s.trace_summary is None
        assert s.source_path is None

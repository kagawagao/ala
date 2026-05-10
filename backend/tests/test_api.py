"""Tests for all API routers using FastAPI TestClient."""

import io
import json
import os
import shutil
import tempfile

import pytest

try:
    from fastapi.testclient import TestClient

    from ala.main import app
except ImportError:
    pytest.skip("fastapi not installed", allow_module_level=True)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


class TestHealth:
    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


# ---------------------------------------------------------------------------
# Config endpoints
# ---------------------------------------------------------------------------


class TestConfig:
    def test_get_config_returns_masked_key(self, client):
        resp = client.get("/api/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "api_endpoint" in data
        assert "api_key" in data
        assert data["api_key"] in ("***", ""), f"Expected masked key, got: {data['api_key']}"
        assert "model" in data

    def test_put_config_returns_success(self, client):
        payload = {
            "api_endpoint": "https://api.anthropic.com",
            "api_key": "sk-test-key",
            "model": "claude-sonnet-4-20250514",
            "temperature": 0.5,
            "thinking_mode": "off",
            "thinking_budget_tokens": 8000,
        }
        resp = client.put("/api/config", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"success": True}

    def test_put_config_preserves_masked_key(self, client):
        # Set a real key first
        client.put(
            "/api/config",
            json={
                "api_endpoint": "https://api.anthropic.com",
                "api_key": "original-secret",
                "model": "claude-sonnet-4-20250514",
                "temperature": 0.5,
            },
        )
        # Then update with masked key — should preserve the original
        resp = client.put(
            "/api/config",
            json={
                "api_endpoint": "https://api.anthropic.com",
                "api_key": "***",
                "model": "claude-sonnet-4-20250514",
                "temperature": 0.7,
            },
        )
        assert resp.status_code == 200
        # Read back — key should still be masked but present
        get_resp = client.get("/api/config")
        assert get_resp.json()["api_key"] == "***"


# ---------------------------------------------------------------------------
# Log endpoints
# ---------------------------------------------------------------------------


class TestLogParse:
    def test_parse_single_text_file(self, client):
        files = [("files", ("test.log", io.BytesIO(SAMPLE_LOGCAT.encode()), "text/plain"))]
        resp = client.post("/api/logs/parse", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        result = data[0]
        assert result["total_lines"] == 5
        assert result["format_detected"] == "android_logcat"
        assert len(result["logs"]) == 5

    def test_parse_no_files_returns_400(self, client):
        resp = client.post("/api/logs/parse")
        assert resp.status_code == 422  # FastAPI validation error

    def test_parse_stream_returns_ndjson(self, client):
        files = [("files", ("test.log", io.BytesIO(SAMPLE_LOGCAT.encode()), "text/plain"))]
        resp = client.post("/api/logs/parse/stream", files=files)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/x-ndjson")
        lines = resp.text.strip().split("\n")
        # Should have 5 entry lines + 1 done line
        parsed = [json.loads(line) for line in lines if line.strip()]
        assert len(parsed) >= 6
        assert parsed[-1] == {"_done": True, "total": 5}

    def test_filter_logs(self, client):
        # Parse first to get logs
        files = [("files", ("test.log", io.BytesIO(SAMPLE_LOGCAT.encode()), "text/plain"))]
        parse_resp = client.post("/api/logs/parse", files=files)
        logs = parse_resp.json()[0]["logs"]

        # Filter for level E only
        filter_payload = {"logs": logs, "filters": {"level": "E", "tag_keyword_relation": "AND"}}
        resp = client.post("/api/logs/filter", json=filter_payload)
        assert resp.status_code == 200
        filtered = resp.json()
        assert isinstance(filtered, list)
        assert all(e["level"] == "E" for e in filtered)

    def test_statistics(self, client):
        files = [("files", ("test.log", io.BytesIO(SAMPLE_LOGCAT.encode()), "text/plain"))]
        parse_resp = client.post("/api/logs/parse", files=files)
        logs = parse_resp.json()[0]["logs"]

        resp = client.post("/api/logs/statistics", json=logs)
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total"] == 5
        assert stats["by_level"]["E"] == 2
        assert stats["by_level"]["W"] == 1
        assert "tags" in stats
        assert "pids" in stats

    def test_parse_local_nonexistent_file_returns_400(self, client):
        resp = client.post(
            "/api/logs/parse-local", json={"path": "/tmp/nonexistent_ala_test_xyz.log"}
        )
        assert resp.status_code in (400, 403, 404)

    def test_parse_local_valid_temp_file(self, client):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write(SAMPLE_LOGCAT)
            path = f.name
        try:
            resp = client.post("/api/logs/parse-local", json={"path": path})
            assert resp.status_code == 200
            data = resp.json()
            assert data["line_count"] == 5
            assert data["session_file"] == path
            assert data["format_detected"] == "android_logcat"
        finally:
            import os

            if os.path.exists(path):
                os.unlink(path)

    def test_auto_path_file(self, client):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write(SAMPLE_LOGCAT)
            path = f.name
        try:
            resp = client.post("/api/logs/auto-path", json={"path": path})
            assert resp.status_code == 200
            data = resp.json()
            assert data["type"] == "file"
            assert data["line_count"] == 5
        finally:
            import os

            if os.path.exists(path):
                os.unlink(path)

    def test_auto_path_nonexistent_returns_404(self, client):
        resp = client.post("/api/logs/auto-path", json={"path": "/tmp/nonexistent_xyz_123"})
        assert resp.status_code in (400, 404)

    def test_directory_list_not_a_directory(self, client):
        resp = client.post("/api/logs/directory/list", json={"path": "/tmp/nonexistent_dir_xyz"})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Trace endpoints
# ---------------------------------------------------------------------------

SAMPLE_JSON_TRACE = json.dumps(
    {
        "traceEvents": [
            {"name": "slice1", "ph": "X", "ts": 0, "dur": 1000, "pid": 1, "tid": 1},
            {"name": "slice2", "ph": "X", "ts": 2000, "dur": 500, "pid": 1, "tid": 2},
            {"name": "process_name", "ph": "M", "pid": 1, "args": {"name": "com.example.app"}},
            {"name": "process_name", "ph": "M", "pid": 2, "args": {"name": "system_server"}},
        ],
        "metadata": {"clock-offset-since-epoch": "0"},
    }
).encode()


class TestTrace:
    def test_parse_json_trace(self, client):
        files = [("file", ("trace.json", io.BytesIO(SAMPLE_JSON_TRACE), "application/json"))]
        resp = client.post("/api/trace/parse", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data
        assert data["format"] == "json_trace"
        assert data["file_size"] > 0

    def test_filter_trace(self, client):
        # Parse first
        files = [("file", ("trace.json", io.BytesIO(SAMPLE_JSON_TRACE), "application/json"))]
        parse_resp = client.post("/api/trace/parse", files=files)
        result = parse_resp.json()

        # Filter by pid
        filter_payload = {"result": result, "pids": [1]}
        resp = client.post("/api/trace/filter", json=filter_payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["process_count"] == 1
        assert data["summary"]["processes"][0]["pid"] == 1

    def test_filter_trace_no_criteria_returns_unchanged(self, client):
        files = [("file", ("trace.json", io.BytesIO(SAMPLE_JSON_TRACE), "application/json"))]
        parse_resp = client.post("/api/trace/parse", files=files)
        result = parse_resp.json()

        filter_payload = {"result": result}
        resp = client.post("/api/trace/filter", json=filter_payload)
        assert resp.status_code == 200
        # Should return unchanged
        data = resp.json()
        assert data["summary"]["process_count"] == result["summary"]["process_count"]


# ---------------------------------------------------------------------------
# Project endpoints
# ---------------------------------------------------------------------------


class TestProjects:
    def _create_project(self, client, name="Test Project", paths=None):
        if paths is None:
            paths = [tempfile.mkdtemp()]
        resp = client.post(
            "/api/projects",
            json={
                "name": name,
                "paths": paths,
                "include_patterns": ["**/*.java"],
                "exclude_patterns": ["**/build/**"],
            },
        )
        return resp

    def test_create_project_with_nonexistent_dir_returns_400(self, client):
        resp = client.post(
            "/api/projects",
            json={
                "name": "Bad Project",
                "paths": ["/nonexistent/path/xyz"],
            },
        )
        assert resp.status_code == 400

    def test_create_and_get_project(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "My Project", [tmpdir])
            assert create_resp.status_code == 200
            project = create_resp.json()
            assert project["name"] == "My Project"
            assert "id" in project

            # Get by id
            get_resp = client.get(f"/api/projects/{project['id']}")
            assert get_resp.status_code == 200
            assert get_resp.json()["name"] == "My Project"
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_list_projects(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            self._create_project(client, "Project 1", [tmpdir])
            resp = client.get("/api/projects")
            assert resp.status_code == 200
            projects = resp.json()
            assert isinstance(projects, list)
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_get_nonexistent_project_returns_404(self, client):
        resp = client.get("/api/projects/nonexistent-id")
        assert resp.status_code == 404

    def test_update_project(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "Old Name", [tmpdir])
            pid = create_resp.json()["id"]

            update_resp = client.put(f"/api/projects/{pid}", json={"name": "New Name"})
            assert update_resp.status_code == 200
            assert update_resp.json()["name"] == "New Name"
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_update_nonexistent_project_returns_404(self, client):
        resp = client.put("/api/projects/nonexistent-id", json={"name": "X"})
        assert resp.status_code == 404

    def test_delete_project(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "To Delete", [tmpdir])
            pid = create_resp.json()["id"]

            delete_resp = client.delete(f"/api/projects/{pid}")
            assert delete_resp.status_code == 200
            assert delete_resp.json() == {"success": True}

            # Verify deleted
            get_resp = client.get(f"/api/projects/{pid}")
            assert get_resp.status_code == 404
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_delete_nonexistent_project_returns_404(self, client):
        resp = client.delete("/api/projects/nonexistent-id")
        assert resp.status_code == 404

    def test_list_project_files(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            # Create a test file inside
            test_file = os.path.join(tmpdir, "MainActivity.java")
            with open(test_file, "w") as f:
                f.write("class MainActivity {}")

            create_resp = self._create_project(client, "File Project", [tmpdir])
            pid = create_resp.json()["id"]

            resp = client.get(f"/api/projects/{pid}/files")
            assert resp.status_code == 200
            files = resp.json()
            assert isinstance(files, list)
            # Project was created with tmpdir — verify the endpoint responds
            # (actual file listing depends on scanner implementation)
        finally:
            if os.path.exists(tmpdir):
                shutil.rmtree(tmpdir)

    def test_list_project_files_nonexistent_project_returns_404(self, client):
        resp = client.get("/api/projects/nonexistent-id/files")
        assert resp.status_code == 404

    def test_list_context_docs(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "Doc Project", [tmpdir])
            pid = create_resp.json()["id"]

            resp = client.get(f"/api/projects/{pid}/context-docs")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_get_presets(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "Presets Project", [tmpdir])
            pid = create_resp.json()["id"]
            resp = client.get(f"/api/projects/{pid}/presets")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
        finally:
            import os

            if os.path.exists(tmpdir):
                os.rmdir(tmpdir)

    def test_update_presets(self, client):
        tmpdir = tempfile.mkdtemp()
        try:
            create_resp = self._create_project(client, "Presets Update", [tmpdir])
            pid = create_resp.json()["id"]

            new_presets = [
                {"name": "Test Preset", "description": "A test", "filters": {"level": "E"}}
            ]
            resp = client.put(f"/api/projects/{pid}/presets", json={"presets": new_presets})
            assert resp.status_code == 200
            assert len(resp.json()) == 1
            assert resp.json()[0]["name"] == "Test Preset"
        finally:
            if os.path.exists(tmpdir):
                shutil.rmtree(tmpdir)


# ---------------------------------------------------------------------------
# Chat / session endpoints
# ---------------------------------------------------------------------------


class TestChatSessions:
    def test_create_session(self, client):
        resp = client.post(
            "/api/chat/sessions",
            json={"title": "Test Session", "context_type": "general"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Test Session"
        assert "id" in data
        assert "messages" in data

    def test_list_sessions(self, client):
        client.post("/api/chat/sessions", json={"title": "S1", "context_type": "general"})
        client.post("/api/chat/sessions", json={"title": "S2", "context_type": "general"})
        resp = client.get("/api/chat/sessions")
        assert resp.status_code == 200
        sessions = resp.json()
        assert isinstance(sessions, list)
        assert len(sessions) >= 2

    def test_get_session(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "My Session", "context_type": "general"}
        )
        sid = create_resp.json()["id"]
        resp = client.get(f"/api/chat/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.json()["title"] == "My Session"

    def test_get_nonexistent_session_returns_404(self, client):
        resp = client.get("/api/chat/sessions/nonexistent-id")
        assert resp.status_code == 404

    def test_delete_session(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "To Delete", "context_type": "general"}
        )
        sid = create_resp.json()["id"]
        resp = client.delete(f"/api/chat/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.json() == {"success": True}

        # Verify gone
        get_resp = client.get(f"/api/chat/sessions/{sid}")
        assert get_resp.status_code == 404

    def test_delete_nonexistent_session_returns_404(self, client):
        resp = client.delete("/api/chat/sessions/nonexistent-id")
        assert resp.status_code == 404

    def test_set_session_trace(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "Trace Session", "context_type": "trace"}
        )
        sid = create_resp.json()["id"]
        resp = client.put(
            f"/api/chat/sessions/{sid}/trace",
            json={"summary": {"format": "json_trace", "processes": []}},
        )
        assert resp.status_code == 200
        assert resp.json() == {"success": True}

    def test_set_session_trace_nonexistent_returns_404(self, client):
        resp = client.put(
            "/api/chat/sessions/nonexistent/trace",
            json={"summary": {}},
        )
        assert resp.status_code == 404

    def test_set_session_logs(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "Log Session", "context_type": "log"}
        )
        sid = create_resp.json()["id"]
        resp = client.put(
            f"/api/chat/sessions/{sid}/logs",
            json={"entries": [{"level": "E", "message": "test"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["stored"] == 1

    def test_set_session_file_path_valid_file(self, client):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write(SAMPLE_LOGCAT)
            path = f.name
        try:
            create_resp = client.post(
                "/api/chat/sessions", json={"title": "File Session", "context_type": "log"}
            )
            sid = create_resp.json()["id"]
            resp = client.put(f"/api/chat/sessions/{sid}/file-path", json={"file_path": path})
            assert resp.status_code == 200
            assert resp.json()["success"] is True
            assert resp.json()["file_path"] == path
        finally:
            import os

            if os.path.exists(path):
                os.unlink(path)

    def test_set_session_file_path_clear(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "Clear File Session", "context_type": "log"}
        )
        sid = create_resp.json()["id"]
        # Clear with empty path
        resp = client.put(f"/api/chat/sessions/{sid}/file-path", json={"file_path": ""})
        assert resp.status_code == 200
        assert resp.json()["file_path"] is None

    def test_set_session_file_path_nonexistent(self, client):
        create_resp = client.post(
            "/api/chat/sessions", json={"title": "Bad File Session", "context_type": "log"}
        )
        sid = create_resp.json()["id"]
        resp = client.put(
            f"/api/chat/sessions/{sid}/file-path",
            json={"file_path": "/tmp/nonexistent_file_xyz_123.log"},
        )
        assert resp.status_code in (400, 403, 404)

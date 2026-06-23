import json

import pytest

from ala.services.agent_tools import execute_tool
from ala.services.project_manager import Project

SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""


def _write_log(tmp_path) -> str:
    path = tmp_path / "device.log"
    path.write_text(SAMPLE_LOGCAT)
    return str(path)


def test_search_all_local_requires_target(tmp_path):
    log_path = _write_log(tmp_path)
    payload = execute_tool(None, "search_all_local", "{}", source_path=log_path)
    result = json.loads(payload)
    assert "error" in result


def test_search_all_local_streaming_combines_logs_and_code(tmp_path, monkeypatch):
    log_path = _write_log(tmp_path)

    # Force non-rg path so the test is deterministic even when ripgrep is installed.
    from ala.services import code_scanner

    monkeypatch.setattr(code_scanner, "_RG_PATH", None)

    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "main.py").write_text("def started():\n    return 'Started service'\n")

    project = Project(
        id="p1",
        name="p",
        paths=[str(project_root)],
        include_patterns=["*.py"],
        exclude_patterns=[],
    )

    args = {
        "keyword_log": "Started service",
        "level": "I",
        "limit_log": 10,
        "code_pattern": "Started service",
        "limit_code": 10,
    }
    payload = execute_tool(project, "search_all_local", json.dumps(args), source_path=log_path)
    result = json.loads(payload)

    assert result["logs"]["method"] == "streaming"
    assert result["logs"]["total_matched"] == 1
    assert result["logs"]["entries"][0]["tag"] == "SystemServer"

    assert result["code"]["total_matches"] >= 1
    assert any(m["path"] == "main.py" for m in result["code"]["matches"])


def test_search_all_local_invalid_regex_returns_error(tmp_path):
    log_path = _write_log(tmp_path)
    args = {"keyword_log": "[invalid("}
    payload = execute_tool(None, "search_all_local", json.dumps(args), source_path=log_path)
    result = json.loads(payload)
    assert "error" in result


def test_search_all_local_uses_rg_fast_path_when_available(tmp_path):
    from ala.services import code_scanner

    if code_scanner._RG_PATH is None:
        pytest.skip("ripgrep not available")

    log_path = _write_log(tmp_path)
    args = {"keyword_log": "FATAL", "limit_log": 5}
    payload = execute_tool(None, "search_all_local", json.dumps(args), source_path=log_path)
    result = json.loads(payload)

    assert result["logs"]["method"] == "rg"
    assert result["logs"]["returned"] >= 1

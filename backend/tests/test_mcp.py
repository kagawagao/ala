"""Tests for MCP server tools."""

import json
import os
import tempfile

import pytest

try:
    from ala.mcp.server import (
        filter_android_logs,
        filter_perfetto_trace,
        get_log_statistics,
        list_directory_logs,
        overview_local_log,
        parse_android_log,
        parse_perfetto_trace,
        read_log_range,
        search_local_log,
        tail_local_log,
    )
except ImportError:
    pytest.skip("fastmcp not installed", allow_module_level=True)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""

SAMPLE_JSON_TRACE = json.dumps(
    {
        "traceEvents": [
            {"name": "slice1", "ph": "X", "ts": 0, "dur": 1000, "pid": 1, "tid": 1},
            {"name": "slice2", "ph": "X", "ts": 2000, "dur": 500, "pid": 1, "tid": 2},
            {"name": "slice3", "ph": "X", "ts": 3000, "dur": 200, "pid": 2, "tid": 3},
            {"name": "process_name", "ph": "M", "pid": 1, "args": {"name": "com.example.app"}},
            {"name": "process_name", "ph": "M", "pid": 2, "args": {"name": "system_server"}},
        ],
        "metadata": {"clock-offset-since-epoch": "0"},
    }
)


def _write_temp_file(content: str, suffix: str = ".txt") -> str:
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8")
    try:
        tmp.write(content)
    finally:
        tmp.close()
    return tmp.name


# ---------------------------------------------------------------------------
# Log MCP tools
# ---------------------------------------------------------------------------


class TestParseAndroidLog:
    def test_parse_valid_logcat(self):
        result = parse_android_log(SAMPLE_LOGCAT)
        assert result["total_lines"] == 5
        assert result["format_detected"] == "android_logcat"
        assert len(result["logs"]) == 5
        assert result["logs"][0]["level"] == "E"
        assert result["logs"][0]["tag"] == "AndroidRuntime"

    def test_parse_empty_content(self):
        result = parse_android_log("")
        assert result["total_lines"] == 0
        assert len(result["logs"]) == 0

    def test_parse_generic_log(self):
        content = "[2024-01-15 10:30:45] ERROR: Something went wrong\n"
        result = parse_android_log(content)
        assert result["total_lines"] == 1


class TestFilterAndroidLogs:
    def test_filter_by_level(self):
        result = filter_android_logs(SAMPLE_LOGCAT, level="E")
        assert result["total_filtered"] == 2
        assert all(e["level"] == "E" for e in result["logs"])

    def test_filter_by_tag(self):
        result = filter_android_logs(SAMPLE_LOGCAT, tag="AndroidRuntime")
        assert result["total_filtered"] == 2

    def test_filter_by_keyword(self):
        result = filter_android_logs(SAMPLE_LOGCAT, keywords="FATAL")
        assert result["total_filtered"] >= 1

    def test_filter_no_match(self):
        result = filter_android_logs(SAMPLE_LOGCAT, keywords="XXXXXXXXXNOTFOUND")
        assert result["total_filtered"] == 0

    def test_filter_with_pid(self):
        result = filter_android_logs(SAMPLE_LOGCAT, pid="1234")
        assert result["total_filtered"] >= 1

    def test_filter_tag_keyword_or(self):
        result = filter_android_logs(
            SAMPLE_LOGCAT, tag="ActivityManager", keywords="FATAL", tag_keyword_relation="OR"
        )
        assert result["total_filtered"] >= 2


class TestGetLogStatistics:
    def test_statistics(self):
        result = get_log_statistics(SAMPLE_LOGCAT)
        assert result["total"] == 5
        assert result["by_level"]["E"] == 2
        assert result["by_level"]["D"] == 1
        assert result["by_level"]["I"] == 1
        assert result["by_level"]["W"] == 1
        assert result["format"] == "android_logcat"
        assert "top_tags" in result
        assert "top_pids" in result

    def test_statistics_empty(self):
        result = get_log_statistics("")
        assert result["total"] == 0


# ---------------------------------------------------------------------------
# Trace MCP tools
# ---------------------------------------------------------------------------


class TestParsePerfettoTrace:
    def test_parse_json_trace_file(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(SAMPLE_JSON_TRACE)
            path = f.name
        try:
            result = parse_perfetto_trace(path)
            assert "error" not in result
            assert result["format"] == "json_trace"
            assert "summary" in result
            assert result["summary"]["process_count"] == 2
        finally:
            os.unlink(path)

    def test_parse_nonexistent_file(self):
        result = parse_perfetto_trace("/tmp/nonexistent_trace_file_xyz.json")
        assert "error" in result
        assert "File not found" in result["error"]


class TestFilterPerfettoTrace:
    def test_filter_by_pid(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(SAMPLE_JSON_TRACE)
            path = f.name
        try:
            result = filter_perfetto_trace(path, pids=[1])
            assert "error" not in result
            assert result["summary"]["process_count"] == 1
            assert result["summary"]["processes"][0]["pid"] == 1
        finally:
            os.unlink(path)

    def test_filter_by_process_name(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(SAMPLE_JSON_TRACE)
            path = f.name
        try:
            result = filter_perfetto_trace(path, process_name="system")
            assert "error" not in result
            assert result["summary"]["process_count"] == 1
            assert "system_server" in result["summary"]["processes"][0]["name"]
        finally:
            os.unlink(path)

    def test_filter_nonexistent_file(self):
        result = filter_perfetto_trace("/tmp/nonexistent.pb")
        assert "error" in result
        assert "File not found" in result["error"]


# ---------------------------------------------------------------------------
# Lazy log MCP tools
# ---------------------------------------------------------------------------


class TestOverviewLocalLog:
    def test_overview_valid_file(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = overview_local_log(path)
            assert "error" not in result
            assert result["total_lines"] == 5
            assert result["parsed_entries"] == 5
            assert "level_distribution" in result
            assert "unique_tags" in result
            assert "time_range" in result
        finally:
            os.unlink(path)

    def test_overview_with_max_lines(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = overview_local_log(path, max_lines=2)
            assert result["total_lines"] == 2
            assert result["max_lines_reached"] is True
        finally:
            os.unlink(path)

    def test_overview_nonexistent_file(self):
        result = overview_local_log("/tmp/nonexistent_ala_test_xyz.log")
        assert "error" in result

    def test_overview_path_traversal(self):
        result = overview_local_log("/tmp/../etc/passwd")
        assert "error" in result
        assert "traversal" in result["error"].lower()


class TestSearchLocalLog:
    def test_search_by_level(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = search_local_log(path, level="E")
            assert result["total_matched"] == 2
            assert result["returned"] == 2
            assert all(e["level"] == "E" for e in result["entries"])
        finally:
            os.unlink(path)

    def test_search_by_tag(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = search_local_log(path, tag="AndroidRuntime")
            assert result["total_matched"] == 2
        finally:
            os.unlink(path)

    def test_search_by_keyword(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = search_local_log(path, keyword="FATAL")
            assert result["total_matched"] >= 1
        finally:
            os.unlink(path)

    def test_search_pagination(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = search_local_log(path, limit=1, offset=0)
            assert result["returned"] <= 1
            assert "has_more" in result
        finally:
            os.unlink(path)

    def test_search_invalid_regex(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = search_local_log(path, keyword="[invalid")
            assert "error" in result
        finally:
            os.unlink(path)


class TestReadLogRange:
    def test_read_middle_range(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = read_log_range(path, start_line=2, end_line=4)
            assert result["count"] == 3
            assert result["total_lines_in_file"] == 5
        finally:
            os.unlink(path)

    def test_read_range_start_beyond_file(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = read_log_range(path, start_line=99999, end_line=100000)
            assert "error" in result
            assert "exceeds" in result["error"]
            assert result["total_lines_in_file"] == 5
        finally:
            os.unlink(path)

    def test_read_range_clamped(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = read_log_range(path, start_line=3, end_line=1000)
            assert "clamped" in result["range"]
            assert result["count"] == 3
        finally:
            os.unlink(path)


class TestTailLocalLog:
    def test_tail_default(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = tail_local_log(path)
            assert result["total_lines"] == 5
            assert len(result["entries"]) == 5
        finally:
            os.unlink(path)

    def test_tail_custom_lines(self):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = tail_local_log(path, lines=2)
            assert result["total_lines"] == 5
            assert len(result["entries"]) == 2
        finally:
            os.unlink(path)

    def test_tail_empty_file(self):
        path = _write_temp_file("")
        try:
            result = tail_local_log(path)
            assert result["total_lines"] == 0
            assert len(result["entries"]) == 0
        finally:
            os.unlink(path)


class TestListDirectoryLogs:
    def test_list_directory_with_logs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some log files
            with open(os.path.join(tmpdir, "system.log"), "w") as f:
                f.write(SAMPLE_LOGCAT)
            with open(os.path.join(tmpdir, "radio.log"), "w") as f:
                f.write(SAMPLE_LOGCAT)
            with open(os.path.join(tmpdir, "readme.txt"), "w") as f:
                f.write("not a log")

            result = list_directory_logs(tmpdir)
            assert result["total_files"] >= 2
            names = {f["name"] for f in result["files"]}
            assert "system.log" in names

    def test_list_not_a_directory(self):
        result = list_directory_logs("/tmp/nonexistent_dir_xyz_123")
        assert "error" in result

    def test_list_empty_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = list_directory_logs(tmpdir)
            assert result["total_files"] == 0

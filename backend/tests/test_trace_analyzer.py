"""Tests for the trace analyzer service."""
import json

import pytest

from ala.services.trace_analyzer import TraceAnalyzer, TraceFilters


@pytest.fixture
def analyzer():
    return TraceAnalyzer()


SAMPLE_JSON_TRACE = {
    "traceEvents": [
        {"name": "slice1", "ph": "X", "ts": 0, "dur": 1000, "pid": 1, "tid": 1},
        {"name": "slice2", "ph": "X", "ts": 2000, "dur": 500, "pid": 1, "tid": 2},
        {"name": "slice3", "ph": "X", "ts": 3000, "dur": 200, "pid": 2, "tid": 3},
        {"name": "process_name", "ph": "M", "pid": 1, "args": {"name": "com.example.app"}},
        {"name": "process_name", "ph": "M", "pid": 2, "args": {"name": "system_server"}},
    ],
    "metadata": {"clock-offset-since-epoch": "0"},
}


class TestTraceAnalyzer:
    def test_parse_unknown_format(self, analyzer):
        """Should return minimal summary for unknown binary content."""
        result = analyzer.parse_trace(b"BINARY_UNKNOWN_DATA_XYZ", "test.pb")
        assert result.summary.process_count >= 0
        assert result.format in ("perfetto_proto", "json_trace", "unknown")

    def test_parse_json_trace(self, analyzer):
        """Should parse JSON-based trace format."""
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        assert result.format == "json_trace"
        assert result.summary.event_count >= 2

    def test_json_trace_processes(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        assert result.summary.process_count == 2
        names = {p["name"] for p in result.summary.processes}
        assert "com.example.app" in names
        assert "system_server" in names


class TestTraceFilter:
    def test_filter_by_pid(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        filters = TraceFilters(pids=[1])
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.summary.process_count == 1
        assert filtered.summary.processes[0]["pid"] == 1

    def test_filter_by_process_name(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        filters = TraceFilters(process_name="system")
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.summary.process_count == 1
        assert "system_server" in filtered.summary.processes[0]["name"]

    def test_filter_by_process_name_regex(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        # Regex: match either process
        filters = TraceFilters(process_name=r"(com\.example|system)")
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.summary.process_count == 2

    def test_filter_no_criteria_returns_all(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        filters = TraceFilters()
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.summary.process_count == result.summary.process_count

    def test_filter_unknown_pid_returns_empty(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        filters = TraceFilters(pids=[9999])
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.summary.process_count == 0
        assert filtered.summary.thread_count == 0

    def test_filter_preserves_format_and_duration(self, analyzer):
        content = json.dumps(SAMPLE_JSON_TRACE).encode()
        result = analyzer.parse_trace(content, "trace.json")
        filters = TraceFilters(pids=[1])
        filtered = analyzer.filter_trace(result, filters)
        assert filtered.format == result.format
        assert filtered.summary.duration_ms == result.summary.duration_ms

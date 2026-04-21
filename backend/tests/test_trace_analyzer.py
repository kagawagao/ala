"""Tests for the trace analyzer service."""
import json
from types import SimpleNamespace

import pytest

from ala.mcp.server import filter_perfetto_trace, parse_perfetto_trace
from ala.services.trace_analyzer import (
    TraceAnalyzer,
    TraceFilters,
    TraceParseResult,
    TraceSummary,
)


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

    def test_json_trace_top_slices_are_not_limited_to_20(self, analyzer):
        trace = {
            "traceEvents": [
                {
                    "name": f"slice{i}",
                    "ph": "X",
                    "ts": i * 1000,
                    "dur": 1000 + i,
                    "pid": 1,
                    "tid": 1,
                }
                for i in range(25)
            ]
        }
        content = json.dumps(trace).encode()

        result = analyzer._parse_json_trace(content)

        assert len(result.summary.top_slices) == 25
        assert result.summary.top_slices[0]["name"] == "slice24"
        assert result.summary.top_slices[-1]["name"] == "slice0"

    def test_trace_processor_top_slices_are_not_limited_to_20(self, analyzer):
        class FakeTraceProcessor:
            def query(self, sql):
                if "FROM process" in sql:
                    return [
                        SimpleNamespace(pid=1, name="system_server", thread_count=1)
                    ]
                if "FROM trace_bounds" in sql:
                    return [SimpleNamespace(start_ts=0, end_ts=5_000_000)]
                if "COUNT(*) AS cnt FROM slice" in sql:
                    return [SimpleNamespace(cnt=25)]
                if "GROUP BY name" in sql:
                    return [
                        SimpleNamespace(
                            name=f"slice{i}",
                            cnt=1,
                            duration_ms=float(100 - i),
                        )
                        for i in range(25)
                    ]
                if "SELECT DISTINCT name FROM raw" in sql:
                    return []
                return []

        result = analyzer._summarize_via_tp(FakeTraceProcessor(), file_size=123)

        assert len(result.summary.top_slices) == 25
        assert result.summary.top_slices[0]["name"] == "slice0"
        assert result.summary.top_slices[-1]["name"] == "slice24"


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


class TestTraceMcp:
    def test_parse_perfetto_trace_returns_all_processes_and_slices(
        self, monkeypatch, tmp_path
    ):
        trace_path = tmp_path / "trace.json"
        trace_path.write_text("{}", encoding="utf-8")
        parse_result = TraceParseResult(
            summary=TraceSummary(
                duration_ms=12.5,
                process_count=25,
                thread_count=25,
                event_count=25,
                processes=[
                    {"pid": i, "name": f"process-{i}", "thread_count": 1}
                    for i in range(25)
                ],
                top_slices=[
                    {"name": f"slice-{i}", "count": 1, "duration_ms": float(i)}
                    for i in range(25)
                ],
                ftrace_events=[],
                metadata={},
            ),
            format="json_trace",
        )
        monkeypatch.setattr(
            "ala.mcp.server._trace_analyzer.parse_trace",
            lambda *_args, **_kwargs: parse_result,
        )

        result = parse_perfetto_trace(str(trace_path))

        assert len(result["summary"]["processes"]) == 25
        assert len(result["summary"]["top_slices"]) == 25

    def test_filter_perfetto_trace_returns_all_filtered_processes_and_slices(
        self, monkeypatch, tmp_path
    ):
        trace_path = tmp_path / "trace.json"
        trace_path.write_text("{}", encoding="utf-8")
        filtered_result = TraceParseResult(
            summary=TraceSummary(
                duration_ms=12.5,
                process_count=55,
                thread_count=55,
                event_count=55,
                processes=[
                    {"pid": i, "name": f"process-{i}", "thread_count": 1}
                    for i in range(55)
                ],
                top_slices=[
                    {"name": f"slice-{i}", "count": 1, "duration_ms": float(i)}
                    for i in range(25)
                ],
                ftrace_events=[],
                metadata={},
            ),
            format="json_trace",
        )
        monkeypatch.setattr(
            "ala.mcp.server._trace_analyzer.parse_trace",
            lambda *_args, **_kwargs: filtered_result,
        )
        monkeypatch.setattr(
            "ala.mcp.server._trace_analyzer.filter_trace",
            lambda *_args, **_kwargs: filtered_result,
        )

        result = filter_perfetto_trace(str(trace_path), pids=[1])

        assert len(result["summary"]["processes"]) == 55
        assert len(result["summary"]["top_slices"]) == 25

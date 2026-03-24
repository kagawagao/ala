"""Tests for the trace analyzer service."""
import json

import pytest

from ala.services.trace_analyzer import TraceAnalyzer


@pytest.fixture
def analyzer():
    return TraceAnalyzer()


class TestTraceAnalyzer:
    def test_parse_unknown_format(self, analyzer):
        """Should return minimal summary for unknown binary content."""
        result = analyzer.parse_trace(b"BINARY_UNKNOWN_DATA_XYZ", "test.pb")
        assert result.summary.process_count >= 0
        assert result.format in ("perfetto_proto", "json_trace", "unknown")

    def test_parse_json_trace(self, analyzer):
        """Should parse JSON-based trace format."""
        trace_data = {
            "traceEvents": [
                {"name": "slice1", "ph": "X", "ts": 0, "dur": 1000, "pid": 1, "tid": 1},
                {"name": "slice2", "ph": "X", "ts": 2000, "dur": 500, "pid": 1, "tid": 2},
            ],
            "metadata": {"clock-offset-since-epoch": "0"},
        }
        content = json.dumps(trace_data).encode()
        result = analyzer.parse_trace(content, "trace.json")
        assert result.format == "json_trace"
        assert result.summary.event_count >= 2

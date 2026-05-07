import json

from ala.services.agent_tools import _execute_log_tool


def test_query_log_overview_handles_string_timestamps():
    entries = [
        {
            "line_number": 1,
            "timestamp": "01-15 10:30:45.123",
            "pid": "1234",
            "tid": "5678",
            "level": "E",
            "tag": "AndroidRuntime",
            "message": "first",
            "raw_line": "raw-1",
            "source_file": "a.log",
        },
        {
            "line_number": 2,
            "timestamp": "01-15 10:30:46.123",
            "pid": "1234",
            "tid": "5678",
            "level": "W",
            "tag": "ActivityManager",
            "message": "second",
            "raw_line": "raw-2",
            "source_file": "a.log",
        },
    ]

    payload = _execute_log_tool("query_log_overview", {}, entries)
    result = json.loads(payload)

    assert result["total_stored"] == 2
    assert result["time_range"]["start"] == "01-15 10:30:45.123"
    assert result["time_range"]["end"] == "01-15 10:30:46.123"
    assert result["time_distribution"]

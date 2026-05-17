import json

from ala.services.agent_tools import _execute_log_tool, _overview_cache


def _make_entries(n: int = 2) -> list[dict]:
    return [
        {
            "line_number": i + 1,
            "timestamp": f"01-15 10:30:{45 + i:02d}.123",
            "pid": "1234",
            "tid": "5678",
            "level": "E" if i % 2 == 0 else "W",
            "tag": "AndroidRuntime" if i % 2 == 0 else "ActivityManager",
            "message": f"msg {i}",
            "raw_line": f"raw-{i}",
            "source_file": "a.log",
        }
        for i in range(n)
    ]


def test_query_log_overview_handles_string_timestamps():
    entries = _make_entries(2)

    payload = _execute_log_tool("query_log_overview", {}, entries)
    result = json.loads(payload)

    assert result["total_stored"] == 2
    assert result["time_range"]["start"] == "01-15 10:30:45.123"
    assert result["time_range"]["end"] == "01-15 10:30:46.123"
    assert result["time_distribution"]


def test_query_log_overview_caches_result():
    """Second call on the same list object must hit the cache (no re-scan)."""
    entries = _make_entries(5)
    _overview_cache.clear()

    payload1 = _execute_log_tool("query_log_overview", {}, entries)
    payload2 = _execute_log_tool("query_log_overview", {}, entries)

    assert payload1 == payload2
    # Cache should hold the entry for this list
    assert _overview_cache.get(entries) is not None


def test_query_log_overview_cache_misses_for_different_list():
    """A different list (different id) must not hit the cache from a prior list."""
    entries_a = _make_entries(3)
    entries_b = _make_entries(3)  # same length, different object
    _overview_cache.clear()

    _execute_log_tool("query_log_overview", {}, entries_a)
    # entries_b is a different object; cache should miss
    assert _overview_cache.get(entries_b) is None


def test_search_logs_slow_path_streaming():
    """search_logs with a keyword filter (slow path) must return correct pagination."""
    entries = _make_entries(20)
    # keyword matches all entries (all have "msg"), so total_matched = 20
    result = json.loads(
        _execute_log_tool(
            "search_logs",
            {"keyword": "msg", "limit": 5, "offset": 10},
            entries,
        )
    )

    assert result["total_matched"] == 20
    assert result["returned"] == 5
    assert result["offset"] == 10
    assert result["has_more"] is True


def test_search_logs_slow_path_no_overshoot():
    """search_logs slow path must not return more than limit entries."""
    entries = _make_entries(100)
    result = json.loads(_execute_log_tool("search_logs", {"keyword": "msg", "limit": 10}, entries))

    assert len(result["entries"]) == 10
    assert result["total_matched"] == 100

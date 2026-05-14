"""Benchmarks for log search and source code search hot paths."""

import json
from pathlib import Path

import pytest

from ala.services.agent_tools import _execute_log_tool, build_log_index
from ala.services.code_scanner import CodeScanner


def _make_log_entries(count: int = 50_000) -> list[dict]:
    tags = [
        "ActivityManager",
        "NetworkManager",
        "DatabaseCore",
        "AudioFlinger",
        "SystemServer",
    ]
    levels = ["V", "D", "I", "W", "E", "F"]
    entries: list[dict] = []

    for i in range(count):
        tag = tags[i % len(tags)]
        level = levels[i % len(levels)]
        second = i % 60
        minute = (i // 60) % 60
        message = f"{tag} heartbeat {i}"
        if i % 97 == 0:
            message += " database timeout while retrying query"
        if i % 211 == 0:
            message += " critical startup regression detected"
        entries.append(
            {
                "line_number": i + 1,
                "timestamp": f"01-15 10:{minute:02d}:{second:02d}.123",
                "pid": str(1000 + (i % 20)),
                "tid": str(2000 + (i % 40)),
                "level": level,
                "tag": tag,
                "message": message,
                "raw_line": f"{level}/{tag}({1000 + (i % 20)}): {message}",
                "source_file": "synthetic.log",
            }
        )

    return entries


def _write_source_file(path: Path, index: int) -> None:
    lines = [f'private const val TAG = "Feature{index}"']
    for line_index in range(180):
        lines.append(f'Log.d(TAG, "heartbeat {index}-{line_index}")')
        if line_index % 7 == 0:
            lines.append(f'Log.w(TAG, "retry window {index}-{line_index}")')
        if line_index % 11 == 0:
            lines.append(f'Log.e(TAG, "database timeout {index}-{line_index}")')
        if line_index % 29 == 0:
            lines.append(f'println("critical startup regression {index}-{line_index}")')
    path.write_text("\n".join(lines), encoding="utf-8")


@pytest.fixture(scope="session")
def log_search_dataset() -> tuple[list[dict], object]:
    entries = _make_log_entries()
    return entries, build_log_index(entries)


@pytest.fixture(scope="session")
def source_search_project(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("search-bench-project")
    for module_index in range(8):
        module_root = root / f"module_{module_index}" / "src" / "main" / "java" / "com" / "example"
        module_root.mkdir(parents=True, exist_ok=True)
        for file_index in range(18):
            _write_source_file(module_root / f"Feature{module_index}_{file_index}.kt", file_index)
    return root


@pytest.mark.benchmark(group="log-search")
def test_benchmark_search_logs_indexed(log_search_dataset, benchmark):
    entries, log_index = log_search_dataset
    args = {"level": "W", "tag": "NetworkManager", "limit": 50, "offset": 0}

    payload = benchmark(
        lambda: _execute_log_tool("search_logs", args, entries, log_index=log_index)
    )
    result = json.loads(payload)

    assert result["returned"] == 50
    assert result["total_matched"] > 1_000


@pytest.mark.benchmark(group="log-search")
def test_benchmark_search_logs_keyword_scan(log_search_dataset, benchmark):
    entries, log_index = log_search_dataset
    args = {
        "keyword": "database timeout",
        "start_time": "01-15 10:05:00.000",
        "end_time": "01-15 10:54:59.999",
        "limit": 50,
        "offset": 100,
    }

    payload = benchmark(
        lambda: _execute_log_tool("search_logs", args, entries, log_index=log_index)
    )
    result = json.loads(payload)

    assert result["returned"] == 50
    assert result["total_matched"] > 100
    assert result["has_more"] is True


@pytest.mark.benchmark(group="code-search")
def test_benchmark_search_code(source_search_project, benchmark):
    scanner = CodeScanner()
    include_patterns = ["**/*.kt"]
    exclude_patterns = ["**/build/**", "**/.git/**"]
    pattern = r"database timeout|critical startup regression"

    warmup_result = scanner.search_code(
        str(source_search_project),
        pattern,
        include_patterns,
        exclude_patterns,
    )
    assert warmup_result.total_matches > 0

    result = benchmark(
        lambda: scanner.search_code(
            str(source_search_project),
            pattern,
            include_patterns,
            exclude_patterns,
        )
    )

    assert result.total_matches == warmup_result.total_matches
    assert result.files_searched == warmup_result.files_searched

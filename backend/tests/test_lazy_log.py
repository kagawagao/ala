"""Tests for lazy log analysis tools (FEAT-LAZY-LOG).

TDD: these tests are written BEFORE the implementation.
"""
import gzip
import os
import tempfile
import zipfile

import pytest

from ala.services.log_analyzer import (
    FileRef,
    LogAnalyzer,
    LogEntry,
    LogFormat,
    PathTraversalError,
)

# ── fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture
def analyzer():
    return LogAnalyzer()


SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""


def _write_temp_file(content: str, suffix: str = ".txt") -> str:
    """Write *content* to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8")
    try:
        tmp.write(content)
    finally:
        tmp.close()
    return tmp.name


def _write_temp_gz(content: str) -> str:
    """Write gzip-compressed *content* to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".log.gz", delete=False)
    try:
        with gzip.GzipFile(fileobj=tmp, mode="wb") as gz:
            gz.write(content.encode("utf-8"))
    finally:
        tmp.close()
    return tmp.name


def _write_temp_zip(files: dict[str, str]) -> str:
    """Write a zip archive containing *files* {name: content}."""
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, content in files.items():
                zf.writestr(name, content)
    finally:
        tmp.close()
    return tmp.name


# ── _validate_path() tests ────────────────────────────────────────────────


class TestValidatePath:
    def test_accepts_valid_file(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            result = analyzer._validate_path(path)
            assert os.path.isfile(result)
        finally:
            os.unlink(path)

    def test_rejects_path_traversal_dotdot(self, analyzer):
        with pytest.raises(PathTraversalError, match="Path traversal"):
            analyzer._validate_path("/tmp/../etc/passwd")

    def test_rejects_path_traversal_encoded(self, analyzer):
        # os.sep ensures we catch .. regardless of platform
        with pytest.raises(PathTraversalError):
            analyzer._validate_path(f"foo{os.sep}..{os.sep}bar")

    def test_rejects_nonexistent_file(self, analyzer):
        with pytest.raises(FileNotFoundError, match="File not found"):
            analyzer._validate_path("/tmp/nonexistent_ala_test_file_xyz.log")

    def test_rejects_directory(self, analyzer):
        with pytest.raises(ValueError, match="Path is a directory"):
            analyzer._validate_path("/tmp")

    def test_resolves_and_returns_real_path(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            # Create symlink
            link = path + ".link"
            os.symlink(path, link)
            try:
                result = analyzer._validate_path(link)
                assert os.path.realpath(result) == os.path.realpath(path)
            finally:
                if os.path.exists(link):
                    os.unlink(link)
        finally:
            os.unlink(path)

    def test_rejects_outside_sandbox(self, analyzer):
        sandbox = tempfile.mkdtemp()
        try:
            outside = _write_temp_file(SAMPLE_LOGCAT)
            try:
                with pytest.raises(PermissionError, match="outside allowed"):
                    analyzer._validate_path(outside, sandbox_root=sandbox)
            finally:
                os.unlink(outside)
        finally:
            os.rmdir(sandbox)

    def test_accepts_inside_sandbox(self, analyzer):
        sandbox = tempfile.mkdtemp()
        try:
            inside_path = os.path.join(sandbox, "test.log")
            with open(inside_path, "w") as f:
                f.write(SAMPLE_LOGCAT)
            try:
                result = analyzer._validate_path(inside_path, sandbox_root=sandbox)
                assert os.path.isfile(result)
            finally:
                os.unlink(inside_path)
        finally:
            os.rmdir(sandbox)

    def test_rejects_unreadable_file(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            os.chmod(path, 0o000)
            with pytest.raises(PermissionError, match="Permission denied"):
                analyzer._validate_path(path)
        finally:
            os.chmod(path, 0o644)
            os.unlink(path)

    def test_sandbox_from_env(self, monkeypatch, analyzer):
        sandbox = tempfile.mkdtemp()
        try:
            inside_path = os.path.join(sandbox, "test.log")
            with open(inside_path, "w") as f:
                f.write(SAMPLE_LOGCAT)
            monkeypatch.setenv("ALA_SANDBOX_ROOT", sandbox)
            try:
                result = analyzer._validate_path(inside_path)
                assert os.path.isfile(result)
            finally:
                os.unlink(inside_path)
        finally:
            os.rmdir(sandbox)


# ── scan_file_meta() tests ────────────────────────────────────────────────


class TestScanFileMeta:
    def test_scans_plain_text(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            ref = analyzer.scan_file_meta(path)
            assert isinstance(ref, FileRef)
            assert ref.line_count == 5
            assert ref.size_bytes > 0
            assert ref.format_detected in (
                "android_logcat", "generic_timestamped", "unknown"
            )
            assert ref.is_gzip is False
            assert ref.is_zip is False
        finally:
            os.unlink(path)

    def test_detects_gzip(self, analyzer):
        path = _write_temp_gz(SAMPLE_LOGCAT)
        try:
            ref = analyzer.scan_file_meta(path)
            assert ref.is_gzip is True
            assert ref.line_count == 5
        finally:
            os.unlink(path)

    def test_detects_zip(self, analyzer):
        path = _write_temp_zip({"system.log": SAMPLE_LOGCAT})
        try:
            ref = analyzer.scan_file_meta(path)
            assert ref.is_zip is True
        finally:
            os.unlink(path)

    def test_empty_file(self, analyzer):
        path = _write_temp_file("")
        try:
            ref = analyzer.scan_file_meta(path)
            assert ref.line_count == 0
            assert ref.format_detected == "unknown"
        finally:
            os.unlink(path)

    def test_large_file_line_count(self, analyzer):
        lines = [f"line {i}" for i in range(5000)]
        content = "\n".join(lines) + "\n"
        path = _write_temp_file(content)
        try:
            ref = analyzer.scan_file_meta(path)
            assert ref.line_count == 5000
        finally:
            os.unlink(path)


# ── stream_file() tests ───────────────────────────────────────────────────


class TestStreamFile:
    def test_yields_log_entries_from_plain_text(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            entries = list(analyzer.stream_file(path))
            assert len(entries) == 5
            for e in entries:
                assert isinstance(e, LogEntry)
                assert e.line_number > 0
            assert entries[0].level == "E"
            assert entries[0].tag == "AndroidRuntime"
        finally:
            os.unlink(path)

    def test_yields_from_gzip(self, analyzer):
        path = _write_temp_gz(SAMPLE_LOGCAT)
        try:
            entries = list(analyzer.stream_file(path))
            assert len(entries) == 5
        finally:
            os.unlink(path)

    def test_yields_from_zip(self, analyzer):
        path = _write_temp_zip({"a.log": SAMPLE_LOGCAT})
        try:
            entries = list(analyzer.stream_file(path))
            assert len(entries) == 5
        finally:
            os.unlink(path)

    def test_yields_from_zip_multiple_members(self, analyzer):
        path = _write_temp_zip({
            "a.log": SAMPLE_LOGCAT,
            "b.log": SAMPLE_LOGCAT,
        })
        try:
            entries = list(analyzer.stream_file(path))
            assert len(entries) == 10
            sources = {e.source_file for e in entries}
            assert sources == {"a.log", "b.log"}
        finally:
            os.unlink(path)

    def test_reopens_after_format_detection(self, analyzer):
        """Verify that stream_file yields the correct number of entries
        even after _detect_format consumes some lines internally."""
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            entries = list(analyzer.stream_file(path))
            # All 5 lines should be yielded (no lines lost)
            assert len(entries) == 5
        finally:
            os.unlink(path)

    def test_does_not_load_entire_file(self, analyzer):
        """stream_file should be a generator, not a list builder."""
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            gen = analyzer.stream_file(path)
            # Call next() a few times and verify we get entries incrementally
            first = next(gen)
            assert isinstance(first, LogEntry)
            second = next(gen)
            assert isinstance(second, LogEntry)
            # The generator should still be alive for the rest
            rest = list(gen)
            assert len(rest) == 3  # 5 total - 2 consumed
        finally:
            os.unlink(path)

    def test_path_must_be_validated(self, analyzer):
        """stream_file should validate the path first."""
        with pytest.raises((FileNotFoundError, PathTraversalError, PermissionError, ValueError)):
            list(analyzer.stream_file("/tmp/nonexistent_ala_test_file_xyz.log"))


# ── _open_log_path() tests ────────────────────────────────────────────────


class TestOpenLogPath:
    def test_opens_plain_text(self, analyzer):
        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            fh = analyzer._open_log_path(path)
            content = fh.read()
            assert "AndroidRuntime" in content
        finally:
            os.unlink(path)

    def test_opens_gzip(self, analyzer):
        path = _write_temp_gz(SAMPLE_LOGCAT)
        try:
            fh = analyzer._open_log_path(path)
            content = fh.read()
            assert "AndroidRuntime" in content
        finally:
            os.unlink(path)

    def test_opens_zip(self, analyzer):
        path = _write_temp_zip({"mylog.txt": SAMPLE_LOGCAT})
        try:
            fh = analyzer._open_log_path(path)
            content = fh.read()
            assert "AndroidRuntime" in content
        finally:
            os.unlink(path)


# ── _parse_single_line() tests ────────────────────────────────────────────


class TestParseSingleLine:
    def test_parses_android_line(self, analyzer):
        line = "01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main"
        entry = analyzer._parse_single_line(line, 1, LogFormat.ANDROID_LOGCAT, "test.log")
        assert entry.level == "E"
        assert entry.tag == "AndroidRuntime"
        assert entry.pid == "1234"
        assert entry.tid == "5678"
        assert entry.line_number == 1
        assert entry.source_file == "test.log"

    def test_parses_generic_line(self, analyzer):
        line = "[2024-01-15 10:30:45] ERROR: Something went wrong"
        entry = analyzer._parse_single_line(line, 2, LogFormat.GENERIC_TIMESTAMPED, None)
        assert entry.level == "E"
        assert "Something went wrong" in entry.message

    def test_parses_unknown_line(self, analyzer):
        line = "just some random text"
        entry = analyzer._parse_single_line(line, 3, LogFormat.UNKNOWN, None)
        assert entry.level == "U"
        assert entry.tag == "Unknown"
        assert entry.message == line


# ── US-A1: overview_local_log max_lines tests ────────────────────────────


class TestOverviewMaxLines:
    """Tests for max_lines parameter in overview_local_log (US-A1)."""

    def test_max_lines_limits_scan(self, analyzer):
        """When max_lines is set, scanning stops after that many lines."""
        from ala.services.agent_tools import _execute_lazy_log_tool

        lines = [f"01-15 10:30:45.123  1234  5678 I Test: line {i}" for i in range(200)]
        content = "\n".join(lines) + "\n"
        path = _write_temp_file(content)
        try:
            result_raw = _execute_lazy_log_tool(
                "overview_local_log", {"max_lines": 50}, path
            )
            import json

            result = json.loads(result_raw)
            assert result["max_lines_reached"] is True
            assert result["parsed_entries"] <= 51  # may be 50 or 51 depending on break timing
            assert result["total_lines"] <= 51
        finally:
            os.unlink(path)

    def test_no_max_lines_scans_all(self, analyzer):
        """Without max_lines, all lines are scanned."""
        from ala.services.agent_tools import _execute_lazy_log_tool

        lines = [f"01-15 10:30:45.123  1234  5678 I Test: line {i}" for i in range(100)]
        content = "\n".join(lines) + "\n"
        path = _write_temp_file(content)
        try:
            result_raw = _execute_lazy_log_tool("overview_local_log", {}, path)
            import json

            result = json.loads(result_raw)
            assert "max_lines_reached" not in result
            assert result["total_lines"] == 100
            assert result["parsed_entries"] == 100
        finally:
            os.unlink(path)


# ── US-A2: file_path schema verification test ────────────────────────────


class TestLazyToolSchemas:
    """Meta-tests verifying LAZY_LOG_TOOLS schema completeness (US-A2)."""

    def test_file_path_param_in_schema(self):
        """All 4 file-oriented tools have file_path in input_schema.properties."""
        from ala.services.agent_tools import LAZY_LOG_TOOLS

        tools_with_file_path = {
            "overview_local_log",
            "search_local_log",
            "read_log_range",
            "tail_local_log",
        }
        for tool in LAZY_LOG_TOOLS:
            name = tool["name"]
            props = tool["input_schema"].get("properties", {})
            if name in tools_with_file_path:
                assert "file_path" in props, (
                    f"Tool '{name}' missing file_path in input_schema.properties"
                )
                assert props["file_path"]["type"] == "string", (
                    f"Tool '{name}' file_path should be type string"
                )
            elif name == "list_directory_logs":
                # list_directory_logs should NOT have file_path
                assert "file_path" not in props, (
                    "list_directory_logs should not have file_path"
                )


# ── US-A5: read_log_range error handling tests ───────────────────────────


class TestReadLogRangeErrors:
    """Tests for read_log_range error handling (US-A5)."""

    def test_read_log_range_start_beyond_file(self, analyzer):
        """start_line > total_lines returns explicit error."""
        from ala.services.agent_tools import _execute_lazy_log_tool

        path = _write_temp_file(SAMPLE_LOGCAT)  # 5 lines
        try:
            result_raw = _execute_lazy_log_tool(
                "read_log_range", {"start_line": 99999, "end_line": 100000}, path
            )
            import json

            result = json.loads(result_raw)
            assert "error" in result
            assert "start_line 99999 exceeds total lines 5" in result["error"]
            assert result["total_lines_in_file"] == 5
        finally:
            os.unlink(path)

    def test_read_log_range_end_clamped(self, analyzer):
        """end_line beyond total_lines is clamped and noted in range string."""
        from ala.services.agent_tools import _execute_lazy_log_tool

        path = _write_temp_file(SAMPLE_LOGCAT)  # 5 lines
        try:
            result_raw = _execute_lazy_log_tool(
                "read_log_range", {"start_line": 3, "end_line": 1000}, path
            )
            import json

            result = json.loads(result_raw)
            assert "clamped" in result["range"]
            assert result["count"] == 3  # lines 3, 4, 5
            assert result["total_lines_in_file"] == 5
        finally:
            os.unlink(path)


# ── US-A3 / US-D1: Observability logging test ────────────────────────────


class TestAgentToolsLogging:
    """Tests for structured logging in _execute_lazy_log_tool (US-A3/US-D1)."""

    def test_agent_tools_logging(self, caplog):
        """Verify DEBUG log emitted at entry and completion of lazy tools."""
        import logging

        from ala.services.agent_tools import _execute_lazy_log_tool

        path = _write_temp_file(SAMPLE_LOGCAT)
        try:
            caplog.set_level(logging.DEBUG, logger="ala.services.agent_tools")
            _execute_lazy_log_tool("overview_local_log", {"max_lines": 10}, path)
            # Check entry log
            assert any(
                "tool=overview_local_log" in r.message and "args=" in r.message
                for r in caplog.records
            ), "Expected DEBUG entry log with tool name and args"
            # Check completion log
            assert any(
                "tool=overview_local_log completed" in r.message
                for r in caplog.records
            ), "Expected DEBUG completion log"
        finally:
            os.unlink(path)

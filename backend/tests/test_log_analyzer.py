"""Tests for the log analyzer service."""
import gzip
import io
import zipfile

import pytest

from ala.services.log_analyzer import LogAnalyzer, LogFilters, extract_text_files


@pytest.fixture
def analyzer():
    return LogAnalyzer()


SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""


class TestLogParsing:
    def test_parse_android_logcat(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        assert result.total_lines == 5
        assert result.format_detected == "android_logcat"
        assert result.logs[0].level == "E"
        assert result.logs[0].tag == "AndroidRuntime"
        assert result.logs[0].pid == "1234"
        assert result.logs[0].tid == "5678"

    def test_parse_empty_content(self, analyzer):
        result = analyzer.parse_log("")
        assert result.total_lines == 0
        assert len(result.logs) == 0

    def test_parse_generic_log(self, analyzer):
        content = (
            "[2024-01-15 10:30:45] ERROR: Something went wrong\n"
            "[2024-01-15 10:30:46] INFO: Server started\n"
        )
        result = analyzer.parse_log(content)
        assert result.total_lines == 2
        assert result.format_detected in ("generic_timestamped", "android_logcat", "unknown")

    def test_parse_with_source_file(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT, source_file="device.log")
        assert all(e.source_file == "device.log" for e in result.logs)


class TestLogFiltering:
    def test_filter_by_level(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(level="E")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert all(e.level == "E" for e in filtered)
        assert len(filtered) == 2

    def test_filter_by_tag(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(tag="AndroidRuntime")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) == 2

    def test_filter_by_keyword(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(keywords="FATAL")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) >= 1

    def test_filter_no_match(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(keywords="XXXXXXXXXNOTFOUND")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) == 0

    def test_filter_tag_keyword_or(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(tag="ActivityManager", keywords="FATAL", tag_keyword_relation="OR")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) >= 2


class TestStatistics:
    def test_statistics(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        stats = analyzer.get_statistics(result.logs)
        assert stats.total == 5
        assert stats.by_level["E"] == 2
        assert stats.by_level["D"] == 1
        assert stats.by_level["I"] == 1
        assert stats.by_level["W"] == 1


class TestExtractTextFiles:
    """Unit tests for archive extraction helpers."""

    def test_plain_text(self):
        data = b"hello log line\n"
        result = extract_text_files(data, "device.log")
        assert len(result) == 1
        assert result[0][0] == "device.log"
        assert result[0][1] == data

    def test_gzip(self):
        original = SAMPLE_LOGCAT.encode()
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(original)
        gz_data = buf.getvalue()
        result = extract_text_files(gz_data, "device.log.gz")
        assert len(result) == 1
        assert result[0][0] == "device.log"
        assert result[0][1] == original

    def test_zip_single_log(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
        result = extract_text_files(buf.getvalue(), "logs.zip")
        assert len(result) == 1
        assert result[0][0] == "system.log"
        assert result[0][1].decode() == SAMPLE_LOGCAT

    def test_zip_multiple_logs(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
            zf.writestr("radio.log", SAMPLE_LOGCAT)
        result = extract_text_files(buf.getvalue(), "bugreport.zip")
        assert len(result) == 2
        names = {r[0] for r in result}
        assert names == {"system.log", "radio.log"}

    def test_zip_skips_non_log_members(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
            zf.writestr("image.png", b"\x89PNG\r\n")
        result = extract_text_files(buf.getvalue(), "mixed.zip")
        assert len(result) == 1
        assert result[0][0] == "system.log"

    def test_invalid_gzip_raises(self):
        with pytest.raises(ValueError, match="Invalid gzip"):
            extract_text_files(b"notgzip", "bad.gz")

    def test_invalid_zip_raises(self):
        with pytest.raises(ValueError, match="Invalid ZIP"):
            extract_text_files(b"notzip", "bad.zip")


class TestMultiFileParsing:
    """Tests for parse_log_bytes and stream_log_bytes."""

    def test_parse_plain_file(self, analyzer):
        results = analyzer.parse_log_bytes(SAMPLE_LOGCAT.encode(), "device.log")
        assert len(results) == 1
        assert results[0].total_lines == 5

    def test_parse_gz_file(self, analyzer):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(SAMPLE_LOGCAT.encode())
        results = analyzer.parse_log_bytes(buf.getvalue(), "device.log.gz")
        assert len(results) == 1
        assert results[0].total_lines == 5
        assert all(e.source_file == "device.log" for e in results[0].logs)

    def test_parse_zip_two_files(self, analyzer):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.log", SAMPLE_LOGCAT)
            zf.writestr("b.log", SAMPLE_LOGCAT)
        results = analyzer.parse_log_bytes(buf.getvalue(), "logs.zip")
        assert len(results) == 2
        for r in results:
            assert r.total_lines == 5

    def test_stream_gz_yields_entries(self, analyzer):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(SAMPLE_LOGCAT.encode())
        entries = list(analyzer.stream_log_bytes(buf.getvalue(), "device.log.gz"))
        assert len(entries) == 5

    def test_stream_zip_yields_all_entries(self, analyzer):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.log", SAMPLE_LOGCAT)
            zf.writestr("b.log", SAMPLE_LOGCAT)
        entries = list(analyzer.stream_log_bytes(buf.getvalue(), "logs.zip"))
        assert len(entries) == 10

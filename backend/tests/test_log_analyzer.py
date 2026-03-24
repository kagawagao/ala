"""Tests for the log analyzer service."""
import pytest

from ala.services.log_analyzer import LogAnalyzer, LogFilters


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

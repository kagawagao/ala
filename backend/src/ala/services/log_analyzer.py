"""Android log analyzer service - ported from TypeScript implementation."""
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class LogFormat(str, Enum):
    ANDROID_LOGCAT = "android_logcat"
    GENERIC_TIMESTAMPED = "generic_timestamped"
    UNKNOWN = "unknown"


@dataclass
class LogEntry:
    line_number: int
    timestamp: Optional[str]
    pid: Optional[str]
    tid: Optional[str]
    level: str
    tag: str
    message: str
    raw_line: str


@dataclass
class LogFilters:
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    keywords: Optional[str] = None
    level: Optional[str] = None
    tag: Optional[str] = None
    pid: Optional[str] = None
    tid: Optional[str] = None
    tag_keyword_relation: str = "AND"


@dataclass
class LogStatistics:
    total: int
    by_level: dict[str, int]
    tags: dict[str, int]
    pids: dict[str, int]


@dataclass
class ParseResult:
    logs: list[LogEntry]
    total_lines: int
    format_detected: str


class LogAnalyzer:
    def __init__(self):
        self._android_pattern = re.compile(
            r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3,6})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):+\s+(.*)$"
        )
        self._generic_pattern = re.compile(
            r"^(?:\[)?(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]?\s*"
            r"(?:\[)?([A-Z]+|VERBOSE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?:?\s*(?:-\s*)?(.+)$",
            re.IGNORECASE,
        )

    def detect_log_format(self, content: str) -> LogFormat:
        lines = [line for line in content.split("\n") if line.strip()]
        sample = lines[:10]
        if not sample:
            return LogFormat.UNKNOWN
        android_matches = sum(1 for line in sample if self._android_pattern.match(line.strip()))
        generic_matches = sum(1 for line in sample if self._generic_pattern.match(line.strip()))
        if android_matches >= len(sample) * 0.6:
            return LogFormat.ANDROID_LOGCAT
        if generic_matches >= len(sample) * 0.6:
            return LogFormat.GENERIC_TIMESTAMPED
        return LogFormat.UNKNOWN

    def parse_log(self, content: str) -> ParseResult:
        fmt = self.detect_log_format(content)
        if fmt == LogFormat.ANDROID_LOGCAT:
            logs = self._parse_android_logcat(content)
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            logs = self._parse_generic_timestamped(content)
        else:
            logs = self._parse_unknown(content)
        return ParseResult(logs=logs, total_lines=len(logs), format_detected=fmt.value)

    def _parse_android_logcat(self, content: str) -> list[LogEntry]:
        entries = []
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._android_pattern.match(line)
            if m:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=m.group(1).strip(),
                        pid=m.group(2).strip(),
                        tid=m.group(3).strip(),
                        level=m.group(4).strip(),
                        tag=m.group(5).strip(),
                        message=m.group(6).strip(),
                        raw_line=line,
                    )
                )
            else:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=None,
                        pid=None,
                        tid=None,
                        level="U",
                        tag="Unknown",
                        message=line,
                        raw_line=line,
                    )
                )
        return entries

    def _parse_generic_timestamped(self, content: str) -> list[LogEntry]:
        entries = []
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._generic_pattern.match(line)
            if m:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=m.group(1).strip(),
                        pid=None,
                        tid=None,
                        level=self._normalize_level(m.group(2)),
                        tag="Generic",
                        message=m.group(3).strip(),
                        raw_line=line,
                    )
                )
            else:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=None,
                        pid=None,
                        tid=None,
                        level="U",
                        tag="Unknown",
                        message=line,
                        raw_line=line,
                    )
                )
        return entries

    def _parse_unknown(self, content: str) -> list[LogEntry]:
        return [
            LogEntry(
                line_number=i,
                timestamp=None,
                pid=None,
                tid=None,
                level="U",
                tag="Unknown",
                message=line.strip(),
                raw_line=line.strip(),
            )
            for i, line in enumerate(content.split("\n"), 1)
            if line.strip()
        ]

    def _normalize_level(self, level: str) -> str:
        u = level.upper()
        if u == "VERBOSE" or u == "V":
            return "V"
        if u == "DEBUG" or u == "D":
            return "D"
        if u == "INFO" or u == "I":
            return "I"
        if u in ("W", "WARN", "WARNING"):
            return "W"
        if u == "ERROR" or u == "E":
            return "E"
        if u == "FATAL" or u == "F":
            return "F"
        return "U"

    def filter_logs(self, logs: list[LogEntry], filters: LogFilters) -> list[LogEntry]:
        # Pre-compile regexes
        kw_regex = None
        kw_fallback = None
        if filters.keywords and filters.keywords.strip():
            try:
                kw_regex = re.compile(filters.keywords, re.IGNORECASE)
            except re.error:
                kw_fallback = filters.keywords.lower()

        tag_regex = None
        tag_fallback = None
        if filters.tag and filters.tag.strip():
            try:
                tag_regex = re.compile(filters.tag, re.IGNORECASE)
            except re.error:
                tag_fallback = filters.tag.lower()

        has_kw = kw_regex is not None or kw_fallback is not None
        has_tag = tag_regex is not None or tag_fallback is not None
        use_or = filters.tag_keyword_relation == "OR"

        result = []
        for log in logs:
            # Time filter
            if filters.start_time or filters.end_time:
                if not log.timestamp:
                    continue
                if filters.start_time and log.timestamp < filters.start_time:
                    continue
                if filters.end_time and log.timestamp > filters.end_time:
                    continue

            # Keyword + tag filter
            if has_kw or has_tag:
                kw_match = True
                if has_kw:
                    text = f"{log.tag} {log.message}"
                    kw_match = bool(
                        kw_regex.search(text) if kw_regex else kw_fallback in text.lower()
                    )

                tag_match = True
                if has_tag:
                    tag_match = bool(
                        tag_regex.search(log.tag)
                        if tag_regex
                        else tag_fallback in log.tag.lower()
                    )

                if use_or and has_kw and has_tag:
                    if not (kw_match or tag_match):
                        continue
                else:
                    if not (kw_match and tag_match):
                        continue

            # Level filter
            if filters.level and filters.level != "ALL" and log.level != filters.level:
                continue

            # PID filter
            if filters.pid and filters.pid.strip() and log.pid != filters.pid:
                continue

            # TID filter
            if filters.tid and filters.tid.strip() and log.tid != filters.tid:
                continue

            result.append(log)

        return result

    def get_statistics(self, logs: list[LogEntry]) -> LogStatistics:
        by_level: dict[str, int] = {}
        tags: dict[str, int] = {}
        pids: dict[str, int] = {}
        for log in logs:
            by_level[log.level] = by_level.get(log.level, 0) + 1
            tags[log.tag] = tags.get(log.tag, 0) + 1
            if log.pid:
                pids[log.pid] = pids.get(log.pid, 0) + 1
        return LogStatistics(total=len(logs), by_level=by_level, tags=tags, pids=pids)

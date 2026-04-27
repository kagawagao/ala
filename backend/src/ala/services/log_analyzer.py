"""Android log analyzer service - ported from TypeScript implementation."""

import gzip
import io
import os
import re
import stat
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path


class LogFormat(StrEnum):
    ANDROID_LOGCAT = "android_logcat"
    GENERIC_TIMESTAMPED = "generic_timestamped"
    UNKNOWN = "unknown"


@dataclass
class LogEntry:
    line_number: int
    timestamp: str | None
    pid: str | None
    tid: str | None
    level: str
    tag: str
    message: str
    raw_line: str
    source_file: str | None = None


@dataclass
class LogFilters:
    start_time: str | None = None
    end_time: str | None = None
    keywords: str | None = None
    level: str | None = None
    tag: str | None = None
    pid: str | None = None
    tid: str | None = None
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


@dataclass
class FileRef:
    """Metadata about a local log file, returned by scan_file_meta()."""
    path: str
    line_count: int
    size_bytes: int
    format_detected: str  # LogFormat value
    is_gzip: bool = False
    is_zip: bool = False


class PathTraversalError(ValueError):
    """Raised when a file path contains traversal patterns like ../"""


# ---------------------------------------------------------------------------
# Archive / multi-file extraction helpers
# ---------------------------------------------------------------------------

#: File extensions treated as log text files
_LOG_TEXT_EXTS = {".log", ".txt", ".logcat", ""}

#: Maximum size (bytes) for a single decoded text file to prevent OOM
_MAX_DECODE_BYTES = 256 * 1024 * 1024  # 256 MB


def _is_log_name(name: str) -> bool:
    """Return True when *name* looks like a plain-text log file."""
    lower = name.lower()
    # Accept files without extension or with common log extensions
    import os

    ext = os.path.splitext(lower)[1]
    return ext in _LOG_TEXT_EXTS


def extract_text_files(data: bytes, filename: str) -> list[tuple[str, bytes]]:
    """Extract text file contents from *data*.

    Returns a list of ``(member_name, raw_bytes)`` pairs.

    Supports:
    * ``.zip`` archives (may contain multiple log files)
    * ``.gz`` single-file gzip (e.g. ``logcat.log.gz``)
    * Plain text files (returned as-is)
    """
    lower = filename.lower()

    if lower.endswith(".zip"):
        results: list[tuple[str, bytes]] = []
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    if not _is_log_name(info.filename):
                        continue
                    member_data = zf.read(info.filename)
                    if len(member_data) <= _MAX_DECODE_BYTES:
                        results.append((info.filename, member_data))
        except zipfile.BadZipFile as exc:
            raise ValueError(f"Invalid ZIP file: {exc}") from exc
        return results if results else [("(empty zip)", b"")]

    if lower.endswith(".gz") and not lower.endswith(".tar.gz"):
        try:
            decompressed = gzip.decompress(data)
        except gzip.BadGzipFile as exc:
            raise ValueError(f"Invalid gzip file: {exc}") from exc
        # Strip the .gz extension to get the inner filename
        inner_name = filename[:-3] if len(filename) > 3 else filename
        return [(inner_name, decompressed[:_MAX_DECODE_BYTES])]

    # Plain text – return as-is
    return [(filename, data[:_MAX_DECODE_BYTES])]


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

    def parse_log(self, content: str, source_file: str | None = None) -> ParseResult:
        fmt = self.detect_log_format(content)
        if fmt == LogFormat.ANDROID_LOGCAT:
            logs = self._parse_android_logcat(content, source_file)
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            logs = self._parse_generic_timestamped(content, source_file)
        else:
            logs = self._parse_unknown(content, source_file)
        return ParseResult(logs=logs, total_lines=len(logs), format_detected=fmt.value)

    def parse_log_bytes(self, data: bytes, filename: str) -> list[ParseResult]:
        """Parse one or more log files from *data*.

        Handles plain text, ``.zip`` archives and ``.gz`` single-file gzip.
        Returns one :class:`ParseResult` per extracted text file.
        """
        text_files = extract_text_files(data, filename)
        results: list[ParseResult] = []
        for name, raw_bytes in text_files:
            text = raw_bytes.decode("utf-8", errors="replace")
            results.append(self.parse_log(text, source_file=name))
        return results

    def stream_log_bytes(self, data: bytes, filename: str) -> Iterator[LogEntry]:
        """Yield :class:`LogEntry` objects one by one.

        Handles plain text, ``.zip`` and ``.gz`` files, yielding entries
        across all extracted members in order so callers can stream them
        without buffering the full result.
        """
        text_files = extract_text_files(data, filename)
        for name, raw_bytes in text_files:
            text = raw_bytes.decode("utf-8", errors="replace")
            yield from self.parse_log_iter(text, source_file=name)

    def _parse_android_logcat(self, content: str, source_file: str | None = None) -> list[LogEntry]:
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
                        source_file=source_file,
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
                        source_file=source_file,
                    )
                )
        return entries

    def _parse_generic_timestamped(
        self, content: str, source_file: str | None = None
    ) -> list[LogEntry]:
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
                        source_file=source_file,
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
                        source_file=source_file,
                    )
                )
        return entries

    def _parse_unknown(self, content: str, source_file: str | None = None) -> list[LogEntry]:
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
                source_file=source_file,
            )
            for i, line in enumerate(content.split("\n"), 1)
            if line.strip()
        ]

    # ------------------------------------------------------------------
    # Iterator-based (streaming) parse methods — yield per-line, no list
    # ------------------------------------------------------------------

    def parse_log_iter(self, content: str, source_file: str | None = None) -> Iterator[LogEntry]:
        """Yield :class:`LogEntry` objects one at a time without building a list.

        Detects the log format and delegates to the appropriate streaming parser.
        """
        fmt = self.detect_log_format(content)
        if fmt == LogFormat.ANDROID_LOGCAT:
            yield from self._parse_android_logcat_iter(content, source_file)
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            yield from self._parse_generic_timestamped_iter(content, source_file)
        else:
            yield from self._parse_unknown_iter(content, source_file)

    def _parse_android_logcat_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._android_pattern.match(line)
            if m:
                yield LogEntry(
                    line_number=i,
                    timestamp=m.group(1).strip(),
                    pid=m.group(2).strip(),
                    tid=m.group(3).strip(),
                    level=m.group(4).strip(),
                    tag=m.group(5).strip(),
                    message=m.group(6).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
            else:
                yield LogEntry(
                    line_number=i,
                    timestamp=None,
                    pid=None,
                    tid=None,
                    level="U",
                    tag="Unknown",
                    message=line,
                    raw_line=line,
                    source_file=source_file,
                )

    def _parse_generic_timestamped_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._generic_pattern.match(line)
            if m:
                yield LogEntry(
                    line_number=i,
                    timestamp=m.group(1).strip(),
                    pid=None,
                    tid=None,
                    level=self._normalize_level(m.group(2)),
                    tag="Generic",
                    message=m.group(3).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
            else:
                yield LogEntry(
                    line_number=i,
                    timestamp=None,
                    pid=None,
                    tid=None,
                    level="U",
                    tag="Unknown",
                    message=line,
                    raw_line=line,
                    source_file=source_file,
                )

    def _parse_unknown_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            yield LogEntry(
                line_number=i,
                timestamp=None,
                pid=None,
                tid=None,
                level="U",
                tag="Unknown",
                message=line,
                raw_line=line,
                source_file=source_file,
            )

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

    # ------------------------------------------------------------------
    # Lazy log file helpers (FEAT-LAZY-LOG)
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_path(file_path: str, sandbox_root: str | None = None) -> str:
        """Validate and resolve a file path for security.

        Raises:
            PathTraversalError: If path contains traversal patterns.
            FileNotFoundError: If file does not exist.
            ValueError: If path points to a directory.
            PermissionError: If sandbox restricts access or file is unreadable.
        """
        # Resolve sandbox root from env var if not explicitly passed
        if sandbox_root is None:
            sandbox_root = os.environ.get("ALA_SANDBOX_ROOT")

        # Reject path traversal patterns — check original string first
        # (normpath would resolve ../ before we can detect it)
        if ".." in file_path.split(os.sep) or file_path.startswith(".."):
            raise PathTraversalError(
                f"Path traversal detected: {file_path}"
            )
        normalized = os.path.normpath(file_path)
        # Double-check the normalized path too
        if ".." in normalized.split(os.sep):
            raise PathTraversalError(
                f"Path traversal detected (after normalization): {normalized}"
            )

        # Resolve symlinks to real path
        real = os.path.realpath(normalized)

        # Check sandbox confinement
        if sandbox_root:
            sandbox_real = os.path.realpath(os.path.normpath(sandbox_root))
            # Both must be on the same path prefix
            if not os.path.commonpath([real, sandbox_real]).startswith(sandbox_real):
                raise PermissionError(
                    f"Path {file_path} is outside allowed sandbox root {sandbox_root}"
                )

        # Must exist and be a file
        if not os.path.exists(real):
            raise FileNotFoundError(f"File not found: {file_path}")

        if os.path.isdir(real):
            raise ValueError(f"Path is a directory, not a file: {file_path}")

        # Must be readable
        if not os.access(real, os.R_OK):
            raise PermissionError(f"Permission denied: cannot read {file_path}")

        return real

    def scan_file_meta(self, file_path: str) -> FileRef:
        """Scan a local log file and return metadata without parsing entries.

        Counts lines, detects format, and identifies compression type.
        """
        validated = self._validate_path(file_path)
        file_stat = os.stat(validated)

        lower = file_path.lower()
        is_gzip = lower.endswith(".gz") and not lower.endswith(".tar.gz")
        is_zip = lower.endswith(".zip")

        line_count = 0
        format_detected = LogFormat.UNKNOWN.value

        fh = self._open_log_path(validated)
        try:
            sample_lines = []
            for raw_line in fh:
                line_count += 1
                stripped = raw_line.strip()
                if stripped and len(sample_lines) < 10:
                    sample_lines.append(stripped)
            sample = "\n".join(sample_lines)
            if sample:
                format_detected = self.detect_log_format(sample).value
        finally:
            if hasattr(fh, "close"):
                fh.close()

        return FileRef(
            path=validated,
            line_count=line_count,
            size_bytes=file_stat.st_size,
            format_detected=format_detected,
            is_gzip=is_gzip,
            is_zip=is_zip,
        )

    def stream_file(self, file_path: str, sandbox_root: str | None = None) -> Iterator[LogEntry]:
        """Stream LogEntry objects from a local file path, one at a time.

        Never loads the entire file into memory. Handles .gz, .zip, and plain text.

        Yields:
            LogEntry objects one-by-one.
        """
        validated = self._validate_path(file_path, sandbox_root=sandbox_root)

        # Detect format from first 10 lines
        fmt = LogFormat.UNKNOWN
        sample_lines = []
        fh = self._open_log_path(validated)
        try:
            for raw_line in fh:
                stripped = raw_line.strip()
                if stripped and len(sample_lines) < 10:
                    sample_lines.append(stripped)
                if len(sample_lines) >= 10:
                    break
        finally:
            if hasattr(fh, "close"):
                fh.close()

        if sample_lines:
            sample = "\n".join(sample_lines)
            fmt = self.detect_log_format(sample)

        # Re-open and parse all lines
        # For zip files, iterate all text members
        lower_path = validated.lower()
        if lower_path.endswith(".zip") and not lower_path.endswith(".tar.gz"):
            with zipfile.ZipFile(validated, "r") as zf:
                line_num = 0
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_lower = info.filename.lower()
                    ext = os.path.splitext(member_lower)[1]
                    if ext not in _LOG_TEXT_EXTS:
                        continue
                    source = info.filename
                    with zf.open(info) as member_fh:
                        fh = io.TextIOWrapper(member_fh, encoding="utf-8", errors="replace")
                        for raw_line in fh:
                            line_num += 1
                            line = raw_line.rstrip("\n\r")
                            if not line.strip():
                                continue
                            yield self._parse_single_line(line, line_num, fmt, source)
        else:
            source = Path(validated).name
            fh = self._open_log_path(validated)
            try:
                line_num = 0
                for raw_line in fh:
                    line_num += 1
                    line = raw_line.rstrip("\n\r")
                    if not line.strip():
                        continue
                    yield self._parse_single_line(line, line_num, fmt, source)
            finally:
                if hasattr(fh, "close"):
                    fh.close()

    @staticmethod
    def _open_log_path(file_path: str):
        """Open a log file for line-by-line reading.

        Handles plain text, .gz (gzip), and .zip (first text member).
        Returns a context-manager compatible object.  For zip files the returned
        TextIOWrapper is wrapped so closing it also closes the parent ZipFile.
        """
        lower = file_path.lower()

        if lower.endswith(".gz") and not lower.endswith(".tar.gz"):
            return gzip.open(file_path, mode="rt", encoding="utf-8", errors="replace")

        if lower.endswith(".zip"):
            zf = zipfile.ZipFile(file_path, "r")
            try:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_lower = info.filename.lower()
                    ext = os.path.splitext(member_lower)[1]
                    if ext in _LOG_TEXT_EXTS:
                        wrapper = io.TextIOWrapper(zf.open(info), encoding="utf-8", errors="replace")
                        # Attach the ZipFile to the wrapper so it gets closed too
                        wrapper._ala_zipfile = zf  # type: ignore[attr-defined]
                        orig_close = wrapper.close
                        def _close_with_zip():
                            orig_close()
                            zf.close()
                        wrapper.close = _close_with_zip  # type: ignore[method-assign]
                        return wrapper
                # No text member found — close zip and return empty
                zf.close()
                return io.StringIO("")
            except Exception:
                zf.close()
                raise

        return open(file_path, mode="r", encoding="utf-8", errors="replace")

    def _parse_single_line(
        self, line: str, line_number: int, fmt: LogFormat, source_file: str | None = None
    ) -> LogEntry:
        """Parse a single log line into a LogEntry.

        Args:
            line: The raw log line (already stripped of newline).
            line_number: 1-based line number in the file.
            fmt: Detected log format.
            source_file: Name of the source file.

        Returns:
            A LogEntry with parsed fields.
        """
        if fmt == LogFormat.ANDROID_LOGCAT:
            m = self._android_pattern.match(line.strip())
            if m:
                return LogEntry(
                    line_number=line_number,
                    timestamp=m.group(1).strip(),
                    pid=m.group(2).strip(),
                    tid=m.group(3).strip(),
                    level=m.group(4).strip(),
                    tag=m.group(5).strip(),
                    message=m.group(6).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            m = self._generic_pattern.match(line.strip())
            if m:
                return LogEntry(
                    line_number=line_number,
                    timestamp=m.group(1).strip(),
                    pid=None,
                    tid=None,
                    level=self._normalize_level(m.group(2)),
                    tag="Generic",
                    message=m.group(3).strip(),
                    raw_line=line,
                    source_file=source_file,
                )

        # Fallback: unknown format or no match
        return LogEntry(
            line_number=line_number,
            timestamp=None,
            pid=None,
            tid=None,
            level="U",
            tag="Unknown",
            message=line.strip(),
            raw_line=line,
            source_file=source_file,
        )

    # ------------------------------------------------------------------
    # End lazy log helpers
    # ------------------------------------------------------------------

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
                        tag_regex.search(log.tag) if tag_regex else tag_fallback in log.tag.lower()
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

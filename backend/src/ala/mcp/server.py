"""MCP server for ALA using FastMCP."""

import json
import os
import re
import shutil
import subprocess
import time
from collections import deque

from fastmcp import FastMCP

from ..file_detector import detect_file_type_from_path
from ..services.log_analyzer import LogAnalyzer, PathTraversalError
from ..services.trace_analyzer import TraceAnalyzer, TraceFilters

mcp = FastMCP("ALA - Android Log Analyzer")
_log_analyzer = LogAnalyzer()
_trace_analyzer = TraceAnalyzer()


@mcp.tool()
def parse_android_log(log_content: str) -> dict:
    """Parse Android logcat content and return structured log entries.

    Args:
        log_content: Raw Android logcat text content

    Returns:
        Dictionary with parsed log entries, total count, and format detected
    """
    result = _log_analyzer.parse_log(log_content)
    return {
        "format_detected": result.format_detected,
        "total_lines": result.total_lines,
        "logs": [
            {
                "line_number": e.line_number,
                "timestamp": e.timestamp,
                "pid": e.pid,
                "tid": e.tid,
                "level": e.level,
                "tag": e.tag,
                "message": e.message,
            }
            for e in result.logs[:1000]  # Limit for MCP response size
        ],
    }


@mcp.tool()
def filter_android_logs(
    log_content: str,
    level: str | None = None,
    tag: str | None = None,
    keywords: str | None = None,
    pid: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    tag_keyword_relation: str = "AND",
) -> dict:
    """Filter Android logcat entries by various criteria.

    Args:
        log_content: Raw Android logcat text content
        level: Log level to filter (V/D/I/W/E/F)
        tag: Tag pattern (regex supported)
        keywords: Keyword pattern to search in messages (regex supported)
        pid: Process ID to filter
        start_time: Start time filter (MM-DD HH:MM:SS.mmm format)
        end_time: End time filter (MM-DD HH:MM:SS.mmm format)
        tag_keyword_relation: Relationship between tag and keyword filters (AND/OR)

    Returns:
        Filtered log entries with count
    """
    from ..services.log_analyzer import LogFilters

    parse_result = _log_analyzer.parse_log(log_content)
    filters = LogFilters(
        level=level,
        tag=tag,
        keywords=keywords,
        pid=pid,
        start_time=start_time,
        end_time=end_time,
        tag_keyword_relation=tag_keyword_relation,
    )
    filtered = _log_analyzer.filter_logs(parse_result.logs, filters)
    stats = _log_analyzer.get_statistics(filtered)

    return {
        "total_filtered": len(filtered),
        "total_original": len(parse_result.logs),
        "statistics": {
            "by_level": stats.by_level,
            "top_tags": dict(sorted(stats.tags.items(), key=lambda x: x[1], reverse=True)[:20]),
        },
        "logs": [
            {
                "line_number": e.line_number,
                "timestamp": e.timestamp,
                "level": e.level,
                "tag": e.tag,
                "message": e.message,
            }
            for e in filtered[:500]  # Limit for MCP response
        ],
    }


@mcp.tool()
def get_log_statistics(log_content: str) -> dict:
    """Get statistical summary of Android log content.

    Args:
        log_content: Raw Android logcat text content

    Returns:
        Statistics including total count, counts by level, top tags, PIDs
    """
    result = _log_analyzer.parse_log(log_content)
    stats = _log_analyzer.get_statistics(result.logs)
    return {
        "total": stats.total,
        "format": result.format_detected,
        "by_level": stats.by_level,
        "top_tags": dict(sorted(stats.tags.items(), key=lambda x: x[1], reverse=True)[:30]),
        "top_pids": dict(sorted(stats.pids.items(), key=lambda x: x[1], reverse=True)[:10]),
    }


@mcp.tool()
def parse_perfetto_trace(trace_file_path: str) -> dict:
    """Parse a Perfetto trace file and return a summary.

    Args:
        trace_file_path: Path to the Perfetto trace file (.pb or .json)

    Returns:
        Trace summary with process info, events, duration, etc.
    """
    try:
        with open(trace_file_path, "rb") as f:
            content = f.read()
        result = _trace_analyzer.parse_trace(content, trace_file_path)
        return {
            "format": result.format,
            "file_size": len(content),
            "summary": {
                "duration_ms": result.summary.duration_ms,
                "process_count": result.summary.process_count,
                "thread_count": result.summary.thread_count,
                "event_count": result.summary.event_count,
                "processes": result.summary.processes,
                "top_slices": result.summary.top_slices,
                "ftrace_events": result.summary.ftrace_events[:30],
                "metadata": result.summary.metadata,
            },
        }
    except FileNotFoundError:
        return {"error": f"File not found: {trace_file_path}"}
    except Exception as e:
        return {"error": f"Failed to parse trace: {str(e)}"}


@mcp.tool()
def filter_perfetto_trace(
    trace_file_path: str,
    pids: list[int] | None = None,
    process_name: str | None = None,
) -> dict:
    """Parse and filter a Perfetto trace file by process(es).

    Args:
        trace_file_path: Path to the Perfetto trace file (.pb or .json)
        pids: Optional list of process IDs to keep.
        process_name: Optional regex pattern to filter processes by name
            (case-insensitive).

    Returns:
        Filtered trace summary containing only matching processes.
    """
    try:
        with open(trace_file_path, "rb") as f:
            content = f.read()
        result = _trace_analyzer.parse_trace(content, trace_file_path)
        filters = TraceFilters(pids=pids, process_name=process_name)
        filtered = _trace_analyzer.filter_trace(result, filters)
        return {
            "format": filtered.format,
            "file_size": len(content),
            "summary": {
                "duration_ms": filtered.summary.duration_ms,
                "process_count": filtered.summary.process_count,
                "thread_count": filtered.summary.thread_count,
                "event_count": filtered.summary.event_count,
                "processes": filtered.summary.processes,
                "top_slices": filtered.summary.top_slices,
                "ftrace_events": filtered.summary.ftrace_events[:30],
                "metadata": filtered.summary.metadata,
            },
        }
    except FileNotFoundError:
        return {"error": f"File not found: {trace_file_path}"}
    except Exception as e:
        return {"error": f"Failed to filter trace: {str(e)}"}


# ──────────────────────────────────────────────────────────────────────────────
# Lazy-log tools (US-B1) — operate on local file paths via LogAnalyzer
# ──────────────────────────────────────────────────────────────────────────────

_LEVEL_ORDER: dict[str, int] = {"V": 0, "D": 1, "I": 2, "W": 3, "E": 4, "F": 5}
_LOG_EXTENSIONS = {".log", ".txt", ".logcat", ".gz", ".zip", ".hci", ".btsnoop", ".cfa"}


def _entry_to_dict(entry) -> dict:
    """Convert a LogEntry to a serialisable dict."""
    return {
        "line_number": entry.line_number,
        "timestamp": entry.timestamp,
        "level": entry.level,
        "tag": entry.tag,
        "pid": entry.pid,
        "tid": entry.tid,
        "message": entry.message,
    }


@mcp.tool()
def overview_local_log(file_path: str, max_lines: int | None = None) -> dict:
    """Stream-scan a local log file for statistics (level distribution,
    unique tags/PIDs, time range). Never loads entire file into memory.

    Args:
        file_path: Absolute or relative path to the log file.
        max_lines: If set, stop scanning after this many lines
                   (useful for sampling large files).

    Returns:
        Dict with total_lines, level_distribution, unique_tags,
        unique_pids, time_range, sample_tags, sample_pids,
        max_lines_reached (bool), format_detected.
    """
    try:
        validated = LogAnalyzer._validate_path(file_path)
    except PathTraversalError as e:
        return {"error": f"Path traversal rejected: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except PermissionError as e:
        return {"error": str(e)}
    except ValueError as e:
        return {"error": str(e)}

    level_counts: dict[str, int] = {}
    tags: set[str] = set()
    pids: set[str] = set()
    min_ts: str | None = None
    max_ts: str | None = None
    line_count = 0
    parsed_entries = 0
    # Detect format from file metadata (same approach as agent_tools / scan_file_meta)
    try:
        meta = _log_analyzer.scan_file_meta(validated)
        format_detected = meta.format_detected
    except Exception:
        format_detected = "android"

    for entry in _log_analyzer.stream_file(validated):
        line_count += 1
        parsed_entries += 1
        lvl = entry.level or "?"
        level_counts[lvl] = level_counts.get(lvl, 0) + 1
        if entry.tag:
            tags.add(entry.tag)
        if entry.pid:
            pids.add(str(entry.pid))
        if entry.timestamp:
            if min_ts is None or entry.timestamp < min_ts:
                min_ts = entry.timestamp
            if max_ts is None or entry.timestamp > max_ts:
                max_ts = entry.timestamp
        if max_lines is not None and line_count >= max_lines:
            break

    return {
        "file": validated,
        "total_lines": line_count,
        "parsed_entries": parsed_entries,
        "level_distribution": level_counts,
        "unique_tags": len(tags),
        "unique_pids": len(pids),
        "time_range": {"start": min_ts, "end": max_ts},
        "sample_tags": sorted(tags)[:30],
        "sample_pids": sorted(pids)[:30],
        "format_detected": format_detected,
        "max_lines_reached": max_lines is not None and max_lines > 0 and line_count >= max_lines,
    }


@mcp.tool()
def search_local_log(
    file_path: str,
    level: str | None = None,
    tag: str | None = None,
    pid: str | None = None,
    keyword: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Search/filter a local log file line-by-line with pagination.

    Args:
        file_path: Path to the log file.
        level: Minimum log level (V/D/I/W/E/F).
        tag: Tag substring filter (case-insensitive).
        pid: Process ID filter.
        keyword: Regex to match in log message.
        start_time/end_time: Timestamp window.
        limit: Max results (default 50, max 500).
        offset: Skip N matching entries (pagination).

    Returns:
        Dict with total_matched, offset, returned, has_more, entries.
    """
    import re

    try:
        validated = LogAnalyzer._validate_path(file_path)
    except PathTraversalError as e:
        return {"error": f"Path traversal rejected: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except PermissionError as e:
        return {"error": str(e)}
    except ValueError as e:
        return {"error": str(e)}

    level_filter = (level or "").upper()
    tag_filter = (tag or "").lower()
    pid_filter = str(pid or "")
    keyword_str = keyword or ""
    start = start_time or ""
    end = end_time or ""
    limit = min(max(int(limit), 0), 500)
    offset = max(int(offset), 0)

    min_level = _LEVEL_ORDER.get(level_filter, 0) if level_filter else 0

    keyword_re = None
    if keyword_str:
        try:
            keyword_re = re.compile(keyword_str, re.IGNORECASE)
        except re.error:
            return {"error": f"Invalid regex: {keyword_str}"}

    matches: list[dict] = []
    skipped = 0
    total_matched = 0

    for entry in _log_analyzer.stream_file(validated):
        if level_filter and _LEVEL_ORDER.get(entry.level, -1) < min_level:
            continue
        if tag_filter and tag_filter not in (entry.tag or "").lower():
            continue
        if pid_filter and entry.pid != pid_filter:
            continue
        if keyword_re:
            text = f"{entry.tag or ''} {entry.message or ''}"
            if not keyword_re.search(text):
                continue
        if start and entry.timestamp and entry.timestamp < start:
            continue
        if end and entry.timestamp and entry.timestamp > end:
            continue

        total_matched += 1
        if skipped < offset:
            skipped += 1
            continue

        matches.append(_entry_to_dict(entry))

        if len(matches) >= limit:
            break

    return {
        "file": validated,
        "total_matched": total_matched,
        "offset": offset,
        "returned": len(matches),
        "has_more": total_matched > offset + len(matches),
        "entries": matches,
    }


@mcp.tool()
def read_log_range(file_path: str, start_line: int, end_line: int) -> dict:
    """Read a specific line range from a local log file.

    Args:
        file_path: Path to the log file.
        start_line: First line (1-based).
        end_line: Last line (inclusive, max range 10,000 lines).

    Returns:
        Dict with range, total_lines_in_file, entries, count.
        Returns error if start_line > total_lines_in_file.
    """
    try:
        validated = LogAnalyzer._validate_path(file_path)
    except PathTraversalError as e:
        return {"error": f"Path traversal rejected: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except PermissionError as e:
        return {"error": str(e)}
    except ValueError as e:
        return {"error": str(e)}

    start_line = max(int(start_line), 1)
    end_line = max(int(end_line), start_line)
    if end_line - start_line + 1 > 10_000:
        end_line = start_line + 10_000 - 1

    entries: list[dict] = []
    total_lines = 0

    for entry in _log_analyzer.stream_file(validated):
        total_lines += 1
        if entry.line_number < start_line:
            continue
        if entry.line_number > end_line:
            continue
        entries.append(_entry_to_dict(entry))

    if start_line > total_lines:
        return {
            "error": f"start_line {start_line} exceeds total lines {total_lines}",
            "total_lines_in_file": total_lines,
        }

    clamped = ""
    if end_line > total_lines:
        clamped = f" (clamped from {start_line}-{end_line})"
        end_line = total_lines

    return {
        "file": validated,
        "range": f"{start_line}-{end_line}{clamped}",
        "total_lines_in_file": total_lines,
        "entries": entries,
        "count": len(entries),
    }


@mcp.tool()
def tail_local_log(file_path: str, lines: int = 50) -> dict:
    """Read the last N lines of a local log file via ring buffer.

    Args:
        file_path: Path to the log file.
        lines: Number of lines (default 50, max 500).

    Returns:
        Dict with total_lines, entries.
    """
    try:
        validated = LogAnalyzer._validate_path(file_path)
    except PathTraversalError as e:
        return {"error": f"Path traversal rejected: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except PermissionError as e:
        return {"error": str(e)}
    except ValueError as e:
        return {"error": str(e)}

    lines = min(max(int(lines), 1), 500)
    ring: deque[dict] = deque(maxlen=lines)
    total_lines = 0

    for entry in _log_analyzer.stream_file(validated):
        total_lines += 1
        ring.append(_entry_to_dict(entry))

    return {
        "file": validated,
        "total_lines": total_lines,
        "entries": list(ring),
    }


@mcp.tool()
def list_directory_logs(directory_path: str) -> dict:
    """List log files in a directory with size and quick line counts.

    Args:
        directory_path: Path to a directory.

    Returns:
        Dict with total_files, files (list of {name, path, size, line_count}).
    """
    if not os.path.isdir(directory_path):
        return {"error": f"Not a directory: {directory_path}"}

    files: list[dict] = []
    try:
        for entry in sorted(os.scandir(directory_path), key=lambda e: e.name.lower()):
            if not entry.is_file():
                continue
            ext = os.path.splitext(entry.name)[1].lower()
            if ext not in _LOG_EXTENSIONS and ext:
                continue
            file_type = detect_file_type_from_path(entry.path)
            try:
                stat = entry.stat()
                # Quick line count (first 64KB)
                with open(entry.path, "rb") as f:
                    head = f.read(65536)
                line_count = head.count(b"\n")
                if not head.endswith(b"\n"):
                    line_count += 1
            except OSError:
                stat = None
                line_count = 0
            files.append(
                {
                    "name": entry.name,
                    "path": entry.path,
                    "size": stat.st_size if stat else 0,
                    "line_count": line_count,
                    "file_type": file_type,
                }
            )
    except PermissionError:
        pass

    return {
        "total_files": len(files),
        "files": files,
    }


@mcp.tool()
def search_all_local(
    file_path: str,
    keyword_log: str | None = None,
    level: str | None = None,
    tag: str | None = None,
    pid: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    limit_log: int = 50,
    code_pattern: str | None = None,
    code_dir: str | None = None,
    limit_code: int = 30,
) -> dict:
    """Composite search: search BOTH a local log file AND source code directory in one call.

    For debugging workflows where you need log entries AND the code that produced them.

    Args:
        file_path: Path to the log file.
        keyword_log: Keyword or regex to search in log messages.
        level: Log level filter (V, D, I, W, E, F).
        tag: Tag substring filter (case-insensitive).
        pid: Process ID filter.
        start_time: Only include entries after this timestamp.
        end_time: Only include entries before this timestamp.
        limit_log: Max log results (default 50, max 200).
        code_pattern: Regex pattern to search in source code.
        code_dir: Directory to search code in (required if code_pattern set).
        limit_code: Max code results (default 30, max 100).

    Returns:
        Dict with 'logs' and 'code' sections.
    """
    t_start = time.monotonic()

    # ── Validate log path ────────────────────────────────────────────────
    try:
        validated = LogAnalyzer._validate_path(file_path)
    except (PathTraversalError, FileNotFoundError, PermissionError, ValueError) as e:
        return {"error": str(e)}

    # ── Log search ───────────────────────────────────────────────────────
    log_result: dict | None = None
    limit_log = min(max(int(limit_log), 1), 200)

    rg_path = shutil.which("rg")
    keyword = (keyword_log or "").strip()
    use_rg = (
        rg_path is not None
        and keyword
        and not level
        and not tag
        and not pid
        and not start_time
        and not end_time
    )

    if use_rg:
        # Fast path: ripgrep
        try:
            proc = subprocess.run(
                [
                    rg_path,
                    "--no-heading",
                    "--no-filename",
                    "--line-number",
                    "--max-count",
                    str(limit_log),
                    "--regexp",
                    keyword,
                    validated,
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            entries = []
            for line in proc.stdout.splitlines():
                if not line.strip():
                    continue
                # rg output with --no-filename: "line_num:content"
                parts = line.split(":", 1)
                if len(parts) >= 2:
                    try:
                        line_num = int(parts[0])
                    except ValueError:
                        line_num = 0
                    content = parts[1].strip()
                else:
                    line_num = 0
                    content = line.strip()
                parsed = _log_analyzer._parse_single_line(
                    content,
                    line_num,
                    _log_analyzer.detect_log_format(content),
                    source_file=validated,
                )
                entries.append(
                    {
                        "line_number": line_num,
                        "timestamp": parsed.timestamp,
                        "level": parsed.level,
                        "tag": parsed.tag,
                        "pid": parsed.pid,
                        "message": (parsed.message or content)[:500],
                    }
                )
                if len(entries) >= limit_log:
                    break
            log_result = {
                "total_matched": len(entries),
                "returned": len(entries),
                "entries": entries,
                "method": "rg",
            }
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    if log_result is None and (keyword or level or tag or pid or start_time or end_time):
        # Streaming scan fallback
        level_order = {"V": 0, "D": 1, "I": 2, "W": 3, "E": 4, "F": 5}
        min_level = level_order.get((level or "").upper(), 0) if level else 0
        try:
            keyword_re = re.compile(keyword, re.IGNORECASE) if keyword else None
        except re.error:
            keyword_re = None

        matches: list[dict] = []
        total_matched = 0
        for entry in _log_analyzer.stream_file(validated):
            if level and level_order.get(entry.level, -1) < min_level:
                continue
            if tag and (tag.lower() not in (entry.tag or "").lower()):
                continue
            if pid and str(pid) != str(entry.pid):
                continue
            if keyword_re:
                text = f"{entry.tag or ''} {entry.message or ''}"
                if not keyword_re.search(text):
                    continue
            if start_time and entry.timestamp and entry.timestamp < start_time:
                continue
            if end_time and entry.timestamp and entry.timestamp > end_time:
                continue
            total_matched += 1
            if len(matches) >= limit_log:
                continue
            matches.append(
                {
                    "line_number": entry.line_number,
                    "timestamp": entry.timestamp,
                    "level": entry.level,
                    "tag": entry.tag,
                    "pid": entry.pid,
                    "tid": entry.tid,
                    "message": (entry.message or "")[:500],
                }
            )
        log_result = {
            "total_matched": total_matched,
            "returned": len(matches),
            "entries": matches,
            "method": "streaming",
        }

    # ── Code search ──────────────────────────────────────────────────────
    code_result: dict | None = None
    code_pattern = (code_pattern or "").strip()

    if code_pattern and code_dir and os.path.isdir(code_dir):
        limit_code = min(max(int(limit_code), 1), 100)
        if rg_path:
            try:
                proc = subprocess.run(
                    [
                        rg_path,
                        "--json",
                        "--no-heading",
                        "--line-number",
                        "--max-count",
                        str(limit_code),
                        "--regexp",
                        code_pattern,
                        code_dir,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                code_matches = []
                files_seen: set[str] = set()
                for line in proc.stdout.splitlines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "match":
                        d = data.get("data", {})
                        p = d.get("path", {}).get("text", "")
                        rel = os.path.relpath(p, code_dir) if p.startswith(code_dir) else p
                        files_seen.add(p)
                        code_matches.append(
                            {
                                "path": rel,
                                "line_number": d.get("line_number", 0),
                                "line": d.get("lines", {}).get("text", "").rstrip("\n\r")[:500],
                            }
                        )
                        if len(code_matches) >= limit_code:
                            break
                code_result = {
                    "total_matches": len(code_matches),
                    "files_searched": len(files_seen),
                    "returned": len(code_matches),
                    "matches": code_matches,
                }
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

    elapsed = (time.monotonic() - t_start) * 1000
    return {
        "elapsed_ms": int(elapsed),
        "logs": log_result,
        "code": code_result,
    }


@mcp.tool()
def query_perfetto_trace_sql(trace_file_path: str, sql: str | None = None) -> dict:
    """Run SQL queries against a Perfetto trace file.

    Loads the trace file via Perfetto TraceProcessor and executes arbitrary
    SQL against it.  Pass sql=None to discover available table names.

    Common tables: slice, process, thread, sched, counter, raw, ftrace_event,
    android_log, metadata.

    Args:
        trace_file_path: Path to the Perfetto trace file (.pb or .json).
        sql: SQL query to execute. If None, returns available table names.

    Returns:
        If sql is None: {"tables": [...]}.
        Otherwise: {"columns": [...], "rows": [{...}], "row_count": N}.
    """
    return _trace_analyzer.query_sql(trace_file_path, sql)


# ──────────────────────────────────────────────────────────────────────────────
# Diagnostic file tools — ANR traces & tombstones
# ──────────────────────────────────────────────────────────────────────────────

from ..services.diagnostic_parser import DiagnosticParser  # noqa: E402


def _validate_file_path(file_path: str) -> str:
    """Resolve and validate a file path, rejecting traversal escapes.

    Normalises the path, rejects ``..`` components, and resolves symlinks.
    Returns the absolute real path on success.

    Raises:
        ValueError: If the path contains traversal attempts.
    """
    import os

    if not file_path or not isinstance(file_path, str):
        raise ValueError("Invalid file path")

    # Reject path traversal via .. components
    normalized = os.path.normpath(file_path)
    parts = normalized.split(os.sep)
    if ".." in parts:
        raise ValueError(f"Path traversal not allowed: {file_path}")

    return os.path.realpath(file_path)


@mcp.tool()
def parse_anr_trace(file_path: str) -> dict:
    """Parse an Android ANR (App Not Responding) trace file from disk.

    Reads the file at *file_path*, extracts structured information including
    the main thread stack, all thread states, held locks, and wait chains.

    Args:
        file_path: Absolute or relative path to the ANR trace file.

    Returns:
        Structured dict with process info, main_thread, all_threads,
        held_locks, total_threads, anr_subject, and parse_time_ms.
        Returns {"error": "..."} on failure.
    """
    try:
        import os

        file_path = _validate_file_path(file_path)

        if not os.path.isfile(file_path):
            return {"error": f"File not found: {file_path}"}

        size = os.path.getsize(file_path)
        if size > DiagnosticParser.MAX_FILE_SIZE:
            return {
                "error": (
                    f"File too large ({size} bytes, max {DiagnosticParser.MAX_FILE_SIZE // 1000}KB)"
                ),
            }

        with open(file_path, encoding="utf-8", errors="replace") as f:
            content = f.read()
        return DiagnosticParser.parse_anr(content)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Failed to parse ANR trace: {str(e)}"}


@mcp.tool()
def parse_tombstone(file_path: str) -> dict:
    """Parse an Android tombstone (native crash dump) file from disk.

    Reads the file at *file_path*, extracts structured information including
    signal info, CPU registers, backtrace, abort message, and build fingerprint.

    Args:
        file_path: Absolute or relative path to the tombstone file.

    Returns:
        Structured dict with process, signal, registers, backtrace,
        abort_message, build_fingerprint, abort_timestamp, and parse_time_ms.
        Returns {"error": "..."} on failure.
    """
    try:
        import os

        file_path = _validate_file_path(file_path)

        if not os.path.isfile(file_path):
            return {"error": f"File not found: {file_path}"}

        size = os.path.getsize(file_path)
        if size > DiagnosticParser.MAX_FILE_SIZE:
            return {
                "error": (
                    f"File too large ({size} bytes, max {DiagnosticParser.MAX_FILE_SIZE // 1000}KB)"
                ),
            }

        with open(file_path, encoding="utf-8", errors="replace") as f:
            content = f.read()
        return DiagnosticParser.parse_tombstone(content)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Failed to parse tombstone: {str(e)}"}

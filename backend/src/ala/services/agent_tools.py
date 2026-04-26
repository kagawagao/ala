"""Tool definitions and executor for the AI agent."""

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .code_scanner import CodeScanner
from .project_manager import Project


@dataclass
class LogIndex:
    """Pre-built indexes for O(1) log entry lookup by common dimensions."""
    by_level: dict[str, list[int]] = field(default_factory=dict)  # level -> list of entry indices
    by_tag: dict[str, list[int]] = field(default_factory=dict)     # tag (lower) -> list of entry indices
    by_pid: dict[str, list[int]] = field(default_factory=dict)     # pid -> list of entry indices
    total_entries: int = 0


def build_log_index(entries: list[dict]) -> LogIndex:
    """Build per-dimension indexes for O(1) filtering lookups."""
    idx = LogIndex(total_entries=len(entries))
    for i, entry in enumerate(entries):
        level = entry.get("level")
        if level:
            idx.by_level.setdefault(level, []).append(i)
        tag = entry.get("tag")
        if tag:
            idx.by_tag.setdefault(tag.lower(), []).append(i)
        pid = entry.get("pid")
        if pid is not None:
            idx.by_pid.setdefault(str(pid), []).append(i)
    return idx

_scanner = CodeScanner()

# Module-level cache: id(list) -> overview result.
# Safe because id() changes when set_log_entries stores a new list reference.
_overview_cache: dict[int, dict] = {}

# Anthropic tool schemas – project (code/log) tools
AGENT_TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_project_files",
        "description": (
            "List source code files in the project directory. "
            "Returns file paths, sizes, and extensions. Use to discover what code exists."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "subdirectory": {
                    "type": "string",
                    "description": "Optional subdirectory to list (relative to project root)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "read_project_file",
        "description": (
            "Read the content of a specific source file from the project. "
            "Use after listing files to read relevant code."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Relative path to the file within the project",
                },
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "search_project_code",
        "description": (
            "Search for a regex pattern across project source files. "
            "Returns matching lines with file paths and line numbers. "
            "Useful for finding where specific classes, methods, or error strings are defined."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for (case-insensitive by default)",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Whether the search should be case-sensitive",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "list_log_files",
        "description": (
            "List the log files currently loaded in this session. "
            "Returns the unique source file names that were uploaded or loaded by the user. "
            "Use this to discover what log data is available before querying it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]

# Anthropic tool schemas – trace-specific tools
TRACE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_trace_overview",
        "description": (
            "Get a high-level overview of the loaded Perfetto trace: "
            "format, duration, process/thread/event counts, and metadata."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "list_trace_processes",
        "description": (
            "List processes captured in the loaded Perfetto trace. "
            "Optionally filter by a case-insensitive process name substring."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name_filter": {
                    "type": "string",
                    "description": "Case-insensitive substring to filter process names",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of processes to return (default: 50)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_trace_slices",
        "description": (
            "Query top slices (functions/events) ranked by cumulative duration "
            "in the loaded Perfetto trace. Optionally filter by slice name substring."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name_filter": {
                    "type": "string",
                    "description": "Case-insensitive substring to filter slice names",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of slices to return (default: 50)",
                },
            },
            "required": [],
        },
    },
]

# Anthropic tool schemas – log-specific tools
LOG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_log_overview",
        "description": (
            "Get statistics about the loaded Android logs: total count, "
            "level distribution, time range, unique tags and PIDs. "
            "Note: may reflect a capped subset if the log file is very large."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "search_logs",
        "description": (
            "Search and filter the loaded Android log entries. "
            "Start with query_log_overview first, then use targeted search_logs with limit=50. "
            "For more results, paginate with offset. "
            "Returns up to `limit` matching entries starting at `offset`."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string",
                    "description": "Minimum log level to include (V, D, I, W, E, F)",
                },
                "tag": {
                    "type": "string",
                    "description": "Tag substring filter (case-insensitive)",
                },
                "pid": {
                    "type": "string",
                    "description": "Process ID to filter by",
                },
                "keyword": {
                    "type": "string",
                    "description": "Keyword or regex to match in the log message",
                },
                "start_time": {
                    "type": "string",
                    "description": "Only include entries after this timestamp",
                },
                "end_time": {
                    "type": "string",
                    "description": "Only include entries before this timestamp",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 50, max: 500)",
                },
                "offset": {
                    "type": "integer",
                    "description": "Number of matching entries to skip before returning results (default: 0). Use for pagination.",
                },
            },
            "required": [],
        },
    },
]


def execute_tool(
    project: Project | None,
    tool_name: str,
    arguments: str,
    trace_summary: dict | None = None,
    log_entries: list[dict] | None = None,
    log_index: "LogIndex | None" = None,
) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        args = json.loads(arguments) if arguments else {}
    except json.JSONDecodeError:
        return json.dumps({"error": f"Invalid arguments: {arguments}"})

    # Trace tools
    if tool_name in ("query_trace_overview", "list_trace_processes", "query_trace_slices"):
        if trace_summary is None:
            return json.dumps({"error": "No trace loaded in this session"})
        return _execute_trace_tool(tool_name, args, trace_summary)

    # Log tools (work standalone or alongside project tools)
    if tool_name in ("list_log_files", "query_log_overview", "search_logs"):
        if log_entries is None:
            return json.dumps({"error": "No logs loaded in this session"})
        return _execute_log_tool(tool_name, args, log_entries, log_index=log_index)

    # Project tools – project must be present
    if project is None:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    if tool_name == "list_project_files":
        all_files = []
        for path in project.paths:
            files = _scanner.list_files(
                path,
                project.include_patterns,
                project.exclude_patterns,
                subdirectory=args.get("subdirectory"),
            )
            all_files.extend(files)
        return json.dumps(
            {
                "total": len(all_files),
                "files": [
                    {"path": f.path, "size": f.size, "extension": f.extension}
                    for f in all_files[:200]
                ],
            }
        )

    elif tool_name == "read_project_file":
        file_path = args.get("file_path", "")
        for path in project.paths:
            result = _scanner.read_file(path, file_path)
            if result:
                return json.dumps(
                    {
                        "path": result.path,
                        "size": result.size,
                        "truncated": result.truncated,
                        "content": result.content,
                    }
                )
        return json.dumps({"error": f"File not found or unreadable: {file_path}"})

    elif tool_name == "search_project_code":
        pattern = args.get("pattern", "")
        case_sensitive = args.get("case_sensitive", False)
        all_matches = []
        total_files = 0
        total_matches = 0
        for path in project.paths:
            result = _scanner.search_code(
                path,
                pattern,
                project.include_patterns,
                project.exclude_patterns,
                case_sensitive=case_sensitive,
            )
            all_matches.extend(result.matches)
            total_files += result.files_searched
            total_matches += result.total_matches
        return json.dumps(
            {
                "total_matches": total_matches,
                "files_searched": total_files,
                "matches": [
                    {"path": m.path, "line_number": m.line_number, "line": m.line}
                    for m in all_matches[:50]
                ],
            }
        )

    elif tool_name == "read_log_file":
        return _execute_read_log_file(args)

    elif tool_name == "filter_logs":
        return _execute_filter_logs(args)

    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})


def _execute_trace_tool(tool_name: str, args: dict, trace_summary: dict) -> str:
    """Handle the three trace-query tools against a stored trace summary."""
    if tool_name == "query_trace_overview":
        metadata = trace_summary.get("metadata", {})
        overview = {
            "format": trace_summary.get("format", "unknown"),
            "duration_ms": trace_summary.get("duration_ms"),
            "process_count": len(trace_summary.get("processes", [])),
            "total_events": trace_summary.get("total_events"),
            "metadata": metadata,
        }
        return json.dumps(overview)

    if tool_name == "list_trace_processes":
        processes = trace_summary.get("processes", [])
        name_filter = args.get("name_filter", "").lower()
        limit = min(int(args.get("limit", 50)), 500)
        if name_filter:
            processes = [p for p in processes if name_filter in p.get("name", "").lower()]
        return json.dumps(
            {
                "total": len(processes),
                "processes": processes[:limit],
            }
        )

    if tool_name == "query_trace_slices":
        slices = trace_summary.get("top_slices", [])
        name_filter = args.get("name_filter", "").lower()
        limit = min(int(args.get("limit", 50)), 500)
        if name_filter:
            pattern = re.compile(re.escape(name_filter), re.IGNORECASE)
            slices = [s for s in slices if pattern.search(s.get("name", ""))]
        return json.dumps(
            {
                "total": len(slices),
                "slices": slices[:limit],
            }
        )

    return json.dumps({"error": f"Unknown trace tool: {tool_name}"})


_LEVEL_ORDER = {"V": 0, "D": 1, "I": 2, "W": 3, "E": 4, "F": 5}


def _execute_log_tool(
    tool_name: str,
    args: dict,
    log_entries: list[dict],
    log_index: "LogIndex | None" = None,
) -> str:
    """Handle log-query tools against session-stored log entries."""
    if tool_name == "list_log_files":
        # Collect unique source files from loaded log entries
        files: dict[str, int] = {}
        for entry in log_entries:
            src = entry.get("source_file") or "unknown"
            files[src] = files.get(src, 0) + 1
        file_list = [{"name": name, "entry_count": count} for name, count in sorted(files.items())]
        return json.dumps({"total_files": len(file_list), "files": file_list})

    if tool_name == "query_log_overview":
        cache_key = id(log_entries)
        if cache_key in _overview_cache:
            return json.dumps(_overview_cache[cache_key])

        level_counts: dict[str, int] = {}
        tags: set[str] = set()
        pids: set[str] = set()
        timestamps = []
        for entry in log_entries:
            lvl = entry.get("level", "?")
            level_counts[lvl] = level_counts.get(lvl, 0) + 1
            if entry.get("tag"):
                tags.add(entry["tag"])
            if entry.get("pid"):
                pids.add(str(entry["pid"]))
            if entry.get("timestamp"):
                timestamps.append(entry["timestamp"])
        result = {
            "total_stored": len(log_entries),
            "level_distribution": level_counts,
            "unique_tags": len(tags),
            "unique_pids": len(pids),
            "time_range": {
                "start": min(timestamps) if timestamps else None,
                "end": max(timestamps) if timestamps else None,
            },
            "sample_tags": sorted(tags)[:30],
            "sample_pids": sorted(pids)[:30],
        }
        _overview_cache[cache_key] = result
        return json.dumps(result)

    if tool_name == "search_logs":
        level_filter = args.get("level", "").upper()
        tag_filter = args.get("tag", "").lower()
        pid_filter = str(args.get("pid", ""))
        keyword = args.get("keyword", "")
        start_time = args.get("start_time", "")
        end_time = args.get("end_time", "")
        limit = min(int(args.get("limit", 50)), 500)
        offset = max(int(args.get("offset", 0)), 0)

        min_level = _LEVEL_ORDER.get(level_filter, 0) if level_filter else 0
        keyword_re = re.compile(keyword, re.IGNORECASE) if keyword else None

        # Fast path: use pre-built index when no keyword regex or time range is specified
        can_use_index = (
            log_index is not None
            and not keyword_re
            and not start_time
            and not end_time
        )
        if can_use_index:
            # Start with all indices, then intersect by each active filter
            full_set: set[int] | None = None

            if level_filter:
                level_candidates: set[int] = set()
                for lvl, indices in log_index.by_level.items():
                    if _LEVEL_ORDER.get(lvl, 0) >= min_level:
                        level_candidates.update(indices)
                full_set = level_candidates
            else:
                full_set = set(range(log_index.total_entries))

            if tag_filter and full_set:
                tag_indices = set(log_index.by_tag.get(tag_filter, []))
                full_set &= tag_indices

            if pid_filter and full_set:
                pid_indices = set(log_index.by_pid.get(pid_filter, []))
                full_set &= pid_indices

            if full_set is not None:
                candidate_indices = sorted(full_set)
                total_matched = len(candidate_indices)
                page_indices = candidate_indices[offset : offset + limit]
                all_matched = [log_entries[i] for i in page_indices]
            else:
                all_matched = []
                total_matched = 0
        else:
            # Slow path: linear scan (original behavior)
            all_matched = []
            for entry in log_entries:
                lvl = entry.get("level", "V")
                if _LEVEL_ORDER.get(lvl, 0) < min_level:
                    continue
                if tag_filter and tag_filter not in (entry.get("tag") or "").lower():
                    continue
                if pid_filter and pid_filter != str(entry.get("pid") or ""):
                    continue
                ts = entry.get("timestamp") or ""
                if start_time and ts < start_time:
                    continue
                if end_time and ts > end_time:
                    continue
                if keyword_re and not keyword_re.search(
                    entry.get("message") or entry.get("raw_line") or ""
                ):
                    continue
                all_matched.append(entry)

            total_matched = len(all_matched)
            all_matched = all_matched[offset : offset + limit]

        # Trim message length to avoid token overflow when results are sent to the model
        trimmed = []
        for e in all_matched:
            entry_copy = dict(e)
            msg = entry_copy.get("message") or entry_copy.get("raw_line") or ""
            if len(msg) > 300:
                entry_copy["message"] = msg[:300] + "…"
            trimmed.append(entry_copy)

        return json.dumps(
            {
                "total_matched": total_matched,
                "offset": offset,
                "returned": len(trimmed),
                "has_more": (offset + limit) < total_matched,
                "entries": trimmed,
            }
        )

    return json.dumps({"error": f"Unknown log tool: {tool_name}"})


def _execute_list_log_files(args: dict) -> str:
    """List log files in a directory."""
    import os

    log_dir = args.get("log_directory", "")
    if not os.path.isdir(log_dir):
        return json.dumps({"error": f"Directory not found: {log_dir}"})

    log_extensions = {".log", ".txt", ".gz", ".zip", ".logcat", ".trace"}
    files = []
    try:
        for entry in os.scandir(log_dir):
            if entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in log_extensions or not ext:
                    stat = entry.stat()
                    files.append(
                        {
                            "name": entry.name,
                            "path": entry.path,
                            "size": stat.st_size,
                            "extension": ext,
                        }
                    )
    except OSError as e:
        return json.dumps({"error": str(e)})

    files.sort(key=lambda f: f["name"])
    return json.dumps({"total": len(files), "files": files[:100]})


def _execute_read_log_file(args: dict) -> str:
    """Read and parse a log file."""
    from .log_analyzer import LogAnalyzer

    file_path = args.get("file_path", "")
    max_lines = args.get("max_lines", 500)

    if not file_path:
        return json.dumps({"error": "file_path is required"})

    try:
        analyzer = LogAnalyzer()
        with open(file_path, "rb") as f:
            content = f.read()

        import os

        results = analyzer.parse_log_bytes(content, os.path.basename(file_path))
        all_entries = []
        format_detected = "unknown"
        for result in results:
            format_detected = result.format_detected
            all_entries.extend(result.logs)

        entries = all_entries[:max_lines]
        return json.dumps(
            {
                "total_lines": len(all_entries),
                "format_detected": format_detected,
                "entries_returned": len(entries),
                "entries": [
                    {
                        "line_number": e.line_number,
                        "timestamp": e.timestamp,
                        "level": e.level,
                        "tag": e.tag,
                        "pid": e.pid,
                        "message": e.message[:500],
                    }
                    for e in entries
                ],
            }
        )
    except Exception as e:
        return json.dumps({"error": f"Failed to read log: {str(e)}"})


def _execute_filter_logs(args: dict) -> str:
    """Filter log entries from a file."""
    from .log_analyzer import LogAnalyzer, LogFilters

    file_path = args.get("file_path", "")
    max_results = args.get("max_results", 200)

    if not file_path:
        return json.dumps({"error": "file_path is required"})

    try:
        analyzer = LogAnalyzer()
        with open(file_path, "rb") as f:
            content = f.read()

        import os

        results = analyzer.parse_log_bytes(content, os.path.basename(file_path))
        all_entries = []
        for result in results:
            all_entries.extend(result.logs)

        filters = LogFilters(
            level=args.get("level"),
            tag=args.get("tag"),
            keywords=args.get("keyword"),
            pid=args.get("pid"),
            start_time=args.get("start_time"),
            end_time=args.get("end_time"),
        )
        filtered = analyzer.filter_logs(all_entries, filters)
        entries = filtered[:max_results]
        return json.dumps(
            {
                "total_matches": len(filtered),
                "entries_returned": len(entries),
                "entries": [
                    {
                        "line_number": e.line_number,
                        "timestamp": e.timestamp,
                        "level": e.level,
                        "tag": e.tag,
                        "pid": e.pid,
                        "message": e.message[:500],
                    }
                    for e in entries
                ],
            }
        )
    except Exception as e:
        return json.dumps({"error": f"Failed to filter logs: {str(e)}"})

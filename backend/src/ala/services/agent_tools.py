"""Tool definitions and executor for the AI agent."""
import json
from typing import Any

from .code_scanner import CodeScanner
from .project_manager import Project

_scanner = CodeScanner()

# Anthropic tool schemas
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
            "List log and trace files in the project's log directory. "
            "Returns file names, sizes, and types (.log, .txt, .gz, .zip)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "log_directory": {
                    "type": "string",
                    "description": "Path to the log directory to scan",
                },
            },
            "required": ["log_directory"],
        },
    },
    {
        "name": "read_log_file",
        "description": (
            "Read and parse a log file from the log directory. "
            "Returns parsed log entries with timestamps, levels, tags, and messages. "
            "Supports plain text, .gz, and .zip files."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Full path to the log file",
                },
                "max_lines": {
                    "type": "integer",
                    "description": "Maximum number of log lines to return (default: 500)",
                },
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "filter_logs",
        "description": (
            "Filter parsed log entries by level, tag, pid, keyword, or time range. "
            "Use after reading a log file to narrow down results."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Full path to the log file to filter",
                },
                "level": {
                    "type": "string",
                    "description": "Log level filter (V, D, I, W, E, F)",
                },
                "tag": {
                    "type": "string",
                    "description": "Tag filter (substring match)",
                },
                "keyword": {
                    "type": "string",
                    "description": "Keyword to search in log messages",
                },
                "pid": {
                    "type": "string",
                    "description": "Process ID filter",
                },
                "start_time": {
                    "type": "string",
                    "description": "Start timestamp filter",
                },
                "end_time": {
                    "type": "string",
                    "description": "End timestamp filter",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 200)",
                },
            },
            "required": ["file_path"],
        },
    },
]


def execute_tool(project: Project, tool_name: str, arguments: str) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        args = json.loads(arguments) if arguments else {}
    except json.JSONDecodeError:
        return json.dumps({"error": f"Invalid arguments: {arguments}"})

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

    elif tool_name == "list_log_files":
        return _execute_list_log_files(args)

    elif tool_name == "read_log_file":
        return _execute_read_log_file(args)

    elif tool_name == "filter_logs":
        return _execute_filter_logs(args)

    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})


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
                    files.append({
                        "name": entry.name,
                        "path": entry.path,
                        "size": stat.st_size,
                        "extension": ext,
                    })
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
        return json.dumps({
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
        })
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
        return json.dumps({
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
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to filter logs: {str(e)}"})


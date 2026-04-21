"""MCP server for ALA using FastMCP."""

from fastmcp import FastMCP

from ..services.log_analyzer import LogAnalyzer
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

"""Tool definitions and executor for the AI agent."""

import json
import logging
import re
import subprocess
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from ..file_detector import detect_file_type_from_path
from ..services.log_analyzer import LogAnalyzer
from . import code_scanner
from .code_scanner import get_shared_scanner
from .project_manager import Project
from .trace_analyzer import TraceAnalyzer

logger = logging.getLogger(__name__)

# ── Ripgrep availability ────────────────────────────────────────────────────
# Use code_scanner._RG_PATH as the single source of truth.

# ── ToolResultCache (US-FE2) ────────────────────────────────────────────────


@dataclass
class _CacheEntry:
    """A single entry in the tool result cache."""

    result: str  # JSON string (the tool return value)
    cached_at: float  # time.monotonic() when cached


class ToolResultCache:
    """LRU cache with TTL for lazy-log tool results.

    Design decisions
    ─────────────────
    1. **OrderedDict for LRU** — Python's OrderedDict maintains insertion order
       and supports ``move_to_end()`` for O(1) access-time updates.  ``popitem(last=False)``
       evicts the least-recently-used entry in O(1).

    2. **TTL via time.monotonic()** — ``time.monotonic()`` is used instead of
       ``time.time()`` because it is unaffected by system clock changes (NTP,
       daylight saving).  TTL check happens on read (lazy eviction), not on a
       background timer — no threading complexity.

    3. **File mtime in cache key** — Even with identical tool parameters, if
       the file has been modified externally, the cache must miss.  ``os.path.getmtime()``
       is cheap (metadata-only syscall) and uniquely identifies file versions.

    4. **Cache key composition** — ``{tool_name}:{resolved_path}:{canonical_args}:{mtime}``
       ensures that different tools, different files, different parameters, or
       different file versions never collide.
    """

    def __init__(self, max_size: int = 128, ttl_seconds: float = 60.0):
        self._store: OrderedDict[str, _CacheEntry] = OrderedDict()
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds

    # ── Public API ────────────────────────────────────────────────────────

    def get(self, key: str) -> str | None:
        """Return cached result or None if missing/expired."""
        entry = self._store.get(key)
        if entry is None:
            return None
        if time.monotonic() - entry.cached_at > self.ttl_seconds:
            del self._store[key]
            return None
        # Touch: move to end (most-recently-used)
        self._store.move_to_end(key)
        return entry.result

    def set(self, key: str, result: str) -> None:
        """Store a result. Evicts LRU if at capacity."""
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = _CacheEntry(result=result, cached_at=time.monotonic())
        if len(self._store) > self.max_size:
            self._store.popitem(last=False)  # Evict LRU

    def clear(self) -> None:
        """Remove all entries."""
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)

    # ── Cache key builder (static) ────────────────────────────────────────

    @staticmethod
    def build_key(
        tool_name: str,
        resolved_path: str,
        args: dict,
    ) -> str:
        """Build a deterministic cache key for a tool call."""
        import os

        # Canonicalize args: sort keys, use JSON with sorted keys
        canonical = json.dumps(args, sort_keys=True, default=str)
        try:
            mtime = os.path.getmtime(resolved_path)
        except OSError:
            mtime = 0.0

        return f"{tool_name}:{resolved_path}:{canonical}:{mtime}"

    def __contains__(self, key: str) -> bool:
        """Check membership for testing convenience (respects TTL)."""
        entry = self._store.get(key)
        if entry is None:
            return False
        if time.monotonic() - entry.cached_at > self.ttl_seconds:
            del self._store[key]
            return False
        return True


# Module-level cache instance
_lazy_tool_cache = ToolResultCache(max_size=128, ttl_seconds=60.0)


@dataclass
class LogIndex:
    """Pre-built indexes for O(1) log entry lookup by common dimensions."""

    by_level: dict[str, list[int]] = field(default_factory=dict)  # level -> list of entry indices
    by_tag: dict[str, list[int]] = field(
        default_factory=dict
    )  # tag (lower) -> list of entry indices
    by_pid: dict[str, list[int]] = field(default_factory=dict)  # pid -> list of entry indices
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


_scanner = get_shared_scanner()
_trace_analyzer = TraceAnalyzer()


class _OverviewCache:
    """LRU cache for query_log_overview results.

    Uses ``(id(entries), len(entries))`` as the cache key.  The risk of a
    false-positive hit — a different list that happens to land at the same
    memory address *and* has the same length — is negligible in practice:
    Python only reuses an object id after the original object is garbage-
    collected, and matching length at the same address for a *different* log
    session is astronomically unlikely.

    **Assumption**: the ``entries`` list is treated as immutable after the
    first ``set()`` call.  If entries are appended or removed after caching,
    the length changes, which invalidates the key automatically.  Replacing
    entries in-place (same length, different content) would produce a stale
    cache hit — but the session model never mutates loaded log entries in
    place, so this is safe in practice.

    Capped at ``_MAX`` entries with LRU eviction to avoid unbounded growth.
    """

    _MAX = 32

    def __init__(self) -> None:
        self._store: OrderedDict[tuple[int, int], dict] = OrderedDict()

    def _key(self, entries: list[dict]) -> tuple[int, int]:
        return (id(entries), len(entries))

    def get(self, entries: list[dict]) -> dict | None:
        key = self._key(entries)
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def set(self, entries: list[dict], value: dict) -> None:
        key = self._key(entries)
        self._store[key] = value
        self._store.move_to_end(key)
        while len(self._store) > self._MAX:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()


_overview_cache = _OverviewCache()

# Anthropic tool schemas – lazy local file tools (FEAT-LAZY-LOG)
# When file_path points to a directory, use list_directory_logs first,
# then pass explicit file_path to other tools to target specific files.
LAZY_LOG_TOOLS: list[dict] = [
    {
        "name": "list_directory_logs",
        "description": (
            "List log files in the current log source directory. "
            "Use this FIRST when the log source is a directory to discover what files are available. "
            "Returns file names, sizes, and line counts (quick scan). "
            "For a single file source, use overview_local_log instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "overview_local_log",
        "description": (
            "Get statistics about a local Android log file, network capture (pcap), or directory. "
            "Streams through file(s) to compute level distribution, "
            "unique tags/PIDs, time range, and line count. "
            "For pcap files: reports protocols (TCP/UDP/etc) instead of tags. "
            "Does NOT load all entries into memory. "
            "Use this FIRST before search_local_log or read_log_range. "
            "For directories: pass file_path to target a specific file. "
            "Without file_path on a directory: returns aggregate stats across all files."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": (
                        "Optional: specific log file name or path within the log source. "
                        "Required when the log source is a directory."
                    ),
                },
                "max_lines": {
                    "type": "integer",
                    "description": (
                        "Maximum number of lines to scan for overview. "
                        "Useful for sampling large files. "
                        "When specified, scanning stops after max_lines; "
                        "the response includes max_lines_reached: true."
                    ),
                },
            },
            "required": [],
        },
    },
    {
        "name": "search_local_log",
        "description": (
            "Search and filter a local Android log or network capture (pcap) file. "
            "Streams through the file line-by-line, applying filters. "
            "Returns matching entries with pagination support. "
            "For pcap files: tag filter matches protocol (TCP/UDP/etc). "
            "Use overview_local_log first to see what's available. "
            "**file_path is required when the log source is a directory.**"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": (
                        "Log file name or path to search. "
                        "Required when the log source is a directory. "
                        "Optional when source is a single file."
                    ),
                },
                "level": {
                    "type": "string",
                    "description": "Minimum log level (V, D, I, W, E, F)",
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
                    "description": "Keyword or regex to match in log message",
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
                    "description": "Max results (default: 50, max: 500)",
                },
                "offset": {
                    "type": "integer",
                    "description": "Skip N matching entries before returning (pagination)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "read_log_range",
        "description": (
            "Read a specific line range from a local log file. "
            "Useful for getting context around a particular line or timestamp. "
            "**file_path is required when the log source is a directory.**"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": (
                        "Log file name or path to read. "
                        "Required when the log source is a directory. "
                        "Optional when source is a single file."
                    ),
                },
                "start_line": {
                    "type": "integer",
                    "description": "First line to read (1-based)",
                },
                "end_line": {
                    "type": "integer",
                    "description": "Last line to read (1-based, inclusive)",
                },
            },
            "required": ["start_line", "end_line"],
        },
    },
    {
        "name": "tail_local_log",
        "description": (
            "Read the last N lines of a local log file. "
            "Fast way to see recent entries without scanning the whole file. "
            "**file_path is required when the log source is a directory.**"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": (
                        "Log file name or path to read. "
                        "Required when the log source is a directory. "
                        "Optional when source is a single file."
                    ),
                },
                "lines": {
                    "type": "integer",
                    "description": "Number of lines to read from the end (default: 50)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "execute_shell_search",
        "description": (
            "Execute a shell command for direct log/code searching. "
            "Runs in a sandboxed directory (the log source or project root). "
            "Use this for complex searches that the predefined tools can't express: "
            "multi-pattern grep, context lines, awk processing, file statistics, "
            "PowerShell Select-String, etc.\n\n"
            "**Platform**: Linux, macOS, Windows. Uses the native shell "
            "(bash/zsh on Unix, cmd.exe on Windows).\n\n"
            "**Available commands (Unix)**: rg, grep, awk, sed, head, tail, wc, "
            "sort, uniq, cut, find, ls, cat, file, stat, du.\n"
            "**Available commands (Windows)**: rg, findstr, sort, dir, type, "
            "more, where, comp, fc.\n"
            "**Cross-platform**: rg (ripgrep) works everywhere when installed.\n\n"
            "Output limit: 64KB. Timeout: 30s.\n\n"
            "Examples (Unix/Linux/macOS):\n"
            "- rg 'FATAL|ANR' -C 3         (search with 3 lines context)\n"
            "- rg -c 'Exception' | sort -rn (count and rank)\n"
            "- grep -n 'crash' *.log        (search all log files)\n"
            "- awk '/ERROR/,/^$/' log.txt   (error blocks)\n"
            "- find . -name '*.log' -ls     (list log files with details)\n"
            "- wc -l *.log                  (line counts)\n"
            "- rg --files -g '*.py' | head  (list Python files)\n\n"
            "Examples (Windows cmd):\n"
            "- rg 'FATAL|ANR' -C 3          (ripgrep — same as Unix)\n"
            "- findstr /n /i 'crash' *.log  (search with line numbers)\n"
            "- dir /s /b *.log               (list all log files)\n"
            "- type *.log | findstr 'ERROR'  (search across files)\n"
            "- where py.exe                  (locate Python)\n\n"
            "**Security**: commands are sandboxed to the search directory. "
            "Dangerous operations (rm, del, chmod, sudo, curl, wget, etc.) "
            "and file output redirection are blocked."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": (
                        "The shell command to execute. Platform-native syntax supported: "
                        "bash/zsh on Linux/macOS, cmd.exe on Windows. Pipes are allowed."
                    ),
                },
                "workdir": {
                    "type": "string",
                    "description": (
                        "Working directory. Defaults to the log source directory. "
                        "Use 'project' to run in the project root instead."
                    ),
                },
            },
            "required": ["command"],
        },
    },
]

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
        "name": "search_all_local",
        "description": (
            "**Composite search** — search both local log files AND project source code "
            "in a single call, eliminating round trips. "
            "Ideal for debugging workflows where you need to correlate log messages "
            "with the code that produces them.\n\n"
            "Accepts both log search params (level, tag, pid, keyword_log) and "
            "code search params (code_pattern, code_dir). At least one of "
            "keyword_log or code_pattern must be provided. Results from both "
            "searches are returned together.\n\n"
            "Performance: uses ripgrep for near-instant keyword search when available. "
            "For structured log searches (by level/tag/pid), falls back to streaming scan."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Log file name or path to search (required for directories)",
                },
                "level": {
                    "type": "string",
                    "description": "Log level filter (V, D, I, W, E, F)",
                },
                "tag": {
                    "type": "string",
                    "description": "Tag substring filter (case-insensitive)",
                },
                "pid": {
                    "type": "string",
                    "description": "Process ID to filter by",
                },
                "keyword_log": {
                    "type": "string",
                    "description": "Keyword or regex to search in log messages",
                },
                "start_time": {
                    "type": "string",
                    "description": "Only include log entries after this timestamp",
                },
                "end_time": {
                    "type": "string",
                    "description": "Only include log entries before this timestamp",
                },
                "limit_log": {
                    "type": "integer",
                    "description": "Max log results (default: 50, max: 200)",
                },
                "code_pattern": {
                    "type": "string",
                    "description": "Regex pattern to search in source code files",
                },
                "code_dir": {
                    "type": "string",
                    "description": "Directory to search code in (defaults to project root)",
                },
                "limit_code": {
                    "type": "integer",
                    "description": "Max code results (default: 30, max: 100)",
                },
            },
            "required": [],
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
    {
        "name": "query_trace_sql",
        "description": (
            "Run arbitrary SQL queries directly against a Perfetto trace file on disk. "
            "Use this for deep performance analysis: CPU scheduling, memory allocations, "
            "Binder calls, frame timelines, custom counters. "
            "Pass sql=null to discover available tables first. "
            "Common tables: slice, process, thread, sched, counter, raw, ftrace_event, "
            "android_log. Limit results to 200 rows unless aggregating."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "trace_file_path": {
                    "type": "string",
                    "description": "Path to the Perfetto trace file (.pb or .json).",
                },
                "sql": {
                    "type": "string",
                    "description": (
                        "SQL query. Pass null/omit to list available tables. "
                        "Example: SELECT name, dur/1e6 AS ms FROM slice "
                        "WHERE dur > 1e6 ORDER BY dur DESC LIMIT 20"
                    ),
                },
            },
            "required": ["trace_file_path"],
        },
    },
]

# Anthropic tool schemas – PCAP-specific tools
PCAP_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_pcap_overview",
        "description": (
            "Get statistics about the loaded network capture (PCAP/PCAPNG): "
            "total packet count, protocol distribution, time range, unique IPs and ports."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "search_pcap_packets",
        "description": (
            "Search and filter network packets in the loaded PCAP file. "
            "Filter by protocol, source/destination IP, source/destination port, "
            "TCP flags, or packet content. Returns up to `limit` matching packets "
            "starting at `offset`."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "protocol": {
                    "type": "string",
                    "description": "Filter by protocol (e.g., TCP, UDP, ICMP, DNS, HTTP)",
                },
                "src_ip": {
                    "type": "string",
                    "description": "Filter by source IP address (supports partial match)",
                },
                "dst_ip": {
                    "type": "string",
                    "description": "Filter by destination IP address (supports partial match)",
                },
                "src_port": {
                    "type": "integer",
                    "description": "Filter by source port number",
                },
                "dst_port": {
                    "type": "integer",
                    "description": "Filter by destination port number",
                },
                "tcp_flags": {
                    "type": "string",
                    "description": "Filter by TCP flags (e.g., SYN, ACK, FIN, RST)",
                },
                "content": {
                    "type": "string",
                    "description": "Search for text pattern in packet payload",
                },
                "offset": {
                    "type": "integer",
                    "description": "Skip this many matching packets (for pagination)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of packets to return (default: 50)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "list_pcap_files",
        "description": (
            "List the PCAP files currently loaded in this session. "
            "Returns the unique source file names that were uploaded. "
            "Use this to discover what network capture data is available."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
]

# Anthropic tool schemas – HCI Bluetooth tools
HCI_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_hci_overview",
        "description": (
            "Get statistics about the loaded Bluetooth HCI (BTSnoop) log: "
            "total packet count, direction distribution (host-to-controller vs "
            "controller-to-host), HCI type distribution (command, event, ACL, "
            "SCO, ISO), time range, and unique opcode count."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "search_hci_packets",
        "description": (
            "Search and filter HCI packets in the loaded BTSnoop log. "
            "Filter by direction, HCI type, opcode, event code, or keywords. "
            "Returns up to `limit` matching packets starting at `offset`."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "direction": {
                    "type": "string",
                    "description": "HOST_TO_CONTROLLER or CONTROLLER_TO_HOST",
                },
                "hci_type": {
                    "type": "string",
                    "description": "COMMAND, EVENT, ACL_DATA, SCO_DATA, ISO_DATA",
                },
                "opcode": {
                    "type": "integer",
                    "description": "Numeric HCI command opcode (OGF<<10 | OCF), e.g. 0x200D",
                },
                "opcode_name": {
                    "type": "string",
                    "description": "Substring match on human-readable opcode name",
                },
                "event_code": {
                    "type": "integer",
                    "description": "Numeric HCI event code (e.g. 0x07 for COMMAND_COMPLETE)",
                },
                "event_name": {
                    "type": "string",
                    "description": "Substring match on human-readable event name",
                },
                "content": {
                    "type": "string",
                    "description": "Search for text or hex pattern in packet raw_summary",
                },
                "offset": {
                    "type": "integer",
                    "description": "Skip this many matching packets (for pagination)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of packets to return (default: 50)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "list_hci_files",
        "description": (
            "List the Bluetooth HCI (BTSnoop) files currently loaded in this session. "
            "Returns the unique source file names. "
            "Use this to discover what HCI log data is available."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "decode_hci_opcode",
        "description": (
            "Decode a numeric HCI command opcode to its human-readable name. "
            "The opcode is OGF<<10 | OCF. Returns the OGF group, OCF, and standard name."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "opcode": {
                    "type": "integer",
                    "description": "HCI command opcode (e.g. 0x200D for LE_CREATE_CONNECTION)",
                },
            },
            "required": ["opcode"],
        },
    },
]

# Anthropic tool schemas – log-specific tools
LOG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_log_overview",
        "description": (
            "Get statistics about the loaded Android logs or network captures: total count, "
            "level distribution, time range, unique tags/protocols and PIDs. "
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
            "Search and filter the loaded Android log or network capture entries. "
            "Start with query_log_overview first, then use targeted search_logs with limit=50. "
            "For pcap files: tag filter matches protocol (TCP/UDP/etc). "
            "**Time-filtering strategy**: when the user mentions a specific time "
            "(e.g. 'around 14:30', 'at 3pm'), use start_time/end_time with a narrow "
            "±2 minute window first. If that yields fewer than 20 results, expand "
            "the window to ±5 min, then ±15 min, until sufficient context is found. "
            "For large result sets, use the 'offset' parameter to paginate and ensure "
            "you have seen all matching entries before drawing conclusions. "
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


# Anthropic tool schemas – coding/editing tools (available when project is loaded)
CODING_TOOLS: list[dict[str, Any]] = [
    {
        "name": "edit_file",
        "description": (
            "Edit a file in the project by replacing a specific string with new content. "
            "Provide the old_string to find and new_string to replace it with. "
            "The old_string must be unique in the file (or set replace_all=true). "
            "Use this for targeted, safe edits without rewriting entire files."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Relative or absolute path to the file within the project",
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact text to find and replace. Must be unique unless replace_all=true.",
                },
                "new_string": {
                    "type": "string",
                    "description": "The replacement text. Pass empty string to delete the matched text.",
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "If true, replace all occurrences of old_string. Default: false.",
                },
            },
            "required": ["file_path", "old_string", "new_string"],
        },
    },
    {
        "name": "write_file",
        "description": (
            "Create a new file or completely overwrite an existing file in the project. "
            "Use this for creating new files or when you need to replace the entire content. "
            "For targeted edits, use edit_file instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Relative or absolute path to the file within the project",
                },
                "content": {
                    "type": "string",
                    "description": "The complete new content to write to the file",
                },
            },
            "required": ["file_path", "content"],
        },
    },
    {
        "name": "search_files",
        "description": (
            "Search for a regex pattern across project source files. "
            "Returns matching lines with file paths and line numbers. "
            "Use ripgrep when available for fast searching. "
            "For finding file names (not content), use the pattern with target='files'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for (case-insensitive by default)",
                },
                "path": {
                    "type": "string",
                    "description": "Directory or file to search in (defaults to project root)",
                },
                "file_glob": {
                    "type": "string",
                    "description": "Filter files by glob pattern (e.g., '*.py', '*.java')",
                },
                "target": {
                    "type": "string",
                    "enum": ["content", "files"],
                    "description": "'content' searches inside files, 'files' finds files by name (default: content)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 50, max: 200)",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "execute_command",
        "description": (
            "Execute a shell command within the project directory. "
            "Runs commands in a sandboxed environment with a 30-second timeout. "
            "Use this for running tests, builds, linters, or other development commands. "
            "Commands that modify files (rm, chmod, sudo) or access the network (curl, wget) are blocked. "
            "Output is limited to 64KB."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute",
                },
                "workdir": {
                    "type": "string",
                    "description": "Working directory for the command (defaults to first project path)",
                },
            },
            "required": ["command"],
        },
    },
]


def execute_tool(
    project: Project | None,
    tool_name: str,
    arguments: str,
    trace_summary: dict | None = None,
    log_entries: list[dict] | None = None,
    pcap_entries: list[dict] | None = None,
    hci_entries: list[dict] | None = None,
    log_index: "LogIndex | None" = None,
    file_path: str | None = None,
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

    if tool_name == "query_trace_sql":
        trace_file_path = args.get("trace_file_path")
        if not isinstance(trace_file_path, str) or not trace_file_path.strip():
            return json.dumps({"error": "trace_file_path is required"})

        sql = args.get("sql")
        if sql is not None and not isinstance(sql, str):
            return json.dumps({"error": "sql must be a string or null"})
        if isinstance(sql, str) and not sql.strip():
            sql = None

        try:
            return json.dumps(_trace_analyzer.query_sql(trace_file_path=trace_file_path, sql=sql))
        except Exception as e:
            logger.warning("tool=%s failed: %s", tool_name, e, exc_info=True)
            return json.dumps({"error": f"Trace SQL tool failed: {e}"})

    # PCAP tools
    if tool_name in ("query_pcap_overview", "search_pcap_packets", "list_pcap_files"):
        if pcap_entries is None:
            return json.dumps({"error": "No PCAP data loaded in this session"})
        return _execute_pcap_tool(tool_name, args, pcap_entries)

    # HCI tools
    if tool_name in (
        "query_hci_overview",
        "search_hci_packets",
        "list_hci_files",
        "decode_hci_opcode",
    ):
        if hci_entries is None:
            return json.dumps({"error": "No HCI data loaded in this session"})
        return _execute_hci_tool(tool_name, args, hci_entries)

    # Lazy log tools (operate on local file/directory path, not in-memory entries)
    if tool_name in (
        "list_directory_logs",
        "overview_local_log",
        "search_local_log",
        "read_log_range",
        "tail_local_log",
    ):
        if file_path is None:
            return json.dumps({"error": "No local log path set in this session"})
        try:
            return _execute_lazy_log_tool(tool_name, args, file_path)
        except Exception as e:
            logger.warning("tool=%s failed: %s", tool_name, e, exc_info=True)
            return json.dumps({"error": f"Lazy tool '{tool_name}' failed: {e}"})

    # search_all_local — composite: logs + code in one call
    if tool_name == "search_all_local":
        if file_path is None:
            return json.dumps({"error": "No local log path set in this session"})
        try:
            return _execute_search_all_local(args, file_path, project)
        except Exception as e:
            logger.warning("tool=search_all_local failed: %s", e, exc_info=True)
            return json.dumps({"error": f"search_all_local failed: {e}"})

    # execute_shell_search — arbitrary shell commands for searching
    if tool_name == "execute_shell_search":
        if file_path is None and (project is None or not project.paths):
            return json.dumps({"error": "No log path or project set in this session"})
        try:
            return _execute_shell_search(args, file_path, project)
        except Exception as e:
            logger.warning("tool=execute_shell_search failed: %s", e, exc_info=True)
            return json.dumps({"error": f"execute_shell_search failed: {e}"})

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
        requested_path = args.get("file_path", "")
        for path in project.paths:
            result = _scanner.read_file(path, requested_path)
            if result:
                return json.dumps(
                    {
                        "path": result.path,
                        "size": result.size,
                        "truncated": result.truncated,
                        "content": result.content,
                    }
                )
        return json.dumps({"error": f"File not found or unreadable: {requested_path}"})

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

    # Coding tools — edit/write/search/execute within project
    elif tool_name in ("edit_file", "write_file", "search_files", "execute_command"):
        return _execute_coding_tool(tool_name, args, project)

    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})


# ---------------------------------------------------------------------------
# Coding tool executors
# ---------------------------------------------------------------------------

#: Dangerous commands blocked in execute_command (exact executable name match)
_CODING_BLOCKED_COMMANDS: frozenset[str] = frozenset(
    {
        "rm",
        "sudo",
        "chmod",
        "chown",
        "mkfs",
        "dd",
        "curl",
        "wget",
        "nc",
        "ncat",
        "telnet",
        "ssh",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
    }
)

#: Maximum output size for execute_command
_MAX_CMD_OUTPUT = 64 * 1024  # 64 KB


def _resolve_project_path(file_path: str, project: Project) -> str:
    """Resolve a relative path against project paths. Returns absolute path."""
    p = Path(file_path)
    if p.is_absolute():
        # Ensure absolute path is within at least one project root
        resolved = p.resolve()
        for base in project.paths:
            try:
                resolved.relative_to(Path(base).resolve())
                return str(resolved)
            except ValueError:
                continue
        raise ValueError(f"Path '{file_path}' is outside project boundaries")
    # Try each project path as base (with boundary validation)
    for base in project.paths:
        candidate = (Path(base) / file_path).resolve()
        base_resolved = Path(base).resolve()
        try:
            candidate.relative_to(base_resolved)
        except ValueError:
            continue
        if candidate.exists():
            return str(candidate)
    # Default to first project path if file doesn't exist yet (e.g. write_file)
    candidate = (Path(project.paths[0]) / file_path).resolve()
    for base in project.paths:
        try:
            candidate.relative_to(Path(base).resolve())
            return str(candidate)
        except ValueError:
            continue
    raise ValueError(f"Path '{file_path}' resolves outside project boundaries")


def _execute_coding_tool(tool_name: str, args: dict, project: Project) -> str:
    """Execute a coding tool within the project context."""
    try:
        if tool_name == "edit_file":
            file_path = _resolve_project_path(args.get("file_path", ""), project)
            old_string = args.get("old_string", "")
            new_string = args.get("new_string", "")
            replace_all = args.get("replace_all", False)

            try:
                content = Path(file_path).read_text(encoding="utf-8", errors="replace")
            except FileNotFoundError:
                return json.dumps({"error": f"File not found: {file_path}"})

            count = content.count(old_string)
            if count == 0:
                return json.dumps({"error": f"old_string not found in {file_path}"})
            if count > 1 and not replace_all:
                return json.dumps(
                    {
                        "error": (
                            f"old_string found {count} times in {file_path}. "
                            "Set replace_all=true to replace all occurrences, "
                            "or make old_string more specific."
                        )
                    }
                )

            new_content = content.replace(old_string, new_string)
            Path(file_path).write_text(new_content, encoding="utf-8")
            return json.dumps(
                {
                    "success": True,
                    "path": file_path,
                    "replacements": count if replace_all else 1,
                }
            )

        elif tool_name == "write_file":
            file_path = _resolve_project_path(args.get("file_path", ""), project)
            content = args.get("content", "")
            Path(file_path).parent.mkdir(parents=True, exist_ok=True)
            Path(file_path).write_text(content, encoding="utf-8")
            return json.dumps(
                {
                    "success": True,
                    "path": file_path,
                    "size": len(content),
                }
            )

        elif tool_name == "search_files":
            pattern = args.get("pattern", "")
            search_path = args.get("path") or project.paths[0]
            # Validate search_path is within project boundaries
            resolved_sp = Path(search_path).resolve()
            in_project = False
            for base in project.paths:
                try:
                    resolved_sp.relative_to(Path(base).resolve())
                    in_project = True
                    break
                except ValueError:
                    continue
            if not in_project:
                search_path = project.paths[0]  # Fall back to project root
            else:
                search_path = str(resolved_sp)
            file_glob = args.get("file_glob")
            target = args.get("target", "content")
            limit = min(args.get("limit", 50), 200)

            if target == "files":
                # Find files by name pattern
                import fnmatch

                results = []
                for root, _dirs, files in Path(search_path).walk():
                    for f in files:
                        if fnmatch.fnmatch(f, pattern):
                            results.append(str(Path(root) / f))
                            if len(results) >= limit:
                                break
                    if len(results) >= limit:
                        break
                return json.dumps({"matches": results})

            # Content search via ripgrep or fallback to Python
            try:
                cmd = [
                    "rg",
                    "--no-heading",
                    "--with-filename",
                    "--line-number",
                    "--ignore-case",
                    "-e",
                    pattern,
                ]
                if file_glob:
                    cmd.extend(["--glob", file_glob])
                cmd.append(search_path)
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=15,
                    cwd=project.paths[0],
                )
                lines = result.stdout.strip().split("\n")[:limit]
                matches = []
                for line in lines:
                    if ":" not in line:
                        continue
                    idx = line.index(":")
                    idx2 = line.index(":", idx + 1)
                    matches.append(
                        {
                            "path": line[:idx],
                            "line_number": int(line[idx + 1 : idx2]),
                            "line": line[idx2 + 1 :],
                        }
                    )
                return json.dumps({"matches": matches, "total": len(matches)})
            except (FileNotFoundError, subprocess.TimeoutExpired):
                # Fallback: pure Python search
                import re as _re

                pat = _re.compile(pattern, _re.IGNORECASE)
                results = []
                for root, _dirs, files in Path(search_path).walk():
                    for f in files:
                        if file_glob and not f.endswith(
                            tuple(file_glob.replace("*", "").split(","))
                        ):
                            continue
                        fpath = Path(root) / f
                        try:
                            for i, line in enumerate(
                                fpath.read_text(errors="replace").split("\n"), 1
                            ):
                                if pat.search(line):
                                    results.append(
                                        {
                                            "path": str(fpath),
                                            "line_number": i,
                                            "line": line[:200],
                                        }
                                    )
                                    if len(results) >= limit:
                                        break
                        except (OSError, UnicodeDecodeError):
                            continue
                        if len(results) >= limit:
                            break
                    if len(results) >= limit:
                        break
                return json.dumps({"matches": results, "total": len(results)})

        elif tool_name == "execute_command":
            import shlex as _shlex

            command = args.get("command", "")
            workdir = args.get("workdir") or project.paths[0]

            # Validate workdir is within project boundaries
            try:
                workdir_resolved = str(Path(workdir).resolve())
            except (OSError, RuntimeError):
                return json.dumps({"error": f"Invalid workdir path: {workdir}"})
            in_boundary = False
            for base in project.paths:
                try:
                    Path(workdir_resolved).relative_to(Path(base).resolve())
                    in_boundary = True
                    break
                except ValueError:
                    continue
            if not in_boundary:
                return json.dumps({"error": f"workdir '{workdir}' is outside project boundaries"})

            # Security: use shlex.split to safely parse the command and avoid shell injection
            try:
                cmd_parts = _shlex.split(command)
            except ValueError as e:
                return json.dumps({"error": f"Invalid command syntax: {e}"})

            if not cmd_parts:
                return json.dumps({"error": "Empty command"})

            # Block dangerous commands (check the executable name, not just substring)
            cmd_base = Path(cmd_parts[0]).name.lower()
            if cmd_base in _CODING_BLOCKED_COMMANDS:
                return json.dumps({"error": f"Blocked command: '{cmd_parts[0]}' is not allowed"})

            try:
                result = subprocess.run(
                    cmd_parts,
                    shell=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=workdir_resolved,
                )
                output = result.stdout + result.stderr
                if len(output) > _MAX_CMD_OUTPUT:
                    output = output[:_MAX_CMD_OUTPUT] + "\n... (truncated)"
                return json.dumps(
                    {
                        "exit_code": result.returncode,
                        "output": output,
                    }
                )
            except subprocess.TimeoutExpired:
                return json.dumps({"error": "Command timed out after 30 seconds"})

        return json.dumps({"error": f"Unknown coding tool: {tool_name}"})

    except Exception as e:
        logger.warning("coding_tool=%s failed: %s", tool_name, e, exc_info=True)
        return json.dumps({"error": f"Coding tool '{tool_name}' failed: {e}"})


_analyzer = LogAnalyzer()


LOG_EXTENSIONS = {".log", ".txt", ".logcat", ".gz", ".zip", ".hci", ".btsnoop", ".cfa"}


def _resolve_log_path(session_path: str, args: dict) -> str:
    """Resolve the actual file path from session path and optional args.

    - If session_path is a file: return it directly (ignore args.file_path).
    - If session_path is a directory: require args.file_path, resolve relative to dir.
    """
    import os

    if os.path.isfile(session_path):
        return session_path

    if os.path.isdir(session_path):
        target = args.get("file_path", "").strip()
        if not target:
            return ""  # caller should return an error
        # If target is already absolute and exists, use it directly
        if os.path.isabs(target) and os.path.isfile(target):
            return target
        # Otherwise resolve relative to the session directory
        resolved = os.path.join(session_path, target)
        if os.path.isfile(resolved):
            return resolved
        return ""  # not found

    return session_path  # fallback


def _list_directory(session_path: str) -> list[dict]:
    """Scan a directory for log-like files, returning name/size/line_count."""
    import os

    files = []
    try:
        for entry in sorted(os.scandir(session_path), key=lambda e: e.name.lower()):
            if not entry.is_file():
                continue
            ext = os.path.splitext(entry.name)[1].lower()
            if ext not in LOG_EXTENSIONS and ext:
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
    return files


def _execute_lazy_log_tool(tool_name: str, args: dict, file_path: str) -> str:
    """Execute a lazy log tool against a local file or directory path.

    When file_path is a directory:
    - Tools require an explicit ``file_path`` in args (except list_directory_logs).
    - Path resolution: args.file_path joined with session directory path.
    """
    t_start = time.monotonic()
    logger.debug("tool=%s file=%s args=%s", tool_name, file_path, args)

    # ── list_directory_logs (directory only) ────────────────────────────────
    if tool_name == "list_directory_logs":
        files = _list_directory(file_path)
        logger.debug("tool=list_directory_logs file_count=%d", len(files))
        if not files:
            return json.dumps({"error": "No log files found in directory", "files": []})
        return json.dumps({"total_files": len(files), "files": files})

    # ── Resolve target file path ────────────────────────────────────────────
    resolved = _resolve_log_path(file_path, args)
    if not resolved:
        logger.warning(
            "tool=%s path resolution failed: session_path=%s args.file_path=%s",
            tool_name,
            file_path,
            args.get("file_path", ""),
        )
        return json.dumps(
            {
                "error": (
                    "Log source is a directory — you must specify file_path. "
                    "Use list_directory_logs to see available files first."
                )
            }
        )

    # ── Cache lookup (skip for list_directory_logs, and overview with max_lines) ──
    cacheable = tool_name in (
        "overview_local_log",
        "search_local_log",
        "read_log_range",
        "tail_local_log",
    )
    cache_key: str | None = None
    # overview_local_log with explicit max_lines: don't cache (non-deterministic sampling)
    if cacheable and not (tool_name == "overview_local_log" and args.get("max_lines") is not None):
        cache_key = ToolResultCache.build_key(tool_name, resolved, args)
        cached = _lazy_tool_cache.get(cache_key)
        if cached is not None:
            logger.debug("tool=%s cache hit key=%s", tool_name, cache_key[:80])
            return cached

    # ── overview_local_log ──────────────────────────────────────────────────
    if tool_name == "overview_local_log":
        max_lines_arg = args.get("max_lines")
        max_lines = int(max_lines_arg) if max_lines_arg is not None else None
        level_counts: dict[str, int] = {}
        tags: set[str] = set()
        pids: set[str] = set()
        min_timestamp: str | None = None
        max_timestamp: str | None = None
        line_count = 0
        format_detected = "android"
        max_lines_reached = False
        for entry in _analyzer.stream_file(resolved):
            line_count += 1
            if max_lines is not None and line_count > max_lines:
                max_lines_reached = True
                break
            lvl = entry.level or "?"
            level_counts[lvl] = level_counts.get(lvl, 0) + 1
            if entry.tag:
                tags.add(entry.tag)
            if entry.pid:
                pids.add(str(entry.pid))
            if entry.timestamp:
                if min_timestamp is None or entry.timestamp < min_timestamp:
                    min_timestamp = entry.timestamp
                if max_timestamp is None or entry.timestamp > max_timestamp:
                    max_timestamp = entry.timestamp
        result = {
            "file": resolved,
            "total_lines": line_count,
            "parsed_entries": line_count,
            "format_detected": format_detected,
            "level_distribution": level_counts,
            "unique_tags": len(tags),
            "unique_pids": len(pids),
            "time_range": {
                "start": min_timestamp,
                "end": max_timestamp,
            },
            "sample_tags": sorted(tags)[:30],
            "sample_pids": sorted(pids)[:30],
        }
        if max_lines_reached:
            result["max_lines_reached"] = True
        elapsed = (time.monotonic() - t_start) * 1000
        logger.debug(
            "tool=overview_local_log completed in %dms, lines=%d", int(elapsed), line_count
        )
        result_json = json.dumps(result)
        if cache_key is not None:
            _lazy_tool_cache.set(cache_key, result_json)
        return result_json

    # ── search_local_log ────────────────────────────────────────────────────
    if tool_name == "search_local_log":
        level_filter = args.get("level", "").upper()
        tag_filter = args.get("tag", "").lower()
        pid_filter = str(args.get("pid", ""))
        keyword = args.get("keyword", "")
        start_time = args.get("start_time", "")
        end_time = args.get("end_time", "")
        limit = min(int(args.get("limit", 50)), 500)
        offset = max(int(args.get("offset", 0)), 0)

        min_level = _LEVEL_ORDER.get(level_filter, 0) if level_filter else 0
        try:
            keyword_re = re.compile(keyword, re.IGNORECASE) if keyword else None
        except re.error:
            return json.dumps({"error": f"Invalid regex: {keyword}"})

        matches: list[dict] = []
        skipped = 0
        total_matched = 0
        for entry in _analyzer.stream_file(resolved):
            if level_filter and _LEVEL_ORDER.get(entry.level, -1) < min_level:
                continue
            if tag_filter and tag_filter not in entry.tag.lower():
                continue
            if pid_filter and entry.pid != pid_filter:
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
            if skipped < offset:
                skipped += 1
                continue

            matches.append(
                {
                    "line_number": entry.line_number,
                    "timestamp": entry.timestamp,
                    "level": entry.level,
                    "tag": entry.tag,
                    "pid": entry.pid,
                    "tid": entry.tid,
                    "message": entry.message,
                }
            )

            if len(matches) >= limit:
                break

        elapsed = (time.monotonic() - t_start) * 1000
        logger.debug(
            "tool=search_local_log completed in %dms, matched=%d returned=%d",
            int(elapsed),
            total_matched,
            len(matches),
        )
        result = {
            "file": resolved,
            "total_matched": total_matched,
            "offset": offset,
            "returned": len(matches),
            "has_more": len(matches) >= limit or total_matched > offset + len(matches),
            "entries": matches,
        }
        result_json = json.dumps(result)
        if cache_key is not None:
            _lazy_tool_cache.set(cache_key, result_json)
        return result_json

    # ── read_log_range ──────────────────────────────────────────────────────
    if tool_name == "read_log_range":
        start_line = max(int(args.get("start_line", 1)), 1)
        end_line = max(int(args.get("end_line", start_line)), start_line)
        original_end_line = end_line
        if end_line - start_line + 1 > 10_000:
            end_line = start_line + 10_000 - 1
        entries = []
        total_lines = 0
        for entry in _analyzer.stream_file(resolved):
            total_lines += 1
            if entry.line_number < start_line:
                continue
            if entry.line_number > end_line:
                continue
            entries.append(
                {
                    "line_number": entry.line_number,
                    "timestamp": entry.timestamp,
                    "level": entry.level,
                    "tag": entry.tag,
                    "pid": entry.pid,
                    "tid": entry.tid,
                    "message": entry.message,
                }
            )

        # US-A5: error if start_line exceeds total_lines
        if start_line > total_lines:
            elapsed = (time.monotonic() - t_start) * 1000
            logger.debug(
                "tool=read_log_range failed: start_line=%d exceeds total_lines=%d (completed in %dms)",
                start_line,
                total_lines,
                int(elapsed),
            )
            return json.dumps(
                {
                    "error": f"start_line {start_line} exceeds total lines {total_lines}",
                    "total_lines_in_file": total_lines,
                }
            )

        # Clamp end_line and note in range string
        range_str = f"{start_line}-{end_line}"
        if end_line > total_lines:
            end_line = total_lines
            range_str = f"{start_line}-{end_line} (clamped from {start_line}-{original_end_line})"
        elif original_end_line > end_line:
            range_str = f"{start_line}-{end_line} (clamped from {start_line}-{original_end_line})"

        elapsed = (time.monotonic() - t_start) * 1000
        logger.debug(
            "tool=read_log_range completed in %dms, lines=%d",
            int(elapsed),
            len(entries),
        )
        result = {
            "file": resolved,
            "range": range_str,
            "total_lines_in_file": total_lines,
            "entries": entries,
            "count": len(entries),
        }
        result_json = json.dumps(result)
        if cache_key is not None:
            _lazy_tool_cache.set(cache_key, result_json)
        return result_json

    # ── tail_local_log ──────────────────────────────────────────────────────
    if tool_name == "tail_local_log":
        from collections import deque

        lines = min(int(args.get("lines", 50)), 500)
        ring: deque[dict] = deque(maxlen=lines)
        total_lines = 0
        for entry in _analyzer.stream_file(resolved):
            total_lines += 1
            ring.append(
                {
                    "line_number": entry.line_number,
                    "timestamp": entry.timestamp,
                    "level": entry.level,
                    "tag": entry.tag,
                    "pid": entry.pid,
                    "tid": entry.tid,
                    "message": entry.message,
                }
            )
        elapsed = (time.monotonic() - t_start) * 1000
        logger.debug("tool=tail_local_log completed in %dms, lines=%d", int(elapsed), len(ring))
        result = {
            "file": resolved,
            "total_lines": total_lines,
            "entries": list(ring),
        }
        result_json = json.dumps(result)
        if cache_key is not None:
            _lazy_tool_cache.set(cache_key, result_json)
        return result_json

    logger.error("Unknown lazy tool: %s", tool_name)
    return json.dumps({"error": f"Unknown lazy tool: {tool_name}"})


def _execute_pcap_tool(tool_name: str, args: dict, pcap_entries: list[dict]) -> str:
    """Handle PCAP-query tools against stored PCAP entries."""
    if tool_name == "query_pcap_overview":
        # Calculate statistics
        protocols = {}
        ips = set()
        ports = set()
        min_time = None
        max_time = None

        for entry in pcap_entries:
            # Protocol distribution
            protocol = entry.get("protocol", "Unknown")
            protocols[protocol] = protocols.get(protocol, 0) + 1

            # Unique IPs
            if "src_ip" in entry:
                ips.add(entry["src_ip"])
            if "dst_ip" in entry:
                ips.add(entry["dst_ip"])

            # Unique ports (use `is not None` so port 0 is not dropped)
            if "src_port" in entry and entry["src_port"] is not None:
                ports.add(entry["src_port"])
            if "dst_port" in entry and entry["dst_port"] is not None:
                ports.add(entry["dst_port"])

            # Time range
            timestamp = entry.get("timestamp")
            if timestamp:
                if min_time is None or timestamp < min_time:
                    min_time = timestamp
                if max_time is None or timestamp > max_time:
                    max_time = timestamp

        return json.dumps(
            {
                "total_packets": len(pcap_entries),
                "protocols": protocols,
                "unique_ips": len(ips),
                "unique_ports": len(ports),
                "time_range": {
                    "start": min_time,
                    "end": max_time,
                }
                if min_time is not None and max_time is not None
                else None,
            }
        )

    if tool_name == "search_pcap_packets":
        # Apply filters
        filtered = pcap_entries

        protocol = args.get("protocol", "").upper()
        if protocol:
            filtered = [e for e in filtered if e.get("protocol", "").upper() == protocol]

        src_ip = args.get("src_ip", "")
        if src_ip:
            filtered = [e for e in filtered if src_ip in e.get("src_ip", "")]

        dst_ip = args.get("dst_ip", "")
        if dst_ip:
            filtered = [e for e in filtered if dst_ip in e.get("dst_ip", "")]

        src_port = args.get("src_port")
        if src_port is not None:
            filtered = [e for e in filtered if e.get("src_port") == src_port]

        dst_port = args.get("dst_port")
        if dst_port is not None:
            filtered = [e for e in filtered if e.get("dst_port") == dst_port]

        tcp_flags = args.get("tcp_flags", "").upper()
        if tcp_flags:
            filtered = [e for e in filtered if tcp_flags in e.get("tcp_flags", "").upper()]

        content = args.get("content", "")
        if content:
            pattern = re.compile(re.escape(content), re.IGNORECASE)
            filtered = [e for e in filtered if pattern.search(e.get("info", ""))]

        # Pagination (safe int parsing)
        try:
            offset = int(args.get("offset", 0))
        except (ValueError, TypeError):
            offset = 0
        try:
            limit = min(int(args.get("limit", 50)), 500)
        except (ValueError, TypeError):
            limit = 50

        return json.dumps(
            {
                "total": len(filtered),
                "packets": filtered[offset : offset + limit],
            }
        )

    if tool_name == "list_pcap_files":
        # Get unique source files
        source_files = sorted(set(e.get("source_file", "unknown") for e in pcap_entries))
        return json.dumps(
            {
                "total": len(source_files),
                "files": source_files,
            }
        )

    return json.dumps({"error": f"Unknown PCAP tool: {tool_name}"})


def _execute_hci_tool(tool_name: str, args: dict, hci_entries: list[dict]) -> str:
    """Handle HCI-query tools against stored HCI entries."""
    if tool_name == "query_hci_overview":
        directions: dict[str, int] = {}
        types: dict[str, int] = {}
        opcodes: set[int] = set()
        min_time = None
        max_time = None

        for entry in hci_entries:
            direction = entry.get("direction", "Unknown")
            directions[direction] = directions.get(direction, 0) + 1

            hci_type = entry.get("hci_type", "Unknown")
            types[hci_type] = types.get(hci_type, 0) + 1

            opcode = entry.get("opcode")
            if opcode is not None:
                opcodes.add(opcode)

            timestamp = entry.get("timestamp")
            if timestamp:
                if min_time is None or timestamp < min_time:
                    min_time = timestamp
                if max_time is None or timestamp > max_time:
                    max_time = timestamp

        return json.dumps(
            {
                "total_packets": len(hci_entries),
                "by_direction": directions,
                "by_type": types,
                "unique_opcodes": len(opcodes),
                "time_range": {
                    "start": min_time,
                    "end": max_time,
                }
                if min_time is not None and max_time is not None
                else None,
            }
        )

    if tool_name == "search_hci_packets":
        filtered = hci_entries

        direction = args.get("direction", "")
        if direction:
            filtered = [e for e in filtered if e.get("direction") == direction]

        hci_type = args.get("hci_type", "")
        if hci_type:
            filtered = [e for e in filtered if e.get("hci_type") == hci_type]

        opcode = args.get("opcode")
        if opcode is not None:
            try:
                opcode_int = int(opcode) if isinstance(opcode, str) else opcode
            except (ValueError, TypeError):
                opcode_int = opcode
            filtered = [e for e in filtered if e.get("opcode") == opcode_int]

        opcode_name = args.get("opcode_name", "")
        if opcode_name:
            opcode_name_upper = opcode_name.upper()
            filtered = [
                e
                for e in filtered
                if e.get("opcode_name") and opcode_name_upper in e["opcode_name"].upper()
            ]

        event_code = args.get("event_code")
        if event_code is not None:
            try:
                event_code_int = int(event_code) if isinstance(event_code, str) else event_code
            except (ValueError, TypeError):
                event_code_int = event_code
            filtered = [e for e in filtered if e.get("event_code") == event_code_int]

        event_name = args.get("event_name", "")
        if event_name:
            event_name_upper = event_name.upper()
            filtered = [
                e
                for e in filtered
                if e.get("event_name") and event_name_upper in e["event_name"].upper()
            ]

        content = args.get("content", "")
        if content:
            pattern = re.compile(re.escape(content), re.IGNORECASE)
            filtered = [e for e in filtered if pattern.search(e.get("raw_summary", ""))]

        # Pagination
        try:
            offset = int(args.get("offset", 0))
        except (ValueError, TypeError):
            offset = 0
        try:
            limit = min(int(args.get("limit", 50)), 500)
        except (ValueError, TypeError):
            limit = 50

        return json.dumps(
            {
                "total": len(filtered),
                "packets": filtered[offset : offset + limit],
            }
        )

    if tool_name == "list_hci_files":
        source_files = sorted(set(e.get("source_file", "unknown") for e in hci_entries))
        return json.dumps(
            {
                "total": len(source_files),
                "files": source_files,
            }
        )

    if tool_name == "decode_hci_opcode":
        from .hci_analyzer import _decode_opcode

        try:
            opcode_val = int(args.get("opcode", 0))
        except (ValueError, TypeError):
            return json.dumps({"error": "opcode must be an integer"})

        ogf, ocf, name = _decode_opcode(opcode_val)
        return json.dumps(
            {
                "opcode": opcode_val,
                "opcode_hex": f"0x{opcode_val:04X}",
                "ogf": ogf,
                "ogf_hex": f"0x{ogf:02X}",
                "ocf": ocf,
                "ocf_hex": f"0x{ocf:03X}",
                "name": name,
            }
        )

    return json.dumps({"error": f"Unknown HCI tool: {tool_name}"})


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


def _timestamp_to_seconds(value: Any) -> float | None:
    """Best-effort conversion of diverse timestamp formats to epoch-like seconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    # Numeric string (seconds or milliseconds if provided by upstream).
    try:
        return float(text)
    except ValueError:
        pass

    # ISO-like timestamps, including trailing Z.
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        pass

    # Android logcat common formats without year (MM-DD HH:MM:SS(.sss)).
    m = re.match(
        r"^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$",
        text,
    )
    if m:
        month = int(m.group(1))
        day = int(m.group(2))
        hour = int(m.group(3))
        minute = int(m.group(4))
        second = int(m.group(5))
        frac = (m.group(6) or "0").ljust(6, "0")
        micro = int(frac)
        # Pseudo timeline key for bucketing only (relative ordering preserved).
        return (((month * 31 + day) * 24 + hour) * 60 + minute) * 60 + second + micro / 1_000_000

    return None


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
        cached = _overview_cache.get(log_entries)
        if cached is not None:
            return json.dumps(cached)

        level_counts: dict[str, int] = {}
        tags: set[str] = set()
        pids: set[str] = set()
        timestamps: list[str] = []
        numeric_timestamps: list[float] = []
        for entry in log_entries:
            lvl = entry.get("level", "?")
            level_counts[lvl] = level_counts.get(lvl, 0) + 1
            if entry.get("tag"):
                tags.add(entry["tag"])
            if entry.get("pid"):
                pids.add(str(entry["pid"]))
            if entry.get("timestamp"):
                ts_text = str(entry["timestamp"])
                timestamps.append(ts_text)
                ts_num = _timestamp_to_seconds(entry["timestamp"])
                if ts_num is not None:
                    numeric_timestamps.append(ts_num)

        # Build adaptive time-distribution buckets so the AI can pick
        # sensible start_time / end_time windows for search_logs.
        time_dist: list[dict] = []
        if numeric_timestamps:
            t_min = min(numeric_timestamps)
            t_max = max(numeric_timestamps)
            # Choose bucket size that yields 20-60 buckets
            span = max(t_max - t_min, 1)
            bucket_s = span / 40
            for boundary in (1, 5, 10, 30, 60, 300, 600, 1800, 3600):
                if bucket_s <= boundary:
                    bucket_s = boundary
                    break
            buckets: dict[int, int] = {}
            for ts in numeric_timestamps:
                slot = int((ts - t_min) / bucket_s)
                buckets[slot] = buckets.get(slot, 0) + 1
            time_dist = [
                {"bucket_start": t_min + s * bucket_s, "count": c}
                for s, c in sorted(buckets.items())
            ]

        result = {
            "total_stored": len(log_entries),
            "level_distribution": level_counts,
            "unique_tags": len(tags),
            "unique_pids": len(pids),
            "time_range": {
                "start": min(timestamps) if timestamps else None,
                "end": max(timestamps) if timestamps else None,
            },
            "time_distribution": time_dist,
            "sample_tags": sorted(tags)[:30],
            "sample_pids": sorted(pids)[:30],
        }
        _overview_cache.set(log_entries, result)
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

        # Fast path: use pre-built index when no keyword regex or time range is specified.
        # Tag filter must also be an exact tag match for the index to apply; partial/substring
        # tag filters fall through to the slow path to preserve consistent semantics.
        can_use_index = (
            log_index is not None
            and not keyword_re
            and not start_time
            and not end_time
            and (not tag_filter or tag_filter in log_index.by_tag)
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

            if tag_filter and full_set is not None:
                # Exact match only (ensured by can_use_index check above)
                tag_indices = set(log_index.by_tag.get(tag_filter, []))
                full_set &= tag_indices

            if pid_filter and full_set is not None:
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
            # Slow path: linear scan with streaming to avoid a large intermediate list.
            # Count matches and collect only the page [offset, offset+limit) in one pass.
            all_matched = []
            total_matched = 0
            entries_skipped = 0  # tracks progress toward the offset target
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
                total_matched += 1
                if entries_skipped < offset:
                    entries_skipped += 1
                    continue
                if len(all_matched) < limit:
                    all_matched.append(entry)

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


# ── Ripgrep-accelerated log search ────────────────────────────────────────


def _search_log_with_rg(
    file_path: str,
    keyword: str,
    *,
    limit: int = 50,
    case_sensitive: bool = False,
) -> list[dict] | None:
    """Search a log file for *keyword* using ripgrep (10-100x faster than Python scan).

    Returns parsed log entries (same format as search_local_log) when possible,
    or raw line matches when the file can't be parsed as logcat.

    Falls back gracefully if rg is unavailable.
    """
    rg_path = code_scanner._RG_PATH
    if rg_path is None:
        return None  # Caller should fall back to streaming scan

    cmd: list[str] = [
        rg_path,
        "--json",  # robust parsing across platforms
        "--no-heading",
        "--line-number",
    ]

    if not case_sensitive:
        cmd.append("--ignore-case")

    cmd.extend(["--regexp", keyword, file_path])

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError:
        logger.debug("rg log search failed, will fall back")
        return None

    results: list[dict] = []
    early_exit = False

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("type") != "match":
                continue

            data = entry.get("data", {})
            line_num = int(data.get("line_number") or 0)
            content = (data.get("lines", {}) or {}).get("text", "").rstrip("\n\r")

            parsed = _analyzer._parse_single_line(
                content,
                line_num,
                _analyzer.detect_log_format(content),
                source_file=file_path,
            )
            results.append(
                {
                    "line_number": line_num,
                    "timestamp": parsed.timestamp,
                    "level": parsed.level,
                    "tag": parsed.tag,
                    "pid": parsed.pid,
                    "message": (parsed.message or content)[:500],
                }
            )

            if len(results) >= limit:
                early_exit = True
                break
    finally:
        if early_exit:
            try:
                proc.terminate()
            except Exception:
                pass
        try:
            proc.wait(timeout=5 if early_exit else 15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    # ripgrep exit codes:
    # 0 = matches found, 1 = no matches, 2 = error
    if not early_exit and proc.returncode not in (0, 1):
        return None

    return results


# ── Composite search_all_local executor ───────────────────────────────────


def _execute_search_all_local(args: dict, file_path: str, project: "Project | None") -> str:
    """Execute search_all_local: combined log + code search in one call.

    Runs log search (via rg fast path or streaming) and code search (via rg or
    Python) and returns combined results. Log search uses the session file_path;
    code search uses the project root.

    At least one of keyword_log or code_pattern must be provided.
    """
    t_start = time.monotonic()
    import os

    # ── Log search ───────────────────────────────────────────────────────
    log_result: dict | None = None
    keyword_log = (args.get("keyword_log") or "").strip()
    level_filter = (args.get("level") or "").upper()
    tag_filter = (args.get("tag") or "").lower()
    pid_filter = str(args.get("pid") or "")
    start_time = args.get("start_time")
    end_time = args.get("end_time")
    limit_log = min(int(args.get("limit_log") or 50), 200)
    log_file = (args.get("file_path") or "").strip()

    # ── Code search params (extract early for validation) ─────────────────
    code_pattern = (args.get("code_pattern") or "").strip()

    # Validate: at least one search target must be provided
    if (
        not keyword_log
        and not code_pattern
        and not level_filter
        and not tag_filter
        and not pid_filter
    ):
        elapsed = (time.monotonic() - t_start) * 1000
        return json.dumps(
            {
                "error": (
                    "At least one search target is required: provide keyword_log, "
                    "code_pattern, or a structured filter (level/tag/pid)"
                ),
                "elapsed_ms": int(elapsed),
            }
        )

    # Resolve the log file path (same logic as _resolve_log_path)
    resolved_log = file_path
    if os.path.isdir(file_path) and log_file:
        candidate = os.path.join(file_path, log_file)
        if os.path.isfile(candidate):
            resolved_log = candidate
        elif os.path.isabs(log_file) and os.path.isfile(log_file):
            resolved_log = log_file
    if not os.path.isfile(resolved_log):
        elapsed = (time.monotonic() - t_start) * 1000
        return json.dumps(
            {
                "error": "Invalid log file path",
                "elapsed_ms": int(elapsed),
            }
        )

    # Fast path: use rg for keyword-only search (no structured filters)
    use_rg = (
        code_scanner._RG_PATH is not None
        and keyword_log
        and not level_filter
        and not tag_filter
        and not pid_filter
        and not start_time
        and not end_time
    )

    if use_rg:
        log_matches = _search_log_with_rg(resolved_log, keyword_log, limit=limit_log)
        if log_matches is not None:
            log_result = {
                "total_matched": len(log_matches),
                "returned": len(log_matches),
                "entries": log_matches,
                "method": "rg",
            }
        else:
            use_rg = False

    if not use_rg and (
        keyword_log or level_filter or tag_filter or pid_filter or start_time or end_time
    ):
        # Structured search: use streaming scanner (mimic search_local_log)
        min_level = _LEVEL_ORDER.get(level_filter, 0) if level_filter else 0
        try:
            keyword_re = re.compile(keyword_log, re.IGNORECASE) if keyword_log else None
        except re.error:
            elapsed = (time.monotonic() - t_start) * 1000
            return json.dumps(
                {"error": f"Invalid regex: {keyword_log}", "elapsed_ms": int(elapsed)}
            )

        matches: list[dict] = []
        total_matched = 0
        for entry in _analyzer.stream_file(resolved_log):
            if level_filter and _LEVEL_ORDER.get(entry.level, -1) < min_level:
                continue
            if tag_filter and tag_filter not in entry.tag.lower():
                continue
            if pid_filter and entry.pid != pid_filter:
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
    code_dir = (args.get("code_dir") or "").strip()
    limit_code = min(int(args.get("limit_code") or 30), 100)

    if code_pattern and project is not None:
        scanner = code_scanner.CodeScanner()
        search_root = code_dir if code_dir else project.paths[0] if project.paths else ""

        if search_root and os.path.isdir(search_root):
            sr = scanner.search_code(
                search_root,
                code_pattern,
                project.include_patterns if project else ["*"],
                project.exclude_patterns if project else [],
                case_sensitive=False,
                max_results=limit_code,
            )
            code_result = {
                "total_matches": sr.total_matches,
                "files_searched": sr.files_searched,
                "returned": len(sr.matches),
                "matches": [
                    {"path": m.path, "line_number": m.line_number, "line": m.line}
                    for m in sr.matches
                ],
            }

    # ── Combine ──────────────────────────────────────────────────────────
    elapsed = (time.monotonic() - t_start) * 1000
    logger.debug(
        "tool=search_all_local completed in %dms log_matches=%d code_matches=%d",
        int(elapsed),
        log_result["returned"] if log_result else 0,
        code_result["returned"] if code_result else 0,
    )

    combined = {
        "elapsed_ms": int(elapsed),
        "logs": log_result,
        "code": code_result,
    }
    return json.dumps(combined)


# ── Shell search executor ────────────────────────────────────────────────

# Platform detection for cross-platform support
_IS_WINDOWS = sys.platform == "win32"

# Commands blocked for security in execute_shell_search
# Platform-specific: Windows has different command names for dangerous operations
_UNIX_BLOCKED_COMMANDS = frozenset(
    {
        "rm",
        "mv",
        "cp",
        "chmod",
        "chown",
        "sudo",
        "su",
        "curl",
        "wget",
        "nc",
        "telnet",
        "ssh",
        "scp",
        "kill",
        "pkill",
        "reboot",
        "shutdown",
        "systemctl",
        "dd",
        "mkfs",
        "mount",
        "umount",
        "python",
        "python3",
        "pip",
        "npm",
        "node",
    }
)

_WINDOWS_BLOCKED_COMMANDS = frozenset(
    {
        # File destruction
        "del",
        "erase",
        "rmdir",
        "rd",
        "format",
        # Permission/registry
        "cacls",
        "icacls",
        "takeown",
        "reg",
        "regedit",
        # System admin
        "net",
        "taskkill",
        "tskill",
        "shutdown",
        "logoff",
        # Network
        "curl",
        "wget",
        "nc",
        "telnet",
        "ftp",
        "ssh",
        # Interpreters
        "python",
        "python3",
        "pip",
        "npm",
        "node",
        "npx",
        # WSL escape
        "wsl",
        "bash",
    }
)

_BLOCKED_COMMANDS = _WINDOWS_BLOCKED_COMMANDS if _IS_WINDOWS else _UNIX_BLOCKED_COMMANDS

# Characters/substrings that are always blocked (write redirects)
_BLOCKED_TOKENS = frozenset({">", ">>"})

_SHELL_TIMEOUT = 30
_MAX_OUTPUT_BYTES = 64 * 1024  # 64KB


def _split_command_cross_platform(command: str) -> list[str] | None:
    """Parse a shell command string into tokens, cross-platform.

    Unix: uses shlex.split() (POSIX shell rules).
    Windows: basic tokenizer that handles quoted strings and cmd.exe metacharacters
        (&&, ||, |).  We don't need a full cmd parser — just enough to extract
        the first token for security checks.

    Returns None if the command is empty after parsing.
    """
    command = command.strip()
    if not command:
        return None

    if _IS_WINDOWS:
        # Basic cmd.exe tokenization: split on spaces, respect double-quotes
        tokens: list[str] = []
        current: list[str] = []
        in_quotes = False
        for ch in command:
            if ch == '"':
                in_quotes = not in_quotes
                current.append(ch)
            elif ch in (" ", "\t") and not in_quotes:
                if current:
                    tokens.append("".join(current))
                    current = []
            else:
                current.append(ch)
        if current:
            tokens.append("".join(current))

        # Strip surrounding quotes from each token for comparison
        tokens = [t[1:-1] if t.startswith('"') and t.endswith('"') else t for t in tokens]
        return tokens if tokens else None
    else:
        import shlex

        try:
            tokens = shlex.split(command)
        except ValueError:
            return None
        return tokens if tokens else None


def _check_command_blocked(command: str, tokens: list[str]) -> dict | None:
    """Return an error dict if the command is blocked, otherwise None.

    Checks:
    1. First token (command name) against _BLOCKED_COMMANDS.
    2. Write-redirect tokens (">", ">>") unless inside a pipeline.
    3. Shell metacharacter chaining on Windows (&&, ||).
    """
    import os as _os

    cmd_base = _os.path.basename(tokens[0]).lower()
    if cmd_base in _BLOCKED_COMMANDS:
        return {
            "error": f"Command '{tokens[0]}' is blocked for security reasons",
            "exit_code": -1,
        }

    # Block write redirects (> file) unless used in a pipe context
    if "|" not in command:
        for tok in _BLOCKED_TOKENS:
            if tok in tokens:
                return {
                    "error": "File output redirection is blocked. Use pipes instead.",
                    "exit_code": -1,
                }

    # On Windows: block cmd-chaining operators that could bypass
    if _IS_WINDOWS:
        for dangerous in ("&&", "||", "&"):
            if dangerous in tokens:
                return {
                    "error": f"Command chaining '{dangerous}' is blocked for security",
                    "exit_code": -1,
                }

    return None


def _resolve_shell_workdir(
    args: dict, file_path: str | None, project: "Project | None"
) -> str | None:
    """Resolve the working directory for shell command execution.

    Returns the resolved directory path, or None if unresolvable.
    """
    import os as _os

    workdir_mode = (args.get("workdir") or "").strip().lower()

    if workdir_mode == "project":
        if project is not None and project.paths:
            return project.paths[0]
        return None
    elif file_path:
        if _os.path.isdir(file_path):
            return file_path
        elif _os.path.isfile(file_path):
            return _os.path.dirname(file_path) or "."
    return None


def _get_shell_env(cwd: str) -> dict[str, str]:
    """Build a sanitized environment dict for shell command execution.

    Cross-platform: preserves PATH from the parent process.
    On Windows: adds SystemRoot and COMSPEC if missing.
    """
    import os as _os

    env = {**_os.environ}  # Start with the real environment

    # Ensure HOME / USERPROFILE is sandboxed to cwd
    if _IS_WINDOWS:
        env["USERPROFILE"] = cwd
        env["HOMEDRIVE"] = _os.path.splitdrive(cwd)[0] or "C:"
        env["HOMEPATH"] = cwd
        # cmd.exe needs these
        if "SystemRoot" not in env:
            env["SystemRoot"] = _os.environ.get("SystemRoot", "C:\\Windows")
        if "COMSPEC" not in env:
            env["COMSPEC"] = _os.environ.get("COMSPEC", "C:\\Windows\\System32\\cmd.exe")
    else:
        env["HOME"] = cwd

    return env


def _execute_shell_search(args: dict, file_path: str | None, project: "Project | None") -> str:
    """Execute a shell command for searching logs/code.

    Cross-platform: works on Linux, macOS, and Windows.
    Sandboxes the command to the log source directory or project root.
    Blocks dangerous commands and enforces timeout/output limits.
    """
    import os as _os

    t_start = time.monotonic()

    command = (args.get("command") or "").strip()
    if not command:
        return json.dumps({"error": "command is required", "exit_code": -1})

    # ── Security: parse and block dangerous commands ────────────────────
    tokens = _split_command_cross_platform(command)
    if not tokens:
        return json.dumps({"error": "empty command after parsing", "exit_code": -1})

    err = _check_command_blocked(command, tokens)
    if err is not None:
        return json.dumps(err)

    # ── Determine working directory ────────────────────────────────────
    cwd = _resolve_shell_workdir(args, file_path, project)
    if not cwd or not _os.path.isdir(cwd):
        return json.dumps(
            {
                "error": "No valid working directory available. Set a log source or project.",
                "exit_code": -1,
            }
        )

    # ── Execute ────────────────────────────────────────────────────────
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_SHELL_TIMEOUT,
            env=_get_shell_env(cwd),
        )
    except subprocess.TimeoutExpired:
        elapsed = (time.monotonic() - t_start) * 1000
        return json.dumps(
            {
                "error": f"Command timed out after {_SHELL_TIMEOUT}s",
                "exit_code": -1,
                "elapsed_ms": int(elapsed),
            }
        )
    except FileNotFoundError:
        return json.dumps(
            {
                "error": f"Command not found: {tokens[0]}",
                "exit_code": -1,
            }
        )

    elapsed = (time.monotonic() - t_start) * 1000

    # Trim output
    stdout = proc.stdout[:_MAX_OUTPUT_BYTES]
    stderr = proc.stderr[:_MAX_OUTPUT_BYTES]
    truncated = len(proc.stdout) > _MAX_OUTPUT_BYTES or len(proc.stderr) > _MAX_OUTPUT_BYTES

    logger.debug(
        "tool=execute_shell_search completed in %dms exit=%d stdout=%d stderr=%d platform=%s",
        int(elapsed),
        proc.returncode,
        len(stdout),
        len(stderr),
        sys.platform,
    )

    result = {
        "command": command[:500],
        "workdir": cwd,
        "exit_code": proc.returncode,
        "elapsed_ms": int(elapsed),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": truncated,
        "platform": sys.platform,
    }
    return json.dumps(result)


# ── Timestamp byte-offset index for O(log n) time-range queries ─────────

# Module-level index cache: file_path -> list of (timestamp_sortable, byte_offset)
_timestamp_index_cache: dict[str, list[tuple[int, int]]] = {}
_MAX_INDEX_SIZE = 500_000  # max entries per index


def _build_timestamp_index(file_path: str) -> list[tuple[int, int]]:
    """Build a timestamp→byte_offset index for binary-search time queries.

    Returns a sorted list of (timestamp_sortable_int, byte_offset) tuples.
    The sortable int is a pseudo-timeline key from _timestamp_to_seconds().
    """
    if file_path in _timestamp_index_cache:
        return _timestamp_index_cache[file_path]

    index: list[tuple[int, int]] = []
    with open(file_path, "rb") as f:
        offset = 0
        for raw_line in f:
            line = raw_line.decode("utf-8", errors="replace").rstrip("\n\r")
            if not line.strip():
                offset += len(raw_line)
                continue
            # Try to parse as a logcat entry to extract timestamp
            parsed = _analyzer._parse_single_line(
                line,
                0,
                _analyzer.detect_log_format(line),
                source_file=file_path,
            )
            if parsed.timestamp:
                ts_sec = _timestamp_to_seconds(parsed.timestamp)
                if ts_sec is not None:
                    index.append((int(ts_sec), offset))

            offset += len(raw_line)
            if len(index) >= _MAX_INDEX_SIZE:
                break

    _timestamp_index_cache[file_path] = index
    return index


def _binary_search_timerange(
    file_path: str, start_time: str | None, end_time: str | None
) -> tuple[int, int] | None:
    """Return (start_offset, end_offset) for a time range using binary search.

    Returns None if the index can't be built or the time range can't be resolved.
    """
    import bisect

    index = _build_timestamp_index(file_path)
    if not index:
        return None

    timestamps = [e[0] for e in index]

    start_ts = _timestamp_to_seconds(start_time) if start_time else None
    end_ts = _timestamp_to_seconds(end_time) if end_time else None

    if start_ts is not None:
        start_idx = bisect.bisect_left(timestamps, int(start_ts))
    else:
        start_idx = 0

    if end_ts is not None:
        end_idx = bisect.bisect_right(timestamps, int(end_ts)) - 1
    else:
        end_idx = len(index) - 1

    if start_idx > end_idx or start_idx >= len(index):
        return None

    return (index[start_idx][1], index[end_idx][1])

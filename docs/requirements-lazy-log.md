# Requirements Document: Local File Path Log Analysis (Lazy AI-Driven)

- **Feature ID**: FEAT-LAZY-LOG
- **Version**: 1.0.0
- **Author**: Product Manager
- **Date**: 2026-04-27
- **Status**: Draft

---

## 1. Product Vision

Currently, ALA requires users to fully upload log files via multipart form. The backend parses the entire file into memory (capped at 256 MiB), builds indexes, and stores all entries before the AI agent can begin analysis. This causes three problems:

1. **OOM risk** — large log files exceed the 256 MiB cap and crash the parser.
2. **Slow time-to-first-insight** — users wait through a full upload + parse cycle before the AI can answer _any_ question.
3. **Wasted work** — the AI agent typically only inspects a small fraction of the entries (e.g., crash-relevant lines, a specific PID's output). Pre-loading the entire file is unnecessary.

The "Local File Path Input + Lazy AI-Driven Analysis" feature flips the model:

- Instead of uploading and pre-parsing entire files, the user enters a **local file path** on the machine where the ALA backend runs.
- The AI agent receives **streaming, on-demand tools** that read/parse the file line-by-line.
- No pre-loading, no memory caps, no pre-built indexes. The AI decides what to search for, when.

This feature is **additive** — the existing upload+parse flow remains unchanged and fully supported.

---

## 2. User Stories

### US-1: Enter Local File Path in the Frontend

**As a** log analyst,
**I want to** enter a local file path (on the backend machine) instead of uploading a file,
**so that** I can analyze logs that are already present on the server without transferring them over the network.

**Acceptance Criteria**:

1. The `FileUpload` component gains a new input mode: "Local File Path" — a text input with a file-path placeholder (e.g., `/data/logs/logcat.txt`), displayed alongside the existing drag-and-drop upload area.
2. The path input is visually separated from the upload area (e.g., a divider labeled "Or analyze a local file path") to avoid confusing the two workflows.
3. When the user submits a path, the frontend calls a **new API endpoint** (`POST /api/logs/parse-local`) with `{ "path": "/data/logs/logcat.txt" }`.
4. The backend validates that the path exists and is a readable regular file, returning a proper error if not (see US-5).
5. On success, the backend returns a **session file reference** (not the parsed log entries) — specifically:
   - `{ "session_file": "/data/logs/logcat.txt", "line_count": 125000, "size_bytes": 48234496, "format": "android_logcat" }`
   - The `line_count` and `format` are determined by a fast first-pass scan (line counting only, no full parsing).
6. The frontend stores the `session_file` reference and passes it to the AI panel. The `LogViewer` does **not** display anything initially — results are shown only after the AI agent invokes tools that return entries.
7. The existing file upload flow (drag-and-drop, directory scan) is not affected or altered.

**Priority**: P0 (Must Have) — this is the entry point for the entire feature.

---

### US-2: AI Tool — `overview_local_log` (Streaming Statistics)

**As an** AI agent analyzing a local log file,
**I want to** call `overview_local_log(path)` to get a statistical overview without loading the file into memory,
**so that** I can decide what to investigate next (which PIDs, tags, time ranges, or levels matter).

**Acceptance Criteria**:

1. The tool reads the file **line-by-line** (never loading the entire file into memory).
2. For each line, it attempts to parse an Android logcat entry (using the existing `LogAnalyzer` format detection and parsing logic, but applied to a single line at a time).
3. It accumulates aggregate statistics in memory (counters, sets for unique tags/PIDs, min/max timestamps, level distribution). The memory overhead is bounded by the number of _distinct_ tags/PIDs, not the file size.
4. The tool returns a JSON object containing:
   - `total_lines` (int) — total lines in the file.
   - `parsed_entries` (int) — lines successfully parsed as log entries.
   - `level_distribution` (dict: level → count).
   - `unique_tags` (int) — count of distinct tags.
   - `unique_pids` (int) — count of distinct PIDs.
   - `time_range` (object: `start`, `end`) — earliest and latest timestamps found.
   - `sample_tags` (list of up to 30 strings) — alphabetically sorted, for the AI to reference.
   - `sample_pids` (list of up to 30 strings).
   - `format_detected` (string) — `android_logcat`, `generic_timestamped`, or `unknown`.
5. Lines that do not match any known log format are counted in `total_lines` but excluded from `parsed_entries` and all derived statistics.
6. The tool completes in O(file_size) time with O(unique_tags + unique_pids) memory.
7. The tool is defined as a new entry in `AGENT_TOOLS` (or a new `LAZY_LOG_TOOLS` list) with a proper Anthropic tool schema (`name`, `description`, `input_schema`). The `input_schema` requires `path` (string) and accepts an optional `max_lines` (integer, default: unlimited) to cap the scan for extremely large files.

**Priority**: P0 (Must Have) — the AI needs this to orient itself.

---

### US-3: AI Tool — `search_local_log` (Streaming Filtered Search)

**As an** AI agent analyzing a local log file,
**I want to** call `search_local_log(path, filters)` to retrieve matching log entries by streaming through the file once,
**so that** I can find specific crash traces, error patterns, or process output without loading the entire file into memory.

**Acceptance Criteria**:

1. The tool streams through the file **line-by-line**.
2. For each line, it parses the entry (using existing `LogAnalyzer` line parsing) and tests against the provided filters:
   - `level` (string, minimum level: V/D/I/W/E/F)
   - `tag` (string, case-insensitive substring match)
   - `pid` (string, exact match)
   - `keyword` (string, regex on message + raw_line)
   - `start_time` / `end_time` (string, timestamp range)
   - `limit` (int, default 50, max 500)
   - `offset` (int, default 0)
3. Matched entries are collected in memory **up to `offset + limit`**. Early entries (before offset) are counted but not stored. Entries after `offset + limit` are ignored (short-circuit).
4. The tool returns:
   - `total_matched` (int) — total number of matching entries in the file.
   - `offset` (int) — as requested.
   - `returned` (int) — number of entries in this response.
   - `has_more` (bool) — true if more matches exist beyond `offset + limit`.
   - `entries` (list of objects with `line_number`, `timestamp`, `level`, `tag`, `pid`, `tid`, `message` truncated to 300 chars).
5. The tool definition's `input_schema` mirrors `search_logs` but adds the required `path` field.
6. Memory usage is bounded: at most `offset + limit` entries are held simultaneously, plus the filter state (minimal).

**Priority**: P0 (Must Have) — this is the primary investigation tool.

---

### US-4: AI Tool — `read_log_range` and `tail_local_log` (Precise Line Access)

**As an** AI agent,
**I want to** read a specific line range from a local log file and tail the last N lines,
**so that** I can inspect context around a matched entry or see the most recent log output.

**Acceptance Criteria for `read_log_range`**:

1. Tool signature: `read_log_range(path, start_line, end_line)`.
2. Reads lines `start_line` through `end_line` (1-indexed, inclusive) from the file.
3. Returns:
   - `start_line`, `end_line` (int) — as requested.
   - `total_lines_in_file` (int) — total lines.
   - `lines` (list of objects: `{ line_number, raw_line, parsed: { timestamp, level, tag, pid, tid, message } | null }`).
   - Attempts to parse each line as a log entry; if parsing fails, `parsed` is null but `raw_line` is always present.
4. If `start_line` > `total_lines_in_file`, returns an error.
5. If `end_line` > `total_lines_in_file`, clamps to the last line.
6. The range is capped at **10,000 lines** to prevent the AI from accidentally requesting huge ranges. The tool description makes this cap explicit.
7. Implementation uses file seeking (not reading the entire file) — for large files, a byte-offset index or line-length estimation is acceptable. The simplest correct implementation reads line-by-line, skipping until `start_line`, then yields until `end_line`.

**Acceptance Criteria for `tail_local_log`**:

1. Tool signature: `tail_local_log(path, lines)` (default: 50, max: 500).
2. Returns the last N lines of the file, each as `{ line_number, raw_line, parsed: {...} | null }`.
3. Implementation uses a ring buffer of size N, streaming through the entire file once, keeping only the last N lines in memory.
4. Total memory usage is O(N), not O(file_size).

**Priority**: P1 (Should Have) — important for context inspection but the AI can work without it initially using `search_local_log` with `offset`.

---

### US-5: Graceful Error Handling for Local File Access

**As a** user or AI agent interacting with local file paths,
**I want to** receive clear, actionable error messages when file access fails,
**so that** I can correct the path or permissions and retry.

**Acceptance Criteria**:

1. **File not found**: The API endpoint and all tools return `{ "error": "File not found: /path/to/file" }` with HTTP 400 (API) or JSON error (tool).
2. **Path is a directory**: Returns `{ "error": "Path is a directory, not a file: /path/to/dir" }`.
3. **Permission denied**: Returns `{ "error": "Permission denied: /path/to/file" }` with HTTP 403 (API) or JSON error (tool).
4. **File empty**: Returns a valid result indicating 0 lines, not an error.
5. **File unreadable / binary**: The backend attempts to read the file as text (UTF-8). If a high proportion of lines fail to parse as text, returns `{ "warning": "File appears to be binary or non-text. Only N lines decoded." }` in the result, not a hard error.
6. **Path traversal**: The API endpoint rejects paths containing `..` segments or absolute paths that reference outside allowed directories (if a sandbox is configured). Returns `{ "error": "Path traversal not allowed" }`.
7. **Tool-time errors**: When a tool encounters an error (file deleted mid-scan, disk I/O error), it returns a JSON error object that the AI agent can interpret and communicate to the user.
8. All errors are surfaced in the frontend: API errors shown as `Alert` components, tool errors shown in the AI chat panel's tool result display.

**Priority**: P0 (Must Have) — without clear errors, users cannot self-correct.

---

### US-6: Seamless Integration with Existing AI Chat Panel

**As a** user of the AI chat panel,
**I want to** ask natural-language questions about a local log file and have the AI agent use the lazy tools automatically,
**so that** the experience is identical to analyzing uploaded logs, but without the upload step.

**Acceptance Criteria**:

1. When a local file path is registered (via the `POST /api/logs/parse-local` response), the frontend calls a new or extended `setSessionLogs` variant (e.g., `setSessionFilePath`) that stores the file path reference in the session instead of full log entries.
2. The backend `_build_agentic_context` method detects when a session has a `file_path` (vs. `log_entries`) and:
   - Includes the new lazy tools (`LAZY_LOG_TOOLS` or extends `LOG_TOOLS`) instead of or in addition to the existing in-memory tools.
   - Adjusts the system prompt to tell the AI: "A local log file is available at path X. Use `overview_local_log` first, then `search_local_log` to investigate."
3. The existing tools (`query_log_overview`, `search_logs`) continue to work for sessions with pre-loaded log entries. The lazy tools are only offered when a file path is available.
4. The AI chat panel's tool call display (`ToolCallDisplay` component) renders the new tools identically to existing tools — no UI changes needed.
5. The `sendMessage` SSE stream works unchanged — lazy tool results flow through the same `tool_call` / `tool_result` events.
6. The `buildContext` function in `AiPanel.tsx` is extended to indicate "Local file: /path/to/log" when a file path is active.
7. Session resumption (continuing a conversation) works correctly: the file path and tool history are preserved.

**Priority**: P0 (Must Have) — the feature is useless if the AI can't use the tools.

---

### US-7: Backend Streaming Parser for File Path

**As a** backend developer,
**I want a** streaming log parser that operates on file paths (not in-memory bytes),
**so that** the AI tools can scan arbitrarily large files without OOM.

**Acceptance Criteria**:

1. A new class or method (e.g., `LogAnalyzer.stream_file(path)`) yields `LogEntry` objects one at a time by reading the file line-by-line.
2. The method handles gzip-compressed files (`.gz`) transparently — if the path ends with `.gz`, it wraps the file handle with `gzip.open()`.
3. The method handles ZIP archives — if the path ends with `.zip`, it iterates over archive members and streams each member's lines. ZIP member entries must be yielded sequentially (not all loaded at once). The `source_file` field on each entry reflects the member name.
4. The method returns log entries in the same format as `parse_log_bytes` / `stream_log_bytes`, ensuring downstream consumers (tools, API responses) are unchanged.
5. The method uses a configurable buffer size for reading (default: 64 KiB), implemented with Python's `io.TextIOWrapper` or equivalent line-buffered I/O.
6. Memory usage is O(1) per yield — entries are yielded and garbage-collected.
7. The existing `parse_log_bytes` and `stream_log_bytes` methods are **not modified** — the new method is additive.

**Priority**: P0 (Must Have) — this is the core engine powering all lazy tools.

---

### US-8: LogViewer Display of AI-Retrieved Results

**As a** user,
**I want to** see log entries retrieved by the AI agent's lazy tools in the LogViewer table,
**so that** I can visually inspect, scroll, and filter the results the AI found.

**Acceptance Criteria**:

1. When the AI agent returns `search_local_log` results (visible in the tool result), the user can click a "Show in LogViewer" button (or the entries are automatically loaded into the LogViewer).
2. Alternatively, the AI result entries replace/augment the current LogViewer data set (reusing existing state management for `allLogs` / displayed `logs`).
3. The LogViewer renders lazy-retrieved entries identically to uploaded entries (same columns: line number, timestamp, level, tag, PID, message, with level-based color coding).
4. The `source_file` field distinguishes entries from different files (when a ZIP is analyzed).
5. If the user switches back to uploaded log analysis, the LogViewer state is restored.
6. The "Statistics" panel / sidebar updates to reflect the lazy-retrieved entries (could be a subset, so statistics show "N of M total matches" where known).

**Priority**: P1 (Should Have) — the primary value is in the AI analysis; LogViewer display is a nice-to-have enhancement. The AI's text response already communicates findings.

---

## 3. Non-Functional Requirements

### NFR-1: Performance

- `overview_local_log` must process files at ≥ 50 MB/s on commodity hardware (SSD).
- `search_local_log` with simple filters (level only) must match `overview_local_log` throughput.
- Regex keyword search may be slower but must not exceed 2× the baseline throughput.
- File open/close overhead must be negligible — the tools are designed for single-pass streaming.

### NFR-2: Memory

- No tool shall ever load the entire file into memory.
- `overview_local_log` memory: O(unique_tags + unique_pids), expected < 10 MB for typical Android logs.
- `search_local_log` memory: O(limit), max ~500 entries × ~500 bytes ≈ 250 KB.
- `tail_local_log` memory: O(lines), max 500 entries.
- `read_log_range` memory: O(range_size), max 10,000 entries × ~500 bytes ≈ 5 MB.

### NFR-3: Compatibility

- Existing upload + parse flow unchanged. No regression in existing tests.
- Existing `LOG_TOOLS` (`query_log_overview`, `search_logs`) unchanged.
- Existing frontend components (`FileUpload`, `AiPanel`, `LogViewer`) are extended, not rewritten.
- Support both Anthropic and OpenAI-compatible API formats for tool schemas.

### NFR-4: Security

- File paths are validated server-side. Path traversal (`../`) is rejected.
- If a sandbox root is configured (e.g., via env var `ALA_SANDBOX_ROOT`), all file access is restricted to that subtree.
- No file content is persisted or cached server-side beyond the request lifetime.
- API endpoint rate-limiting should be considered to prevent disk I/O abuse (out of scope for v1, noted for future).

### NFR-5: Observability

- All file access operations are logged at DEBUG level (path, duration, line count).
- Errors (permission denied, file not found) are logged at WARNING level.
- A new Prometheus metric `ala_lazy_log_scan_duration_seconds` tracks tool latency.

### NFR-6: Internationalization (i18n)

- New UI strings (placeholder text, error messages, labels) are added to both `en.json` and `zh.json`.
- Tool names and descriptions are in English (they are part of the AI interface, not user-facing UI).

---

## 4. Out of Scope (v1)

1. **Recursive directory scanning for lazy mode** — v1 supports single file paths only. Users who want to analyze a directory use the existing directory upload/parse flow.
2. **File watching / live tail** — the tools are one-shot; they do not monitor files for changes.
3. **Remote file paths (SSH, S3, HTTP)** — only local filesystem paths accessible to the backend process.
4. **Persistent file indexes** — no on-disk indexes are built. Each tool call streams the file from scratch. If performance becomes an issue, a future iteration could add an optional LRU cache for `overview_local_log` results keyed by file path + mtime.
5. **Frontend file path browser** — v1 uses a text input. A file-tree picker (like `DirectoryFilePicker`) is a potential future enhancement.
6. **Perfetto trace lazy analysis** — this feature is log-only. Trace files require different streaming strategies and are out of scope.
7. **Tool result caching across AI turns** — the AI may call the same tool with the same parameters multiple times within a conversation. A future optimization could memoize results by file path + mtime + parameters.

---

## 5. Dependencies & Integration Points

| Component               | File(s)                                        | Change Required                                                           |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Backend API             | `backend/src/ala/api/logs.py`                  | New endpoint: `POST /api/logs/parse-local`                                |
| Backend Tools           | `backend/src/ala/services/agent_tools.py`      | New `LAZY_LOG_TOOLS` list + 4 tool executors                              |
| Backend AI Service      | `backend/src/ala/services/ai_service.py`       | Extend `_build_agentic_context` for `file_path` sessions; wire lazy tools |
| Backend Log Analyzer    | `backend/src/ala/services/log_analyzer.py`     | New `stream_file(path)` method                                            |
| Backend Session Manager | `backend/src/ala/services/session_manager.py`  | Store `file_path` in session; expose to AI service                        |
| Frontend API Client     | `frontend/src/api/logs.ts`                     | New `parseLocalPath(path)` function                                       |
| Frontend Chat API       | `frontend/src/api/chat.ts`                     | New `setSessionFilePath()` function                                       |
| Frontend FileUpload     | `frontend/src/components/FileUpload.tsx`       | Add "Local File Path" input section                                       |
| Frontend AiPanel        | `frontend/src/components/AiPanel.tsx`          | Extend `buildContext()` for file path mode                                |
| Frontend Types          | `frontend/src/types/index.ts`                  | Add `LocalFileRef` type                                                   |
| Frontend i18n           | `frontend/src/i18n/locales/en.json`, `zh.json` | New strings for local path input                                          |

---

## 6. Tool Schema Definitions (Reference)

These are the exact tool schemas to be added. They follow the existing Anthropic tool schema format used in `agent_tools.py`.

### `overview_local_log`

```json
{
  "name": "overview_local_log",
  "description": "Stream through a local log file and return aggregate statistics: level distribution, unique tags/PIDs, time range, line count. Use this first to understand what the file contains before performing targeted searches. Reads the file line-by-line without loading it into memory.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the log file on the server filesystem"
      },
      "max_lines": {
        "type": "integer",
        "description": "Maximum lines to scan (default: unlimited). Use for very large files to get a representative sample."
      }
    },
    "required": ["path"]
  }
}
```

### `search_local_log`

```json
{
  "name": "search_local_log",
  "description": "Stream through a local log file and return entries matching the specified filters. Always call overview_local_log first to understand the file contents. Paginate with limit and offset for large result sets.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the log file on the server filesystem"
      },
      "level": {
        "type": "string",
        "description": "Minimum log level to include (V, D, I, W, E, F)"
      },
      "tag": {
        "type": "string",
        "description": "Tag substring filter (case-insensitive)"
      },
      "pid": {
        "type": "string",
        "description": "Process ID to filter by"
      },
      "keyword": {
        "type": "string",
        "description": "Keyword or regex to match in the log message"
      },
      "start_time": {
        "type": "string",
        "description": "Only include entries after this timestamp"
      },
      "end_time": {
        "type": "string",
        "description": "Only include entries before this timestamp"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results to return (default: 50, max: 500)"
      },
      "offset": {
        "type": "integer",
        "description": "Number of matching entries to skip before returning results (default: 0)"
      }
    },
    "required": ["path"]
  }
}
```

### `read_log_range`

```json
{
  "name": "read_log_range",
  "description": "Read a specific line range from a local log file (like sed -n 'start,end p'). Use after search_local_log to inspect context around matched lines. Maximum range: 10,000 lines.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the log file on the server filesystem"
      },
      "start_line": {
        "type": "integer",
        "description": "First line number to read (1-indexed, inclusive)"
      },
      "end_line": {
        "type": "integer",
        "description": "Last line number to read (inclusive, clamped to file end)"
      }
    },
    "required": ["path", "start_line", "end_line"]
  }
}
```

### `tail_local_log`

```json
{
  "name": "tail_local_log",
  "description": "Read the last N lines of a local log file. Useful for checking recent output or the end of a crash dump.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Absolute path to the log file on the server filesystem"
      },
      "lines": {
        "type": "integer",
        "description": "Number of lines to read from the end (default: 50, max: 500)"
      }
    },
    "required": ["path"]
  }
}
```

---

## 7. API Endpoint Definition

### `POST /api/logs/parse-local`

**Purpose**: Register a local file path for lazy AI-driven analysis. Performs a fast first-pass scan to count lines and detect the log format.

**Request Body**:

```json
{
  "path": "/data/logs/logcat.txt"
}
```

**Success Response (200)**:

```json
{
  "session_file": "/data/logs/logcat.txt",
  "line_count": 125000,
  "size_bytes": 48234496,
  "format_detected": "android_logcat",
  "is_gzip": false
}
```

**Error Responses**:

- `400` — File not found, path is a directory, or path traversal detected.
- `403` — Permission denied.
- `422` — Validation error (missing `path` field).

---

## 8. Implementation Sequence (Suggested Order)

1. **Backend: `stream_file()` method** (US-7) — foundational capability.
2. **Backend: `POST /api/logs/parse-local` endpoint** (US-1 backend).
3. **Backend: Lazy tool implementations** (US-2, US-3, US-4) — `overview_local_log`, `search_local_log`, `read_log_range`, `tail_local_log`.
4. **Backend: AI service integration** (US-6 backend) — wire tools into `_build_agentic_context`.
5. **Backend: Error handling** (US-5 backend) — validate paths, catch exceptions.
6. **Frontend: API client + types** — `parseLocalPath`, `LocalFileRef` type.
7. **Frontend: FileUpload path input** (US-1 frontend).
8. **Frontend: AiPanel context** (US-6 frontend).
9. **Frontend: i18n strings**.
10. **Frontend: LogViewer integration** (US-8) — display AI-retrieved results.
11. **Testing: Unit + integration tests** for all new code paths.
12. **Documentation: Update README.md** with local path analysis instructions.

---

## 9. Risks & Mitigations

| Risk                                             | Impact | Mitigation                                                                                                                                                                  |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File changes between tool calls (race condition) | Medium | Accept for v1. Document that analysis is a point-in-time snapshot. Future: detect mtime changes and warn.                                                                   |
| Very large files cause slow tool responses       | Medium | The AI agent is instructed to use `max_lines` cap on `overview_local_log` for files > 10M lines. Tool descriptions guide the AI. Future: add progress events to SSE stream. |
| GZ/ZIP streaming adds complexity                 | Low    | Python's `gzip` module and `zipfile` support streaming natively. Iterate members/line-by-line.                                                                              |
| AI agent calls tools excessively (cost)          | Low    | The existing `MAX_TOOL_ROUNDS = 10` cap limits total tool calls per message. Tool descriptions encourage starting with `overview_local_log`.                                |
| Sandbox-constrained deployments                  | Low    | The `ALA_SANDBOX_ROOT` env var provides opt-in path restriction. Default: no restriction (same as existing directory scan).                                                 |

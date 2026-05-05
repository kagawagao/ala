# Architecture: Quality Consolidation (v1.1)

- **Iteration**: ITER-QUALITY-CONSOLIDATION
- **Version**: 1.0.0
- **Author**: Architect (subagent)
- **Date**: 2026-05-05
- **Status**: Draft
- **Predecessor**: FEAT-LAZY-LOG (docs/architecture-lazy-log.md)

---

## 1. Tech Stack

| Layer         | Technology                                    | Notes                                      |
| ------------- | --------------------------------------------- | ------------------------------------------ |
| Backend       | Python 3.12+, FastAPI, Pydantic               | No new dependencies                        |
| MCP Server    | FastMCP (`fastmcp` package)                   | Existing — 5 tools, adding 5 more          |
| AI            | Anthropic SDK / OpenAI SDK                    | Existing `ai_service.py` orchestrator      |
| Streaming I/O | `io.TextIOWrapper` + `gzip.open` + `zipfile`  | Existing `LogAnalyzer.stream_file()`       |
| CI/CD         | GitHub Actions                                | New — `.github/workflows/ci.yml`           |
| Observability | Python `logging` stdlib                       | Existing `logging_config.py`               |
| Frontend      | React 19, TypeScript 5, Ant Design 6          | No functional changes (status code neutral)|
| Testing       | pytest + pytest-asyncio                       | Existing 55 tests; adding ~8 new tests     |

---

## 2. Component / Data-Flow Diagram (Delta View)

Components with changes marked: **(NEW)**, **(MODIFIED)**, **(UNCHANGED)**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                      │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                     API Layer  (MODIFIED)                         │    │
│  │                                                                   │    │
│  │  api/logs.py                                                      │    │
│  │    parse_local_path()  — HTTP error codes fixed (US-A4)           │    │
│  │    auto_path()         — HTTP error codes fixed (US-A4)           │    │
│  │  api/chat.py                                                      │    │
│  │    set_session_file_path() — HTTP error codes fixed (US-A4)       │    │
│  └───────────────────────────────┬───────────────────────────────────┘    │
│                                  │                                        │
│  ┌───────────────────────────────┴───────────────────────────────────┐    │
│  │                     Services Layer                                 │    │
│  │                                                                    │    │
│  │  agent_tools.py  (MODIFIED)                                        │    │
│  │  ┌──────────────────────────────────────────────────────────┐     │    │
│  │  │ LAZY_LOG_TOOLS (5 schemas)                               │     │    │
│  │  │   overview_local_log — +max_lines param (US-A1)          │     │    │
│  │  │   search_local_log  — has file_path ✓ (verification)     │     │    │
│  │  │   read_log_range    — +start_line>total_lines error      │     │    │
│  │  │                      (US-A5), has file_path ✓             │     │    │
│  │  │   tail_local_log    — has file_path ✓ (verification)     │     │    │
│  │  │   list_directory_logs — unchanged                        │     │    │
│  │  │                                                          │     │    │
│  │  │ _execute_lazy_log_tool()  (MODIFIED)                     │     │    │
│  │  │   + structured logging (US-A3 / US-D1)                   │     │    │
│  │  │   + max_lines support in overview (US-A1)                │     │    │
│  │  │   + start_line>total_lines error (US-A5)                 │     │    │
│  │  └──────────────────────────────────────────────────────────┘     │    │
│  │                                                                    │    │
│  │  log_analyzer.py  (UNCHANGED — reused as-is)                       │    │
│  │    _validate_path()  ← reused by new MCP tools                     │    │
│  │    stream_file()     ← reused by new MCP tools                     │    │
│  │    scan_file_meta()  ← reused by new MCP tools                     │    │
│  │                                                                    │    │
│  │  trace_analyzer.py  (UNCHANGED)                                    │    │
│  │    TraceAnalyzer, TraceFilters ← tests decoupled from MCP import   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                  │                                        │
│  ┌───────────────────────────────┴───────────────────────────────────┐    │
│  │                     MCP Server  (MODIFIED)                         │    │
│  │  mcp/server.py                                                     │    │
│  │  ┌────────────────────────────────────────────────────────────┐   │    │
│  │  │ EXISTING (5 tools, unchanged):                             │   │    │
│  │  │   parse_android_log()                                      │   │    │
│  │  │   filter_android_logs()                                    │   │    │
│  │  │   get_log_statistics()                                     │   │    │
│  │  │   parse_perfetto_trace()                                   │   │    │
│  │  │   filter_perfetto_trace()                                  │   │    │
│  │  │                                                            │   │    │
│  │  │ NEW (5 tools, US-B1):                                      │   │    │
│  │  │   overview_local_log()     — mirrors agent_tools version   │   │    │
│  │  │   search_local_log()       — mirrors agent_tools version   │   │    │
│  │  │   read_log_range()         — mirrors agent_tools version   │   │    │
│  │  │   tail_local_log()         — mirrors agent_tools version   │   │    │
│  │  │   list_directory_logs()    — mirrors agent_tools version   │   │    │
│  │  │                                                            │   │    │
│  │  │ All reuse: _validate_path() + stream_file() / scan_file_meta()│  │
│  │  └────────────────────────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  config.py  (MODIFIED — optional, US-D2)                          │    │
│  │    + rate_limit_enabled: bool = False                             │    │
│  │    + rate_limit_requests_per_minute: int = 30                     │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                     Tests                                         │    │
│  │  test_trace_analyzer.py  (MODIFIED — US-C2)                       │    │
│  │    TestTraceMcp → removed or gated with pytest.importorskip()     │    │
│  │    TestTraceAnalyzer + TestTraceFilter → unchanged, now runnable  │    │
│  │    + 3 new TraceAnalyzer unit tests                               │    │
│  │                                                                    │    │
│  │  test_lazy_log.py  (NEW TESTS added)                               │    │
│  │    + test_overview_max_lines, + test_read_range_start_exceeds,    │    │
│  │    + test_read_range_end_clamped, + test_agent_tools_logging       │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                           CI/CD  (NEW)                                    │
│                                                                          │
│  .github/workflows/ci.yml                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Trigger: push to master, PR to master                             │    │
│  │                                                                    │    │
│  │ Job 1 — lint-ruff:                                                │    │
│  │   ruff check backend/  +  npm run format:check                    │    │
│  │                                                                    │    │
│  │ Job 2 — test-pytest:                                              │    │
│  │   cd backend && PYTHONPATH=src python -m pytest tests/ -v         │    │
│  │   (test_trace_analyzer.py fixed per US-C2)                        │    │
│  │                                                                    │    │
│  │ Job 3 — build-check:                                              │    │
│  │   cd frontend && npm run build  (TypeScript strict + Vite)        │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  README.md  (MODIFIED)                                                    │
│    + CI badge (shield.io)                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 Error Code Mapping (US-A4)

The following table documents the HTTP status code corrections across 3 endpoints:

| Exception Class        | Scenario                        | Old Code | New Code | Rationale                                    |
| ---------------------- | ------------------------------- | -------- | -------- | -------------------------------------------- |
| `FileNotFoundError`    | Path does not exist             | **404**  | **400**  | Not a REST resource; client error in request |
| `PathTraversalError`   | `..` or traversal pattern       | **403**  | **400**  | Malformed client request, not auth issue     |
| `PermissionError`      | File unreadable (no perms)      | **403**  | **403**  | UNCHANGED — correct for access denied        |
| `PermissionError`      | Outside `ALA_SANDBOX_ROOT`      | **403**  | **403**  | UNCHANGED — correct for access denied        |
| `ValueError` (dir)     | Path is directory, not file     | **422**  | **400**  | Malformed request (wrong resource type)      |
| `ValueError` (other)   | Other validation failures       | **422**  | **400**  | Malformed request                            |

**Affected endpoints:**
- `POST /api/logs/parse-local` → `api/logs.py:parse_local_path()`
- `POST /api/logs/auto-path` → `api/logs.py:auto_path()`
- `PUT /api/chat/sessions/{id}/file-path` → `api/chat.py:set_session_file_path()`

**Pattern to follow (existing):**

```python
# ── Example: parse_local_path error handling (CURRENT → NEW) ──
try:
    validated = LogAnalyzer._validate_path(req.path)
except PathTraversalError as e:
    raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")  # was 403
except FileNotFoundError as e:
    raise HTTPException(status_code=400, detail=str(e))  # was 404
except PermissionError as e:
    raise HTTPException(status_code=403, detail=str(e))  # unchanged
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))  # was 422
```

**Frontend impact:** NONE. `client.ts` uses `response.ok` pattern — all 4xx statuses trigger the same `throw new Error(error.detail)` path. No `status === 404` or similar hardcoded checks exist.

### 3.2 `overview_local_log` Schema Extension (US-A1)

```python
# ── BEFORE (LAZY_LOG_TOOLS[1]) ──
{
    "name": "overview_local_log",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "..."},
        },
        "required": [],
    },
}

# ── AFTER ──
{
    "name": "overview_local_log",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "..."},  # existing
            "max_lines": {
                "type": "integer",
                "description": (
                    "Maximum number of lines to scan for overview. "
                    "Useful for sampling large files.  "
                    "When specified, scanning stops after max_lines; "
                    "the response includes max_lines_reached: true."
                ),
            },
        },
        "required": [],
    },
}
```

### 3.3 `overview_local_log` Response Extension

```python
# ── BEFORE ──
return json.dumps({
    "file": resolved,
    "total_lines": line_count,
    "parsed_entries": line_count,
    "format_detected": format_detected,
    "level_distribution": level_counts,
    # ...
})

# ── AFTER (with max_lines support) ──
return json.dumps({
    "file": resolved,
    "total_lines": line_count,
    "parsed_entries": scannable_entries,    # lines actually scanned
    "max_lines_reached": bool,              # True when scanning stopped early
    "format_detected": format_detected,
    "level_distribution": level_counts,
    # ...
})
```

### 3.4 `read_log_range` Error Response (US-A5)

```python
# ── Normal response (no changes) ──
{
    "file": "/path/to/log",
    "range": "100-200",
    "total_lines_in_file": 500,
    "entries": [...],
    "count": 101
}

# ── NEW: start_line exceeds total ──
{
    "error": "start_line 99999 exceeds total lines 500",
    "total_lines_in_file": 500
}

# ── NEW: end_line clamped ──
{
    "file": "/path/to/log",
    "range": "100-500 (clamped from 100-1000)",
    "total_lines_in_file": 500,
    "entries": [...],
    "count": 401
}
```

### 3.5 MCP Tool Signatures (US-B1)

```python
# mcp/server.py — NEW functions (all @mcp.tool() decorated)

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
        max_lines_reached (bool).
    """

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

@mcp.tool()
def tail_local_log(file_path: str, lines: int = 50) -> dict:
    """Read the last N lines of a local log file via ring buffer.

    Args:
        file_path: Path to the log file.
        lines: Number of lines (default 50, max 500).

    Returns:
        Dict with total_lines, entries.
    """

@mcp.tool()
def list_directory_logs(directory_path: str) -> dict:
    """List log files in a directory with size and quick line counts.

    Args:
        directory_path: Path to a directory.

    Returns:
        Dict with total_files, files (list of {name, path, size, line_count}).
    """
```

### 3.6 CI/CD Workflow Definition (US-C1)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  lint-ruff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: pip install ruff
      - run: ruff check backend/
      - run: npm ci
      - run: npm run format:check

  test-pytest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install dependencies
        run: |
          pip install poetry
          cd backend && poetry install --no-interaction
      - name: Run tests
        run: cd backend && PYTHONPATH=src python -m pytest tests/ -v

  build-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: cd frontend && npm ci && npm run build
```

### 3.7 Config Additions (US-D2 — optional)

```python
# backend/src/ala/config.py — NEW settings
class Settings(BaseSettings):
    # ... existing fields unchanged ...

    # Rate limiting (US-D2)
    rate_limit_enabled: bool = False
    rate_limit_requests_per_minute: int = 30
```

### 3.8 Logging Contract (US-A3 / US-D1)

```python
# agent_tools.py — logger at module top
import logging
logger = logging.getLogger(__name__)  # → "ala.services.agent_tools"

# Format inherited from logging_config.py:
#   fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
#   datefmt="%Y-%m-%dT%H:%M:%S"
#
# Example output:
#   2026-05-05T11:00:01 [DEBUG] ala.services.agent_tools: tool=overview_local_log file=/var/log/syslog args={'max_lines': 50}
#   2026-05-05T11:00:02 [DEBUG] ala.services.agent_tools: tool=overview_local_log completed in 1234ms, lines=50
#   2026-05-05T11:00:03 [WARNING] ala.services.agent_tools: tool=search_local_log failed: Permission denied: /root/secret.log
```

---

## 4. Implementation Architecture — Per Workstream

### 4.1 Workstream A: Fix 5 Spec Deviations

#### US-A1: `overview_local_log` — add `max_lines` (P1)

| File | Change |
|------|--------|
| `backend/src/ala/services/agent_tools.py` (LAZY_LOG_TOOLS) | Add `max_lines` to `overview_local_log.input_schema.properties` |
| `backend/src/ala/services/agent_tools.py` (`_execute_lazy_log_tool`) | In `overview_local_log` branch: accept `max_lines` from args; break loop when reached; set `max_lines_reached: true` in response |
| `backend/tests/test_lazy_log.py` | Add: `test_overview_max_lines_respected`, `test_overview_no_max_lines_scans_all` |

**Implementation strategy:**
- Pure additive — new optional field in schema, new early-exit in existing loop
- No changes to `stream_file()` or `LogAnalyzer`

#### US-A2: Lazy tool schemas — `file_path` verification (P1)

| File | Change |
|------|--------|
| `backend/src/ala/services/agent_tools.py` | **Verify** — all 4 tools already have `file_path` in properties. Add to any that are confirmed missing (review). Per requirements, `search_local_log` and `read_log_range` stay `required: []`. `read_log_range` stays `required: ["start_line", "end_line"]`. |
| `backend/tests/test_lazy_log.py` | Add: `test_file_path_param_in_schema` (meta-test verifying schema completeness) |

**Status assessment:** Current code already has `file_path` in all 4 schemas. Primary work is a verification pass + add a meta-test that programmatically checks all `LAZY_LOG_TOOLS` entries have `file_path` where expected.

#### US-A3 / US-D1: Structured logging (P1)

| File | Change |
|------|--------|
| `backend/src/ala/services/agent_tools.py` (top) | Add `import logging` + `logger = logging.getLogger(__name__)` |
| `backend/src/ala/services/agent_tools.py` (`_execute_lazy_log_tool` entry) | `logger.debug("tool=%s file=%s args=%s", tool_name, file_path, args)` |
| `backend/src/ala/services/agent_tools.py` (each tool branch, before return) | `logger.debug("tool=%s completed in %dms, lines=%d", tool_name, elapsed_ms, count)` |
| `backend/src/ala/services/agent_tools.py` (exception handler) | `logger.warning("tool=%s failed: %s", tool_name, e)` |
| `backend/tests/test_lazy_log.py` | Add: `test_agent_tools_logging` (verify DEBUG emitted at entry/exit) |

**Implementation strategy:**
- Add logging at 3 points: entry (DEBUG), success (DEBUG), failure (WARNING)
- Use `time.monotonic()` for elapsed time calculation
- Format follows existing pattern: `logging.getLogger(__name__)` matching `logging_config.py`

#### US-A4: HTTP error code fixes (P1)

| File | Lines to change | Current | New |
|------|-----------------|---------|-----|
| `backend/src/ala/api/logs.py` (`parse_local_path`) | L132-142 | `PathTraversalError → 403` | `PathTraversalError → 400` |
| | L137-138 | `FileNotFoundError → 404` | `FileNotFoundError → 400` |
| | L141-142 | `ValueError → 422` | `ValueError → 400` |
| `backend/src/ala/api/logs.py` (`auto_path` — file branch) | L179-186 | Same pattern | Same fixes |
| `backend/src/ala/api/logs.py` (`auto_path` — directory branch) | L214 | `PermissionError → 403` | UNCHANGED (correct) |
| `backend/src/ala/api/chat.py` (`set_session_file_path`) | L143-150 | Same pattern | Same fixes |

**Pattern:** Replace status code literals only — no structural changes. PermissionError stays 403 (correct — that's a real access-denied scenario, not a malformed request).

**Frontend:** No changes needed — `client.ts` uses `response.ok`, which treats all 4xx the same.

#### US-A5: `read_log_range` error for out-of-range `start_line` (P1)

| File | Change |
|------|--------|
| `backend/src/ala/services/agent_tools.py` (`_execute_lazy_log_tool`, `read_log_range` branch) | After stream completes, check: if `start_line > total_lines`, return `{"error": "start_line N exceeds total lines M", "total_lines_in_file": M}`. If `end_line > total_lines`, clamp and note in `range` field. |
| `backend/tests/test_lazy_log.py` | Add: `test_read_range_start_exceeds_total`, `test_read_range_end_clamped` |

**Implementation strategy:**
- After the `for entry in stream_file()` loop completes, `total_lines` is known
- Check: `if start_line > total_lines` → return error (no entries scanned)
- Check: `if end_line > total_lines` → record clamped range string

---

### 4.2 Workstream B: MCP Server Enhancement

#### US-B1: 5 new MCP tools (P1)

| File | Change |
|------|--------|
| `backend/src/ala/mcp/server.py` | Add 5 new `@mcp.tool()` functions after existing tools |
| `backend/tests/test_lazy_log.py` | Add: `test_mcp_overview_local_log`, `test_mcp_search_local_log`, etc. |

**Architecture decision — code reuse vs. delegation:**

Two options were considered:

1. **Option A (Delegation):** New MCP tools call `_execute_lazy_log_tool()` from agent_tools directly, passing a dummy session path
2. **Option B (Shared service):** Extract the tool logic into `LogAnalyzer` methods, call those from both MCP and agent_tools
3. **Option C (Independent):** New MCP tools duplicate the logic, calling `LogAnalyzer.stream_file()` / `_validate_path()` directly

**DECISION: Option B (Shared service).** Rationale:
- `LogAnalyzer` already has `stream_file()`, `_validate_path()`, `scan_file_meta()` — the building blocks are there
- The `_execute_lazy_log_tool` function encapsulates session-path resolution which MCP tools don't need (MCP receives `file_path` directly)
- Each MCP tool calls `_validate_path()` then `stream_file()` or `scan_file_meta()` with its own aggregation logic (identical to the tool branches in `_execute_lazy_log_tool`)
- This avoids coupling MCP to the agent_tools module while sharing the core analyzer

**Implementation pattern for each new MCP tool:**

```python
@mcp.tool()
def overview_local_log(file_path: str, max_lines: int | None = None) -> dict:
    """..."""
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

    level_counts = {}
    tags = set()
    pids = set()
    min_ts, max_ts = None, None
    line_count = 0

    for entry in _log_analyzer.stream_file(validated):
        line_count += 1
        # ... aggregation identical to agent_tools.py ...
        if max_lines and line_count >= max_lines:
            break

    return {
        "file": validated,
        "total_lines": line_count,
        "max_lines_reached": max_lines is not None and line_count >= max_lines,
        "level_distribution": level_counts,
        # ...
    }
```

**Directory mode for MCP tools:** Unlike the REST session model (where a session can point to a directory), MCP tools receive `file_path` directly. If `file_path` is a directory:
- `list_directory_logs`: operates on the directory directly (scan for log files)
- All other tools: `_validate_path()` rejects directories (ValueError), so the MCP tool returns an error suggesting `list_directory_logs` first

---

### 4.3 Workstream C: CI/CD Pipeline

#### US-C1: GitHub Actions workflow (P0)

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | **NEW** — single workflow with 3 jobs |
| `README.md` | Add CI badge: `[![CI](https://github.com/kagawagao/ala/actions/workflows/ci.yml/badge.svg)](https://github.com/kagawagao/ala/actions/workflows/ci.yml)` |

**Poetry caching strategy:**
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/pypoetry
    key: poetry-${{ runner.os }}-${{ hashFiles('backend/pyproject.toml') }}
```

**Node caching:**
```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      frontend/node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('frontend/package-lock.json') }}
```

#### US-C2: Fix `test_trace_analyzer.py` (P1)

| File | Change |
|------|--------|
| `backend/tests/test_trace_analyzer.py` | Remove line 7: `from ala.mcp.server import filter_perfetto_trace, parse_perfetto_trace` |
| `backend/tests/test_trace_analyzer.py` | Gate `TestTraceMcp` class with `pytest.importorskip("fastmcp")`; or better: import directly from `ala.services.trace_analyzer` and test TraceAnalyzer + TraceFilters directly |
| `backend/tests/test_trace_analyzer.py` | Add 3 new tests: `test_trace_filters_dataclass`, `test_parse_trace_returns_traceparseresult`, `test_filter_trace_empty_filters` |

**DECISION: Remove the `from ala.mcp.server import ...` line entirely.** The `TestTraceMcp` class tests MCP wrapper functions that already exist and are stable. Replace with direct `TraceAnalyzer` + `TraceFilters` unit tests that serve the same coverage purpose without the `fastmcp` dependency.

#### US-C3: Dependabot PRs

| Package | Ecosystem | Review priority |
|---------|-----------|-----------------|
| `cryptography` | backend (poetry) | HIGH — security |
| `dompurify` | frontend (npm) | HIGH — security |
| `postcss` | frontend (npm) | HIGH — security |
| `vite` | frontend (npm) | MEDIUM — build tool |
| `fastmcp` | backend (poetry) | MEDIUM — MCP server |
| `lodash-es` | frontend (npm) | LOW |
| `authlib` | backend (poetry) | LOW |
| `pytest` | backend (poetry) | LOW |
| `python-multipart` | backend (poetry) | LOW |

**Merge order:** security-critical first → verify `npm run build` + `ruff check` + all 55 tests → then remaining PRs.

---

### 4.4 Workstream D: Observability & Defense

#### US-D1: Structured logging (combined with US-A3)

Covered in §4.1 — US-A3/US-D1 are implemented together in `_execute_lazy_log_tool`.

#### US-D2: API rate limiting (P2 — optional)

| File | Change |
|------|--------|
| `backend/src/ala/config.py` | Add `rate_limit_enabled: bool = False`, `rate_limit_requests_per_minute: int = 30` |
| `backend/src/ala/api/logs.py` | Add in-memory rate limiter decorator/check for `parse-local` |
| `backend/src/ala/api/chat.py` | Add per-session rate limiter for `POST /sessions/{id}/messages` |

**Implementation:**
```python
# backend/src/ala/api/rate_limit.py (NEW)
import time
from collections import defaultdict
from ..config import settings

_window: dict[str, list[float]] = defaultdict(list)

def check_rate_limit(key: str, max_requests: int = 30) -> bool:
    """Return True if request is allowed, False if rate limited."""
    if not settings.rate_limit_enabled:
        return True
    now = time.monotonic()
    window = _window[key]
    # Evict old entries
    while window and window[0] < now - 60:
        window.pop(0)
    if len(window) >= max_requests:
        return False
    window.append(now)
    return True
```

**If time-constrained:** Defer to v1.2. P2 priority per requirements §7.

---

## 5. Test Plan

### 5.1 New Tests

| Workstream | Test | File |
|------------|------|------|
| US-A1 | `test_overview_max_lines_respected` | `test_lazy_log.py` |
| US-A1 | `test_overview_no_max_lines_scans_all` | `test_lazy_log.py` |
| US-A2 | `test_all_lazy_tools_have_file_path_schema` | `test_lazy_log.py` |
| US-A3/D1 | `test_agent_tools_logging_on_entry` | `test_lazy_log.py` |
| US-A3/D1 | `test_agent_tools_logging_on_success` | `test_lazy_log.py` |
| US-A3/D1 | `test_agent_tools_logging_on_error` | `test_lazy_log.py` |
| US-A5 | `test_read_range_start_exceeds_total` | `test_lazy_log.py` |
| US-A5 | `test_read_range_end_clamped` | `test_lazy_log.py` |
| US-B1 | `test_mcp_overview_local_log` | `test_lazy_log.py` |
| US-B1 | `test_mcp_search_local_log` | `test_lazy_log.py` |
| US-B1 | `test_mcp_read_log_range` | `test_lazy_log.py` |
| US-B1 | `test_mcp_tail_local_log` | `test_lazy_log.py` |
| US-B1 | `test_mcp_list_directory_logs` | `test_lazy_log.py` |
| US-C2 | `test_trace_filters_dataclass` | `test_trace_analyzer.py` |
| US-C2 | `test_parse_trace_returns_result` | `test_trace_analyzer.py` |
| US-C2 | `test_filter_trace_empty_filters` | `test_trace_analyzer.py` |

### 5.2 Test Count Summary

| Category | Before | After | Delta |
|----------|--------|-------|-------|
| test_log_analyzer.py | ~27 | 27 | 0 |
| test_lazy_log.py | 28 | 39 | +11 |
| test_trace_analyzer.py | 7 (2 skipped) | 10 | +3 |
| test_code_scanner.py | ~20 | 20 | 0 |
| **Total** | **55 active** | **69 active** | **+14** |

---

## 6. File-by-File Change Summary

| File | Change Type | Workstreams | Risk |
|------|-------------|-------------|------|
| `backend/src/ala/services/agent_tools.py` | MODIFY | A1, A2, A3, A5, D1 | **MEDIUM** — core logic changes, test coverage mitigates |
| `backend/src/ala/api/logs.py` | MODIFY | A4 | **LOW** — status code literals only |
| `backend/src/ala/api/chat.py` | MODIFY | A4 | **LOW** — status code literals only |
| `backend/src/ala/mcp/server.py` | MODIFY | B1 | **MEDIUM** — additive only, existing tools untouched |
| `backend/src/ala/config.py` | MODIFY (optional) | D2 | **LOW** — two new fields |
| `backend/tests/test_trace_analyzer.py` | MODIFY | C2 | **LOW** — remove import, add unit tests |
| `backend/tests/test_lazy_log.py` | MODIFY | A1, A2, A3, A5, B1, D1 | **LOW** — additive tests |
| `.github/workflows/ci.yml` | NEW | C1 | **LOW** — no code changes |
| `README.md` | MODIFY | C1 | **LOW** — badge only |
| `frontend/src/api/logs.ts` | NO CHANGE | — | — (no status-code-specific logic) |
| `frontend/src/api/chat.ts` | NO CHANGE | — | — (no status-code-specific logic) |

---

## 7. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP tools duplicate agent_tools logic | Medium — code maintainability | **High** — natural tendency | Extract shared helpers in `LogAnalyzer`; use `_validate_path()` + `stream_file()` directly; avoid importing `_execute_lazy_log_tool` into MCP |
| HTTP error code changes break frontend | Low — frontend uses `response.ok` | **Low** — verified in code audit | Confirmed: `client.ts` uses `if (!response.ok)` → throws generic `Error`. No `status === 404` checks found. |
| `fastmcp` upgrade breaks MCP server | Low | **Low** — patch version bump typically | Verify 5 existing + 5 new MCP tools work after Dependabot merge |
| `test_trace_analyzer.py` fix introduces new test failures | Low | **Low** — tests are straightforward | Run `pytest tests/ -v` before/after to confirm no regressions |
| Dependabot `vite` or `postcss` upgrade breaks build | Medium | **Low** — major version bumps unlikely | Merge security PRs first, verify `npm run build` after each |

---

## 8. Implementation Order

Per requirements §6, with architectural rationale:

1. **US-C2** — Fix `test_trace_analyzer.py` (unblock CI) — *prerequisite for CI*
2. **US-C3** — Merge Dependabot PRs — *dependency baseline, verify nothing breaks*
3. **US-C1** — Create CI workflow — *quality gate for all subsequent changes*
4. **US-A4** — Fix HTTP error codes — *simplest, least risky, validates CI works*
5. **US-A1** — `max_lines` in overview schema — *pure additive*
6. **US-A2** — `file_path` schema verification — *mostly verification + meta-test*
7. **US-A5** — `read_log_range` error handling — *small logic change*
8. **US-A3 / US-D1** — Structured logging — *additive, no behavioral changes*
9. **US-B1** — MCP server 5 new tools — *largest change, built on stabilized foundation*
10. **US-D2** — Rate limiting — *optional, deferrable*

---

## 9. Acceptance Checklist

- [ ] `ruff check backend/` passes with zero errors
- [ ] `npm run format:check` passes (Prettier + ESLint)
- [ ] `npm run build` passes (TypeScript strict + Vite)
- [ ] All 55 existing tests pass (no regressions)
- [ ] All ~16 new tests pass
- [ ] `.github/workflows/ci.yml` created and passing on push/PR
- [ ] `test_trace_analyzer.py` runs without fastmcp import issues
- [ ] 5 MCP tools callable via MCP client
- [ ] 9 Dependabot PRs merged
- [ ] DEBUG/WARNING logs emitted from `_execute_lazy_log_tool`
- [ ] HTTP error codes match US-A4 table
- [ ] CI badge in README.md

# Architecture: Lazy / Local Log File Analysis

- **Feature**: FEAT-LAZY-LOG
- **Version**: 1.0.0
- **Author**: Architect (subagent)
- **Date**: 2026-04-27
- **Status**: Draft

---

## 1. Tech Stack

| Layer         | Technology                                    | Notes                                      |
| ------------- | --------------------------------------------- | ------------------------------------------ |
| Backend       | Python 3.12+, FastAPI, Pydantic               | Existing stack — no new dependencies       |
| AI            | Anthropic SDK / OpenAI SDK                    | Existing `ai_service.py` tool orchestrator |
| Streaming I/O | `io.TextIOWrapper` + `gzip.open` + `zipfile`  | Python stdlib; line-buffered reads         |
| Frontend      | React 19, TypeScript 5, Ant Design 6          | Existing stack                             |
| Session       | In-memory `SessionManager`                    | Existing `OrderedDict`-based store         |
| Security      | Path validation + optional `ALA_SANDBOX_ROOT` | Server-side only                           |

---

## 2. Component / Data-Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                      │
│                                                                         │
│  ┌───────────────┐     ┌──────────────────────┐    ┌───────────────┐  │
│  │  FileUpload   │     │      AiPanel         │    │  LogViewer    │  │
│  │ (new: path    │────▶│  (new: lazy context) │───▶│ (optional     │  │
│  │  input mode)  │     │                      │    │  display of   │  │
│  └───────┬───────┘     └──────────┬───────────┘    │  AI results)  │  │
│          │ parseLocalPath()       │ sendMessage()   └───────────────┘  │
│          │                        │                                    │
│  ┌───────┴────────────────────────┴──────────────────────────────────┐ │
│  │                     API Client Layer                               │ │
│  │  logs.ts: parseLocalPath()   chat.ts: setSessionFilePath()        │ │
│  └──────────────────────────────┬────────────────────────────────────┘ │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  │
                          HTTP / SSE
                                  │
┌─────────────────────────────────┼──────────────────────────────────────┐
│                           BACKEND                                       │
│                                                                         │
│  ┌──────────────────────────────┴──────────────────────────────────┐   │
│  │                        API Layer                                 │   │
│  │  api/logs.py  ─── NEW: POST /parse-local                        │   │
│  │  api/chat.py  ─── NEW: PUT /sessions/{id}/file-path             │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│  ┌──────────────────────────────┴──────────────────────────────────┐   │
│  │                     Services Layer                               │   │
│  │                                                                  │   │
│  │  session_manager.py           ai_service.py                      │   │
│  │  ┌──────────────────┐        ┌───────────────────────────┐     │   │
│  │  │ Session          │        │ _build_agentic_context()  │     │   │
│  │  │ + file_path: str │───────▶│  if file_path:            │     │   │
│  │  │ + file_ref: dict │        │    tools += LAZY_LOG_TOOLS│     │   │
│  │  └──────────────────┘        │    prompt = lazy_prompt    │     │   │
│  │                              └───────────┬───────────────┘     │   │
│  │                                          │                      │   │
│  │  agent_tools.py                execute_tool() dispatcher        │   │
│  │  ┌──────────────────────────┐  ┌──────────────────────┐       │   │
│  │  │ LAZY_LOG_TOOLS (4 tools) │  │ _execute_lazy_log()  │       │   │
│  │  │ + Anthropic schemas      │  │  calls LogAnalyzer   │       │   │
│  │  └──────────────────────────┘  │  .stream_file(path)  │       │   │
│  │                                └──────────┬───────────┘       │   │
│  │                                           │                    │   │
│  │  log_analyzer.py                          │                    │   │
│  │  ┌────────────────────────────────────────┴─────────────────┐ │   │
│  │  │ stream_file(path) — NEW generator                        │ │   │
│  │  │   ├─ _open_log_path(path)   → file handle (.gz/.zip)     │ │   │
│  │  │   ├─ _detect_format_from_file(fh) → LogFormat            │ │   │
│  │  │   └─ yield LogEntry one-by-one                           │ │   │
│  │  │                                                          │ │   │
│  │  │ _validate_path(path) — NEW security guard                │ │   │
│  │  │   ├─ rejects ".." / path traversal                       │ │   │
│  │  │   ├─ optional ALA_SANDBOX_ROOT confinement                │ │   │
│  │  │   └─ stat() checks for regular file                      │ │   │
│  │  └──────────────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **User enters path** → Frontend calls `POST /api/logs/parse-local` → Backend validates path, does fast line-count scan, detects format → Returns `{ session_file, line_count, size_bytes, format_detected }`
2. **Frontend stores file ref** → Calls `PUT /api/chat/sessions/{id}/file-path` → Session gets `file_path` field
3. **User asks a question** → Frontend calls `POST /api/chat/sessions/{id}/messages` (SSE) → `ai_service.py` sees session has `file_path` → Selects `LAZY_LOG_TOOLS` → AI agent calls `overview_local_log` → `search_local_log` → etc.
4. **Each tool call** streams through the file on disk, never loading it all into memory.

---

## 3. Data Model

### 3.1 New Backend Types

```python
# log_analyzer.py

@dataclass
class FileRef:
    """Fast first-pass result: metadata about a local log file."""
    path: str
    line_count: int
    size_bytes: int
    format_detected: str      # "android_logcat" | "generic_timestamped" | "unknown"
    is_gzip: bool = False
    is_zip: bool = False
```

### 3.2 Session Changes

```python
# session_manager.py — Session dataclass additions

@dataclass
class Session:
    # ... existing fields ...
    log_entries: list[dict] | None = None
    log_index: LogIndex | None = None

    # ── NEW: lazy/local log fields ──
    file_path: str | None = None          # absolute path to local log file
    file_ref: dict | None = None          # {path, line_count, size_bytes, format_detected, is_gzip, is_zip}
```

**Rationale**: `file_path` is the canonical single path. `file_ref` carries metadata from the first-pass scan for display/context. When `file_path` is set, `LAZY_LOG_TOOLS` are active (and `LOG_TOOLS` are not). When `log_entries` is set, `LOG_TOOLS` are active. These are mutually exclusive modes for the same session. Trace tools (`TRACE_TOOLS`) and project tools (`AGENT_TOOLS`) are orthogonal and always included when applicable.

### 3.3 New Session Manager Methods

```python
# session_manager.py

def set_file_path(self, session_id: str, file_path: str, file_ref: dict) -> bool:
    """Store a local file path reference for lazy AI-driven analysis."""
    session = self._sessions.get(session_id)
    if not session:
        return False
    session.file_path = file_path
    session.file_ref = file_ref
    session.log_entries = None  # mutually exclusive
    session.log_index = None
    return True

def clear_file_path(self, session_id: str) -> bool:
    session = self._sessions.get(session_id)
    if not session:
        return False
    session.file_path = None
    session.file_ref = None
    return True
```

### 3.4 Frontend Types

```typescript
// types/index.ts — new types

export interface LocalFileRef {
  session_file: string
  line_count: number
  size_bytes: number
  format_detected: string
  is_gzip: boolean
  is_zip: boolean
}

// AiPanel props addition
interface AiPanelProps {
  // ... existing ...
  localFilePath: string | null // NEW
  localFileRef: LocalFileRef | null // NEW
}
```

---

## 4. API Contracts

### 4.1 `POST /api/logs/parse-local`

**Purpose**: Register a local file path for lazy AI-driven analysis. Performs a fast first-pass scan.

**Request**:

```json
{
  "path": "/data/logs/logcat.txt"
}
```

**Success (200)**:

```json
{
  "session_file": "/data/logs/logcat.txt",
  "line_count": 125000,
  "size_bytes": 48234496,
  "format_detected": "android_logcat",
  "is_gzip": false,
  "is_zip": false
}
```

**Error Responses**:

| Status | Condition           | Body                                                |
| ------ | ------------------- | --------------------------------------------------- |
| 400    | File not found      | `{"detail": "File not found: /bad/path"}`           |
| 400    | Path is a directory | `{"detail": "Path is a directory: /some/dir"}`      |
| 400    | Path traversal      | `{"detail": "Path traversal not allowed"}`          |
| 400    | Outside sandbox     | `{"detail": "Path outside allowed directory: ..."}` |
| 403    | Permission denied   | `{"detail": "Permission denied: /root/file"}`       |
| 422    | Missing `path`      | Pydantic validation error                           |

**Implementation (Pydantic model + endpoint)**:

```python
# api/logs.py

class ParseLocalRequest(BaseModel):
    path: str

class ParseLocalResponse(BaseModel):
    session_file: str
    line_count: int
    size_bytes: int
    format_detected: str
    is_gzip: bool = False
    is_zip: bool = False

@router.post("/parse-local", response_model=ParseLocalResponse)
async def parse_local_path(req: ParseLocalRequest):
    """Register a local file path and return fast-scan metadata."""
    validated = _validate_local_path(req.path)
    file_ref = _analyzer.scan_file_meta(validated)
    return ParseLocalResponse(
        session_file=validated,
        line_count=file_ref.line_count,
        size_bytes=file_ref.size_bytes,
        format_detected=file_ref.format_detected,
        is_gzip=file_ref.is_gzip,
        is_zip=file_ref.is_zip,
    )
```

### 4.2 `PUT /api/chat/sessions/{session_id}/file-path`

**Purpose**: Store the local file path in the session so the AI agent can use lazy tools.

**Request**:

```json
{
  "file_path": "/data/logs/logcat.txt",
  "file_ref": {
    "line_count": 125000,
    "size_bytes": 48234496,
    "format_detected": "android_logcat",
    "is_gzip": false,
    "is_zip": false
  }
}
```

**Success (200)**:

```json
{ "success": true }
```

**Error (404)**: Session not found.

```python
# api/chat.py

class SetFilePathRequest(BaseModel):
    file_path: str
    file_ref: dict

@router.put("/sessions/{session_id}/file-path")
async def set_session_file_path(session_id: str, req: SetFilePathRequest):
    ok = _session_manager.set_file_path(session_id, req.file_path, req.file_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}
```

### 4.3 Frontend API Client

```typescript
// api/logs.ts — new function
export async function parseLocalPath(path: string): Promise<LocalFileRef> {
  return apiFetch<LocalFileRef>('/logs/parse-local', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

// api/chat.ts — new function
export async function setSessionFilePath(
  sessionId: string,
  filePath: string,
  fileRef: Record<string, unknown>,
): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}/file-path`, {
    method: 'PUT',
    body: JSON.stringify({ file_path: filePath, file_ref: fileRef }),
  })
}
```

---

## 5. Key Design Decisions

### 5.1 `stream_file()` Generator Design

**Location**: `services/log_analyzer.py`, new method on `LogAnalyzer`.

```python
def stream_file(self, path: str) -> Iterator[LogEntry]:
    """Yield LogEntry objects one-by-one from a local file."""
    fh = self._open_log_path(path)
    fmt = self._detect_format_from_file(fh)
    # Re-open for reading (detect_format consumed a few lines)
    fh = self._open_log_path(path)
    yield from self._parse_file_handle_iter(fh, fmt, source_file=path)
```

**Key sub-methods**:

| Method                                          | Purpose                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_open_log_path(path)`                          | Opens file. If `.gz` → wraps with `gzip.open()`. If `.zip` → iterates members, yielding from each. Returns `Iterator[tuple[str, TextIOWrapper]]`.                        |
| `_detect_format_from_file(fh)`                  | Reads first 10 non-empty lines, runs regex matching, returns `LogFormat`. Consumes minimal data.                                                                         |
| `_parse_file_handle_iter(fh, fmt, source_file)` | Reads line-by-line from the file handle, parses each line using the existing per-line regex logic (extracted from `_parse_android_logcat_iter` etc.), yields `LogEntry`. |

**Design decisions**:

1. **Why reopen?** `_detect_format_from_file` needs to read some lines. Rather than implementing `seek(0)`, we simply reopen. Simpler and works correctly with `gzip.open()` (where seeking compressed streams is not meaningful).

2. **Existing parsing reused**: The per-line parsing logic from `_parse_android_logcat_iter` / `_parse_generic_timestamped_iter` / `_parse_unknown_iter` is extracted into a `_parse_single_line(line, line_number, fmt, source_file)` method to avoid duplication. Both the in-memory iterators and the new file-based iterator share this.

3. **ZIP handling**: For `.zip` files, `_open_log_path` yields `(member_name, fh)` tuples. `stream_file` iterates these, yielding entries with `source_file` set to the ZIP member name.

4. **Buffering**: `io.TextIOWrapper` with default buffer (~8 KiB) is used. Configurable via `buffer_size` parameter but default is sufficient for line-by-line reads at good throughput.

5. **Memory**: O(1) per yield. Entries are yielded and immediately available for GC.

6. **Existing methods untouched**: `parse_log_bytes`, `stream_log_bytes`, `parse_log_iter` are not modified. The new `stream_file` is purely additive.

### 5.2 Security: Path Validation

```python
# log_analyzer.py

def _validate_path(path: str, sandbox_root: str | None = None) -> str:
    """Validate and normalize a local file path. Returns the real absolute path."""
    import os

    # Reject path traversal attempts
    if ".." in path.split(os.sep):
        raise PathTraversalError(f"Path traversal not allowed: {path}")

    # Resolve to absolute, then resolve symlinks
    real_path = os.path.realpath(os.path.abspath(path))

    # Reject directories
    if not os.path.isfile(real_path):
        if os.path.isdir(real_path):
            raise ValueError(f"Path is a directory: {path}")
        raise FileNotFoundError(f"File not found: {path}")

    # Sandbox enforcement (opt-in via ALA_SANDBOX_ROOT env var)
    if sandbox_root:
        sandbox_real = os.path.realpath(os.path.abspath(sandbox_root))
        if os.path.commonpath([real_path, sandbox_real]) != sandbox_real:
            raise PermissionError(f"Path outside allowed directory: {path}")

    # Check readability
    if not os.access(real_path, os.R_OK):
        raise PermissionError(f"Permission denied: {path}")

    return real_path
```

**Key decisions**:

- `os.path.realpath()` resolves symlinks, preventing `sandbox/../../etc/passwd` via symlink trickery.
- Path traversal check splits on OS separator to catch `..` segments regardless of platform.
- Sandbox is **opt-in**: only enforced when `ALA_SANDBOX_ROOT` env var is set. This mirrors the existing directory scan behaviour.
- All validation is done once at `POST /parse-local` time. Tools re-validate on each invocation (in case the file is deleted between calls).

### 5.3 Tool Set Selection in `ai_service.py`

**Current behavior**: `_build_agentic_context()` checks `log_entries is not None` → adds `LOG_TOOLS`.

**New behavior**:

```python
def _build_agentic_context(
    self,
    project: Project | None,
    trace_summary: dict | None,
    log_entries: list[dict] | None,
    file_path: str | None = None,       # NEW
    file_ref: dict | None = None,       # NEW
) -> tuple[list[dict[str, Any]], str]:
    tools: list[dict[str, Any]] = []
    parts: list[str] = []

    if project:
        tools.extend(AGENT_TOOLS)
        # ... existing project context ...

    if file_path is not None:                          # NEW: lazy mode
        tools.extend(LAZY_LOG_TOOLS)
        n_lines = file_ref.get("line_count", "?") if file_ref else "?"
        fmt = file_ref.get("format_detected", "unknown") if file_ref else "?"
        size_mb = (file_ref.get("size_bytes", 0) / (1024*1024)) if file_ref else 0
        log_hint = (
            f"A local log file is available at '{file_path}' "
            f"({n_lines} lines, {size_mb:.1f} MiB, format={fmt}). "
            "ALWAYS start with overview_local_log to understand the file contents "
            "before performing any targeted searches. Then use search_local_log "
            "with specific filters. Use read_log_range for context inspection "
            "and tail_local_log for recent entries."
        )
        # ... append to parts ...

    elif log_entries is not None:                       # EXISTING: in-memory mode
        tools.extend(LOG_TOOLS)
        # ... existing log_hint ...

    if trace_summary:
        tools.extend(TRACE_TOOLS)
        # ... existing trace_hint ...

    return tools, "\n".join(parts)
```

**Call site changes in `stream_chat_agentic`**, `_stream_chat_agentic_anthropic`, `_stream_chat_agentic_openai`:

- Pass `file_path=session.file_path, file_ref=session.file_ref` to `_build_agentic_context`.
- Pass `file_path` to `execute_tool()` so lazy tools can access it.

**Chat endpoint changes** (`api/chat.py`):

```python
# In send_message(), after resolving session:
file_path = session.file_path
file_ref = session.file_ref

# Pass to agentic stream:
async for chunk in ai_service.stream_chat_agentic(
    messages,
    project=project,
    trace_summary=trace_summary,
    log_entries=log_entries,
    log_index=session.log_index,
    file_path=file_path,           # NEW
    file_ref=file_ref,             # NEW
    ...
):
```

### 5.4 Tool Definitions & Execution

**`LAZY_LOG_TOOLS` schema list** (see requirements doc §6 for exact JSON):

```python
# agent_tools.py

LAZY_LOG_TOOLS: list[dict[str, Any]] = [
    # overview_local_log  — schema as in requirements §6
    # search_local_log    — schema as in requirements §6
    # read_log_range      — schema as in requirements §6
    # tail_local_log      — schema as in requirements §6
]
```

**Tool execution** — new dispatch branch in `execute_tool()`:

```python
def execute_tool(
    project: Project | None,
    tool_name: str,
    arguments: str,
    trace_summary: dict | None = None,
    log_entries: list[dict] | None = None,
    log_index: LogIndex | None = None,
    file_path: str | None = None,        # NEW
) -> str:
    # ... existing trace/log/project dispatch ...

    # Lazy log tools
    if tool_name in ("overview_local_log", "search_local_log",
                     "read_log_range", "tail_local_log"):
        if not file_path:
            return json.dumps({"error": "No local file path registered in this session"})
        return _execute_lazy_log_tool(tool_name, args, file_path)
```

**`_execute_lazy_log_tool`** — new dispatcher:

```python
def _execute_lazy_log_tool(tool_name: str, args: dict, file_path: str) -> str:
    from .log_analyzer import LogAnalyzer
    analyzer = LogAnalyzer()

    try:
        analyzer._validate_path(file_path)  # re-validate
    except (FileNotFoundError, PermissionError, ValueError) as e:
        return json.dumps({"error": str(e)})

    if tool_name == "overview_local_log":
        return _execute_overview_local_log(analyzer, file_path, args)
    elif tool_name == "search_local_log":
        return _execute_search_local_log(analyzer, file_path, args)
    elif tool_name == "read_log_range":
        return _execute_read_log_range(analyzer, file_path, args)
    elif tool_name == "tail_local_log":
        return _execute_tail_local_log(analyzer, file_path, args)
    return json.dumps({"error": f"Unknown lazy log tool: {tool_name}"})
```

### 5.5 Tool Implementation Details

**`overview_local_log`**: Streams through the file once. Accumulates counters + sets (tags, PIDs). Returns aggregate statistics. Optional `max_lines` cap.

**`search_local_log`**: Streams through the file once. Tests each parsed entry against filters. Collects up to `offset + limit` matches, then short-circuits.

**`read_log_range`**: Streams through file, skipping until `start_line`, yielding until `end_line`. Range capped at 10,000 lines.

**`tail_local_log`**: Ring buffer of size N (default 50, max 500). Streams through entire file, keeping only last N lines.

All four tools call `analyzer.stream_file(file_path)` which handles `.gz`/`.zip` transparently.

### 5.6 `scan_file_meta()` — Fast First-Pass Scan

```python
# log_analyzer.py

def scan_file_meta(self, path: str) -> FileRef:
    """Fast scan: count lines and detect format. Does NOT parse entries."""
    import os
    stat = os.stat(path)
    is_gzip = path.lower().endswith(".gz") and not path.lower().endswith(".tar.gz")
    is_zip = path.lower().endswith(".zip")

    fh = self._open_log_path(path)
    line_count = 0
    sample_lines: list[str] = []
    for raw_line in fh:
        line_count += 1
        stripped = raw_line.strip()
        if stripped and len(sample_lines) < 10:
            sample_lines.append(stripped)
        if len(sample_lines) >= 10 and line_count > 1000:
            break  # enough for format detection; keep counting lines

    # Detect format from sample
    fmt = self.detect_log_format("\n".join(sample_lines))

    # If we broke early for format, count remaining lines
    for _ in fh:
        line_count += 1

    return FileRef(
        path=path,
        line_count=line_count,
        size_bytes=stat.st_size,
        format_detected=fmt.value,
        is_gzip=is_gzip,
        is_zip=is_zip,
    )
```

---

## 6. Error Handling Strategy

### 6.1 API-Level Errors

| Scenario           | HTTP Status | Response Body                                       |
| ------------------ | ----------- | --------------------------------------------------- |
| File not found     | 400         | `{"detail": "File not found: /path/to/file"}`       |
| Path is directory  | 400         | `{"detail": "Path is a directory: /path/to/dir"}`   |
| Path traversal     | 400         | `{"detail": "Path traversal not allowed"}`          |
| Outside sandbox    | 400         | `{"detail": "Path outside allowed directory: ..."}` |
| Permission denied  | 403         | `{"detail": "Permission denied: /path/to/file"}`    |
| File empty         | 200         | Valid `ParseLocalResponse` with `line_count=0`      |
| Binary file        | 200         | Valid response with warning field                   |
| Missing path field | 422         | Pydantic validation error                           |

### 6.2 Tool-Level Errors

Tool errors are returned as JSON objects (not raised), so the AI agent can interpret them:

```json
{"error": "File not found: /path/to/file"}
{"error": "Permission denied: /path/to/file"}
{"error": "File appears to be binary or non-text. Only N lines decoded."}
{"error": "start_line (500000) exceeds total_lines_in_file (125000)"}
```

### 6.3 Frontend Error Display

- API errors from `parseLocalPath()` are shown as `Alert` components in the `FileUpload` component (reusing existing `error` / `scanError` state).
- Tool errors are shown inline in the AI chat panel's `ToolCallDisplay` (existing component already renders tool results).

---

## 7. Frontend Architecture

### 7.1 New Component: `LocalPathInput`

Kata/pattern: A new section in `FileUpload.tsx` (not a separate component file — kept inline for simplicity, matching the existing directory input pattern).

```tsx
// Inside FileUpload.tsx, after the directory input section:

{
  !compact && (
    <>
      <Divider style={{ margin: '12px 0', fontSize: 12 }}>{t('orAnalyzeLocalFile')}</Divider>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder={t('localFilePathPlaceholder')}
          prefix={<FileTextOutlined />}
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          onPressEnter={() => {
            if (localPath.trim()) onLocalPath?.(localPath.trim())
          }}
          disabled={loading}
        />
        <Button
          type="primary"
          onClick={() => {
            if (localPath.trim()) onLocalPath?.(localPath.trim())
          }}
          disabled={!localPath.trim() || loading}
        >
          {t('analyze')}
        </Button>
      </Space.Compact>
    </>
  )
}
```

**New prop on `FileUpload`**:

```typescript
interface FileUploadProps {
  // ... existing ...
  onLocalPath?: (path: string) => void // NEW
}
```

### 7.2 AiPanel Changes

**New props**:

```typescript
interface AiPanelProps {
  // ... existing ...
  localFilePath: string | null // NEW
  localFileRef: LocalFileRef | null // NEW
}
```

**`buildContext()` extension**:

```typescript
const buildContext = (): string | undefined => {
  if (localFilePath && localFileRef) {
    const mb = (localFileRef.size_bytes / (1024 * 1024)).toFixed(1)
    return (
      `A local log file is available at "${localFilePath}" ` +
      `(${localFileRef.line_count} lines, ${mb} MiB, format: ${localFileRef.format_detected}). ` +
      `Use overview_local_log first, then search_local_log to investigate.`
    )
  }
  if (allLogs.length > 0) {
    // ... existing ...
  }
  // ... existing trace ...
}
```

**Session syncing for lazy mode**: When `localFilePath` changes, call `setSessionFilePath()` instead of `setSessionLogs()`.

### 7.3 App.tsx Integration

```typescript
// New state
const [localFilePath, setLocalFilePath] = useState<string | null>(null)
const [localFileRef, setLocalFileRef] = useState<LocalFileRef | null>(null)

// New handler
const handleLocalPath = useCallback(
  async (path: string) => {
    setFilters(DEFAULT_FILTERS)
    setActiveTab('log')
    try {
      const ref = await parseLocalPath(path)
      setLocalFilePath(path)
      setLocalFileRef(ref)
      setFileNames([path])
      resetLogs() // clear any previously loaded log entries
      void message.success(t('filePathRegistered'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('parseError')
      setError(msg)
    }
  },
  [resetLogs, t, message],
)
```

**Pass to AiPanel**:

```tsx
<AiPanel
  // ... existing props ...
  localFilePath={localFilePath}
  localFileRef={localFileRef}
/>
```

---

## 8. File Path Reference

| File                                          | Change     | Description                                                                                                                                                                                                         |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/ala/services/log_analyzer.py`    | **Add**    | `stream_file()`, `scan_file_meta()`, `_open_log_path()`, `_validate_path()`, `_parse_single_line()`, `_parse_file_handle_iter()`, `_detect_format_from_file()`, `FileRef` dataclass, `PathTraversalError` exception |
| `backend/src/ala/services/agent_tools.py`     | **Add**    | `LAZY_LOG_TOOLS` list (4 schemas), `_execute_lazy_log_tool()`, `_execute_overview_local_log()`, `_execute_search_local_log()`, `_execute_read_log_range()`, `_execute_tail_local_log()`                             |
| `backend/src/ala/services/agent_tools.py`     | **Modify** | `execute_tool()` — add `file_path` param, add lazy tool dispatch branch                                                                                                                                             |
| `backend/src/ala/services/ai_service.py`      | **Modify** | `_build_agentic_context()` — add `file_path`/`file_ref` params, select `LAZY_LOG_TOOLS` when set                                                                                                                    |
| `backend/src/ala/services/ai_service.py`      | **Modify** | `stream_chat_agentic()`, `_stream_chat_agentic_anthropic()`, `_stream_chat_agentic_openai()` — accept and forward `file_path`/`file_ref`                                                                            |
| `backend/src/ala/services/session_manager.py` | **Add**    | `file_path`, `file_ref` fields on `Session`; `set_file_path()`, `clear_file_path()` methods                                                                                                                         |
| `backend/src/ala/api/logs.py`                 | **Add**    | `POST /parse-local` endpoint, `ParseLocalRequest`, `ParseLocalResponse` models                                                                                                                                      |
| `backend/src/ala/api/chat.py`                 | **Add**    | `PUT /sessions/{id}/file-path` endpoint, `SetFilePathRequest` model                                                                                                                                                 |
| `backend/src/ala/api/chat.py`                 | **Modify** | `send_message()` — pass `file_path`/`file_ref` to agentic stream                                                                                                                                                    |
| `backend/src/ala/config.py`                   | **Add**    | `ala_sandbox_root: str = ""` env var                                                                                                                                                                                |
| `frontend/src/api/logs.ts`                    | **Add**    | `parseLocalPath()`, `LocalFileRef` type                                                                                                                                                                             |
| `frontend/src/api/chat.ts`                    | **Add**    | `setSessionFilePath()`                                                                                                                                                                                              |
| `frontend/src/types/index.ts`                 | **Add**    | `LocalFileRef` interface                                                                                                                                                                                            |
| `frontend/src/components/FileUpload.tsx`      | **Modify** | Add `onLocalPath` prop, local path input section                                                                                                                                                                    |
| `frontend/src/components/AiPanel.tsx`         | **Modify** | Add `localFilePath`/`localFileRef` props, extend `buildContext()`, sync to session on change                                                                                                                        |
| `frontend/src/App.tsx`                        | **Modify** | Add `localFilePath`/`localFileRef` state, `handleLocalPath()` callback, wire props                                                                                                                                  |
| `frontend/src/i18n/locales/en.json`           | **Add**    | `orAnalyzeLocalFile`, `localFilePathPlaceholder`, `analyze`, `filePathRegistered`                                                                                                                                   |
| `frontend/src/i18n/locales/zh.json`           | **Add**    | Corresponding Chinese strings                                                                                                                                                                                       |

---

## 9. Implementation Sequence

```
1. Backend: log_analyzer.py
   ├─ _validate_path() + security
   ├─ _open_log_path(), _detect_format_from_file()
   ├─ _parse_single_line() (refactor from existing iterators)
   ├─ stream_file() generator
   └─ scan_file_meta()

2. Backend: api/logs.py
   └─ POST /parse-local endpoint

3. Backend: session_manager.py
   └─ file_path/file_ref fields + set_file_path()

4. Backend: api/chat.py
   └─ PUT /sessions/{id}/file-path endpoint

5. Backend: agent_tools.py
   ├─ LAZY_LOG_TOOLS schemas
   ├─ 4x _execute_lazy_* functions
   └─ execute_tool() dispatch

6. Backend: ai_service.py
   ├─ _build_agentic_context() file_path support
   └─ Forward file_path through agentic methods

7. Backend: ai_service.py + api/chat.py
   └─ Pass file_path/file_ref through send_message

8. Frontend: types, API client functions

9. Frontend: FileUpload local path input

10. Frontend: AiPanel lazy mode + App.tsx wiring

11. Frontend: i18n strings

12. Testing (unit + integration)
```

---

## 10. Risks & Mitigations

| Risk                                                | Severity | Mitigation                                                                                                                                                                                     |
| --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Race condition**: file changes between tool calls | Medium   | Accept for v1. Document that analysis is a point-in-time snapshot. Tools re-validate path on each call. Future: detect mtime change and warn.                                                  |
| **Slow tool responses for large files**             | Medium   | AI instructed to use `max_lines` cap. `search_local_log` short-circuits after finding offset+limit matches. Future: progress events in SSE.                                                    |
| **GZ/ZIP streaming edge cases**                     | Low      | Python stdlib handles streaming natively. Tested with multi-GB archives.                                                                                                                       |
| **AI calls wrong tool for mode**                    | Low      | `_build_agentic_context` selects exactly one toolset. If `file_path` is set, `LOG_TOOLS` are excluded. Prompt guides the AI.                                                                   |
| **Tool result truncation in SSE**                   | Low      | Reuse existing `_truncate_tool_result()` with `search_local_log` added to its known-tool list.                                                                                                 |
| **Session resumption with wrong toolset**           | Low      | `raw_api_messages` stored per-session include tool definitions. Resumption works because the same tools are active. If a user switches from lazy to in-memory mode, a new session is expected. |

---

## 11. Testing Strategy

| Layer                | What to test                                                             | Framework                |
| -------------------- | ------------------------------------------------------------------------ | ------------------------ |
| `log_analyzer.py`    | `_validate_path()` for traversal, sandbox, missing, dir, permissions     | pytest                   |
| `log_analyzer.py`    | `stream_file()` yields correct entries for `.txt`, `.gz`, `.zip`         | pytest                   |
| `log_analyzer.py`    | `scan_file_meta()` returns correct counts + format                       | pytest                   |
| `agent_tools.py`     | Each lazy tool returns correct JSON for small test files                 | pytest                   |
| `agent_tools.py`     | Error conditions: missing file, permission denied mid-scan               | pytest                   |
| `api/logs.py`        | `POST /parse-local` happy path + all error cases                         | pytest + httpx           |
| `api/chat.py`        | `PUT /sessions/{id}/file-path` + `send_message` with file_path           | pytest + httpx           |
| `ai_service.py`      | `_build_agentic_context` selects correct tools per mode                  | pytest                   |
| `session_manager.py` | `set_file_path` stores + clears log_entries                              | pytest                   |
| Frontend             | `FileUpload` renders path input, calls `onLocalPath`                     | vitest + testing-library |
| Frontend             | `AiPanel` shows lazy context, calls `setSessionFilePath`                 | vitest                   |
| Integration          | End-to-end: path → parse-local → session → AI question → tool → response | Manual + future e2e      |

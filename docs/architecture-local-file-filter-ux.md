# Architecture: Local File Loading + Filter, Tabs Hide, Upload Button UX

> **Branch**: `feat/local-file-filter-ux`
> **Author**: Architect
> **Date**: 2026-05-24
> **Based on**: `docs/requirements-local-file-filter-ux.md`
> **Status**: Draft

---

## Executive Summary

Three tightly-coupled UX changes delivered through **6 implementation tasks**, each self-contained and additive. The key architectural insight is that the backend already has `LogAnalyzer.stream_file()` (line 552 of `log_analyzer.py`) but **no REST endpoint exposes it**. We need a single new backend endpoint to unlock the local file → `allLogs` streaming pipeline.

| Task | Scope | Complexity | Dependencies |
|------|-------|------------|--------------|
| T1 — New backend endpoint | Backend | 🟢 Low | None |
| T2 — New frontend API function | Frontend API | 🟢 Low | T1 |
| T3 — Append mode in `useLogStream` | Frontend hook | 🟢 Low | None |
| T4 — Local file streaming in `App.tsx` | Frontend core | 🟡 Medium | T1, T2, T3 |
| T5 — Conditional Tabs + placeholder removal | Frontend core | 🟢 Low | T4 |
| T6 — Upload popover redesign | Frontend UI | 🟡 Medium | T3 |

---

## 1. Backend: Single-File Local Path Streaming Endpoint

### 1.1 Discovery

**Backend already has `LogAnalyzer.stream_file()`** (line 552, `backend/src/ala/services/log_analyzer.py`):

```python
def stream_file(self, file_path: str, sandbox_root: str | None = None) -> Iterator[LogEntry]:
    """Stream LogEntry objects from a local file path, one at a time.
    Never loads the entire file into memory. Handles .gz, .zip, and plain text."""
```

This method:
- Validates the path via `_validate_path()` (path traversal protection)
- Auto-detects log format from first 10 lines
- Handles `.gz` (gzipped), `.zip` (multi-member), and plain text
- Yields `LogEntry` objects one at a time
- **Is memory-efficient** — never loads the entire file

**But there is NO REST endpoint wrapping it.** Confirmed:

| Endpoint | Method | Accepts | Used for |
|----------|--------|---------|----------|
| `POST /logs/parse/stream` | multipart upload | `files: list[UploadFile]` | Uploaded files only |
| `POST /logs/directory/parse/stream` | JSON body `{path}` | Directory path | ALL files in a dir |
| `POST /logs/directory/parse/selected/stream` | JSON body `{path, selected_files}` | Directory + file list | Selected files in a dir |
| **`POST /logs/file/parse/stream`** | ❌ **MISSING** | — | Single local file |

### 1.2 New Endpoint Design

**File**: `backend/src/ala/api/logs.py`

```python
class FileStreamRequest(BaseModel):
    path: str


@router.post("/file/parse/stream")
async def parse_file_stream(req: FileStreamRequest):
    """Stream-parse a single local file (or archive) using NDJSON.

    Accepts a local file path and streams LogEntry objects one at a time.
    Handles .gz, .zip, and plain text files.
    """
    try:
        validated = LogAnalyzer._validate_path(req.path)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def _generate():
        total = 0
        try:
            for entry in _analyzer.stream_file(validated):
                line = _from_service_entry(entry)
                yield json.dumps(line.model_dump()) + "\n"
                total += 1
        except (ValueError, OSError, PermissionError) as e:
            yield json.dumps({"_error": str(e)}) + "\n"
        yield json.dumps({"_done": True, "total": total}) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )
```

**Key design decisions:**
- **POST with JSON body** (not GET) — consistent with all other streaming endpoints
- **Reuses `_validate_path`** — same path traversal protection as `/parse-local` and `/auto-path`
- **Returns NDJSON** — identical wire format to `parseDirectoryStream` and `parseSelectedFilesStream`
- **Path**: `/file/parse/stream` — follows naming convention of existing `/directory/parse/stream`

### 1.3 Why Not Reuse `/parse/stream` or `/directory/parse/stream`?

| Approach | Problem |
|----------|---------|
| Add `path` param to `/parse/stream` | That endpoint uses `files: list[UploadFile] = File(...)` which is multipart. Adding a JSON body parameter would break the contract. |
| Use `/directory/parse/stream` for single files | It calls `os.scandir()` — fails on file paths |
| Use `/parse-local` + a lazily streamed file | `/parse-local` only returns metadata, no streaming |

**Conclusion**: A new endpoint is the cleanest, most maintainable approach.

---

## 2. Frontend API: New `parseLocalFileStream` Function

### 2.1 Design

**File**: `frontend/src/api/logs.ts`

```typescript
/**
 * Stream-parse a single local log file on the server.
 *
 * Calls POST /api/logs/file/parse/stream and yields LogEntry
 * objects as they arrive. Final line: {_done: true, total: N}.
 */
export async function* parseLocalFileStream(
  filePath: string,
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | StreamDone> {
  for await (const line of streamNDJSON<StreamLine>(
    '/logs/file/parse/stream',
    { path: filePath },
    signal,
  )) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as LogEntry | StreamDone
    if (isDone(line)) return
  }
}
```

**Rationale**: Follows the exact same pattern as `parseDirectoryStream` (line 133) and `parseSelectedFilesStream` (line 153). Uses the existing `streamNDJSON` helper from `client.ts` which handles the fetch, reader, and JSON line parsing. The function signature `(filePath, signal?) => AsyncGenerator` matches the `StreamFactory` type in `useLogStream.ts`.

### 2.2 Integration with Existing API Surface

```
                    ┌──────────────────────────┐
                    │     api/logs.ts          │
                    ├──────────────────────────┤
Upload:             │ parseLogStream(files)    │ → POST /logs/parse/stream (multipart)
Directory (all):    │ parseDirectoryStream(p)  │ → POST /logs/directory/parse/stream
Directory (pick):   │ parseSelectedFilesStream │ → POST /logs/directory/parse/selected/stream
Single file (new):  │ parseLocalFileStream(p)  │ → POST /logs/file/parse/stream     ← NEW
                    └──────────────────────────┘
```

All four functions return `AsyncGenerator<LogEntry | StreamDone>` — compatible with `useLogStream.loadFromStream()`.

---

## 3. Append Mode in `useLogStream`

### 3.1 Current Behavior

```typescript
// useLogStream.ts line 53-116
const loadFromStream = useCallback(
  async (streamFactory: StreamFactory, fileLabels: string[]): Promise<boolean> => {
    // ...
    setAllLogs([])       // ← ALWAYS clears existing logs
    setFileNames(fileLabels)  // ← overwrites file names
    // ...
  }, [],
)
```

### 3.2 New Signature (Option A — Recommended)

```typescript
const loadFromStream = useCallback(
  async (
    streamFactory: StreamFactory,
    fileLabels: string[],
    append = false,       // ← NEW parameter
  ): Promise<boolean> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(undefined)

    if (append) {
      // Append mode: keep existing logs + accumulate file names
      setFileNames((prev) => [...prev, ...fileLabels])
      // Do NOT clear allLogs
    } else {
      // Replace mode: clear everything (existing behavior)
      setFileNames(fileLabels)
      setAllLogs([])
    }

    setFormatDetected(undefined)
    setParsedCount(0)
    setTotalExpected(0)
    formatRef.current = undefined

    // ... rest of streaming logic unchanged ...
  },
  [],
)
```

**Why Option A (append flag) over Option B (separate method)?**

| Criterion | Option A: `append` param | Option B: `appendToStream()` |
|-----------|--------------------------|------------------------------|
| DRY | ✅ All streaming logic shared | ❌ Duplicates 90% of `loadFromStream` |
| Caller simplicity | ✅ `loadFromStream(factory, names, true)` | ⚠️ Two methods to maintain |
| TypeScript interface | ✅ One optional boolean | ❌ New method, larger interface |
| Backward compat | ✅ Default `false` = no breakage | ✅ No breakage |

**Edge case**: `setFileNames` uses functional update in append mode to avoid stale closure bugs. `setAllLogs` is NOT cleared in append mode; new entries are just pushed into the existing array via the existing `flush()` mechanism.

### 3.3 Updated `UseLogStreamReturn` Interface

```typescript
interface UseLogStreamReturn {
  // ... existing fields unchanged ...
  loadFromStream: (
    streamFactory: StreamFactory,
    fileLabels: string[],
    append?: boolean,     // ← NEW
  ) => Promise<boolean>
  // ... rest unchanged ...
}
```

---

## 4. Local File Streaming Integration in `App.tsx`

### 4.1 Architecture Overview

The goal is to replace the lazy-load placeholder flow with actual streaming:

```
                        CURRENT                             NEW
                   ┌──────────────┐                 ┌──────────────┐
autoPath → file    │ setLocalPath  │          ──→   │ stream file   │
                   │ placeholder   │                 │ into allLogs  │
                   │ allLogs = []  │                 │ + setLocalPath│
                   └──────────────┘                 └──────────────┘

                   ┌──────────────┐                 ┌──────────────┐
autoPath → dir     │ setLocalPath  │          ──→   │ show picker   │
                   │ placeholder   │                 │ → stream sel  │
                   │ no picker     │                 │ into allLogs  │
                   └──────────────┘                 │ + setLocalPath│
                                                    └──────────────┘
```

### 4.2 New Callback: `onLocalPathStream`

**File**: `frontend/src/components/FileUpload.tsx`

Add a new prop to `FileUploadProps`:

```typescript
interface FileUploadProps {
  // ... existing props ...
  onLocalFilePath?: (path: string, fileRef: LocalFileRef) => void  // DEPRECATED — keep for compat
  onLocalPathStream?: (path: string, type: 'file' | 'directory', autoPathResult: AutoPathResponse) => void  // NEW
}
```

Modify `handlePathSubmit` to call the new callback:

```typescript
const handlePathSubmit = useCallback(async (path: string) => {
  // ... setScanError, setInputLoading ...
  const result = await autoPath(path)

  if (result.type === 'file' && result.session_file) {
    // Prefer new callback if provided
    if (onLocalPathStream) {
      onLocalPathStream(path, 'file', result)
    } else {
      // Fallback to old callback for backward compat
      onLocalFilePath?.(path, { ... })
    }
    setInputPath('')
  } else if (result.type === 'directory') {
    if (onLocalPathStream) {
      onLocalPathStream(path, 'directory', result)
    } else {
      onLocalFilePath?.(path, { ... })
    }
    setInputPath('')
  }
  // ...
}, [onLocalFilePath, onLocalPathStream, t])
```

### 4.3 App.tsx Handler: `handleLocalPathStream`

**File**: `frontend/src/App.tsx`

New state for directory picker:

```typescript
// New state for directory file picker modal
const [pickerState, setPickerState] = useState<{
  open: boolean
  files: DirectoryFileInfo[]
  dirPath: string
}>({ open: false, files: [], dirPath: '' })
```

New callback handler:

```typescript
import { parseLocalFileStream, parseSelectedFilesStream, autoPath } from './api/logs'
import type { AutoPathResponse, DirectoryFileInfo } from './api/logs'

const handleLocalPathStream = useCallback(
  async (path: string, type: 'file' | 'directory', result: AutoPathResponse) => {
    setLocalFilePath(null)
    setFilters(DEFAULT_FILTERS)
    setActiveTab('log')

    if (type === 'file') {
      // Single file: stream directly into allLogs
      const label = path.split('/').pop() || path
      const ok = await loadFromStream(
        (signal) => parseLocalFileStream(path, signal),
        [label],
        false, // replace mode for single file
      )
      if (ok) {
        setLocalFilePath(result.session_file || path)
        void message.success(t('fileUploaded'))
      }
    } else {
      // Directory: show file picker modal
      setPickerState({
        open: true,
        files: result.files || [],
        dirPath: path,
      })
    }
  },
  [loadFromStream, t, message],
)
```

Directory picker confirm handler:

```typescript
const handlePickerConfirm = useCallback(
  async (selectedFiles: string[]) => {
    setPickerState((prev) => ({ ...prev, open: false }))
    const ok = await loadFromStream(
      (signal) => parseSelectedFilesStream(pickerState.dirPath, selectedFiles, signal),
      selectedFiles.map((f) => f.split('/').pop() || f),
      false,
    )
    if (ok) {
      setLocalFilePath(pickerState.dirPath)
      void message.success(t('fileUploaded'))
    }
  },
  [loadFromStream, pickerState.dirPath, t, message],
)

const handlePickerCancel = useCallback(() => {
  setPickerState((prev) => ({ ...prev, open: false }))
}, [])
```

### 4.4 Wiring: Popover vs Tab handlers

**Popover handler** (line 423-443 currently):

```typescript
const uploadPopoverContent = (
  <div style={{ width: 300 }}>
    <FileUpload
      onLogFiles={(files) => {
        void handleLogFiles(files)
        setUploadPopoverOpen(false)
      }}
      onTraceFile={(f) => {
        void handleTraceFile(f)
        setUploadPopoverOpen(false)
      }}
      onLocalPathStream={(path, type, result) => {
        void handleLocalPathStream(path, type, result)
        setUploadPopoverOpen(false)
      }}
      loading={isLoading}
      error={errorMessage}
      fileNames={fileNames}
    />
  </div>
)
```

**Tab handler** / **`showFileUpload` handler** (lines 469-483 currently):

```typescript
// When showFileUpload is true, render FileUpload directly:
<FileUpload
  onLogFiles={(files) => { void handleLogFiles(files) }}
  onTraceFile={(f) => { void handleTraceFile(f) }}
  onLocalPathStream={(path, type, result) => {
    void handleLocalPathStream(path, type, result)
  }}
  loading={isLoading}
  error={errorMessage}
  fileNames={fileNames}
/>
```

### 4.5 Render DirectoryFilePicker Modal

Add to the JSX (inside the main route, outside Splitter):

```tsx
<DirectoryFilePicker
  open={pickerState.open}
  files={pickerState.files}
  dirPath={pickerState.dirPath}
  onConfirm={handlePickerConfirm}
  onCancel={handlePickerCancel}
/>
```

### 4.6 `showFileUpload` Logic (No Change Needed)

The existing condition:

```typescript
const showFileUpload = allLogs.length === 0 && !traceResult && !localFilePath
```

After local file streaming populates `allLogs`, `showFileUpload` naturally becomes `false`. No change to the condition itself is needed — the **behavior** changes because `allLogs` is no longer empty after local path loading.

---

## 5. Conditional Tabs + Placeholder Removal

### 5.1 Current Structure

```
<Splitter.Panel>                     // Center panel (line 663)
  <div>
    <Tabs>                            // Always rendered (line 665)
      items={tabItems}                // Contains 3 branches:
        ├── showFileUpload → <FileUpload>
        ├── localFilePath && allLogs.length===0 → 📂 placeholder
        └── else → LogViewer/Empty
    </Tabs>
  </div>
</Splitter.Panel>
```

### 5.2 New Structure

```
<Splitter.Panel>                     // Center panel
  <div>
    {showFileUpload ? (              // CONDITIONAL: no tabs when empty
      <FileUpload ... />
    ) : (
      <Tabs>                         // Tabs only render when data is loaded
        items={tabItems}             // Contains 2 branches:
          ├── !hasActiveFilters → Empty (no filter)
          └── else → LogViewer
      </Tabs>
    )}
  </div>
</Splitter.Panel>
```

### 5.3 Simplified `tabItems`

The log tab children become:

```typescript
const tabItems = [
  {
    key: 'log',
    label: t('logAnalysis'),
    children: !hasActiveFilters ? (
      <div style={{ /* centered Empty state */ }}>
        <Empty description={t('noFilterApplied')} />
        <Typography.Text type="secondary">
          {t('applyFiltersToView')}
        </Typography.Text>
      </div>
    ) : (
      <LogViewer
        logs={filteredLogs}
        totalLogs={allLogs.length}
        highlights={highlights}
        wordWrap={wordWrap}
        formatDetected={formatDetected}
        parseProgress={parseProgress}
      />
    ),
  },
  {
    key: 'trace',
    label: t('traceAnalysis'),
    children: <TraceViewer traceResult={traceResult} />,
  },
]
```

**What's removed:**
- The `showFileUpload` branch from `tabItems` (moved up to the conditional)
- The `localFilePath && allLogs.length === 0` placeholder branch (lines 484-510) — **wholly deleted** because local files now stream into `allLogs`

### 5.4 Upload Button (`tabBarExtra`) Visibility

The `tabBarExtra` is embedded inside `<Tabs>`. Since Tabs are only rendered when `!showFileUpload`, the upload button **naturally disappears** when nothing is loaded. When files are loaded, the button appears in the tab bar as before.

**No additional logic needed** — this falls out from the structural change in 5.2.

---

## 6. Upload Popover Redesign

### 6.1 Current Popover

```tsx
// Single FileUpload in compact mode — only "replace" behavior
const uploadPopoverContent = (
  <div style={{ width: 300 }}>
    <FileUpload compact ... />
  </div>
)
```

### 6.2 New Popover (Two Modes When Files Are Loaded)

**New component**: `UploadPopover` (or inline in App.tsx)

**When `fileNames.length === 0`** (no files loaded):
→ Render same as current — single compact `FileUpload`.

**When `fileNames.length > 0`** (files loaded):
→ Render a richer UI:

```
┌─────────────────────────────────────┐
│  Currently loaded:                  │
│  📄 logcat.txt                      │
│  📄 kernel.log                      │
│                                     │
│  ─── Drop new files here ───        │
│  [compact Drag area]                │
│                                     │
│  Mode:                              │
│  ○ Update (replace current)         │
│  ● Append (add to current)          │
│                                     │
│  [       Load Files       ]         │
└─────────────────────────────────────┘
```

**Implementation approach** — inline state in App.tsx (not a new component file):

```typescript
// New state
const [uploadMode, setUploadMode] = useState<'replace' | 'append'>('replace')
const [pendingFiles, setPendingFiles] = useState<File[]>([])  // staged files

// Handler: stage files + decide mode
const handleUploadPopoverFiles = useCallback(
  async (files: File[], isTrace: boolean) => {
    if (isTrace) {
      await handleTraceFile(files[0])
      setUploadPopoverOpen(false)
      return
    }
    // Log files: stage them, user picks mode
    setPendingFiles(files)
  },
  [handleTraceFile],
)

// Handler: execute load with selected mode
const handleUploadPopoverLoad = useCallback(async () => {
  const append = uploadMode === 'append'
  const ok = await loadFromStream(
    (signal) => parseLogStream(pendingFiles, signal),
    pendingFiles.map((f) => f.name),
    append,
  )
  if (ok) void message.success(t('fileUploaded'))
  setPendingFiles([])
  setUploadPopoverOpen(false)
}, [loadFromStream, pendingFiles, uploadMode, t, message])
```

**Popover content when files staged:**

```tsx
const uploadPopoverContent = (
  <div style={{ width: 340 }}>
    {/* Current files */}
    <div style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('currentlyLoaded')}:
      </Typography.Text>
      {fileNames.map((name) => (
        <div key={name}>
          <FileOutlined /> <Text style={{ fontSize: 12 }}>{name}</Text>
        </div>
      ))}
    </div>

    {/* Drop zone */}
    <FileUpload compact={true} ... />

    {/* Mode selector — only shown when pendingFiles exist */}
    {pendingFiles.length > 0 && (
      <>
        <Divider style={{ margin: '8px 0' }} />
        <Radio.Group
          value={uploadMode}
          onChange={(e) => setUploadMode(e.target.value)}
          size="small"
        >
          <Space direction="vertical">
            <Radio value="replace">{t('replaceMode')}</Radio>
            <Radio value="append">{t('appendMode')}</Radio>
          </Space>
        </Radio.Group>
        <Button
          type="primary"
          block
          size="small"
          style={{ marginTop: 8 }}
          onClick={handleUploadPopoverLoad}
        >
          {uploadMode === 'append' ? t('appendFiles') : t('updateFiles')}
        </Button>
      </>
    )}
  </div>
)
```

### 6.3 Flow State Machine

```
                     ┌──────────────────┐
                     │  Popover closed   │
                     └────────┬─────────┘
                              │ user clicks upload button
                              ▼
                     ┌──────────────────┐
                     │  Popover open     │
                     │  no staged files  │
                     └────────┬─────────┘
                              │ user drops/selects files
                              ▼
                     ┌──────────────────┐
           ┌────────│  Files staged      │─────────┐
           │        │  (pendingFiles > 0)│         │
           │        └────────┬───────────┘         │
           │ user selects     │ user selects         │ user clicks
           │ "replace"        │ "append"             │ "trace" file
           ▼                  ▼                      ▼
    ┌──────────────┐  ┌──────────────┐    ┌──────────────────┐
    │ loadFromStream│  │ loadFromStream│    │ handleTraceFile   │
    │ append=false  │  │ append=true   │    │ close popover     │
    └──────┬───────┘  └──────┬───────┘    └──────────────────┘
           │                  │
           ▼                  ▼
    ┌──────────────────────────────────┐
    │  Popover closed                  │
    │  allLogs updated, pendingFiles=[]│
    └──────────────────────────────────┘
```

### 6.4 i18n Keys Required

New keys to add to `frontend/src/i18n/locales/en.json` and `zh.json`:

| Key | en | zh | Used In |
|-----|----|----|---------|
| `updateFiles` | "Update Files" | "更新文件" | Button text + mode label |
| `appendFiles` | "Append Files" | "追加文件" | Button text + mode label |
| `replaceMode` | "Replace current logs" | "替换当前日志" | Radio label |
| `appendMode` | "Append to current logs" | "追加到当前日志" | Radio label |
| `currentlyLoaded` | "Currently loaded" | "当前已加载" | Popover header |
| `dropToUpdate` | "Drop new files to update" | "拖拽新文件以更新" | Popover hint |

**Rename**: `changeFiles` → `updateFiles` (update the key in both locale files, and the reference in `App.tsx` line 457).

---

## 7. Data Flow Diagram (Complete)

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx                                 │
│                                                                 │
│  ┌─────────┐   ┌──────────────┐   ┌─────────────────────┐      │
│  │Upload    │   │FileUpload    │   │DirectoryFilePicker  │      │
│  │Popover   │   │(full page)   │   │Modal                │      │
│  └────┬─────┘   └──────┬───────┘   └──────────┬──────────┘      │
│       │                │                       │                │
│       │ onLogFiles     │ onLocalPathStream      │ onConfirm      │
│       │ (stage files)  │                       │                │
│       ▼                ▼                       ▼                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              handleLogFiles / handleLocalPathStream      │    │
│  │              handleUploadPopoverLoad                     │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 useLogStream.loadFromStream               │    │
│  │  streamFactory:                                          │    │
│  │    • parseLogStream(files, signal)    — upload            │    │
│  │    • parseLocalFileStream(path, sig)  — single file   NEW │    │
│  │    • parseSelectedFilesStream(path,   — directory     NEW │    │
│  │        selectedFiles, signal)                             │    │
│  │  append: true | false  ← NEW                              │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  State: allLogs[]  ← populated via flush() batched       │    │
│  │         fileNames[], loading, error, parseProgress       │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Derived: filteredLogs = applyFiltersClient(allLogs,      │    │
│  │              debouncedFilters)                            │    │
│  │           statistics = computeStatistics(filteredLogs)    │    │
│  │           showFileUpload = allLogs.length===0             │    │
│  │                            && !traceResult                │    │
│  │                            && !localFilePath              │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│                        ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Render:                                                 │    │
│  │    showFileUpload? → <FileUpload> (no tabs)              │    │
│  │    !showFileUpload? → <Tabs> <LogViewer> (with filters)  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Implementation Order & File Change Map

### Recommended Order

| # | Task | Rationale |
|---|------|-----------|
| T1 | Backend: `POST /logs/file/parse/stream` | Unblocks frontend; independent of frontend changes |
| T2 | Frontend: `parseLocalFileStream()` in `api/logs.ts` | Depends on T1 |
| T3 | Frontend: Append mode in `useLogStream.loadFromStream` | Independent; needed by T4+T6 |
| T4 | Frontend: Local file streaming in `App.tsx` | Depends on T2, T3 |
| T5 | Frontend: Conditional Tabs + placeholder removal in `App.tsx` | Depends on T4 (removes placeholder branch) |
| T6 | Frontend: Upload popover redesign in `App.tsx` | Depends on T3 (append mode) |

### Files Changed per Task

| Task | File | Change Type |
|------|------|-------------|
| **T1** | `backend/src/ala/api/logs.py` | Add `FileStreamRequest` model + `parse_file_stream` endpoint |
| **T2** | `frontend/src/api/logs.ts` | Add `parseLocalFileStream()` function |
| **T3** | `frontend/src/hooks/useLogStream.ts` | Add `append?: boolean` to `loadFromStream` |
| **T4** | `frontend/src/App.tsx` | Add `pickerState`, `handleLocalPathStream`, `handlePickerConfirm/Cancel`, wire callbacks, import `parseLocalFileStream` |
| **T4** | `frontend/src/components/FileUpload.tsx` | Add `onLocalPathStream` prop, modify `handlePathSubmit` |
| **T5** | `frontend/src/App.tsx` | Conditional `<Tabs>` render, remove placeholder branch from `tabItems` |
| **T6** | `frontend/src/App.tsx` | Add `uploadMode`, `pendingFiles`, stage/load handlers, mode selector UI |
| **T6** | `frontend/src/i18n/locales/en.json` | Add 6 new keys, rename `changeFiles` → `updateFiles` |
| **T6** | `frontend/src/i18n/locales/zh.json` | Add 6 new keys, rename `changeFiles` → `updateFiles` |

---

## 9. Risk Analysis & Edge Cases

### 9.1 Backward Compatibility

| Concern | Mitigation |
|---------|------------|
| Old `onLocalFilePath` prop | Keep in `FileUploadProps`; `onLocalPathStream` takes priority if both are provided |
| `useLogStream` signature change | `append` defaults to `false` — zero impact on existing callers |
| Upload workflow unchanged | Drag-and-drop files → `handleLogFiles` → `parseLogStream` path untouched |
| Existing 191 tests | All changes are additive; no existing code paths are removed (except the placeholder branch, which is unused after streaming is wired) |

### 9.2 Edge Cases

| Case | Handling |
|------|----------|
| Path traversal attempt | Caught by `_validate_path()` in backend → 400 error |
| File not found / permission denied | Backend returns 400/403 → frontend shows error via `fileError` state |
| User cancels directory picker | `handlePickerCancel` sets `pickerState.open = false`, no side effects |
| Very large files (>256MB) | Backend `stream_file()` reads line-by-line, never loads entire file. Frontend processes in batches of 500. |
| User aborts streaming | `abortParse()` calls `AbortController.abort()`, works for all stream types |
| Append with empty existing logs | `setAllLogs([])` already executed, append just skips the re-clear — functionally identical to replace |
| Multiple rapid uploads | `abortRef.current?.abort()` at start of `loadFromStream` cancels previous stream |
| Popover: user stages files, then re-drops | New drop replaces `pendingFiles` (most recent wins) |
| Directory picker: select 0 files | Confirm button is `disabled` when `selected.size === 0` |

### 9.3 Open Risks

- **Directory picker + single-file future**: If the user enters a file path that is also a valid directory name (unlikely edge case), `autoPath` returns type based on `os.path.isfile/is_dir`. No ambiguity.
- **`localFilePath` cleared on project change**: The existing `useEffect` (line 159) clears `localFilePath` when `traceResult` or `selectedProjectId` changes. This remains correct — switching projects clears local references.

---

## 10. Summary

This architecture introduces **one new backend endpoint**, **one new frontend API function**, **one hook parameter change**, and **three App.tsx restructurings**. All changes are additive, with explicit backward compatibility for the deprecated `onLocalFilePath` callback. The key enabler is the existing but unexposed `LogAnalyzer.stream_file()` method in the backend — a single endpoint unlocks the entire local-file-to-filter pipeline.

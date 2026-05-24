# Requirements: Local File Loading + Filter, Tabs Hide & Upload Button UX

> **Branch**: `feat/local-file-filter-ux`
> **Status**: Draft
> **Author**: Product Manager
> **Date**: 2026-05-24

---

## Overview

Three tightly-related UX improvements to the ALA file loading flow:

1. **Local file/directory loading with full filter support** — stream local log files into `allLogs` so the filter sidebar works (keywords, level, tag, pid, tid, time range).
2. **Hide Tabs when no data is loaded** — when `showFileUpload` is true (zero logs, zero trace, zero local path), render the FileUpload widget directly in the center area without the Tabs chrome.
3. **Upload button UX polish** — rename "更换文件" → "更新文件", add "追加文件" mode that appends to existing logs instead of replacing them.

All three are additive and must pass the existing 191-test suite without regression.

---

## Current State (Baseline)

### File Loading Flow

```
User drops files / enters local path
        │
        ▼
FileUpload.onLocalFilePath(path, ref)
        │
        ▼
App: setLocalFilePath(ref.session_file)  ← sets state, shows placeholder
App: allLogs remains []                  ← logs NOT streamed into memory
        │
        ▼
Filter sidebar: no effect (allLogs is empty)
```

**Key code references:**

| Concern | File | Lines |
|---|---|---|
| `localFilePath` state | `App.tsx` | 103 |
| `showFileUpload` derivation | `App.tsx` | 416 |
| `onLocalFilePath` handler (popover) | `App.tsx` | 434–438 |
| `onLocalFilePath` handler (tab) | `App.tsx` | 476–479 |
| Local file placeholder UI | `App.tsx` | 484–510 |
| Tabs render (always visible) | `App.tsx` | 665–675 |
| Upload button (tabBarExtra) | `App.tsx` | 446–462 |
| `FileUpload.handlePathSubmit` | `FileUpload.tsx` | 149–187 |
| `useLogStream.loadFromStream` | `useLogStream.ts` | 53–116 |
| `parseDirectoryStream` | `api/logs.ts` | 133–148 |
| `parseSelectedFilesStream` | `api/logs.ts` | 153–169 |
| `autoPath` | `api/logs.ts` | 113–118 |
| `DirectoryFilePicker` component | `DirectoryFilePicker.tsx` | full file |

### Current `showFileUpload` Logic

```ts
const showFileUpload = allLogs.length === 0 && !traceResult && !localFilePath
```

When `showFileUpload` is true:
- The "log" tab renders `<FileUpload>` inside a `<Tabs>` wrapper (showing "日志分析" / "Trace 分析" tab headers).
- The upload button in the tab bar says "上传文件".

When `localFilePath` is set but `allLogs` is empty (the current lazy-load path):
- A placeholder card is shown: 📂 "本地文件已就绪，可供 AI 分析" + file path + hint text.

### Current Upload Button

```tsx
const tabBarExtra = (
  <Popover content={uploadPopoverContent} open={uploadPopoverOpen}
           onOpenChange={setUploadPopoverOpen} trigger="click" placement="bottomRight">
    <Tooltip title={fileNames.length > 0 ? t('changeFiles') : t('uploadFiles')}>
      <Button size="small" icon={<UploadOutlined />} loading={isLoading}>
        {fileNames.length > 0 ? t('changeFiles') : t('uploadFiles')}
      </Button>
    </Tooltip>
  </Popover>
)
```

Button text: `t('changeFiles')` = "更换文件" when files loaded, `t('uploadFiles')` = "上传文件" when empty.

---

## Feature 1: 加载本地日志目录或文件，支持筛选查看

### Requirement 1.1 — Stream local files into `allLogs`

**When the user submits a local path via `FileUpload.handlePathSubmit`:**

1. Call `autoPath(path)` (existing, unchanged).
2. If `result.type === 'file'`:
   - Instead of calling `onLocalFilePath` (which only sets a placeholder), stream the file into `allLogs`.
   - Use `parseLogStream` with a server-side file reference, or add a new API call `parseLocalFilePathStream(path)` — **investigation needed**: does the backend `POST /logs/parse/stream` accept a file path in addition to upload multipart? If not, we need a new backend endpoint or use `parseDirectoryStream` for single files too.
   - **Alternative (preferred if backend supports it)**: Use the existing `POST /logs/auto-path` to register the session, then call a streaming endpoint that accepts the `session_file` identifier.
3. If `result.type === 'directory'`:
   - Show the `DirectoryFilePicker` modal (already built).
   - On confirm, call `parseSelectedFilesStream(dirPath, selectedFiles, signal)` and pass the returned async generator to `loadFromStream`.
   - On cancel, do nothing (return to FileUpload).

**State flow after local file stream completes:**

```
allLogs populated → filteredLogs computed → filter sidebar works
localFilePath also set (preserved for AI panel backward compatibility)
```

### Requirement 1.2 — FileUpload callback contract change

`FileUpload` currently calls `onLocalFilePath(path, ref)` for local paths. This callback is used in two places:

- `App.tsx` line 434 (popover handler)
- `App.tsx` line 476 (tab handler)

**Change**: The callback should signal a new streaming intent rather than just setting `localFilePath`. Two approaches:

**Option A (recommended)**: Add a new callback `onLocalPathStream(path: string, type: 'file' | 'directory', autoPathResult: AutoPathResponse)` to `FileUploadProps`. The old `onLocalFilePath` becomes deprecated. This keeps the FileUpload component clean and lets App.tsx orchestrate the streaming.

**Option B**: Modify the existing `onLocalFilePath` to accept additional parameters that App.tsx uses to decide whether to stream.

**Decision**: Option A. Cleaner separation of concerns.

### Requirement 1.3 — Directory file picker integration

When `autoPath` returns `type === 'directory'`, the flow is:

```
FileUpload.handlePathSubmit(path)
  → autoPath(path) → { type: 'directory', files, ... }
  → Show DirectoryFilePicker modal (files pre-selected)
  → User selects/unselects files → clicks "加载所选文件"
  → App.tsx receives selected files list
  → Calls loadFromStream(() => parseSelectedFilesStream(dirPath, selected, signal), selected)
  → allLogs populated
```

**Edge cases to handle:**
- Empty directory (no log files found): show an empty state message in the picker (already handled by `DirectoryFilePicker` — shows `<Empty>`).
- User cancels the picker: return to the FileUpload widget as-is.
- Very large directory (1000+ files): the picker should still work; search/filter is already built in.

### Requirement 1.4 — Preserve AI panel access to local path

Even after streaming logs into `allLogs`, the `localFilePath` should still be set so the AI panel can reference the original source path. This is important for the AI's tool use (e.g., `grep_log` tool on the original file).

**Implementation**: After stream completes successfully, set `localFilePath` to the session_file or path so the AI panel retains context.

### Requirement 1.5 — Loading and error states

- While streaming: show the same loading spinner used for upload streaming (via `loadingFile` state from `useLogStream`).
- On error: show the error alert (via `fileError` from `useLogStream`).
- Abort: the existing `abortParse` should work for directory streams too (via AbortController passed through `parseSelectedFilesStream`).

### Requirement 1.6 — `showFileUpload` logic update

After this feature, `showFileUpload` should still be true only when nothing at all is loaded:

```ts
const showFileUpload = allLogs.length === 0 && !traceResult && !localFilePath
```

Since local file loading will now populate `allLogs`, `showFileUpload` will naturally become `false` after loading. No change needed to the condition itself, but the behavior changes because `allLogs` is no longer empty after local path loading.

---

## Feature 2: 未上传/未选择本地路径时，不展示 Tabs

### Requirement 2.1 — Conditional Tabs rendering

**Current behavior**: Tabs are always rendered (lines 665–675). When `showFileUpload` is true, the "log" tab's children are `<FileUpload>`.

**Desired behavior**: When `showFileUpload` is true:
- The `<Tabs>` component and its tab bar are not rendered at all.
- The `<FileUpload>` widget is rendered directly in the center panel (same position, same props).
- The upload button (`tabBarExtra`) is also not rendered (since FileUpload is already the main content).

### Requirement 2.2 — Implementation approach

In the center panel render block (around line 664 of `App.tsx`):

```tsx
{/* Center: Log/Trace viewer */}
<Splitter.Panel style={{ overflow: 'hidden', minWidth: 300 }}>
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    {showFileUpload ? (
      <FileUpload
        onLogFiles={(files) => { void handleLogFiles(files) }}
        onTraceFile={(f) => { void handleTraceFile(f) }}
        onLocalFilePath={...}  /* or new callback */
        loading={isLoading}
        error={errorMessage}
        fileNames={fileNames}
      />
    ) : (
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'log' | 'trace')}
        items={tabItems}
        tabBarExtraContent={{ right: tabBarExtra }}
        style={{ height: '100%' }}
        tabBarStyle={{ margin: 0, padding: '0 12px', flexShrink: 0 }}
        renderTabBar={(props, DefaultTabBar) => (
          <DefaultTabBar {...props} style={{ marginBottom: 0 }} />
        )}
      />
    )}
  </div>
</Splitter.Panel>
```

### Requirement 2.3 — Local file placeholder removal

The existing local file placeholder view (lines 484–510 in App.tsx) will no longer be needed because local files are now streamed into `allLogs`. Remove the `localFilePath && allLogs.length === 0` branch from `tabItems`.

The three branches in the "log" tab become two:
1. `showFileUpload` → FileUpload (moved out of tabs entirely, see 2.2)
2. `!showFileUpload` → show LogViewer (or Empty state if no filters)

### Requirement 2.4 — Upload button visibility

The `tabBarExtra` (upload button) is only rendered when Tabs are rendered. Since Tabs are hidden when `showFileUpload` is true, the button naturally disappears in the empty state. When files are loaded and Tabs are visible, the button appears as before.

No additional logic needed — this falls out naturally from 2.2.

---

## Feature 3: 上传文件 button 交互优化

### Requirement 3.1 — Rename "更换文件" → "更新文件"

Update i18n keys:

| Language | Old Key | Old Value | New Key | New Value |
|---|---|---|---|---|
| zh | `changeFiles` | "更换文件" | `updateFiles` | "更新文件" |
| en | `changeFiles` | "Change Files" | `updateFiles` | "Update Files" |

**Note**: Keep the old `changeFiles` key in the locale files for backward compatibility (it may be used elsewhere), or audit all usages and replace. The task context says only `App.tsx` line 457 uses it. Safe to rename.

**Button text logic** (in `tabBarExtra`):

```tsx
{fileNames.length > 0 ? t('updateFiles') : t('uploadFiles')}
```

### Requirement 3.2 — Add "追加文件" (Append Files) functionality

When files are already loaded (`fileNames.length > 0`), the upload popover should offer **two** actions instead of one:

1. **更新文件 (Update/Replace)**: Replaces all existing logs. Calls `handleLogFiles` with the new files (current behavior — resets `allLogs`).
2. **追加文件 (Append)**: Adds new logs on top of existing ones without clearing the current dataset.

### Requirement 3.3 — Popover content redesign

**Current popover** (line 423–443): A single `<FileUpload compact>` widget. All file drops go through `handleLogFiles`.

**New popover** when files are already loaded:

```
┌─────────────────────────────────┐
│  Currently loaded:              │
│  📄 logcat.txt                  │
│  📄 kernel.log                  │
│                                 │
│  ─── Drop new files here ───    │
│  [Drag area / click to browse]  │
│                                 │
│  Mode:                          │
│  ○ 更新文件 (replace current)   │
│  ● 追加文件 (append to current) │
│                                 │
│  [       Load Files       ]     │
└─────────────────────────────────┘
```

**New popover** when no files are loaded: Same as current — single FileUpload compact widget.

### Requirement 3.4 — Append implementation in `useLogStream`

The `useLogStream` hook's `loadFromStream` currently resets `allLogs` to `[]` before streaming (line 62):

```ts
setAllLogs([])  // ← clears all existing logs
```

We need an `append` mode. Options:

**Option A**: Add an `append?: boolean` parameter to `loadFromStream`. When `true`, skip `setAllLogs([])`.

```ts
const loadFromStream = useCallback(
  async (streamFactory: StreamFactory, fileLabels: string[], append = false): Promise<boolean> => {
    // ...
    if (!append) {
      setAllLogs([])
    }
    setFileNames((prev) => append ? [...prev, ...fileLabels] : fileLabels)
    // ...
  },
  [],
)
```

**Option B**: Add a separate `appendToStream` method to `useLogStream`.

**Decision**: Option A. Simpler, less duplication, and the `append` flag is a natural parameter.

### Requirement 3.5 — Append file name tracking

When appending, the `fileNames` array should accumulate:

```ts
// Replace mode (existing behavior):
fileNames = ['new_file.log']

// Append mode (new behavior):
fileNames = ['existing.log', 'new_file.log']
```

This ensures the file list in the popover header reflects all loaded files.

### Requirement 3.6 — New i18n keys required

| Key | zh | en |
|---|---|---|
| `updateFiles` | "更新文件" | "Update Files" |
| `appendFiles` | "追加文件" | "Append Files" |
| `replaceMode` | "替换当前日志" | "Replace current logs" |
| `appendMode` | "追加到当前日志" | "Append to current logs" |
| `currentlyLoaded` | "当前已加载" | "Currently loaded" |
| `dropToUpdate` | "拖拽新文件以更新" | "Drop new files to update" |

---

## Acceptance Criteria

### Feature 1: Local file loading with filter support

- [ ] **AC1.1**: Entering a path to a single log file streams its content into `allLogs`, making the filter sidebar functional.
- [ ] **AC1.2**: Entering a path to a directory opens the `DirectoryFilePicker` modal with all log files pre-selected.
- [ ] **AC1.3**: User can select/deselect files in the picker and click "加载所选文件" to stream them into `allLogs`.
- [ ] **AC1.4**: After streaming, all five filter dimensions work: keywords, level, tag, pid, tid.
- [ ] **AC1.5**: Time range filter works on streamed local files.
- [ ] **AC1.6**: Loading spinner and error states are shown during local file streaming.
- [ ] **AC1.7**: `localFilePath` is still set after streaming (for AI panel context).
- [ ] **AC1.8**: Cancelling the directory picker returns to the FileUpload widget without side effects.
- [ ] **AC1.9**: Aborting an in-progress local stream works via the existing abort mechanism.
- [ ] **AC1.10**: Zero regression on existing upload flow (drag-and-drop, multipart upload).

### Feature 2: Hide Tabs when empty

- [ ] **AC2.1**: When no files are loaded (`showFileUpload === true`), the Tabs bar is not visible.
- [ ] **AC2.2**: The FileUpload widget is rendered directly in the center panel (full size, not inside a tab).
- [ ] **AC2.3**: The upload button (tabBarExtra) is hidden when Tabs are hidden.
- [ ] **AC2.4**: After files are loaded, Tabs appear with the log viewer (existing behavior preserved).
- [ ] **AC2.5**: The local file placeholder view ("📂 本地文件已就绪") is removed.

### Feature 3: Upload button UX

- [ ] **AC3.1**: The button says "更新文件" (zh) / "Update Files" (en) when files are loaded.
- [ ] **AC3.2**: When files are loaded, the popover shows both "更新文件" (replace) and "追加文件" (append) as radio options.
- [ ] **AC3.3**: Selecting "更新文件" and uploading replaces all existing logs (current behavior).
- [ ] **AC3.4**: Selecting "追加文件" and uploading adds new logs to the existing dataset.
- [ ] **AC3.5**: `fileNames` accumulates correctly in append mode.
- [ ] **AC3.6**: When no files are loaded, the popover shows the standard single upload widget (no mode selection needed).

---

## Technical Constraints

1. **All changes additive** — do not break the existing drag-and-drop upload flow.
2. **Conventional commits**: `feat:`, `fix:`, `refactor:` prefixes.
3. **Prettier formatting**: No semicolons, single quotes, 2-space indent.
4. **Zero regression**: Existing 191 tests must continue to pass.
5. **Backend API**: The backend endpoints `POST /logs/directory/parse/stream` and `POST /logs/directory/parse/selected/stream` already exist. For single-file local streaming, confirm whether `POST /logs/parse/stream` accepts a `path` parameter, or a new endpoint is needed.

---

## Open Questions

1. **Single-file streaming endpoint**: Does `POST /logs/parse/stream` support a `path` body parameter for local files, or do we need a new endpoint (e.g., `POST /logs/file/parse/stream`)? The existing `parseLogStream` in `api/logs.ts` only sends files as multipart. This needs backend verification.

2. **`useLogStream.loadFromStream` append signature**: Confirm that adding an optional `append?: boolean` parameter is the cleanest approach. Alternatively, a separate method `appendToStream` may be more explicit.

3. **FileUpload component split**: Should the popover FileUpload and the full-page FileUpload share the same instance? They currently have different `compact` prop values. The append/replace mode selector may need to be handled differently in compact vs full mode.

4. **Directory picker re-entry**: If the user navigates to a directory, cancels the picker, and then enters the same path again, should the picker reopen? Current behavior would re-call `autoPath` and reopen — acceptable.

---

## Out of Scope

- Server-side filtering optimization (all filtering remains client-side).
- Drag-and-drop of local directories in the browser.
- Multi-selection of individual local files (only directory → picker flow).
- Persisting the append/replace preference across sessions.

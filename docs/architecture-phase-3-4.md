# Architecture: Phase 3 (Test Infrastructure) + Phase 4 (Feature Enhancements)

- **Version**: 1.0.0
- **Date**: 2026-05-05
- **Based on**: `docs/requirements-phase-3-4.md` v1.0.0
- **Codebase snapshot**: v2.0.1

---

## Table of Contents

1. [Phase 3 — Test Infrastructure](#phase-3--test-infrastructure)
   - [3.1 Vitest Configuration](#31-vitest-configuration)
   - [3.2 TypeScript Configuration for Tests](#32-typescript-configuration-for-tests)
   - [3.3 Test File Structure](#33-test-file-structure)
   - [3.4 SSE Chunk Processing Extraction](#34-sse-chunk-processing-extraction)
   - [3.5 Playwright E2E Configuration](#35-playwright-e2e-configuration)
2. [Phase 4 — Feature Enhancement Architecture](#phase-4--feature-enhancement-architecture)
   - [4.1 US-FE1: AI Tool Results in LogViewer](#41-us-fe1-ai-tool-results-in-logviewer)
   - [4.2 US-FE2: ToolResultCache (LRU + TTL)](#42-us-fe2-toolresultcache-lru--ttl)
   - [4.3 US-FE3: scan_file_meta Early Exit](#43-us-fe3-scan_file_meta-early-exit)
   - [4.4 US-FE4: CSV/JSON Export](#44-us-fe4-csvjson-export)

---

## Phase 3 — Test Infrastructure

### 3.1 Vitest Configuration

**New file**: `frontend/vitest.config.ts`

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,            // Describe, it, expect globally available
    include: ['src/**/*.test.{ts,tsx}'],
    // Optional Phase 3 coverage (NFR-3, P2):
    // coverage: {
    //   provider: 'v8',
    //   include: ['src/**/*.{ts,tsx}'],
    //   exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    // },
  },
})
```

**Rationale**:
- `environment: 'jsdom'` — Required for `detectFileTypeByHeader` tests (mock `File.slice()`, `arrayBuffer()`, `TextDecoder`), SSE parser tests, and any DOM-adjacent utility tests.
- `globals: true` — Matches common Vitest convention and reduces boilerplate imports. Testing Library matchers (`@testing-library/jest-dom`) also rely on globals.
- Test file matching `src/**/*.test.{ts,tsx}` — Colocated with source files under `__tests__/` directories, following the project's requirement.

**Dependency additions** to `frontend/package.json` `devDependencies`:

| Package | Version Constraint | Purpose |
|---|---|---|
| `vitest` | `^3.1.0` (latest 3.x) | Test runner |
| `@testing-library/react` | `^16.3.0` | React component rendering in tests |
| `@testing-library/jest-dom` | `^6.6.0` | DOM matchers (`.toBeInTheDocument()`, etc.) |
| `@testing-library/user-event` | `^14.6.0` | Simulate user interactions |
| `jsdom` | `^26.0.0` | DOM environment for non-browser tests |

**Script additions** to `frontend/package.json`:

```jsonc
"test": "vitest run",
"test:watch": "vitest"
```

**Vitest setup file** (`frontend/vitest.setup.ts`):

```ts
import '@testing-library/jest-dom/vitest'
```

This is referenced in `vitest.config.ts` via `setupFiles: ['./vitest.setup.ts']` to ensure DOM matchers are available in all test files without per-file imports.

---

### 3.2 TypeScript Configuration for Tests

**Decision**: Create `frontend/tsconfig.test.json` (separate from `tsconfig.app.json`) to avoid polluting the production build with test files.

**New file**: `frontend/tsconfig.test.json`

```jsonc
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.test.ts", "src/**/*.test.tsx", "vitest.setup.ts", "vitest.config.ts"]
}
```

**Rationale**:
- Extends `tsconfig.app.json` (same strictness, same JSX transform, same module resolution).
- `types: ["vitest/globals"]` — Makes `describe`, `it`, `expect`, `vi` available as global types (matching `globals: true` in vitest config).
- Separate `tsBuildInfoFile` — Prevents project reference conflicts with the app build.
- Does **not** modify `tsconfig.app.json` `include` — test files are excluded from the production `tsc -b` build, keeping the build artifact clean.

**No changes needed to `tsconfig.json`** (root references). The test tsconfig is for editor tooling only, not part of the build pipeline. Developers run `tsc --noEmit -p tsconfig.test.json` or rely on Vitest's built-in type checking.

---

### 3.3 Test File Structure

```text
frontend/src/
├── __tests__/
│   └── App.test.ts                        # US-FT4: applyFiltersClient, computeStatistics, hasFilterConditions
├── components/
│   ├── __tests__/
│   │   ├── FileUpload.test.ts             # US-FT2: detectFileTypeByHeader
│   │   ├── AiPanel.test.ts                # US-FT3: processSSEChunk
│   │   └── LogViewer.test.ts              # US-FE4: generateCSV, generateJSON (Phase 4)
│   ├── FileUpload.tsx
│   ├── AiPanel.tsx
│   └── LogViewer.tsx

e2e/                                        # US-FT5: Playwright E2E
├── playwright.config.ts
├── smoke.spec.ts                           # AC3: Page load, Header, FileUpload, backend warning
├── upload.spec.ts                          # AC4: Upload → parse → LogViewer table + AppSider
└── chat.spec.ts                            # AC5: AI panel input → message appears
```

---

### 3.4 SSE Chunk Processing Extraction

**Current state** (`AiPanel.tsx` lines 475–575):

The SSE chunk processing is a `for-await` loop inside `handleSend()` that:
1. Checks `chunk === '[DONE]'` → break
2. Fast-path: `!chunk.startsWith('{')` → append as text
3. `JSON.parse(chunk)` → dispatch by `type` field (thinking, tool_call, tool_result, max_rounds_reached, agent_meta)
4. OpenAI delta format: `choices[0].delta.content`
5. `catch` → treat as plain text fallback

**Target state**: Extract into a pure function so it can be unit-tested without React, component state, or DOM.

#### 3.4.1 New module: `frontend/src/utils/sseParser.ts`

```ts
// sseParser.ts — Pure SSE chunk processing, no React dependency

import type { AgentEvent, ToolCallEvent, ToolResultEvent, ThinkingEvent, MaxRoundsReachedEvent } from '../types'

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool'; call: ToolCallInfo }
  | { type: 'thinking'; content: string }

export interface SSEParseState {
  parts: MessagePart[]
  accumulated: string        // Plain text accumulator for session storage
  continueMessage: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────

function appendText(parts: MessagePart[], delta: string): MessagePart[] {
  const last = parts[parts.length - 1]
  if (last?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', content: last.content + delta }]
  }
  return [...parts, { type: 'text', content: delta }]
}

// ── Core processor ───────────────────────────────────────────────────────

export function processSSEChunk(chunk: string, state: SSEParseState): SSEParseState {
  // [DONE] signal — no change (caller handles loop termination)
  if (chunk === '[DONE]') return state

  // Fast path: plain text chunks (95%+ of events) skip JSON.parse
  if (!chunk.startsWith('{')) {
    return {
      ...state,
      accumulated: state.accumulated + chunk,
      parts: appendText(state.parts, chunk),
    }
  }

  try {
    const data = JSON.parse(chunk) as AgentEvent | Record<string, unknown>

    // ── Structured event types ───────────────────────────────────────────

    if ('type' in data && data.type === 'thinking') {
      return {
        ...state,
        parts: [...state.parts, { type: 'thinking', content: (data as ThinkingEvent).content }],
      }
    }

    if ('type' in data && data.type === 'tool_call') {
      const event = data as ToolCallEvent
      return {
        ...state,
        parts: [
          ...state.parts,
          { type: 'tool', call: { name: event.name, arguments: event.arguments } },
        ],
      }
    }

    if ('type' in data && data.type === 'tool_result') {
      const event = data as ToolResultEvent
      // Match most recent unresolved tool by name (reverse search)
      const idx = [...state.parts]
        .reverse()
        .findIndex((p) => p.type === 'tool' && p.call.name === event.name && !p.call.result)
      if (idx !== -1) {
        const realIdx = state.parts.length - 1 - idx
        const updated = [...state.parts]
        updated[realIdx] = {
          type: 'tool',
          call: {
            ...(state.parts[realIdx] as { type: 'tool'; call: ToolCallInfo }).call,
            result: event.content,
          },
        }
        return { ...state, parts: updated }
      }
      return state
    }

    if ('type' in data && data.type === 'max_rounds_reached') {
      return { ...state, continueMessage: (data as MaxRoundsReachedEvent).message }
    }

    // agent_meta — silently discard
    if ('type' in data && data.type === 'agent_meta') {
      return state
    }

    // ── OpenAI-compatible delta extraction ────────────────────────────────
    const delta =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).choices?.[0]?.delta?.content ||
      (data as Record<string, unknown>).content ||
      chunk

    if (typeof delta === 'string' && delta) {
      return {
        accumulated: state.accumulated + delta,
        parts: appendText(state.parts, delta),
        continueMessage: state.continueMessage,
      }
    }

    return state
  } catch {
    // JSON.parse failed — treat chunk as plain text
    return {
      accumulated: state.accumulated + chunk,
      parts: appendText(state.parts, chunk),
      continueMessage: state.continueMessage,
    }
  }
}

// ── Initial state factory ────────────────────────────────────────────────

export function createSSEState(): SSEParseState {
  return { parts: [], accumulated: '', continueMessage: null }
}
```

#### 3.4.2 AiPanel.tsx refactoring

The `handleSend` function will be refactored to use `processSSEChunk`:

```ts
// Inside handleSend(), replace lines 461–575:
import { processSSEChunk, createSSEState } from '../utils/sseParser'

// ...
let state = createSSEState()

const updateMsg = (p: MessagePart[]) => {
  setMessages((prev) => {
    const updated = [...prev]
    const textContent = p
      .filter((x) => x.type === 'text')
      .map((x) => (x as { type: 'text'; content: string }).content)
      .join('')
    updated[updated.length - 1] = { role: 'assistant', content: textContent, parts: p }
    return updated
  })
}

for await (const chunk of sendMessage(/* ... */)) {
  if (chunk === '[DONE]') break
  state = processSSEChunk(chunk, state)
  updateMsg(state.parts)
  if (state.continueMessage) {
    setContinueMessage(state.continueMessage)
  }
}
// ...
```

**Key design decisions**:
- Pure function with immutable state — every call returns a new `SSEParseState`. This makes testing trivial: call with known input, assert on returned state.
- The `updateMsg` callback and `setContinueMessage` side effects remain in AiPanel (they need React state). The parser doesn't know about React.
- `[DONE]` is NOT handled inside `processSSEChunk` — it returns the state unchanged, and the caller checks for it. This keeps the function truly stateless about stream lifecycle.

#### 3.4.3 AiPanel.test.ts test coverage plan

The test file (`frontend/src/components/__tests__/AiPanel.test.ts`) will test `processSSEChunk` with these scenarios:

| # | Test Case | Input | Expected State Change |
|---|---|---|---|
| AC2 | Plain text chunk | `"Hello world"` | `parts` gains text part, `accumulated` extends |
| AC3 | thinking event | `{"type":"thinking","content":"..."}` | `parts` gains thinking block |
| AC4 | tool_call event | `{"type":"tool_call","name":"search","arguments":"{}"} ` | `parts` gains tool block (no result) |
| AC5 | tool_result event (match) | `{"type":"tool_result","name":"search","content":"..."}` | Matching tool block gets `result` populated |
| AC6 | max_rounds_reached | `{"type":"max_rounds_reached","message":"..."}` | `continueMessage` set |
| AC7 | agent_meta | `{"type":"agent_meta",...}` | State unchanged (silent discard) |
| AC8 | OpenAI delta | `{"choices":[{"delta":{"content":"hi"}}]}` | Text appended |
| AC9 | [DONE] signal | `"[DONE]"` | State unchanged |
| AC10 | Multiple text chunks | `"Hello "` then `"world"` | Single text part with `"Hello world"` |
| AC11 | tool_call + tool_result pairing | Call then result | Result attached to correct tool by name |
| AC12 | JSON.parse failure | `"{invalid"` | Treated as plain text |

All tests call `processSSEChunk` directly — no React rendering needed.

---

### 3.5 Playwright E2E Configuration

**New file**: `e2e/playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'cd ../backend && poetry run uvicorn ala.main:app --host 0.0.0.0 --port 8000',
      port: 8000,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'cd .. && npm run dev',   // or 'cd ../frontend && npm run dev'
      port: 5173,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
```

**Design notes**:
- **Single browser**: Chromium only for CI efficiency (NFR-2: ≤ 120s). Cross-browser testing can be added later.
- **`reuseExistingServer`**: In local dev, reuses already-running servers. In CI (`process.env.CI`), always starts fresh.
- **`webServer` auto-start**: Both backend (FastAPI on 8000) and frontend (Vite on 5173) started by Playwright. No need for separate `start-server-and-test`.
- **Test project separation**: Each spec file lives in `e2e/` as a standalone `.spec.ts`.

**E2E test files**:

| File | Coverage | Key Assertions |
|---|---|---|
| `e2e/smoke.spec.ts` | AC3 | Page loads, Header rendered (title visible), FileUpload dropper area rendered, "unconnected backend" warning visible |
| `e2e/upload.spec.ts` | AC4 | Upload a fixture log file → wait for parse → verify table rows appear in LogViewer, AppSider shows filters + stats |
| `e2e/chat.spec.ts` | AC5 | Precondition: AI configured (or mock). Type message in AiPanel → send → verify assistant response bubble appears |

**E2E script addition** to `frontend/package.json`:

```jsonc
"test:e2e": "playwright test --config ../e2e/playwright.config.ts"
```

---

## Phase 4 — Feature Enhancement Architecture

### 4.1 US-FE1: AI Tool Results in LogViewer

#### 4.1.1 Data Flow

```text
Backend SSE stream
    │
    ▼
AiPanel (handleSend / processSSEChunk)
    │ tool_result with name="search_local_log" or "read_log_range"
    │ → parse content JSON → extract .entries[]
    │ → callback: onLazyToolEntries(entries)
    ▼
App.tsx (AppContent)
    │ state: lazyToolEntries: LogEntry[]
    │ passes to LogViewer via props
    ▼
LogViewer
    │ When localFilePath is set AND lazyToolEntries has data:
    │ → render lazy tool entries in virtual table
    │ When lazyToolEntries is empty:
    │ → show "AI tool hasn't returned log entries yet"
    │ When localFilePath is null:
    │ → normal upload-based rendering (unchanged)
```

#### 4.1.2 Type Changes

**`frontend/src/types/index.ts`** — No changes needed to `LogEntry`. The backend already returns entries with matching fields: `line_number`, `timestamp`, `level`, `tag`, `pid`, `tid`, `message`. The `source_file` field is the only one not returned by `search_local_log` / `read_log_range` in the current code (see `agent_tools.py` lines 757–767 and 805–815). We will add `source_file` to the backend tool responses for consistency.

**Backend change** (`agent_tools.py`): In `_execute_lazy_log_tool`, add `"source_file": entry.source_file` to the entry dicts returned by `search_local_log`, `read_log_range`, and `tail_local_log`. Currently these omit `source_file` but the `LogEntry` dataclass has it; it just wasn't serialized.

#### 4.1.3 Component Changes

**AiPanel.tsx** — New prop and logic:

```ts
interface AiPanelProps {
  // ... existing props ...
  onLazyToolEntries?: (entries: LogEntry[]) => void  // NEW
}
```

Inside `handleSend`, after `processSSEChunk` returns a state with a tool_result part:

```ts
// After processSSEChunk or inside the for-await:
// (extracted as a separate pure helper in sseParser.ts)
export function extractToolLogEntries(toolName: string, content: string): LogEntry[] {
  if (toolName !== 'search_local_log' && toolName !== 'read_log_range') return []
  try {
    const parsed = JSON.parse(content)
    if (parsed.entries && Array.isArray(parsed.entries)) {
      return parsed.entries as LogEntry[]
    }
  } catch { /* ignore parse failures */ }
  return []
}
```

In AiPanel, after a tool_result is attached to a tool part, call:

```ts
const entries = extractToolLogEntries(event.name, event.content)
if (entries.length > 0) {
  onLazyToolEntries?.(entries)
}
```

**App.tsx** — New state and wiring:

```ts
// New state (alongside existing state declarations, ~line 169):
const [lazyToolEntries, setLazyToolEntries] = useState<LogEntry[]>([])

// In AiPanel props (currently ~line 643):
<AiPanel
  // ... existing props ...
  onLazyToolEntries={(entries) => {
    setLazyToolEntries((prev) => {
      // Deduplicate by line_number + source_file, merge
      const seen = new Set(prev.map((e) => `${e.line_number}:${e.source_file ?? ''}`))
      const newEntries = entries.filter((e) => !seen.has(`${e.line_number}:${e.source_file ?? ''}`))
      return [...prev, ...newEntries]
    })
  }}
/>
```

**LogViewer.tsx** — New props and rendering:

```ts
interface LogViewerProps {
  // ... existing props ...
  lazyToolEntries?: LogEntry[]       // NEW: Phase 4 FE1
  localFilePath?: string | null      // NEW: controls lazy mode vs upload mode
}
```

Rendering logic (pseudocode):

```text
if (localFilePath && lazyToolEntries?.length) {
  → render lazyToolEntries in table (same columns as upload mode)
  → toolbar shows "AI Tool Results: {count} entries" instead of "filteredCount"
} else if (localFilePath && !lazyToolEntries?.length) {
  → Empty state: "AI tools haven't returned log entries yet. Try asking the AI..."
} else {
  → existing upload-mode rendering (unchanged)
}
```

**Filter integration (AC7)**: When `lazyToolEntries` are displayed, they pass through `applyFiltersClient` before reaching LogViewer. This is handled in App.tsx:

```ts
const filteredLazyEntries = useMemo(
  () => (lazyToolEntries.length > 0 ? applyFiltersClient(lazyToolEntries, debouncedFilters) : []),
  [lazyToolEntries, debouncedFilters],
)
```

And passed to LogViewer. When `lazyToolEntries` is the data source, statistics are computed from `filteredLazyEntries`.

#### 4.1.4 State Reset Logic

`lazyToolEntries` must be cleared when:
- `localFilePath` changes (already handled by the effect that clears `localFilePath` on project/trace change)
- A new AI session starts (handled via `selectedProjectId` change effect)
- File upload occurs (existing `handleLogFiles` sets `localFilePath` to null)

---

### 4.2 US-FE2: ToolResultCache (LRU + TTL)

#### 4.2.1 Class Design

**New code in** `backend/src/ala/services/agent_tools.py`:

```python
import time
from collections import OrderedDict
from dataclasses import dataclass, field


@dataclass
class _CacheEntry:
    """A single entry in the tool result cache."""
    result: str          # JSON string (the tool return value)
    cached_at: float     # time.monotonic() when cached


class ToolResultCache:
    """LRU cache with TTL for lazy-log tool results.

    Design decisions
    ─────────────────
    1. **OrderedDict for LRU** — Python's OrderedDict maintains insertion order
       and supports ``move_to_end()`` for O(1) access-time updates.  ``popitem(last=False)``
       evicts the least-recently-used entry in O(1).

    2. **TTL via time.monotonic()** — `time.monotonic()` is used instead of
       `time.time()` because it is unaffected by system clock changes (NTP,
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
        import json
        import os

        # Canonicalize args: sort keys, use JSON with sorted keys
        canonical = json.dumps(args, sort_keys=True, default=str)
        try:
            mtime = os.path.getmtime(resolved_path)
        except OSError:
            mtime = 0.0

        return f"{tool_name}:{resolved_path}:{canonical}:{mtime}"
```

#### 4.2.2 Integration with `_execute_lazy_log_tool`

A module-level cache instance is created:

```python
_lazy_tool_cache = ToolResultCache(max_size=128, ttl_seconds=60.0)
```

In `_execute_lazy_log_tool`, before the actual file streaming logic, add a cache check:

```python
def _execute_lazy_log_tool(tool_name: str, args: dict, file_path: str) -> str:
    t_start = time.monotonic()
    logger.debug("tool=%s file=%s args=%s", tool_name, file_path, args)

    # ── list_directory_logs — never cached ──────────────────────────────
    if tool_name == "list_directory_logs":
        # ... existing logic, no cache ...
        pass

    # Resolve target path
    resolved = _resolve_log_path(file_path, args)
    if not resolved:
        # ... existing error handling ...

    # ── Cache lookup (skip for overview_local_log when max_lines used) ──
    # Cache only: overview (no max_lines), search, read_range, tail
    cacheable = tool_name in (
        "overview_local_log", "search_local_log", "read_log_range", "tail_local_log"
    )
    # For overview_local_log with explicit max_lines, don't cache
    # (max_lines is a sampling parameter — results are non-deterministic)
    if cacheable and not (
        tool_name == "overview_local_log" and args.get("max_lines") is not None
    ):
        cache_key = ToolResultCache.build_key(tool_name, resolved, args)
        cached = _lazy_tool_cache.get(cache_key)
        if cached is not None:
            logger.debug("tool=%s cache hit key=%s", tool_name, cache_key[:80])
            return cached

    # ── Execute tool (existing logic) ────────────────────────────────────
    result = ...  # existing tool execution

    # ── Store in cache ────────────────────────────────────────────────────
    if cacheable and not (
        tool_name == "overview_local_log" and args.get("max_lines") is not None
    ):
        _lazy_tool_cache.set(cache_key, result)

    return result
```

**Non-cacheable tools**:
- `list_directory_logs` — Directory listings change in real time; caching would return stale file lists.
- `overview_local_log` with `max_lines` — The `max_lines` parameter produces non-deterministic sampling results. Caching would return incorrect truncated overviews.

#### 4.2.3 Cache Configuration

The cache parameters (`max_size=128`, `ttl_seconds=60.0`) are hardcoded constants at the module level. If future requirements demand configurability, they can be moved to `config.py` `Settings` and read via `settings.lazy_tool_cache_size` / `settings.lazy_tool_cache_ttl`.

#### 4.2.4 Test Plan

In `backend/tests/test_lazy_log.py`, add a `TestToolResultCache` class:

| Test | Description |
|---|---|
| `test_cache_hit` | Cache same key twice → second call returns cached result |
| `test_cache_miss_different_args` | Different args → different keys → no cross-contamination |
| `test_cache_expiry` | Store entry, advance `time.monotonic` (via `unittest.mock.patch('time.monotonic')`) past TTL → `get()` returns None |
| `test_cache_eviction` | Fill cache beyond max_size → oldest (LRU) entry evicted |

---

### 4.3 US-FE3: scan_file_meta Early Exit

#### 4.3.1 Signature Change

**`log_analyzer.py` — `scan_file_meta` method:**

```python
def scan_file_meta(self, file_path: str, max_scan_lines: int | None = None) -> FileRef:
    """Scan a local log file and return metadata without parsing entries.

    Args:
        file_path: Path to the log file.
        max_scan_lines: If set, stop counting after this many lines.
                        Format detection still uses the first 10 lines.
    """
```

**`FileRef` data class — new field:**

```python
@dataclass
class FileRef:
    path: str
    line_count: int
    size_bytes: int
    format_detected: str
    is_gzip: bool = False
    is_zip: bool = False
    truncated: bool = False  # NEW: True when scan stopped early due to max_scan_lines
```

#### 4.3.2 Implementation Logic

Inside `scan_file_meta`, after the ZIP vs non-ZIP branching, add an early exit check:

```python
# Inside the line-counting loop (for both ZIP and non-ZIP paths):
for raw_line in fh:
    line_count += 1
    stripped = raw_line.strip()
    if stripped and len(sample_lines) < 10:
        sample_lines.append(stripped)

    # Early exit: stop counting after max_scan_lines
    if max_scan_lines is not None and line_count >= max_scan_lines:
        truncated = True
        break
else:
    truncated = False  # completed full scan

# ... format detection from sample_lines ...

return FileRef(
    path=validated,
    line_count=line_count,
    size_bytes=file_stat.st_size,
    format_detected=format_detected,
    is_gzip=is_gzip,
    is_zip=is_zip,
    truncated=truncated,
)
```

**Key constraint**: Format detection always uses the first 10 lines collected before the early exit. The `max_scan_lines` minimum is effectively 10 (fewer lines means no format detected), but the `autoPath` endpoint passes 50000, which is far above.

#### 4.3.3 Caller Impact Analysis

**Callers of `scan_file_meta`**:

| Caller | File | Impact |
|---|---|---|
| `POST /api/logs/parse-local` | `logs.py:145` | No change — the new `truncated` field is returned in `LocalPathResponse`. Add `truncated` field to response model. |
| `POST /api/logs/auto-path` | `logs.py:189` | **Requires change** — pass `max_scan_lines=50000`. Add `truncated` to `AutoPathResponse`. |
| Tests | `test_lazy_log.py` | Add tests with `max_scan_lines=100` to verify early exit. |

**Pydantic model changes**:

```python
class LocalPathResponse(BaseModel):
    # ... existing fields ...
    truncated: bool = False  # NEW

class AutoPathResponse(BaseModel):
    # ... existing fields ...
    truncated: bool | None = None  # NEW (None when type="directory")
```

#### 4.3.4 `autoPath` Endpoint Change

```python
# In auto_path endpoint, when os.path.isfile(path):
ref = _analyzer.scan_file_meta(validated, max_scan_lines=50000)
# ...
return AutoPathResponse(
    type="file",
    # ... existing fields ...
    truncated=ref.truncated,  # NEW
)
```

#### 4.3.5 Test Plan

In `backend/tests/test_lazy_log.py`:

| Test | Description |
|---|---|
| `test_scan_file_meta_early_exit` | Create temp file with 1000 lines, call `scan_file_meta(path, max_scan_lines=100)` → `line_count=100`, `truncated=True` |
| `test_scan_file_meta_full_scan` | Same file, `max_scan_lines=None` (default) → `line_count=1000`, `truncated=False` |
| `test_scan_file_meta_truncated_flag` | Verify `FileRef.truncated` field is present and correct in both truncated and non-truncated cases |

---

### 4.4 US-FE4: CSV/JSON Export

#### 4.4.1 New Utility Module

**New file**: `frontend/src/utils/export.ts`

```ts
import type { LogEntry } from '../types'

// ── CSV Export ─────────────────────────────────────────────────────────────

const CSV_COLUMNS: (keyof LogEntry)[] = [
  'line_number',
  'timestamp',
  'level',
  'tag',
  'pid',
  'tid',
  'message',
]

/**
 * Escape a CSV field per RFC 4180:
 * - If the value contains comma, double-quote, or newline, wrap in double quotes
 *   and escape internal double-quotes by doubling them.
 */
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function generateCSV(logs: LogEntry[]): string {
  const header = CSV_COLUMNS.join(',')
  const rows = logs.map((log) => CSV_COLUMNS.map((col) => csvEscape(log[col])).join(','))
  // BOM prefix for Excel UTF-8 compatibility
  return '\uFEFF' + [header, ...rows].join('\n') + '\n'
}

// ── JSON Export ────────────────────────────────────────────────────────────

export function generateJSON(logs: LogEntry[]): string {
  return JSON.stringify(logs, null, 2)
}

// ── Download Helper ────────────────────────────────────────────────────────

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Release after a tick to ensure the download starts
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function generateExportFilename(format: 'csv' | 'json'): string {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `ala-export-${date}.${format}`
}
```

#### 4.4.2 LogViewer Changes

New toolbar buttons added to the existing toolbar div (currently lines 258–276):

```tsx
// Inside LogViewer, after the "filteredCount" text:

{/* Export buttons */}
<Tooltip title={logs.length === 0 ? t('noDataToExport') : undefined}>
  <Button
    size="small"
    icon={<DownloadOutlined />}
    disabled={logs.length === 0}
    onClick={() => {
      const csv = generateCSV(logs)
      downloadBlob(csv, generateExportFilename('csv'), 'text/csv;charset=utf-8')
    }}
  >
    CSV
  </Button>
</Tooltip>
<Tooltip title={logs.length === 0 ? t('noDataToExport') : undefined}>
  <Button
    size="small"
    icon={<DownloadOutlined />}
    disabled={logs.length === 0}
    onClick={() => {
      const json = generateJSON(logs)
      downloadBlob(json, generateExportFilename('json'), 'application/json;charset=utf-8')
    }}
  >
    JSON
  </Button>
</Tooltip>
```

**Important**: The export operates on the `logs` prop of LogViewer, which is already `filteredLogs` as passed from App.tsx (AC6: only export filtered logs). This prevents accidental export of unfiltered data.

#### 4.4.3 Test Plan

New file: `frontend/src/components/__tests__/LogViewer.test.ts`

| Test | Description |
|---|---|
| `test_generateCSV_basic` | 2 log entries → verify header row + 2 data rows + BOM |
| `test_generateCSV_special_chars` | Entry with commas, quotes, newlines → verify RFC 4180 escaping |
| `test_generateJSON_basic` | 2 entries → valid JSON array with 2-space indent |
| `test_generateJSON_empty` | Empty array → `"[]"` |
| `test_downloadBlob` | Mock `URL.createObjectURL` and `document.createElement` → verify called |
| `test_export_buttons_disabled_when_empty` | Render LogViewer with `logs=[]` → export buttons have `disabled` attribute |

---

## Appendix A: File Change Summary

| File | Action | Phase |
|---|---|---|
| `frontend/package.json` | Modify: add devDependencies, scripts | 3 |
| `frontend/vitest.config.ts` | **Create** | 3 |
| `frontend/vitest.setup.ts` | **Create** | 3 |
| `frontend/tsconfig.test.json` | **Create** | 3 |
| `frontend/src/utils/sseParser.ts` | **Create** (extracted from AiPanel) | 3 |
| `frontend/src/utils/export.ts` | **Create** | 4 |
| `frontend/src/components/AiPanel.tsx` | Modify: use `processSSEChunk`, add `onLazyToolEntries` prop | 3+4 |
| `frontend/src/components/FileUpload.tsx` | No changes (tests only) | 3 |
| `frontend/src/components/LogViewer.tsx` | Modify: add export buttons, lazy tool entries display | 4 |
| `frontend/src/App.tsx` | Modify: add `lazyToolEntries` state, wire through props | 4 |
| `frontend/src/types/index.ts` | No changes needed (LogEntry already compatible) | 4 |
| `frontend/src/components/__tests__/FileUpload.test.ts` | **Create** | 3 |
| `frontend/src/components/__tests__/AiPanel.test.ts` | **Create** | 3 |
| `frontend/src/__tests__/App.test.ts` | **Create** | 3 |
| `frontend/src/components/__tests__/LogViewer.test.ts` | **Create** | 4 |
| `e2e/playwright.config.ts` | **Create** | 3 |
| `e2e/smoke.spec.ts` | **Create** | 3 |
| `e2e/upload.spec.ts` | **Create** | 3 |
| `e2e/chat.spec.ts` | **Create** | 3 |
| `backend/src/ala/services/agent_tools.py` | Modify: add `ToolResultCache`, integrate into `_execute_lazy_log_tool`, add `source_file` to tool result entries | 4 |
| `backend/src/ala/services/log_analyzer.py` | Modify: `scan_file_meta` adds `max_scan_lines` param, `FileRef` adds `truncated` field | 4 |
| `backend/src/ala/api/logs.py` | Modify: `AutoPathResponse` adds `truncated`, `LocalPathResponse` adds `truncated`, `autoPath` passes `max_scan_lines=50000` | 4 |
| `backend/tests/test_lazy_log.py` | Modify: add `ToolResultCache` tests + `scan_file_meta` early-exit tests | 4 |

## Appendix B: Non-Functional Requirement Mapping

| NFR | How Addressed |
|---|---|
| NFR-1: Unit tests ≤ 30s | Pure function testing (no DOM) for SSE parser + filters. Vitest with native ESM is fast. |
| NFR-2: E2E ≤ 120s | Single browser (Chromium), 3 focused spec files, `reuseExistingServer` in local dev. |
| NFR-3: Coverage reports | `@vitest/coverage-v8` available; `vitest --coverage` generates reports (P2, optional). |
| NFR-4: LRU cache O(1) | `OrderedDict` provides O(1) `move_to_end()`, `popitem(last=False)`, `__setitem__`, `__getitem__`. TTL check is O(1) per lookup. |
| NFR-5: scan ≤ 2s for 100MB | `max_scan_lines=50000` limits I/O. Line counting is a tight C-level loop; 50K lines ≈ 0.5–1.5s even on HDD. |
| NFR-6: Export ≤ 500ms for 10K | String building in pure JS is fast; 10K entries ≈ 100–200ms. `URL.createObjectURL` + download is synchronous browser API (no async I/O). |
| NFR-7: Linting zero warnings | All new code uses Prettier + ESLint + TypeScript strict + Ruff. Configs already in place. |
| NFR-8: Existing tests pass | All backend changes are additive (new params with defaults). No existing API contract changes. |

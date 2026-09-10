# AGENTS.md — ALA (Android Log Analyzer)

## Project Overview

ALA is a full-stack, AI-powered analyzer for Android diagnostics data. Despite the name it
handles five data domains plus structured crash artifacts:

- **Android logcat** logs — plain text, `.gz`, `.zip`, `.rar`, `.7z`
- **Network captures** — `.pcap` / `.pcapng` (parsed with `scapy`)
- **Bluetooth HCI snoop** logs — BTSnoop format
- **Perfetto traces** — `.pb` (TraceProcessor) and JSON / legacy varint
- **Structured diagnostics** — ANR traces and native crash tombstones

The same core logic is exposed through two front ends:

- A **Web app**: FastAPI backend + React SPA, with a built-in agentic AI assistant and an
  embedded MCP server.
- A **CLI** (`ala`, Typer + Rich) for headless log inspection.

- **Backend**: Python 3.12+ FastAPI + FastMCP, managed with Poetry (`backend/`)
- **Frontend**: React 19 + Vite 6 + Ant Design 6 + TypeScript 5 (`frontend/`)
- **Repository**: monorepo at `https://github.com/kagawagao/ala`, license MIT
- **Version**: 2.4.1

## Repository Layout

```
ala/
├── AGENTS.md                   # This file
├── CLAUDE.md                   # Claude Code guidance (overlaps with this file)
├── README.md                   # User-facing docs (features, quick start, API ref)
├── CHANGELOG.md                # Auto-generated via Conventional Commits
├── LICENSE
├── package.json                # Workspace root (npm scripts, prettier, husky, commitlint)
├── docker-compose.yml          # Production Docker (backend :8000 + frontend Nginx :80)
├── .prettierrc.json            # Formatter config (see Code Style below)
├── .prettierignore
├── commitlint.config.mjs       # Extends @commitlint/config-conventional
├── skills-lock.json            # Lockfile for project-agent-skills (see Agent Skills)
│
├── backend/                    # Python FastAPI backend
│   ├── src/ala/                # Application package
│   │   ├── main.py             # FastAPI app lifecycle, router registration, MCP mount,
│   │   │                       #   cwd project auto-discovery, temp cleanup, frozen SPA serving
│   │   ├── config.py           # Pydantic Settings (env vars, AI defaults, MCP root)
│   │   ├── logging_config.py   # Centralised logging: TimedRotatingFileHandler + console
│   │   ├── file_detector.py    # Header-based file-type detection (never uses extension)
│   │   ├── api/                # REST routers
│   │   │   ├── chat.py         # Chat sessions & SSE streaming messages
│   │   │   ├── config.py       # AI config GET/PUT (key masked on read)
│   │   │   ├── files.py        # Unified upload: auto-detects type, routes to a parser
│   │   │   ├── hci.py          # HCI upload / lazy filter stream / temp management
│   │   │   ├── health.py       # /health endpoint
│   │   │   ├── logs.py         # Log parse-local, directory listing, upload/temp, filter/stream
│   │   │   ├── models.py       # Model library management API
│   │   │   ├── pcap.py         # PCAP upload / lazy filter stream / temp management
│   │   │   ├── projects.py     # Project CRUD, file listing, AI filter generation
│   │   │   └── trace.py        # Trace parse/filter
│   │   ├── cli/                # Typer + Rich command-line interface (entry point: ala)
│   │   │   ├── main.py         # Typer app; mounts pluggable sub-command groups
│   │   │   ├── display.py      # Rich styling helpers (level colours, ordering)
│   │   │   ├── utils.py        # File loading + stats computation
│   │   │   └── commands/
│   │   │       └── logs.py     # `ala overview` / `ala search` / `ala tail`
│   │   ├── services/           # Business logic
│   │   │   ├── agent_tools.py  # Tool definitions + dispatch for the AI agent
│   │   │   ├── ai_service.py   # AI provider abstraction (OpenAI/Anthropic) + agent loop
│   │   │   ├── code_scanner.py # Source code pattern discovery + context docs (ripgrep-backed)
│   │   │   ├── database.py     # SQLite singleton, auto-migration, JSON import
│   │   │   ├── diagnostic_parser.py # ANR trace + tombstone structured parser (stdlib only)
│   │   │   ├── hci_analyzer.py # BTSnoop HCI parsing engine
│   │   │   ├── log_analyzer.py # Log parsing engine (file-based lazy streaming)
│   │   │   ├── model_manager.py   # Model library persistence (JSON file store)
│   │   │   ├── pcap_analyzer.py   # PCAP parsing engine (scapy)
│   │   │   ├── project_manager.py # Project persistence + cwd auto-discovery
│   │   │   ├── session_manager.py # Chat session metadata store (SQLite-backed)
│   │   │   └── trace_analyzer.py  # Trace parsing engine (perfetto wrapper)
│   │   ├── bin/                # Bundled ripgrep binaries (linux/rg, win32/rg.exe)
│   │   └── mcp/                # FastMCP server
│   │       └── server.py       # MCP tools for external AI clients
│   ├── tests/                  # pytest suite (pytest + pytest-asyncio, asyncio_mode=auto)
│   │   ├── conftest.py
│   │   ├── test_agent_tools.py
│   │   ├── test_ai_service.py
│   │   ├── test_api.py
│   │   ├── test_code_scanner.py
│   │   ├── test_diagnostic_parser.py
│   │   ├── test_hci_analyzer.py
│   │   ├── test_lazy_log.py
│   │   ├── test_log_analyzer.py
│   │   ├── test_mcp.py
│   │   ├── test_model_manager.py
│   │   ├── test_pcap_analyzer.py
│   │   ├── test_search_all_local.py
│   │   ├── test_search_benchmarks.py
│   │   ├── test_session_manager.py
│   │   └── test_trace_analyzer.py
│   ├── ala_server.py           # PyInstaller entry point (opens browser when frozen)
│   ├── ala.spec                # PyInstaller build spec
│   ├── Dockerfile              # Backend image (uvicorn)
│   ├── pyproject.toml          # Poetry + Ruff + pytest config
│   └── .env.example            # Environment template (OpenAI endpoint by default)
│
├── frontend/                   # React + Vite + Ant Design SPA
│   ├── src/
│   │   ├── main.tsx            # React entry point (mounts BrowserRouter + App)
│   │   ├── styles.css          # Global styles
│   │   ├── app/
│   │   │   └── App.tsx         # Root component: routing, splitter, tabs, global shortcuts
│   │   ├── pages/              # Route-level pages (lazy loaded)
│   │   │   ├── GuidePage.tsx   # In-app markdown user guide (en/zh)
│   │   │   ├── ModelPage.tsx   # AI model & endpoint configuration
│   │   │   └── ProjectPage.tsx # Project CRUD UI
│   │   ├── api/                # Centralised HTTP client
│   │   │   ├── client.ts       # apiFetch, apiUpload, streamUploadNDJSON, streamSSE
│   │   │   ├── chat.ts         # sendMessage (SSE streaming)
│   │   │   ├── config.ts       # AI config API
│   │   │   ├── files.ts        # Unified upload (auto-detected type)
│   │   │   ├── hci.ts          # HCI upload / filter stream
│   │   │   ├── logs.ts         # Log parse-local, parseLogStream, filterLogs
│   │   │   ├── models.ts       # Model library API
│   │   │   ├── pcap.ts         # PCAP upload / filter stream
│   │   │   ├── projects.ts     # Project CRUD, file listing, AI filter generation
│   │   │   └── trace.ts        # parseTrace, filterTrace
│   │   ├── components/         # React UI components
│   │   │   ├── AiPanel.tsx     # Chat panel with streaming, preset analysis modes
│   │   │   ├── AppSider.tsx    # Sidebar: projects, presets, draft/apply flow
│   │   │   ├── DirectoryFilePicker.tsx  # Browse local directories
│   │   │   ├── ErrorBoundary.tsx  # React error boundary
│   │   │   ├── FileUpload.tsx  # Drag-and-drop multi-file upload (archives supported)
│   │   │   ├── FilterDrawer.tsx        # Context-aware filter drawer
│   │   │   ├── HciFilterPanel.tsx      # HCI filter controls
│   │   │   ├── HciViewer.tsx           # Virtualised HCI packet viewer
│   │   │   ├── Header.tsx      # Top bar (settings, theme, language toggle)
│   │   │   ├── LogFilterPanel.tsx      # Log filter controls
│   │   │   ├── LogViewer.tsx   # Virtualised log table with colour-coded levels
│   │   │   ├── PcapFilterPanel.tsx     # PCAP filter controls
│   │   │   ├── PcapViewer.tsx  # Packet statistics + virtualised packet table
│   │   │   ├── PendingFilesView.tsx    # Pre-parse file listing / selection
│   │   │   ├── TraceFilterPanel.tsx    # Trace filter controls
│   │   │   ├── TraceViewer.tsx # Virtualised trace slice viewer
│   │   │   └── __tests__/      # Vitest component tests
│   │   ├── hooks/
│   │   │   ├── useDebounce.ts
│   │   │   ├── useLazyLogStream.ts     # Lazy log load/filter streaming
│   │   │   ├── useLazyPcapStream.ts    # Lazy PCAP streaming
│   │   │   └── useLazyHciStream.ts     # Lazy HCI streaming
│   │   ├── utils/
│   │   │   ├── export.ts       # CSV / JSON export helpers
│   │   │   ├── filters.ts      # Filter logic + presets (localStorage)
│   │   │   ├── models.ts       # AI model helpers + built-in presets
│   │   │   ├── sessionStorage.ts  # IndexedDB chat-message persistence
│   │   │   └── sseParser.ts    # SSE/NDJSON stream parsing
│   │   ├── types/
│   │   │   ├── index.ts        # Core types (mirrors backend Pydantic models)
│   │   │   ├── hci.ts          # HCI types
│   │   │   └── pcap.ts         # PCAP types
│   │   └── i18n/               # i18next setup
│   │       ├── config.ts       # i18next init
│   │       └── locales/        # en.json, zh.json
│   ├── public/
│   │   ├── guide/              # In-app user guide (en.md / zh.md)
│   │   └── *.svg / *.png       # Favicons and touch icons
│   ├── index.html              # Vite entry
│   ├── vite.config.ts          # Dev proxy → localhost:8000, build → dist/
│   ├── vitest.config.ts        # Vitest (jsdom, globals, setup file)
│   ├── vitest.setup.ts         # Testing Library + antd matchMedia/ResizeObserver shims
│   ├── tsconfig.json           # References tsconfig.app.json + tsconfig.node.json
│   ├── tsconfig.app.json       # Strict mode, ESNext modules, React JSX
│   ├── tsconfig.test.json      # Test-specific TS config
│   ├── eslint.config.js        # typescript-eslint + react-hooks + react-refresh
│   ├── Dockerfile              # Multi-stage: build → Nginx serve
│   └── nginx.conf              # Reverse proxy to backend:8000
│
├── scripts/                    # Convenience wrappers
│   ├── ala.sh                  # Linux/macOS (install/dev/build/deploy)
│   ├── ala.ps1                 # Windows PowerShell
│   ├── build-exe.sh            # Standalone PyInstaller build
│   ├── package-macos.sh        # macOS .app / .dmg packaging
│   └── package-windows.ps1     # Windows .msi packaging
│
├── examples/                   # Sample data (sample-android.log, sample-network.pcap)
├── assets/                     # Icons (icon.png, icon.svg, logo.svg, icons/)
└── .agents/skills/             # Project-agent skills (managed via skills-lock.json)
```

## Code Style

### All files (Prettier)

```jsonc
// .prettierrc.json
{
  "semi": false, // No semicolons
  "singleQuote": true, // Single quotes everywhere
  "tabWidth": 2, // 2-space indent
  "trailingComma": "all", // Trailing commas always (including function params)
  "printWidth": 100, // 100-char line limit
  "arrowParens": "always", // Always wrap arrow function params
  "endOfLine": "lf", // LF line endings
}
```

Run `npm run format` before committing. CI enforces `npm run format:check`.
`npm run format` runs Prettier for all JS/TS/JSON/YAML/MD files **and** `ruff format` + `ruff check --fix` for Python.

### Frontend (ESLint + TypeScript)

**ESLint** (`frontend/eslint.config.js`):

- Extends `@eslint/js` recommended + `typescript-eslint` recommended
- Plugins: `react-hooks` (recommended rules), `react-refresh` (warn on non-component exports)
- `@typescript-eslint/no-unused-vars`: warn, `argsIgnorePattern: "^_"` (underscore-prefixed args allowed)

**TypeScript** (`frontend/tsconfig.app.json`):

- `strict: true` — all strict checks enabled
- `noUnusedLocals: true`, `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- Target: ES2020, Module: ESNext, JSX: react-jsx
- Module resolution: bundler (Vite-compatible)

### Backend (Ruff)

Ruff config is in `backend/pyproject.toml` under `[tool.ruff]`:

- `target-version`: py312
- `line-length`: 100
- `src`: `["src"]`
- Lint rules: `E` (pycodestyle), `F` (pyflakes), `I` (isort), `N` (pep8-naming), `W` (pycodestyle warnings), `UP` (pyupgrade)
- Ignored: `E501` (line length — handled by formatter)
- First-party imports: `ala`

## Development Commands

### Setup

```bash
# Full install (workspace root + backend + frontend)
npm run install:all

# Or manually:
npm install                              # Root workspace tools
cd backend && poetry install && cd ..    # Python backend
cd frontend && npm install && cd ..      # Frontend
```

### Run Dev Servers

```bash
npm run dev   # Starts backend (:8000) + frontend (:5173) via concurrently
```

The Vite dev server proxies `/api` to `http://localhost:8000` (see `frontend/vite.config.ts`).

### Build

```bash
npm run build             # Production frontend build (tsc -b + vite build → frontend/dist/)
npm run build:exe         # Standalone executable via PyInstaller (macOS/Linux, see below)
```

### Test

> **Note:** the workspace `test:frontend` script runs **`tsc --noEmit` type-checking**, not Vitest.
> Run Vitest explicitly from the frontend package.

```bash
npm test                  # Backend pytest + frontend type-check (tsc --noEmit)
npm run test:backend      # cd backend && poetry run pytest tests/ -v
npm run test:frontend     # cd frontend && npm run type-check  (NOT vitest)

cd frontend && npm test           # Vitest run (jsdom, 11 test files)
cd frontend && npm run test:watch # Vitest watch mode
```

Run a single backend test:

```bash
cd backend
poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
poetry run pytest tests/test_trace_analyzer.py::TestTraceFilter::test_filter_by_pid -v
```

Run a single frontend test:

```bash
cd frontend
npx vitest run src/components/__tests__/LogViewer.test.tsx
```

### CLI

The Typer CLI is installed as the Poetry script `ala` (`backend/pyproject.toml` →
`ala = "ala.cli.main:app"`). Sub-command groups live in `backend/src/ala/cli/commands/`
and are mounted one line each in `cli/main.py`; the `logs` group mounts at the top level.

```bash
cd backend
poetry run ala --help
poetry run ala overview ../examples/sample-android.log
poetry run ala search <logfile> --level E --keyword "Exception"
poetry run ala tail <logfile>
```

### Lint & Format

```bash
# Frontend
npm run lint              # ESLint (frontend only)
npm run lint:fix          # ESLint auto-fix

# All files (Prettier + ruff)
npm run format            # Prettier (JS/TS/JSON/MD) + ruff format/lint-fix (Python)
npm run format:check      # Prettier check + ruff check-only (CI)

# Backend (standalone)
cd backend
poetry run ruff check src/
poetry run ruff format --check src/
```

### Docker

```bash
npm run deploy            # docker compose up --build -d
npm run deploy:down       # docker compose down
```

## Architecture & Conventions

### Request Flow

1. Vite frontend → `/api/*` → Vite proxy (dev) or Nginx (prod) → `localhost:8000`
2. `backend/src/ala/main.py` creates the FastAPI app, registers routers, mounts FastMCP at `/mcp`
3. On startup the lifespan hook auto-discovers an ALA project from the cwd and cleans up temp
   sessions older than `ALA_TEMP_MAX_AGE_HOURS` (default 24h)
4. When frozen (PyInstaller): FastAPI also serves the React SPA via `_SPAStaticFiles`, which
   falls back to `index.html` for client-side routes while serving real assets directly
5. All frontend API calls go through `frontend/src/api/` — never scatter `fetch` across components

### File Type Detection

`ala/file_detector.py` is the single source of truth for ingest routing. Detection is
**purely header-based — the file extension is never consulted**. `detect_file_type_from_header()`
reads up to 8 KB and returns one of: `log`, `pcap`, `hci`, `trace`, `anr`, `tombstone`.

- PCAP magics (le/be, ns variants) → `pcap`
- BTSnoop magic `btsnoop\x00` → `hci`
- gzip / zip / rar / 7z headers → `log` (decompressed downstream, may expand to multiple files)
- High binary control-byte density or JSON with trace markers → `trace`
- ANR header (`----- pid N at ... -----` + `"main" prio=`) → `anr`
- Tombstone banner (`*** *** ***`) → `tombstone`
- Otherwise → `log`

The unified upload endpoint `POST /api/files/upload` uses this to route a dropped file to the
right parser. Each domain also exposes its own temp-upload + lazy-filter endpoints.

### Logs Pipeline

- Backend: `ala.api.logs` → `ala.services.log_analyzer.LogAnalyzer`
- **File-based lazy architecture** (entries are never held in memory in production): local paths
  and uploads are parsed/filtered on demand, streaming results to the client.
  - `POST /api/logs/parse-local` — register a local file path (returns a `session_file`)
  - `POST /api/logs/file/parse/stream` — stream entries for a single file
  - `POST /api/logs/directory/list`, `/directory/parse/stream`, `/directory/parse/selected/stream`
  - `POST /api/logs/upload/temp` + `POST /api/logs/filter/stream` — upload then filter on disk
  - `POST /api/logs/auto-path` — guess a path
  - `GET /api/logs/temp/status`, `POST /api/logs/temp/cleanup`
- Streaming responses are NDJSON — each line is a `LogEntry`, final line is a
  `{ "_done": true, "total": N }` sentinel
- Frontend consumes via `parseLogStream()` in `frontend/src/api/logs.ts` + `useLazyLogStream`
- Parsed entries carry `source_file` — **always preserve this field** when changing log models
- Formats: `android_logcat`, `generic_timestamped`, `unknown`
- Filters: time range, keyword regex (AND/OR modes), log level, tag regex, PID, TID
- Filter presets saved to `localStorage` key: `ala_filter_presets`
- **Draft/apply pattern**: editing filter fields updates `pendingFilters`; nothing changes the active view until Apply is triggered

### PCAP Pipeline

- Backend: `ala.api.pcap` → `ala.services.pcap_analyzer.PcapAnalyzer`
- Requires `scapy` (≥ 2.5.0)
- Parses `.pcap` and `.pcapng` — extracts protocol, IPs, ports, TCP flags
- **Temp upload**: `POST /api/pcap/upload/temp` stores the file and returns `saved_path`
- **Lazy filter**: `POST /api/pcap/filter/stream` filters on disk without loading all packets
- Frontend: `PcapViewer` + `useLazyPcapStream` — protocol distribution, unique IPs, connections,
  virtualised packet table
- Filters: protocol, source/destination IP, source/destination port, TCP flags, keywords
- Agent tools: `overview_local_pcap`, `search_pcap_packets_lazy`, `list_pcap_files` (`LAZY_PCAP_TOOLS`)

### HCI Pipeline (Bluetooth)

- Backend: `ala.api.hci` → `ala.services.hci_analyzer.HciAnalyzer`
- Parses BTSnoop captures (magic `btsnoop\x00`) — direction, HCI type
  (COMMAND/EVENT/ACL/SCO/ISO), opcodes, event codes
- Same shape as PCAP: `POST /api/hci/upload/temp`, `POST /api/hci/filter/stream`,
  `GET /api/hci/temp/status`, `POST /api/hci/temp/cleanup`
- Frontend: `HciViewer` + `useLazyHciStream`
- Agent tools: `overview_local_hci`, `search_hci_packets_lazy`, `list_hci_files`,
  `decode_hci_opcode` (`LAZY_HCI_TOOLS`)

### Diagnostics Pipeline (ANR / Tombstone)

- `ala.services.diagnostic_parser.DiagnosticParser` — pure stdlib, zero external deps
- `parse_anr(text)` → threads, stack frames, locks, priorities
- `parse_tombstone(text)` → signal info, backtrace, register/thread dumps
- `parse_diagnostic(text)` auto-detects the flavour
- Surfaced to the agent as `parse_anr_trace`, `parse_tombstone`, and `parse_diagnostic_file`
  (auto-detecting); prefer these over reading raw text

### Trace Pipeline

- Backend: `ala.api.trace` → `ala.services.trace_analyzer`
- Frontend: first `parseTrace()` (upload), then `filterTrace()` (filter by PID/process name) on the parsed result
- Process-name filtering is **regex-based and case-insensitive**
- Agent tools: `query_trace_overview`, `list_trace_processes`, `query_trace_slices`,
  `query_trace_sql` (`TRACE_TOOLS`)

### AI Chat & Config

- Chat endpoints in `backend/src/ala/api/chat.py`; responses stream over `text/event-stream`
- Frontend: `streamSSE()` in `client.ts`, `sendMessage()` in `chat.ts`
- **Session metadata** (title, context type, project, `source_path`) is persisted in SQLite via
  `SessionManager`; **conversation history is managed by the frontend** (IndexedDB `ala_sessions`)
  and sent with each request
- AI config defaults from `backend/src/ala/config.py`, overridable at runtime via `PUT /api/config`
- Frontend caches AI config in `localStorage` key: `aiConfig`
- `GET /api/config` **masks the API key** — do not treat the returned value as a reusable secret
- Supports Anthropic (native SDK) and any OpenAI-compatible API (OpenAI, Ollama, Azure, LM Studio)
- Supports "extended thinking" (think mode) for deeper reasoning

### Agentic Analysis (AI tools)

`ala/services/agent_tools.py` defines the tool inventory; `ai_service.py` selects tool sets based
on what the session has available. Max tool-calling rounds: `AI_MAX_TOOL_ROUNDS` (default 50).

| Tool set           | Enabled when                       | Highlights                                                                                                                               |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `LAZY_LOG_TOOLS`   | a `source_path` is set             | `list_directory_logs`, `overview_local_log`, `search_local_log`, `read_log_range`, `tail_local_log`, `search_all_local`, `read_log_file` |
| `LAZY_PCAP_TOOLS`  | a `source_path` is set             | `overview_local_pcap`, `search_pcap_packets_lazy`, `list_pcap_files`                                                                     |
| `LAZY_HCI_TOOLS`   | a `source_path` is set             | `overview_local_hci`, `search_hci_packets_lazy`, `list_hci_files`, `decode_hci_opcode`                                                   |
| `DIAGNOSTIC_TOOLS` | a `source_path` is set             | `parse_anr_trace`, `parse_tombstone`, `parse_diagnostic_file`                                                                            |
| `AGENT_TOOLS`      | a project is selected              | project file listing/reading, `search_project_code`, `search_all_local`, `execute_shell_search`, `decompress_file`                       |
| `CODING_TOOLS`     | a project is selected              | `edit_file`, `write_file`, `search_files`, `execute_command`                                                                             |
| `TRACE_TOOLS`      | a trace is loaded into the session | `query_trace_overview`, `list_trace_processes`, `query_trace_slices`, `query_trace_sql`                                                  |

**Tool security:** all tools validate paths to prevent traversal escapes. `execute_command` uses
a blocked-command allowlist; `execute_shell_search` blocks dangerous operations; file-editing
tools (`edit_file`, `write_file`) are constrained to project boundaries.

### MCP Integration

- MCP server starts as part of the FastAPI lifecycle — **no separate process needed**
- Mounted at `/mcp` (Streamable HTTP transport, MCP 1.0); `MCP_ALLOWED_ROOT` (or cwd)
  constrains file reads
- Tools: `parse_android_log`, `filter_android_logs`, `get_log_statistics`,
  `parse_perfetto_trace`, `filter_perfetto_trace`, `query_perfetto_trace_sql`,
  `overview_local_log`, `search_local_log`, `read_log_range`, `tail_local_log`,
  `list_directory_logs`, `search_all_local`, `parse_anr_trace`, `parse_tombstone`

### Projects Feature

- Source code directories can be registered as "projects" for AI-assisted analysis
- `code_scanner.py` discovers logging patterns (`Log.d/i/w/e`, process names, error keywords) in project source files using a bundled ripgrep binary
- AI-generated filter presets suggest log filters based on project code (`POST /api/projects/:id/generate-filters`, SSE stream)
- Context documents (`AGENTS.md`, `CLAUDE.md`, `README.md`, `.cursorrules`, `.github/copilot-instructions.md`, etc.) in the project directory are auto-injected at the **top** of the AI system prompt (capped at ~50 KB)
- On startup the backend attempts to discover a project from the current working directory

### Standalone Executable & Installers

- Build via `bash scripts/build-exe.sh` (macOS/Linux) or `.\scripts\ala.ps1 exe` (Windows)
- Process: compile frontend (`tsc + vite build`) → bundle backend + static files with PyInstaller → `backend/dist/ala/`
- **Distribute the entire `backend/dist/ala/` directory** — the executable needs sibling files
- Release packaging: `scripts/package-macos.sh` (`.app` / `.dmg`) and `scripts/package-windows.ps1` (`.msi`)
- When running frozen (`sys.frozen`), the executable:
  - Opens the default browser automatically (`http://localhost:8000`)
  - Serves the React SPA directly from `frontend_dist/` in `sys._MEIPASS`
  - Binds to `127.0.0.1` (not `0.0.0.0`) for local-only access
  - Looks for `.env` next to the executable for AI credentials
- Platform-specific: build on each target OS

### Agent Skills

Project-level agent skills live in `.agents/skills/` and are managed via `skills-lock.json`.
Currently locked: `antd`, `browser-preview`, `fastapi`, `fastapi-python`, `playwright-cli`,
`playwright-explore-website`, `playwright-generate-test`, `typescript-advanced-types`,
`typescript-mcp-server-generator`, `vercel-react-best-practices`.

## Code Conventions

### TypeScript ↔ Python Alignment

Keep `frontend/src/types/index.ts` in sync with backend Pydantic models.
When an API response shape changes, update **both sides together**.

### i18n

All user-facing frontend strings must go through `useTranslation()`. Add translations to both:

- `frontend/src/i18n/locales/en.json`
- `frontend/src/i18n/locales/zh.json`

Language auto-detected from browser locale. `localStorage` key: `ala_language`.

### Frontend API Helpers

Always use the centralized helpers from `frontend/src/api/client.ts`:

- `apiFetch()` — JSON request/response
- `apiUpload()` / `apiUploadMulti()` — multipart file uploads
- `streamUploadNDJSON()` — log streaming (NDJSON)
- `streamSSE()` — chat streaming (text/event-stream)

### Keyboard Shortcuts (global, defined in `app/App.tsx`)

| Shortcut                       | Action                             |
| ------------------------------ | ---------------------------------- |
| `Ctrl+K` / `Cmd+K`             | Toggle filter sidebar / drawer     |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Focus keyword search input         |
| `Ctrl+D` / `Cmd+D`             | Toggle dark/light theme            |
| `Escape`                       | Close popover → sidebar → AI panel |

### Client-side Storage Keys

`localStorage`:

| Key                    | Purpose                         |
| ---------------------- | ------------------------------- |
| `ala_language`         | UI language preference (en/zh)  |
| `ala_theme`            | Dark/light theme preference     |
| `ala_filter_presets`   | Saved log filter presets        |
| `aiConfig`             | Cached AI endpoint/model config |
| `ala_active_model_id`  | Selected model ID               |
| `ala_active_models`    | Active model list               |
| `ala_last_project_id`  | Last selected project           |
| `ala_splitter_ai_size` | AI panel width in splitter      |

`ala_models` is a legacy key read once to migrate custom models into `ala_active_models`.
Chat message history is persisted separately in **IndexedDB** database `ala_sessions`
(see `frontend/src/utils/sessionStorage.ts`).

### Git Workflow

- **Conventional Commits** enforced via `@commitlint/config-conventional` + Husky
- Pre-commit hook: ESLint + Prettier format check
- Commit-msg hook: commitlint
- Version bumps auto-generate CHANGELOG.md

### Backend Configuration

Environment variables (loaded from `backend/.env`, or `.env` next to frozen executable):

| Variable                    | Default                        | Description                             |
| --------------------------- | ------------------------------ | --------------------------------------- |
| `HOST`                      | `0.0.0.0` (`127.0.0.1` frozen) | Server bind address                     |
| `PORT`                      | `8000`                         | Server port                             |
| `DEBUG`                     | `false`                        | Debug mode (enables auto-reload)        |
| `CORS_ORIGINS`              | JSON array                     | Allowed origins (JSON or comma-sep)     |
| `LOG_LEVEL`                 | `INFO`                         | `DEBUG` / `INFO` / `WARNING` / `ERROR`  |
| `LOG_DIR`                   | `logs`                         | Rotating log file directory             |
| `AI_API_ENDPOINT`           | `https://api.anthropic.com`    | AI provider base URL                    |
| `AI_API_KEY`                | (empty)                        | API key                                 |
| `AI_MODEL`                  | `claude-sonnet-4-20250514`     | Model name                              |
| `AI_TEMPERATURE`            | `0.7`                          | Sampling temperature                    |
| `AI_THINKING_MODE`          | `off`                          | `off` / `auto` / `on`                   |
| `AI_THINKING_BUDGET_TOKENS` | `8000`                         | Max tokens for think mode               |
| `AI_MAX_TOOL_ROUNDS`        | `50`                           | Max agent tool-calling iterations       |
| `MCP_ALLOWED_ROOT`          | (empty → cwd)                  | Constrains MCP file reads               |
| `ALA_TEMP_DIR`              | `~/.ala/temp_logs`             | Temp upload/session directory           |
| `ALA_TEMP_MAX_AGE_HOURS`    | `24`                           | Startup cleanup threshold for temp dirs |

Supports any OpenAI-compatible API (Ollama, LM Studio, Azure OpenAI, etc.).

> **Heads-up**: `backend/.env.example` defaults to `https://api.openai.com/v1` and
> `gpt-4o-mini`, but `config.py` defaults to Anthropic. The `.env.example` is a
> starter for OpenAI users; the code default is Anthropic.

### Persisted Data Locations

| Path                   | Contents                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `~/.ala/ala.db`        | SQLite (WAL) — sessions, messages, projects, project paths |
| `~/.ala/models.json`   | Model library                                              |
| `~/.ala/projects.json` | Legacy project store, imported into SQLite on first run    |
| `~/.ala/temp_logs/`    | Temp upload/session directories                            |

## Dependencies

### Backend (Python)

- FastAPI, Uvicorn, python-multipart, sse-starlette
- FastMCP (MCP protocol server)
- Pydantic, Pydantic-settings, python-dotenv
- httpx, perfetto, scapy (pcap parsing), rarfile (`.rar` archives)
- anthropic, openai
- typer, rich (CLI)
- Dev: pytest, pytest-asyncio, pytest-benchmark, ruff, PyInstaller, pyinstaller-hooks-contrib

### Frontend (Node.js)

- React 19, React Router 7
- Ant Design 6, @ant-design/icons, @ant-design/x (AI chat components)
- i18next, react-i18next
- react-markdown, remark-gfm (GitHub-flavoured Markdown rendering)
- dayjs
- TypeScript 5, Vite 6
- Dev: ESLint 9, Vitest 3, Testing Library (react + jest-dom + user-event), jsdom

### Root workspace

- concurrently (parallel dev servers), cross-env (portable env vars)
- prettier, husky, @commitlint/cli + @commitlint/config-conventional

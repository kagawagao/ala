# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Quick commands

```bash
npm run install:all      # First-time setup: root + backend (Poetry) + frontend deps
npm run dev              # Start backend (:8000) + frontend (:5173) concurrently
npm run dev:backend      # Backend only with DEBUG logging and --reload
npm run dev:frontend     # Frontend Vite dev server only
npm run build            # Production frontend build (tsc -b + vite)
npm run build:exe        # Standalone PyInstaller executable (macOS/Linux)
npm test                 # Backend pytest + frontend TYPE-CHECK (not vitest)
npm run test:backend     # cd backend && poetry run pytest tests/ -v
npm run test:frontend    # cd frontend && npm run type-check (tsc --noEmit)
npm run lint             # Frontend ESLint only
npm run lint:fix         # Frontend ESLint auto-fix
npm run format           # Prettier (JS/TS/JSON/MD) + ruff format/lint (Python)
npm run format:check     # CI format check
npm run deploy           # docker compose up --build -d
npm run deploy:down      # docker compose down
```

**Run frontend unit tests (vitest) — separate from `npm test`:**

```bash
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch  # vitest watch
```

**Single backend test:**

```bash
cd backend && poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
```

**Single frontend test (vitest):**

```bash
cd frontend && npx vitest run src/components/__tests__/LogViewer.test.tsx
```

**Backend lint/format (standalone):**

```bash
cd backend
poetry run ruff check src/
poetry run ruff format --check src/
```

**CLI:**

```bash
cd backend
poetry run ala --help
poetry run ala overview ../examples/sample-android.log   # overview | search | tail
```

## Architecture

This is a monorepo for an AI-powered analyzer of Android diagnostics data: logcat logs,
network captures (PCAP), Bluetooth HCI snoop logs, Perfetto traces, and structured
diagnostics (ANR traces, native tombstones). The same core logic backs a FastAPI + React
web app and a Typer/Rich CLI (`ala`).

- **Backend** (`backend/`): Python 3.12+ FastAPI + FastMCP, managed with Poetry. Source lives under `backend/src/ala/`.
- **Frontend** (`frontend/`): React 19 + Vite 6 + Ant Design 6 + TypeScript 5.
- **AGENTS.md** has the full file tree and detailed architecture descriptions; this file is the concise quick-reference and stays in sync with it.

### Request flow

1. Vite dev server proxies `/api` → `localhost:8000` (see `frontend/vite.config.ts`)
2. `backend/src/ala/main.py` creates the FastAPI app, registers routers, mounts FastMCP at `/mcp`
3. On startup the lifespan hook auto-discovers a project from the cwd and cleans temp sessions
4. In frozen mode (PyInstaller), FastAPI also serves the React SPA directly via `_SPAStaticFiles`
5. All frontend HTTP calls go through `frontend/src/api/client.ts` helpers — never raw `fetch` in components

### File type detection

`ala/file_detector.py` routes every ingest. Detection is **purely header-based — the file
extension is never consulted**. `detect_file_type_from_header()` reads up to 8 KB and returns one
of `log`, `pcap`, `hci`, `trace`, `anr`, `tombstone`. The unified upload endpoint
`POST /api/files/upload` uses it to pick a parser.

### Key pipelines

- **Logs**: file-based lazy architecture — entries are never held in memory. Endpoints: `POST /api/logs/parse-local`, `/file/parse/stream`, `/directory/list`, `/directory/parse/stream`, `/directory/parse/selected/stream`, `/upload/temp` + `/filter/stream`, `/auto-path`, plus `/temp/status` and `/temp/cleanup`. Streaming responses are NDJSON (each line = `LogEntry`, final sentinel = `{"_done": true, "total": N}`). Frontend consumes via `parseLogStream()` + `useLazyLogStream`. Parsed entries carry `source_file` — always preserve this field. Formats: `android_logcat`, `generic_timestamped`, `unknown`. Archives (`.gz`, `.zip`, `.rar`, `.7z`) are decompressed and may expand to multiple files.
- **PCAP**: `.pcap`/`.pcapng` parsed via `scapy`. `POST /api/pcap/upload/temp` stores the file, `POST /api/pcap/filter/stream` filters it on disk without loading all packets. Frontend uses `PcapViewer` + `useLazyPcapStream`.
- **HCI**: Bluetooth BTSnoop logs (magic `btsnoop\x00`). `HciAnalyzer` extracts direction, HCI type (COMMAND/EVENT/ACL/SCO/ISO), opcodes, event codes. Endpoints mirror PCAP: `POST /api/hci/upload/temp`, `POST /api/hci/filter/stream`, `/temp/status`, `/temp/cleanup`. Frontend uses `HciViewer` + `useLazyHciStream`.
- **Diagnostics**: `diagnostic_parser.py` (pure stdlib) parses ANR traces (`parse_anr`) and native tombstones (`parse_tombstone`) into structured JSON, with `parse_diagnostic` auto-detecting the flavour.
- **Traces**: two-step — `parseTrace()` uploads (TraceProcessor → JSON fallback → legacy varint), then `filterTrace()` filters by PID/process name regex (case-insensitive).
- **AI Chat**: SSE streaming via `POST /api/chat/sessions/:id/messages`. Agentic analysis uses tool sets selected by available data (see below). Session metadata is persisted in SQLite; conversation history is managed by the frontend (IndexedDB) and sent with each request.
- **Multimodal input**: models with `supports_vision` on their preset accept inline images (PNG/JPEG/WebP/GIF, ≤ 8 MB, ≤ 8 per message) sent as an `attachments` array on the message. `ala/api/chat.py` validates them; `build_multimodal_content()` in `ai_service.py` renders Anthropic `image` blocks or OpenAI `image_url` parts. Text-only models are rejected with a 400.
- **Projects**: Source directories registered as projects. `code_scanner.py` uses ripgrep to discover logging patterns. Context docs (AGENTS.md, CLAUDE.md, README.md, `.cursorrules`, `.github/copilot-instructions.md`, etc.) in project dirs are auto-injected at the top of the AI system prompt (capped ~50 KB).

### Agent tool sets

Defined in `services/agent_tools.py`, selected in `ai_service.py`. Max rounds: `AI_MAX_TOOL_ROUNDS` (default 50).

| Tool set           | Enabled when                       | Highlights                                                                                                                               |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `LAZY_LOG_TOOLS`   | a `source_path` is set             | `overview_local_log`, `search_local_log`, `read_log_range`, `tail_local_log`, `list_directory_logs`, `search_all_local`, `read_log_file` |
| `LAZY_PCAP_TOOLS`  | a `source_path` is set             | `overview_local_pcap`, `search_pcap_packets_lazy`, `list_pcap_files`                                                                     |
| `LAZY_HCI_TOOLS`   | a `source_path` is set             | `overview_local_hci`, `search_hci_packets_lazy`, `list_hci_files`, `decode_hci_opcode`                                                   |
| `DIAGNOSTIC_TOOLS` | a `source_path` is set             | `parse_anr_trace`, `parse_tombstone`, `parse_diagnostic_file`                                                                            |
| `AGENT_TOOLS`      | a project is selected              | project file listing/reading, `search_project_code`, `search_all_local`, `execute_shell_search`, `decompress_file`                       |
| `CODING_TOOLS`     | a project is selected              | `edit_file`, `write_file`, `search_files`, `execute_command`                                                                             |
| `TRACE_TOOLS`      | a trace is loaded into the session | `query_trace_overview`, `list_trace_processes`, `query_trace_slices`, `query_trace_sql`                                                  |

### MCP server

Starts with the FastAPI lifecycle (no separate process), mounted at `/mcp` (Streamable HTTP).
`MCP_ALLOWED_ROOT` (default cwd) constrains file reads. Tools: `parse_android_log`,
`filter_android_logs`, `get_log_statistics`, `parse_perfetto_trace`, `filter_perfetto_trace`,
`query_perfetto_trace_sql`, `overview_local_log`, `search_local_log`, `read_log_range`,
`tail_local_log`, `list_directory_logs`, `search_all_local`, `parse_anr_trace`, `parse_tombstone`.

### Standalone executable & installers

Build: `bash scripts/build-exe.sh` — compiles frontend, then bundles backend + static files with PyInstaller → `backend/dist/ala/`. Distribute the entire directory. When running frozen, the app binds to `127.0.0.1`, opens the browser automatically, and reads `.env` from next to the executable. Release packaging: `scripts/package-macos.sh` (`.app`/`.dmg`) and `scripts/package-windows.ps1` (`.msi`).

### React Router routes

- `*` (i.e. `/`) — main view (log/PCAP/HCI/trace viewers + AI panel splitter)
- `/projects` — project manager (lazy loaded)
- `/models` — AI model & endpoint configuration (lazy loaded)
- `/guide` — in-app user guide (lazy loaded)

### Custom hooks

`frontend/src/hooks/` — `useLazyLogStream` (lazy log load/filter streaming), `useLazyPcapStream`,
`useLazyHciStream`, `useDebouncedValue`. There is no eager `useLogStream` any more.

### Keyboard shortcuts (global, defined in `app/App.tsx`)

| Shortcut                       | Action                             |
| ------------------------------ | ---------------------------------- |
| `Ctrl+K` / `Cmd+K`             | Toggle filter sidebar / drawer     |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Focus keyword search input         |
| `Ctrl+D` / `Cmd+D`             | Toggle dark/light theme            |
| `Escape`                       | Close popover → sidebar → AI panel |

### CLI

`backend/src/ala/cli/main.py` — Typer app, entry point `ala` (Poetry script). Sub-command groups
live in `cli/commands/` and are mounted one line each; the `logs` group mounts at top level with
`overview`, `search`, and `tail`. Output is Rich-formatted (`cli/display.py`).

### Database

SQLite singleton at `~/.ala/ala.db` (WAL mode, foreign keys enabled). Auto-creates tables on first access and migrates columns as schema evolves. Tables: `sessions`, `messages`, `projects`, `project_paths`, `project_patterns`, `_ala_schema_version`. Legacy `~/.ala/projects.json` is imported into SQLite on first run. Temp uploads live in `~/.ala/temp_logs/` (cleaned at startup by `ALA_TEMP_MAX_AGE_HOURS`, default 24h).

### Model library

JSON file at `~/.ala/models.json` managed by `model_manager.py`. Built-in presets for Claude (Opus/Sonnet/Haiku), GPT-4o, DeepSeek Chat, Groq, and others. Users can add custom OpenAI-compatible models. Frontend mirrors built-in models in `utils/models.ts`.

### Agent tools security

All agent tools validate paths to prevent traversal escapes. `execute_command` uses a blocked-command allowlist. `execute_shell_search` blocks dangerous operations. File-editing tools (`edit_file`, `write_file`) are constrained to project boundaries.

## Critical conventions

### TypeScript ↔ Python alignment

Keep `frontend/src/types/index.ts` in sync with backend Pydantic models. When an API response shape changes, update both sides together.

### Frontend API helpers (always use these)

- `apiFetch()` — JSON request/response
- `apiUpload()` / `apiUploadMulti()` — multipart file uploads
- `streamUploadNDJSON()` — log streaming (NDJSON)
- `streamSSE()` — chat streaming (text/event-stream)

### Draft/apply filter pattern

In `AppSider.tsx`/`FilterDrawer.tsx`, editing filter fields updates `pendingFilters`. The active view does NOT change until Apply is triggered or a preset is selected. Do not wire filter fields directly to the active view.

### Masked API key

`GET /api/config` returns `api_key: "***"` when a key is set. Never treat the masked value as a reusable secret. When updating config, if the client echoes `"***"` back, preserve the real key on the server side.

### Client-side storage keys

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

Chat message history is persisted in **IndexedDB** (database `ala_sessions`, object store
`sessions`) via `frontend/src/utils/sessionStorage.ts` — not localStorage.

### i18n

All user-facing UI strings must use `useTranslation()`. Add translations to both `frontend/src/i18n/locales/en.json` and `zh.json`.

### Chat sessions

Session metadata (title, context type, project, `source_path`) is persisted in SQLite
(`~/.ala/ala.db`). Conversation history lives in the frontend (IndexedDB) and the backend
receives the full message list with each request. Max 100 sessions with LRU eviction.

### Git workflow

Conventional Commits enforced by commitlint + Husky. Pre-commit hook runs ESLint + Prettier format check.

## Code style

- **All files**: Prettier — no semicolons, single quotes, 2-space indent, trailing commas, 100-char width
- **Backend**: Ruff — `[E, F, I, N, W, UP]`, line-length 100, target py312, `known-first-party = ["ala"]`
- **Frontend**: ESLint + TypeScript strict mode. Unused vars with `_` prefix are allowed.

## Backend env vars

| Variable                    | Default                        | Notes                               |
| --------------------------- | ------------------------------ | ----------------------------------- |
| `HOST`                      | `0.0.0.0` (`127.0.0.1` frozen) | Bind address                        |
| `PORT`                      | `8000`                         | Server port                         |
| `DEBUG`                     | `false`                        | Enables auto-reload                 |
| `CORS_ORIGINS`              | JSON array (5 localhost URLs)  | Allowed origins (comma-sep or JSON) |
| `LOG_LEVEL`                 | `INFO`                         | `DEBUG`/`INFO`/`WARNING`/`ERROR`    |
| `LOG_DIR`                   | `logs`                         | Rotating log files                  |
| `AI_API_ENDPOINT`           | `https://api.anthropic.com`    | AI provider URL                     |
| `AI_API_KEY`                | (empty)                        | API key                             |
| `AI_MODEL`                  | `claude-sonnet-5`              | Model name                          |
| `AI_TEMPERATURE`            | `0.7`                          | Sampling temperature                |
| `AI_THINKING_MODE`          | `off`                          | `off`/`auto`/`on`                   |
| `AI_THINKING_BUDGET_TOKENS` | `8000`                         | Think mode token budget             |
| `AI_MAX_TOOL_ROUNDS`        | `50`                           | Max agent tool-calling iterations   |
| `MCP_ALLOWED_ROOT`          | (empty → cwd)                  | Constrains MCP file reads           |
| `ALA_TEMP_DIR`              | `~/.ala/temp_logs`             | Temp upload/session directory       |
| `ALA_TEMP_MAX_AGE_HOURS`    | `24`                           | Startup cleanup threshold           |

Supports any OpenAI-compatible API. Note: `.env.example` defaults to OpenAI, but `config.py` code defaults to Anthropic.

## Persisted data locations

| Path                   | Contents                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `~/.ala/ala.db`        | SQLite (WAL) — sessions, messages, projects, project paths |
| `~/.ala/models.json`   | Model library                                              |
| `~/.ala/projects.json` | Legacy project store, imported into SQLite on first run    |
| `~/.ala/temp_logs/`    | Temp upload/session directories                            |

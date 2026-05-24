# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick commands

```bash
npm run install:all      # First-time setup: root + backend (Poetry) + frontend deps
npm run dev              # Start backend (:8000) + frontend (:5173) concurrently
npm run dev:backend      # Backend only with DEBUG logging and --reload
npm run dev:frontend     # Frontend Vite dev server only
npm run build            # Production frontend build (tsc + vite)
npm run build:exe        # Standalone PyInstaller executable (macOS/Linux)
npm test                 # Backend pytest + frontend type-check (not vitest)
npm run test:backend     # cd backend && poetry run pytest tests/ -v
npm run test:frontend    # cd frontend && npm run type-check (tsc --noEmit)
npm run lint             # Frontend ESLint only
npm run lint:fix         # Frontend ESLint auto-fix
npm run format           # Prettier (JS/TS/JSON/MD) + ruff format/lint (Python)
npm run format:check     # CI format check
npm run deploy           # docker compose up --build -d
npm run deploy:down      # docker compose down
```

**Single backend test:**

```bash
cd backend && poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
```

**Single frontend test (vitest):**

```bash
cd frontend && npx vitest run src/components/__tests__/LogViewer.test.tsx
```

**Frontend vitest watch mode:**

```bash
cd frontend && npm run test:watch
```

**Backend lint/format (standalone):**

```bash
cd backend
poetry run ruff check src/
poetry run ruff format --check src/
```

## Architecture

This is a monorepo for an AI-powered Android logcat and Perfetto trace analyzer.

- **Backend** (`backend/`): Python 3.12+ FastAPI, managed with Poetry. Source lives under `backend/src/ala/`.
- **Frontend** (`frontend/`): React 19 + Vite 6 + Ant Design 6 + TypeScript 5.
- **AGENTS.md** has the full file tree and detailed architecture descriptions.

### Request flow

1. Vite dev server proxies `/api` and `/health` → `localhost:8000` (see `frontend/vite.config.ts`)
2. `backend/src/ala/main.py` creates the FastAPI app, registers routers, mounts FastMCP at `/mcp`
3. In frozen mode (PyInstaller), FastAPI also serves the React SPA directly via `_SPAStaticFiles`
4. All frontend HTTP calls go through `frontend/src/api/client.ts` helpers — never raw `fetch` in components

### Key pipelines

- **Logs**: `POST /api/logs/parse/stream` returns NDJSON (each line = `LogEntry`, final sentinel = `{"_done": true, "total": N}`). Frontend consumes via `parseLogStream()`. Parsed entries carry `source_file` — always preserve this field. Supports plain text, `.gz`, `.zip` (expands to multiple files).
- **PCAP**: Network capture files (`.pcap`, `.pcapng`) parsed via `scapy`. Frontend uses `usePcapStream()` hook. Packets converted to log entries with protocol tags.
- **Traces**: Two-step — `parseTrace()` uploads, then `filterTrace()` filters by PID/process name regex (case-insensitive).
- **AI Chat**: SSE streaming via `POST /api/chat/sessions/:id/messages`. Agentic analysis uses tools to explore loaded data iteratively. Sessions are in-memory only (`SessionManager`) — lost on restart.
- **Projects**: Source directories registered as projects. `code_scanner.py` uses ripgrep to discover logging patterns. Context docs (AGENTS.md, CLAUDE.md, etc.) in project dirs are auto-injected into AI prompts.

### Standalone executable

Build: `bash scripts/build-exe.sh` — compiles frontend, then bundles backend + static files with PyInstaller → `backend/dist/ala/`. Distribute the entire directory. When running frozen, the app binds to `127.0.0.1`, opens the browser automatically, and reads `.env` from next to the executable.

### React Router routes

- `/` — main view (log viewer + trace viewer + AI panel splitter)
- `/projects` — project manager (lazy loaded)
- `/models` — AI model & endpoint configuration (lazy loaded)
- `/guide` — in-app user guide (lazy loaded)

### Custom hooks

`frontend/src/hooks/` — `useLazyLogStream` (agentic lazy log loading), `usePcapStream` (PCAP parsing), `useLogStream` (eager log loading), `useDebouncedValue` (generic debounce).

### Keyboard shortcuts (global, defined in App.tsx)

| Shortcut                       | Action                                         |
| ------------------------------ | ---------------------------------------------- |
| `Ctrl+K` / `Cmd+K`             | Toggle filter sidebar                          |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Focus keyword search input                     |
| `Ctrl+D` / `Cmd+D`             | Toggle dark/light theme                        |
| `Escape`                       | Close popover → sidebar → AI panel (cascading) |

### Legacy artifacts

The root `dist/` directory contains Electron build artifacts from an earlier architecture (`main.js`, `preload.js`, `renderer/`). The current architecture is **not** Electron-based. Do not use or modify these files.

## Critical conventions

### TypeScript ↔ Python alignment

Keep `frontend/src/types/index.ts` in sync with backend Pydantic models. When an API response shape changes, update both sides together.

### Frontend API helpers (always use these)

- `apiFetch()` — JSON request/response
- `apiUpload()` / `apiUploadMulti()` — multipart file uploads
- `streamUploadNDJSON()` — log streaming (NDJSON)
- `streamSSE()` — chat streaming (text/event-stream)

### Draft/apply filter pattern

In `AppSider.tsx`, editing filter fields updates `pendingFilters`. The active view does NOT change until Apply is triggered or a preset is selected. Do not wire filter fields directly to the active view.

### Masked API key

`GET /api/config` returns `api_key: "***"` when a key is set. Never treat the masked value as a reusable secret. When updating config, if the client echoes `"***"` back, preserve the real key on the server side.

### localStorage keys (stable, do not rename)

`ala_language`, `ala_theme`, `ala_filter_presets`, `aiConfig`, `ala_last_project_id`, `ala_splitter_ai_size`

### i18n

All user-facing UI strings must use `useTranslation()`. Add translations to both `frontend/src/i18n/locales/en.json` and `zh.json`.

### Chat sessions

In-memory only (`SessionManager`) — lost on backend restart. No persistence layer.

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
| `AI_MODEL`                  | `claude-sonnet-4-20250514`     | Model name                          |
| `AI_TEMPERATURE`            | `0.7`                          | Sampling temperature                |
| `AI_THINKING_MODE`          | `off`                          | `off`/`auto`/`on`                   |
| `AI_THINKING_BUDGET_TOKENS` | `8000`                         | Think mode token budget             |
| `AI_MAX_TOOL_ROUNDS`        | `50`                           | Max agent tool-calling iterations   |

Supports any OpenAI-compatible API. Note: `.env.example` defaults to OpenAI, but `config.py` code defaults to Anthropic.

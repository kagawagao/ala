# Copilot Instructions for ALA

ALA is a monorepo for an Android logcat and Perfetto trace analyzer: a FastAPI backend in `backend/` and a React 19 + Vite frontend in `frontend/`.

## Build, test, and lint commands

### Workspace root

```bash
npm install
npm run install:all

npm run dev
npm run build
npm test

npm run lint
npm run lint:fix
npm run format
npm run format:check
```

- `npm run build` delegates to the frontend production build.
- `npm test` runs backend pytest plus frontend TypeScript checking.
- `npm run lint` only runs the frontend ESLint script; backend linting is separate via Ruff.

### Backend (`backend/`)

```bash
poetry install
poetry run uvicorn ala.main:app --reload --host 0.0.0.0 --port 8000

poetry run pytest tests/ -v
poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
poetry run pytest tests/test_trace_analyzer.py::TestTraceFilter::test_filter_by_pid -v
poetry run pytest tests/test_code_scanner.py::test_discover_context_docs_finds_known_files -v

poetry run ruff check src/
poetry run ruff format --check src/
```

### Frontend (`frontend/`)

```bash
npm install
npm run dev
npm run build
npm run lint
npm run lint:fix
npm run type-check
```

## High-level architecture

### Request flow

1. The frontend uses relative `/api` and `/health` paths; `frontend/vite.config.ts` proxies them to `http://localhost:8000` during local development.
2. `backend/src/ala/main.py` creates the FastAPI app, registers the REST routers, and mounts the FastMCP HTTP app at `/mcp`.
3. Frontend network code is centralized under `frontend/src/api/`; keep request and streaming logic there instead of adding ad hoc `fetch` calls in components.

### Logs pipeline

- `backend/src/ala/api/logs.py` delegates parsing and filtering to `ala.services.log_analyzer.LogAnalyzer`.
- Log upload supports plain text, `.gz`, and `.zip`; ZIP uploads can expand into multiple logical log files.
- The preferred frontend path for large logs is `POST /api/logs/parse/stream`, consumed by `parseLogStream()` in `frontend/src/api/logs.ts`.
- The log stream is NDJSON: each line is a `LogEntry`, followed by a final `{ "_done": true, "total": N }` sentinel.
- Parsed entries include `source_file`; preserve it when changing log parsing, types, or filters.

### Trace pipeline

- Trace parsing and filtering live in `backend/src/ala/api/trace.py` and `ala.services.trace_analyzer`.
- The frontend first uploads with `parseTrace()`, then sends the returned parsed result back through `filterTrace()` for PID or process-name filtering.
- Process-name filtering is regex-based and case-insensitive.

### AI chat, projects, and runtime config

- Chat endpoints in `backend/src/ala/api/chat.py` stream responses as SSE; the frontend consumes them via `streamSSE()` and `sendMessage()`.
- `SessionManager` stores chat sessions, attached log entries, attached trace summaries, and provider-specific raw API history in memory only.
- Project support in `backend/src/ala/api/projects.py` and `ala.services.code_scanner` can scan source trees for logging patterns and auto-discover context docs such as `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`.
- AI defaults come from `backend/src/ala/config.py`, can be overridden at runtime via `PUT /api/config`, and are also cached by the frontend in `localStorage`.

### Packaged app behavior

- When the backend runs as a PyInstaller-built executable, `backend/src/ala/main.py` serves the bundled frontend SPA and `backend/src/ala/config.py` also reads a `.env` file placed next to the executable.
- The MCP server is part of the same FastAPI lifecycle and is exposed at `http://localhost:8000/mcp`; do not model it as a separate long-running service unless the architecture changes.

## Key conventions

- Keep `frontend/src/types/index.ts` aligned with the backend Pydantic models. If an API shape changes, update both sides together.
- All user-facing frontend strings should go through `useTranslation()` and be added to both locale files under `frontend/src/i18n/locales/`.
- Reuse the helpers in `frontend/src/api/client.ts`: `apiFetch()` for JSON, `apiUpload()` / `apiUploadMulti()` for multipart uploads, `streamUploadNDJSON()` / `streamNDJSON()` for NDJSON, and `streamSSE()` for chat streaming.
- UI persistence uses stable `localStorage` keys: `ala_language`, `ala_theme`, `ala_filter_presets`, and `aiConfig`.
- Log filters use a draft/apply flow in `frontend/src/components/AppSider.tsx`: editing fields updates `pendingFilters`, and the active view should not change until Apply or an explicit preset/import action.
- `GET /api/config` masks the API key as `***`; treat that response as display-only and preserve the real key on updates when the client echoes the mask back.
- Backend chat sessions and runtime AI config are process-local memory, so they reset on backend restart.
- The Projects feature intentionally treats repo instruction files as runtime AI context. Changes to `AGENTS.md`, `.github/copilot-instructions.md`, or similar files can affect AI behavior inside the app.

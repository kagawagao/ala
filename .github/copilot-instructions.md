# Copilot Instructions for ALA

ALA is a full-stack Android log and Perfetto trace analyzer. The repository is a workspace root that orchestrates a Python FastAPI backend in `backend/` and a React + Vite frontend in `frontend/`.

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

Notes:

- `npm run build` delegates to the frontend production build.
- `npm test` runs `npm run test:backend` and `npm run test:frontend`.
- `npm run test:frontend` is a TypeScript check, not a UI test suite.
- `npm run lint` only runs the frontend ESLint script; backend linting is separate via Ruff.

### Backend (`backend/`)

```bash
poetry install
poetry run uvicorn ala.main:app --reload --host 0.0.0.0 --port 8000

poetry run pytest tests/ -v
poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
poetry run pytest tests/test_trace_analyzer.py::TestTraceFilter::test_filter_by_pid -v

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

1. The Vite frontend talks to the backend through relative `/api` and `/health` paths; `frontend/vite.config.ts` proxies those requests to `http://localhost:8000` in development.
2. `backend/src/ala/main.py` creates the FastAPI app, registers the REST routers, and mounts the FastMCP HTTP app at `/mcp`.
3. Frontend network code is centralized in `frontend/src/api/`. Keep request/response changes there instead of scattering `fetch` calls through components.

### Logs pipeline

- The backend log API lives in `backend/src/ala/api/logs.py` and delegates to `ala.services.log_analyzer.LogAnalyzer`.
- Log upload supports plain text, `.gz`, and `.zip`; ZIPs can expand into multiple logical log files.
- The preferred frontend path for large logs is `POST /api/logs/parse/stream`, consumed through `parseLogStream()` in `frontend/src/api/logs.ts`.
- The streaming response is NDJSON: each line is a `LogEntry`, followed by a final `{ "_done": true, "total": N }` sentinel.
- Parsed log entries carry `source_file`, so preserve that field when changing log models or filters.

### Trace pipeline

- Trace parsing and filtering live in `backend/src/ala/api/trace.py` and `ala.services.trace_analyzer`.
- The frontend first uploads a trace with `parseTrace()`, then sends the returned parsed result back to `filterTrace()` for PID/process-name filtering.
- Process-name filtering is regex-based and case-insensitive.

### AI chat and config flow

- Chat endpoints are in `backend/src/ala/api/chat.py`; responses stream over `text/event-stream`.
- Frontend chat uses `streamSSE()` in `frontend/src/api/client.ts` and `sendMessage()` in `frontend/src/api/chat.ts`.
- Chat sessions are managed by `SessionManager` in `backend/src/ala/services/session_manager.py` and are in-memory only.
- AI config defaults come from `backend/src/ala/config.py`, can be overridden at runtime via `PUT /api/config`, and the frontend also caches config in `localStorage`.

### MCP integration

- The backend starts the MCP server as part of the FastAPI app lifecycle.
- The MCP endpoint is `http://localhost:8000/mcp`; do not add a separate MCP process unless the architecture changes.

## Key conventions

- The current repository is **not** the older Electron/TypeScript app. Use the real workspace split: Python backend + Vite frontend.
- Keep frontend API types in `frontend/src/types/index.ts` aligned with the backend Pydantic models. When an API response changes, update both sides together.
- All user-facing frontend strings should go through `useTranslation()` and be added to both locale files under `frontend/src/i18n/locales/`.
- Frontend API calls should reuse helpers from `frontend/src/api/client.ts`:
  - `apiFetch()` for JSON requests
  - `apiUpload()` / `apiUploadMulti()` for multipart uploads
  - `streamUploadNDJSON()` for log streaming
  - `streamSSE()` for chat streaming
- UI preferences and cached config use stable `localStorage` keys: `ala_language`, `ala_theme`, `ala_filter_presets`, and `aiConfig`.
- Log filters are applied with a draft/apply flow in `AppSider`: editing fields updates `pendingFilters`, and nothing should affect the active view until Apply is triggered.
- The backend config API masks the API key on `GET /api/config`; do not treat the returned value as a reusable secret.
- Backend sessions and runtime AI config are process-local memory, so they reset when the backend restarts.

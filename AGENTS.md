# AGENTS.md — ALA (Android Log Analyzer)

## Project Overview

ALA is a full-stack AI-powered Android log and Perfetto trace analyzer.

- **Backend**: Python 3.12+ FastAPI server with Poetry (`backend/`)
- **Frontend**: React 19 + Vite 6 + Ant Design 6 + TypeScript 5 (`frontend/`)
- **Repository**: monorepo at `https://github.com/kagawagao/ala`, license MIT
- **Version**: 1.1.0

## Repository Layout

```
ala/
├── AGENTS.md               # This file
├── README.md               # User-facing docs (features, quick start, API reference)
├── CHANGELOG.md             # Auto-generated changelog via Conventional Commits
├── package.json             # Workspace root (npm scripts, prettier, husky, commitlint)
├── docker-compose.yml       # Production Docker deployment (2 services)
│
├── backend/                 # Python FastAPI backend
│   ├── src/ala/             # Application package
│   │   ├── main.py          # FastAPI app creation & router registration
│   │   ├── config.py        # Pydantic Settings (env vars, AI defaults)
│   │   ├── api/             # REST routers (chat, config, health, logs, projects, trace)
│   │   ├── services/        # Business logic (ai_service, agent_tools, log_analyzer,
│   │   │                    #   trace_analyzer, session_manager, project_manager, code_scanner)
│   │   └── mcp/             # FastMCP server (MCP protocol tools)
│   ├── tests/               # pytest suite (pytest + pytest-asyncio)
│   ├── ala_server.py         # PyInstaller entry point for standalone executable
│   ├── ala.spec              # PyInstaller spec
│   ├── Dockerfile            # Backend Docker image
│   ├── pyproject.toml        # Poetry config, ruff config, pytest config
│   └── .env.example          # Environment variables template
│
├── frontend/                # React + Vite + Ant Design frontend
│   ├── src/
│   │   ├── api/             # HTTP client (fetch + SSE streaming helpers)
│   │   ├── components/      # React components (AiPanel, FileUpload, LogViewer,
│   │   │                    #   TraceViewer, ProjectManager, ModelManager, etc.)
│   │   ├── i18n/            # i18next config + locale files (en.json, zh.json)
│   │   ├── types/           # TypeScript type definitions (mirrors backend Pydantic models)
│   │   └── utils/           # Filters, models helpers
│   ├── index.html            # Vite entry HTML
│   ├── vite.config.ts        # Vite config with dev proxy to localhost:8000
│   ├── Dockerfile            # Frontend Docker image (Nginx serving built assets)
│   └── nginx.conf            # Nginx reverse proxy config
│
├── scripts/                 # Convenience scripts
│   ├── ala.sh               # Linux/macOS wrapper (install, dev, build, deploy)
│   ├── ala.ps1              # Windows PowerShell wrapper
│   └── build-exe.sh         # Standalone executable build script
│
├── examples/                # Sample log files for testing
├── assets/                  # Icons and branding
└── skills/                  # Project-level Agent Skills (for Hermes/Claude SDK)
```

## Development Commands

### Setup

```bash
# Full install (workspace root + backend + frontend)
npm run install:all

# Or manually:
npm install                          # Root workspace tools
cd backend && poetry install && cd ..  # Python backend
cd frontend && npm install && cd ..    # Frontend
```

### Run Dev Servers

```bash
npm run dev   # Starts backend (port 8000) + frontend (port 5173) via concurrently
```

Dev proxy: the Vite dev server proxies `/api` and `/health` requests to `http://localhost:8000`.

### Build

```bash
npm run build             # Build frontend for production (tsc + vite build)
npm run build:exe         # Build standalone executable via PyInstaller (macOS/Linux)
```

### Test

```bash
npm test                  # Runs backend tests + frontend type-check
npm run test:backend      # pytest tests/ -v
npm run test:frontend     # tsc --noEmit (type-check, not a UI test suite)
```

Run a single test:

```bash
cd backend
poetry run pytest tests/test_log_analyzer.py::TestLogParsing::test_parse_android_logcat -v
poetry run pytest tests/test_trace_analyzer.py::TestTraceFilter::test_filter_by_pid -v
```

### Lint & Format

```bash
# Frontend
npm run lint              # ESLint frontend only
npm run lint:fix          # ESLint auto-fix

# All files
npm run format            # Prettier format all supported files
npm run format:check      # Prettier check only

# Backend (separate — must run from backend/)
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

1. Vite frontend → `/api/*` or `/health` → Vite proxy (dev) or Nginx (prod) → `localhost:8000`
2. `backend/src/ala/main.py` creates the FastAPI app, mounts routers, and mounts FastMCP at `/mcp`
3. Frontend API logic is centralized in `frontend/src/api/` — do not scatter `fetch` calls across components

### Logs Pipeline

- Backend: `ala.api.logs` → `ala.services.log_analyzer.LogAnalyzer`
- Upload supports plain text, `.gz`, and `.zip` (ZIPs expand to multiple log files)
- **Streaming parse**: `POST /api/logs/parse/stream` returns NDJSON — each line is a `LogEntry`, final line is `{ "_done": true, "total": N }` sentinel
- Frontend consumes via `parseLogStream()` in `frontend/src/api/logs.ts`
- Parsed entries carry `source_file` — **always preserve this field** when changing log models
- Filters: time range, keyword regex, log level, tag regex, PID, TID
- Filter presets saved to `localStorage` key: `ala_filter_presets`
- **Draft/apply pattern**: editing filter fields updates `pendingFilters`; nothing changes the active view until Apply is triggered

### Trace Pipeline

- Backend: `ala.api.trace` → `ala.services.trace_analyzer`
- Frontend: first `parseTrace()` (upload), then `filterTrace()` (filter by PID/process name) on the parsed result
- Process-name filtering is **regex-based and case-insensitive**

### AI Chat & Config

- Chat endpoints in `backend/src/ala/api/chat.py`; responses stream over `text/event-stream`
- Frontend: `streamSSE()` in `client.ts`, `sendMessage()` in `chat.ts`
- Sessions managed by `SessionManager` — **in-memory only**, lost on backend restart
- AI config defaults from `backend/src/ala/config.py`, overridable at runtime via `PUT /api/config`
- Frontend caches AI config in `localStorage` key: `aiConfig`
- `GET /api/config` **masks the API key** — do not treat the returned value as a reusable secret
- Agentic analysis: AI uses tools (`query_log_overview`, `search_logs`, `list_log_files`, `query_trace_overview`, `list_trace_processes`, `query_trace_slices`) to explore loaded data
- Supports "extended thinking" (think mode) for deeper reasoning

### MCP Integration

- MCP server starts as part of the FastAPI lifecycle — **no separate process needed**
- Endpoint: `http://localhost:8000/mcp` (Streamable HTTP transport, MCP 1.0)
- Tools: `parse_android_log`, `filter_android_logs`, `get_log_statistics`, `parse_perfetto_trace`, `filter_perfetto_trace`

### Projects Feature

- Source code directories can be registered as "projects" for AI-assisted analysis
- `code_scanner.py` discovers logging patterns in project source files
- AI-generated filter presets suggest log filters based on project code
- Context documents (`AGENTS.md`, `CLAUDE.md`, etc.) auto-injected into AI system prompt

### Standalone Executable

- Build via `bash scripts/build-exe.sh` (macOS/Linux) or `.\scripts\ala.ps1 exe` (Windows)
- Process: compile frontend → bundle backend + static files with PyInstaller
- Output: `backend/dist/ala/` — distribute the entire directory
- The executable opens the default browser automatically when running frozen
- Platform-specific: build on each target OS
- Users can place a `.env` file next to the executable to configure AI credentials

## Code Conventions

### TypeScript ↔ Python Alignment

Keep `frontend/src/types/index.ts` in sync with backend Pydantic models. When an API response shape changes, update **both sides together**.

### i18n

All user-facing frontend strings must go through `useTranslation()`. Add translations to both:

- `frontend/src/i18n/locales/en.json`
- `frontend/src/i18n/locales/zh.json`

Language auto-detected from browser locale.

### Frontend API Helpers

Use the centralized helpers from `frontend/src/api/client.ts`:

- `apiFetch()` — JSON request/response
- `apiUpload()` / `apiUploadMulti()` — multipart file uploads
- `streamUploadNDJSON()` — log streaming
- `streamSSE()` — chat streaming

### Git Workflow

- **Conventional Commits** enforced via commitlint + Husky
- Pre-commit hooks: ESLint + Prettier format check
- Commit-msg hook: commitlint

### Backend Config

Environment variables (from `backend/.env` or `.env` next to executable):

- `AI_API_ENDPOINT` — default `https://api.anthropic.com`
- `AI_API_KEY` — API key for AI service
- `AI_MODEL` — default `claude-sonnet-4-20250514`
- `AI_TEMPERATURE` — default `0.7`
- `AI_THINKING_MODE` — `off`, `auto`, or `on`
- `LOG_LEVEL` — `DEBUG`, `INFO`, `WARNING`, `ERROR`

Supports any OpenAI-compatible API (Ollama, LM Studio, Azure OpenAI, etc.).

## Dependencies

### Backend (Python)

- FastAPI, Uvicorn, python-multipart
- FastMCP (MCP protocol server)
- Pydantic, Pydantic-settings, python-dotenv
- httpx, sse-starlette
- perfetto (trace processing)
- anthropic, openai (AI providers)
- Dev: pytest, pytest-asyncio, ruff, PyInstaller

### Frontend (Node.js)

- React 19, React Router 7
- Ant Design 6, @ant-design/icons, @ant-design/x
- i18next, react-i18next
- react-markdown, remark-gfm
- TypeScript 5, Vite 6

### Root workspace

- concurrently, cross-env
- prettier, husky, @commitlint/cli + config-conventional

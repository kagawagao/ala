# AGENTS.md — ALA (Android Log Analyzer)

## Project Overview

ALA is a full-stack AI-powered Android log and Perfetto trace analyzer.

- **Backend**: Python 3.12+ FastAPI server managed with Poetry (`backend/`)
- **Frontend**: React 19 + Vite 6 + Ant Design 6 + TypeScript 5 (`frontend/`)
- **Repository**: monorepo at `https://github.com/kagawagao/ala`, license MIT
- **Version**: 1.1.0

## Repository Layout

```
ala/
├── AGENTS.md                   # This file
├── README.md                   # User-facing docs (features, quick start, API ref)
├── CHANGELOG.md                # Auto-generated via Conventional Commits
├── package.json                # Workspace root (npm scripts, prettier, husky, commitlint)
├── docker-compose.yml          # Production Docker (backend :8000 + frontend Nginx :80)
├── .prettierrc.json            # Formatter config (see Code Style below)
├── .prettierignore
├── commitlint.config.mjs       # Extends @commitlint/config-conventional
├── skills-lock.json            # Lockfile for project-agent-skills (antd skill)
│
├── backend/                    # Python FastAPI backend
│   ├── src/ala/                # Application package
│   │   ├── main.py             # FastAPI app lifecycle, router registration, MCP mount,
│   │   │                       #   frozen-mode SPA serving
│   │   ├── config.py           # Pydantic Settings (env vars, AI defaults)
│   │   ├── logging_config.py   # Centralised logging: TimedRotatingFileHandler + console
│   │   ├── api/                # REST routers
│   │   │   ├── chat.py         # Chat sessions & SSE streaming messages
│   │   │   ├── config.py       # AI config GET/PUT (key masked on read)
│   │   │   ├── health.py       # /health endpoint
│   │   │   ├── logs.py         # Log parse/stream/filter/statistics
│   │   │   ├── projects.py     # Project CRUD, file listing, AI filter generation
│   │   │   └── trace.py        # Trace parse/filter
│   │   ├── services/           # Business logic
│   │   │   ├── ai_service.py   # AI provider abstraction (OpenAI/Anthropic)
│   │   │   ├── agent_tools.py  # Tool definitions for agentic log/trace exploration
│   │   │   ├── log_analyzer.py # Log parsing engine
│   │   │   ├── trace_analyzer.py # Trace parsing engine (perfetto wrapper)
│   │   │   ├── session_manager.py # In-memory chat session store
│   │   │   ├── project_manager.py # Project persistence
│   │   │   └── code_scanner.py # Source code pattern discovery
│   │   └── mcp/                # FastMCP server
│   │       └── server.py       # MCP tools for external AI clients
│   ├── tests/                  # pytest suite (pytest + pytest-asyncio, asyncio_mode=auto)
│   │   ├── test_log_analyzer.py
│   │   ├── test_trace_analyzer.py
│   │   └── test_code_scanner.py
│   ├── ala_server.py           # PyInstaller entry point (opens browser when frozen)
│   ├── ala.spec                # PyInstaller build spec
│   ├── Dockerfile              # Backend image (uvicorn)
│   ├── pyproject.toml          # Poetry + Ruff + pytest config
│   └── .env.example            # Environment template (OpenAI endpoint by default)
│
├── frontend/                   # React + Vite + Ant Design SPA
│   ├── src/
│   │   ├── api/                # Centralised HTTP client
│   │   │   ├── client.ts       # apiFetch, apiUpload, streamUploadNDJSON, streamSSE
│   │   │   ├── chat.ts         # sendMessage (SSE streaming)
│   │   │   ├── config.ts       # AI config API
│   │   │   ├── logs.ts         # parseLog, parseLogStream, filterLogs, getStats
│   │   │   ├── projects.ts     # Project CRUD, file listing, AI filter generation
│   │   │   └── trace.ts        # parseTrace, filterTrace
│   │   ├── components/         # React UI components
│   │   │   ├── AiPanel.tsx     # Chat panel with streaming, preset analysis modes
│   │   │   ├── LogViewer.tsx   # Virtualised log table with colour-coded levels
│   │   │   ├── TraceViewer.tsx # Virtualised trace slice viewer
│   │   │   ├── FileUpload.tsx  # Drag-and-drop multi-file upload (supports .gz/.zip)
│   │   │   ├── AppSider.tsx    # Sidebar: filters, presets, draft/apply flow
│   │   │   ├── ProjectManager.tsx  # Project CRUD UI
│   │   │   ├── ModelManager.tsx    # AI model & endpoint configuration
│   │   │   ├── DirectoryFilePicker.tsx  # Browse local directories
│   │   │   └── Header.tsx      # Top bar (settings, theme, language toggle)
│   │   ├── i18n/               # i18next setup
│   │   │   ├── config.ts       # i18next init
│   │   │   └── locales/        # en.json, zh.json
│   │   ├── types/index.ts      # TypeScript types (mirrors backend Pydantic models)
│   │   ├── utils/
│   │   │   ├── filters.ts      # Filter presets (localStorage)
│   │   │   └── models.ts       # AI model helpers
│   │   ├── App.tsx             # Root component with React Router
│   │   └── main.tsx            # React entry point
│   ├── index.html              # Vite entry
│   ├── vite.config.ts          # Dev proxy → localhost:8000, build → dist/
│   ├── tsconfig.json           # References tsconfig.app.json + tsconfig.node.json
│   ├── tsconfig.app.json       # Strict mode, ESNext modules, React JSX
│   ├── eslint.config.js        # typescript-eslint + react-hooks + react-refresh
│   ├── Dockerfile              # Multi-stage: build → Nginx serve
│   └── nginx.conf              # Reverse proxy to backend:8000
│
├── scripts/                    # Convenience wrappers
│   ├── ala.sh                  # Linux/macOS (install/dev/build/deploy)
│   ├── ala.ps1                 # Windows PowerShell
│   └── build-exe.sh            # Standalone PyInstaller build
│
├── examples/                   # Sample log files
├── assets/                     # Icons (icon.png, icon.svg, logo.svg)
└── skills/                     # Project-agent skills (managed via skills-lock.json)
```

> **Note on root `dist/`**: The `dist/` directory at repo root contains Electron build artifacts
> from an earlier architecture (`main.js`, `preload.js`, `renderer/`). This is legacy — the
> current architecture is _not_ Electron-based. Do not use or modify these files.

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

The Vite dev server proxies `/api` and `/health` to `http://localhost:8000`.

### Build

```bash
npm run build             # Production frontend build (tsc --noEmit + vite build → dist/)
npm run build:exe         # Standalone executable via PyInstaller (macOS/Linux, see below)
```

### Test

```bash
npm test                  # Backend pytest + frontend type-check
npm run test:backend      # cd backend && poetry run pytest tests/ -v
npm run test:frontend     # cd frontend && tsc --noEmit (type-check only; no UI tests)
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
npm run lint              # ESLint (frontend only)
npm run lint:fix          # ESLint auto-fix

# All files
npm run format            # Prettier format
npm run format:check      # Prettier check-only (CI)

# Backend
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
2. `backend/src/ala/main.py` creates the FastAPI app, registers routers, mounts FastMCP at `/mcp`
3. When frozen (PyInstaller): FastAPI also serves the React SPA directly — a catch-all `/{full_path:path}` returns `index.html` for client-side routing
4. All frontend API calls go through `frontend/src/api/` — never scatter `fetch` across components

### Logging System (Backend)

Initialised in `main.py` via `setup_logging()` from `logging_config.py`:

- **Console handler** (stderr) — always active
- **TimedRotatingFileHandler** — daily rotation, 30-day retention, written to `settings.log_dir` (default: `logs/`)
- Log format: `%(asctime)s [%(levelname)s] %(name)s: %(message)s` (ISO 8601 timestamps)
- Suppressed verbose loggers at DEBUG: `httpcore`, `httpx`, `anthropic`, `openai`
- Suppressed at INFO: `uvicorn.access`
- Modules get loggers with `logging.getLogger(__name__)`
- File logging is non-fatal — if the log directory is unwritable (read-only fs, container without volume), it falls back to console-only

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
- Mounted at `/mcp` (Streamable HTTP transport, MCP 1.0)
- Tools: `parse_android_log`, `filter_android_logs`, `get_log_statistics`, `parse_perfetto_trace`, `filter_perfetto_trace`

### Projects Feature

- Source code directories can be registered as "projects" for AI-assisted analysis
- `code_scanner.py` discovers logging patterns (`Log.d/i/w/e`, process names, error keywords) in project source files
- AI-generated filter presets suggest log filters based on project code (`POST /api/projects/:id/generate-filters`, SSE stream)
- Context documents (`AGENTS.md`, `CLAUDE.md`, etc.) in the project directory are auto-injected into the AI system prompt

### Standalone Executable

- Build via `bash scripts/build-exe.sh` (macOS/Linux) or `.\scripts\ala.ps1 exe` (Windows)
- Process: compile frontend (`tsc + vite build`) → bundle backend + static files with PyInstaller → `backend/dist/ala/`
- **Distribute the entire `backend/dist/ala/` directory** — the executable needs sibling files
- When running frozen (`sys.frozen`), the executable:
  - Opens the default browser automatically (`http://localhost:8000`)
  - Serves the React SPA directly from `frontend_dist/` in `sys._MEIPASS`
  - Binds to `127.0.0.1` (not `0.0.0.0`) for local-only access
  - Looks for `.env` next to the executable for AI credentials
- Platform-specific: build on each target OS

### Agent Skills

The `skills/` directory holds project-level agent skills managed via `skills-lock.json`.
Currently locked: `antd` (from `ant-design/ant-design-cli` on GitHub). These provide
specialised guidance for agentic coding tools working on this repository.

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

### localStorage Keys

| Key                  | Purpose                         |
| -------------------- | ------------------------------- |
| `ala_language`       | UI language preference          |
| `ala_theme`          | Dark/light theme preference     |
| `ala_filter_presets` | Saved log filter presets        |
| `aiConfig`           | Cached AI endpoint/model config |

### Git Workflow

- **Conventional Commits** enforced via `@commitlint/config-conventional` + Husky
- Pre-commit hook: ESLint + Prettier format check
- Commit-msg hook: commitlint
- Version bumps auto-generate CHANGELOG.md

### Backend Configuration

Environment variables (loaded from `backend/.env`, or `.env` next to frozen executable):

| Variable                    | Default                        | Description                            |
| --------------------------- | ------------------------------ | -------------------------------------- |
| `HOST`                      | `0.0.0.0` (`127.0.0.1` frozen) | Server bind address                    |
| `PORT`                      | `8000`                         | Server port                            |
| `DEBUG`                     | `false`                        | Debug mode (enables auto-reload)       |
| `CORS_ORIGINS`              | JSON array                     | Allowed origins                        |
| `LOG_LEVEL`                 | `INFO`                         | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `LOG_DIR`                   | `logs`                         | Rotating log file directory            |
| `AI_API_ENDPOINT`           | `https://api.anthropic.com`    | AI provider base URL                   |
| `AI_API_KEY`                | (empty)                        | API key                                |
| `AI_MODEL`                  | `claude-sonnet-4-20250514`     | Model name                             |
| `AI_TEMPERATURE`            | `0.7`                          | Sampling temperature                   |
| `AI_THINKING_MODE`          | `off`                          | `off` / `auto` / `on`                  |
| `AI_THINKING_BUDGET_TOKENS` | `8000`                         | Max tokens for think mode              |

Supports any OpenAI-compatible API (Ollama, LM Studio, Azure OpenAI, etc.).

> **Heads-up**: `backend/.env.example` defaults to `https://api.openai.com/v1` and
> `gpt-4o-mini`, but `config.py` defaults to Anthropic. The `.env.example` is a
> starter for OpenAI users; the code default is Anthropic.

## Dependencies

### Backend (Python)

- FastAPI, Uvicorn, python-multipart, sse-starlette
- FastMCP (MCP protocol server)
- Pydantic, Pydantic-settings, python-dotenv
- httpx, perfetto
- anthropic, openai
- Dev: pytest, pytest-asyncio, ruff, PyInstaller, pyinstaller-hooks-contrib

### Frontend (Node.js)

- React 19, React Router 7
- Ant Design 6, @ant-design/icons, @ant-design/x (AI chat components)
- i18next, react-i18next
- react-markdown, remark-gfm (GitHub-flavoured Markdown rendering)
- TypeScript 5, Vite 6

### Root workspace

- concurrently (parallel dev servers), cross-env (portable env vars)
- prettier, husky, @commitlint/cli + @commitlint/config-conventional

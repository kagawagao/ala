# ALA — Android Log Analyzer

A full-stack tool for analyzing **Android logcat** files and **Perfetto trace** files, powered by AI.

## Architecture

```
ala/
├── backend/          # Python FastAPI backend
│   ├── src/ala/      # Application source
│   │   ├── api/      # REST endpoints (logs, trace, chat, config)
│   │   ├── services/ # Business logic (log analyzer, trace analyzer, AI, sessions)
│   │   └── mcp/      # FastMCP server (MCP protocol support)
│   └── tests/        # pytest test suite
└── frontend/         # React + Vite + Ant Design frontend
    └── src/
        ├── api/       # HTTP client (fetch + SSE streaming)
        ├── components/ # React UI components
        └── i18n/      # Translations (en/zh)
```

## Features

- **Android Log Analysis** — Parse, filter, and search Android logcat files
  - Support for `android_logcat`, `generic_timestamped`, and unknown formats
  - Filters: time range, keywords (regex), log level, tag (regex), PID, TID
  - Filter presets (save/load/delete)
  - Color-coded log levels
- **Perfetto Trace Analysis** — Analyze Perfetto `.pb` and JSON trace files
  - Extract process/thread/event summary
  - Top slices by duration
  - FTrace events
- **AI Assistant** — Multi-turn conversation with streaming responses
  - Analysis presets: General, Crash, Performance, Security
  - Attach log/trace data as conversation context
  - Session management (create, rename, delete)
  - OpenAI-compatible API (works with OpenAI, Ollama, Azure, etc.)
- **MCP Server** — Expose log and trace analysis tools via Model Context Protocol
  - `parse_android_log`, `filter_android_logs`, `get_log_statistics`, `parse_perfetto_trace`
- **i18n** — English and Chinese (中文) UI
- **Dark/light theme**

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+

### Development

```bash
# Install root workspace tools
npm install

# Install backend dependencies
cd backend && pip install -e ".[dev]" && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start both backend and frontend in parallel
npm run dev
```

The frontend will be available at `http://localhost:5173` and the backend at `http://localhost:8000`.

### Docker

```bash
# Copy environment file
cp backend/.env.example backend/.env
# Edit backend/.env to set your AI API key

# Start with Docker Compose
docker-compose up -d
```

The app will be available at `http://localhost`.

## Configuration

### AI Settings

Configure AI settings in the UI (Settings button) or via environment variables in `backend/.env`:

```env
AI_API_ENDPOINT=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
AI_TEMPERATURE=0.7
```

The backend also supports any OpenAI-compatible API (Ollama, LM Studio, Azure OpenAI, etc.).

### MCP Server

The MCP server runs automatically with the FastAPI backend. To use it with an MCP client:

```bash
cd backend
python -m ala.mcp.server
```

Available MCP tools:

- `parse_android_log(log_content)` — Parse Android logcat text
- `filter_android_logs(log_content, level, tag, keywords, ...)` — Filter logs
- `get_log_statistics(log_content)` — Get log statistics
- `parse_perfetto_trace(trace_file_path)` — Parse a Perfetto trace file

## Development

### Backend

```bash
cd backend

# Run tests
python -m pytest tests/ -v

# Start dev server
python -m uvicorn ala.main:app --reload --port 8000

# Lint
ruff check src/
ruff format --check src/
```

### Frontend

```bash
cd frontend

# Dev server
npm run dev

# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build
```

### Code Quality

```bash
# From workspace root:

# Lint frontend
npm run lint

# Format all files
npm run format

# Check format
npm run format:check
```

Git hooks (via Husky):

- **pre-commit**: ESLint + Prettier format check
- **commit-msg**: commitlint (Conventional Commits)

## API Reference

| Method    | Path                              | Description                      |
| --------- | --------------------------------- | -------------------------------- |
| `GET`     | `/health`                         | Health check                     |
| `GET/PUT` | `/api/config`                     | AI configuration                 |
| `POST`    | `/api/logs/parse`                 | Parse log file (multipart)       |
| `POST`    | `/api/logs/filter`                | Filter log entries               |
| `POST`    | `/api/logs/statistics`            | Get log statistics               |
| `POST`    | `/api/trace/parse`                | Parse Perfetto trace (multipart) |
| `POST`    | `/api/chat/sessions`              | Create chat session              |
| `GET`     | `/api/chat/sessions`              | List chat sessions               |
| `GET`     | `/api/chat/sessions/:id`          | Get session with messages        |
| `DELETE`  | `/api/chat/sessions/:id`          | Delete session                   |
| `POST`    | `/api/chat/sessions/:id/messages` | Send message (SSE stream)        |

## License

MIT — see [LICENSE](./LICENSE)

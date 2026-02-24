# Copilot Instructions for ALA

## Repository Overview

ALA (Android Log Analyzer) is an Electron-based desktop application for parsing, filtering, and analyzing Android logcat files with AI-powered insights. It is written in TypeScript with a React renderer and a Node.js backend.

## Tech Stack

- **Language**: TypeScript 5.9+
- **UI**: React 19+, Ant Design (antd) 6+, `@ant-design/x`
- **Desktop shell**: Electron 28+
- **Bundler**: Webpack 5 (renderer), `tsc` (main/backend)
- **Internationalization**: i18next + react-i18next (languages: `en` and `zh`)
- **AI integration**: OpenAI API via the `openai` npm package
- **Linting/formatting**: ESLint (TypeScript + React rules) + Prettier

## Project Structure

```
src/
  main.ts          – Electron main process; IPC handlers, file I/O
  preload.ts       – Context-bridge: exposes `window.electronAPI` to renderer
  backend/
    log-analyzer.ts – Log parsing, filtering, statistics (pure Node.js, no Electron)
    ai-service.ts   – OpenAI integration
  renderer/
    index.tsx      – React entry point
    App.tsx        – Root component; Layout (Header + AppSider + LogViewer)
    types.ts       – Shared TypeScript interfaces (LogEntry, LogFilters, …)
    components/    – React components (Header, AppSider, LogViewer, …)
    i18n/          – i18next translation files
test/
  test-backend.ts  – Backend unit tests (no Electron)
```

## Architecture

The app follows the standard Electron split:

1. **Main process** (`src/main.ts`): registers IPC handlers, opens files via `dialog`, and delegates to backend services.
2. **Preload** (`src/preload.ts`): bridges renderer ↔ main with `contextBridge`, exposing `window.electronAPI`.
3. **Renderer** (`src/renderer/`): a React SPA bundled by Webpack. Communicates with the main process only through `window.electronAPI`.
4. **Backend** (`src/backend/`): pure TypeScript modules imported by the main process; can also be imported directly in tests.

## Key Interfaces

- `LogEntry` – a single parsed log line (timestamp, pid, tid, level, tag, message, rawLine, sourceFile, lineNumber).
- `LogFilters` – filter state (startTime, endTime, keywords, highlights, level, tag, pid).
- `window.electronAPI` – IPC surface exposed to the renderer (see `src/renderer/types.ts`).

## Development Commands

```bash
npm install            # install dependencies

# Development
npm run dev            # build + launch Electron in dev mode (with auto-reload)
npm run watch          # watch and rebuild TypeScript + webpack in parallel

# Building
npm run build:ts       # compile TypeScript (main + backend)
npm run build:renderer # bundle React renderer with webpack (production)
npm run build          # full production build (icon + tsc + webpack + electron-builder)

# Testing
npm test               # build test bundle and run backend unit tests

# Code quality
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
```

## Coding Conventions

- **TypeScript everywhere** – avoid `any`; use explicit types and interfaces.
- **React functional components** with hooks; no class components.
- **Ant Design** is the component library. Use antd components and patterns (Form, Form.Item, Select, etc.) instead of raw HTML where possible.
- **i18n**: all user-facing strings must use `t('key')` from `react-i18next`. Add translations to both `en` and `zh` locale files under `src/renderer/i18n/`.
- **No direct DOM access** in the renderer – use React state and refs.
- **IPC**: renderer → main communication goes exclusively through `window.electronAPI`. Do not import Electron modules in renderer code.
- **Persistence**: user preferences are stored in `localStorage` under the keys `ala_language`, `ala_theme`, `ala_filter_presets`, and `aiConfig`.
- **Linting**: ESLint and Prettier are enforced. Run `npm run lint` and `npm run format:check` before committing.
- **Imports**: use relative imports within the same process boundary; avoid deep cross-boundary imports.

## Testing

- Backend tests live in `test/test-backend.ts` and are compiled via `tsconfig.test.json`.
- Tests validate log parsing, filtering, and statistics; there are currently 8 test cases.
- Run with `npm test`.
- There is no renderer test suite yet – do not add renderer tests unless explicitly asked.

## Adding Features

1. **Backend logic** (parsing, filtering, AI) → `src/backend/`
2. **New IPC channel** → add handler in `src/main.ts` and expose it in `src/preload.ts` and `src/renderer/types.ts`
3. **UI components** → `src/renderer/components/`
4. **Translations** → `src/renderer/i18n/` (both `en` and `zh`)

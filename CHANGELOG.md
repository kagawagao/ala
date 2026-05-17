# Changelog

All notable changes to this project will be documented in this file. See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

---

## [2.2.2](https://github.com/kagawagao/ala/compare/v2.2.1...v2.2.2) (2026-05-15)

### Features

- **AI panel:** default sizing for AppContent layout

### Bug Fixes

- **release:** stage PyInstaller output before WiX harvesting to fix Windows MSI packaging ([#76](https://github.com/kagawagao/ala/pull/76))
- **UserGuide:** isFullPage logic and unnecessary style cleanup

---

## [2.2.1](https://github.com/kagawagao/ala/compare/v2.2.0...v2.2.1) (2026-05-15)

### Features

- **user guide:** markdown-based in-app guide with react-markdown rendering, English + Chinese ([#73](https://github.com/kagawagao/ala/pull/73))

### Bug Fixes

- **release:** patch vulnerable artifact extraction action ([#75](https://github.com/kagawagao/ala/pull/75))

### Chores

- **deps:** bump mermaid ([#74](https://github.com/kagawagao/ala/pull/74))

---

## [2.2.0](https://github.com/kagawagao/ala/compare/v2.1.0...v2.2.0) (2026-05-12)

### Features

- **perfetto sql:** query Perfetto traces with SQL via MCP tool + agent tool + TraceAnalyzer.query_sql ([#63](https://github.com/kagawagao/ala/pull/63))
- **model management:** custom model thinking support, enable/disable presets, improved UX ([#64](https://github.com/kagawagao/ala/pull/64))
- **version tag:** display version from `package.json` in the header ([#67](https://github.com/kagawagao/ala/pull/67))
- **filters:** debounced value hook and enhanced filter utility functions
- **timestamp:** conversion utility with tests for log tools

### Bug Fixes

- **mcp:** isolate MCP HTTP app instance per FastAPI app in `create_app()` ([#71](https://github.com/kagawagao/ala/pull/71))
- **ai:** add spacing above thinking blocks after tool calls ([#69](https://github.com/kagawagao/ala/pull/69))
- **antd v6:** upgrade test failures — 67→186 tests passing ([#66](https://github.com/kagawagao/ala/pull/66))

### Refactoring

- Code formatting and import cleanup in tests and session manager
- Post-merge quality iteration: test coverage, SQLite persistence, frontend polish ([#62](https://github.com/kagawagao/ala/pull/62))

### Chores

- **frontend:** suppress ESLint warnings in lint output (error-only mode) ([#72](https://github.com/kagawagao/ala/pull/72))
- **deps:** bump fast-uri ([#65](https://github.com/kagawagao/ala/pull/65))

---

## [2.1.0](https://github.com/kagawagao/ala/compare/v2.0.2...v2.1.0) (2026-05-06)

### Features

- **model management:** backend integration for model management features ([#60](https://github.com/kagawagao/ala/pull/60))
- **export:** CSV/JSON log export buttons in LogViewer toolbar with BOM, RFC 4180 escaping, and i18n support ([#58](https://github.com/kagawagao/ala/pull/58))
- **lazy-log display:** AI tool results from `search_local_log` / `read_log_range` render directly in LogViewer
- **lazy-log cache:** LRU cache (128 entries, 60s TTL) for lazy-log tool results to avoid redundant I/O
- **scan optimization:** `scan_file_meta` early exit with `max_scan_lines` param for large file performance

### Tests

- **frontend:** establish Vitest + Testing Library test infrastructure with jsdom environment
- **frontend:** 25+ unit tests for `detectFileTypeByHeader`, 16 for `processSSEChunk`/`extractToolLogEntries`, 27 for filter functions, 11 for export utilities

### Chores

- **deps:** add vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom
- **i18n:** add `noDataToExport`, `exportCsv`, `exportJson` keys for English and Chinese locales
- **ci:** fix release workflow not triggered when bump-version pushes tag ([#59](https://github.com/kagawagao/ala/pull/59))
- Remove legacy docs and configuration, update pre-commit hooks

---

## [2.0.2](https://github.com/kagawagao/ala/compare/v2.0.1...v2.0.2) (2026-05-05)

### Features

- **lazy local log analysis:** stream-based AI tools, directory support, and model picker consolidation ([#54](https://github.com/kagawagao/ala/pull/54))
- **quality consolidation:** CI/CD, MCP lazy-log tools, spec fixes, observability ([#55](https://github.com/kagawagao/ala/pull/55))

### Bug Fixes

- **ci:** skip Husky pre-commit hook in bump-version workflow ([#57](https://github.com/kagawagao/ala/pull/57))
- **security:** bump minimum versions to patched releases ([#56](https://github.com/kagawagao/ala/pull/56))

### Chores

- **deps:** bump vite, python-multipart, pytest, authlib, fastmcp, cryptography, dompurify, postcss, lodash-es, langium

---

## [2.0.1](https://github.com/kagawagao/ala/compare/v2.0.0...v2.0.1) (2026-04-27)

### Features

- **model management:** add model library with built-in + custom model presets ([#52](https://github.com/kagawagao/ala/pull/52))
- **dual-provider AI:** support both Anthropic (native SDK) and OpenAI-compatible endpoints ([#52](https://github.com/kagawagao/ala/pull/52))
- **extended thinking:** Anthropic extended thinking mode with configurable budget tokens ([#52](https://github.com/kagawagao/ala/pull/52))
- **structured logging:** TimedRotatingFileHandler + console logging with configurable levels ([#52](https://github.com/kagawagao/ala/pull/52))

### Bug Fixes

- **tooling:** various fixes for session management, SSE streaming, and model configuration ([#52](https://github.com/kagawagao/ala/pull/52))

---

## [2.0.0](https://github.com/kagawagao/ala/compare/v1.1.0-alpha.2...v2.0.0) (2026-04-21)

### ⚠️ BREAKING CHANGES

- **architecture:** complete rewrite from Electron to Python FastAPI + Vite/React workspace ([#42](https://github.com/kagawagao/ala/pull/42))

### Features

- **backend:** FastAPI REST API with SSE streaming, Poetry dependency management
- **frontend:** React 19 + Vite 6 + Ant Design 6 + TypeScript 5 SPA
- **perfetto:** full Perfetto trace parsing (.pb / .json) with process/slice/FTrace analysis
- **agentic AI:** multi-turn tool-calling loop with Anthropic + OpenAI tool schemas
- **MCP server:** FastMCP integration exposing log + trace tools via Model Context Protocol
- **projects:** source code project management with AGENTS.md auto-injection
- **sessions:** in-memory chat session store with context attachment
- **i18n:** English + Chinese (中文) UI with auto-detection
- **dark/light theme:** Ant Design ConfigProvider theme switching

### Chores

- bump minimatch from 3.1.2 to 3.1.5 ([#14](https://github.com/kagawagao/ala/pull/14))

---

## [1.1.0-alpha.2](https://github.com/kagawagao/ala/compare/v1.1.0-alpha.1...v1.1.0-alpha.2) (2026-03-19)

### Features

- **changelog:** auto-generate CHANGELOG after version bump with commit linting ([#29](https://github.com/kagawagao/ala/pull/29))

### Bug Fixes

- **ci:** stop electron-builder auto-publish, fix Linux icon generation ([#30](https://github.com/kagawagao/ala/pull/30))

---

## [1.1.0-alpha.1](https://github.com/kagawagao/ala/compare/v1.0.1...v1.1.0-alpha.1) (2026-03-17)

### Features

- **analysis presets:** General, Crash, Performance, Security preset modes ([#21](https://github.com/kagawagao/ala/pull/21))
- **highlights:** colored keyword highlights with right-click context menu ([#20](https://github.com/kagawagao/ala/pull/20))
- **filters:** tag/keyword OR filter, TID filter, compact filter layout ([#26](https://github.com/kagawagao/ala/pull/26))
- **source code upload:** attach source code for AI-assisted analysis ([#21](https://github.com/kagawagao/ala/pull/21))
- **dynamic config:** runtime AI configuration via API ([#21](https://github.com/kagawagao/ala/pull/21))

### Bug Fixes

- **release:** CI failure due to Electron internals in artifacts ([#27](https://github.com/kagawagao/ala/pull/27))
- **context menu:** position and label cleanup ([#25](https://github.com/kagawagao/ala/pull/25))
- **linting:** resolve all linting warnings ([#22](https://github.com/kagawagao/ala/pull/22))

---

## [1.0.1](https://github.com/kagawagao/ala/compare/v1.0.0...v1.0.1) (2026-03-09)

### Performance

- **virtual scrolling:** fix scroll lag on large log files ([#19](https://github.com/kagawagao/ala/pull/19))

---

## [1.0.0](https://github.com/kagawagao/ala/releases/tag/v1.0.0) (2026-03-06)

### Features

- **initial release:** Android logcat parsing and AI-powered analysis
- Electron desktop application with drag-and-drop file upload
- AI chat with streaming responses
- Filter presets (save/load/delete)
- Color-coded log levels

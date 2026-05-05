# Changelog

All notable changes to this project will be documented in this file. See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

---

## [2.0.1](https://github.com/kagawagao/ala/compare/v2.0.0...v2.0.1) (2026-04-23)

### Features

- **model management:** add model library with built-in + custom model presets ([#52](https://github.com/kagawagao/ala/pull/52))
- **dual-provider AI:** support both Anthropic (native SDK) and OpenAI-compatible endpoints ([#52](https://github.com/kagawagao/ala/pull/52))
- **extended thinking:** Anthropic extended thinking mode with configurable budget tokens ([#52](https://github.com/kagawagao/ala/pull/52))
- **structured logging:** TimedRotatingFileHandler + console logging with configurable levels ([#52](https://github.com/kagawagao/ala/pull/52))

### Bug Fixes

- **tooling:** various fixes for session management, SSE streaming, and model configuration ([#52](https://github.com/kagawagao/ala/pull/52))

---

## [2.0.0](https://github.com/kagawagao/ala/compare/v1.1.0-alpha.2...v2.0.0) (2026-04-23)

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
- **analysis presets:** General, Crash, Performance, Security preset modes ([#21](https://github.com/kagawagao/ala/pull/21))
- **highlights:** colored keyword highlights with right-click context menu ([#20](https://github.com/kagawagao/ala/pull/20))
- **filters:** tag/keyword OR filter, TID filter, compact filter layout ([#26](https://github.com/kagawagao/ala/pull/26))
- **source code upload:** attach source code for AI-assisted analysis ([#21](https://github.com/kagawagao/ala/pull/21))
- **dynamic config:** runtime AI configuration via API ([#21](https://github.com/kagawagao/ala/pull/21))

### Bug Fixes

- **ci:** stop electron-builder auto-publish, fix Linux icon generation ([#30](https://github.com/kagawagao/ala/pull/30))
- **release:** CI failure due to Electron internals in artifacts ([#27](https://github.com/kagawagao/ala/pull/27))
- **context menu:** position and label cleanup ([#25](https://github.com/kagawagao/ala/pull/25))
- **linting:** resolve all linting warnings ([#22](https://github.com/kagawagao/ala/pull/22))

---

## [1.0.1](https://github.com/kagawagao/ala/compare/v1.0.0...v1.0.1) (2026-03-09)

### Bug Fixes

- release workflow and artifact cleanup

---

## [1.0.0](https://github.com/kagawagao/ala/releases/tag/v1.0.0) (2026-03-06)

### Features

- **initial release:** Android logcat parsing and AI-powered analysis
- Electron desktop application with drag-and-drop file upload
- AI chat with streaming responses
- Filter presets (save/load/delete)
- Color-coded log levels
- Virtualized log table for large datasets

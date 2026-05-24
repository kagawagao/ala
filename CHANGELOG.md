## [2.3.4](https://github.com/kagawagao/ala/compare/v2.3.3...v2.3.4) (2026-05-21)

### Features

- **msi:** add license screen, app icon, install dir picker, and desktop/Start Menu shortcuts ([#86](https://github.com/kagawagao/ala/issues/86)) ([fb0033b](https://github.com/kagawagao/ala/commit/fb0033b1f3dff164f6f6875391d3bef1901347c6))

### Bug Fixes

- serve static files directly in frozen standalone mode (fix /guide/zh.md → index.html) ([#87](https://github.com/kagawagao/ala/issues/87)) ([441c527](https://github.com/kagawagao/ala/commit/441c5273cf9c7a50301f9c2cb43e7072febc95bd))

## [2.3.3](https://github.com/kagawagao/ala/compare/v2.3.2...v2.3.3) (2026-05-20)

### Bug Fixes

- set x64 platform for windows msi package ([48cb5e7](https://github.com/kagawagao/ala/commit/48cb5e7df68870918481ab4e93bde5cd83f9584e))

## [2.3.2](https://github.com/kagawagao/ala/compare/v2.3.1...v2.3.2) (2026-05-18)

## [2.3.1](https://github.com/kagawagao/ala/compare/v2.3.0...v2.3.1) (2026-05-17)

### Bug Fixes

- **release:** Windows UnicodeEncodeError in ala.spec + manual workflow_dispatch support ([#82](https://github.com/kagawagao/ala/issues/82)) ([0c73c8f](https://github.com/kagawagao/ala/commit/0c73c8f32200060664cba79bae5a5e6c1b5fea3e))

## [2.3.0](https://github.com/kagawagao/ala/compare/v2.2.2...v2.3.0) (2026-05-17)

### Bug Fixes

- **ci:** resolve windows msi file binding in release workflow ([#77](https://github.com/kagawagao/ala/issues/77)) ([2fee6e1](https://github.com/kagawagao/ala/commit/2fee6e10d4d49b6b67a7f3b6dcc8ba929103646f))
- improve rg error logging in code_scanner ([#80](https://github.com/kagawagao/ala/issues/80)) ([9b33373](https://github.com/kagawagao/ala/commit/9b33373d58e4b383796cf92d2f6a79b3fd2b5a0a))
- use .gitignore-based exclusion instead of hardcoded file-type whitelist ([#81](https://github.com/kagawagao/ala/issues/81)) ([94d6c9f](https://github.com/kagawagao/ala/commit/94d6c9fe66bbecede94e1ec95458818e2d2baf7e))

### Performance Improvements

- optimize agentic search (log overview, search_logs, code scanner) + benchmark suite ([#79](https://github.com/kagawagao/ala/issues/79)) ([81cb057](https://github.com/kagawagao/ala/commit/81cb0571b5c91d3c8d3374fc2e130d5e7737ebee))
- ripgrep-backed code/log search (265x faster) + search_all_local composite tool ([#78](https://github.com/kagawagao/ala/issues/78)) ([ff4497e](https://github.com/kagawagao/ala/commit/ff4497e6b2a2844e720a614c38264b11541e8605)), closes [#6](https://github.com/kagawagao/ala/issues/6)

## [2.2.2](https://github.com/kagawagao/ala/compare/v2.2.1...v2.2.2) (2026-05-15)

### Features

- set default size for AI panel in AppContent component ([03d7d8a](https://github.com/kagawagao/ala/commit/03d7d8aff1e9d99765717a34a5186f524a86c49c))

### Bug Fixes

- **release:** stage PyInstaller output before WiX harvesting to fix Windows MSI packaging ([#76](https://github.com/kagawagao/ala/issues/76)) ([1262603](https://github.com/kagawagao/ala/commit/12626030cc3f6d09eb80a319785d88cdeb129f98))
- update isFullPage logic and remove unnecessary styles in UserGuide component ([44919ff](https://github.com/kagawagao/ala/commit/44919ff91fe4d73c1900e282a75dc872be334df9))

## [2.2.1](https://github.com/kagawagao/ala/compare/v2.2.0...v2.2.1) (2026-05-15)

### Features

- add markdown-based user guide with react-markdown rendering ([#73](https://github.com/kagawagao/ala/issues/73)) ([4f5225f](https://github.com/kagawagao/ala/commit/4f5225f1d0776a74dd5c3eb39b82c5ada5dc769c))

### Bug Fixes

- **release:** patch vulnerable artifact extraction action ([#75](https://github.com/kagawagao/ala/issues/75)) ([e931801](https://github.com/kagawagao/ala/commit/e931801030dc11b1ff47edba1c7c1f6844f6ea5c))

## [2.2.0](https://github.com/kagawagao/ala/compare/v2.1.0...v2.2.0) (2026-05-11)

### Features

- add model enable/disable functionality and improve model management ([05ac53e](https://github.com/kagawagao/ala/commit/05ac53e099cb75b7b7592960f38a633631ea9631))
- add timestamp conversion utility and corresponding tests for log tool ([cc17b3c](https://github.com/kagawagao/ala/commit/cc17b3caf33190aefcb14ceaadf8a76e452e2c0c))
- custom model thinking support ([#64](https://github.com/kagawagao/ala/issues/64)) ([f2f172a](https://github.com/kagawagao/ala/commit/f2f172abaa215b6b94ab72359fe71cd3aa6658f5))
- **frontend:** display version tag in Header from package.json ([#67](https://github.com/kagawagao/ala/issues/67)) ([abfaad8](https://github.com/kagawagao/ala/commit/abfaad877971a691ad585c3e09a6d27080d9cd67))
- implement debounced value hook and enhance filter utility functions ([c2b092a](https://github.com/kagawagao/ala/commit/c2b092a9c541112685f79a6cc13079e90fe40349))
- Perfetto SQL query support — MCP tool + agent tool + TraceAnalyzer.query_sql ([#63](https://github.com/kagawagao/ala/issues/63)) ([0b60e6c](https://github.com/kagawagao/ala/commit/0b60e6c5e37e42224efb016e22ab0a15f7ebe038))
- Post-merge iteration — quality, test coverage, SQLite persistence, frontend polish ([#62](https://github.com/kagawagao/ala/issues/62)) ([bb57344](https://github.com/kagawagao/ala/commit/bb57344c9df99db6692e39521ae08604c226a734))

### Bug Fixes

- **ai:** add spacing above thinking blocks after tool calls ([#69](https://github.com/kagawagao/ala/issues/69)) ([54afb75](https://github.com/kagawagao/ala/commit/54afb754e2bc4616b087b0370caaec8df8364b79))
- antd v6 upgrade test failures — 67→186 passed ([#66](https://github.com/kagawagao/ala/issues/66)) ([75f542f](https://github.com/kagawagao/ala/commit/75f542fb01498bf704a6367f306c10e3d700e934))
- **backend:** isolate MCP HTTP app instance per FastAPI app in create_app() ([#71](https://github.com/kagawagao/ala/issues/71)) ([54caec3](https://github.com/kagawagao/ala/commit/54caec389db95ee4ac657004151e862b51de6ef4)), closes [#68](https://github.com/kagawagao/ala/issues/68)

## [2.1.0](https://github.com/kagawagao/ala/compare/v2.0.2...v2.1.0) (2026-05-06)

### Features

- implement model management features with backend integration ([#60](https://github.com/kagawagao/ala/issues/60)) ([8154172](https://github.com/kagawagao/ala/commit/8154172435fef9881d927efec7f65c01dde3f2c4))
- Phase 3+4 — frontend tests, LRU cache, CSV/JSON export, CHANGELOG ([#58](https://github.com/kagawagao/ala/issues/58)) ([b745026](https://github.com/kagawagao/ala/commit/b74502689036d848c170814baae1fa42bf0e6533))

### Bug Fixes

- update pre-commit hooks and add skill paths in skills-lock.json ([c875cb5](https://github.com/kagawagao/ala/commit/c875cb5c97d0ac6335b307605bda323bb74d3805))

## [2.0.2](https://github.com/kagawagao/ala/compare/v2.0.1...v2.0.2) (2026-05-05)

### Features

- lazy local log analysis — stream-based AI tools, directory support, and model picker consolidation ([#54](https://github.com/kagawagao/ala/issues/54)) ([da472e4](https://github.com/kagawagao/ala/commit/da472e4147ca79b6f6fb44a28c911a7792f630bc))
- quality consolidation — CI/CD, MCP lazy-log tools, spec fixes, observability ([#55](https://github.com/kagawagao/ala/issues/55)) ([56e33e6](https://github.com/kagawagao/ala/commit/56e33e67900c51991c70a658247a902f960800ce)), closes [1-#4](https://github.com/kagawagao/1-/issues/4)

### Bug Fixes

- **ci:** skip Husky pre-commit hook in bump-version workflow ([#57](https://github.com/kagawagao/ala/issues/57)) ([c0883c3](https://github.com/kagawagao/ala/commit/c0883c32369650c51721f14334fbe65f67a81298))
- **security:** bump minimum versions to patched releases ([#56](https://github.com/kagawagao/ala/issues/56)) ([8ed3ffd](https://github.com/kagawagao/ala/commit/8ed3ffd07ab18bebc7450ef9869b1a315c60de75)), closes [#97](https://github.com/kagawagao/ala/issues/97) [#96](https://github.com/kagawagao/ala/issues/96) [#95](https://github.com/kagawagao/ala/issues/95) [#100](https://github.com/kagawagao/ala/issues/100) [#99](https://github.com/kagawagao/ala/issues/99) [#94](https://github.com/kagawagao/ala/issues/94) [#112](https://github.com/kagawagao/ala/issues/112)

## [2.0.1](https://github.com/kagawagao/ala/compare/v2.0.0...v2.0.1) (2026-04-27)

### Features

- add model management, dual-provider AI support, structured logging, and tooling fixes ([#52](https://github.com/kagawagao/ala/issues/52)) ([358f479](https://github.com/kagawagao/ala/commit/358f479478052bf6b1062b3992216de41b8c0ff6))

## [2.0.0](https://github.com/kagawagao/ala/compare/v1.1.0-alpha.2...v2.0.0) (2026-04-21)

### Features

- refactor to Python FastAPI + Vite/React workspace with Perfetto trace parsing ([#42](https://github.com/kagawagao/ala/issues/42)) ([b7daebe](https://github.com/kagawagao/ala/commit/b7daebee1e6a8bd35232b6bb0394562c14afd87c))

## [1.1.0-alpha.2](https://github.com/kagawagao/ala/compare/v1.1.0-alpha.1...v1.1.0-alpha.2) (2026-03-19)

### Features

- auto-generate CHANGELOG after version bump with commit linting ([#29](https://github.com/kagawagao/ala/issues/29)) ([7fec2d5](https://github.com/kagawagao/ala/commit/7fec2d50b7ef9b333bf6ecf848b1c78d3e6947ef))

### Bug Fixes

- **ci:** stop electron-builder auto-publish, fix Linux icon generation ([#30](https://github.com/kagawagao/ala/issues/30)) ([ac90474](https://github.com/kagawagao/ala/commit/ac90474915a97c0b70ec1fdcb5ee37da53a11b67))

## [1.1.0-alpha.1](https://github.com/kagawagao/ala/compare/v1.0.1...v1.1.0-alpha.1) (2026-03-17)

### Features

- add colored highlights with right-click context menu ([#20](https://github.com/kagawagao/ala/issues/20)) ([a3e82a7](https://github.com/kagawagao/ala/commit/a3e82a732673aea827b1418355eca782d1d962dd))
- enhance AI analysis with presets, source code upload, and dynamic configuration ([#21](https://github.com/kagawagao/ala/issues/21)) ([1712a95](https://github.com/kagawagao/ala/commit/1712a955ab67dc28e651c77b02f979474360a995))
- tag/keyword OR filter, TID filter, compact filter layout ([#26](https://github.com/kagawagao/ala/issues/26)) ([a9badf5](https://github.com/kagawagao/ala/commit/a9badf5eff3702684c814cc74770112e34d2c02b)), closes [#c586c0](https://github.com/kagawagao/ala/issues/c586c0)

### Bug Fixes

- context menu position and label cleanup ([#25](https://github.com/kagawagao/ala/issues/25)) ([3a8f413](https://github.com/kagawagao/ala/commit/3a8f413093547224907b42875868e9181c508588))
- release CI failure due to Electron internals in artifacts ([#27](https://github.com/kagawagao/ala/issues/27)) ([2e90d77](https://github.com/kagawagao/ala/commit/2e90d770c0576c09e632fbb3685172a9a15d3e44))

## [1.0.1](https://github.com/kagawagao/ala/compare/v1.0.0...v1.0.1) (2026-03-09)

### Bug Fixes

- format filter arrays in package.json for consistency ([eb0d43f](https://github.com/kagawagao/ala/commit/eb0d43fc37fd887e1ca5905a5da64181a7bb3adc))

### Performance Improvements

- virtual scrolling for LogViewer to fix scroll lag on large log files ([#19](https://github.com/kagawagao/ala/issues/19)) ([81e16f7](https://github.com/kagawagao/ala/commit/81e16f775a23e863fac1b7b474c66538319b9d55))

## [1.0.0](https://github.com/kagawagao/ala/compare/52c99c367c9628352d90eb689c0669c135aa2468...v1.0.0) (2026-03-06)

### Features

- basic features ([#1](https://github.com/kagawagao/ala/issues/1)) ([52c99c3](https://github.com/kagawagao/ala/commit/52c99c367c9628352d90eb689c0669c135aa2468))
- make Chinese the default display language ([#6](https://github.com/kagawagao/ala/issues/6)) ([fe91d92](https://github.com/kagawagao/ala/commit/fe91d921b96da8d270ee9e2bc26ab35a6de9e443))

### Bug Fixes

- electron-builder asar missing dist/main.js in release CI ([#15](https://github.com/kagawagao/ala/issues/15)) ([0745102](https://github.com/kagawagao/ala/commit/07451025ece5b601e348df3a5f8812f5827d51b3))
- fix IPC type mismatches, AI result handling, language persistence, and CSP-blocked font import ([#5](https://github.com/kagawagao/ala/issues/5)) ([ed4fb32](https://github.com/kagawagao/ala/commit/ed4fb32225f4639d403e262a2bd1920b55951e1e))
- move electron-builder output directory outside `dist/` to fix release CI ([#13](https://github.com/kagawagao/ala/issues/13)) ([3cea4e6](https://github.com/kagawagao/ala/commit/3cea4e63b68fea12c0e818de6ceebfcd0de3cc64))
- update file configuration in package.json for better asset handling ([676e8b4](https://github.com/kagawagao/ala/commit/676e8b422032bcddcfccac5916536117a7db51cf))

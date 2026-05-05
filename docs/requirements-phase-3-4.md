# 需求文档：Phase 3（前端测试）+ Phase 4（功能增强）

- **迭代代号**: ITER-PHASE-3-4
- **版本**: 1.0.0
- **作者**: 产品经理
- **日期**: 2026-05-05
- **状态**: 起草中
- **前置条件**: v2.0.1 已发布，质量巩固迭代 (ITER-QUALITY-CONSOLIDATION) 已完成
- **相关文档**: `docs/requirements-quality-consolidation.md`, `docs/requirements-lazy-log.md`

---

## 1. 产品愿景

ALA v2.0.1 已具备完整的前后端功能：React 19 + Vite 6 + Ant Design 6 前端，FastAPI 后端，支持日志/Perfetto Trace 的 AI 驱动分析。后端已建立 75 个 pytest 测试用例，代码质量工具链（eslint + TypeScript strict + ruff）全部通过。然而，存在两个明显的工程短板：

1. **前端测试为零** — 前端 9 个组件（AiPanel 1165 行、FileUpload 314 行、LogViewer、TraceViewer、AppSider、Header、ProjectManager、ModelManager、DirectoryFilePicker）无任何自动化测试，仅依赖 `tsc --noEmit` 类型检查。核心逻辑（文件类型检测、SSE 解析、过滤器、统计计算）缺乏单元测试覆盖。
2. **用户体验待增强** — 多项来自用户反馈的功能增强尚未实现：AI 工具结果在 LogViewer 中的可视化展示、工具结果缓存、文件元数据扫描优化、日志导出能力。

本迭代（Phase 3+4）的目标是建立前端测试基础设施和 E2E 测试体系，同时交付 5 项功能增强，将 ALA 推向**完整工程化 + 用户友好**状态。

---

## 2. 用户故事

### Phase 3 — 前端测试

---

#### US-FT1：安装前端测试基础设施（Vitest + Testing Library）

**作为** 前端开发者，
**我希望** 项目中安装 vitest、@testing-library/react 和 jsdom 作为测试依赖，
**以便** 我可以为 React 组件和纯函数编写和运行单元测试。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `frontend/package.json` 的 `devDependencies` 中新增 `vitest`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`、`jsdom` | P0     |
| AC2  | `frontend/package.json` 的 `scripts` 中新增 `"test": "vitest run"` 和 `"test:watch": "vitest"` 命令 | P0     |
| AC3  | 项目根目录新增 `frontend/vitest.config.ts`，配置 `environment: 'jsdom'`、`globals: true`、测试文件匹配 `src/**/*.test.{ts,tsx}` | P0     |
| AC4  | `frontend/tsconfig.app.json` 中 `include` 扩展包含 `src/**/*.test.ts` 和 `src/**/*.test.tsx`（或新增 `tsconfig.test.json`） | P1     |
| AC5  | `npm run test` 可在 frontend 目录下成功执行（即使尚无测试文件，vitest 能够正确发现 0 个测试并退出码为 0） | P0     |
| AC6  | 现有 `npm run type-check` (`tsc --noEmit`) 在安装测试依赖后仍然通过 | P0     |

**相关文件**: `frontend/package.json`, `frontend/vitest.config.ts`（新建）, `frontend/tsconfig.app.json`

---

#### US-FT2：`detectFileTypeByHeader` 函数单元测试

**作为** 前端开发者，
**我希望** `FileUpload.tsx` 中的 `detectFileTypeByHeader` 函数有完整的单元测试覆盖，
**以便** 文件类型自动检测（日志 vs. Perfetto Trace）逻辑在任何重构后都能保证正确性。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 新建 `frontend/src/components/__tests__/FileUpload.test.ts`，测试文件包含至少 15 个测试用例 | P0     |
| AC2  | 覆盖 GZ 魔数字节 (`1F 8B`) → 识别为 `'log'`                                              | P0     |
| AC3  | 覆盖 ZIP 魔数字节 (`50 4B`) → 识别为 `'log'`                                             | P0     |
| AC4  | 覆盖二进制控制字节 > 4 → 识别为 `'trace'`（Perfetto proto trace）                         | P0     |
| AC5  | 覆盖文本文件含 `"traceEvents"` → 识别为 `'trace'`（JSON Perfetto trace）                  | P0     |
| AC6  | 覆盖文本文件含 `"ph"` (Chrome Trace Event Format) → 识别为 `'trace'`                      | P0     |
| AC7  | 覆盖纯文本日志（无明显 trace 特征）→ 识别为 `'log'`                                       | P0     |
| AC8  | 覆盖扩展名回退：`.pb` 扩展名 → `'trace'`；`.log`、`.txt`、`.logcat` → `'log'`             | P0     |
| AC9  | 覆盖空文件（0 字节）→ 根据扩展名判定                                                      | P1     |
| AC10 | 覆盖跨平台文本：含 CJK 字符（UTF-8 高位字节 `0x80–0xFF`）不被误判为二进制 trace            | P1     |
| AC11 | 覆盖 `file.slice()` 抛出异常时的纯扩展名回退路径                                           | P1     |
| AC12 | 测试使用 `vitest` + `jsdom` 环境，mock `File` 对象的 `.slice()` 和 `.arrayBuffer()` 方法   | P0     |
| AC13 | `npm run test` 全部通过                                                                  | P0     |

**相关文件**: `frontend/src/components/FileUpload.tsx` (lines 45–112), `frontend/src/components/__tests__/FileUpload.test.ts`（新建）

---

#### US-FT3：SSE 事件解析逻辑单元测试

**作为** 前端开发者，
**我希望** AiPanel 中的 SSE (Server-Sent Events) 事件解析逻辑有单元测试覆盖，
**以便** 流式 AI 响应处理（thinking/tool_call/tool_result/text/max_rounds_reached/agent_meta）在各种事件序列下都能正确渲染。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 新建 `frontend/src/components/__tests__/AiPanel.test.ts`，包含至少 12 个 SSE 事件解析测试用例 | P0     |
| AC2  | 覆盖纯文本 chunk（不以 `{` 开头）→ 累积到 `accumulated`，追加到 `parts` 的 text 段          | P0     |
| AC3  | 覆盖 `{ "type": "thinking", "content": "..." }` → parts 增加 thinking 块                  | P0     |
| AC4  | 覆盖 `{ "type": "tool_call", "name": "...", "arguments": "..." }` → parts 增加 tool 块     | P0     |
| AC5  | 覆盖 `{ "type": "tool_result", "name": "...", "content": "..." }` → 匹配并更新对应 tool 块的 result | P0     |
| AC6  | 覆盖 `{ "type": "max_rounds_reached", "message": "..." }` → 设置 continueMessage            | P0     |
| AC7  | 覆盖 `{ "type": "agent_meta", ... }` → 静默丢弃                                            | P1     |
| AC8  | 覆盖 OpenAI 格式 `{ "choices": [{ "delta": { "content": "..." } }] }` → 正确提取 delta     | P0     |
| AC9  | 覆盖 `[DONE]` 信号 → 停止流迭代                                                            | P0     |
| AC10 | 覆盖多个 text chunk 连续到达时正确拼接为单个 text part                                     | P1     |
| AC11 | 覆盖 tool_call 后跟 tool_result 的正确配对（通过 name + 最近未 resolve 的 tool 匹配）       | P1     |
| AC12 | 覆盖 JSON.parse 失败时回退为纯文本处理                                                    | P1     |
| AC13 | 测试逻辑提取为独立可测试函数（如 `processSSEChunk`），从 AiPanel 组件中解耦                | P0     |
| AC14 | `npm run test` 全部通过                                                                  | P0     |

**相关文件**: `frontend/src/components/AiPanel.tsx` (lines 475–575), `frontend/src/components/__tests__/AiPanel.test.ts`（新建）

---

#### US-FT4：过滤器逻辑与统计计算单元测试

**作为** 前端开发者，
**我希望** App.tsx 中的 `applyFiltersClient` 过滤函数和 `computeStatistics` 统计函数有单元测试覆盖，
**以便** 客户端过滤器（时间范围、等级、PID/TID、关键字/标签组合）和统计聚合逻辑在任何修改后都能保证正确性。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 新建 `frontend/src/__tests__/App.test.ts`，包含至少 14 个过滤/统计测试用例                 | P0     |
| AC2  | `applyFiltersClient` — 时间范围过滤：`start_time`/`end_time` 正确筛选                     | P0     |
| AC3  | `applyFiltersClient` — level 过滤：精确匹配                                               | P0     |
| AC4  | `applyFiltersClient` — PID / TID 过滤：精确匹配                                          | P0     |
| AC5  | `applyFiltersClient` — 关键字 regex 过滤（匹配 message 和 raw_line）                       | P0     |
| AC6  | `applyFiltersClient` — tag 过滤：regex 匹配 tag 字段                                      | P0     |
| AC7  | `applyFiltersClient` — `tag_keyword_relation: 'AND'` 逻辑：两者都匹配才通过                | P0     |
| AC8  | `applyFiltersClient` — `tag_keyword_relation: 'OR'` 逻辑：任一匹配即通过                   | P0     |
| AC9  | `applyFiltersClient` — 仅关键字（无 tag）时正确过滤                                        | P1     |
| AC10 | `applyFiltersClient` — 仅 tag（无关键字）时正确过滤                                        | P1     |
| AC11 | `applyFiltersClient` — 无效 regex 时静默回退（不过滤关键字/tag 维度）                       | P1     |
| AC12 | `applyFiltersClient` — 空过滤器返回全部日志（不修改原数组）                                 | P0     |
| AC13 | `computeStatistics` — 正确统计 level 分布、tag 频率、pid 频率                             | P0     |
| AC14 | `computeStatistics` — 空数组返回 `{ total: 0, by_level: {}, tags: {}, pids: {} }`          | P0     |
| AC15 | `hasFilterConditions` — 正确检测是否有活跃过滤条件                                         | P1     |
| AC16 | `npm run test` 全部通过                                                                  | P0     |

**相关文件**: `frontend/src/App.tsx` (lines 62–135), `frontend/src/utils/filters.ts`, `frontend/src/__tests__/App.test.ts`（新建）

---

#### US-FT5：Playwright E2E 冒烟测试与关键流程测试

**作为** QA 工程师，
**我希望** 有 Playwright E2E 测试覆盖应用的基本冒烟场景和两个关键用户流程（文件上传 + AI 对话），
**以便** 在每次发布前自动验证核心功能完整性。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 仓库根目录或 `frontend/` 下新增 `e2e/` 目录，包含 `playwright.config.ts` 配置文件          | P0     |
| AC2  | `frontend/package.json` 中新增 `@playwright/test` 为 devDependency                         | P0     |
| AC3  | **冒烟测试** (`e2e/smoke.spec.ts`)：页面加载后渲染 Header（标题/语言切换按钮）、FileUpload 拖拽区域、"未连接后端" 警告条 | P0     |
| AC4  | **文件上传流程** (`e2e/upload.spec.ts`)：上传示例日志文件 → 等待解析完成 → 验证 LogViewer 表格渲染日志行、AppSider 显示过滤器和统计面板 | P0     |
| AC5  | **AI 对话流程** (`e2e/chat.spec.ts`)：前提为已配置 AI（或 mock 后端响应）→ 在 AiPanel 输入消息并发送 → 验证 AI 响应消息出现在对话列表中 | P1     |
| AC6  | E2E 测试使用 `playwright test` 运行，支持 headless 模式（CI 友好）                          | P1     |
| AC7  | Playwright 配置包含 `webServer` 选项：自动启动 Vite dev server + FastAPI backend（或 mock server） | P1     |
| AC8  | `npm run test:e2e` 可执行全部 E2E 测试                                                    | P1     |

**相关文件**: `e2e/playwright.config.ts`（新建）, `e2e/smoke.spec.ts`（新建）, `e2e/upload.spec.ts`（新建）, `e2e/chat.spec.ts`（新建）

---

### Phase 4 — 功能增强

---

#### US-FE1：LogViewer 中展示 AI 工具返回的日志条目

**作为** 日志分析用户，
**我希望** 当 AI 代理调用 `search_local_log` 或 `read_log_range` 返回日志条目时，这些结果自动显示在 LogViewer 中，
**以便** 我可以直观地查看 AI 正在分析的日志内容，而非只能看到 JSON 文本。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 前端新增状态 `lazyToolEntries: LogEntry[]`，存储 AI 工具返回的日志条目                      | P0     |
| AC2  | AiPanel 在接收 `tool_result` 事件时，若 `name` 为 `search_local_log` 或 `read_log_range`，解析 `content` JSON 中的 `entries` 数组并更新 `lazyToolEntries` | P0     |
| AC3  | AiPanel 将 `lazyToolEntries` 通过 props 或 context 传递给 LogViewer                        | P0     |
| AC4  | LogViewer 在 lazy 模式下（`localFilePath` 非空）且 `lazyToolEntries` 有数据时，渲染这些条目；若无数据则显示提示"AI 工具尚未返回日志条目" | P0     |
| AC5  | 多次工具调用返回的条目累积合并（去重按 `line_number + source_file`），保留最新结果            | P1     |
| AC6  | 不影响现有上传模式的 LogViewer 行为（`localFilePath` 为空时走原逻辑）                         | P0     |
| AC7  | `lazyToolEntries` 同样受 AppSider 中的过滤器控制（前端 `applyFiltersClient` 过滤）          | P1     |
| AC8  | 类型定义 `types/index.ts` 中的 `LogEntry` 接口兼容后端 `search_local_log` 返回的条目结构     | P0     |

**相关文件**: `frontend/src/components/AiPanel.tsx`, `frontend/src/components/LogViewer.tsx`, `frontend/src/App.tsx`, `frontend/src/types/index.ts`

---

#### US-FE2：Lazy-Log 工具结果 LRU 缓存

**作为** 后端性能优化工程师，
**我希望** lazy-log 工具（`search_local_log`、`read_log_range`、`overview_local_log`、`tail_local_log`）的执行结果有 LRU 缓存，
**以便** AI 代理在短时间内用相同参数重复调用同一工具时，后端可以直接返回缓存结果，避免重复 I/O。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `backend/src/ala/services/agent_tools.py` 中新增 `ToolResultCache` 类，基于 `collections.OrderedDict` 或 `functools.lru_cache` 实现 LRU 淘汰 | P0     |
| AC2  | 缓存键格式：`{tool_name}:{resolved_file_path}:{sorted_params_json}:{file_mtime}`           | P0     |
| AC3  | 缓存容量上限为 **128 条**（可配置），超出时淘汰最久未使用的条目                              | P0     |
| AC4  | 缓存 TTL 为 **60 秒**，超时条目即使未达到容量上限也被视为过期，读取时自动移除               | P0     |
| AC5  | 文件 mtime 参与缓存键：文件被外部修改后，即使参数相同也会 cache miss（通过 `os.path.getmtime` 获取） | P1     |
| AC6  | 缓存应用于 `_execute_lazy_log_tool` 函数的 4 个工具路径：`overview_local_log`、`search_local_log`、`read_log_range`、`tail_local_log` | P0     |
| AC7  | `list_directory_logs` **不**参与缓存（目录列表可能实时变化）                                  | P1     |
| AC8  | 新增至少 4 个单元测试验证缓存命中/未命中/过期/淘汰行为                                       | P0     |
| AC9  | 现有 75 个后端测试全部保持通过                                                              | P0     |

**相关文件**: `backend/src/ala/services/agent_tools.py`, `backend/tests/test_lazy_log.py`（扩展）

---

#### US-FE3：`scan_file_meta` 提前退出优化

**作为** 后端性能优化工程师，
**我希望** `LogAnalyzer.scan_file_meta()` 在已经收集到足够信息后提前停止扫描，
**以便** 对于超大日志文件（> 100K 行），元数据扫描能快速返回，显著降低用户等待时间。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `scan_file_meta` 新增可选参数 `max_scan_lines: int | None = None`，默认 `None` 表示不限制   | P0     |
| AC2  | 当 `max_scan_lines` 指定时，行计数达到该值后停止扫描，返回 `truncated: true` 标记           | P0     |
| AC3  | 格式检测逻辑不受影响：仍从前 10 行采样检测日志格式（`android_logcat` / `generic_timestamped` / `unknown`） | P0     |
| AC4  | `FileRef` 数据类新增 `truncated: bool = False` 字段                                         | P1     |
| AC5  | `POST /api/logs/auto-path` 端点（`autoPath`）调用 `scan_file_meta` 时传入 `max_scan_lines=50000`，确保大文件场景下元数据扫描在 2 秒内返回 | P0     |
| AC6  | `autoPath` 响应 JSON 中新增 `truncated: true/false` 字段                                    | P1     |
| AC7  | 新增至少 3 个单元测试：`max_scan_lines=100` 提前退出、`max_scan_lines=None` 完整扫描、大文件 truncated 标记 | P0     |
| AC8  | 现有测试全部通过                                                                          | P0     |

**相关文件**: `backend/src/ala/services/log_analyzer.py`, `backend/src/ala/api/logs.py`, `backend/tests/test_lazy_log.py`（扩展）

---

#### US-FE4：CSV / JSON 日志导出按钮

**作为** 日志分析用户，
**我希望** LogViewer 工具栏中有 CSV 和 JSON 导出按钮，
**以便** 我可以将当前过滤后的日志条目导出为通用格式，用于外部分析或报告。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | LogViewer 组件工具栏新增两个按钮：**导出 CSV**（`<DownloadOutlined />` + "CSV"）和 **导出 JSON**（`<DownloadOutlined />` + "JSON"） | P0     |
| AC2  | CSV 导出列：`line_number`, `timestamp`, `level`, `tag`, `pid`, `tid`, `message`           | P0     |
| AC3  | CSV 导出使用 BOM (`\uFEFF`) 前缀以兼容 Excel 打开 UTF-8 文件                               | P1     |
| AC4  | CSV 中 `message` 字段若含逗号/引号/换行，使用 RFC 4180 标准转义（双引号包裹 + 内部引号转义） | P1     |
| AC5  | JSON 导出格式：`[{ "line_number": 1, "timestamp": "...", ... }, ...]`，美化输出（2 空格缩进） | P0     |
| AC6  | 仅导出当前 `filteredLogs`（过滤后的日志），非全部 `allLogs`                                 | P0     |
| AC7  | 当 `filteredLogs` 为空时，导出按钮显示 tooltip 提示"无数据可导出"且处于 disabled 状态        | P1     |
| AC8  | 导出使用客户端生成 + `URL.createObjectURL` + 自动下载，无需后端 API                         | P0     |
| AC9  | 文件名格式：`ala-export-{timestamp}.csv` / `ala-export-{timestamp}.json`（timestamp 为 ISO 日期） | P1     |
| AC10 | 新增至少 4 个单元测试：CSV 生成正确性、JSON 生成正确性、空数据导出 disabled、特殊字符转义    | P1     |
| AC11 | `npm run test` 全部通过                                                                  | P0     |

**相关文件**: `frontend/src/components/LogViewer.tsx`, `frontend/src/components/__tests__/LogViewer.test.ts`（新建）

---

#### US-FE5：更新 CHANGELOG 记录 Phase 3+4 变更

**作为** 项目维护者，
**我希望** CHANGELOG.md 中新增 v2.1.0 条目，清晰记录 Phase 3 和 Phase 4 的所有变更，
**以便** 用户和贡献者能快速了解本版本的新功能、修复和工程改进。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `CHANGELOG.md` 顶部新增 `## [2.1.0] ... (2026-05-xx)` 条目                                | P0     |
| AC2  | **Features** 子节记录 5 项功能增强：LogViewer lazy 展示、LRU 缓存、scan_file_meta 优化、CSV/JSON 导出、Playwright E2E 测试 | P0     |
| AC3  | **Tests** 子节记录前端测试基础设施搭建和单元测试/E2E 测试覆盖                               | P0     |
| AC4  | **Chores** 子节记录 vitest/testing-library/playwright 依赖安装                              | P1     |
| AC5  | 条目格式遵循 Conventional Commits 规范（`- **scope:** description`）                        | P0     |
| AC6  | 底部版本链接格式与现有条目一致：`[2.1.0]: https://github.com/kagawagao/ala/compare/v2.0.1...v2.1.0` | P1     |

**相关文件**: `CHANGELOG.md`

---

## 3. 非功能性需求 (NFR)

| 标识    | 描述                                                                                     | 优先级 |
| ------- | ---------------------------------------------------------------------------------------- | ------ |
| NFR-1   | 前端单元测试运行时间 ≤ 30 秒（不含 E2E）                                                   | P1     |
| NFR-2   | Playwright E2E 测试运行时间 ≤ 120 秒（3 个 spec）                                          | P2     |
| NFR-3   | 测试覆盖率报告可通过 `vitest --coverage` 生成（使用 `@vitest/coverage-v8`）                 | P2     |
| NFR-4   | LRU 缓存操作 O(1) 时间复杂度（写入、查找、淘汰）                                            | P1     |
| NFR-5   | `scan_file_meta` 带 `max_scan_lines=50000` 时，100MB 日志文件扫描 ≤ 2 秒                    | P1     |
| NFR-6   | 导出 10000 条日志的 CSV/JSON 在 500ms 内完成，不阻塞 UI                                     | P2     |
| NFR-7   | 新增代码通过 eslint + TypeScript strict + ruff 检查，零 warning                             | P0     |
| NFR-8   | 现有 75 个后端测试全部保持通过                                                              | P0     |

---

## 4. 依赖与风险

| 依赖/风险                          | 影响                                       | 缓解措施                                                   |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `@testing-library/react` 与 React 19 兼容性 | 测试环境 setup 可能遇到 React 19 新 API 适配问题 | 锁定已知兼容版本；优先验证 smoke test                      |
| Playwright 浏览器安装               | CI 环境需要安装 Chromium/Firefox            | 使用 `npx playwright install --with-deps chromium`         |
| LRU 缓存引入状态管理复杂度          | 缓存过期/淘汰逻辑可能引入边缘情况 bug        | 充分的单元测试覆盖（≥ 4 个 TC）                             |
| `scan_file_meta` 提前退出           | 截断后格式检测可能不准确                     | 格式检测仅依赖前 10 行，`max_scan_lines` 最小值 ≥ 50        |
| AiPanel SSE 解析逻辑解耦            | 重构可能引入回归                             | 提取纯函数 + 单元测试覆盖后再重构                           |

---

## 5. 交付物清单

| 交付物                                      | 类型       | Phase |
| ------------------------------------------- | ---------- | ----- |
| `frontend/vitest.config.ts`                  | 配置文件   | 3     |
| `frontend/src/components/__tests__/FileUpload.test.ts` | 测试文件 | 3     |
| `frontend/src/components/__tests__/AiPanel.test.ts`   | 测试文件 | 3     |
| `frontend/src/__tests__/App.test.ts`         | 测试文件   | 3     |
| `e2e/playwright.config.ts`                   | 配置文件   | 3     |
| `e2e/smoke.spec.ts`                          | E2E 测试   | 3     |
| `e2e/upload.spec.ts`                         | E2E 测试   | 3     |
| `e2e/chat.spec.ts`                           | E2E 测试   | 3     |
| `frontend/src/components/LogViewer.tsx`（修改） | 功能增强   | 4     |
| `frontend/src/components/AiPanel.tsx`（修改）   | 功能增强   | 4     |
| `backend/src/ala/services/agent_tools.py`（修改） | 功能增强 | 4     |
| `backend/src/ala/services/log_analyzer.py`（修改） | 功能增强 | 4     |
| `backend/src/ala/api/logs.py`（修改）          | 功能增强   | 4     |
| `frontend/src/types/index.ts`（修改）          | 类型定义   | 4     |
| `frontend/src/components/__tests__/LogViewer.test.ts` | 测试文件 | 4     |
| `backend/tests/test_lazy_log.py`（扩展）        | 测试扩展   | 4     |
| `CHANGELOG.md`（更新）                         | 文档       | 4     |

---

## 6. 完成定义 (Definition of Done)

1. 所有用户故事的验收标准全部满足
2. 前端 `npm run test` 全部通过，无失败或挂起测试
3. 后端 `pytest` 75+ 个测试全部通过
4. `npm run type-check` (tsc --noEmit) 通过
5. `npm run lint` (eslint) 通过
6. `ruff check` + `ruff format --check` 通过
7. Playwright E2E 测试在 CI 环境可运行并通过
8. CHANGELOG.md 更新完成
9. PR 通过代码审查并合入 master

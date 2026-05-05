# 需求文档：ALA v1.1 质量巩固迭代

- **迭代代号**: ITER-QUALITY-CONSOLIDATION
- **版本**: 1.0.0
- **作者**: 产品经理
- **日期**: 2026-05-05
- **状态**: 起草中
- **前置条件**: FEAT-LAZY-LOG 已合入 master 分支

---

## 1. 产品愿景

FEAT-LAZY-LOG（本地文件路径懒加载 AI 日志分析）已成功合入 master 分支。55 个自动化测试全部通过，核心流式解析引擎 (`LogAnalyzer.stream_file`) 运行稳定。然而，代码审查和测试报告（参见 `docs/review-lazy-log.md` 和 `docs/test-report-lazy-log.md`）发现了若干规格偏离、集成缺口和工程质量短板：

1. **规格偏离** — 5 处工具 Schema 定义与需求文档 (§6) 不一致，HTTP 错误码与 API 合约不符。
2. **MCP Server 滞后** — MCP Server (`mcp/server.py`) 仅暴露 5 个内存模式工具，未包含 lazy-log 的 5 个流式工具。
3. **CI/CD 缺失** — 仓库无任何 CI/CD 流水线，合入 master 前无自动化质量门禁。
4. **可观测性不足** — NFR-5（可观测性日志）完全未实现，lazy-log 工具执行路径无任何 DEBUG/WARNING 日志。

本迭代（质量巩固）的目标是在 v1.1 正式发布前，补齐上述短板，将 ALA 推向**生产就绪**状态。

---

## 2. 用户故事

### 2.1 工作流 A：修复 5 项规格偏离

---

#### US-A1：`overview_local_log` 工具 Schema 补充 `max_lines` 参数

**作为** AI 代理（Anthropic 模型），
**我希望** `overview_local_log` 工具的 `input_schema` 中声明可选的 `max_lines` 参数，
**以便** 我可以对大文件进行采样扫描，避免超时。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `LAZY_LOG_TOOLS` 中 `overview_local_log` 的 `input_schema.properties` 新增 `max_lines` 字段（`type: integer`，可选），说明其为"最大扫描行数" | P1     |
| AC2  | `_execute_lazy_log_tool` 中 `overview_local_log` 的执行逻辑支持 `max_lines` 参数：当指定时，流式扫描在达到 `max_lines` 行后提前终止 | P1     |
| AC3  | 响应 JSON 中新增 `max_lines_reached: true` 字段，当扫描因 `max_lines` 限制而提前终止时提示 AI 代理 | P2     |
| AC4  | 新增单元测试：`max_lines=50` 时仅扫描前 50 行；未指定 `max_lines` 时扫描全部行 | P1     |
| AC5  | 现有 28 个 lazy-log 测试全部保持通过 | P0     |

**相关文件**: `backend/src/ala/services/agent_tools.py`（Schema 定义 + 执行函数）

**依据**: US-2 AC7（原始需求 §6 中 `overview_local_log` 的 `input_schema` 要求包含可选的 `max_lines` 参数）

---

#### US-A2：Lazy Tool Schemas 补充显式 `path` 参数

**作为** AI 代理，
**我希望** 每个 lazy-log 工具的 `input_schema` 中声明 `path` 作为必填（或强烈推荐）参数，
**以便** 我的工具调用与原始 API 合约 (§6) 保持一致，并在目录模式下明确指定目标文件。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `LAZY_LOG_TOOLS` 中 `overview_local_log`、`search_local_log`、`read_log_range`、`tail_local_log` 的 `input_schema.properties` 均包含 `file_path` 字段（`type: string`），描述为"目标日志文件名或路径；当日志源为目录时必须指定" | P1     |
| AC2  | `search_local_log` 和 `read_log_range` 的 `input_schema.required` 从 `[]` 调整为 `[]`（保留可选以兼容单文件模式），但 description 中明确"目录模式必填" | P1     |
| AC3  | `list_directory_logs` 工具 Schema 保持不变（无 `file_path` 参数） | P2     |
| AC4  | 工具执行逻辑无需修改——现有 `_resolve_log_path` 函数已正确处理 `args.file_path` 参数 | P2     |
| AC5  | 现有 28 个 lazy-log 测试全部保持通过 | P0     |

**相关文件**: `backend/src/ala/services/agent_tools.py`（`LAZY_LOG_TOOLS` 定义）

**依据**: 需求文档 §6 为每个工具定义了 `path` 作为必填字段；实现中通过 session 隐式传递路径，与合约不符

---

#### US-A3：增加 NFR-5 可观测性日志

**作为** 运维人员或调试开发者，
**我希望** lazy-log 工具的执行路径打印 DEBUG/WARNING 级别日志，
**以便** 我在排查问题时能够追踪文件访问操作和异常情况。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `_execute_lazy_log_tool` 函数开头打印 DEBUG 日志，记录 `tool_name`、`args` 和 `file_path` | P1     |
| AC2  | 每次文件流式访问（`stream_file` / `scan_file_meta`）成功完成时打印 DEBUG 日志，包含路径、耗时（毫秒）和行数 | P1     |
| AC3  | 文件访问异常（`FileNotFoundError`、`PermissionError`、`PathTraversalError`）打印 WARNING 日志，包含路径和异常消息 | P1     |
| AC4  | 调用的函数若不存在（`Unknown lazy tool`）打印 ERROR 日志 | P2     |
| AC5  | 日志格式遵循现有 `logging_config.py` 的格式规范（`%(asctime)s - %(name)s - %(levelname)s - %(message)s`） | P2     |

**相关文件**: `backend/src/ala/services/agent_tools.py`（`_execute_lazy_log_tool` 函数）

**依据**: NFR-5（原始需求 §3 要求"所有文件访问操作以 DEBUG 级别记录日志"）

---

#### US-A4：修正 HTTP 错误码与 API 合约的偏离

**作为** 前端开发者或 API 消费者，
**我希望** `POST /api/logs/parse-local` 和 `POST /api/logs/auto-path` 端点返回符合 API 合约的 HTTP 状态码，
**以便** 客户端可以根据正确的状态码进行错误处理（如区分客户端错误 vs 服务端错误）。

**验收标准**:

| AC   | 场景                   | 当前状态码 | 期望状态码 | 优先级 |
| ---- | ---------------------- | ---------- | ---------- | ------ |
| AC1  | 文件不存在             | **404**    | **400**    | P1     |
| AC2  | 路径遍历攻击           | **403**    | **400**    | P1     |
| AC3  | 无权限读取             | **422**    | **403**    | P1     |
| AC4  | 路径为目录（非文件）   | **422**    | **400**    | P1     |
| AC5  | `PUT /sessions/{id}/file-path` 端点同步修正 | 同左 | 同左 | P1     |
| AC6  | 前端 `logs.ts` 和 `chat.ts` API 客户端如有依赖状态码的错误处理逻辑，同步调整 | P2     |            |     |
| AC7  | 现有 API 测试（如有）更新以匹配新的状态码 | P2     |            |     |

**相关文件**:

- `backend/src/ala/api/logs.py`（`parse_local_path`、`auto_path` 函数）
- `backend/src/ala/api/chat.py`（`set_session_file_path` 函数）
- `frontend/src/api/logs.ts`、`frontend/src/api/chat.ts`（如需调整）

**依据**: US-5 验收标准表（原始需求 §2 US-5 AC1-AC3）及架构文档 §6.1

---

#### US-A5：`read_log_range` 在 `start_line > total_lines` 时返回显式错误

**作为** AI 代理，
**我希望** 当我调用 `read_log_range` 且 `start_line` 超出文件总行数时收到显式的 JSON 错误对象，
**以便** 我可以向用户反馈"请求的行范围无效"而非静默返回空结果。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `_execute_lazy_log_tool` 中 `read_log_range` 分支：在遍历完整个文件后，若 `start_line > total_lines`，返回 `{"error": "start_line N exceeds total lines M"}` 而非空 `entries` 列表 | P1     |
| AC2  | 响应 JSON 中始终包含 `total_lines_in_file` 字段，便于 AI 代理判断文件大小 | P1     |
| AC3  | 若 `start_line <= total_lines` 但 `end_line > total_lines`，将 `end_line` 静默 clamp 到文件末尾并在响应中注明（如 `"range": "100-500 (clamped from 100-1000)"`） | P2     |
| AC4  | 新增单元测试：`start_line=99999` 在 3 行文件中触发显式错误；`end_line` 超出范围时正常 clamp | P1     |

**相关文件**: `backend/src/ala/services/agent_tools.py`（`_execute_lazy_log_tool` → `read_log_range` 分支）

**依据**: US-4 AC4（原始需求要求"若 `start_line` > `total_lines_in_file`，返回错误"）

---

### 2.2 工作流 B：MCP Server 增强

---

#### US-B1：MCP Server 新增 5 个 Lazy-Log 工具

**作为** 通过 MCP 协议连接 ALA 的外部 AI 客户端（如 Claude Desktop、Cursor），
**我希望** MCP Server 暴露完整的 lazy-log 工具集，
**以便** 我可以直接分析本地日志文件，而无需通过 REST API 先上传。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `mcp/server.py` 新增工具 `overview_local_log(file_path: str, max_lines: int | None = None) -> dict` | P1     |
| AC2  | `mcp/server.py` 新增工具 `search_local_log(file_path: str, level: str | None = None, tag: str | None = None, pid: str | None = None, keyword: str | None = None, start_time: str | None = None, end_time: str | None = None, limit: int = 50, offset: int = 0) -> dict` | P1     |
| AC3  | `mcp/server.py` 新增工具 `read_log_range(file_path: str, start_line: int, end_line: int) -> dict` | P1     |
| AC4  | `mcp/server.py` 新增工具 `tail_local_log(file_path: str, lines: int = 50) -> dict` | P1     |
| AC5  | `mcp/server.py` 新增工具 `list_directory_logs(directory_path: str) -> dict` | P1     |
| AC6  | 所有新增工具复用 `LogAnalyzer._validate_path()` 进行路径验证（路径遍历防护、存在性检查、可读性检查） | P0     |
| AC7  | 所有新增工具复用 `LogAnalyzer.stream_file()` 进行流式解析（不修改现有 `stream_file` 签名） | P1     |
| AC8  | 工具函数签名（参数名、类型提示、默认值）与 `LAZY_LOG_TOOLS` 中定义的 `input_schema` 保持一致 | P1     |
| AC9  | 新增 `list_directory_logs` 支持目录模式：扫描目录下 log-like 文件，返回文件名、大小和快速行数估算 | P2     |
| AC10 | 新增集成测试（或手动验证脚本）：通过 MCP 客户端调用 5 个新工具，验证返回值与 agent_tools 版本一致 | P2     |

**相关文件**: `backend/src/ala/mcp/server.py`

**技术方案**: 新增工具使用 `@mcp.tool()` 装饰器注册，内部调用 `LogAnalyzer` 实例方法。与现有 REST API 工具不同的是，MCP 工具直接接收 `file_path` 参数（而非从 session 中隐式获取），因为 MCP 无 session 概念。

**特别注意**: 确保 `test_trace_analyzer.py` 的导入问题（从 `ala.mcp.server` 导入）不会因本次修改而加剧——修改前需先解耦二者的循环依赖风险。

---

### 2.3 工作流 C：CI/CD 流水线

---

#### US-C1：GitHub Actions 持续集成

**作为** 项目维护者，
**我希望** 每次 Push 到 master 或提交 PR 时自动运行 lint、测试和构建检查，
**以便** 代码质量在合入前得到保障，避免手动检查遗漏。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 创建 `.github/workflows/ci.yml`，定义 CI 流水线 | P0     |
| AC2  | 触发条件：`push` 到 `master` 分支、`pull_request` 到 `master` 分支 | P0     |
| AC3  | Job 1 — Lint: 运行 `ruff check backend/` 和 `npm run format:check`（Prettier + ESLint）；任意一步失败则整体失败 | P0     |
| AC4  | Job 2 — Test: 运行 `cd backend && PYTHONPATH=src python -m pytest tests/ -v`（排除 `test_trace_analyzer.py` 直到其导入问题修复） | P0     |
| AC5  | Job 3 — Build Check: 运行 `cd frontend && npm run build`（TypeScript strict mode 编译 + Vite 打包），确保前端无类型错误 | P1     |
| AC6  | 使用 `actions/setup-python@v5`（Python 3.12）和 `actions/setup-node@v4`（Node 20 LTS） | P1     |
| AC7  | Poetry 依赖缓存：使用 `actions/cache` 缓存 `~/.cache/pypoetry` 加速构建 | P2     |
| AC8  | CI badge 添加至 `README.md` 顶部 | P2     |

**相关文件**:

- `.github/workflows/ci.yml`（新建）
- `README.md`（添加 CI Badge）

---

#### US-C2：修复 `test_trace_analyzer.py` 导入问题

**作为** 开发者，
**我希望** `test_trace_analyzer.py` 的 7 个测试能够在 CI 流水线中正常执行，
**以便** 所有 62 个测试（55 + 7）在每次 CI 运行中被覆盖。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 解耦 `test_trace_analyzer.py` 与 `ala.mcp.server` 的直接导入：测试不再 `from ala.mcp.server import ...`，改为直接导入 `TraceAnalyzer` 和 `TraceFilters` 进行单元测试 | P1     |
| AC2  | 若 MCP Server 工具（`parse_perfetto_trace`、`filter_perfetto_trace`）需要独立测试，将其拆分为单独的测试文件或使用 `pytest.importorskip("fastmcp")` 优雅跳过 | P2     |
| AC3  | 运行 `cd backend && PYTHONPATH=src python -m pytest tests/ -v` 时，`test_trace_analyzer.py` 不再因为 `fastmcp` 缺失而被跳过 | P1     |
| AC4  | 新增/更新至少 3 个 `TraceAnalyzer` 单元测试，覆盖 `parse_trace()`、`filter_trace()` 和 `TraceFilters` 数据类 | P2     |

**相关文件**:

- `backend/tests/test_trace_analyzer.py`
- `backend/src/ala/services/trace_analyzer.py`

---

#### US-C3：合并 9 个 Dependabot PR

**作为** 项目维护者，
**我希望** 所有打开的 Dependabot 依赖更新 PR 被审查并合并，
**以便** 依赖安全漏洞被及时修补，技术债务不累积。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 逐个审查 9 个 Dependabot PR 的变更日志和 breaking changes | P1     |
| AC2  | 所有依赖更新后，55 个现有测试全部通过（无回归） | P0     |
| AC3  | 依赖更新后，前端 `npm run build` 零错误，`npm run format:check` 零错误 | P1     |
| AC4  | 特别关注 `cryptography`、`dompurify`、`postcss` 三个安全关键包的升级 | P1     |
| AC5  | `fastmcp` 升级后确认 `test_trace_analyzer.py` 和 MCP Server 功能正常 | P2     |

**涉及的 9 个包**: `postcss`, `dompurify`, `cryptography`, `fastmcp`, `authlib`, `pytest`, `python-multipart`, `vite`, `lodash-es`

---

### 2.4 工作流 D：可观测性与防护

---

#### US-D1：Lazy Tool 执行路径增加结构化日志

**作为** 运维人员，
**我希望** 所有 lazy-log 工具调用产生结构化日志（包含工具名、文件路径、耗时、结果摘要），
**以便** 我可以通过日志排查性能瓶颈或异常调用。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | `_execute_lazy_log_tool` 入口处打印 DEBUG 日志（`tool=%s file=%s args=%s`） | P1     |
| AC2  | 工具执行成功时打印 DEBUG 日志（`tool=%s completed in %dms, lines=%d`） | P1     |
| AC3  | 工具执行异常时打印 WARNING 日志（`tool=%s failed: %s`），附带完整 traceback 到 DEBUG 级别 | P1     |
| AC4  | 日志 logger 命名为 `ala.services.agent_tools`（与现有模块级 logger 保持一致） | P2     |
| AC5  | 日志输出不包含敏感信息（如完整文件内容、API key） | P2     |

**相关文件**: `backend/src/ala/services/agent_tools.py`

**注意**: 与 US-A3 互补——US-A3 侧重"增加日志"，US-D1 侧重"日志的格式和级别规范，确保可运维性"。

---

#### US-D2：API 简易限流（可选，P2）

**作为** 系统管理员，
**我希望** `/api/logs/parse-local` 和 `/api/chat/sessions/{id}/messages` 端点有基础的请求频率限制，
**以便** 防止单个客户端（或 AI 代理循环）过度消耗后端资源。

**验收标准**:

| AC   | 描述                                                                                     | 优先级 |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| AC1  | 对 `/api/logs/parse-local` 端点应用速率限制：每 IP 每分钟最多 30 次请求（可配置） | P2     |
| AC2  | 对 `/api/chat/sessions/{id}/messages` 端点应用速率限制：每 session 每分钟最多 20 次请求 | P2     |
| AC3  | 超限时返回 HTTP 429 Too Many Requests，响应体包含 `Retry-After` 标头 | P2     |
| AC4  | 使用内存存储（如 `collections.defaultdict` + 时间戳）实现，无需外部 Redis 依赖 | P2     |
| AC5  | 新增配置项 `rate_limit_enabled: bool = False`（默认关闭，向后兼容）和 `rate_limit_requests_per_minute: int = 30` | P2     |

**相关文件**:

- `backend/src/ala/config.py`（新增配置项）
- `backend/src/ala/api/logs.py`（限流中间件或装饰器）
- `backend/src/ala/api/chat.py`（限流中间件或装饰器）

**优先级理由**: 作为桌面单用户工具，限流主要为防御性编程，优先级可降至 P2。若迭代时间紧张，可推迟至 v1.2。

---

## 3. 非功能性需求

### NFR-1：无回归

- 所有 55 个现有测试必须在修改后保持通过。
- 前端 `npm run build` 和 `npm run format:check` 必须零错误退出。
- `ruff check` 必须零错误退出。

### NFR-2：安全

- MCP Server 新增工具必须复用 `_validate_path()` 进行路径验证。
- 限流机制（US-D2）使用内存存储，不引入外部依赖。
- 日志中不记录完整文件路径的敏感部分（如 `/home/username/` 替换为 `~`）。

### NFR-3：可维护性

- 新增 MCP 工具的代码应尽量复用 `agent_tools.py` 中的 `_execute_lazy_log_tool` 逻辑，避免重复实现。理想方案是提取公共函数或直接委托调用。
- CI 流水线配置应简洁清晰，单个 Job 不超过 30 行 YAML。

### NFR-4：向后兼容

- 现有 MCP 工具（`parse_android_log` 等 5 个）保持完全不变。
- 现有 REST API 端点签名和返回格式不变（仅 HTTP 状态码修正）。
- 现有前端组件接口不变。

---

## 4. 范围外（本迭代不包含）

1. **前端 FileUpload lazy-log UI 实现** — US-1 和 US-6 的前端部分（本地路径输入框、AiPanel 集成）已记录在 `requirements-lazy-log.md` 中，但本迭代聚焦后端质量巩固。
2. **LogViewer 展示 AI 返回结果（US-8）** — 不在本迭代范围。
3. **Perfetto Trace Lazy Analysis** — 本迭代仅涉及日志分析；trace 懒加载分析推迟至后续迭代。
4. **持久化限流存储** — US-D2 使用内存实现，重启后限流状态丢失（可接受，桌面单用户工具）。
5. **Prometheus metrics** — NFR-5 中提到的 `ala_lazy_log_scan_duration_seconds` metric 推迟至 v1.2。
6. **`scan_file_meta` 提前终止优化（M6）** — 格式检测提前退出的性能优化推迟至 v1.2。

---

## 5. 依赖与集成点

| 组件                  | 文件                                          | 变更类型                         | 工作流 |
| --------------------- | --------------------------------------------- | -------------------------------- | ------ |
| Backend Tools         | `backend/src/ala/services/agent_tools.py`     | 修改 Schema + 执行逻辑 + 日志    | A, D   |
| Backend API           | `backend/src/ala/api/logs.py`                 | 修改 HTTP 状态码                 | A      |
| Backend Chat API      | `backend/src/ala/api/chat.py`                 | 修改 HTTP 状态码（file-path 端点） | A      |
| Backend MCP Server    | `backend/src/ala/mcp/server.py`               | 新增 5 个 MCP 工具               | B      |
| Backend Config        | `backend/src/ala/config.py`                   | 新增速率限制配置项               | D      |
| Backend Tests         | `backend/tests/test_trace_analyzer.py`        | 解耦 fastmcp 导入                | C      |
| CI/CD Pipeline        | `.github/workflows/ci.yml`（新建）             | 新建                             | C      |
| Frontend API Client   | `frontend/src/api/logs.ts`、`chat.ts`         | 按需适配 HTTP 状态码（可选）     | A      |
| README                | `README.md`                                   | 添加 CI Badge                    | C      |

---

## 6. 实现顺序（建议）

按优先级和工作流依赖关系排列：

1. **US-C2** — 修复 `test_trace_analyzer.py`（解耦 fastmcp），确保 CI 可运行全部测试。
2. **US-C3** — 审查并合并 9 个 Dependabot PR。
3. **US-C1** — 创建 CI 流水线（`.github/workflows/ci.yml`）。
4. **US-A4** — 修正 HTTP 错误码（logs.py + chat.py）。
5. **US-A1** — `overview_local_log` Schema 补充 `max_lines`。
6. **US-A2** — Lazy Tool Schemas 补充 `path` 参数。
7. **US-A5** — `read_log_range` 错误处理（`start_line > total_lines`）。
8. **US-A3 / US-D1** — 增加可观测性日志（同时完成，避免重复）。
9. **US-B1** — MCP Server 新增 5 个 lazy-log 工具。
10. **US-D2** — API 速率限制（如时间允许）。

---

## 7. 风险与缓解

| 风险                                           | 影响 | 缓解措施                                                                                           |
| ---------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| MCP Server 新增工具与现有 `agent_tools.py` 逻辑重复 | 中   | 优先提取公共函数（如 `_execute_lazy_log_tool` 重构为可被 MCP 工具调用的独立函数），减少代码重复 |
| 修正 HTTP 错误码破坏前端错误处理                | 低   | 前端当前主要依赖 `response.ok` 而非具体状态码；建议在 PR 中搜索 `status === 404` 等硬编码检查 |
| `fastmcp` 版本升级导致 MCP Server 行为变化      | 低   | Dependabot PR `fastmcp` 升级前查看其 CHANGELOG，与现有 5 个 MCP 工具进行回归测试 |
| Dependabot 依赖升级导致前端构建失败             | 中   | 先合并 `vite` 和 `postcss` 的升级，验证 `npm run build` 通过后再合并其他 PR |
| CI 测试因 `test_trace_analyzer.py` 导入问题持续失败 | 中   | 在 CI yml 中先排除该文件，待 US-C2 完成后恢复 |

---

## 8. 成功标准

以下全部满足视为迭代完成：

- [ ] 5 项规格偏离全部修复（US-A1 至 US-A5）。
- [ ] `mcp/server.py` 新增 5 个 lazy-log 工具并可通过 MCP 客户端调用。
- [ ] `.github/workflows/ci.yml` 已创建，Push/PR 触发 lint + test + build check 全部通过。
- [ ] `test_trace_analyzer.py` 测试不再因导入问题跳过。
- [ ] 9 个 Dependabot PR 已合并，所有测试通过。
- [ ] `_execute_lazy_log_tool` 执行路径有 DEBUG/WARNING 日志输出。
- [ ] 所有 55+7=62 个测试在 CI 中全部通过。
- [ ] `ruff check`、`npm run format:check`、`npm run build` 全部零错误。

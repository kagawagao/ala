# 基于 DeepSeek Harness 重构 ALA：MCP 工具与插件映射调研

> 调研对象：ALA 2.4.1（backend 15,260 行 Python、frontend 13,671 行 TS/TSX）与
> DeepSeek Harness 0.2.1-rc.5（`@deepseek-ai/dsh-*`，MIT，github.com/deepseek-ai/deepseek-harness）。
> 本文是可行性调研，不含代码改动。

## 0. 结论速览

| 问题                                     | 结论                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ALA 的能力都要做成 MCP 工具吗？          | 不要。只有二进制/专用解析（PCAP、HCI、Perfetto、日志结构化查询）值得；文本检索、读写、解压等 DSH 已原生具备。 |
| ALA 的每个部分都要做成插件吗？           | 不要。AI 会话、模型、工作区、上传、i18n、主题都由 DSH 原生提供；真正需要自建的是「域工具 + 域界面」。        |
| DSH 自身具备这些能力吗？                 | 通用能力基本具备（见第 1、2 节）；Android 诊断数据的解析与可视化不具备。                                     |
| 最小改造集                               | 1 个 host 插件 + 1 个 client 插件 + 1 个 agent preset + 2～3 个 skill + 1 个 bundle，Python 解析内核做 sidecar。 |

## 1. DSH 的能力基线

DSH 不是 Web 框架，而是一个可装配的 agent 运行时：CLI（`dsh`）、Web GUI、桌面端共用同一套
cordis 插件体系，bundle 通过 `cordis.patch.yml` 往运行时里插插件、插 agent preset、插客户端面板。

| 能力             | 提供者（0.2.1-rc.5 包）                                                                  | 说明                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Agent 循环与工具 | `dsh-agent-loop`、`dsh-tools`、`dsh-agent-tool-presentation`                              | 工具调用、轮次、结果呈现                                 |
| 会话与持久化     | `dsh-session`、`dsh-session-persistence(-jsonl)`、`dsh-compaction-*`                      | 会话历史、压缩、恢复                                     |
| 文件工具         | `dsh-tool-fs`（read/write/edit）、`dsh-tool-fs-search`（glob/grep，自带 ripgrep）         | 读文件、写文件、按内容/路径检索                          |
| Shell / 终端     | `dsh-tool-bash`、`dsh-tool-pwsh`、`dsh-terminal`、`dsh-jobs`                              | 命令执行、后台任务、终端面板                             |
| Web              | `dsh-tool-web`、`dsh-web-search-deepseek`、`dsh-web-fetch-http`                           | 抓网页、搜索                                             |
| 子代理与协作     | `dsh-tool-subagent`、`dsh-tool-subagent-control`、`dsh-tool-todo`、`dsh-tool-present`     | 并行子任务、待办、展示文件                               |
| Skills           | `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`                                     | Markdown 写领域知识，按需加载                            |
| MCP 客户端       | `dsh-mcp-client`、`dsh-mcp-resources`                                                     | 「connects to MCP servers and registers their tools on ctx.tools」 |
| 插件体系         | `@deepseek-ai/cordis`、`dsh-plugin-manager`、`dsh-plugin-market`                          | 插件安装、市场、启停、配置表单                           |
| 客户端 UI        | `dsh-client-ui-*`（chat、conversation、sidebar、workspace、settings、theme、locale 等）   | React 插件 + 槽位（main / sidebar.\* / settings / plugins） |
| 附件与上传       | `dsh-attachment`、`dsh-client-file-upload`                                                | 图片/文件随消息上传                                      |
| 模型与设置       | `dsh-llm-*`、`dsh-client-ui-settings-models`、`dsh-agent-preset`                          | 多 provider、模型选择、agent 预设                        |
| 权限             | `dsh-permission-presets`、`dsh-authorization`、`dsh-user-approval`                        | 工具授权、审批流                                         |
| 工作区           | `dsh-workspace`、`dsh-api-workspace-files`、`dsh-host-directory-picker-*`                 | 工作区、目录浏览、文件列表                               |
| 其他入口         | `dsh-headless`（一次性运行）、`dsh-acp`（JSON-RPC stdio）、`dsh-sdk-app`（嵌入）           | 无 GUI 运行、被其他程序驱动                              |

**结论**：DSH 已覆盖 ALA 里「AI 那半边」——对话、会话、工具调度、模型、权限、上传、工作区、
i18n/主题、客户端 UI 框架；ALA 需要自建的是「Android 诊断数据那半边」——解析与可视化。

## 2. 第 1 问：哪些能力适合做成 MCP 工具

### 2.1 判断标准

MCP 解决的是**跨进程 / 跨语言 / 跨客户端复用**。只有满足以下之一时才划算：

1. 实现必须留在 Python（scapy、perfetto、rarfile 等生态在 TS 里没有等价物）；
2. 还要给 DSH 之外的客户端用（Claude Desktop、Cursor、自研 agent）。

在 DSH 进程内，host 插件直接 `ctx.tools` 注册更简单：无额外进程、无序列化开销、可复用会话上下文、
可流式返回。MCP 的代价是：多一层协议与生命周期管理、二进制/blob 传输受限、鉴权与路径权限要重做。

### 2.2 逐项映射

| ALA 能力                 | 现有实现                     | 做成 MCP 的价值                                | DSH 原生替代                                  | 建议                                    |
| ------------------------ | ---------------------------- | ---------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| 日志结构化解析/过滤      | `log_analyzer.py` 1,257 行   | 中：可复用、可给外部客户端                     | `read`/`grep`/`bash rg` 覆盖探索式检索        | 过渡期用现有 MCP；终态并入 host 插件    |
| 大文件分页与 tail        | `read_log_range`/`tail_local_log` | 低                                        | `read` 的 offset/limit、`bash tail`           | 不单独做                                |
| 多行 stack trace 归并    | `log_analyzer.py`            | 中：模型直接读会漏归并                         | 无                                            | 并入日志工具                            |
| PCAP 解析/过滤/统计      | `pcap_analyzer.py` 520 行    | 高：二进制格式，DSH 无原生能力                 | 无原生；可 `bash` 调 `tshark`，或换 TS 解析库（能力弱于 scapy） | 值得（MCP 或插件内调 sidecar）          |
| HCI / BTSnoop 解析       | `hci_analyzer.py` 983 行     | 高：同上                                       | 无原生（可借 Wireshark 生态，需外部依赖）     | 值得                                    |
| Perfetto trace 解析/SQL  | `trace_analyzer.py` 577 行   | 高：TraceProcessor 主要走 Python/CLI           | 无原生；WASM SDK 功能受限                     | 值得                                    |
| ANR / Tombstone 结构化   | `diagnostic_parser.py` 546 行 | 中：纯文本可读，但结构化省 token              | `read` + 模型自行理解                         | 值得做成工具，MCP 可选                  |
| 文件类型探测（按 header） | `file_detector.py`          | 低：一行 `file`/`head` 即可                    | `bash file`、`read` 前若干字节                | 做成插件内部 helper，不是工具           |
| 项目代码扫描（日志模式） | `code_scanner.py`           | 无：DSH 的 grep/glob 更强                      | `dsh-tool-fs-search`                          | 不做                                    |
| 解压 gz/zip/rar/7z       | 内建解压链路                 | 无：shell 工具即可                             | `bash` + unzip/7z/tar                         | 不做                                    |
| 文件编辑/写入            | `CODING_TOOLS`              | 无                                             | `dsh-tool-fs` 的 write/edit                   | 不做                                    |
| 会话/模型/SQLite 存储    | `session_manager.py`、`model_manager.py` | 无                               | 会话持久化、模型设置                          | 不做                                    |
| 对外 MCP server（14 工具） | `mcp/server.py` 920 行     | 产品能力：给第三方 AI 客户端用                 | 当前版本 DSH 只有 MCP client，没有 MCP server | 保留为独立形态，与迁移解耦              |

### 2.3 结论

- **建议做成 MCP 工具的**：PCAP、HCI、Perfetto、日志结构化查询。它们的共同点是「Python 专属解析 +
  DSH 无等价物」，用 MCP 可以零重写地接进 DSH（`dsh-mcp-client` 直接消费）。
- **不建议做成 MCP 工具的**：文本检索、文件读写、解压、项目扫描、会话与模型管理——DSH 原生已有，
  再做一层 MCP 只会增加延迟与维护面。
- **ALA 现有 MCP server 保留但降级**：它是「对外产品能力」（让 Claude/Cursor 用 ALA），不是 DSH
  迁移的必需品；DSH 侧要反向暴露能力用的是 ACP（`dsh-acp`）或 SDK。

## 3. 第 2 问：哪些部分适合做成插件

### 3.1 DSH 的四种扩展形态

| 形态         | 载体                       | 适合放什么                                     |
| ------------ | -------------------------- | ---------------------------------------------- |
| host 插件    | Node/TS，`ctx.tools`/命令  | 领域工具、与外部进程（Python sidecar）桥接     |
| client 插件  | React，`ctx.slots`         | 领域界面：查看器、过滤器、上传面板             |
| skill        | Markdown                   | 领域知识、分析手法、排查 checklist             |
| agent preset | 配置（`dsh-agent-preset`） | 工具集 + persona + 轮次/权限，组装成「分析员」 |
| bundle       | `cordis.patch.yml`         | 把以上打包成可安装/可分发的整体                |

现成样板：`dsh-superagent-prototype` 就是第三方 bundle——`cordis.patch.yml` 插入插件与 preset，
`src/client/index.tsx` 用 `ctx.slots.register` 注册主面板、侧边栏图标与设置页。说明「领域应用做成
DSH 插件」的路径已经在生产环境走通。

### 3.2 逐项映射

| ALA 部分                    | 现在是什么                          | 插件形态                     | 必要性 | DSH 原生替代                                | 建议                     |
| --------------------------- | ----------------------------------- | ---------------------------- | ------ | ------------------------------------------- | ------------------------ |
| 域解析工具集                | Python 服务 + REST/SSE              | host 插件（内部调 sidecar）  | 高     | 无                                          | 必做                     |
| 日志/PCAP/HCI/Trace 查看器  | 4 个 React 组件，合计约 1,255 行    | client 插件（main panel）    | 高     | 无（`sidebar-documentpreview` 只预览文本） | 必做                     |
| 过滤器面板 + 预设           | 4 个面板约 1,247 行 + localStorage  | client 插件                  | 高     | 无                                          | 必做（保留 draft/apply） |
| 上传 / 待解析批次           | `FileUpload`、`PendingFilesView`    | client 插件（复用 DSH 上传） | 中     | `client-file-upload`/`attachment` 有上传    | 做简化版                 |
| 导出 CSV/JSON               | `utils/export.ts`                   | 可选命令/工具                | 低     | agent 直接写文件                            | 低优先                   |
| AI 对话面板                 | `AiPanel.tsx` 1,254 行              | 不做                         | —      | `client-ui-chat`/`conversation`/`attachment` | 删除                     |
| Agent 循环 / 工具调度       | `ai_service.py` 1,153 + `agent_tools.py` 3,288 | 不做              | —      | `agent-loop` + `tools`                      | 删除                     |
| 会话持久化                  | SQLite + IndexedDB                  | 不做                         | —      | `session-persistence`                       | 删除                     |
| 模型库 / 配置               | `ModelPage` + `/api/config`         | 不做                         | —      | `settings-models`/`llm-*`                   | 删除                     |
| 项目管理 / 文件浏览         | `ProjectPage`、`AppSider`           | 不做                         | —      | `workspace`/`sidebar-files`/目录选择器      | 删除                     |
| 使用指南页                  | `GuidePage` + `public/guide/*.md`   | skill                        | 中     | `skill` 机制                                | 转 skill                 |
| i18n / 主题                 | 自建 i18next + AntD 主题            | 不做                         | —      | `client-locale`/`client-ui-theme`           | 删除                     |
| 分析手法知识                | 散落在 system prompt / 预设里       | skill                        | 高     | `skill` 原生                                | 必做（成本低收益高）     |
| 「分析员」预设              | 无（写死在 ai_service）             | agent preset                 | 高     | `agent-preset` 原生                         | 必做                     |
| 分发与装配                  | Docker + PyInstaller                | bundle                       | 高     | `cordis.patch.yml` + 插件市场               | 必做                     |

### 3.3 必要清单（最小集）

1. **host 插件 `ala-tools`**：注册日志/PCAP/HCI/Trace/诊断工具；内部通过 MCP 或 HTTP 调 Python
   sidecar（过渡期直接接现有 `/mcp`），终态可把轻量逻辑（文件探测、日志结构化）移到 TS。
2. **client 插件 `ala-workbench`**：主面板内放 4 个虚拟滚动查看器 + 过滤器 + 上传批次；沿用
   draft/apply 交互与预设存储。
3. **agent preset `ala-analyst`**：persona + 上述工具集 + 合理的轮次/权限。
4. **skills**：logcat 判读、ANR/tombstone 判读、Perfetto 性能分析，各一篇 Markdown。
5. **bundle**：`cordis.patch.yml` 装配以上内容，附带默认配置与依赖声明。

### 3.4 可以直接删掉的部分

后端约 5,000 行（`ai_service`、`agent_tools`、`chat.py`、`session_manager`、模型/配置文件）与前端
约 2,000 行（`AiPanel`、模型页、项目页、i18n 自建、IndexedDB 会话、SSE 客户端）由 DSH 原生替代，
不再需要维护。ALA 保留的核心是：解析引擎（约 3,300 行 Python）、文件探测、查看器与过滤器交互。

## 4. 落地顺序

| 阶段   | 内容                                                                                     | 产出验证                               |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| 阶段 1 | bundle + host 插件 + preset + skill；工具走现有 MCP；客户端先用 iframe 嵌现有 SPA         | 在 DSH 里完成「上传日志 → 对话分析」   |
| 阶段 2 | client 插件迁查看器/过滤器；下线 SSE/REST 的 UI 依赖                                      | 不再启动 ALA 自有 Web 前端即可分析     |
| 阶段 3 | 解析器去留（Python sidecar 长期保留 vs TS/WASM 重写）与分发形态（DSH 应用/插件）的最终决策 | 发布形态确定                           |

阶段 1 预计 1～2 周，阶段 2 约 2～4 周；阶段 3 取决于是否接受 DSH 作为用户侧宿主。

## 5. 待决问题

- **分发形态**：ALA 是否接受「作为 DSH 的插件/应用分发」？若坚持独立安装包，需要把 DSH runtime
  嵌进自己的 Electron 壳（`dsh-desktop-host`、`dsh-app-boot` 已具备基础）。
- **Python sidecar 的打包**：PyInstaller 子进程、本地服务还是容器，取决于分发形态。
- **对外 MCP server 与 `ala` CLI 是否保留**：它们是 ALA 的独立产品面，可与 DSH 迁移并行存在。
- **版本基线**：DSH 仍是 0.2 RC，插件 API 与配置格式会变，需要固定版本并预留升级预算。

## 附：证据来源

- `@deepseek-ai/dsh-*` 0.2.1-rc.5 包清单与描述（`dsh-mcp-client`、`dsh-tool-fs*`、`dsh-client-ui-*`、
  `dsh-acp`、`dsh-headless` 等）。
- `dsh-superagent-prototype`：第三方 bundle 注册主面板 / 侧边栏 / 设置页的实现
  （`cordis.patch.yml`、`src/client/index.tsx`）。
- ALA 代码规模：backend 15,260 行 Python、frontend 13,671 行 TS/TSX、47 个 REST 端点、MCP 14 个工具、
  CLI 3 个命令。

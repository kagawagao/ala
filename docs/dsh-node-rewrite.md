# ALA 全栈 Node 化 · 基于 DSH 的 bundle 重写

> 状态（2026-11-01）：阶段 1 已完成并可运行 —— Node 解析引擎、DSH agent 工具、skills、`ala` CLI 与
> bundle 装配。Web 工作台（查看器/过滤器）与 Perfetto 仍在迁移中，Python 后端在迁移完成前继续提供服务。
> 相关调研：PR #115《基于 DeepSeek Harness 重构 ALA：MCP 工具与插件映射调研》（已关闭）。

## 1. 决策

用户确定的最终形态：

1. **全栈 Node** —— 不再保留 Python sidecar。解析引擎、agent 工具、CLI、bundle 运行时全部是 Node/TypeScript。
2. **基于 DSH 重写** —— ALA 不再自建 AI 会话、模型库、项目/工作区、上传、i18n 与主题；这些由
   DeepSeek Harness 原生提供。ALA 只保留领域能力（Android 诊断数据解析 + 查看器）。
3. **以 bundle 发布** —— 产物是一个可安装的 DSH bundle（`package.json` 的 `dsh.bundle.patch` +
   `cordis.patch.yml`），通过 `dsh plugin add` 装配进 profile。

这与 PR #115 的推荐（保留 FastAPI + Python 解析、用 DSH 替换 AI 层，即 sidecar 方案）不同：该调研把
「全量重建」列为 20–30 人周的高风险路径并建议暂缓；用户随后明确要求走全量 Node 路线，因此本实现按
「先引擎、后界面、最后下线 Python」推进。

## 2. 本次交付（`node/`）

### 2.1 包与 bundle 结构

```
node/
├── package.json          # dsh.bundle.patch → cordis.patch.yml；bin.ala
├── cordis.patch.yml      # insert ala-dsh（host 插件）
├── tsdown.config.ts      # ESM 构建：index / host / cli
├── skills/               # android-logcat、android-diagnostics
└── src/
    ├── core/             # 与 Python 行为对齐的解析引擎（无第三方依赖）
    │   ├── file-detect/  # header 探测：log/pcap/hci/trace/anr/tombstone
    │   ├── log/          # logcat/generic/unknown 解析、过滤、统计、惰性按行流、gz/zip
    │   ├── diagnostic/   # ANR trace / native tombstone 结构化解析
    │   ├── hci/          # BTSnoop 解析、过滤、统计、opcode/event 解码
    │   └── pcap/         # PCAP/PCAPng 解析（自研，替代 scapy）、过滤、统计
    ├── host/             # DSH host 插件：工具、路径校验、skills 注册
    └── cli/              # ala detect/overview/search/tail
```

### 2.2 注册的 agent 工具

| 工具                    | 说明                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `ala_detect_file_type`  | 按内容（非扩展名）判定产物类型                               |
| `ala_log_overview`      | 格式、行数、级别分布、Top tag、首批命中条目                  |
| `ala_log_search`        | 惰性全量扫描：级别/关键字正则/tag/PID/TID/时间范围，支持分页 |
| `ala_log_read_range`    | 按行号读取上下文                                             |
| `ala_log_tail`          | 尾部 N 条，不整文件载入内存                                  |
| `ala_parse_diagnostic`  | ANR / tombstone 自动识别 + 结构化 JSON                       |
| `ala_pcap_overview`     | PCAP/PCAPng 协议分布、IP/连接数、时长、样例                  |
| `ala_pcap_search`       | 协议/IP/端口/TCP flags/关键字/时间过滤                       |
| `ala_hci_overview`      | BTSnoop 类型/方向分布、时长、唯一 opcode、样例               |
| `ala_hci_search`        | 类型/方向/opcode/event/名称/关键字/时间过滤                  |
| `ala_decode_hci_opcode` | opcode → OGF/OCF/命令名                                      |

两个 skill（`android-logcat`、`android-diagnostics`）让 agent 知道先 overview、再窄搜索、最后按行号读上下文，
以及 ANR 主线程/锁链、tombstone signal/backtrace 的判读方法。

### 2.3 CLI

`ala detect|overview|search|tail`，与 Python Typer CLI 的命令面一致，输出为纯文本（不含 Rich 着色）。
可直接 `node dist/cli.js …`，开发时 `node --experimental-strip-types src/cli/index.ts …`。

### 2.4 安装与验证

```bash
cd node && npm ci && npm run build
dsh plugin --profile ala add "$PWD"
dsh --profile ala --dump-config | grep -A2 ala-dsh   # 确认 bundle 层被叠加
dsh --profile ala web                                # 工具与 skills 在 Session 中可用
```

## 3. 行为兼容与有意差异

- **Wire 字段保持 snake_case**（`line_number`、`source_file`、`tag_keyword_relation` 等），与 Python
  dataclass、现有 NDJSON 接口和前端类型一致，便于后续直接复用前端。
- Python 测试套件是行为契约：`backend/tests/test_log_analyzer.py`、`test_lazy_log.py`、
  `test_diagnostic_parser.py`、`test_hci_analyzer.py`、`test_pcap_analyzer.py` 的用例被移植到
  `node/src/core/**/*.test.ts`（vitest），并以 `examples/sample-android.log`、`examples/sample-network.pcap`
  做真实文件回归。
- 有意差异：
  - **PCAP**：Python 依赖 scapy；Node 端实现无依赖的 pcap/pcapng 解析（以太网/VLAN/IPv4/IPv6/TCP/UDP/ICMP），
    字段与 `_packet_to_entry` 对齐。
  - **rar/7z**：仍优先调用系统 `7z`/`unrar`，无系统工具时报明确错误（Python 走 rarfile 库）。
  - **Perfetto**：未移植。Node 没有官方 TraceProcessor 绑定，见下方计划。

## 4. 剩余工作

| 阶段 | 内容                                                                                                           | 状态   |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 2    | **工作台 client 插件**：日志/PCAP/HCI 查看器 + 过滤器 + 上传批次（复用 `frontend/src/components` 与 API 形状） | 未开始 |
| 2    | **Perfetto**：评估 WASM TraceProcessor vs 打包 `trace_processor_shell` 子进程，选定后实现解析/SQL 工具         | 未开始 |
| 2    | 把前端 REST 调用收敛到 bundle 内部接口（或直连 DSH 服务），下线 `backend/` 的 AI/会话/模型/项目代码            | 未开始 |
| 3    | 删除 Python 后端、PyInstaller/Docker 旧分发路径；`ala` 二进制改为 Node 入口                                    | 未开始 |
| 3    | 发布流水线：npm 包（含 `dsh.bundle.patch`）+ GitHub Release；固定 DSH 0.2.1-rc.5 基线并预留升级预算            | 未开始 |
| 3    | 追加 agent preset（分析员）与更多 skill（Perfetto、bugreport 路由、网络抓包）                                  | 未开始 |

## 5. 风险与待决问题

- **DSH 仍是 0.2 RC**：插件 API、bundle patch 格式、client 插件构建方式都会变；本包只依赖
  `ctx.tools`/`ctx.skills`/`ctx.effect` 这组稳定面，客户端插件落地时需要再核对版本。
- **Perfetto 是最大的技术不确定项**：TraceProcessor 的 SQL/摘要能力是 ALA 的核心功能之一，
  WASM 版本的包体积与性能需要实测；若不可接受，则保留一个随 bundle 分发的 `trace_processor_shell`
  子进程（仍是 Node 进程编排，但不再是「纯 JS」）。
- **双轨期**：工作台未迁移前，Python 后端仍服务现有 Web UI；本 PR 不删除任何 Python 代码，也不改动现有前端行为。
- **路径约定**：工具接受绝对路径（相对路径按 DSH 进程 cwd 解析）；路径校验拒绝 `..` 段（沿用 Python 的
  Web API 防护），CLI 会先 realpath 再交给引擎。

## 6. 验证记录（2026-11-01，本机）

| 检查                                                    | 结果                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `cd node && npm run typecheck`                          | 通过（`tsc --noEmit`，0 error）                                                                         |
| `cd node && npm test`                                   | 6 个测试文件、259 个用例全部通过（log 95 / hci 68 / diagnostic 56 / pcap 17 / file-detect 15 / host 8） |
| `cd node && npm run build`                              | tsdown 产出 `dist/index.js`、`dist/host.js`、`dist/cli.js`（171 kB）                                    |
| `node dist/cli.js overview examples/sample-android.log` | 识别 `android_logcat`、47 行、级别分布与 Top tag 正确                                                   |
| `node dist/cli.js search … --level E`                   | 命中 3 条错误，行号与内容正确                                                                           |
| `examples/sample-network.pcap`（真实抓包）              | 解析出 TCP 包与协议统计（pcap 测试用例）                                                                |
| `dsh plugin --profile ala-spike add <node/>`            | bundle 依赖安装成功，`--dump-config` 中出现 `ala-dsh` 层                                                |
| `dsh --profile ala-spike web`（DSH 0.2.1-rc.5）         | Web 服务正常启动，插件激活无警告（`apply` 完成；工具注册由 host 测试覆盖）                              |

Python 侧对照：解析行为以 `backend/tests/test_*.py` 为契约逐项移植，并在移植过程中用 Python 模块做了差分校验
（log 的内容/过滤/归档/流式、diagnostic 的 26 个 fixture、hci 的 11 包合成抓包与 6541 个时间戳）；除上文
「有意差异」外结果一致。

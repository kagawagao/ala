# ALA User Guide

ALA (Android Log Analyzer) is a full-stack AI-powered tool for analyzing Android logcat output, Perfetto traces, and network captures (PCAP).
**Version 2.3.3**

---

## Quick Start

1. **Open a file** – Click the upload panel, drag and drop a file into the main area, or type a local file/directory path in the path input below the upload area.
   Supported formats: `.log`, `.txt`, `.gz`, `.zip` (logcat), `.pb`, `.json` (Perfetto trace), `.pcap`, `.pcapng` (network capture).
2. **Apply filters** – Press `Ctrl+K` (or `Cmd+K` on macOS) to open the filter drawer on the right side, set your criteria, and click **Apply Filters** to update the view.
3. **Switch views** – Toggle between the **Log Analysis**, **Trace Analysis**, and **PCAP Analysis** tabs to inspect results.
4. **Select a project** – Optionally pick a project from the header dropdown to supply source code context to the AI assistant.

---

## Log Analysis

- Upload one or more `.log`, `.txt`, `.gz`, or `.zip` files via drag-and-drop or the file picker, or enter a local file/directory path in the path input below the upload area.
- Open the **filter drawer** (`Ctrl+K`) to narrow down results:
  - **Keywords** – Regular expression supported, with AND/OR operator modes.
  - **Log Level** – Verbose, Debug, Info, Warning, Error, Fatal.
  - **Tag** – Regular expression supported, with Top Tags quick-select.
  - **Time Range** – Format: `MM-DD HH:mm:ss.SSS`.
  - **PID**, **TID** – Optional exact-match fields.
- **Filter Presets** – Save frequently used filter combinations and reload them later. Presets are saved per-project when a project is selected, or globally.
- **Word Wrap** – Toggle line wrapping for long log messages.
- **Highlights** – Mark keywords visually without affecting the displayed log set.
- **Export** – Download filtered log entries as CSV (RFC 4180, with BOM) or JSON.

---

## Trace Analysis

- Upload a Perfetto trace file (`.pb` or `.json`).
- Browse the **Trace Summary**: duration, processes, threads, top slices, FTrace events, and metadata.
- Apply a **Process Filter** by process name (regex, case-insensitive) or PID list.
- Use **SQL Query** (Python Perfetto API) to run custom queries against the trace for advanced analysis.

---

## PCAP Analysis

- Upload one or more network capture files (`.pcap` or `.pcapng`).
- View **packet-level details**: packet number, timestamp, protocol, source/destination IP and port, TCP flags, and payload length.
- Browse **Protocol Distribution** to see the breakdown by protocol (TCP, UDP, ICMP, etc.).
- Apply **PCAP Filters**:
  - **Protocol** – Filter by specific protocol.
  - **Source IP / Destination IP** – IP address matching.
  - **Source Port / Destination Port** – Port number matching.
  - **TCP Flags** – Filter by TCP flag combinations (SYN, ACK, FIN, RST, etc.).
- **Lazy loading** — PCAP files are uploaded to temporary storage and filtered on-demand via streaming. Large captures load progressively without blocking the UI.
- **Statistics** — Unique IPs, total connections, and protocol distribution are computed server-side for performance.

---

## AI Assistant

1. **Configure AI** – Go to **Model Management** (grid icon in the header) and enter your API endpoint, key, and model.
   ALA supports Anthropic Claude, OpenAI-compatible APIs, and any provider with an OpenAI-compatible endpoint. Custom models can be added, enabled/disabled, and configured with thinking support.
2. **Ask questions** – Type in the AI chat panel on the right. The assistant can analyze filtered log entries, loaded traces, PCAP data, and local file/directory contents.
3. **Agent mode** – Enable agent mode to let the AI actively query log overviews, search entries, inspect trace processes, run SQL queries on traces, and filter PCAP packets.
4. **Attach context** – Use the context selector to focus the assistant on logs, trace data, PCAP data, a local file, a local directory, or general questions.
5. **Lazy local analysis** – Point ALA at a local file or directory path. The AI agent explores logs on-demand with streaming tools: no upload needed, no file size cap.
6. **Extended thinking** – Enable "Thinking mode" (Anthropic) for deeper reasoning with configurable budget tokens.

---

## Projects

Projects register a local source code directory so the AI assistant can read code for richer analysis.

1. Open **Project Settings** (folder icon in the header).
2. Click **Add Project**, enter a name and the absolute path to your Android source directory.
3. Select the project from the header dropdown to activate it.
4. **Context documents** (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, etc.) found inside the project are automatically injected into AI context.
5. Use **Initialize Filters** / **Update Filters** to generate filter presets based on the project's logging patterns (ripgrep-backed, 265× faster than pure Python).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Toggle filter drawer |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Switch to Log Analysis tab and open filter drawer |
| `Ctrl+D` / `Cmd+D` | Toggle dark/light theme |
| `Esc` | Close upload popover → close filter drawer → collapse AI panel |

---

## Tips

- **Filter presets** are saved per-project (when a project is selected) or globally in `localStorage`.
- The **backend must be running** before the frontend connects. If the status tag shows "Disconnected", start the Python backend.
- API keys are stored **locally in your browser** (`localStorage`) and are sent to the ALA backend only to forward requests to the configured AI provider. They are never sent to any third-party service other than the one you configured.
- Log files are streamed to the backend incrementally; very large files will appear progressively.
- PCAP files use lazy-loading: they are uploaded to a temporary path and filtered on-demand — no full-file parsing until you apply filters.
- Use the **Export** button (CSV or JSON) to download filtered log entries for further processing.
- The version number is displayed in the header — useful when reporting issues.

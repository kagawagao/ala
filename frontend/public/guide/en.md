# ALA User Guide

ALA (Android Log Analyzer) is a full-stack AI-powered tool for analyzing Android logcat output and Perfetto traces.

---

## Quick Start

1. **Open a file** – Click the upload panel or drag and drop a log or trace file into the main area.  
   Supported formats: `.log`, `.txt`, `.gz`, `.zip` (logcat), `.pb`, `.json` (Perfetto trace).
2. **Apply filters** – Use the sidebar to set time range, keywords, log level, tag, PID, or TID.  
   Click **Apply Filters** to update the log view.
3. **Switch views** – Toggle between the **Log Analysis** and **Trace Analysis** tabs to inspect results.
4. **Select a project** – Optionally pick a project from the header dropdown to supply source code context to the AI assistant.

---

## Log Analysis

- Upload one or more `.log`, `.txt`, `.gz`, or `.zip` files.
- Use the **sidebar filters** to narrow down results:
  - **Keywords** – Regular expression supported.
  - **Log Level** – Verbose, Debug, Info, Warning, Error, Fatal.
  - **Tag** – Regular expression supported.
  - **Time Range**, **PID**, **TID** – Optional exact-match fields.
- **Filter Presets** – Save frequently used filter combinations and reload them later.
- **Word Wrap** – Toggle line wrapping for long log messages.
- **Highlights** – Mark keywords visually without affecting the displayed log set.

---

## Trace Analysis

- Upload a Perfetto trace file (`.pb` or `.json`).
- Browse the **Trace Summary**: duration, processes, threads, top slices, FTrace events, and metadata.
- Apply a **Process Filter** by process name (regex, case-insensitive) or PID list.

---

## AI Assistant

1. **Configure AI** – Go to **Model Management** (grid icon in the header) and enter your API endpoint, key, and model.  
   ALA supports Anthropic Claude, OpenAI-compatible APIs, and any provider with an OpenAI-compatible endpoint.
2. **Ask questions** – Type in the AI chat panel on the right. The assistant can analyze filtered log entries and loaded traces.
3. **Agent mode** – Enable agent mode to let the AI actively query log overviews, search entries, and inspect trace processes.
4. **Attach context** – Use the context selector to focus the assistant on logs, trace data, or general questions.
5. **Extended thinking** – Enable "Thinking mode" (if supported by the model) for deeper reasoning.

---

## Projects

Projects register a local source code directory so the AI assistant can read code for richer analysis.

1. Open **Project Settings** (folder icon in the header).
2. Click **Add Project**, enter a name and the absolute path to your Android source directory.
3. Select the project from the header dropdown to activate it.
4. **Context documents** (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, etc.) found inside the project are automatically injected into AI context.
5. Use **Initialize Filters** / **Update Filters** to generate filter presets based on the project's logging patterns.

---

## Tips

- **Filter presets** are saved per-project (when a project is selected) or globally in `localStorage`.
- The **backend must be running** before the frontend connects. If the status tag shows "Disconnected", start the Python backend.
- API keys are stored **locally in your browser** and never sent to the ALA server itself.
- Log files are streamed to the backend incrementally; very large files will appear progressively.
- Use the **Export** button (CSV or JSON) to export filtered log entries for further processing.

# Android Log Analyzer (ALA) - UI Screenshot

Since this is a live Electron application, here's a description of the UI:

## Main Interface

The application features a two-panel dark-themed interface:

### Left Panel (Control Panel - 384px width):
- **File Controls**: "Open Log File" button with file path display
- **Filters Section**:
  - Start Time & End Time inputs (MM-DD HH:MM:SS.mmm format)
  - Keywords input (regex supported: e.g., "error|crash|exception")
  - Log Level dropdown (All, Verbose, Debug, Info, Warning, Error, Fatal)
  - Tag Filter input (regex)
  - PID Filter input
  - "Apply Filters" and "Clear" buttons
- **AI Analysis Section**:
  - Custom prompt textarea
  - "Analyze with AI" button
  - Status message area

### Right Panel (Main Content - Flexible width):
- **Statistics Bar**: Displays total logs, filtered count, errors, and warnings
- **Tabs**: Log Viewer and AI Analysis
- **Log Viewer Tab**: 
  - Syntax-highlighted log entries
  - Color-coded by log level (Error: red, Warning: yellow, Info: blue, Debug: teal, etc.)
  - Monospace font for readability
  - Custom scrollbar
- **AI Analysis Tab**:
  - Formatted AI analysis results
  - Markdown-style rendering

### Color Theme:
- Background: #1e1e1e (dark)
- Panels: #252526 (slightly lighter dark)
- Accents: #007acc (blue), #4ec9b0 (teal), #c586c0 (purple)
- Text: #d4d4d4 (light gray)
- Log Colors: Error (#f48771), Warning (#dcdcaa), Info (#9cdcfe), Debug (#4ec9b0)

### Key Features Visible in UI:
✓ Dark VSCode-style theme
✓ Professional layout with TailwindCSS
✓ Syntax highlighting for log levels
✓ Real-time statistics
✓ Tab-based navigation
✓ Responsive design

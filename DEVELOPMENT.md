# Development Guide

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- (Optional) OpenAI API key for AI features

### Installation

```bash
# Clone the repository
git clone https://github.com/kagawagao/ala.git
cd ala

# Install dependencies
npm install
```

## Development

### Running in Development Mode

```bash
npm run dev
```

This will launch the Electron app with DevTools open.

### Testing

```bash
npm test
```

This runs the backend unit tests that verify:
- Log parsing functionality
- Statistics calculation
- Filtering (by level, keywords, time range, tag, PID)
- Combined filtering

### Project Structure

```
ala/
├── src/
│   ├── main.js                 # Electron main process
│   │                           # - Handles app lifecycle
│   │                           # - Creates browser windows
│   │                           # - Manages IPC communication
│   │
│   ├── backend/
│   │   ├── logAnalyzer.js      # Core log analysis logic
│   │   │                       # - parseLog(): Parses Android logcat format
│   │   │                       # - filterLogs(): Applies filters
│   │   │                       # - getStatistics(): Computes stats
│   │   │
│   │   └── aiService.js        # AI integration
│   │                           # - analyzeLogs(): Sends logs to OpenAI
│   │                           # - prepareLogSummary(): Formats logs for AI
│   │
│   └── renderer/
│       ├── index.html          # Main UI structure
│       ├── styles.css          # UI styling (dark theme)
│       └── renderer.js         # UI logic and IPC client
│
├── examples/
│   └── sample-android.log      # Example log file for testing
│
├── test/
│   └── test-backend.js         # Backend unit tests
│
└── package.json                # Node.js project configuration
```

## Architecture

### Main Process (src/main.js)

The main process is responsible for:
- Creating and managing the application window
- Handling file open dialogs
- Coordinating backend services (LogAnalyzer, AIService)
- Processing IPC messages from the renderer

**IPC Handlers:**
- `open-log-file`: Opens file dialog and reads log file
- `parse-log`: Parses log content
- `filter-logs`: Applies filters to logs
- `analyze-with-ai`: Sends logs to AI for analysis
- `check-ai-configured`: Checks if AI service is configured

### Backend Services

#### LogAnalyzer (src/backend/logAnalyzer.js)

Handles all log processing operations:

**parseLog(content)**
- Parses Android logcat format: `MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE`
- Returns array of structured log objects
- Handles multi-line logs and non-standard formats

**filterLogs(logs, filters)**
- Filters by time range (startTime, endTime)
- Filters by keywords (space-separated, case-insensitive)
- Filters by log level (V/D/I/W/E/F)
- Filters by tag (regex support)
- Filters by PID

**getStatistics(logs)**
- Counts logs by level
- Counts logs by tag
- Counts logs by PID
- Returns summary statistics

#### AIService (src/backend/aiService.js)

Integrates with OpenAI API:

**analyzeLogs(logs, prompt)**
- Prepares log summary (prioritizes errors/warnings)
- Sends to OpenAI GPT-3.5-turbo
- Returns AI analysis with insights

**prepareLogSummary(logs)**
- Limits logs to avoid token limits
- Prioritizes fatal errors, errors, and warnings
- Formats logs for AI consumption

### Renderer Process (src/renderer/)

The renderer process handles the UI:

**Event Handling:**
- File open button
- Filter application
- AI analysis trigger
- Tab switching

**UI Updates:**
- Renders filtered logs with syntax highlighting
- Updates statistics counters
- Displays AI analysis results
- Shows status messages

## Android Log Format

### Standard Format

```
MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE
```

### Log Levels

- `V` - Verbose: Detailed debug information
- `D` - Debug: Debug messages
- `I` - Info: Informational messages
- `W` - Warning: Warning messages
- `E` - Error: Error messages
- `F` - Fatal: Fatal errors

### Example

```
01-15 10:30:25.123  5678  5678 I MyApp: Application started
01-15 10:30:25.234  5678  5678 D MyApp: Loading configuration
01-15 10:30:25.345  5678  5678 E MyApp: Failed to connect: timeout
```

## Adding New Features

### Adding a New Filter Type

1. Add UI control in `src/renderer/index.html`
2. Add filter logic in `src/backend/logAnalyzer.js:filterLogs()`
3. Update renderer to pass new filter in `src/renderer/renderer.js`

### Adding New AI Capabilities

1. Update system prompt in `src/backend/aiService.js`
2. Modify `prepareLogSummary()` to include new information
3. Update UI to display new analysis format

### Adding New IPC Handlers

1. Add handler in `src/main.js`:
```javascript
ipcMain.handle('my-new-handler', async (event, args) => {
  // Implementation
  return result;
});
```

2. Call from renderer in `src/renderer/renderer.js`:
```javascript
const result = await ipcRenderer.invoke('my-new-handler', args);
```

## Building for Production

```bash
npm run build
```

This creates platform-specific builds in the `dist/` directory:
- macOS: `.dmg` file
- Windows: `.exe` installer
- Linux: `.AppImage` file

## Environment Variables

### OPENAI_API_KEY

Required for AI analysis features.

**Setting on macOS/Linux:**
```bash
export OPENAI_API_KEY='sk-...'
npm start
```

**Setting on Windows:**
```cmd
set OPENAI_API_KEY=sk-...
npm start
```

**Permanent setup:**
Add to your shell profile (`.bashrc`, `.zshrc`, etc.):
```bash
export OPENAI_API_KEY='sk-...'
```

## Troubleshooting

### Electron not found
```bash
npm install
```

### AI analysis not working
- Ensure `OPENAI_API_KEY` is set
- Check console for error messages
- Verify API key is valid

### Logs not parsing correctly
- Check log format matches Android logcat format
- Try the example log in `examples/sample-android.log`
- Check console for parsing errors

## Performance Considerations

### Large Log Files

For files with thousands of lines:
- UI limits rendering to first 1000 lines
- All filtering happens on full dataset
- Use filters to narrow down results

### AI Analysis

- Limited to first 100 logs (configurable in `aiService.js`)
- Prioritizes errors and warnings
- Character limit prevents token overflow

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

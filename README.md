# ALA - Android Log Analyzer

An Electron-based desktop application for analyzing Android logs with AI-powered insights. Built with JavaScript, featuring a Node.js backend and a modern UI.

## Features

- 📱 **Android Log Parsing**: Parse standard Android logcat format line by line
- 🔍 **Advanced Filtering**: Filter logs by:
  - Time range (start/end timestamps)
  - Keywords (space-separated search terms)
  - Log level (Verbose, Debug, Info, Warning, Error, Fatal)
  - Tag patterns (regex support)
  - Process ID (PID)
- 🤖 **AI Analysis**: Integrate with OpenAI to analyze logs and get insights about:
  - Errors and warnings
  - Potential crashes
  - Performance concerns
  - Notable patterns
  - Debugging recommendations
- 💻 **Modern UI**: Clean, dark-themed interface with:
  - Real-time log viewer with syntax highlighting
  - Statistics dashboard
  - Tabbed interface for logs and AI analysis
  - Responsive design

## Installation

### Prerequisites

- Node.js 18+ and npm
- (Optional) OpenAI API key for AI analysis features

### Setup

1. Clone the repository:
```bash
git clone https://github.com/kagawagao/ala.git
cd ala
```

2. Install dependencies:
```bash
npm install
```

3. (Optional) Configure AI features:
```bash
# Set your OpenAI API key
export OPENAI_API_KEY='your-api-key-here'
```

## Usage

### Running the Application

```bash
# Start in development mode
npm run dev

# Start in production mode
npm start
```

### Building the Application

```bash
# Build for your current platform
npm run build
```

The built application will be available in the `dist` directory.

### Using the Application

1. **Open a Log File**
   - Click "Open Log File" button
   - Select an Android log file (.log or .txt)
   - The log will be parsed and displayed

2. **Filter Logs**
   - **Time Range**: Enter start/end times in format `MM-DD HH:MM:SS.mmm`
   - **Keywords**: Enter space-separated keywords to search
   - **Log Level**: Select specific log level or "All"
   - **Tag Filter**: Enter regex pattern to filter by tag
   - **PID**: Filter by specific process ID
   - Click "Apply Filters" to filter, or "Clear" to reset

3. **Analyze with AI**
   - Load and optionally filter your logs
   - (Optional) Enter a specific question or analysis request
   - Click "Analyze with AI" button
   - View results in the "AI Analysis" tab

### Example Log Format

ALA supports standard Android logcat format:

```
MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE
```

Example:
```
01-15 10:30:25.123  5678  5678 I MyApp: Application started
01-15 10:30:25.234  5678  5678 E MyApp: Connection failed
```

See `examples/sample-android.log` for a complete example.

## Project Structure

```
ala/
├── src/
│   ├── main.js                 # Electron main process
│   ├── backend/
│   │   ├── logAnalyzer.js      # Log parsing and filtering logic
│   │   └── aiService.js        # AI integration service
│   └── renderer/
│       ├── index.html          # UI markup
│       ├── styles.css          # UI styles
│       └── renderer.js         # UI logic and IPC communication
├── examples/
│   └── sample-android.log      # Example log file
├── package.json
└── README.md
```

## Technologies

- **Electron**: Desktop application framework
- **Node.js**: Backend runtime
- **OpenAI API**: AI-powered log analysis
- **HTML/CSS/JavaScript**: UI implementation

## Log Levels

- **V** (Verbose): Detailed debug information
- **D** (Debug): Debug messages
- **I** (Info): Informational messages
- **W** (Warning): Warning messages
- **E** (Error): Error messages
- **F** (Fatal): Fatal errors

## Configuration

### Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key (required for AI features)

## Development

### Project Architecture

The application follows a standard Electron architecture:

- **Main Process** (`main.js`): Handles IPC communication, file operations, and coordinates backend services
- **Renderer Process** (`renderer/`): Handles UI rendering and user interactions
- **Backend Services** (`backend/`): Pure Node.js modules for log processing and AI integration

### Adding Features

1. Backend logic goes in `src/backend/`
2. UI components go in `src/renderer/`
3. IPC handlers in `src/main.js`

## License

MIT License - see LICENSE file for details

## Author

Jingsong Gao

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

# ALA - Android Log Analyzer

<p align="center">
  <img src="assets/logo.svg" alt="ALA Logo" width="200" height="200">
</p>

<p align="center">
  <strong>An Electron-based desktop application for analyzing Android logs with AI-powered insights.</strong><br>
  Built with TypeScript, featuring a Node.js backend and a modern UI powered by Ant Design.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Ant%20Design-0170FE?style=flat&logo=antdesign&logoColor=white" alt="Ant Design">
  <img src="https://img.shields.io/badge/OpenAI-412991?style=flat&logo=openai&logoColor=white" alt="OpenAI">
</p>

## Features

- 📱 **Multi-Format Log Parsing**: Auto-detects and parses:
  - Standard Android logcat format (`MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE`, year omitted as per logcat convention)
  - Generic timestamped log formats (ISO 8601, bracketed timestamps, etc.)
- 🔍 **Advanced Filtering**: Filter logs by:
  - Time range (date/time range picker)
  - Keywords with **regex support** (e.g., `error|crash|exception`) — reduces visible logs
  - Visual highlights (highlights matching text without filtering)
  - Log level (Verbose, Debug, Info, Warning, Error, Fatal)
  - Tag patterns (regex support)
  - Process ID (PID)
- 📁 **Multiple File Support**: Open and analyze multiple log files simultaneously
- 💾 **Filter Management**:
  - **Save/Load filter presets** with names and descriptions
  - Apply multiple presets at once
  - **Import/Export filters** to/from JSON files
  - Share filter configurations with your team
- 🎯 **Keyword Highlighting**: Matched keywords highlighted in the log viewer
- 🤖 **AI Analysis**: Integrate with any OpenAI-compatible API to analyze logs and get insights about:
  - Errors and warnings
  - Potential crashes
  - Performance concerns
  - Notable patterns
  - Debugging recommendations
- 🌍 **Internationalization**: Full UI translation support for English and Chinese (简体中文)
- 🌙 **Theme Support**: Toggle between dark and light themes
- ⚛️ **Modern Architecture**:
  - **React + TypeScript** renderer with component-based design
  - **Ant Design** UI component library
  - Webpack bundling for optimized builds
  - Context isolation for enhanced security
- 💻 **Modern UI**: Clean interface with Ant Design components featuring:
  - Real-time log viewer with syntax highlighting and PID/TID display
  - Statistics dashboard
  - Tabbed interface for logs and AI analysis
  - Configurable line-break mode (word wrap / no wrap)

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

3. (Optional) Configure AI features in the Settings dialog after launching the app (API endpoint, API key, and model).

## Usage

### Running the Application

**Development Mode (with auto-reload):**

The development mode uses `electron-reloader` to automatically restart Electron when file changes are detected:

```bash
# Start in development mode with auto-reload
npm run dev
```

This will:
1. Compile the TypeScript backend
2. Build the React renderer in production mode
3. Launch Electron with auto-reload enabled
4. File changes will automatically restart Electron

For continuous development with automatic recompilation:

```bash
# In one terminal: watch and rebuild automatically
npm run watch

# In another terminal: run Electron in dev mode
npm run dev
```

The `watch` command will:
- Watch TypeScript backend files and recompile on changes
- Watch React renderer files and rebuild on changes
- `electron-reloader` will detect changes and restart the app

**Production Mode:**

For production, the app loads from the file system:

```bash
# Build everything
npm run build:ts        # Compile TypeScript backend
npm run build:renderer  # Build React renderer for production

# Start in production mode
npm start
```

**Individual build commands:**

```bash
# Just compile TypeScript backend
npm run build:ts

# Just build React renderer (production)
npm run build:renderer

# Generate app icon from logo
npm run build:icon

# Watch for changes and rebuild automatically (useful during development)
npm run watch           # Watch both TypeScript backend and React renderer
npm run watch:ts        # Watch TypeScript backend only
npm run watch:renderer  # Watch React renderer in development mode
```

### Code Quality

```bash
# Run ESLint
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting
npm run format:check
```

### Building the Application

```bash
# Build for your current platform
npm run build
```

The built application will be available in the `dist/build` directory. The app uses the custom logo from `assets/icon.png` as the application icon.

### Running Tests

```bash
# Run backend unit tests
npm test
```

The test suite validates log parsing, filtering, statistics functionality, and multi-format log detection.

### Using the Application

1. **Open a Log File**
   - Click "Open Log File" button
   - Select an Android log file (.log or .txt)
   - The log will be parsed and displayed

2. **Filter Logs**
   - **Time Range**: Use the date/time range picker for start/end times
   - **Keywords**: Enter regex pattern to filter logs (e.g., `error|crash`)
   - **Highlights**: Enter regex pattern to highlight text without filtering
   - **Log Level**: Select specific log level or "All Levels"
   - **Tag Filter**: Enter regex pattern to filter by tag
   - **PID**: Filter by specific process ID
   - Click "Search" to apply filters, or "Clear Filters" to reset

3. **Manage Filter Presets**
   - Click "Manage Presets" to open the preset manager
   - Save current filter settings as a named preset
   - Load or apply multiple presets from the preset dropdown
   - Import/Export presets to share with your team

4. **Analyze with AI**
   - Configure your AI settings via the Settings button (⚙️)
   - Load and optionally filter your logs
   - (Optional) Enter a specific question or analysis request
   - Click "Analyze with AI" button
   - View results in the "AI Analysis" tab

### Example Log Formats

ALA auto-detects and supports multiple log formats.

**Android Logcat format:**

```
MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE
```

Example:
```
01-15 10:30:25.123  5678  5678 I MyApp: Application started
01-15 10:30:25.234  5678  5678 E MyApp: Connection failed
```

**Generic timestamped format:**

```
[YYYY-MM-DD HH:MM:SS] LEVEL: MESSAGE
YYYY-MM-DD HH:MM:SS [LEVEL] MESSAGE
```

Example:
```
[2024-01-15 10:30:45] INFO: Application started
2024-01-15 10:30:46 [ERROR] Connection failed
```

See `examples/sample-android.log` for a complete example.

## Project Structure

```
ala/
├── src/
│   ├── main.ts                    # Electron main process (TypeScript)
│   ├── preload.ts                 # Preload script for secure IPC (TypeScript)
│   ├── backend/
│   │   ├── log-analyzer.ts        # Log parsing and filtering logic (TypeScript)
│   │   └── ai-service.ts          # AI integration service (TypeScript)
│   └── renderer/
│       ├── index.tsx              # React entry point (TypeScript)
│       ├── App.tsx                # Main React component (TypeScript)
│       ├── types.ts               # TypeScript type definitions
│       ├── components/            # React components
│       │   ├── Header.tsx         # Header with theme toggle and language switcher
│       │   ├── AppSider.tsx       # Sidebar with all filter controls and menus
│       │   ├── LogViewer.tsx      # Log display and AI analysis
│       │   ├── FilterPresetManager.tsx  # Filter preset save/load/manage
│       │   └── SettingsModal.tsx  # AI configuration settings
│       └── i18n/                  # Internationalization
│           ├── config.ts          # i18next configuration
│           └── locales/
│               ├── en.json        # English translations
│               └── zh.json        # Chinese translations
├── test/
│   ├── test-backend.ts            # Backend unit tests (TypeScript)
│   └── test-multiformat.ts        # Multi-format log parsing tests (TypeScript)
├── scripts/
│   └── generate-icon.js           # Icon generation script
├── assets/
│   ├── logo.svg                   # Application logo
│   ├── icon.svg                   # App icon (SVG)
│   ├── icon.png                   # App icon (PNG)
│   └── icons/                     # Platform-specific icons
├── examples/
│   └── sample-android.log         # Example log file
├── dist/                          # Compiled output (gitignored)
│   ├── main.js                    # Compiled main process
│   ├── preload.js                 # Compiled preload script
│   ├── backend/                   # Compiled backend modules
│   └── renderer/                  # Compiled React app
├── tsconfig.json                  # TypeScript configuration (main)
├── tsconfig.test.json             # TypeScript configuration (tests)
├── webpack.config.js              # Webpack configuration for React
├── .eslintrc.js                   # ESLint configuration
├── .prettierrc.json               # Prettier configuration
├── package.json
└── README.md
```

## Technologies

- **TypeScript 5.9+**: Strongly-typed programming language for backend and frontend
- **React 19.2+**: Component-based UI library with hooks
- **Electron 28.3+**: Desktop application framework
- **Ant Design 6+**: Enterprise-level UI component library (`antd` + `@ant-design/x`)
- **Node.js**: Backend runtime
- **Webpack 5**: Module bundler for React application
- **i18next + react-i18next**: Internationalization framework (English / Chinese)
- **dayjs**: Lightweight date/time manipulation library
- **ESLint**: Code linting for TypeScript and React
- **Prettier**: Code formatting
- **OpenAI API**: AI-powered log analysis (supports any OpenAI-compatible endpoint)

## Log Levels

- **V** (Verbose): Detailed debug information
- **D** (Debug): Debug messages
- **I** (Info): Informational messages
- **W** (Warning): Warning messages
- **E** (Error): Error messages
- **F** (Fatal): Fatal errors

## Configuration

### AI Settings

AI configuration is managed through the in-app Settings dialog (click the ⚙️ Settings button in the sidebar). The following settings are stored in `localStorage`:

- **API Endpoint**: URL of the OpenAI-compatible API (e.g., `https://api.openai.com/v1`)
- **API Key**: Your API key
- **Model**: The model to use for analysis (e.g., `gpt-4o`)

## Development

### Project Architecture

The application follows a standard Electron architecture:

- **Main Process** (`main.js`): Handles IPC communication, file operations, and coordinates backend services
- **Renderer Process** (`renderer/`): Handles UI rendering and user interactions
- **Backend Services** (`backend/`): Pure Node.js modules for log processing and AI integration

### Adding Features

1. Backend logic goes in `src/backend/`
2. UI components go in `src/renderer/components/`
3. IPC handlers in `src/main.ts`
4. Translation strings go in `src/renderer/i18n/locales/en.json` and `zh.json`

## License

MIT License - see LICENSE file for details

## Author

Jingsong Gao

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

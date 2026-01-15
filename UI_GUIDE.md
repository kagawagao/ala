# Android Log Analyzer (ALA) - User Interface Guide

## Application Overview

ALA provides a modern, dark-themed desktop interface for analyzing Android logs with the following key areas:

```
┌─────────────────────────────────────────────────────────────────────┐
│  🤖 Android Log Analyzer (ALA)                                      │
│  Analyze Android logs with time range filtering and AI insights     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────┐  ┌────────────────────────────────────────┐  │
│  │  CONTROL PANEL   │  │        RESULTS PANEL                    │  │
│  │                  │  │                                          │  │
│  │  [Open Log File] │  │  Stats: Total | Filtered | Errors | Warn│  │
│  │                  │  │  ─────────────────────────────────────── │  │
│  │  Filters:        │  │  [Log Viewer] [AI Analysis]              │  │
│  │  • Time Range    │  │                                          │  │
│  │  • Keywords      │  │  Log lines with syntax highlighting...   │  │
│  │  • Log Level     │  │  [timestamp] LEVEL/Tag: Message          │  │
│  │  • Tag Filter    │  │  [timestamp] LEVEL/Tag: Message          │  │
│  │  • PID           │  │  [timestamp] LEVEL/Tag: Message          │  │
│  │                  │  │                                          │  │
│  │  [Apply Filters] │  │                                          │  │
│  │                  │  │                                          │  │
│  │  AI Analysis:    │  │                                          │  │
│  │  [prompt input]  │  │                                          │  │
│  │  [Analyze w/ AI] │  │                                          │  │
│  └──────────────────┘  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## UI Components

### 1. Header
- Application title with icon
- Subtitle explaining functionality
- Dark blue accent color (#007acc)

### 2. Control Panel (Left Side - 400px)

#### File Controls
- **Open Log File** button (blue) - Opens file dialog to select .log or .txt files
- File name display showing currently loaded file

#### Filters Section
- **Time Range**
  - Start Time input: `MM-DD HH:MM:SS.mmm` format
  - End Time input: `MM-DD HH:MM:SS.mmm` format
  - Example: `01-15 10:30:00.000`

- **Keywords**
  - Text input for space-separated search terms
  - Case-insensitive search
  - Example: `error crash exception`

- **Log Level** dropdown
  - Options: All, Verbose, Debug, Info, Warning, Error, Fatal
  - Single selection

- **Tag Filter**
  - Regex pattern input
  - Example: `Activity.*` or `NetworkManager`

- **PID**
  - Process ID filter
  - Example: `5678`

- **Filter Actions**
  - Apply Filters button (teal) - Applies all filters
  - Clear button (gray) - Resets all filters

#### AI Analysis Section
- **Prompt textarea**
  - Optional: Enter specific questions
  - Multi-line input
  - Placeholder: "Optional: Enter specific questions..."

- **Analyze with AI button** (purple)
  - Disabled if no logs loaded or AI not configured
  - Triggers AI analysis

- **Status display**
  - Shows info/error messages
  - Blue background for info
  - Red background for errors

### 3. Results Panel (Right Side - Flex)

#### Statistics Bar
Displays real-time counts:
- **Total**: Total number of parsed logs (teal)
- **Filtered**: Number of logs after filtering (teal)
- **Errors**: Count of error-level logs (red/orange)
- **Warnings**: Count of warning-level logs (yellow)

#### Tab Navigation
Two tabs:
- **Log Viewer** (default)
- **AI Analysis**

#### Log Viewer Tab
- Displays filtered logs with:
  - Line-by-line rendering
  - Color-coded by log level:
    - Verbose (V): Gray
    - Debug (D): Teal
    - Info (I): Light blue
    - Warning (W): Yellow
    - Error (E): Red/Orange
    - Fatal (F): Bright red with red background
  - Timestamp in green
  - Tag in purple
  - Left border matching log level color
  - Hover effect for better readability

- Performance optimizations:
  - Limits display to first 1000 logs
  - Shows message if more logs available

#### AI Analysis Tab
- Displays AI-generated analysis:
  - Formatted markdown-style output
  - Headings for sections
  - Bullet points for lists
  - Code formatting
  - Bordered container with purple accent

## Color Scheme

### Background Colors
- Main background: `#1e1e1e` (dark gray)
- Panel background: `#252526` (slightly lighter)
- Input background: `#3c3c3c` (medium gray)
- Hover: `#2d2d2d`

### Accent Colors
- Primary (buttons): `#007acc` (blue)
- Secondary (filters): `#4ec9b0` (teal)
- AI features: `#c586c0` (purple)
- Success/Info: `#4ec9b0` (teal)
- Error: `#f48771` (red/orange)
- Warning: `#dcdcaa` (yellow)

### Text Colors
- Primary text: `#d4d4d4` (light gray)
- Secondary text: `#858585` (medium gray)
- Log levels:
  - Error: `#f48771`
  - Warning: `#dcdcaa`
  - Info: `#9cdcfe`
  - Debug: `#4ec9b0`
  - Verbose: `#858585`
  - Fatal: `#ff0000`

### Border Colors
- Default: `#3e3e42`
- Active: `#007acc` or `#4ec9b0`

## Workflow

### Basic Workflow
1. Click "Open Log File"
2. Select Android log file
3. View parsed logs in Log Viewer
4. Check statistics
5. (Optional) Apply filters to narrow down results
6. (Optional) Analyze with AI for insights

### Filtering Workflow
1. Load log file
2. Set desired filters:
   - Time range for specific period
   - Keywords for specific issues
   - Log level to focus on errors/warnings
   - Tag to filter specific components
   - PID to track specific process
3. Click "Apply Filters"
4. Review filtered results
5. Adjust filters as needed
6. Click "Clear" to reset

### AI Analysis Workflow
1. Load and optionally filter logs
2. (Optional) Enter specific question in prompt
3. Click "Analyze with AI"
4. Wait for analysis (status shown)
5. Switch to "AI Analysis" tab
6. Review AI insights and recommendations

## Keyboard Shortcuts

- Standard text input shortcuts work in all fields
- Tab key for navigation between inputs
- Enter in filter inputs triggers apply (future enhancement)

## Accessibility Features

- High contrast dark theme
- Color-coded elements with text labels
- Clear visual hierarchy
- Scrollable panels for large datasets
- Custom scrollbars matching theme

## Responsive Behavior

- Fixed left panel width (400px)
- Flexible right panel (fills remaining space)
- Minimum recommended window size: 1200x800
- Scrollable content areas prevent overflow

## Status Messages

### Info Messages (Blue)
- "Parsing log file..."
- "Applying filters..."
- "Loaded X log lines. Ready for analysis."
- "Filtered to X log lines"
- "Filters cleared"
- "Analyzing logs with AI... This may take a moment."
- "Analysis complete!"

### Error Messages (Red)
- "No log file loaded"
- "No logs to analyze"
- "Analysis failed: [error message]"
- "AI not configured. Set OPENAI_API_KEY environment variable..."

## Empty States

- **No File Loaded**: "📋 No log file loaded. Click 'Open Log File' to get started."
- **No Matching Logs**: "No logs match the current filters."
- **No AI Analysis**: "🤖 No AI analysis yet. Load logs and click 'Analyze with AI'."

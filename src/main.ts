import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainInvokeEvent,
  Menu,
  FileFilter,
} from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import LogAnalyzer, { LogEntry, LogFilters } from './backend/log-analyzer';
import AIService from './backend/ai-service';

// Enable hot-reload in development
try {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: true,
    });
  }
} catch (_) {
  // Ignore errors if electron-reloader is not installed
}

let mainWindow: BrowserWindow | null;
const logAnalyzer = new LogAnalyzer();
const aiService = new AIService();

function createWindow(): void {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Maximize window on startup
  mainWindow.maximize();

  // Always load from file system
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  Menu.setApplicationMenu(null);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'd') {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

const fileFilters: FileFilter[] = [
  { name: 'All Files', extensions: ['*'] },
  { name: 'Log Files', extensions: ['log', 'txt'] },
];

const sourceCodeFilters: FileFilter[] = [
  { name: 'All Files', extensions: ['*'] },
  {
    name: 'Source Code Files',
    extensions: [
      'ts',
      'tsx',
      'js',
      'jsx',
      'java',
      'kt',
      'cpp',
      'c',
      'h',
      'hpp',
      'py',
      'm',
      'swift',
    ],
  },
  { name: 'TypeScript', extensions: ['ts', 'tsx'] },
  { name: 'JavaScript', extensions: ['js', 'jsx'] },
  { name: 'Java/Kotlin', extensions: ['java', 'kt'] },
  { name: 'C/C++', extensions: ['cpp', 'c', 'h', 'hpp'] },
];

// IPC handlers
ipcMain.handle('open-log-file', async (): Promise<{ filePath: string; content: string } | null> => {
  if (!mainWindow) return null;

  const result = (await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'] as any,
    filters: fileFilters,
  })) as { canceled: boolean; filePaths: string[] };

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  }
  return null;
});

// Support multiple files
ipcMain.handle(
  'open-log-files',
  async (): Promise<Array<{ filePath: string; content: string }> | null> => {
    if (!mainWindow) return null;

    const result = (await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'] as any,
      filters: fileFilters,
    })) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const content = await fs.readFile(filePath, 'utf-8');
          return { filePath, content };
        })
      );
      return files;
    }
    return null;
  }
);

// Support opening source code files
ipcMain.handle(
  'open-source-files',
  async (): Promise<Array<{ filePath: string; content: string }> | null> => {
    if (!mainWindow) return null;

    const result = (await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: sourceCodeFilters,
    })) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const content = await fs.readFile(filePath, 'utf-8');
          return { filePath, content };
        })
      );
      return files;
    }
    return null;
  }
);

ipcMain.handle(
  'parse-log',
  async (
    _event: IpcMainInvokeEvent,
    content: string
  ): Promise<{ logs: LogEntry[]; truncated: boolean; totalLines: number }> => {
    return logAnalyzer.parseLog(content);
  }
);

ipcMain.handle(
  'filter-logs',
  async (
    _event: IpcMainInvokeEvent,
    { logs, filters }: { logs: LogEntry[]; filters: LogFilters }
  ): Promise<LogEntry[]> => {
    return logAnalyzer.filterLogs(logs, filters);
  }
);

ipcMain.handle('get-statistics', async (_event: IpcMainInvokeEvent, logs: LogEntry[]) => {
  return logAnalyzer.getStatistics(logs);
});

ipcMain.handle(
  'analyze-with-ai',
  async (
    _event: IpcMainInvokeEvent,
    {
      logs,
      prompt,
      presetId,
      sourceCode,
    }: { logs: LogEntry[]; prompt?: string; presetId?: string; sourceCode?: string }
  ) => {
    return await aiService.analyzeLogs(logs, prompt, presetId, sourceCode);
  }
);

ipcMain.handle('check-ai-configured', async (): Promise<boolean> => {
  return aiService.isConfigured();
});

ipcMain.handle(
  'update-ai-config',
  async (
    _event: IpcMainInvokeEvent,
    config: { apiEndpoint: string; apiKey: string; model: string }
  ): Promise<boolean> => {
    return aiService.updateConfig(config);
  }
);

ipcMain.handle(
  'get-ai-config',
  async (): Promise<{ apiEndpoint: string; apiKey: string; model: string } | null> => {
    return aiService.getConfig();
  }
);

// Import filters from file
ipcMain.handle('import-filters', async (): Promise<any | null> => {
  if (!mainWindow) return null;

  const result = (await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'] as any,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })) as { canceled: boolean; filePaths: string[] };

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const content = await fs.readFile(result.filePaths[0], 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to import filters:', error);
      return null;
    }
  }
  return null;
});

// Export filters to file
ipcMain.handle(
  'export-filters',
  async (_event: IpcMainInvokeEvent, filters: any): Promise<boolean> => {
    if (!mainWindow) return false;

    const result = (await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'ala-filters.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })) as { canceled: boolean; filePath?: string };

    if (!result.canceled && result.filePath) {
      try {
        await fs.writeFile(result.filePath, JSON.stringify(filters, null, 2), 'utf-8');
        return true;
      } catch (error) {
        console.error('Failed to export filters:', error);
        return false;
      }
    }
    return false;
  }
);

// Delete log file from memory (just returns success as files are already in memory)
ipcMain.handle(
  'delete-log-file',
  async (_event: IpcMainInvokeEvent, _filePath: string): Promise<boolean> => {
    // Files are already in memory, so we just return success
    // The renderer will handle removing the file from its state
    return true;
  }
);

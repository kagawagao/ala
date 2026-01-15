import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import LogAnalyzer, { LogEntry, LogFilters } from './backend/log-analyzer';
import AIService from './backend/ai-service';

let mainWindow: BrowserWindow | null;
const logAnalyzer = new LogAnalyzer();
const aiService = new AIService();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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

// IPC handlers
ipcMain.handle('open-log-file', async (): Promise<{ filePath: string; content: string } | null> => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'] as any,
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }) as { canceled: boolean; filePaths: string[] };

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  }
  return null;
});

// Support multiple files
ipcMain.handle('open-log-files', async (): Promise<Array<{ filePath: string; content: string }> | null> => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'] as any,
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }) as { canceled: boolean; filePaths: string[] };

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
});

ipcMain.handle('parse-log', async (_event: IpcMainInvokeEvent, content: string): Promise<LogEntry[]> => {
  return logAnalyzer.parseLog(content);
});

ipcMain.handle('filter-logs', async (_event: IpcMainInvokeEvent, { logs, filters }: { logs: LogEntry[]; filters: LogFilters }): Promise<LogEntry[]> => {
  return logAnalyzer.filterLogs(logs, filters);
});

ipcMain.handle('analyze-with-ai', async (_event: IpcMainInvokeEvent, { logs, prompt }: { logs: LogEntry[]; prompt: string }) => {
  return await aiService.analyzeLogs(logs, prompt);
});

ipcMain.handle('check-ai-configured', async (): Promise<boolean> => {
  return aiService.isConfigured();
});

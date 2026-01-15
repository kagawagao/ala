const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const LogAnalyzer = require('./backend/logAnalyzer');
const AIService = require('./backend/aiService');

let mainWindow;
const logAnalyzer = new LogAnalyzer();
const aiService = new AIService();

function createWindow() {
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
ipcMain.handle('open-log-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  }
  return null;
});

ipcMain.handle('parse-log', async (event, content) => {
  return logAnalyzer.parseLog(content);
});

ipcMain.handle('filter-logs', async (event, { logs, filters }) => {
  return logAnalyzer.filterLogs(logs, filters);
});

ipcMain.handle('analyze-with-ai', async (event, { logs, prompt }) => {
  return await aiService.analyzeLogs(logs, prompt);
});

ipcMain.handle('check-ai-configured', async () => {
  return aiService.isConfigured();
});

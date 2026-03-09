import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, LogFilters, LogStatistics } from './renderer/types';

contextBridge.exposeInMainWorld('electronAPI', {
  openLogFiles: () => ipcRenderer.invoke('open-log-files'),
  parseLog: (content: string) => ipcRenderer.invoke('parse-log', content),
  filterLogs: (params: { logs: LogEntry[]; filters: LogFilters }) =>
    ipcRenderer.invoke('filter-logs', params),
  getStatistics: (logs: LogEntry[]) => ipcRenderer.invoke('get-statistics', logs),
  analyzeWithAI: (params: { logs: LogEntry[]; prompt?: string; presetId?: string }) =>
    ipcRenderer.invoke('analyze-with-ai', params),
  checkAIConfigured: () => ipcRenderer.invoke('check-ai-configured'),
  updateAIConfig: (config: { apiEndpoint: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke('update-ai-config', config),
  getAIConfig: () => ipcRenderer.invoke('get-ai-config'),
  importFilters: () => ipcRenderer.invoke('import-filters'),
  exportFilters: (filters: unknown) => ipcRenderer.invoke('export-filters', filters),
  deleteLogFile: (filePath: string) => ipcRenderer.invoke('delete-log-file', filePath),
});

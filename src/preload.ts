import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, LogFilters } from './renderer/types';

contextBridge.exposeInMainWorld('electronAPI', {
  openLogFiles: () => ipcRenderer.invoke('open-log-files'),
  openSourceFiles: () => ipcRenderer.invoke('open-source-files'),
  parseLog: (content: string) => ipcRenderer.invoke('parse-log', content),
  filterLogs: (params: { logs: LogEntry[]; filters: LogFilters }) =>
    ipcRenderer.invoke('filter-logs', params),
  getStatistics: (logs: LogEntry[]) => ipcRenderer.invoke('get-statistics', logs),
  importFilters: () => ipcRenderer.invoke('import-filters'),
  exportFilters: (filters: unknown) => ipcRenderer.invoke('export-filters', filters),
  deleteLogFile: (filePath: string) => ipcRenderer.invoke('delete-log-file', filePath),
});

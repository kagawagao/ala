export interface LogEntry {
  timestamp: string;
  pid: string;
  tid: string;
  level: string;
  tag: string;
  message: string;
  rawLine: string;
  sourceFile?: string;
}

export interface LogFilters {
  startTime: string;
  endTime: string;
  keywords: string;
  level: string;
  tag: string;
  pid: string;
}

export interface LogStatistics {
  total: number;
  byLevel: Record<string, number>;
  tags: Record<string, number>;
  pids: Record<string, number>;
}

export interface AIAnalysisResult {
  analysis: string;
  timestamp: string;
}

declare global {
  interface Window {
    electronAPI: {
      openLogFiles: () => Promise<Array<{ filePath: string; content: string }> | null>;
      parseLog: (content: string) => Promise<LogEntry[]>;
      filterLogs: (params: { logs: LogEntry[]; filters: LogFilters }) => Promise<LogEntry[]>;
      getStatistics: (logs: LogEntry[]) => Promise<LogStatistics>;
      analyzeWithAI: (params: { logs: LogEntry[]; prompt?: string }) => Promise<string>;
      checkAIConfigured: () => Promise<boolean>;
      importFilters: () => Promise<LogFilters | null>;
      exportFilters: (filters: LogFilters) => Promise<boolean>;
    };
  }
}

export {};

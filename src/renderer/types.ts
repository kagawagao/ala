export interface LogEntry {
  lineNumber?: number;
  timestamp: string;
  pid: string;
  tid: string;
  level: string;
  tag: string;
  message: string;
  rawLine: string;
  sourceFile?: string;
}

export interface HighlightItem {
  pattern: string;
  color: string;
}

export interface LogFilters {
  startTime: string;
  endTime: string;
  keywords: string; // For filtering logs (reduces visible logs)
  highlights: string; // For visual highlighting only (no filtering) - legacy format
  coloredHighlights?: HighlightItem[]; // New format with colors
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

export interface AIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AIAnalysisResult {
  success: boolean;
  analysis?: string;
  error?: string;
  usage?: AIUsage;
}

export interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  model: string;
}

export interface ParseLogResult {
  logs: LogEntry[];
  truncated: boolean;
  totalLines: number;
}

declare global {
  interface Window {
    electronAPI: {
      openLogFiles: () => Promise<Array<{ filePath: string; content: string }> | null>;
      openSourceFiles: () => Promise<Array<{ filePath: string; content: string }> | null>;
      parseLog: (content: string) => Promise<ParseLogResult>;
      filterLogs: (params: { logs: LogEntry[]; filters: LogFilters }) => Promise<LogEntry[]>;
      getStatistics: (logs: LogEntry[]) => Promise<LogStatistics>;
      analyzeWithAI: (params: {
        logs: LogEntry[];
        prompt?: string;
        presetId?: string;
        sourceCode?: string;
      }) => Promise<AIAnalysisResult>;
      checkAIConfigured: () => Promise<boolean>;
      updateAIConfig: (config: AIConfig) => Promise<boolean>;
      getAIConfig: () => Promise<AIConfig | null>;
      importFilters: () => Promise<unknown>;
      exportFilters: (filters: unknown) => Promise<boolean>;
      deleteLogFile: (filePath: string) => Promise<boolean>;
    };
  }
}

export {};

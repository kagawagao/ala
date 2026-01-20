/**
 * Represents a parsed Android log entry
 */
export interface LogEntry {
  lineNumber: number;
  timestamp: string | null;
  pid: string | null;
  tid: string | null;
  level: string;
  tag: string;
  message: string;
  rawLine: string;
}

/**
 * Filter criteria for log entries
 */
export interface LogFilters {
  startTime?: string;
  endTime?: string;
  keywords?: string;
  level?: string;
  tag?: string;
  pid?: string;
}

/**
 * Statistics about log entries
 */
export interface LogStatistics {
  total: number;
  byLevel: Record<string, number>;
  tags: Record<string, number>;
  pids: Record<string, number>;
}

/**
 * Supported log format types
 */
export enum LogFormat {
  ANDROID_LOGCAT = 'android_logcat',
  GENERIC_TIMESTAMPED = 'generic_timestamped',
  UNKNOWN = 'unknown'
}

/**
 * Android Log Analyzer
 * Parses and filters Android log files (logcat format) and generic log formats
 */
export class LogAnalyzer {
  private androidLogcatPattern: RegExp;
  private genericTimestampedPattern: RegExp;

  constructor() {
    // Android logcat format regex pattern
    // Capture groups: (1) timestamp, (2) PID, (3) TID, (4) level, (5) tag, (6) message
    // Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE
    this.androidLogcatPattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s+(.*)$/;
    
    // Generic timestamped log format patterns
    // Supports various common formats like:
    // [2024-01-15 10:30:45] INFO: Message
    // 2024-01-15 10:30:45.123 [ERROR] Message
    // [INFO] 2024-01-15 10:30:45 - Message
    this.genericTimestampedPattern = /^(?:\[)?(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]?\s*(?:\[)?([A-Z]+|VERBOSE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?:?\s*(?:-\s*)?(.+)$/i;
  }

  /**
   * Detect the log format from the content
   */
  detectLogFormat(content: string): LogFormat {
    const lines = content.split('\n').filter(line => line.trim());
    
    // Try to match first 10 lines to determine format
    const sampleSize = Math.min(10, lines.length);
    let androidMatches = 0;
    let genericMatches = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      const line = lines[i].trim();
      if (this.androidLogcatPattern.test(line)) {
        androidMatches++;
      }
      if (this.genericTimestampedPattern.test(line)) {
        genericMatches++;
      }
    }
    
    // If majority matches Android format, it's Android logcat
    if (androidMatches >= sampleSize * 0.6) {
      return LogFormat.ANDROID_LOGCAT;
    }
    
    // If majority matches generic format, it's generic timestamped
    if (genericMatches >= sampleSize * 0.6) {
      return LogFormat.GENERIC_TIMESTAMPED;
    }
    
    return LogFormat.UNKNOWN;
  }

  /**
   * Parse Android log content into structured format
   * Auto-detects format and parses accordingly
   */
  parseLog(content: string): LogEntry[] {
    const format = this.detectLogFormat(content);
    
    switch (format) {
      case LogFormat.ANDROID_LOGCAT:
        return this.parseAndroidLogcat(content);
      case LogFormat.GENERIC_TIMESTAMPED:
        return this.parseGenericTimestamped(content);
      default:
        return this.parseUnknownFormat(content);
    }
  }

  /**
   * Parse Android logcat format
   * Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE
   */
  private parseAndroidLogcat(content: string): LogEntry[] {
    const lines = content.split('\n');
    const parsedLogs: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(this.androidLogcatPattern);
      if (match) {
        parsedLogs.push({
          lineNumber: i + 1,
          timestamp: match[1].trim(),
          pid: match[2].trim(),
          tid: match[3].trim(),
          level: match[4].trim(),
          tag: match[5].trim(),
          message: match[6].trim(),
          rawLine: line
        });
      } else {
        // Handle multi-line logs or non-standard format
        parsedLogs.push({
          lineNumber: i + 1,
          timestamp: null,
          pid: null,
          tid: null,
          level: 'U', // Unknown
          tag: 'Unknown',
          message: line,
          rawLine: line
        });
      }
    }

    return parsedLogs;
  }

  /**
   * Parse generic timestamped log format
   * Supports formats like:
   * [2024-01-15 10:30:45] INFO: Message
   * 2024-01-15 10:30:45.123 [ERROR] Message
   */
  private parseGenericTimestamped(content: string): LogEntry[] {
    const lines = content.split('\n');
    const parsedLogs: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(this.genericTimestampedPattern);
      if (match) {
        const level = this.normalizeLogLevel(match[2]);
        parsedLogs.push({
          lineNumber: i + 1,
          timestamp: this.normalizeTimestamp(match[1].trim()),
          pid: null,
          tid: null,
          level: level,
          tag: 'Generic',
          message: match[3].trim(),
          rawLine: line
        });
      } else {
        // Treat as continuation or unknown format
        parsedLogs.push({
          lineNumber: i + 1,
          timestamp: null,
          pid: null,
          tid: null,
          level: 'U',
          tag: 'Unknown',
          message: line,
          rawLine: line
        });
      }
    }

    return parsedLogs;
  }

  /**
   * Parse unknown format - treat each line as a log entry
   */
  private parseUnknownFormat(content: string): LogEntry[] {
    const lines = content.split('\n');
    const parsedLogs: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      parsedLogs.push({
        lineNumber: i + 1,
        timestamp: null,
        pid: null,
        tid: null,
        level: 'U',
        tag: 'Unknown',
        message: line,
        rawLine: line
      });
    }

    return parsedLogs;
  }

  /**
   * Normalize log level to single character format
   */
  private normalizeLogLevel(level: string): string {
    const levelUpper = level.toUpperCase();
    
    if (levelUpper.startsWith('V') || levelUpper === 'VERBOSE') return 'V';
    if (levelUpper.startsWith('D') || levelUpper === 'DEBUG') return 'D';
    if (levelUpper.startsWith('I') || levelUpper === 'INFO') return 'I';
    if (levelUpper.startsWith('W') || levelUpper === 'WARN' || levelUpper === 'WARNING') return 'W';
    if (levelUpper.startsWith('E') || levelUpper === 'ERROR') return 'E';
    if (levelUpper.startsWith('F') || levelUpper === 'FATAL') return 'F';
    
    return 'U'; // Unknown
  }

  /**
   * Normalize timestamp to MM-DD HH:MM:SS.mmm format
   */
  private normalizeTimestamp(timestamp: string): string {
    try {
      // Parse various timestamp formats and convert to MM-DD HH:MM:SS.mmm
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return timestamp; // Return as-is if can't parse
      }
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const ms = String(date.getMilliseconds()).padStart(3, '0');
      
      return `${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
    } catch (e) {
      return timestamp; // Return as-is if error
    }
  }

  /**
   * Filter logs based on time range, keywords, and log level
   */
  filterLogs(logs: LogEntry[], filters: LogFilters): LogEntry[] {
    let filtered = [...logs];

    // Filter by time range
    if (filters.startTime || filters.endTime) {
      filtered = filtered.filter(log => {
        if (!log.timestamp) return false;
        
        const logTime = this.parseTimestamp(log.timestamp);
        if (!logTime) return true;

        if (filters.startTime) {
          const startTime = this.parseTimestamp(filters.startTime);
          if (startTime && logTime < startTime) return false;
        }

        if (filters.endTime) {
          const endTime = this.parseTimestamp(filters.endTime);
          if (endTime && logTime > endTime) return false;
        }

        return true;
      });
    }

    // Filter by keywords (supports regex)
    if (filters.keywords && filters.keywords.trim()) {
      try {
        // Try to interpret as regex first
        const keywordPattern = new RegExp(filters.keywords, 'i');
        filtered = filtered.filter(log => {
          const searchText = `${log.tag} ${log.message}`;
          return keywordPattern.test(searchText);
        });
      } catch (e) {
        // If regex fails, fall back to space-separated keyword search
        const keywords = filters.keywords.toLowerCase().split(/\s+/).filter(k => k);
        filtered = filtered.filter(log => {
          const searchText = `${log.tag} ${log.message}`.toLowerCase();
          return keywords.some(keyword => searchText.includes(keyword));
        });
      }
    }

    // Filter by log level
    if (filters.level && filters.level !== 'ALL') {
      filtered = filtered.filter(log => log.level === filters.level);
    }

    // Filter by tag
    if (filters.tag && filters.tag.trim()) {
      const tagPattern = new RegExp(filters.tag, 'i');
      filtered = filtered.filter(log => tagPattern.test(log.tag));
    }

    // Filter by PID
    if (filters.pid && filters.pid.trim()) {
      filtered = filtered.filter(log => log.pid === filters.pid);
    }

    return filtered;
  }

  /**
   * Parse timestamp string to comparable format
   * Input: "MM-DD HH:MM:SS.mmm"
   */
  parseTimestamp(timeStr: string): Date | null {
    try {
      const parts = timeStr.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (!parts) return null;

      const [, month, day, hour, minute, second, ms] = parts;
      const year = new Date().getFullYear();
      return new Date(year, parseInt(month) - 1, parseInt(day), 
                     parseInt(hour), parseInt(minute), parseInt(second), parseInt(ms));
    } catch (e) {
      return null;
    }
  }

  /**
   * Get statistics about the logs
   */
  getStatistics(logs: LogEntry[]): LogStatistics {
    const stats: LogStatistics = {
      total: logs.length,
      byLevel: { V: 0, D: 0, I: 0, W: 0, E: 0, F: 0, U: 0 },
      tags: {},
      pids: {}
    };

    logs.forEach(log => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      stats.tags[log.tag] = (stats.tags[log.tag] || 0) + 1;
      if (log.pid) {
        stats.pids[log.pid] = (stats.pids[log.pid] || 0) + 1;
      }
    });

    return stats;
  }
}

export default LogAnalyzer;

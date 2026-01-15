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
 * Android Log Analyzer
 * Parses and filters Android log files (logcat format)
 */
export class LogAnalyzer {
  private logPattern: RegExp;

  constructor() {
    // Android logcat format regex pattern
    // Capture groups: (1) timestamp, (2) PID, (3) TID, (4) level, (5) tag, (6) message
    // Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE
    this.logPattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s+(.*)$/;
  }

  /**
   * Parse Android log content into structured format
   * Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: MESSAGE
   */
  parseLog(content: string): LogEntry[] {
    const lines = content.split('\n');
    const parsedLogs: LogEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(this.logPattern);
      if (match) {
        parsedLogs.push({
          lineNumber: i + 1,
          timestamp: match[1],
          pid: match[2],
          tid: match[3],
          level: match[4],
          tag: match[5],
          message: match[6],
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

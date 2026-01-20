import React from 'react';
import { LogEntry, LogStatistics } from '../types';

interface LogViewerProps {
  logs: LogEntry[];
  allLogsCount: number;
  statistics: LogStatistics | null;
  currentFiles: string[];
  keywords: string;
  activeTab: 'logs' | 'ai';
  setActiveTab: (tab: 'logs' | 'ai') => void;
  aiAnalysis: string;
  isSearching: boolean;
}

const MAX_RENDERED_LOGS = 1000;

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  allLogsCount,
  statistics,
  currentFiles,
  keywords,
  activeTab,
  setActiveTab,
  aiAnalysis,
  isSearching,
}) => {
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const highlightKeywords = (text: string, keywords: string): string => {
    if (!keywords || !keywords.trim()) return text;
    
    try {
      // Try regex pattern first
      const pattern = new RegExp(`(${keywords})`, 'gi');
      return text.replace(pattern, '<mark class="bg-yellow-500/30 text-yellow-200 px-1 rounded">$1</mark>');
    } catch (e) {
      // Fallback to space-separated keywords
      const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k);
      let highlightedText = text;
      
      keywordList.forEach(keyword => {
        const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-500/30 text-yellow-200 px-1 rounded">$1</mark>');
      });
      
      return highlightedText;
    }
  };

  const getLevelClass = (level: string): string => {
    const levelColors: Record<string, string> = {
      'E': 'text-red-400',
      'W': 'text-yellow-400',
      'I': 'text-blue-400',
      'D': 'text-green-400',
      'V': 'text-gray-400',
      'F': 'text-red-600'
    };
    return levelColors[level] || 'text-gray-400';
  };

  const renderLogLine = (log: LogEntry, index: number) => {
    const levelClass = getLevelClass(log.level);
    const lineNumber = log.lineNumber ? (
      <span className="text-gray-500 mr-2.5 select-none" style={{ minWidth: '50px', display: 'inline-block' }}>
        #{log.lineNumber}
      </span>
    ) : null;
    const timestamp = log.timestamp ? (
      <span className="text-green-600 mr-2.5">{log.timestamp}</span>
    ) : null;
    const level = <span className={`font-bold mr-2.5 ${levelClass}`}>{log.level}</span>;
    const tag = log.tag !== 'Unknown' ? (
      <span className="text-purple-400 mr-2.5">[{log.tag}]</span>
    ) : null;
    const sourceFile = currentFiles.length > 1 && log.sourceFile ? (
      <span className="text-xs text-gray-500 mr-2.5">📄{log.sourceFile}</span>
    ) : null;

    // Highlight keywords in message
    let message = escapeHtml(log.message);
    if (keywords) {
      message = highlightKeywords(message, keywords);
    }

    return (
      <div key={index} className={`log-line font-mono text-sm py-1 px-2 border-l-4 ${
        log.level === 'E' ? 'border-red-400' : 
        log.level === 'W' ? 'border-yellow-400' : 
        log.level === 'I' ? 'border-blue-400' : 
        log.level === 'D' ? 'border-green-400' : 
        'border-gray-600'
      }`}>
        {lineNumber}
        {timestamp}
        {level}
        {sourceFile}
        {tag}
        <span dangerouslySetInnerHTML={{ __html: message }} />
      </div>
    );
  };

  return (
    <section className="flex-1 flex flex-col overflow-hidden">
      {/* Statistics Bar */}
      <div className="bg-dark-panel px-6 py-3 border-b border-dark-border">
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-text-secondary">Total: </span>
            <span className="text-accent-teal font-semibold">{allLogsCount}</span>
          </div>
          <div>
            <span className="text-text-secondary">Filtered: </span>
            <span className="text-accent-teal font-semibold">{logs.length}</span>
          </div>
          {currentFiles.length > 0 && (
            <div>
              <span className="text-text-secondary">Files: </span>
              <span className="text-accent-blue font-semibold">{currentFiles.length}</span>
            </div>
          )}
          {statistics && (
            <>
              <div>
                <span className="text-text-secondary">Errors: </span>
                <span className="text-red-400 font-semibold">{statistics.byLevel.E || 0}</span>
              </div>
              <div>
                <span className="text-text-secondary">Warnings: </span>
                <span className="text-yellow-400 font-semibold">{statistics.byLevel.W || 0}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-dark-panel px-6 py-2 border-b border-dark-border flex gap-6">
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-2 px-4 font-medium transition ${
            activeTab === 'logs' 
              ? 'text-accent-teal border-b-2 border-accent-teal' 
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Log Viewer
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`py-2 px-4 font-medium transition ${
            activeTab === 'ai' 
              ? 'text-accent-teal border-b-2 border-accent-teal' 
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          AI Analysis
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-dark-bg p-4 scrollbar-custom">
        {isSearching ? (
          <div className="flex items-center justify-center min-h-full">
            <div className="text-center">
              <div className="inline-block w-12 h-12 border-4 border-accent-teal border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-text-secondary">Searching logs...</p>
            </div>
          </div>
        ) : activeTab === 'logs' ? (
          logs.length === 0 ? (
            <div className="flex items-center justify-center min-h-full text-text-secondary">
              <p>No logs loaded or no logs match the current filters. Click "Search" to filter logs.</p>
            </div>
          ) : (
            <>
              {logs.slice(0, MAX_RENDERED_LOGS).map((log, index) => renderLogLine(log, index))}
              {logs.length > MAX_RENDERED_LOGS && (
                <div className="flex items-center justify-center py-8 text-text-secondary">
                  <p>Showing first {MAX_RENDERED_LOGS} of {logs.length} logs. Apply more filters to see more.</p>
                </div>
              )}
            </>
          )
        ) : (
          <div className="prose prose-invert max-w-none">
            {aiAnalysis ? (
              <div className="whitespace-pre-wrap text-text-primary">{aiAnalysis}</div>
            ) : (
              <div className="flex items-center justify-center min-h-full text-text-secondary">
                <p>No AI analysis yet. Click "Analyze with AI" to start.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default LogViewer;

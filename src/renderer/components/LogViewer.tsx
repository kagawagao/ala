import React from 'react';
import { Tabs, Divider } from 'antd';
import { LogEntry, LogStatistics } from '../types';

// CSS for animations
const spinnerStyles = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

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
  lineBreakMode: 'wrap' | 'nowrap';
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
  lineBreakMode,
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
      return text.replace(pattern, '<mark style="background-color: rgba(234, 179, 8, 0.3); color: #fef08a; padding: 0 4px; border-radius: 2px;">$1</mark>');
    } catch (e) {
      // Fallback to space-separated keywords
      const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k);
      let highlightedText = text;
      
      keywordList.forEach(keyword => {
        const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<mark style="background-color: rgba(234, 179, 8, 0.3); color: #fef08a; padding: 0 4px; border-radius: 2px;">$1</mark>');
      });
      
      return highlightedText;
    }
  };

  const getLevelClass = (level: string): { color: string; borderColor: string } => {
    const levelColors: Record<string, { color: string; borderColor: string }> = {
      'E': { color: '#f87171', borderColor: '#f87171' },
      'W': { color: '#facc15', borderColor: '#facc15' },
      'I': { color: '#60a5fa', borderColor: '#60a5fa' },
      'D': { color: '#4ade80', borderColor: '#4ade80' },
      'V': { color: '#9ca3af', borderColor: '#9ca3af' },
      'F': { color: '#dc2626', borderColor: '#dc2626' }
    };
    return levelColors[level] || { color: '#9ca3af', borderColor: '#6b7280' };
  };

  const renderLogLine = (log: LogEntry, index: number) => {
    const levelStyle = getLevelClass(log.level);
    const lineNumber = log.lineNumber ? (
      <span style={{ 
        color: '#858585', 
        marginRight: '10px', 
        userSelect: 'none', 
        minWidth: '50px', 
        display: 'inline-block' 
      }}>
        #{log.lineNumber}
      </span>
    ) : null;
    const timestamp = log.timestamp ? (
      <span style={{ color: '#16a34a', marginRight: '10px' }}>{log.timestamp}</span>
    ) : null;
    const level = <span style={{ fontWeight: 'bold', marginRight: '10px', color: levelStyle.color }}>{log.level}</span>;
    const tag = log.tag !== 'Unknown' ? (
      <span style={{ color: '#c084fc', marginRight: '10px' }}>[{log.tag}]</span>
    ) : null;

    // Highlight keywords in message
    let message = escapeHtml(log.message);
    if (keywords) {
      message = highlightKeywords(message, keywords);
    }

    return (
      <div 
        key={index} 
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px',
          padding: '4px 8px',
          borderLeft: `4px solid ${levelStyle.borderColor}`,
          marginBottom: '2px'
        }}
      >
        {lineNumber}
        {timestamp}
        {level}
        {tag}
        <span dangerouslySetInnerHTML={{ __html: message }} />
      </div>
    );
  };

  // Group logs by source file
  const groupLogsByFile = (logs: LogEntry[]) => {
    if (currentFiles.length <= 1) {
      // Single file or no files, no grouping needed
      return logs.map((log, index) => renderLogLine(log, index));
    }

    const groups: { file: string; logs: LogEntry[]; startIndex: number }[] = [];
    let currentFile = '';
    let currentGroup: LogEntry[] = [];
    let startIndex = 0;

    logs.forEach((log, index) => {
      const logFile = log.sourceFile || '';
      if (logFile !== currentFile) {
        if (currentGroup.length > 0) {
          groups.push({ file: currentFile, logs: currentGroup, startIndex });
        }
        currentFile = logFile;
        currentGroup = [log];
        startIndex = index;
      } else {
        currentGroup.push(log);
      }
    });

    // Add the last group
    if (currentGroup.length > 0) {
      groups.push({ file: currentFile, logs: currentGroup, startIndex });
    }

    // Render groups with dividers
    return groups.map((group, groupIndex) => (
      <React.Fragment key={`group-${groupIndex}`}>
        {groupIndex > 0 && (
          <Divider 
            style={{ 
              margin: '16px 0',
              borderColor: 'var(--ant-color-border-secondary)'
            }}
          />
        )}
        {group.file && (
          <div style={{ 
            marginBottom: '12px',
            padding: '8px 12px',
            backgroundColor: 'var(--ant-color-bg-elevated)',
            borderRadius: '4px',
            borderLeft: '4px solid #4ec9b0'
          }}>
            <span style={{ 
              fontSize: '14px', 
              fontWeight: 600,
              color: 'var(--ant-color-text)',
              marginRight: '8px'
            }}>
              📄
            </span>
            <span style={{ 
              fontSize: '14px', 
              fontWeight: 600,
              color: '#4ec9b0'
            }}>
              {group.file}
            </span>
            <span style={{ 
              fontSize: '12px',
              color: 'var(--ant-color-text-secondary)',
              marginLeft: '12px'
            }}>
              ({group.logs.length} logs)
            </span>
          </div>
        )}
        {group.logs.map((log, index) => renderLogLine(log, group.startIndex + index))}
      </React.Fragment>
    ));
  };

  const tabItems = [
    {
      key: 'logs',
      label: 'Log Viewer',
      children: (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: lineBreakMode === 'nowrap' ? 'auto' : 'hidden',
          backgroundColor: 'var(--ant-color-bg-container)',
          padding: '16px'
        }}>
          {isSearching ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100%'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  display: 'inline-block',
                  width: '48px',
                  height: '48px',
                  border: '4px solid #4ec9b0',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '16px'
                }}></div>
                <p style={{ color: 'var(--ant-color-text-secondary)' }}>Searching logs...</p>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100%',
              color: 'var(--ant-color-text-secondary)'
            }}>
              <p>No logs loaded or no logs match the current filters. Click "Search" to filter logs.</p>
            </div>
          ) : (
            <div style={{ whiteSpace: lineBreakMode === 'nowrap' ? 'nowrap' : 'normal' }}>
              {groupLogsByFile(logs.slice(0, MAX_RENDERED_LOGS))}
              {logs.length > MAX_RENDERED_LOGS && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 0',
                  color: 'var(--ant-color-text-secondary)'
                }}>
                  <p>Showing first {MAX_RENDERED_LOGS} of {logs.length} logs. Apply more filters to see more.</p>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'ai',
      label: 'AI Analysis',
      children: (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: 'var(--ant-color-bg-container)',
          padding: '16px'
        }}>
          {aiAnalysis ? (
            <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ant-color-text)' }}>{aiAnalysis}</div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100%',
              color: 'var(--ant-color-text-secondary)'
            }}>
              <p>No AI analysis yet. Click the floating AI button to start.</p>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{spinnerStyles}</style>
      {/* Statistics Bar */}
      <div style={{
        backgroundColor: 'var(--ant-color-bg-elevated)',
        padding: '12px 24px',
        borderBottom: '1px solid var(--ant-color-border)'
      }}>
        <div style={{ display: 'flex', gap: '24px', fontSize: '14px' }}>
          <div>
            <span style={{ color: 'var(--ant-color-text-secondary)' }}>Total: </span>
            <span style={{ color: '#4ec9b0', fontWeight: 600 }}>{allLogsCount}</span>
          </div>
          <div>
            <span style={{ color: 'var(--ant-color-text-secondary)' }}>Filtered: </span>
            <span style={{ color: '#4ec9b0', fontWeight: 600 }}>{logs.length}</span>
          </div>
          {currentFiles.length > 0 && (
            <div>
              <span style={{ color: 'var(--ant-color-text-secondary)' }}>Files: </span>
              <span style={{ color: '#007acc', fontWeight: 600 }}>{currentFiles.length}</span>
            </div>
          )}
          {statistics && (
            <>
              <div>
                <span style={{ color: 'var(--ant-color-text-secondary)' }}>Errors: </span>
                <span style={{ color: '#f87171', fontWeight: 600 }}>{statistics.byLevel.E || 0}</span>
              </div>
              <div>
                <span style={{ color: 'var(--ant-color-text-secondary)' }}>Warnings: </span>
                <span style={{ color: '#facc15', fontWeight: 600 }}>{statistics.byLevel.W || 0}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs with Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'logs' | 'ai')}
          items={tabItems}
          style={{ height: '100%' }}
          tabBarStyle={{ 
            backgroundColor: 'var(--ant-color-bg-container)',
            margin: 0,
            paddingLeft: '24px',
            flexShrink: 0
          }}
          className="log-viewer-tabs"
        />
      </div>
    </section>
  );
};

export default LogViewer;

import React from 'react';
import { Tabs, Divider, theme, Tooltip, FloatButton } from 'antd';
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import VirtualList from 'rc-virtual-list';
import { LogEntry, LogStatistics } from '../types';
import { useTranslation } from 'react-i18next';

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
  onLineBreakModeChange: (mode: 'wrap' | 'nowrap') => void;
  themeMode: 'dark' | 'light';
  keywordDescriptions?: { keyword: string; description: string }[];
  tagDescription?: string;
  currentTag?: string;
}

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
  onLineBreakModeChange,
  themeMode,
  keywordDescriptions = [],
  tagDescription = '',
  currentTag = '',
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Render message with keyword highlighting and tooltips
  const renderMessageWithHighlights = (message: string, keywords: string): React.ReactNode => {
    if (!keywords || !keywords.trim()) return message;
    
    // Theme-aware colors for keyword highlighting
    const bgColor = themeMode === 'dark' ? 'rgba(234, 179, 8, 0.3)' : 'rgba(255, 215, 0, 0.5)';
    const textColor = themeMode === 'dark' ? '#fef08a' : '#8b6914';
    
    try {
      // Try regex pattern first
      const pattern = new RegExp(`(${keywords})`, 'gi');
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;
      const regex = new RegExp(pattern);
      
      // Reset regex for exec
      const execRegex = new RegExp(`(${keywords})`, 'gi');
      while ((match = execRegex.exec(message)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(message.substring(lastIndex, match.index));
        }
        
        // Find description for this keyword
        const matchText = match[0];
        const desc = keywordDescriptions.find(kd => 
          kd.keyword.toLowerCase() === matchText.toLowerCase()
        );
        
        // Add highlighted keyword with optional tooltip
        const highlightedSpan = (
          <mark 
            key={`keyword-${match.index}`}
            style={{ 
              backgroundColor: bgColor, 
              color: textColor, 
              padding: '0 4px', 
              borderRadius: '2px',
              cursor: desc ? 'help' : 'default'
            }}
          >
            {matchText}
          </mark>
        );
        
        if (desc && desc.description) {
          parts.push(
            <Tooltip key={`tooltip-${match.index}`} title={desc.description} placement="top">
              {highlightedSpan}
            </Tooltip>
          );
        } else {
          parts.push(highlightedSpan);
        }
        
        lastIndex = execRegex.lastIndex;
      }
      
      // Add remaining text
      if (lastIndex < message.length) {
        parts.push(message.substring(lastIndex));
      }
      
      return <>{parts}</>;
    } catch (e) {
      // Fallback to space-separated keywords
      const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k);
      let result: React.ReactNode[] = [message];
      
      keywordList.forEach(keyword => {
        const newResult: React.ReactNode[] = [];
        result.forEach((part, partIdx) => {
          if (typeof part === 'string') {
            const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
            let lastIndex = 0;
            let match;
            const execRegex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
            
            while ((match = execRegex.exec(part)) !== null) {
              // Add text before match
              if (match.index > lastIndex) {
                newResult.push(part.substring(lastIndex, match.index));
              }
              
              // Find description for this keyword
              const matchText = match[0];
              const desc = keywordDescriptions.find(kd => 
                kd.keyword.toLowerCase() === matchText.toLowerCase()
              );
              
              // Add highlighted keyword with optional tooltip
              const highlightedSpan = (
                <mark 
                  key={`keyword-${partIdx}-${match.index}`}
                  style={{ 
                    backgroundColor: bgColor, 
                    color: textColor, 
                    padding: '0 4px', 
                    borderRadius: '2px',
                    cursor: desc ? 'help' : 'default'
                  }}
                >
                  {matchText}
                </mark>
              );
              
              if (desc && desc.description) {
                newResult.push(
                  <Tooltip key={`tooltip-${partIdx}-${match.index}`} title={desc.description} placement="top">
                    {highlightedSpan}
                  </Tooltip>
                );
              } else {
                newResult.push(highlightedSpan);
              }
              
              lastIndex = execRegex.lastIndex;
            }
            
            // Add remaining text
            if (lastIndex < part.length) {
              newResult.push(part.substring(lastIndex));
            }
          } else {
            newResult.push(part);
          }
        });
        result = newResult;
      });
      
      return <>{result}</>;
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

  // Group logs by source file - always returns groups
  const groupLogsByFile = (logs: LogEntry[]): { file: string; logs: LogEntry[]; startIndex: number }[] => {
    const groups: { file: string; logs: LogEntry[]; startIndex: number }[] = [];
    
    if (currentFiles.length <= 1) {
      // Single file or no files - create one group
      if (logs.length > 0) {
        groups.push({ 
          file: logs[0]?.sourceFile || '', 
          logs: logs, 
          startIndex: 0 
        });
      }
      return groups;
    }

    // Multiple files - group by source file
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

    return groups;
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
    
    // Check if current log tag matches the filtered tag and has description
    const showTagTooltip = currentTag && tagDescription && 
      (log.tag === currentTag || new RegExp(currentTag, 'i').test(log.tag));
    
    const tag = log.tag !== 'Unknown' ? (
      showTagTooltip ? (
        <Tooltip title={tagDescription} placement="top">
          <span style={{ color: '#c084fc', marginRight: '10px', cursor: 'help' }}>[{log.tag}]</span>
        </Tooltip>
      ) : (
        <span style={{ color: '#c084fc', marginRight: '10px' }}>[{log.tag}]</span>
      )
    ) : null;

    // Render message with keyword highlighting and tooltips
    const message = keywords ? renderMessageWithHighlights(log.message, keywords) : log.message;

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
        <span>{message}</span>
      </div>
    );
  };

  const tabItems = [
    {
      key: 'logs',
      label: t('logViewer'),
      children: (
        <div style={{
          flex: 1,
          height: '100%',
          backgroundColor: 'var(--ant-color-bg-container)',
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
                <p style={{ color: 'var(--ant-color-text-secondary)' }}>{t('searchingLogs')}</p>
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
              <p>{t('noLogsMatchFilter')}</p>
            </div>
          ) : (
            // Render logs with optional file grouping
            <div style={{
              height: '100%',
              overflowY: 'auto',
              overflowX: lineBreakMode === 'nowrap' ? 'auto' : 'hidden',
              padding: '16px',
              whiteSpace: lineBreakMode === 'nowrap' ? 'nowrap' : 'normal'
            }}>
              {groupLogsByFile(logs).map((group, groupIndex) => (
                <React.Fragment key={`group-${groupIndex}`}>
                  {currentFiles.length > 1 && groupIndex > 0 && (
                    <Divider 
                      style={{ 
                        margin: '16px 0',
                        borderColor: 'var(--ant-color-border-secondary)'
                      }}
                    >
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
                        ({group.logs.length} {t('logs')})
                      </span>
                    </Divider>
                  )}
                  {currentFiles.length > 1 && groupIndex === 0 && group.file && (
                    <Divider 
                      style={{ 
                        margin: '0 0 16px 0',
                        borderColor: 'var(--ant-color-border-secondary)'
                      }}
                    >
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
                        ({group.logs.length} {t('logs')})
                      </span>
                    </Divider>
                  )}
                  {group.logs.map((log: LogEntry, index: number) => renderLogLine(log, group.startIndex + index))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'ai',
      label: t('aiAnalysis'),
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
              <p>{t('clickSearchToFilter')}</p>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <style>{spinnerStyles}</style>
      {/* Statistics Bar */}
      <div style={{
        backgroundColor: 'var(--ant-color-bg-elevated)',
        padding: '12px 24px',
        borderBottom: '1px solid var(--ant-color-border)'
      }}>
        <div style={{ display: 'flex', gap: '24px', fontSize: '14px' }}>
          <div>
            <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('totalLogs')}: </span>
            <span style={{ color: '#4ec9b0', fontWeight: 600 }}>{allLogsCount}</span>
          </div>
          <div>
            <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('filtered')}: </span>
            <span style={{ color: '#4ec9b0', fontWeight: 600 }}>{logs.length}</span>
          </div>
          {currentFiles.length > 0 && (
            <div>
              <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('files')}: </span>
              <span style={{ color: '#007acc', fontWeight: 600 }}>{currentFiles.length}</span>
            </div>
          )}
          {statistics && (
            <>
              <div>
                <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('errors')}: </span>
                <span style={{ color: '#f87171', fontWeight: 600 }}>{statistics.byLevel.E || 0}</span>
              </div>
              <div>
                <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('warnings')}: </span>
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

      {/* Floating Line Break Mode Button */}
      {activeTab === 'logs' && logs.length > 0 && (
        <FloatButton
          icon={lineBreakMode === 'wrap' ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          tooltip={lineBreakMode === 'wrap' ? t('noWrap') : t('wordWrap')}
          onClick={() => onLineBreakModeChange(lineBreakMode === 'wrap' ? 'nowrap' : 'wrap')}
          style={{
            position: 'absolute',
            right: 24,
            bottom: 24,
            zIndex: 100,
          }}
        />
      )}
    </section>
  );
};

export default LogViewer;

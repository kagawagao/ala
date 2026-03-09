import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { Divider, FloatButton, Tabs, Tooltip } from 'antd';
import VirtualList from 'rc-virtual-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogEntry, LogStatistics } from '../types';

// CSS for animations
const spinnerStyles = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

// Item types for the flattened virtual list
type DividerItem = { type: 'divider'; key: string; file: string; count: number };
type LogItem = { type: 'log'; key: string; log: LogEntry; index: number };
type ListItem = DividerItem | LogItem;

const LOG_ITEM_HEIGHT = 28;
// JetBrains Mono at 14 px – approximate pixel width per character used to
// estimate the horizontal scroll range when lineBreakMode is 'nowrap'.
const MONO_CHAR_WIDTH = 8.4;
// Left padding (8px) + right padding (8px) + border-left (4px) + a small buffer.
const LOG_LINE_PADDING = 24;
// Character widths of field separators / delimiters in the rendered log line.
const LINE_NUMBER_OVERHEAD = 2; // '#' prefix + trailing space
const FIELD_SEPARATOR = 1; // space between fields
const TAG_OVERHEAD = 3; // '[' + ']' + trailing space

interface LogViewerProps {
  logs: LogEntry[];
  allLogsCount: number;
  statistics: LogStatistics | null;
  currentFiles: string[];
  highlights: string; // For visual highlighting only
  activeTab: 'logs' | 'ai';
  setActiveTab: (tab: 'logs' | 'ai') => void;
  aiAnalysis: string;
  isSearching: boolean;
  lineBreakMode: 'wrap' | 'nowrap';
  onLineBreakModeChange: (mode: 'wrap' | 'nowrap') => void;
  themeMode: 'dark' | 'light';
  highlightDescriptions?: { keyword: string; description: string }[];
  tagDescription?: string;
  currentTag?: string;
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  allLogsCount,
  statistics,
  currentFiles,
  highlights,
  activeTab,
  setActiveTab,
  aiAnalysis,
  isSearching,
  lineBreakMode,
  onLineBreakModeChange,
  themeMode,
  highlightDescriptions = [],
  tagDescription = '',
  currentTag = '',
}) => {
  const { t } = useTranslation();

  // Track the scrollable container height for VirtualList.
  // Use refs so the ResizeObserver can be re-attached whenever the container
  // node mounts / unmounts (it is conditionally rendered).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedElementRef = useRef<HTMLDivElement | null>(null);

  // The container is only rendered when there are logs and we're not searching.
  // Track this as a boolean so useEffect can use it without a complex expression.
  const containerVisible = !isSearching && logs.length > 0;

  // Create the ResizeObserver once and disconnect on unmount.
  useEffect(() => {
    resizeObserverRef.current = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      observedElementRef.current = null;
    };
  }, []);

  // Re-attach the observer whenever the scroll container mounts or remounts.
  useEffect(() => {
    const el = containerRef.current;
    const observer = resizeObserverRef.current;
    if (!observer || !el) return;

    if (observedElementRef.current && observedElementRef.current !== el) {
      observer.unobserve(observedElementRef.current);
    }

    observer.observe(el);
    observedElementRef.current = el;

    return () => {
      if (observedElementRef.current === el) {
        observer.unobserve(el);
        observedElementRef.current = null;
      }
    };
  }, [containerVisible]);

  const escapeRegex = useCallback((str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }, []);

  // Render message with highlight highlighting and tooltips
  const renderMessageWithHighlights = useCallback(
    (message: string, hlText: string): React.ReactNode => {
      if (!hlText || !hlText.trim()) return message;

      // Theme-aware colors for highlight highlighting
      const bgColor = themeMode === 'dark' ? 'rgba(234, 179, 8, 0.3)' : 'rgba(255, 215, 0, 0.5)';
      const textColor = themeMode === 'dark' ? '#fef08a' : '#8b6914';

      try {
        // Try regex pattern first
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match;

        // Reset regex for exec
        const execRegex = new RegExp(`(${hlText})`, 'gi');
        while ((match = execRegex.exec(message)) !== null) {
          // Add text before match
          if (match.index > lastIndex) {
            parts.push(message.substring(lastIndex, match.index));
          }

          // Find description for this highlight
          const matchText = match[0];
          const desc = highlightDescriptions.find(
            (kd) => kd.keyword.toLowerCase() === matchText.toLowerCase()
          );

          // Add highlighted highlight with optional tooltip
          const highlightedSpan = (
            <mark
              key={`highlight-${match.index}`}
              style={{
                backgroundColor: bgColor,
                color: textColor,
                padding: '0 4px',
                borderRadius: '2px',
                cursor: desc ? 'help' : 'default',
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
        // Fallback to space-separated highlights
        const highlightList = hlText
          .toLowerCase()
          .split(/\s+/)
          .filter((k) => k);
        let result: React.ReactNode[] = [message];

        highlightList.forEach((highlight) => {
          const newResult: React.ReactNode[] = [];
          result.forEach((part, partIdx) => {
            if (typeof part === 'string') {
              let innerLastIndex = 0;
              let innerMatch;
              const execRegex = new RegExp(`(${escapeRegex(highlight)})`, 'gi');

              while ((innerMatch = execRegex.exec(part)) !== null) {
                // Add text before match
                if (innerMatch.index > innerLastIndex) {
                  newResult.push(part.substring(innerLastIndex, innerMatch.index));
                }

                // Find description for this highlight
                const matchText = innerMatch[0];
                const desc = highlightDescriptions.find(
                  (kd) => kd.keyword.toLowerCase() === matchText.toLowerCase()
                );

                // Add highlighted highlight with optional tooltip
                const highlightedSpan = (
                  <mark
                    key={`highlight-${partIdx}-${innerMatch.index}`}
                    style={{
                      backgroundColor: bgColor,
                      color: textColor,
                      padding: '0 4px',
                      borderRadius: '2px',
                      cursor: desc ? 'help' : 'default',
                    }}
                  >
                    {matchText}
                  </mark>
                );

                if (desc && desc.description) {
                  newResult.push(
                    <Tooltip
                      key={`tooltip-${partIdx}-${innerMatch.index}`}
                      title={desc.description}
                      placement="top"
                    >
                      {highlightedSpan}
                    </Tooltip>
                  );
                } else {
                  newResult.push(highlightedSpan);
                }

                innerLastIndex = execRegex.lastIndex;
              }

              // Add remaining text
              if (innerLastIndex < part.length) {
                newResult.push(part.substring(innerLastIndex));
              }
            } else {
              newResult.push(part);
            }
          });
          result = newResult;
        });

        return <>{result}</>;
      }
    },
    [themeMode, highlightDescriptions, escapeRegex]
  );

  const getLevelClass = useCallback((level: string): { color: string; borderColor: string } => {
    const levelColors: Record<string, { color: string; borderColor: string }> = {
      E: { color: '#f87171', borderColor: '#f87171' },
      W: { color: '#facc15', borderColor: '#facc15' },
      I: { color: '#60a5fa', borderColor: '#60a5fa' },
      D: { color: '#4ade80', borderColor: '#4ade80' },
      V: { color: '#9ca3af', borderColor: '#9ca3af' },
      F: { color: '#dc2626', borderColor: '#dc2626' },
    };
    return levelColors[level] || { color: '#9ca3af', borderColor: '#6b7280' };
  }, []);

  // Flatten logs (with optional file-group dividers) into a single array for VirtualList
  const flatItems = useMemo<ListItem[]>(() => {
    if (logs.length === 0) return [];

    const items: ListItem[] = [];

    if (currentFiles.length <= 1) {
      // Single file or no files – no dividers needed
      logs.forEach((log, index) => {
        items.push({ type: 'log', key: `log-${index}`, log, index });
      });
      return items;
    }

    // Multiple files – interleave divider items
    let currentFile = '';
    let groupIndex = 0;
    let startIndex = 0;
    let groupLogs: LogEntry[] = [];

    const flushGroup = () => {
      if (groupLogs.length === 0) return;
      if (currentFile) {
        items.push({
          type: 'divider',
          key: `divider-${groupIndex}`,
          file: currentFile,
          count: groupLogs.length,
        });
      }
      groupLogs.forEach((log, idx) => {
        items.push({ type: 'log', key: `log-${startIndex + idx}`, log, index: startIndex + idx });
      });
      groupIndex++;
    };

    logs.forEach((log, index) => {
      const logFile = log.sourceFile || '';
      if (logFile !== currentFile) {
        flushGroup();
        currentFile = logFile;
        groupLogs = [log];
        startIndex = index;
      } else {
        groupLogs.push(log);
      }
    });
    flushGroup();

    return items;
  }, [logs, currentFiles]);

  // Estimate the maximum content width (in px) for horizontal scrolling in nowrap
  // mode.  VirtualList positions items with CSS transforms so the outer container's
  // overflow-x: auto has no effect – we must pass scrollWidth to VirtualList so it
  // can render its own horizontal scrollbar.
  const maxContentWidth = useMemo(() => {
    if (lineBreakMode !== 'nowrap' || flatItems.length === 0) return 0;
    let maxLen = 0;
    for (const item of flatItems) {
      if (item.type === 'log') {
        const log = item.log;
        let len = 0;
        if (log.lineNumber) len += String(log.lineNumber).length + LINE_NUMBER_OVERHEAD;
        if (log.timestamp) len += log.timestamp.length + FIELD_SEPARATOR;
        if (log.pid) len += log.pid.length + FIELD_SEPARATOR;
        if (log.tid) len += log.tid.length + FIELD_SEPARATOR;
        if (log.level) len += log.level.length + FIELD_SEPARATOR;
        if (log.tag && log.tag !== 'Unknown') len += log.tag.length + TAG_OVERHEAD;
        len += log.message.length;
        if (len > maxLen) maxLen = len;
      }
    }
    return maxLen * MONO_CHAR_WIDTH + LOG_LINE_PADDING;
  }, [flatItems, lineBreakMode]);

  // Pre-compile the tag filter regex once so renderLogLine doesn't recreate it
  // for every log entry.  Falls back to null when currentTag is empty or invalid.
  const currentTagRegex = useMemo<RegExp | null>(() => {
    if (!currentTag) return null;
    try {
      return new RegExp(currentTag, 'i');
    } catch {
      return null;
    }
  }, [currentTag]);

  const renderLogLine = useCallback(
    (log: LogEntry, index: number, extraStyle?: React.CSSProperties) => {
      const levelStyle = getLevelClass(log.level);
      const lineNumber = log.lineNumber ? (
        <span
          style={{
            color: '#858585',
            marginRight: '10px',
            userSelect: 'none',
            minWidth: '50px',
            display: 'inline-block',
          }}
        >
          #{log.lineNumber}
        </span>
      ) : null;
      const timestamp = log.timestamp ? (
        <span style={{ color: '#16a34a', marginRight: '10px' }}>{log.timestamp}</span>
      ) : null;

      // Display PID and TID
      const pid = log.pid ? (
        <span style={{ color: '#f59e0b', marginRight: '10px' }}>{log.pid}</span>
      ) : null;
      const tid = log.tid ? (
        <span style={{ color: '#f59e0b', marginRight: '10px' }}>{log.tid}</span>
      ) : null;

      const level = (
        <span style={{ fontWeight: 'bold', marginRight: '10px', color: levelStyle.color }}>
          {log.level}
        </span>
      );

      // Check if current log tag matches the filtered tag and has description
      const tagMatchesFilter = currentTag
        ? log.tag === currentTag ||
          (currentTagRegex
            ? currentTagRegex.test(log.tag)
            : log.tag.toLowerCase().includes(currentTag.toLowerCase()))
        : false;
      const showTagTooltip = currentTag && tagDescription && tagMatchesFilter;

      const tag =
        log.tag !== 'Unknown' ? (
          showTagTooltip ? (
            <Tooltip title={tagDescription} placement="top">
              <span style={{ color: '#c084fc', marginRight: '10px', cursor: 'help' }}>
                [{log.tag}]
              </span>
            </Tooltip>
          ) : (
            <span style={{ color: '#c084fc', marginRight: '10px' }}>[{log.tag}]</span>
          )
        ) : null;

      // Render message with highlight highlighting and tooltips
      const message = highlights
        ? renderMessageWithHighlights(log.message, highlights)
        : log.message;

      return (
        <div
          key={`log-${index}`}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '14px',
            padding: '4px 8px',
            borderLeft: `4px solid ${levelStyle.borderColor}`,
            marginBottom: '2px',
            whiteSpace: lineBreakMode === 'nowrap' ? 'nowrap' : 'normal',
            boxSizing: 'border-box',
            ...extraStyle,
          }}
        >
          {lineNumber}
          {timestamp}
          {pid}
          {tid}
          {level}
          {tag}
          <span>{message}</span>
        </div>
      );
    },
    [
      getLevelClass,
      renderMessageWithHighlights,
      highlights,
      currentTag,
      currentTagRegex,
      tagDescription,
      lineBreakMode,
    ]
  );

  const tabItems = [
    {
      key: 'logs',
      label: t('logViewer'),
      children: (
        <div
          style={{
            flex: 1,
            height: '100%',
            backgroundColor: 'var(--ant-color-bg-container)',
          }}
        >
          {isSearching ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-block',
                    width: '48px',
                    height: '48px',
                    border: '4px solid #4ec9b0',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginBottom: '16px',
                  }}
                ></div>
                <p style={{ color: 'var(--ant-color-text-secondary)' }}>{t('searchingLogs')}</p>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%',
                color: 'var(--ant-color-text-secondary)',
              }}
            >
              <p>{t('noLogsMatchFilter')}</p>
            </div>
          ) : (
            // Virtualised log list – only visible rows are rendered
            <div
              ref={containerRef}
              style={{
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <VirtualList<ListItem>
                data={flatItems}
                height={containerHeight}
                itemHeight={LOG_ITEM_HEIGHT}
                itemKey="key"
                scrollWidth={
                  lineBreakMode === 'nowrap' && maxContentWidth > 0 ? maxContentWidth : undefined
                }
                styles={{
                  verticalScrollBar: { right: 0 },
                }}
              >
                {(item: ListItem, _index: number, { style }: { style: React.CSSProperties }) => {
                  // Exclude the height from the positioning style so items can
                  // size themselves naturally; rc-virtual-list measures the
                  // actual rendered height via ResizeObserver and corrects the
                  // scroll calculation automatically.
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { height: _height, ...posStyle } = style;
                  if (item.type === 'divider') {
                    return (
                      <div key={item.key} style={{ ...posStyle, padding: '0 16px' }}>
                        <Divider
                          style={{
                            margin: '8px 0',
                            borderColor: 'var(--ant-color-border-secondary)',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: 'var(--ant-color-text)',
                              marginRight: '8px',
                            }}
                          >
                            📄
                          </span>
                          <span
                            style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#4ec9b0',
                            }}
                          >
                            {item.file}
                          </span>
                          <span
                            style={{
                              fontSize: '12px',
                              color: 'var(--ant-color-text-secondary)',
                              marginLeft: '12px',
                            }}
                          >
                            ({item.count} {t('logs')})
                          </span>
                        </Divider>
                      </div>
                    );
                  }
                  return renderLogLine(item.log, item.index, posStyle);
                }}
              </VirtualList>
              <FloatButton
                icon={lineBreakMode === 'wrap' ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                tooltip={lineBreakMode === 'wrap' ? t('noWrap') : t('wordWrap')}
                onClick={() => onLineBreakModeChange(lineBreakMode === 'wrap' ? 'nowrap' : 'wrap')}
                style={{
                  position: 'absolute',
                  right: 24,
                  top: 24,
                  bottom: 'unset',
                  zIndex: 100,
                }}
              />
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'ai',
      label: t('aiAnalysis'),
      children: (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            backgroundColor: 'var(--ant-color-bg-container)',
            padding: '16px',
          }}
        >
          {aiAnalysis ? (
            <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ant-color-text)' }}>
              {aiAnalysis}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%',
                color: 'var(--ant-color-text-secondary)',
              }}
            >
              <p>{t('clickSearchToFilter')}</p>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <section
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{spinnerStyles}</style>
      {/* Statistics Bar */}
      <div
        style={{
          backgroundColor: 'var(--ant-color-bg-elevated)',
          padding: '12px 24px',
          borderBottom: '1px solid var(--ant-color-border)',
        }}
      >
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
                <span style={{ color: '#f87171', fontWeight: 600 }}>
                  {statistics.byLevel.E || 0}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('warnings')}: </span>
                <span style={{ color: '#facc15', fontWeight: 600 }}>
                  {statistics.byLevel.W || 0}
                </span>
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
            flexShrink: 0,
          }}
          className="log-viewer-tabs"
        />
      </div>
    </section>
  );
};

export default LogViewer;

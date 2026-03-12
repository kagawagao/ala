import { MenuFoldOutlined, MenuUnfoldOutlined, HighlightOutlined } from '@ant-design/icons';
import { Divider, FloatButton, Tooltip, Dropdown, message, Tag, Button, theme } from 'antd';
import type { MenuProps } from 'antd';
import VirtualList from 'rc-virtual-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogEntry, LogStatistics, HighlightItem } from '../types';
import { getHighlightColorById, HIGHLIGHT_COLORS } from '../constants/highlightColors';

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
// Fallback character width for JetBrains Mono at 14 px.  The actual width is
// measured at runtime via <canvas> so this constant is only used if measurement
// fails.
const FALLBACK_CHAR_WIDTH = 8.4;
// Pixel-based layout constants that match the rendered CSS in renderLogLine.
const FIELD_MARGIN_PX = 10; // marginRight on each field element
const LINE_NUMBER_MIN_WIDTH_PX = 50; // CSS minWidth of the lineNumber span
// border-left (4px) + left padding (8px) + right padding (8px) + safety buffer.
const LOG_LINE_PADDING_PX = 32;

/** Measure the average monospace character width using a <canvas> context. */
function measureCharWidth(): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return FALLBACK_CHAR_WIDTH;
    ctx.font = "14px 'JetBrains Mono', monospace";
    const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789[]:#/ ';
    const measured = ctx.measureText(sample).width / sample.length;
    return measured > 0 ? measured : FALLBACK_CHAR_WIDTH;
  } catch {
    return FALLBACK_CHAR_WIDTH;
  }
}

interface LogViewerProps {
  logs: LogEntry[];
  allLogsCount: number;
  statistics: LogStatistics | null;
  currentFiles: string[];
  highlights: string; // For visual highlighting only (legacy)
  coloredHighlights: HighlightItem[]; // New colored highlights
  isSearching: boolean;
  lineBreakMode: 'wrap' | 'nowrap';
  onLineBreakModeChange: (mode: 'wrap' | 'nowrap') => void;
  themeMode: 'dark' | 'light';
  highlightDescriptions?: { keyword: string; description: string }[];
  tagDescription?: string;
  currentTag?: string;
  onAddHighlight?: (text: string, color?: string) => void; // Updated to accept color
  siderCollapsed?: boolean;
  onSiderCollapseClick?: (collapsed: boolean) => void;
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  allLogsCount,
  statistics,
  currentFiles,
  highlights,
  coloredHighlights,
  isSearching,
  lineBreakMode,
  onLineBreakModeChange,
  themeMode,
  highlightDescriptions = [],
  tagDescription = '',
  currentTag = '',
  onAddHighlight,
  siderCollapsed,
  onSiderCollapseClick,
}) => {
  const { t } = useTranslation();

  // Context menu state
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedText, setSelectedText] = useState<string>('');

  // Runtime-measured character width for accurate horizontal scroll estimation.
  const [charWidth, setCharWidth] = useState(measureCharWidth);
  useEffect(() => {
    // Re-measure after all fonts (e.g. JetBrains Mono) have loaded.
    document.fonts?.ready.then(() => setCharWidth(measureCharWidth()));
  }, []);

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
      // Start with message as a single-element parts array
      let parts: React.ReactNode[] = [message];

      // Apply colored highlights if any
      if (coloredHighlights && coloredHighlights.length > 0) {
        coloredHighlights.forEach((highlightItem, highlightIdx) => {
          const newParts: React.ReactNode[] = [];
          const colors = getHighlightColorById(highlightItem.color, themeMode);

          parts.forEach((part, partIdx) => {
            if (typeof part === 'string') {
              try {
                const execRegex = new RegExp(`(${highlightItem.pattern})`, 'gi');
                let lastIndex = 0;
                let match;

                while ((match = execRegex.exec(part)) !== null) {
                  // Add text before match
                  if (match.index > lastIndex) {
                    newParts.push(part.substring(lastIndex, match.index));
                  }

                  // Find description for this highlight
                  const matchText = match[0];
                  const desc = highlightDescriptions.find(
                    (kd) => kd.keyword.toLowerCase() === matchText.toLowerCase()
                  );

                  // Add highlighted text with color
                  const highlightedSpan = (
                    <mark
                      key={`colored-${highlightIdx}-${partIdx}-${match.index}`}
                      style={{
                        backgroundColor: colors.background,
                        color: colors.text,
                        padding: '0 4px',
                        borderRadius: '2px',
                        cursor: desc ? 'help' : 'default',
                      }}
                    >
                      {matchText}
                    </mark>
                  );

                  if (desc && desc.description) {
                    newParts.push(
                      <Tooltip
                        key={`tooltip-colored-${highlightIdx}-${partIdx}-${match.index}`}
                        title={desc.description}
                        placement="top"
                      >
                        {highlightedSpan}
                      </Tooltip>
                    );
                  } else {
                    newParts.push(highlightedSpan);
                  }

                  lastIndex = execRegex.lastIndex;
                }

                // Add remaining text
                if (lastIndex < part.length) {
                  newParts.push(part.substring(lastIndex));
                }
              } catch (e) {
                // If regex fails, keep the part as is
                newParts.push(part);
              }
            } else {
              newParts.push(part);
            }
          });

          parts = newParts;
        });
      }

      // Then apply legacy highlights if any
      if (hlText && hlText.trim()) {
        // Theme-aware colors for legacy highlight highlighting
        const bgColor = themeMode === 'dark' ? 'rgba(234, 179, 8, 0.3)' : 'rgba(255, 215, 0, 0.5)';
        const textColor = themeMode === 'dark' ? '#fef08a' : '#8b6914';

        try {
          // Try regex pattern first
          const newParts: React.ReactNode[] = [];

          parts.forEach((part, partIdx) => {
            if (typeof part === 'string') {
              let lastIndex = 0;
              let match;
              const partRegex = new RegExp(`(${hlText})`, 'gi');

              while ((match = partRegex.exec(part)) !== null) {
                // Add text before match
                if (match.index > lastIndex) {
                  newParts.push(part.substring(lastIndex, match.index));
                }

                // Find description for this highlight
                const matchText = match[0];
                const desc = highlightDescriptions.find(
                  (kd) => kd.keyword.toLowerCase() === matchText.toLowerCase()
                );

                // Add highlighted highlight with optional tooltip
                const highlightedSpan = (
                  <mark
                    key={`legacy-highlight-${partIdx}-${match.index}`}
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
                  newParts.push(
                    <Tooltip
                      key={`legacy-tooltip-${partIdx}-${match.index}`}
                      title={desc.description}
                      placement="top"
                    >
                      {highlightedSpan}
                    </Tooltip>
                  );
                } else {
                  newParts.push(highlightedSpan);
                }

                lastIndex = partRegex.lastIndex;
              }

              // Add remaining text
              if (lastIndex < part.length) {
                newParts.push(part.substring(lastIndex));
              }
            } else {
              newParts.push(part);
            }
          });

          parts = newParts;
        } catch (e) {
          // Fallback to space-separated highlights
          const highlightList = hlText
            .toLowerCase()
            .split(/\s+/)
            .filter((k) => k);

          highlightList.forEach((highlight) => {
            const newParts: React.ReactNode[] = [];

            parts.forEach((part, partIdx) => {
              if (typeof part === 'string') {
                let innerLastIndex = 0;
                let innerMatch;
                const execRegex = new RegExp(`(${escapeRegex(highlight)})`, 'gi');

                while ((innerMatch = execRegex.exec(part)) !== null) {
                  // Add text before match
                  if (innerMatch.index > innerLastIndex) {
                    newParts.push(part.substring(innerLastIndex, innerMatch.index));
                  }

                  // Find description for this highlight
                  const matchText = innerMatch[0];
                  const desc = highlightDescriptions.find(
                    (kd) => kd.keyword.toLowerCase() === matchText.toLowerCase()
                  );

                  // Add highlighted highlight with optional tooltip
                  const highlightedSpan = (
                    <mark
                      key={`legacy-highlight-${partIdx}-${innerMatch.index}`}
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
                    newParts.push(
                      <Tooltip
                        key={`legacy-tooltip-${partIdx}-${innerMatch.index}`}
                        title={desc.description}
                        placement="top"
                      >
                        {highlightedSpan}
                      </Tooltip>
                    );
                  } else {
                    newParts.push(highlightedSpan);
                  }

                  innerLastIndex = execRegex.lastIndex;
                }

                // Add remaining text
                if (innerLastIndex < part.length) {
                  newParts.push(part.substring(innerLastIndex));
                }
              } else {
                newParts.push(part);
              }
            });

            parts = newParts;
          });
        }
      }

      return <>{parts}</>;
    },
    [themeMode, highlightDescriptions, escapeRegex, coloredHighlights]
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
  //
  // Uses pixel-accurate margins / minWidth values that match the CSS in renderLogLine
  // so the scroll range is never shorter than the actual content.
  const maxContentWidth = useMemo(() => {
    if (lineBreakMode !== 'nowrap' || flatItems.length === 0) return 0;
    const cw = charWidth; // runtime-measured character width
    let maxWidth = 0;
    for (const item of flatItems) {
      if (item.type === 'log') {
        const log = item.log;
        let width = LOG_LINE_PADDING_PX;
        if (log.lineNumber) {
          // '#' prefix + digits; the span has minWidth: 50px
          const textWidth = (String(log.lineNumber).length + 1) * cw;
          width += Math.max(textWidth, LINE_NUMBER_MIN_WIDTH_PX) + FIELD_MARGIN_PX;
        }
        if (log.timestamp) width += log.timestamp.length * cw + FIELD_MARGIN_PX;
        if (log.pid) width += log.pid.length * cw + FIELD_MARGIN_PX;
        if (log.tid) width += log.tid.length * cw + FIELD_MARGIN_PX;
        if (log.level) width += log.level.length * cw + FIELD_MARGIN_PX;
        if (log.tag && log.tag !== 'Unknown') width += (log.tag.length + 2) * cw + FIELD_MARGIN_PX; // +2 for [ ]
        width += log.message.length * cw;
        if (width > maxWidth) maxWidth = width;
      }
    }
    return maxWidth;
  }, [flatItems, lineBreakMode, charWidth]);

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

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && text.length > 0) {
      setSelectedText(text);
      setContextMenuVisible(true);
    }
  }, []);

  // Handle adding selected text to highlights with color
  const handleAddToHighlightsWithColor = useCallback(
    (colorId: string) => {
      if (selectedText && onAddHighlight) {
        onAddHighlight(selectedText, colorId);
        const colorName = t(`color_${colorId}`);
        message.success(t('addToHighlightsWithColor', { color: colorName }));
      }
      setContextMenuVisible(false);
    },
    [selectedText, onAddHighlight, t]
  );

  // Context menu items with color submenu
  const contextMenuItems: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'addToHighlights',
        icon: <HighlightOutlined />,
        label: t('addToHighlightsWithColor', { color: '' }).replace(/\s*$/, ''),
        children: HIGHLIGHT_COLORS.map((color) => {
          const colors = getHighlightColorById(color.id, themeMode);
          return {
            key: `color-${color.id}`,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tag
                  color={colors.background}
                  style={{
                    color: colors.text,
                    border: 'none',
                    margin: 0,
                  }}
                >
                  {t(`color_${color.id}`)}
                </Tag>
              </div>
            ),
            onClick: () => handleAddToHighlightsWithColor(color.id),
          };
        }),
      },
    ],
    [t, themeMode, handleAddToHighlightsWithColor]
  );

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuVisible(false);
    };
    if (contextMenuVisible) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
    return undefined;
  }, [contextMenuVisible]);

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
      const message =
        highlights || (coloredHighlights && coloredHighlights.length > 0)
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
      coloredHighlights,
      currentTag,
      currentTagRegex,
      tagDescription,
      lineBreakMode,
    ]
  );

  const { token } = theme.useToken();

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
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '24px', fontSize: '14px', alignItems: 'center' }}>
          <div>
            {siderCollapsed ? (
              <Button
                type="link"
                style={{ color: token.colorPrimary }}
                onClick={() => onSiderCollapseClick?.(false)}
                icon={<MenuUnfoldOutlined />}
              />
            ) : (
              <Button
                type="link"
                style={{ color: token.colorPrimary }}
                onClick={() => onSiderCollapseClick?.(true)}
                icon={<MenuFoldOutlined />}
              />
            )}
          </div>
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

      {/* Log Content */}
      <div
        style={{
          flex: 1,
          height: '100%',
          backgroundColor: 'var(--ant-color-bg-container)',
          overflow: 'hidden',
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
          <Dropdown menu={{ items: contextMenuItems }} open={contextMenuVisible} trigger={[]}>
            <div
              ref={containerRef}
              onContextMenu={handleContextMenu}
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
          </Dropdown>
        )}
      </div>
    </section>
  );
};

export default LogViewer;

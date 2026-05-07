import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import type { InputRef } from 'antd'
import { Table, Tag, Typography, Tooltip, Empty, App, Button, Input, Progress } from 'antd'
import {
  CopyOutlined,
  DownloadOutlined,
  SearchOutlined,
  CloseOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { LogEntry, HighlightItem } from '../types'
import { generateCSV, generateJSON, downloadBlob, generateExportFilename } from '../utils/export'

const { Text } = Typography

const LEVEL_TAG_COLOR: Record<string, string> = {
  V: '#8c8c8c',
  D: '#1677ff',
  I: '#52c41a',
  W: '#fa8c16',
  E: '#f5222d',
  F: '#722ed1',
}

const LEVEL_BG: Record<string, string> = {
  E: 'rgba(245,34,45,0.06)',
  F: 'rgba(114,46,209,0.06)',
  W: 'rgba(250,140,22,0.04)',
}

interface HighlightMatch {
  start: number
  end: number
  color: string
}

// Module-level regex cache to avoid recompilation on every render
const regexCache = new Map<string, RegExp | null>()
function getRegex(pattern: string, flags: string): RegExp | null {
  const key = `${pattern}|${flags}`
  if (regexCache.has(key)) return regexCache.get(key) ?? null
  try {
    const re = new RegExp(pattern, flags)
    regexCache.set(key, re)
    return re
  } catch {
    regexCache.set(key, null)
    return null
  }
}

/** Escape regex special characters so a literal string can be used as a regex pattern. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, items: HighlightItem[]): React.ReactNode {
  const activeItems = items.filter((h) => h.pattern.trim())
  if (!activeItems.length) return text

  const matches: HighlightMatch[] = []
  for (const item of activeItems) {
    const re = getRegex(item.pattern, 'gi')
    if (!re) continue
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, color: item.color })
    }
  }

  if (!matches.length) return text

  // Sort by start position; skip overlapping spans
  matches.sort((a, b) => a.start - b.start || b.end - a.end)

  const result: React.ReactNode[] = []
  let pos = 0
  let keyIdx = 0

  for (const m of matches) {
    if (m.start < pos) continue
    if (m.start > pos) result.push(text.slice(pos, m.start))
    result.push(
      <mark key={keyIdx++} style={{ background: m.color, padding: '0 1px', borderRadius: 2 }}>
        {text.slice(m.start, m.end)}
      </mark>,
    )
    pos = m.end
  }
  if (pos < text.length) result.push(text.slice(pos))
  return <>{result}</>
}

interface LogViewerProps {
  logs: LogEntry[]
  totalLogs: number
  highlights: HighlightItem[]
  wordWrap: boolean
  formatDetected?: string
  parseProgress?: { current: number; total: number } | null
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  totalLogs,
  highlights,
  wordWrap,
  formatDetected,
  parseProgress,
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState<number>(400)

  // --- Search bar state ---
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const searchInputRef = useRef<InputRef>(null)

  // Compute matching line indices (filtered logs that contain searchQuery in raw_line or message)
  const matchingIndices = useMemo(() => {
    if (!searchQuery.trim()) return [] as number[]
    const q = searchQuery.toLowerCase()
    const indices: number[] = []
    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i]
      if (entry.raw_line.toLowerCase().includes(q) || entry.message.toLowerCase().includes(q)) {
        indices.push(i)
      }
    }
    return indices
  }, [logs, searchQuery])

  // Reset currentMatchIndex when matches change
  useEffect(() => {
    if (matchingIndices.length === 0) {
      setCurrentMatchIndex(0)
    } else if (currentMatchIndex >= matchingIndices.length) {
      setCurrentMatchIndex(Math.max(0, matchingIndices.length - 1))
    }
  }, [matchingIndices, currentMatchIndex])

  // Keyboard listener: Ctrl+F to open, Esc to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault()
        setSearchOpen(false)
        setSearchQuery('')
        setCurrentMatchIndex(0)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen])

  // Scroll to current match
  const scrollToMatch = useCallback((index: number) => {
    if (!tableWrapperRef.current) return
    const body = tableWrapperRef.current.querySelector('.ant-table-body') as HTMLElement | null
    if (!body) return
    // Estimate row height for antd small table (header ~39px, each row ~39px)
    const ROW_HEIGHT = 39
    const targetScroll = index * ROW_HEIGHT
    body.scrollTo({ top: targetScroll, behavior: 'smooth' })
  }, [])

  const navigateToMatch = useCallback(
    (direction: 'prev' | 'next') => {
      if (matchingIndices.length === 0) return
      let next: number
      if (direction === 'next') {
        next = (currentMatchIndex + 1) % matchingIndices.length
      } else {
        next = (currentMatchIndex - 1 + matchingIndices.length) % matchingIndices.length
      }
      setCurrentMatchIndex(next)
      scrollToMatch(matchingIndices[next])
    },
    [matchingIndices, currentMatchIndex, scrollToMatch],
  )

  useEffect(() => {
    const el = tableWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const tagColumnWidth = useMemo(() => {
    if (!logs.length) return 120
    let maxLen = 0
    for (const entry of logs) {
      if (entry.tag && entry.tag.length > maxLen) maxLen = entry.tag.length
    }
    return Math.min(Math.max(maxLen * 7 + 20, 80), 400)
  }, [logs])

  // Fast lookup for match indices and current match row index
  const matchIndexSet = useMemo(() => new Set(matchingIndices), [matchingIndices])
  const currentMatchRowIndex = matchingIndices.length > 0 ? matchingIndices[currentMatchIndex] : -1

  const handleCopyRow = useCallback(
    async (record: LogEntry) => {
      try {
        await navigator.clipboard.writeText(record.raw_line)
        void message.success(t('copied'), 1)
      } catch {
        void message.error('Copy failed')
      }
    },
    [t, message],
  )

  const columns = useMemo(
    () => [
      {
        title: t('line'),
        dataIndex: 'line_number',
        key: 'line_number',
        width: 64,
        fixed: 'left' as const,
        render: (v: number) => (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {v}
          </Text>
        ),
      },
      {
        title: t('timestamp'),
        dataIndex: 'timestamp',
        key: 'timestamp',
        width: 148,
        ellipsis: true,
        render: (v: string | null) => (
          <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v ?? ''}</Text>
        ),
      },
      {
        title: 'L',
        dataIndex: 'level',
        key: 'level',
        width: 32,
        align: 'center' as const,
        render: (v: string) => (
          <Tag
            color={LEVEL_TAG_COLOR[v] || '#8c8c8c'}
            style={{ fontSize: 10, padding: '0 3px', margin: 0, lineHeight: '16px' }}
            variant="filled"
          >
            {v}
          </Tag>
        ),
      },
      {
        title: t('tag'),
        dataIndex: 'tag',
        key: 'tag',
        width: tagColumnWidth,
        ellipsis: true,
        render: (v: string) => (
          <Tooltip title={v}>
            <Text style={{ fontSize: 11 }}>{v}</Text>
          </Tooltip>
        ),
      },
      {
        title: 'PID',
        dataIndex: 'pid',
        key: 'pid',
        width: 60,
        render: (v: string | null) => (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {v ?? ''}
          </Text>
        ),
      },
      {
        title: 'TID',
        dataIndex: 'tid',
        key: 'tid',
        width: 60,
        render: (v: string | null) => (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {v ?? ''}
          </Text>
        ),
      },
      {
        title: t('message'),
        dataIndex: 'message',
        key: 'message',
        render: (v: string) => {
          const allHighlights = searchQuery.trim()
            ? [
                ...highlights,
                { pattern: escapeRegex(searchQuery), color: 'var(--ant-color-warning-bg)' },
              ]
            : highlights
          return (
            <span
              style={{
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: wordWrap ? 'pre-wrap' : 'nowrap',
                wordBreak: wordWrap ? 'break-all' : undefined,
              }}
            >
              {highlightText(v, allHighlights)}
            </span>
          )
        },
      },
      {
        title: '',
        key: 'copy',
        width: 28,
        fixed: 'right' as const,
        render: (_: unknown, record: LogEntry) => (
          <Tooltip title={t('copy')}>
            <CopyOutlined
              style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ant-color-text-secondary)' }}
              onClick={() => {
                void handleCopyRow(record)
              }}
            />
          </Tooltip>
        ),
      },
    ],
    [t, wordWrap, highlights, handleCopyRow, tagColumnWidth, searchQuery],
  )

  if (!logs.length && totalLogs === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('noFileLoaded')}
        style={{ marginTop: 80 }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Parse progress bar */}
      {parseProgress && parseProgress.total > 0 && (
        <div
          style={{
            padding: '2px 12px',
            borderBottom: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Progress
              percent={Math.round((parseProgress.current / parseProgress.total) * 100)}
              size="small"
              showInfo={false}
              style={{ flex: 1, margin: 0 }}
              strokeColor="var(--ant-color-primary)"
              trailColor="var(--ant-color-bg-container-disabled)"
            />
            <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {parseProgress.current.toLocaleString()} / {parseProgress.total.toLocaleString()}{' '}
              lines
            </Text>
          </div>
        </div>
      )}
      <div
        style={{
          padding: '4px 12px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
        }}
      >
        <Text style={{ fontSize: 12 }}>
          {t('filteredCount', { count: logs.length, total: totalLogs })}
        </Text>
        {formatDetected && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('formatDetected', { format: formatDetected })}
          </Text>
        )}
        <div style={{ flex: 1 }} />
        <Tooltip title={logs.length === 0 ? t('noDataToExport') : undefined}>
          <span>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              disabled={logs.length === 0}
              onClick={() => {
                const csv = generateCSV(logs)
                downloadBlob(csv, generateExportFilename('csv'), 'text/csv;charset=utf-8')
              }}
            >
              {t('exportCsv')}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={logs.length === 0 ? t('noDataToExport') : undefined}>
          <span>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              disabled={logs.length === 0}
              onClick={() => {
                const json = generateJSON(logs)
                downloadBlob(json, generateExportFilename('json'), 'application/json;charset=utf-8')
              }}
            >
              {t('exportJson')}
            </Button>
          </span>
        </Tooltip>
      </div>

      {logs.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('noLogsFound')}
          style={{ marginTop: 60 }}
        />
      ) : (
        <div
          ref={tableWrapperRef}
          style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* Search bar */}
          {searchOpen && (
            <div
              style={{
                padding: '4px 12px',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                borderBottom: '1px solid var(--ant-color-border)',
                flexShrink: 0,
                background: 'var(--ant-color-bg-elevated)',
              }}
            >
              <Input
                ref={searchInputRef}
                size="small"
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentMatchIndex(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    navigateToMatch(e.shiftKey ? 'prev' : 'next')
                  }
                }}
                prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-secondary)' }} />}
                suffix={
                  searchQuery && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, whiteSpace: 'nowrap', marginRight: 4 }}
                    >
                      {matchingIndices.length > 0
                        ? `${currentMatchIndex + 1} / ${matchingIndices.length}`
                        : '0 / 0'}
                    </Text>
                  )
                }
                style={{ maxWidth: 420 }}
                allowClear
              />
              <Button
                size="small"
                type="text"
                icon={<UpOutlined />}
                disabled={matchingIndices.length === 0}
                onClick={() => navigateToMatch('prev')}
              />
              <Button
                size="small"
                type="text"
                icon={<DownOutlined />}
                disabled={matchingIndices.length === 0}
                onClick={() => navigateToMatch('next')}
              />
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                  setCurrentMatchIndex(0)
                }}
              />
            </div>
          )}
          <Table
            dataSource={logs}
            columns={columns}
            rowKey="line_number"
            size="small"
            pagination={false}
            scroll={{ y: tableHeight, x: wordWrap ? undefined : 900 }}
            virtual
            rowClassName={(record) => {
              const classes: string[] = []
              if (LEVEL_BG[record.level]) classes.push(`log-row-${record.level}`)
              if (currentMatchRowIndex === record.line_number - 1)
                classes.push('log-row-search-active')
              return classes.join(' ')
            }}
            onRow={(record) => {
              const rowIndex = record.line_number - 1
              const isCurrentMatch = rowIndex === currentMatchRowIndex
              const isMatch = matchIndexSet.has(rowIndex)
              return {
                style: {
                  background: isCurrentMatch
                    ? 'var(--ant-color-warning-bg)'
                    : isMatch
                      ? 'var(--ant-color-warning-bg-hover)'
                      : LEVEL_BG[record.level] || undefined,
                },
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

export default LogViewer

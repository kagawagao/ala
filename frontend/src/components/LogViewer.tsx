import React, { useCallback, useMemo } from 'react'
import { Table, Tag, Typography, Tooltip, message, Empty } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { LogEntry, HighlightItem } from '../types'

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

function highlightText(text: string, items: HighlightItem[]): React.ReactNode {
  const activeItems = items.filter((h) => h.pattern.trim())
  if (!activeItems.length) return text

  const matches: HighlightMatch[] = []
  for (const item of activeItems) {
    let re: RegExp
    try {
      re = new RegExp(item.pattern, 'gi')
    } catch {
      continue
    }
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
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  totalLogs,
  highlights,
  wordWrap,
  formatDetected,
}) => {
  const { t } = useTranslation()

  const handleCopyRow = useCallback(
    async (record: LogEntry) => {
      try {
        await navigator.clipboard.writeText(record.raw_line)
        void message.success(t('copied'), 1)
      } catch {
        void message.error('Copy failed')
      }
    },
    [t],
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
            bordered={false}
          >
            {v}
          </Tag>
        ),
      },
      {
        title: t('tag'),
        dataIndex: 'tag',
        key: 'tag',
        width: 120,
        ellipsis: true,
        render: (v: string) => (
          <Tooltip title={v}>
            <Text style={{ fontSize: 11 }}>{v}</Text>
          </Tooltip>
        ),
      },
      {
        title: t('pid'),
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
        title: t('message'),
        dataIndex: 'message',
        key: 'message',
        render: (v: string) => (
          <span
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              whiteSpace: wordWrap ? 'pre-wrap' : 'nowrap',
              wordBreak: wordWrap ? 'break-all' : undefined,
            }}
          >
            {highlightText(v, highlights)}
          </span>
        ),
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
    [t, wordWrap, highlights, handleCopyRow],
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
      </div>

      {logs.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('noLogsFound')}
          style={{ marginTop: 60 }}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Table
            dataSource={logs}
            columns={columns}
            rowKey="line_number"
            size="small"
            pagination={false}
            scroll={{ y: 'calc(100vh - 160px)', x: wordWrap ? undefined : 900 }}
            virtual
            rowClassName={(record) => (LEVEL_BG[record.level] ? `log-row-${record.level}` : '')}
            onRow={(record) => ({
              style: { background: LEVEL_BG[record.level] },
            })}
          />
        </div>
      )}
    </div>
  )
}

export default LogViewer

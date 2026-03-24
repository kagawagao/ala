import React from 'react'
import {
  Card,
  Descriptions,
  Table,
  Tag,
  Typography,
  List,
  Empty,
  Row,
  Col,
  Statistic,
} from 'antd'
import { useTranslation } from 'react-i18next'
import type { TraceParseResult } from '../types'

const { Text } = Typography

interface TraceViewerProps {
  traceResult: TraceParseResult | null
}

const TraceViewer: React.FC<TraceViewerProps> = ({ traceResult }) => {
  const { t } = useTranslation()

  if (!traceResult) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('noFileLoaded')}
        style={{ marginTop: 80 }}
      />
    )
  }

  const { summary, format, file_size } = traceResult

  const processColumns = [
    { title: 'PID', dataIndex: 'pid', key: 'pid', width: 80 },
    { title: t('process'), dataIndex: 'name', key: 'name' },
    { title: t('threads'), dataIndex: 'thread_count', key: 'thread_count', width: 80 },
  ]

  const sliceColumns = [
    { title: t('message'), dataIndex: 'name', key: 'name' },
    { title: 'Count', dataIndex: 'count', key: 'count', width: 80 },
    {
      title: `${t('duration')} (ms)`,
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 120,
      render: (v: number) => v?.toFixed(2),
      sorter: (a: { duration_ms: number }, b: { duration_ms: number }) => b.duration_ms - a.duration_ms,
    },
  ]

  const metadataItems = Object.entries(summary.metadata || {}).map(([k, v]) => ({
    key: k,
    label: k,
    children: String(v),
  }))

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* Summary Cards */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('duration')}
              value={summary.duration_ms != null ? summary.duration_ms.toFixed(1) : '—'}
              suffix={summary.duration_ms != null ? t('ms') : ''}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t('processes')} value={summary.process_count} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t('threads')} value={summary.thread_count} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t('events')} value={summary.event_count} />
          </Card>
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 8 }}>
        <Col>
          <Tag>Format: {format}</Tag>
          <Tag>Size: {(file_size / 1024).toFixed(1)} KB</Tag>
        </Col>
      </Row>

      {/* Process List */}
      {summary.processes?.length > 0 && (
        <Card
          size="small"
          title={t('processes')}
          style={{ marginBottom: 12 }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            dataSource={summary.processes}
            columns={processColumns}
            rowKey="pid"
            size="small"
            pagination={false}
            scroll={{ y: 180 }}
          />
        </Card>
      )}

      {/* Top Slices */}
      {summary.top_slices?.length > 0 && (
        <Card
          size="small"
          title={t('topSlices')}
          style={{ marginBottom: 12 }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            dataSource={summary.top_slices}
            columns={sliceColumns}
            rowKey="name"
            size="small"
            pagination={false}
            scroll={{ y: 200 }}
          />
        </Card>
      )}

      {/* FTrace Events */}
      {summary.ftrace_events?.length > 0 && (
        <Card size="small" title={t('ftraceEvents')} style={{ marginBottom: 12 }}>
          <List
            size="small"
            dataSource={summary.ftrace_events}
            renderItem={(item) => (
              <List.Item style={{ padding: '2px 0' }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{item}</Text>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Metadata */}
      {metadataItems.length > 0 && (
        <Card size="small" title={t('metadata')}>
          <Descriptions items={metadataItems} size="small" column={2} />
        </Card>
      )}
    </div>
  )
}

export default TraceViewer

import React, { useCallback, useState } from 'react'
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
  Input,
  Select,
  Space,
  Button,
  Spin,
  message,
} from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { filterTrace } from '../api/trace'
import type { TraceParseResult } from '../types'

const { Text } = Typography

interface TraceViewerProps {
  traceResult: TraceParseResult | null
}

const TraceViewer: React.FC<TraceViewerProps> = ({ traceResult }) => {
  const { t } = useTranslation()

  // Filter state
  const [pidInput, setPidInput] = useState('')
  const [processNameFilter, setProcessNameFilter] = useState('')
  const [selectedPids, setSelectedPids] = useState<number[]>([])
  const [filteredResult, setFilteredResult] = useState<TraceParseResult | null>(null)
  const [filtering, setFiltering] = useState(false)

  const displayResult = filteredResult ?? traceResult

  const handleFilter = useCallback(async () => {
    if (!traceResult) return

    const pids: number[] = [
      ...selectedPids,
      ...pidInput
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n)),
    ]

    if (pids.length === 0 && !processNameFilter.trim()) {
      setFilteredResult(null)
      return
    }

    setFiltering(true)
    try {
      const result = await filterTrace({
        result: traceResult,
        pids: pids.length > 0 ? pids : undefined,
        process_name: processNameFilter.trim() || undefined,
      })
      setFilteredResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Filter failed'
      void message.error(msg)
    } finally {
      setFiltering(false)
    }
  }, [traceResult, selectedPids, pidInput, processNameFilter])

  const handleReset = useCallback(() => {
    setPidInput('')
    setProcessNameFilter('')
    setSelectedPids([])
    setFilteredResult(null)
  }, [])

  if (!traceResult) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('noFileLoaded')}
        style={{ marginTop: 80 }}
      />
    )
  }

  const { summary, format, file_size } = displayResult!
  const isFiltered = filteredResult !== null

  // Build PID options from the unfiltered trace
  const pidOptions = (traceResult.summary.processes ?? []).map((p) => ({
    label: `${p.pid} – ${p.name}`,
    value: p.pid,
  }))

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
      sorter: (a: { duration_ms: number }, b: { duration_ms: number }) =>
        b.duration_ms - a.duration_ms,
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
            <Statistic
              title={t('processes')}
              value={summary.process_count}
              valueStyle={isFiltered ? { color: 'var(--ant-color-primary)' } : undefined}
            />
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

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col>
          <Tag>Format: {format}</Tag>
          <Tag>Size: {(file_size / 1024).toFixed(1)} KB</Tag>
          {isFiltered && <Tag color="blue">{t('filtered')}</Tag>}
        </Col>
      </Row>

      {/* Process Filter Panel */}
      <Card
        size="small"
        title={
          <Space>
            <FilterOutlined />
            {t('processFilter')}
          </Space>
        }
        style={{ marginBottom: 12 }}
        extra={
          isFiltered ? (
            <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>
              {t('resetFilter')}
            </Button>
          ) : null
        }
      >
        <Space wrap style={{ width: '100%' }}>
          <Select
            mode="multiple"
            style={{ minWidth: 220 }}
            placeholder={t('selectProcesses')}
            options={pidOptions}
            value={selectedPids}
            onChange={setSelectedPids}
            allowClear
            showSearch
            filterOption={(input, option) =>
              String(option?.label ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          />
          <Input
            style={{ width: 160 }}
            placeholder={t('processNameRegex')}
            value={processNameFilter}
            onChange={(e) => setProcessNameFilter(e.target.value)}
            onPressEnter={() => void handleFilter()}
            allowClear
          />
          <Input
            style={{ width: 160 }}
            placeholder={t('pidCommaList')}
            value={pidInput}
            onChange={(e) => setPidInput(e.target.value)}
            onPressEnter={() => void handleFilter()}
            allowClear
          />
          <Button
            type="primary"
            icon={filtering ? <Spin size="small" /> : <FilterOutlined />}
            onClick={() => void handleFilter()}
            disabled={filtering}
          >
            {t('applyFilter')}
          </Button>
        </Space>
      </Card>

      {/* Process List */}
      {summary.processes?.length > 0 && (
        <Card
          size="small"
          title={t('processes')}
          style={{ marginBottom: 12 }}
          styles={{ body: { padding: 0 } }}
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
          styles={{ body: { padding: 0 } }}
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

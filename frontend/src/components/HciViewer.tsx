import React, { useMemo, useRef, useState } from 'react'
import { Card, Table, Tag, Typography, Empty, Row, Col, Statistic, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import type { HciEntry, HciStatistics } from '../types/hci'

const { Text } = Typography

interface HciViewerProps {
  entries: HciEntry[]
  totalPackets: number
  formatDetected?: string
  statistics?: HciStatistics | null
}

const TYPE_COLORS: Record<string, string> = {
  COMMAND: 'blue',
  EVENT: 'green',
  ACL_DATA: 'orange',
  SCO_DATA: 'purple',
  ISO_DATA: 'cyan',
}

function computeStatistics(entries: HciEntry[]): HciStatistics | null {
  if (entries.length === 0) return null

  const byDirection: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const opcodes = new Set<number>()

  for (const e of entries) {
    byDirection[e.direction] = (byDirection[e.direction] ?? 0) + 1
    byType[e.hci_type] = (byType[e.hci_type] ?? 0) + 1
    if (e.opcode != null) opcodes.add(e.opcode)
  }

  const timestamps = entries
    .map((e) => e.timestamp)
    .filter((t): t is string => t !== null)
    .sort()
  let duration_seconds: number | null = null
  if (timestamps.length >= 2) {
    const start = new Date(timestamps[0]).getTime()
    const end = new Date(timestamps[timestamps.length - 1]).getTime()
    if (!isNaN(start) && !isNaN(end)) {
      duration_seconds = (end - start) / 1000
    }
  }

  return {
    total: entries.length,
    by_direction: byDirection,
    by_type: byType,
    duration_seconds,
    unique_opcodes: opcodes.size,
  }
}

const HciViewer: React.FC<HciViewerProps> = ({
  entries,
  totalPackets,
  formatDetected,
  statistics: externalStats,
}) => {
  const { t } = useTranslation()

  const statistics = useMemo(
    () => externalStats ?? computeStatistics(entries),
    [externalStats, entries],
  )

  const packetTableWrapperRef = useRef<HTMLDivElement>(null)
  const [packetTableHeight, setPacketTableHeight] = useState(400)

  React.useEffect(() => {
    const el = packetTableWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((observerEntries) => {
      for (const entry of observerEntries) {
        setPacketTableHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (entries.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('noFileLoaded')}
        style={{ marginTop: 80 }}
      />
    )
  }

  const packetColumns = [
    {
      title: '#',
      dataIndex: 'packet_number',
      key: 'packet_number',
      width: 70,
      fixed: 'left' as const,
    },
    {
      title: t('timestamp'),
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (ts: string | null) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{ts || '—'}</Text>
      ),
    },
    {
      title: t('hciDirection'),
      dataIndex: 'direction',
      key: 'direction',
      width: 100,
      render: (dir: string) => {
        const isHostToCtrl = dir === 'HOST_TO_CONTROLLER'
        return (
          <Tag color={isHostToCtrl ? 'blue' : 'green'}>
            {isHostToCtrl ? t('hciDirectionHostToController') : t('hciDirectionControllerToHost')}
          </Tag>
        )
      },
    },
    {
      title: t('hciType'),
      dataIndex: 'hci_type',
      key: 'hci_type',
      width: 100,
      render: (hciType: string) => <Tag color={TYPE_COLORS[hciType] || 'default'}>{hciType}</Tag>,
    },
    {
      title: t('hciOpcode'),
      key: 'opcode',
      width: 200,
      render: (_: unknown, record: HciEntry) => {
        if (record.opcode_name) {
          return (
            <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
              0x{record.opcode?.toString(16).toUpperCase().padStart(4, '0')} ({record.opcode_name})
            </Text>
          )
        }
        if (record.event_name) {
          return (
            <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
              Evt 0x{record.event_code?.toString(16).toUpperCase().padStart(2, '0')} (
              {record.event_name})
            </Text>
          )
        }
        return '—'
      },
    },
    {
      title: t('length'),
      dataIndex: 'data_length',
      key: 'data_length',
      width: 80,
    },
    {
      title: t('info'),
      dataIndex: 'raw_summary',
      key: 'raw_summary',
      ellipsis: true,
      render: (info: string) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{info}</Text>
      ),
    },
  ]

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* Summary Cards */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('totalHciPackets')}
              value={entries.length}
              suffix={totalPackets !== entries.length ? `/ ${totalPackets}` : ''}
              styles={
                totalPackets !== entries.length
                  ? { content: { color: 'var(--ant-color-primary)' } }
                  : undefined
              }
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('hciDirectionDistribution')}
              value={
                statistics
                  ? `${(statistics.by_direction?.['HOST_TO_CONTROLLER'] ?? 0) + (statistics.by_direction?.['CONTROLLER_TO_HOST'] ?? 0)}`
                  : 0
              }
              suffix={t('hciPacketCount')}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={t('hciUniqueOpcodes')} value={statistics?.unique_opcodes ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('duration')}
              value={
                statistics?.duration_seconds != null ? statistics.duration_seconds.toFixed(2) : '—'
              }
              suffix={statistics?.duration_seconds != null ? 's' : ''}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col>
          {formatDetected && (
            <Tag>
              {t('hciFormat')}: {formatDetected}
            </Tag>
          )}
        </Col>
      </Row>

      {/* Direction Distribution */}
      {statistics && statistics.by_direction && Object.keys(statistics.by_direction).length > 0 && (
        <Card size="small" title={t('hciDirectionDistribution')} style={{ marginBottom: 12 }}>
          <Space wrap>
            {Object.entries(statistics.by_direction)
              .sort((a, b) => b[1] - a[1])
              .map(([dir, count]) => (
                <Tag key={dir} color={dir === 'HOST_TO_CONTROLLER' ? 'blue' : 'green'}>
                  {dir === 'HOST_TO_CONTROLLER'
                    ? t('hciHostToController')
                    : t('hciControllerToHost')}
                  : {count}
                </Tag>
              ))}
          </Space>
        </Card>
      )}

      {/* HCI Type Distribution */}
      {statistics && statistics.by_type && Object.keys(statistics.by_type).length > 0 && (
        <Card size="small" title={t('hciTypeDistribution')} style={{ marginBottom: 12 }}>
          <Space wrap>
            {Object.entries(statistics.by_type)
              .sort((a, b) => b[1] - a[1])
              .map(([hciType, count]) => (
                <Tag key={hciType} color={TYPE_COLORS[hciType] || 'default'}>
                  {hciType}: {count}
                </Tag>
              ))}
          </Space>
        </Card>
      )}

      {/* Packet Table */}
      <Card size="small" title={t('packets')} styles={{ body: { padding: 0 } }}>
        <div ref={packetTableWrapperRef} style={{ flex: 1, minHeight: 200, overflow: 'hidden' }}>
          <Table
            dataSource={entries}
            columns={packetColumns}
            rowKey="packet_number"
            size="small"
            pagination={false}
            scroll={{ y: packetTableHeight, x: 1200 }}
            virtual
          />
        </div>
      </Card>
    </div>
  )
}

export default HciViewer

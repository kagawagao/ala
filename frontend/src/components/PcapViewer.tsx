import React, { useEffect, useRef, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Empty,
  Row,
  Col,
  Statistic,
  Space,
} from 'antd'
import { useTranslation } from 'react-i18next'
import type { PcapEntry, PcapStatistics } from '../types/pcap'
import { getPcapStatistics } from '../api/pcap'

const { Text } = Typography

interface PcapViewerProps {
  entries: PcapEntry[]
  totalPackets: number
  formatDetected?: string
}

const PcapViewer: React.FC<PcapViewerProps> = ({ entries, totalPackets, formatDetected }) => {
  const { t } = useTranslation()

  const [statistics, setStatistics] = useState<PcapStatistics | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)

  const packetTableWrapperRef = useRef<HTMLDivElement>(null)
  const [packetTableHeight, setPacketTableHeight] = useState(400)

  // Update statistics when entries change
  useEffect(() => {
    void loadStatistics(entries)
  }, [entries])

  // Auto-resize table
  useEffect(() => {
    const el = packetTableWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPacketTableHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const loadStatistics = async (entriesToAnalyze: PcapEntry[]) => {
    if (entriesToAnalyze.length === 0) {
      setStatistics(null)
      return
    }

    setLoadingStats(true)
    try {
      const stats = await getPcapStatistics(entriesToAnalyze)
      setStatistics(stats)
    } catch (err) {
      console.error('Failed to load statistics:', err)
    } finally {
      setLoadingStats(false)
    }
  }

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
      title: t('protocol'),
      dataIndex: 'protocol',
      key: 'protocol',
      width: 90,
      render: (proto: string) => <Tag color="blue">{proto}</Tag>,
    },
    {
      title: t('source'),
      key: 'source',
      width: 180,
      render: (_: unknown, record: PcapEntry) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {record.src_ip}
          {record.src_port ? `:${record.src_port}` : ''}
        </Text>
      ),
    },
    {
      title: t('destination'),
      key: 'destination',
      width: 180,
      render: (_: unknown, record: PcapEntry) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {record.dst_ip}
          {record.dst_port ? `:${record.dst_port}` : ''}
        </Text>
      ),
    },
    {
      title: t('length'),
      dataIndex: 'length',
      key: 'length',
      width: 80,
    },
    {
      title: 'Flags',
      dataIndex: 'tcp_flags',
      key: 'tcp_flags',
      width: 120,
      render: (flags: string | null) => (flags ? <Tag color="orange">{flags}</Tag> : '—'),
    },
    {
      title: t('info'),
      dataIndex: 'info',
      key: 'info',
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
              title={t('totalPackets')}
              value={entries.length}
              suffix={totalPackets !== entries.length ? `/ ${totalPackets}` : ''}
              valueStyle={
                totalPackets !== entries.length
                  ? { color: 'var(--ant-color-primary)' }
                  : undefined
              }
              loading={loadingStats}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('uniqueIPs')}
              value={statistics?.unique_ips ?? 0}
              loading={loadingStats}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('connections')}
              value={statistics?.unique_connections ?? 0}
              loading={loadingStats}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={t('duration')}
              value={
                statistics?.duration_seconds != null
                  ? statistics.duration_seconds.toFixed(2)
                  : '—'
              }
              suffix={statistics?.duration_seconds != null ? 's' : ''}
              loading={loadingStats}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col>
          {formatDetected && <Tag>Format: {formatDetected}</Tag>}
        </Col>
      </Row>

      {/* Protocol Distribution */}
      {statistics && statistics.by_protocol && Object.keys(statistics.by_protocol).length > 0 && (
        <Card size="small" title={t('protocolDistribution')} style={{ marginBottom: 12 }}>
          <Space wrap>
            {Object.entries(statistics.by_protocol)
              .sort((a, b) => b[1] - a[1])
              .map(([proto, count]) => (
                <Tag key={proto} color="blue">
                  {proto}: {count}
                </Tag>
              ))}
          </Space>
        </Card>
      )}

      {/* Packet Table */}
      <Card size="small" title={t('packets')} styles={{ body: { padding: 0 } }}>
        <div ref={packetTableWrapperRef} style={{ height: 400, overflow: 'hidden' }}>
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

export default PcapViewer

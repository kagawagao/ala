import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Empty,
  Row,
  Col,
  Statistic,
  Input,
  Select,
  Space,
  Button,
  Spin,
  App,
} from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { PcapEntry, PcapFilters, PcapStatistics } from '../types/pcap'
import { filterPcap, getPcapStatistics } from '../api/pcap'

const { Text } = Typography

interface PcapViewerProps {
  entries: PcapEntry[]
  totalPackets: number
  formatDetected?: string
}

const PcapViewer: React.FC<PcapViewerProps> = ({ entries, totalPackets, formatDetected }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  // Filter state
  const [protocolFilter, setProtocolFilter] = useState('')
  const [srcIpFilter, setSrcIpFilter] = useState('')
  const [dstIpFilter, setDstIpFilter] = useState('')
  const [srcPortFilter, setSrcPortFilter] = useState('')
  const [dstPortFilter, setDstPortFilter] = useState('')
  const [tcpFlagsFilter, setTcpFlagsFilter] = useState('')
  const [keywordsFilter, setKeywordsFilter] = useState('')

  const [filteredEntries, setFilteredEntries] = useState<PcapEntry[]>(entries)
  const [statistics, setStatistics] = useState<PcapStatistics | null>(null)
  const [filtering, setFiltering] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)

  const packetTableWrapperRef = useRef<HTMLDivElement>(null)
  const [packetTableHeight, setPacketTableHeight] = useState(400)

  const isFiltered =
    protocolFilter ||
    srcIpFilter ||
    dstIpFilter ||
    srcPortFilter ||
    dstPortFilter ||
    tcpFlagsFilter ||
    keywordsFilter

  // Update filtered entries when source entries change
  useEffect(() => {
    setFilteredEntries(entries)
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

  const handleFilter = useCallback(async () => {
    if (entries.length === 0) return

    const filters: PcapFilters = {
      start_time: null,
      end_time: null,
      protocol: protocolFilter.trim() || null,
      src_ip: srcIpFilter.trim() || null,
      dst_ip: dstIpFilter.trim() || null,
      src_port: srcPortFilter.trim() ? parseInt(srcPortFilter.trim(), 10) : null,
      dst_port: dstPortFilter.trim() ? parseInt(dstPortFilter.trim(), 10) : null,
      tcp_flags: tcpFlagsFilter.trim() || null,
      keywords: keywordsFilter.trim() || null,
    }

    // Check if any filter is set
    const hasFilters = Object.values(filters).some((v) => v !== null)
    if (!hasFilters) {
      setFilteredEntries(entries)
      void loadStatistics(entries)
      return
    }

    setFiltering(true)
    try {
      const result = await filterPcap(entries, filters)
      setFilteredEntries(result)
      void loadStatistics(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Filter failed'
      void message.error(msg)
    } finally {
      setFiltering(false)
    }
  }, [
    entries,
    protocolFilter,
    srcIpFilter,
    dstIpFilter,
    srcPortFilter,
    dstPortFilter,
    tcpFlagsFilter,
    keywordsFilter,
    message,
  ])

  const handleReset = useCallback(() => {
    setProtocolFilter('')
    setSrcIpFilter('')
    setDstIpFilter('')
    setSrcPortFilter('')
    setDstPortFilter('')
    setTcpFlagsFilter('')
    setKeywordsFilter('')
    setFilteredEntries(entries)
    void loadStatistics(entries)
  }, [entries])

  if (entries.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('noFileLoaded')}
        style={{ marginTop: 80 }}
      />
    )
  }

  // Extract unique protocols for dropdown
  const protocols = Array.from(new Set(entries.map((e) => e.protocol))).sort()
  const protocolOptions = protocols.map((p) => ({ label: p, value: p }))

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
              value={filteredEntries.length}
              suffix={totalPackets !== filteredEntries.length ? `/ ${totalPackets}` : ''}
              valueStyle={
                totalPackets !== filteredEntries.length
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
          {isFiltered && <Tag color="blue">{t('filtered')}</Tag>}
        </Col>
      </Row>

      {/* Filter Panel */}
      <Card
        size="small"
        title={
          <Space>
            <FilterOutlined />
            {t('pcapFilters')}
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
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            <Select
              style={{ width: 120 }}
              placeholder={t('protocol')}
              options={protocolOptions}
              value={protocolFilter || undefined}
              onChange={(val) => setProtocolFilter(val || '')}
              allowClear
              showSearch
            />
            <Input
              style={{ width: 160 }}
              placeholder={t('sourceIP')}
              value={srcIpFilter}
              onChange={(e) => setSrcIpFilter(e.target.value)}
              onPressEnter={() => void handleFilter()}
              allowClear
            />
            <Input
              style={{ width: 160 }}
              placeholder={t('destinationIP')}
              value={dstIpFilter}
              onChange={(e) => setDstIpFilter(e.target.value)}
              onPressEnter={() => void handleFilter()}
              allowClear
            />
            <Input
              style={{ width: 100 }}
              placeholder={t('srcPort')}
              value={srcPortFilter}
              onChange={(e) => setSrcPortFilter(e.target.value)}
              onPressEnter={() => void handleFilter()}
              allowClear
            />
            <Input
              style={{ width: 100 }}
              placeholder={t('dstPort')}
              value={dstPortFilter}
              onChange={(e) => setDstPortFilter(e.target.value)}
              onPressEnter={() => void handleFilter()}
              allowClear
            />
          </Space>
          <Space wrap>
            <Input
              style={{ width: 140 }}
              placeholder={t('tcpFlags')}
              value={tcpFlagsFilter}
              onChange={(e) => setTcpFlagsFilter(e.target.value)}
              onPressEnter={() => void handleFilter()}
              allowClear
            />
            <Input
              style={{ width: 200 }}
              placeholder={t('keywords')}
              value={keywordsFilter}
              onChange={(e) => setKeywordsFilter(e.target.value)}
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
        </Space>
      </Card>

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
            dataSource={filteredEntries}
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

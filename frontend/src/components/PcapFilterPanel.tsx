import React, { useCallback, useState } from 'react'
import { Input, Select, Space, Button, Spin, App } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { filterPcap } from '../api/pcap'
import type { PcapEntry, PcapFilters } from '../types/pcap'

interface PcapFilterPanelProps {
  entries: PcapEntry[]
  onFilteredEntries: (entries: PcapEntry[]) => void
}

const PcapFilterPanel: React.FC<PcapFilterPanelProps> = ({ entries, onFilteredEntries }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [protocolFilter, setProtocolFilter] = useState('')
  const [srcIpFilter, setSrcIpFilter] = useState('')
  const [dstIpFilter, setDstIpFilter] = useState('')
  const [srcPortFilter, setSrcPortFilter] = useState('')
  const [dstPortFilter, setDstPortFilter] = useState('')
  const [tcpFlagsFilter, setTcpFlagsFilter] = useState('')
  const [keywordsFilter, setKeywordsFilter] = useState('')
  const [filtering, setFiltering] = useState(false)

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

    const hasFilters = Object.values(filters).some((v) => v !== null)
    if (!hasFilters) {
      onFilteredEntries(entries)
      return
    }

    setFiltering(true)
    try {
      const result = await filterPcap(entries, filters)
      onFilteredEntries(result)
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
    onFilteredEntries,
  ])

  const handleReset = useCallback(() => {
    setProtocolFilter('')
    setSrcIpFilter('')
    setDstIpFilter('')
    setSrcPortFilter('')
    setDstPortFilter('')
    setTcpFlagsFilter('')
    setKeywordsFilter('')
    onFilteredEntries(entries)
  }, [entries, onFilteredEntries])

  if (entries.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
        {t('noFileLoaded')}
      </div>
    )
  }

  const protocols = Array.from(new Set(entries.map((e) => e.protocol))).sort()
  const protocolOptions = protocols.map((p) => ({ label: p, value: p }))

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Select
          style={{ width: '100%' }}
          placeholder={t('protocol')}
          options={protocolOptions}
          value={protocolFilter || undefined}
          onChange={(val) => setProtocolFilter(val || '')}
          allowClear
          showSearch
        />
        <Input
          placeholder={t('sourceIP')}
          value={srcIpFilter}
          onChange={(e) => setSrcIpFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('destinationIP')}
          value={dstIpFilter}
          onChange={(e) => setDstIpFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Space style={{ width: '100%' }}>
          <Input
            style={{ flex: 1 }}
            placeholder={t('srcPort')}
            value={srcPortFilter}
            onChange={(e) => setSrcPortFilter(e.target.value)}
            onPressEnter={() => void handleFilter()}
            allowClear
          />
          <Input
            style={{ flex: 1 }}
            placeholder={t('dstPort')}
            value={dstPortFilter}
            onChange={(e) => setDstPortFilter(e.target.value)}
            onPressEnter={() => void handleFilter()}
            allowClear
          />
        </Space>
        <Input
          placeholder={t('tcpFlags')}
          value={tcpFlagsFilter}
          onChange={(e) => setTcpFlagsFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('keywords')}
          value={keywordsFilter}
          onChange={(e) => setKeywordsFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button
            type="primary"
            icon={filtering ? <Spin size="small" /> : <FilterOutlined />}
            onClick={() => void handleFilter()}
            disabled={filtering}
            block
          >
            {t('applyFilter')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            {t('resetFilter')}
          </Button>
        </Space>
      </Space>
    </div>
  )
}

export default PcapFilterPanel

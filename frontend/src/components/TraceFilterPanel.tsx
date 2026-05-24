import React, { useCallback, useState } from 'react'
import { Input, Select, Space, Button, Spin, App } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { filterTrace } from '../api/trace'
import type { TraceParseResult } from '../types'

interface TraceFilterPanelProps {
  traceResult: TraceParseResult | null
  onFilteredResult: (result: TraceParseResult | null) => void
}

const TraceFilterPanel: React.FC<TraceFilterPanelProps> = ({ traceResult, onFilteredResult }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [pidInput, setPidInput] = useState('')
  const [processNameFilter, setProcessNameFilter] = useState('')
  const [selectedPids, setSelectedPids] = useState<number[]>([])
  const [filtering, setFiltering] = useState(false)

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
      onFilteredResult(null)
      return
    }

    setFiltering(true)
    try {
      const result = await filterTrace({
        result: traceResult,
        pids: pids.length > 0 ? pids : undefined,
        process_name: processNameFilter.trim() || undefined,
      })
      onFilteredResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Filter failed'
      void message.error(msg)
    } finally {
      setFiltering(false)
    }
  }, [traceResult, selectedPids, pidInput, processNameFilter, message, onFilteredResult])

  const handleReset = useCallback(() => {
    setPidInput('')
    setProcessNameFilter('')
    setSelectedPids([])
    onFilteredResult(null)
  }, [onFilteredResult])

  if (!traceResult) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
        {t('noFileLoaded')}
      </div>
    )
  }

  const pidOptions = (traceResult.summary.processes ?? []).map((p) => ({
    label: `${p.pid} – ${p.name}`,
    value: p.pid,
  }))

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Select
          mode="multiple"
          style={{ width: '100%' }}
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
          placeholder={t('processNameRegex')}
          value={processNameFilter}
          onChange={(e) => setProcessNameFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('pidCommaList')}
          value={pidInput}
          onChange={(e) => setPidInput(e.target.value)}
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

export default TraceFilterPanel

import React, { useCallback, useState } from 'react'
import { Input, Select, Space, Button, Spin, App } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { filterHci } from '../api/hci'
import type { HciEntry, HciFilters } from '../types/hci'

interface HciFilterPanelProps {
  entries: HciEntry[]
  onFilteredEntries: (entries: HciEntry[]) => void
}

const DIRECTION_OPTIONS = [
  { labelKey: 'hciHostToController', value: 'HOST_TO_CONTROLLER' },
  { labelKey: 'hciControllerToHost', value: 'CONTROLLER_TO_HOST' },
]

const HCI_TYPE_OPTIONS = [
  { labelKey: 'hciTypeCommand', value: 'COMMAND' },
  { labelKey: 'hciTypeEvent', value: 'EVENT' },
  { labelKey: 'hciTypeAclData', value: 'ACL_DATA' },
  { labelKey: 'hciTypeScoData', value: 'SCO_DATA' },
  { labelKey: 'hciTypeIsoData', value: 'ISO_DATA' },
]

const HciFilterPanel: React.FC<HciFilterPanelProps> = ({ entries, onFilteredEntries }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [directionFilter, setDirectionFilter] = useState('')
  const [hciTypeFilter, setHciTypeFilter] = useState('')
  const [opcodeFilter, setOpcodeFilter] = useState('')
  const [opcodeNameFilter, setOpcodeNameFilter] = useState('')
  const [eventCodeFilter, setEventCodeFilter] = useState('')
  const [eventNameFilter, setEventNameFilter] = useState('')
  const [keywordsFilter, setKeywordsFilter] = useState('')
  const [filtering, setFiltering] = useState(false)

  const hasFilterConditions =
    !!directionFilter.trim() ||
    !!hciTypeFilter.trim() ||
    !!opcodeFilter.trim() ||
    !!opcodeNameFilter.trim() ||
    !!eventCodeFilter.trim() ||
    !!eventNameFilter.trim() ||
    !!keywordsFilter.trim()

  const handleFilter = useCallback(async () => {
    if (entries.length === 0) return

    if (!hasFilterConditions) {
      onFilteredEntries(entries)
      return
    }

    const filters: HciFilters = {
      start_time: null,
      end_time: null,
      direction: directionFilter.trim() || null,
      hci_type: hciTypeFilter.trim() || null,
      opcode: opcodeFilter.trim()
        ? (() => {
            const v = parseInt(opcodeFilter.trim(), 0)
            return isNaN(v) ? null : v
          })()
        : null,
      opcode_name: opcodeNameFilter.trim() || null,
      event_code: eventCodeFilter.trim()
        ? (() => {
            const v = parseInt(eventCodeFilter.trim(), 0)
            return isNaN(v) ? null : v
          })()
        : null,
      event_name: eventNameFilter.trim() || null,
      keywords: keywordsFilter.trim() || null,
    }

    setFiltering(true)
    try {
      const result = await filterHci(entries, filters)
      onFilteredEntries(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('hciFilterFailed')
      void message.error(msg)
    } finally {
      setFiltering(false)
    }
  }, [
    entries,
    hasFilterConditions,
    directionFilter,
    hciTypeFilter,
    opcodeFilter,
    opcodeNameFilter,
    eventCodeFilter,
    eventNameFilter,
    keywordsFilter,
    message,
    onFilteredEntries,
  ])

  const handleReset = useCallback(() => {
    setDirectionFilter('')
    setHciTypeFilter('')
    setOpcodeFilter('')
    setOpcodeNameFilter('')
    setEventCodeFilter('')
    setEventNameFilter('')
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

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Select
          style={{ width: '100%' }}
          placeholder={t('hciDirection')}
          options={DIRECTION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          value={directionFilter || undefined}
          onChange={(val) => setDirectionFilter(val || '')}
          allowClear
        />
        <Select
          style={{ width: '100%' }}
          placeholder={t('hciType')}
          options={HCI_TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          value={hciTypeFilter || undefined}
          onChange={(val) => setHciTypeFilter(val || '')}
          allowClear
        />
        <Input
          placeholder={t('hciOpcode')}
          value={opcodeFilter}
          onChange={(e) => setOpcodeFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('hciOpcodeName')}
          value={opcodeNameFilter}
          onChange={(e) => setOpcodeNameFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('hciEventCode')}
          value={eventCodeFilter}
          onChange={(e) => setEventCodeFilter(e.target.value)}
          onPressEnter={() => void handleFilter()}
          allowClear
        />
        <Input
          placeholder={t('hciEventName')}
          value={eventNameFilter}
          onChange={(e) => setEventNameFilter(e.target.value)}
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
            disabled={filtering || !hasFilterConditions}
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

export default HciFilterPanel

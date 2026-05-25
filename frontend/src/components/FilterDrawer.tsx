import React, { useState } from 'react'
import { Drawer } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  FilterPreset,
  HighlightItem,
  LogFilters,
  LogStatistics,
  TraceParseResult,
} from '../types'
import type { PcapEntry } from '../types/pcap'
import type { HciEntry } from '../types/hci'
import LogFilterPanel from './LogFilterPanel'
import PcapFilterPanel from './PcapFilterPanel'
import HciFilterPanel from './HciFilterPanel'
import TraceFilterPanel from './TraceFilterPanel'

type FilterTab = 'log' | 'trace' | 'pcap' | 'hci'

interface FilterDrawerProps {
  activeTab: FilterTab
  // Controlled open state (optional — falls back to internal state)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Log filters
  logFilters?: LogFilters
  onLogFiltersChange?: (filters: LogFilters) => void
  logStatistics?: LogStatistics | null
  highlights?: HighlightItem[]
  onHighlightsChange?: (highlights: HighlightItem[]) => void
  presets?: FilterPreset[]
  onPresetsChange?: (presets: FilterPreset[]) => void
  wordWrap?: boolean
  onWordWrapChange?: (wrap: boolean) => void
  selectedProjectId?: string | null
  // Trace filters
  traceResult?: TraceParseResult | null
  onTraceFilteredResult?: (result: TraceParseResult | null) => void
  // PCAP filters
  pcapEntries?: PcapEntry[]
  onPcapFilteredEntries?: (entries: PcapEntry[]) => void
  // HCI filters
  hciEntries?: HciEntry[]
  onHciFilteredEntries?: (entries: HciEntry[]) => void
}

const FilterDrawer: React.FC<FilterDrawerProps> = ({
  activeTab,
  open: controlledOpen,
  onOpenChange,
  logFilters,
  onLogFiltersChange,
  logStatistics,
  highlights,
  onHighlightsChange,
  presets,
  onPresetsChange,
  wordWrap,
  onWordWrapChange,
  selectedProjectId,
  traceResult,
  onTraceFilteredResult,
  pcapEntries,
  onPcapFilteredEntries,
  hciEntries,
  onHciFilteredEntries,
}) => {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v)
    } else {
      setInternalOpen(v)
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'log':
        if (
          !logFilters ||
          !onLogFiltersChange ||
          !highlights ||
          !onHighlightsChange ||
          !presets ||
          !onPresetsChange ||
          wordWrap === undefined ||
          !onWordWrapChange
        ) {
          return (
            <div
              style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}
            >
              {t('noFiltersAvailable')}
            </div>
          )
        }
        return (
          <LogFilterPanel
            filters={logFilters}
            onFiltersChange={onLogFiltersChange}
            highlights={highlights}
            onHighlightsChange={onHighlightsChange}
            statistics={logStatistics ?? null}
            presets={presets}
            onPresetsChange={onPresetsChange}
            wordWrap={wordWrap}
            onWordWrapChange={onWordWrapChange}
            selectedProjectId={selectedProjectId ?? null}
          />
        )

      case 'trace':
        if (!traceResult || !onTraceFilteredResult) {
          return (
            <div
              style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}
            >
              {t('noFiltersAvailable')}
            </div>
          )
        }
        return (
          <TraceFilterPanel traceResult={traceResult} onFilteredResult={onTraceFilteredResult} />
        )

      case 'pcap':
        if (!pcapEntries || !onPcapFilteredEntries) {
          return (
            <div
              style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}
            >
              {t('noFiltersAvailable')}
            </div>
          )
        }
        return <PcapFilterPanel entries={pcapEntries} onFilteredEntries={onPcapFilteredEntries} />

      case 'hci':
        if (!hciEntries || !onHciFilteredEntries) {
          return (
            <div
              style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}
            >
              {t('noFiltersAvailable')}
            </div>
          )
        }
        return <HciFilterPanel entries={hciEntries} onFilteredEntries={onHciFilteredEntries} />

      default:
        return (
          <div
            style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}
          >
            {t('noFiltersAvailable')}
          </div>
        )
    }
  }

  const getTitle = () => {
    switch (activeTab) {
      case 'log':
        return t('logFilters')
      case 'trace':
        return t('traceFilters')
      case 'pcap':
        return t('pcapFilters')
      case 'hci':
        return t('hciFilters')
      default:
        return t('filters')
    }
  }

  return (
    <Drawer
      title={getTitle()}
      placement="right"
      maxSize={800}
      size={'50%'}
      open={open}
      onClose={() => setOpen(false)}
      styles={{ body: { padding: 0 } }}
    >
      {renderContent()}
    </Drawer>
  )
}

export default FilterDrawer

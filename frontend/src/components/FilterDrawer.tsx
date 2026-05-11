import React, { useEffect, useState } from 'react'
import { Drawer } from 'antd'
import { useTranslation } from 'react-i18next'
import LogFilterPanel from './LogFilterPanel'
import TraceFilterPanel from './TraceFilterPanel'
import PcapFilterPanel from './PcapFilterPanel'
import type { LogFilters, LogStatistics, FilterPreset, HighlightItem } from '../types'
import type { PcapEntry } from '../types/pcap'
import type { TraceParseResult } from '../types'

interface FilterDrawerProps {
  activeTab: string
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
}

const FilterDrawer: React.FC<FilterDrawerProps> = ({
  activeTab,
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
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Keyboard shortcut: Ctrl+Shift+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

      default:
        return (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
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
      default:
        return t('filters')
    }
  }

  return (
    <Drawer
      title={getTitle()}
      placement="right"
      width={320}
      open={open}
      onClose={() => setOpen(false)}
      styles={{ body: { padding: 0 } }}
    >
      {renderContent()}
    </Drawer>
  )
}

export default FilterDrawer

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Button,
  Input,
  Select,
  Space,
  Collapse,
  Typography,
  Divider,
  Tag,
  Popconfirm,
  Modal,
  Form,
  Radio,
  Statistic,
  Row,
  Col,
  Tooltip,
  message,
} from 'antd'
import {
  FilterOutlined,
  ClearOutlined,
  SaveOutlined,
  FolderOpenOutlined,
  DownloadOutlined,
  UploadOutlined,
  DeleteOutlined,
  CheckOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { LogFilters, LogStatistics, FilterPreset, HighlightItem } from '../types'
import { generateFilters } from '../api/projects'

const { Text } = Typography

const LEVEL_COLORS: Record<string, string> = {
  V: 'default',
  D: 'processing',
  I: 'success',
  W: 'warning',
  E: 'error',
  F: 'magenta',
}

const HIGHLIGHT_COLORS = [
  '#fadb14',
  '#52c41a',
  '#1677ff',
  '#fa8c16',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
]

interface AppSiderProps {
  filters: LogFilters
  onFiltersChange: (filters: LogFilters) => void
  highlights: HighlightItem[]
  onHighlightsChange: (highlights: HighlightItem[]) => void
  statistics: LogStatistics | null
  presets: FilterPreset[]
  onPresetsChange: (presets: FilterPreset[]) => void
  wordWrap: boolean
  onWordWrapChange: (wrap: boolean) => void
  selectedProjectId: string | null
}

const AppSider: React.FC<AppSiderProps> = ({
  filters,
  onFiltersChange,
  highlights,
  onHighlightsChange,
  statistics,
  presets,
  onPresetsChange,
  wordWrap,
  onWordWrapChange,
  selectedProjectId,
}) => {
  const { t } = useTranslation()
  const [presetModalOpen, setPresetModalOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetDesc, setPresetDesc] = useState('')
  const [highlightInput, setHighlightInput] = useState('')
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [generatingFilters, setGeneratingFilters] = useState(false)

  // Local "draft" state – changes here are NOT applied to the log view until
  // the user clicks the Apply button.
  const [pendingFilters, setPendingFilters] = useState<LogFilters>(filters)

  // Sync pendingFilters when applied filters change externally (e.g. file reload
  // resets to DEFAULT_FILTERS, or a preset is applied).
  useEffect(() => {
    setPendingFilters(filters)
  }, [filters])

  // True when the draft differs from the currently applied filters.
  const isDirty = useMemo(
    () =>
      (Object.keys(pendingFilters) as Array<keyof LogFilters>).some(
        (k) => pendingFilters[k] !== filters[k],
      ),
    [pendingFilters, filters],
  )

  const updatePending = useCallback(
    (partial: Partial<LogFilters>) => setPendingFilters((prev) => ({ ...prev, ...partial })),
    [],
  )

  const applyFilters = useCallback(() => {
    onFiltersChange(pendingFilters)
  }, [onFiltersChange, pendingFilters])

  const clearFilters = useCallback(() => {
    const defaults: LogFilters = {
      start_time: '',
      end_time: '',
      keywords: '',
      level: '',
      tag: '',
      pid: '',
      tid: '',
      tag_keyword_relation: 'AND',
    }
    setPendingFilters(defaults)
    onFiltersChange(defaults)
  }, [onFiltersChange])

  const savePreset = () => {
    if (!presetName.trim()) return
    const preset: FilterPreset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      description: presetDesc.trim() || undefined,
      filters: { ...pendingFilters },
    }
    const updated = [...presets, preset]
    onPresetsChange(updated)
    localStorage.setItem('ala_filter_presets', JSON.stringify(updated))
    setPresetModalOpen(false)
    setPresetName('')
    setPresetDesc('')
    void message.success(t('savePreset'))
  }

  const deletePreset = (id: string) => {
    const updated = presets.filter((p) => p.id !== id)
    onPresetsChange(updated)
    localStorage.setItem('ala_filter_presets', JSON.stringify(updated))
  }

  const applyPreset = (preset: FilterPreset) => {
    // Applying a preset is an explicit user action → apply immediately.
    setPendingFilters(preset.filters)
    onFiltersChange(preset.filters)
  }

  const exportFilters = () => {
    const blob = new Blob([JSON.stringify({ filters: pendingFilters, highlights }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ala-filters.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importFilters = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string)
          // Import into pending state and apply immediately
          if (data.filters) {
            setPendingFilters(data.filters as LogFilters)
            onFiltersChange(data.filters as LogFilters)
          }
          if (data.highlights) onHighlightsChange(data.highlights)
          void message.success(t('fileUploaded'))
        } catch {
          void message.error(t('parseError'))
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleGenerateFilters = async () => {
    if (!selectedProjectId) return
    setGeneratingFilters(true)
    try {
      let accumulated = ''
      for await (const chunk of generateFilters(selectedProjectId, presets)) {
        if (chunk === '[DONE]') break
        accumulated += chunk
      }
      // Try to parse JSON array from accumulated text
      let generated: Array<{
        name: string
        description?: string
        filters: Partial<LogFilters>
      }> | null = null
      try {
        const parsed: unknown = JSON.parse(accumulated.trim())
        if (Array.isArray(parsed)) generated = parsed
      } catch {
        // Fallback: extract JSON array via regex
        const jsonMatch = accumulated.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          generated = JSON.parse(jsonMatch[0])
        }
      }
      if (generated && generated.length > 0) {
        const newPresets: FilterPreset[] = generated.map((g, i) => ({
          id: `gen-${Date.now()}-${i}`,
          name: g.name,
          description: g.description,
          filters: {
            start_time: '',
            end_time: '',
            keywords: g.filters.keywords || '',
            level: g.filters.level || '',
            tag: g.filters.tag || '',
            pid: g.filters.pid || '',
            tid: g.filters.tid || '',
            tag_keyword_relation: g.filters.tag_keyword_relation || 'AND',
          },
        }))
        const updated = [...presets, ...newPresets]
        onPresetsChange(updated)
        localStorage.setItem('ala_filter_presets', JSON.stringify(updated))
        void message.success(t('filtersGenerated'))
      } else {
        void message.error(t('filtersGenerateFailed'))
      }
    } catch {
      void message.error(t('filtersGenerateFailed'))
    } finally {
      setGeneratingFilters(false)
    }
  }

  const addHighlight = () => {
    if (!highlightInput.trim()) return
    const item: HighlightItem = { pattern: highlightInput.trim(), color: highlightColor }
    onHighlightsChange([...highlights, item])
    setHighlightInput('')
  }

  const removeHighlight = (idx: number) => {
    onHighlightsChange(highlights.filter((_, i) => i !== idx))
  }

  const topTags = statistics
    ? Object.entries(statistics.tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : []

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '8px 0' }}>
      {/* Toolbar */}
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Tooltip title={t('applyFilters')}>
          <Button
            size="small"
            type={isDirty ? 'primary' : 'default'}
            icon={<FilterOutlined />}
            onClick={applyFilters}
          >
            {t('applyFilters')}
          </Button>
        </Tooltip>
        <Tooltip title={t('clearFilters')}>
          <Button size="small" icon={<ClearOutlined />} onClick={clearFilters} />
        </Tooltip>
        <Tooltip title={t('savePreset')}>
          <Button size="small" icon={<SaveOutlined />} onClick={() => setPresetModalOpen(true)} />
        </Tooltip>
        <Tooltip title={t('exportFilters')}>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportFilters} />
        </Tooltip>
        <Tooltip title={t('importFilters')}>
          <Button size="small" icon={<UploadOutlined />} onClick={importFilters} />
        </Tooltip>
      </div>
      {selectedProjectId && (
        <div style={{ padding: '0 12px 8px' }}>
          <Button
            size="small"
            block
            icon={<ThunderboltOutlined />}
            onClick={() => void handleGenerateFilters()}
            loading={generatingFilters}
          >
            {presets.length > 0 ? t('updateFilters') : t('initFilters')}
          </Button>
        </div>
      )}
      {isDirty && (
        <div style={{ padding: '0 12px 6px' }}>
          <Text type="warning" style={{ fontSize: 11 }}>
            {t('filtersPendingChanges')}
          </Text>
        </div>
      )}

      <Collapse
        defaultActiveKey={['filters', 'highlights', 'display']}
        bordered={false}
        size="small"
        ghost
        items={[
          {
            key: 'filters',
            label: (
              <Text strong>
                <FilterOutlined /> {t('search')}
              </Text>
            ),
            children: (
              <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('startTime')}
                  </Text>
                  <Input
                    size="small"
                    placeholder="MM-DD HH:mm:ss.SSS"
                    value={pendingFilters.start_time}
                    onChange={(e) => updatePending({ start_time: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('endTime')}
                  </Text>
                  <Input
                    size="small"
                    placeholder="MM-DD HH:mm:ss.SSS"
                    value={pendingFilters.end_time}
                    onChange={(e) => updatePending({ end_time: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('keywords')}
                  </Text>
                  <Input
                    size="small"
                    placeholder={t('keywordsPlaceholder')}
                    value={pendingFilters.keywords}
                    onChange={(e) => updatePending({ keywords: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('logLevel')}
                  </Text>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={pendingFilters.level || ''}
                    onChange={(v) => updatePending({ level: v })}
                    options={[
                      { value: '', label: t('allLevels') },
                      { value: 'V', label: <Tag color="default">V {t('verbose')}</Tag> },
                      { value: 'D', label: <Tag color="blue">D {t('debug')}</Tag> },
                      { value: 'I', label: <Tag color="green">I {t('info')}</Tag> },
                      { value: 'W', label: <Tag color="orange">W {t('warning')}</Tag> },
                      { value: 'E', label: <Tag color="red">E {t('error')}</Tag> },
                      { value: 'F', label: <Tag color="magenta">F {t('fatal')}</Tag> },
                    ]}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('tag')}
                  </Text>
                  <Input
                    size="small"
                    placeholder={t('tagPlaceholder')}
                    value={pendingFilters.tag}
                    onChange={(e) => updatePending({ tag: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('pid')}
                  </Text>
                  <Input
                    size="small"
                    placeholder={t('pidPlaceholder')}
                    value={pendingFilters.pid}
                    onChange={(e) => updatePending({ pid: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('tid')}
                  </Text>
                  <Input
                    size="small"
                    placeholder={t('tidPlaceholder')}
                    value={pendingFilters.tid}
                    onChange={(e) => updatePending({ tid: e.target.value })}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('tagKeywordRelation')}
                  </Text>
                  <Radio.Group
                    size="small"
                    value={pendingFilters.tag_keyword_relation}
                    onChange={(e) => updatePending({ tag_keyword_relation: e.target.value })}
                    buttonStyle="solid"
                    style={{ display: 'flex' }}
                  >
                    <Radio.Button value="AND" style={{ flex: 1, textAlign: 'center' }}>
                      AND
                    </Radio.Button>
                    <Radio.Button value="OR" style={{ flex: 1, textAlign: 'center' }}>
                      OR
                    </Radio.Button>
                  </Radio.Group>
                </div>
              </Space>
            ),
          },
          {
            key: 'highlights',
            label: <Text strong>{t('highlights')}</Text>,
            children: (
              <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Input
                    size="small"
                    placeholder={t('highlightsPlaceholder')}
                    value={highlightInput}
                    onChange={(e) => setHighlightInput(e.target.value)}
                    onPressEnter={addHighlight}
                    style={{ flex: 1 }}
                  />
                  <Button size="small" icon={<CheckOutlined />} onClick={addHighlight} />
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {HIGHLIGHT_COLORS.map((c) => (
                    <div
                      key={c}
                      onClick={() => setHighlightColor(c)}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        background: c,
                        cursor: 'pointer',
                        border:
                          highlightColor === c ? '2px solid #1677ff' : '2px solid transparent',
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {highlights.map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          background: h.color,
                          flexShrink: 0,
                        }}
                      />
                      <Text
                        style={{
                          flex: 1,
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h.pattern}
                      </Text>
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => removeHighlight(i)}
                        style={{ padding: 0 }}
                      />
                    </div>
                  ))}
                </div>
              </Space>
            ),
          },
          {
            key: 'display',
            label: <Text strong>{t('lineBreakMode')}</Text>,
            children: (
              <Radio.Group
                size="small"
                value={wordWrap ? 'wrap' : 'nowrap'}
                onChange={(e) => onWordWrapChange(e.target.value === 'wrap')}
                buttonStyle="solid"
                style={{ display: 'flex' }}
              >
                <Radio.Button value="wrap" style={{ flex: 1, textAlign: 'center' }}>
                  {t('wordWrap')}
                </Radio.Button>
                <Radio.Button value="nowrap" style={{ flex: 1, textAlign: 'center' }}>
                  {t('noWrap')}
                </Radio.Button>
              </Radio.Group>
            ),
          },
          {
            key: 'presets',
            label: (
              <Text strong>
                <FolderOpenOutlined /> {t('filterPresets')}
              </Text>
            ),
            children:
              presets.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('noPresets')}
                </Text>
              ) : (
                <Space orientation="vertical" style={{ width: '100%' }} size={4}>
                  {presets.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--ant-color-border)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</Text>
                        {p.description && (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                            {p.description}
                          </Text>
                        )}
                      </div>
                      <Button
                        size="small"
                        type="link"
                        style={{ padding: 0 }}
                        onClick={() => applyPreset(p)}
                      >
                        {t('apply')}
                      </Button>
                      <Popconfirm
                        title={t('deleteConfirm')}
                        onConfirm={() => deletePreset(p.id)}
                        okText={t('delete')}
                        cancelText={t('cancel')}
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          danger
                          style={{ padding: 0 }}
                        />
                      </Popconfirm>
                    </div>
                  ))}
                </Space>
              ),
          },
          ...(statistics
            ? [
                {
                  key: 'stats',
                  label: <Text strong>{t('statistics')}</Text>,
                  children: (
                    <>
                      <Row gutter={8} style={{ marginBottom: 8 }}>
                        <Col span={12}>
                          <Statistic
                            title={t('totalLogs')}
                            value={statistics.total}
                            valueStyle={{ fontSize: 16 }}
                          />
                        </Col>
                      </Row>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {Object.entries(statistics.by_level).map(([lvl, cnt]) => (
                          <Tag key={lvl} color={LEVEL_COLORS[lvl] || 'default'}>
                            {lvl}: {cnt}
                          </Tag>
                        ))}
                      </div>
                      {topTags.length > 0 && (
                        <>
                          <Divider style={{ margin: '6px 0' }} />
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Top Tags
                          </Text>
                          <div style={{ marginTop: 4 }}>
                            {topTags.map(([tag, cnt]) => (
                              <div
                                key={tag}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: 12,
                                  padding: '1px 0',
                                }}
                              >
                                <Text
                                  style={{
                                    maxWidth: 160,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={tag}
                                >
                                  {tag}
                                </Text>
                                <Text type="secondary">{cnt}</Text>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />

      {/* Save Preset Modal */}
      <Modal
        title={t('filterPresetManager')}
        open={presetModalOpen}
        onOk={savePreset}
        onCancel={() => setPresetModalOpen(false)}
        okText={t('savePreset')}
        cancelText={t('cancel')}
        width={360}
      >
        <Form layout="vertical" size="small">
          <Form.Item label={t('presetName')} required>
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={t('presetName')}
            />
          </Form.Item>
          <Form.Item label={t('presetDescription')}>
            <Input
              value={presetDesc}
              onChange={(e) => setPresetDesc(e.target.value)}
              placeholder={t('presetDescription')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AppSider

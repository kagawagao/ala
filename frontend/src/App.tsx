import { UploadOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntApp,
  Button,
  ConfigProvider,
  Empty,
  Popover,
  Splitter,
  Tabs,
  theme,
  Tooltip,
  Typography,
} from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation } from 'react-router-dom'
import { updateConfig } from './api/config'
import { parseLogStream } from './api/logs'
import {
  getProjectPresets,
  listContextDocs,
  listProjects,
  updateProjectPresets,
} from './api/projects'
import { parseTrace } from './api/trace'
import AiPanel from './components/AiPanel'
import AppSider from './components/AppSider'
import FileUpload from './components/FileUpload'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import ModelManager from './components/ModelManager'
import ProjectManager from './components/ProjectManager'
import TraceViewer from './components/TraceViewer'
import { useLogStream } from './hooks/useLogStream'
import i18next from './i18n/config'
import type {
  AIConfig,
  ContextDoc,
  FilterPreset,
  HighlightItem,
  LogEntry,
  LogFilters,
  LogStatistics,
  Project,
  TraceParseResult,
} from './types'
import { hasFilterConditions } from './utils/filters'
import { getActiveAIConfig, migrateFromLegacyConfig } from './utils/models'

const DEFAULT_FILTERS: LogFilters = {
  start_time: '',
  end_time: '',
  keywords: '',
  level: '',
  tag: '',
  pid: '',
  tid: '',
  tag_keyword_relation: 'AND',
}

function applyFiltersClient(logs: LogEntry[], filters: LogFilters): LogEntry[] {
  let result = logs

  if (filters.start_time) {
    result = result.filter((l) => !l.timestamp || l.timestamp >= filters.start_time)
  }
  if (filters.end_time) {
    result = result.filter((l) => !l.timestamp || l.timestamp <= filters.end_time)
  }
  if (filters.level) {
    result = result.filter((l) => l.level === filters.level)
  }
  if (filters.pid) {
    result = result.filter((l) => l.pid === filters.pid)
  }
  if (filters.tid) {
    result = result.filter((l) => l.tid === filters.tid)
  }

  const hasKeyword = filters.keywords.trim() !== ''
  const hasTag = filters.tag.trim() !== ''

  if (hasKeyword || hasTag) {
    let keywordRe: RegExp | null = null
    let tagRe: RegExp | null = null

    if (hasKeyword) {
      try {
        keywordRe = new RegExp(filters.keywords, 'i')
      } catch {
        keywordRe = null
      }
    }
    if (hasTag) {
      try {
        tagRe = new RegExp(filters.tag, 'i')
      } catch {
        tagRe = null
      }
    }

    result = result.filter((l) => {
      const matchesKeyword = keywordRe
        ? keywordRe.test(l.message) || keywordRe.test(l.raw_line)
        : false
      const matchesTag = tagRe ? tagRe.test(l.tag) : false

      if (hasKeyword && hasTag) {
        return filters.tag_keyword_relation === 'AND'
          ? matchesKeyword && matchesTag
          : matchesKeyword || matchesTag
      }
      if (hasKeyword) return matchesKeyword
      if (hasTag) return matchesTag
      return true
    })
  }

  return result
}

function computeStatistics(logs: LogEntry[]): LogStatistics {
  const by_level: Record<string, number> = {}
  const tags: Record<string, number> = {}
  const pids: Record<string, number> = {}

  for (const log of logs) {
    by_level[log.level] = (by_level[log.level] || 0) + 1
    tags[log.tag] = (tags[log.tag] || 0) + 1
    if (log.pid) pids[log.pid] = (pids[log.pid] || 0) + 1
  }

  return { total: logs.length, by_level, tags, pids }
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const AppContent: React.FC<{
  isDark: boolean
  onToggleTheme: () => void
}> = ({ isDark, onToggleTheme }) => {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()

  const [language, setLanguage] = useState(() => localStorage.getItem('ala_language') || 'en')
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false)
  const [backendConnected, setBackendConnected] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [activeTab, setActiveTab] = useState<'log' | 'trace'>('log')

  // Project state (lifted here so Header and AiPanel share it)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    // Restore last selected project on page load
    return localStorage.getItem('ala_last_project_id') || null
  })
  const [contextDocs, setContextDocs] = useState<ContextDoc[]>([])
  const [localFilePath, setLocalFilePath] = useState<string | null>(null) // FEAT-LAZY-LOG

  const location = useLocation()
  const isFullPage = location.pathname === '/projects' || location.pathname === '/models'

  // Ref to avoid stale closure in the project-loading effect
  const selectedProjectIdRef = useRef(selectedProjectId)
  selectedProjectIdRef.current = selectedProjectId

  // Load projects on mount, when backend connects, and when navigating away from /projects
  useEffect(() => {
    if (!backendConnected) return
    listProjects()
      .then((loaded) => {
        setProjects(loaded)
        // Clear saved project selection if it no longer exists
        const current = selectedProjectIdRef.current
        if (
          current &&
          loaded.length > 0 &&
          !loaded.some((p) => p.id === current)
        ) {
          setSelectedProjectId(null)
          localStorage.removeItem('ala_last_project_id')
        }
      })
      .catch(() => {
        /* backend may not be running */
      })
  }, [backendConnected, isFullPage])

  // Load context docs when project changes
  useEffect(() => {
    if (selectedProjectId) {
      listContextDocs(selectedProjectId)
        .then(setContextDocs)
        .catch(() => setContextDocs([]))
    } else {
      setContextDocs([])
    }
  }, [selectedProjectId])

  // File state
  // allLogs is built incrementally as the stream arrives
  const {
    allLogs,
    loading: loadingFile,
    error: fileError,
    fileNames,
    formatDetected,
    loadFromStream,
    abort: abortParse,
    reset: resetLogs,
  } = useLogStream()
  const [traceResult, setTraceResult] = useState<TraceParseResult | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | undefined>()

  // Clear stale localFilePath when data source changes
  useEffect(() => {
    setLocalFilePath(null)
  }, [traceResult, selectedProjectId])

  // Filter/display state
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS)
  const [highlights, setHighlights] = useState<HighlightItem[]>([])
  const [wordWrap, setWordWrap] = useState(false)
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ala_filter_presets') || '[]') as FilterPreset[]
    } catch {
      return []
    }
  })

  // Load presets from project when selectedProjectId changes
  useEffect(() => {
    if (selectedProjectId) {
      getProjectPresets(selectedProjectId)
        .then(setPresets)
        .catch(() => setPresets([]))
    } else {
      // No project selected — load global presets from localStorage
      try {
        setPresets(JSON.parse(localStorage.getItem('ala_filter_presets') || '[]') as FilterPreset[])
      } catch {
        setPresets([])
      }
    }
  }, [selectedProjectId])

  // Preset change handler: routes to API (project) or localStorage (global)
  const handlePresetsChange = useCallback(
    (updated: FilterPreset[]) => {
      setPresets(updated)
      if (selectedProjectId) {
        updateProjectPresets(selectedProjectId, updated).catch(() => {
          /* ignore */
        })
      } else {
        localStorage.setItem('ala_filter_presets', JSON.stringify(updated))
      }
    },
    [selectedProjectId],
  )

  const debouncedFilters = useDebouncedValue(filters, 300)

  const filteredLogs = useMemo(
    () => applyFiltersClient(allLogs, debouncedFilters),
    [allLogs, debouncedFilters],
  )

  const hasActiveFilters = useMemo(() => hasFilterConditions(filters), [filters])

  const statistics = useMemo(
    () => (allLogs.length > 0 ? computeStatistics(filteredLogs) : null),
    [allLogs, filteredLogs],
  )

  // Check backend connectivity
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/health', { signal: AbortSignal.timeout(3000) })
        setBackendConnected(res.ok)
      } catch {
        setBackendConnected(false)
      }
    }
    void check()
    const interval = setInterval(() => {
      void check()
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  // Derive AI config from the active model's per-model config.
  // Runs on startup (with or without backend) and whenever backendConnected changes.
  useEffect(() => {
    migrateFromLegacyConfig()
    const active = getActiveAIConfig()
    if (active?.config.api_key) {
      setAiConfigured(true)
      setAiConfig(active.config)
      if (backendConnected) {
        void updateConfig(active.config)
      }
    } else {
      setAiConfigured(false)
      setAiConfig(null)
    }
  }, [backendConnected])

  // Re-derive AI config when navigating away from the models page
  // (user may have configured / changed the active model there).
  useEffect(() => {
    if (!isFullPage) {
      const active = getActiveAIConfig()
      setAiConfigured(!!active?.config.api_key)
      setAiConfig(active?.config ?? null)
      if (active?.config.api_key && backendConnected) {
        void updateConfig(active.config)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullPage])

  const handleToggleLanguage = useCallback(() => {
    setLanguage((lang) => {
      const next = lang === 'en' ? 'zh' : 'en'
      localStorage.setItem('ala_language', next)
      void i18next.changeLanguage(next)
      return next
    })
  }, [])

  const handleProjectChange = useCallback(
    (projectId: string | null) => {
      // Persist last selected project
      if (projectId) {
        localStorage.setItem('ala_last_project_id', projectId)
      } else {
        localStorage.removeItem('ala_last_project_id')
      }
      // Abort any in-flight log parse before clearing state
      abortParse()
      setLocalFilePath(null)
      // Reset all file / log / trace state so the new project starts clean
      resetLogs()
      setTraceResult(null)
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')
      setSelectedProjectId(projectId)
    },
    [abortParse, resetLogs],
  )

  const handleLogFiles = useCallback(
    async (files: File[]) => {
      setLocalFilePath(null)
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')

      const ok = await loadFromStream(
        (signal) => parseLogStream(files, signal),
        files.map((f) => f.name),
      )
      if (ok) void message.success(t('fileUploaded'))
    },
    [loadFromStream, t, message],
  )

  const handleTraceFile = useCallback(
    async (file: File) => {
      setTraceLoading(true)
      setTraceError(undefined)
      try {
        const result = await parseTrace(file)
        setTraceResult(result)
        setActiveTab('trace')
        void message.success(t('fileUploaded'))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('parseError')
        setTraceError(msg)
        void message.error(msg)
      } finally {
        setTraceLoading(false)
      }
    },
    [t, message],
  )

  const showFileUpload = allLogs.length === 0 && !traceResult

  const isLoading = loadingFile || traceLoading
  const errorMessage = fileError || traceError

  // Upload popover content – compact FileUpload dragger always accessible from
  // the tab bar, even after files have already been loaded.
  const uploadPopoverContent = (
    <div style={{ width: 300 }}>
      <FileUpload
        onLogFiles={(files) => {
          void handleLogFiles(files)
          setUploadPopoverOpen(false)
        }}
        onTraceFile={(f) => {
          void handleTraceFile(f)
          setUploadPopoverOpen(false)
        }}
        onLocalFilePath={(_path, ref) => {
          setLocalFilePath(ref.session_file)
          setUploadPopoverOpen(false)
          void message.success(t('fileUploaded'))
        }}
        loading={isLoading}
        error={errorMessage}
        fileNames={fileNames}
      />
    </div>
  )

  const tabBarExtra = (
    <div style={{ paddingRight: 8 }}>
      <Popover
        content={uploadPopoverContent}
        open={uploadPopoverOpen}
        onOpenChange={setUploadPopoverOpen}
        trigger="click"
        placement="bottomRight"
      >
        <Tooltip title={fileNames.length > 0 ? t('changeFiles') : t('uploadFiles')}>
          <Button size="small" icon={<UploadOutlined />} loading={isLoading}>
            {fileNames.length > 0 ? t('changeFiles') : t('uploadFiles')}
          </Button>
        </Tooltip>
      </Popover>
    </div>
  )

  const tabItems = [
    {
      key: 'log',
      label: t('logAnalysis'),
      children: showFileUpload ? (
        <FileUpload
          onLogFiles={(files) => {
            void handleLogFiles(files)
          }}
          onTraceFile={(f) => {
            void handleTraceFile(f)
          }}
          onLocalFilePath={(_path, ref) => {
            setLocalFilePath(ref.session_file)
            void message.success(t('fileUploaded'))
          }}
          loading={isLoading}
          error={errorMessage}
          fileNames={fileNames}
        />
      ) : !hasActiveFilters ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 32,
          }}
        >
          <Empty description={t('noFilterApplied')} />
          <Typography.Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
            {t('applyFiltersToView')}
          </Typography.Text>
        </div>
      ) : (
        <LogViewer
          logs={filteredLogs}
          totalLogs={allLogs.length}
          highlights={highlights}
          wordWrap={wordWrap}
          formatDetected={formatDetected}
        />
      ),
    },
    {
      key: 'trace',
      label: t('traceAnalysis'),
      children: <TraceViewer traceResult={traceResult} />,
    },
  ]

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ant-color-bg-layout)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Header
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        siderCollapsed={siderCollapsed}
        onToggleSider={() => setSiderCollapsed((v) => !v)}
        backendConnected={backendConnected}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={handleProjectChange}
      />

      {/* Backend warning */}
      {!backendConnected && (
        <Alert
          type="warning"
          title={t('backendNotConnected')}
          banner
          closable
          style={{ flexShrink: 0 }}
        />
      )}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          overflow: isFullPage ? 'auto' : 'hidden',
          position: 'relative',
        }}
      >
        <Routes>
          <Route path="/projects" element={<ProjectManager />} />
          <Route path="/models" element={<ModelManager />} />
          <Route
            path="*"
            element={
              <>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                  }}
                >
                  {/* Left: AppSider */}
                  <div
                    style={{
                      width: siderCollapsed ? 0 : 340,
                      minWidth: siderCollapsed ? 0 : 240,
                      maxWidth: 500,
                      borderRight: siderCollapsed ? 'none' : '1px solid var(--ant-color-border)',
                      overflow: 'hidden',
                      transition: 'width 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    {!siderCollapsed && (
                      <AppSider
                        filters={filters}
                        onFiltersChange={setFilters}
                        highlights={highlights}
                        onHighlightsChange={setHighlights}
                        statistics={statistics}
                        presets={presets}
                        onPresetsChange={handlePresetsChange}
                        wordWrap={wordWrap}
                        onWordWrapChange={setWordWrap}
                        selectedProjectId={selectedProjectId}
                      />
                    )}
                  </div>

                  {/* Center + Right: Splitter for Log viewer and AI panel */}
                  <Splitter style={{ flex: 1, height: '100%' }}>
                    {/* Center: Log/Trace viewer */}
                    <Splitter.Panel style={{ overflow: 'hidden', minWidth: 300 }}>
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Tabs
                          activeKey={activeTab}
                          onChange={(k) => setActiveTab(k as 'log' | 'trace')}
                          items={tabItems}
                          tabBarExtraContent={{ right: tabBarExtra }}
                          style={{ height: '100%' }}
                          tabBarStyle={{ margin: 0, padding: '0 12px', flexShrink: 0 }}
                          renderTabBar={(props, DefaultTabBar) => (
                            <DefaultTabBar {...props} style={{ marginBottom: 0 }} />
                          )}
                        />
                      </div>
                    </Splitter.Panel>

                    {/* Right: AI Panel */}
                    {!aiPanelCollapsed && (
                      <Splitter.Panel
                        defaultSize={520}
                        min={320}
                        max={'50%'}
                        style={{
                          borderLeft: '1px solid var(--ant-color-border)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              padding: '2px 6px',
                              borderBottom: '1px solid var(--ant-color-border)',
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                cursor: 'pointer',
                                fontSize: 11,
                                color: 'var(--ant-color-text-secondary)',
                              }}
                              onClick={() => setAiPanelCollapsed(true)}
                            >
                              ✕
                            </span>
                          </div>
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            <AiPanel
                              logs={filteredLogs}
                              allLogs={allLogs}
                              totalLogs={allLogs.length}
                              filters={filters}
                              traceResult={traceResult}
                              aiConfigured={aiConfigured}
                              selectedProjectId={selectedProjectId}
                              projects={projects}
                              contextDocs={contextDocs}
                              localFilePath={localFilePath}
                              aiConfig={aiConfig ?? undefined}
                            />
                          </div>
                        </div>
                      </Splitter.Panel>
                    )}
                  </Splitter>
                </div>

                {/* AI panel toggle when collapsed */}
                {aiPanelCollapsed && (
                  <button
                    onClick={() => setAiPanelCollapsed(false)}
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      writingMode: 'vertical-rl',
                      padding: '8px 4px',
                      border: '1px solid var(--ant-color-border)',
                      borderRight: 'none',
                      borderRadius: '6px 0 0 6px',
                      background: 'var(--ant-color-bg-container)',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {t('aiAssistant')}
                  </button>
                )}
              </>
            }
          />
        </Routes>
      </div>
    </div>
  )
}

const App: React.FC = () => {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('ala_theme') === 'dark')

  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#ffffff'
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])

  const handleToggleTheme = useCallback(() => {
    setIsDark((v) => {
      const next = !v
      localStorage.setItem('ala_theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { borderRadius: 6 },
      }}
    >
      <AntApp style={{ height: '100%' }}>
        <AppContent isDark={isDark} onToggleTheme={handleToggleTheme} />
      </AntApp>
    </ConfigProvider>
  )
}

export default App

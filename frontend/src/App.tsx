import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ConfigProvider,
  theme,
  Tabs,
  Alert,
  Splitter,
  message,
  App as AntApp,
  Popover,
  Button,
  Tooltip,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Routes, Route, useLocation } from 'react-router-dom'
import i18next from './i18n/config'
import Header from './components/Header'
import AppSider from './components/AppSider'
import LogViewer from './components/LogViewer'
import TraceViewer from './components/TraceViewer'
import AiPanel from './components/AiPanel'
import SettingsModal from './components/SettingsModal'
import FileUpload from './components/FileUpload'
import ProjectManager from './components/ProjectManager'
import { parseLogStream, parseDirectoryStream } from './api/logs'
import { parseTrace } from './api/trace'
import { listProjects, listContextDocs } from './api/projects'
import type {
  LogEntry,
  LogFilters,
  LogStatistics,
  TraceParseResult,
  FilterPreset,
  HighlightItem,
  Project,
  ContextDoc,
} from './types'

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

const App: React.FC = () => {
  const { t } = useTranslation()
  const [isDark, setIsDark] = useState(() => localStorage.getItem('ala_theme') === 'dark')

  // Sync body background and color-scheme so the browser chrome (scrollbars,
  // form controls) also respects the selected theme.
  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#ffffff'
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])
  const [language, setLanguage] = useState(() => localStorage.getItem('ala_language') || 'en')
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backendConnected, setBackendConnected] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [activeTab, setActiveTab] = useState<'log' | 'trace'>('log')

  // Project state (lifted here so Header and AiPanel share it)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [contextDocs, setContextDocs] = useState<ContextDoc[]>([])

  const location = useLocation()
  const isProjectsPage = location.pathname === '/projects'

  // Load projects on mount, when backend connects, and when navigating away from /projects
  useEffect(() => {
    if (!backendConnected) return
    listProjects()
      .then(setProjects)
      .catch(() => {
        /* backend may not be running */
      })
  }, [backendConnected, isProjectsPage])

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
  const [allLogs, setAllLogs] = useState<LogEntry[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [traceResult, setTraceResult] = useState<TraceParseResult | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const abortParseRef = useRef<AbortController | null>(null)

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

  const filteredLogs = useMemo(() => applyFiltersClient(allLogs, filters), [allLogs, filters])

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

  // Check AI config from localStorage and backend, sync localStorage → backend on startup
  useEffect(() => {
    const saved = localStorage.getItem('aiConfig')
    if (saved) {
      try {
        const cfg = JSON.parse(saved) as { api_key?: string }
        if (cfg.api_key) {
          setAiConfigured(true)
          // Sync localStorage config to backend (it's in-memory only and lost on restart)
          if (backendConnected) {
            fetch('/api/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: saved,
              signal: AbortSignal.timeout(3000),
            }).catch(() => {
              /* ignore */
            })
          }
          return
        }
      } catch {
        /* ignore */
      }
    }
    // Fallback: check backend config
    if (backendConnected) {
      fetch('/api/config', { signal: AbortSignal.timeout(3000) })
        .then((res) => res.json())
        .then((cfg: { api_key?: string }) => {
          if (cfg.api_key) {
            setAiConfigured(true)
            localStorage.setItem('aiConfig', JSON.stringify(cfg))
          }
        })
        .catch(() => {
          /* ignore */
        })
    }
  }, [backendConnected])

  const handleToggleTheme = useCallback(() => {
    setIsDark((v) => {
      const next = !v
      localStorage.setItem('ala_theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  const handleToggleLanguage = useCallback(() => {
    setLanguage((lang) => {
      const next = lang === 'en' ? 'zh' : 'en'
      localStorage.setItem('ala_language', next)
      void i18next.changeLanguage(next)
      return next
    })
  }, [])

  const handleLogFiles = useCallback(
    async (files: File[]) => {
      // Cancel any in-flight parse
      abortParseRef.current?.abort()
      const controller = new AbortController()
      abortParseRef.current = controller

      setLoadingFile(true)
      setFileError(undefined)
      setFileNames(files.map((f) => f.name))
      setAllLogs([])
      setFormatDetected(undefined)
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')

      // Batch incoming entries to avoid re-renders per-entry
      const BATCH_SIZE = 500
      const buffer: LogEntry[] = []

      const flush = () => {
        if (buffer.length === 0) return
        const toAdd = buffer.splice(0)
        setAllLogs((prev) => [...prev, ...toAdd])
      }

      try {
        for await (const line of parseLogStream(files, controller.signal)) {
          if ('_done' in line) break
          const entry = line as LogEntry
          buffer.push(entry)
          if (entry.source_file && !formatDetected) {
            setFormatDetected(entry.source_file)
          }
          if (buffer.length >= BATCH_SIZE) flush()
        }
        flush()
        void message.success(t('fileUploaded'))
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : t('parseError')
        setFileError(msg)
        void message.error(msg)
      } finally {
        setLoadingFile(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  )

  const handleTraceFile = useCallback(
    async (file: File) => {
      setLoadingFile(true)
      setFileError(undefined)
      setFileNames([file.name])
      try {
        const result = await parseTrace(file)
        setTraceResult(result)
        setActiveTab('trace')
        void message.success(t('fileUploaded'))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('parseError')
        setFileError(msg)
        void message.error(msg)
      } finally {
        setLoadingFile(false)
      }
    },
    [t],
  )

  const handleConfigSaved = useCallback(() => {
    const saved = localStorage.getItem('aiConfig')
    if (saved) {
      try {
        const cfg = JSON.parse(saved) as { api_key?: string }
        setAiConfigured(!!cfg.api_key)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const handleDirectoryPath = useCallback(
    async (dirPath: string) => {
      abortParseRef.current?.abort()
      const controller = new AbortController()
      abortParseRef.current = controller

      setLoadingFile(true)
      setFileError(undefined)
      setFileNames([dirPath])
      setAllLogs([])
      setFormatDetected(undefined)
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')

      const BATCH_SIZE = 500
      const buffer: LogEntry[] = []

      const flush = () => {
        if (buffer.length === 0) return
        const toAdd = buffer.splice(0)
        setAllLogs((prev) => [...prev, ...toAdd])
      }

      try {
        for await (const line of parseDirectoryStream(dirPath, controller.signal)) {
          if ('_done' in line) break
          const entry = line as LogEntry
          buffer.push(entry)
          if (entry.source_file && !formatDetected) {
            setFormatDetected(entry.source_file)
          }
          if (buffer.length >= BATCH_SIZE) flush()
        }
        flush()
        void message.success(t('fileUploaded'))
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : t('parseError')
        setFileError(msg)
        void message.error(msg)
      } finally {
        setLoadingFile(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  )

  const showFileUpload = allLogs.length === 0 && !traceResult

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
        loading={loadingFile}
        error={fileError}
        fileNames={fileNames}
        compact
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
          <Button size="small" icon={<UploadOutlined />} loading={loadingFile}>
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
          onDirectoryPath={(p) => {
            void handleDirectoryPath(p)
          }}
          loading={loadingFile}
          error={fileError}
          fileNames={fileNames}
        />
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
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { borderRadius: 6 },
      }}
    >
      <AntApp style={{ height: '100%' }}>
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
            onToggleTheme={handleToggleTheme}
            language={language}
            onToggleLanguage={handleToggleLanguage}
            onOpenSettings={() => setSettingsOpen(true)}
            siderCollapsed={siderCollapsed}
            onToggleSider={() => setSiderCollapsed((v) => !v)}
            backendConnected={backendConnected}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
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
              overflow: isProjectsPage ? 'auto' : 'hidden',
              position: 'relative',
            }}
          >
            <Routes>
              <Route path="/projects" element={<ProjectManager />} />
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
                          borderRight: siderCollapsed
                            ? 'none'
                            : '1px solid var(--ant-color-border)',
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
                            onPresetsChange={setPresets}
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
                            defaultSize={400}
                            min={280}
                            max={600}
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
                                  totalLogs={allLogs.length}
                                  filters={filters}
                                  traceResult={traceResult}
                                  aiConfigured={aiConfigured}
                                  selectedProjectId={selectedProjectId}
                                  projects={projects}
                                  contextDocs={contextDocs}
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

          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onConfigSaved={handleConfigSaved}
            backendConnected={backendConnected}
          />
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default App

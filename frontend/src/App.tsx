import { UploadOutlined, FileOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntApp,
  Button,
  ConfigProvider,
  Divider,
  Empty,
  Popover,
  Radio,
  Space,
  Splitter,
  Tabs,
  theme,
  Tooltip,
  Typography,
} from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation } from 'react-router-dom'
import { getConfig } from './api/config'
import { uploadToTemp } from './api/logs'
import type { DirectoryFileInfo } from './api/logs'
import { listModels } from './api/models'
import {
  getProjectPresets,
  listContextDocs,
  listProjects,
  updateProjectPresets,
} from './api/projects'
import { parseTrace } from './api/trace'
import AiPanel from './components/AiPanel'
import AppSider from './components/AppSider'
import { ErrorBoundary } from './components/ErrorBoundary'
import FileUpload from './components/FileUpload'
import DirectoryFilePicker from './components/DirectoryFilePicker'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import TraceViewer from './components/TraceViewer'
import { useDebouncedValue } from './hooks/useDebounce'
import { useLazyLogStream } from './hooks/useLazyLogStream'
import i18next from './i18n/config'
import type {
  AIConfig,
  ContextDoc,
  FilterPreset,
  HighlightItem,
  LogFilters,
  ModelPreset,
  Project,
  TraceParseResult,
} from './types'
import { hasFilterConditions } from './utils/filters'
import {
  getActiveAIConfig,
  migrateFromLegacyConfig,
  migrateLocalModelsToBackend,
} from './utils/models'

const ProjectManager = React.lazy(() => import('./components/ProjectManager'))
const ModelManager = React.lazy(() => import('./components/ModelManager'))
const UserGuide = React.lazy(() => import('./components/UserGuide'))

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

const AppContent: React.FC<{
  isDark: boolean
  onToggleTheme: () => void
}> = ({ isDark, onToggleTheme }) => {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()

  const [language, setLanguage] = useState(() => localStorage.getItem('ala_language') || 'en')
  const [siderCollapsed, setSiderCollapsed] = useState(true)
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [aiPanelSize, setAiPanelSize] = useState<number>(() => {
    const saved = localStorage.getItem('ala_splitter_ai_size')
    return saved ? Number(saved) : 520
  })
  const saveSizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshModelsRef = useRef<(() => void) | null>(null)
  const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false)
  const [backendConnected, setBackendConnected] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [allModels, setAllModels] = useState<ModelPreset[]>([])
  const [activeTab, setActiveTab] = useState<'log' | 'trace'>('log')

  // Project state (lifted here so Header and AiPanel share it)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    // Restore last selected project on page load
    return localStorage.getItem('ala_last_project_id') || null
  })
  const [contextDocs, setContextDocs] = useState<ContextDoc[]>([])

  // Directory file picker modal state
  const [pickerState, setPickerState] = useState<{
    open: boolean
    files: DirectoryFileInfo[]
    dirPath: string
  }>({ open: false, files: [], dirPath: '' })

  // Upload popover: mode selector state (T6)
  const [uploadMode, setUploadMode] = useState<'replace' | 'append'>('replace')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const location = useLocation()
  const isFullPage = useMemo(() => location.pathname !== '/', [location.pathname])

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
        if (current && loaded.length > 0 && !loaded.some((p) => p.id === current)) {
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

  // File state — lazy log streaming via agentic approach
  // displayLogs is replaced (not accumulated) on each filter trigger
  const {
    displayLogs,
    loading: loadingFile,
    error: fileError,
    fileNames,
    formatDetected,
    filterProgress,
    sourceRef,
    stats,
    loadSource,
    triggerFilter,
    abort: abortParse,
    reset: resetLogs,
  } = useLazyLogStream()
  const [traceResult, setTraceResult] = useState<TraceParseResult | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | undefined>()

  // Clear stale sourceRef when trace data source changes
  useEffect(() => {
    if (traceResult) {
      resetLogs()
    }
  }, [traceResult])

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

  // Trigger backend lazy filter whenever debounced filters change
  useEffect(() => {
    if (sourceRef) {
      void triggerFilter(debouncedFilters)
    }
    // We intentionally only fire on debounced filter changes, not sourceRef changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilters])

  const hasActiveFilters = useMemo(() => hasFilterConditions(filters), [filters])

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

  // Fetch model presets from backend whenever connection is established.
  // Also runs the one-time migration of legacy localStorage custom models.
  useEffect(() => {
    if (!backendConnected) {
      setModelsLoaded(false)
      return
    }
    void listModels()
      .then(async (fetched) => {
        const migrated = await migrateLocalModelsToBackend(fetched)
        const merged = migrated.length > 0 ? [...fetched, ...migrated] : fetched
        // Batch both updates so the config effect fires only once
        setAllModels(merged)
        setModelsLoaded(true)
        if (migrated.length > 0) {
          void message.success(t('migratedModels', { count: migrated.length }))
        }
      })
      .catch(() => {
        setModelsLoaded(true) // even on error, unblock the config effect
      })
  }, [backendConnected, message, t])

  // Derive AI config only after models have finished loading to avoid double getConfig() calls.
  // API keys live in localStorage only — never synced to backend.
  useEffect(() => {
    if (!modelsLoaded) return
    migrateFromLegacyConfig(allModels)
    const active = getActiveAIConfig(allModels)
    if (active && active.config.api_key?.trim()) {
      setAiConfigured(true)
      setAiConfig(active.config)
      return
    }

    if (!backendConnected) {
      setAiConfigured(false)
      setAiConfig(null)
      return
    }

    // Fallback: backend may have an env-var configured API key.
    // '***' means the backend has a key set — treat it as configured.
    getConfig()
      .then((remote) => {
        const hasKey = remote.api_key.trim() !== ''
        setAiConfigured(hasKey)
        setAiConfig(hasKey ? remote : null)
      })
      .catch(() => {
        setAiConfigured(false)
        setAiConfig(null)
      })
  }, [backendConnected, allModels, modelsLoaded])

  // Helper: close upload popover and clear pending files (avoids stale state)
  const closeUploadPopover = useCallback(() => {
    setUploadPopoverOpen(false)
    setPendingFiles([])
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K → toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSiderCollapsed((v) => !v)
        return
      }
      // Ctrl+Shift+F / Cmd+Shift+F → focus keywords input in sidebar
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        document.getElementById('ala-keywords-input')?.focus()
        return
      }
      // Ctrl+D / Cmd+D → toggle dark/light theme
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        onToggleTheme()
        return
      }
      // Esc → close upload popover, then collapse sider, then collapse aiPanel
      if (e.key === 'Escape') {
        if (uploadPopoverOpen) {
          closeUploadPopover()
          return
        }
        if (!siderCollapsed) {
          setSiderCollapsed(true)
          return
        }
        if (!aiPanelCollapsed) {
          setAiPanelCollapsed(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [uploadPopoverOpen, siderCollapsed, aiPanelCollapsed, onToggleTheme, closeUploadPopover])

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
      // Reset all file / log / trace state so the new project starts clean
      resetLogs()
      setTraceResult(null)
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')
      setSelectedProjectId(projectId)
    },
    [abortParse, resetLogs],
  )

  const handleRegisterRefreshModels = useCallback((fn: () => void) => {
    refreshModelsRef.current = fn
  }, [])

  const handleRefreshModels = useCallback(() => {
    refreshModelsRef.current?.()
  }, [])

  const handleSplitterResize = useCallback((sizes: number[]) => {
    if (sizes.length >= 2) {
      const aiSize = sizes[1]
      setAiPanelSize(aiSize)
      if (saveSizeTimer.current) clearTimeout(saveSizeTimer.current)
      saveSizeTimer.current = setTimeout(() => {
        localStorage.setItem('ala_splitter_ai_size', String(Math.round(aiSize)))
      }, 500)
    }
  }, [])

  // --- Log file handlers (agentic lazy approach) ---

  const handleLogFiles = useCallback(
    async (files: File[]) => {
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')
      setPendingFiles([])

      try {
        const result = await uploadToTemp(files)
        const firstFile = result.files[0]
        const labels = result.files.map((f) => f.original_name)
        loadSource(firstFile.saved_path, labels)
        void message.success(t('fileUploaded'))
      } catch {
        void message.error(t('parseError'))
      }
    },
    [loadSource, t, message],
  )

  const handleTraceFile = useCallback(
    async (file: File) => {
      resetLogs()
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
    [resetLogs, t, message],
  )

  // Local file streaming handler — registers path and triggers lazy load
  const handleLocalPathStream = useCallback(
    async (path: string, type: 'file' | 'directory', _meta: unknown) => {
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')

      if (type === 'file') {
        const label = path.replace(/\\/g, '/').split('/').pop() || path
        loadSource(path, [label])
        void message.success(t('fileUploaded'))
      } else {
        // Directory: let the picker resolve which files to use
        const meta = _meta as { files?: { name: string; size: number }[] } | undefined
        setPickerState({
          open: true,
          files: (meta?.files || []).map((f) => ({
            name: f.name,
            path: f.name,
            size: f.size,
            is_log: true,
          })),
          dirPath: path,
        })
      }
    },
    [loadSource, t, message],
  )

  // Directory file picker — load first selected file as lazy source
  const handlePickerConfirm = useCallback(
    async (selectedFiles: string[]) => {
      setPickerState((prev) => ({ ...prev, open: false }))
      const dirPath = pickerState.dirPath
      if (selectedFiles.length === 0) return

      const fullPath = dirPath.replace(/\/$/, '') + '/' + selectedFiles[0].replace(/^\//, '')
      const label = selectedFiles[0].split('/').pop() || selectedFiles[0]
      loadSource(fullPath, [label])
      void message.success(t('fileUploaded'))
    },
    [loadSource, pickerState.dirPath, t, message],
  )

  const handlePickerCancel = useCallback(() => {
    setPickerState((prev) => ({ ...prev, open: false }))
  }, [])

  // Upload popover handlers — stage files and upload via temp
  const handleUploadPopoverFiles = useCallback(
    (files: File[], isTrace: boolean) => {
      if (isTrace) {
        void handleTraceFile(files[0])
        closeUploadPopover()
        return
      }
      setPendingFiles(files)
      setUploadMode('replace')
    },
    [handleTraceFile, closeUploadPopover],
  )

  const handleUploadPopoverLoad = useCallback(async () => {
    await handleLogFiles(pendingFiles)
    setPendingFiles([])
    closeUploadPopover()
    void message.success(t('fileUploaded'))
  }, [handleLogFiles, pendingFiles, closeUploadPopover, t, message])

  const showFileUpload = !sourceRef && !traceResult

  const isLoading = loadingFile || traceLoading
  const errorMessage = fileError || traceError

  // T6: Upload popover content — redesigned with mode selector when files loaded
  const uploadPopoverContent =
    fileNames.length > 0 ? (
      <div style={{ width: 340 }}>
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('currentlyLoaded')}:
          </Typography.Text>
          {fileNames.map((name, idx) => (
            <div
              key={`${name}-${idx}`}
              style={{ padding: '2px 0', display: 'flex', alignItems: 'center' }}
            >
              <FileOutlined style={{ marginRight: 6 }} />
              <Typography.Text style={{ fontSize: 12 }} ellipsis title={name}>
                {name}
              </Typography.Text>
            </div>
          ))}
        </div>
        <FileUpload
          compact={true}
          onLogFiles={(files) => {
            handleUploadPopoverFiles(files, false)
          }}
          onTraceFile={(f) => {
            handleUploadPopoverFiles([f], true)
          }}
          onLocalPathStream={(path, type, result) => {
            void handleLocalPathStream(path, type, result)
            closeUploadPopover()
          }}
          loading={isLoading}
          error={errorMessage}
          fileNames={fileNames}
        />
        {pendingFiles.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <Radio.Group
              value={uploadMode}
              onChange={(e) => setUploadMode(e.target.value)}
              size="small"
            >
              <Space direction="vertical">
                <Radio value="replace">{t('replaceMode')}</Radio>
                <Radio value="append">{t('appendMode')}</Radio>
              </Space>
            </Radio.Group>
            <Button
              type="primary"
              block
              size="small"
              style={{ marginTop: 8 }}
              onClick={() => {
                void handleUploadPopoverLoad()
              }}
            >
              {uploadMode === 'append' ? t('appendFiles') : t('updateFiles')}
            </Button>
          </>
        )}
      </div>
    ) : (
      <div style={{ width: 300 }}>
        <FileUpload
          compact={true}
          onLogFiles={(files) => {
            void handleLogFiles(files)
            closeUploadPopover()
          }}
          onTraceFile={(f) => {
            void handleTraceFile(f)
            closeUploadPopover()
          }}
          onLocalPathStream={(path, type, result) => {
            void handleLocalPathStream(path, type, result)
            closeUploadPopover()
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
        onOpenChange={(open) => {
          if (!open) setPendingFiles([])
          setUploadPopoverOpen(open)
        }}
        trigger="click"
        placement="bottomRight"
      >
        <Tooltip title={fileNames.length > 0 ? t('updateFiles') : t('uploadFiles')}>
          <Button size="small" icon={<UploadOutlined />} loading={isLoading}>
            {fileNames.length > 0 ? t('updateFiles') : t('uploadFiles')}
          </Button>
        </Tooltip>
      </Popover>
    </div>
  )

  // T5: Simplified tabItems — no showFileUpload or localFilePath placeholder branches
  const tabItems = [
    {
      key: 'log',
      label: t('logAnalysis'),
      children: !hasActiveFilters ? (
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
          logs={displayLogs}
          totalLogs={displayLogs.length}
          highlights={highlights}
          wordWrap={wordWrap}
          formatDetected={formatDetected}
          parseProgress={
            filterProgress
              ? {
                  current: filterProgress.matched,
                  total: filterProgress.total ?? filterProgress.scanned,
                }
              : null
          }
        />
      ),
    },
    {
      key: 'trace',
      label: t('traceAnalysis'),
      children: <TraceViewer traceResult={traceResult} />,
    },
  ]

  const antdLocale = language === 'zh' ? zhCN : enUS

  return (
    <ConfigProvider locale={antdLocale}>
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
          onRefreshModels={handleRefreshModels}
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
            <Route
              path="/projects"
              element={
                <Suspense fallback={null}>
                  <ProjectManager />
                </Suspense>
              }
            />
            <Route
              path="/models"
              element={
                <Suspense fallback={null}>
                  <ModelManager
                    onModelsChange={setAllModels}
                    onRegisterRefresh={handleRegisterRefreshModels}
                  />
                </Suspense>
              }
            />
            <Route
              path="/guide"
              element={
                <Suspense fallback={null}>
                  <UserGuide />
                </Suspense>
              }
            />
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
                          statistics={stats}
                          presets={presets}
                          onPresetsChange={handlePresetsChange}
                          wordWrap={wordWrap}
                          onWordWrapChange={setWordWrap}
                          selectedProjectId={selectedProjectId}
                        />
                      )}
                    </div>

                    {/* Center + Right: Splitter for Log viewer and AI panel */}
                    <Splitter style={{ flex: 1, height: '100%' }} onResize={handleSplitterResize}>
                      {/* Center: Log/Trace viewer */}
                      <Splitter.Panel style={{ overflow: 'hidden', minWidth: 300 }}>
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          {showFileUpload ? (
                            <FileUpload
                              onLogFiles={(files) => {
                                void handleLogFiles(files)
                              }}
                              onTraceFile={(f) => {
                                void handleTraceFile(f)
                              }}
                              onLocalPathStream={(path, type, result) => {
                                void handleLocalPathStream(path, type, result)
                              }}
                              loading={isLoading}
                              error={errorMessage}
                              fileNames={fileNames}
                            />
                          ) : (
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
                          )}
                        </div>
                      </Splitter.Panel>

                      {/* Right: AI Panel */}
                      {!aiPanelCollapsed && (
                        <Splitter.Panel
                          size={aiPanelSize}
                          min={320}
                          max={'50%'}
                          defaultSize={'50%'}
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
                                logs={displayLogs}
                                allLogs={displayLogs}
                                totalLogs={displayLogs.length}
                                filters={filters}
                                traceResult={traceResult}
                                aiConfigured={aiConfigured}
                                selectedProjectId={selectedProjectId}
                                projects={projects}
                                contextDocs={contextDocs}
                                localFilePath={sourceRef}
                                aiConfig={aiConfig ?? undefined}
                                allModels={allModels}
                              />
                            </div>
                          </div>
                        </Splitter.Panel>
                      )}
                    </Splitter>
                  </div>

                  {/* Directory file picker modal */}
                  <DirectoryFilePicker
                    open={pickerState.open}
                    files={pickerState.files}
                    dirPath={pickerState.dirPath}
                    onConfirm={handlePickerConfirm}
                    onCancel={handlePickerCancel}
                  />

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
    </ConfigProvider>
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
        <ErrorBoundary>
          <AppContent isDark={isDark} onToggleTheme={handleToggleTheme} />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  )
}

export default App

import { FileOutlined, UploadOutlined } from '@ant-design/icons'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Popover,
  Space,
  Splitter,
  Tabs,
  Tag,
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
import { uploadFiles } from './api/files'
import type { UnifiedFileInfo } from './api/files'
import { listModels } from './api/models'
import {
  getProjectPresets,
  listContextDocs,
  listProjects,
  updateProjectPresets,
} from './api/projects'
import AiPanel from './components/AiPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import FileUpload from './components/FileUpload'
import FilterDrawer from './components/FilterDrawer'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import PcapViewer from './components/PcapViewer'
import HciViewer from './components/HciViewer'
import TraceViewer from './components/TraceViewer'
import { useDebouncedValue } from './hooks/useDebounce'
import { useLazyLogStream } from './hooks/useLazyLogStream'
import { useLazyPcapStream } from './hooks/useLazyPcapStream'
import { useLazyHciStream } from './hooks/useLazyHciStream'
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
import type { HciEntry } from './types/hci'
import { hasFilterConditions } from './utils/filters'
import {
  getActiveAIConfig,
  migrateFromLegacyConfig,
  migrateLocalModelsToBackend,
} from './utils/models'

// Pending files info view — shows uploaded files grouped by type before parsing
interface PendingFile {
  original_name: string
  saved_path: string | null
  file_type: 'log' | 'pcap' | 'hci' | 'trace'
  format_detected: string
  size_bytes: number
  trace_result?: UnifiedFileInfo['trace_result']
}

const FILE_TYPE_COLORS: Record<string, string> = {
  log: 'green',
  pcap: 'blue',
  hci: 'purple',
  trace: 'orange',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const PendingFilesView: React.FC<{
  files: PendingFile[]
  onLoad: (file: PendingFile) => void
  loading: boolean
  error?: string
}> = ({ files, onLoad, loading, error }) => {
  const { t } = useTranslation()

  const grouped = useMemo(() => {
    const map: Record<string, PendingFile[]> = {}
    files.forEach((f) => {
      const key = f.file_type
      if (!map[key]) map[key] = []
      map[key].push(f)
    })
    return map
  }, [files])

  const typeLabels: Record<string, string> = {
    log: t('logAnalysis'),
    pcap: t('pcapAnalysis'),
    hci: t('hciAnalysis'),
    trace: t('traceAnalysis'),
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 32,
        overflow: 'auto',
      }}
    >
      <Typography.Title level={5} style={{ margin: 0 }}>
        {t('uploadedFiles')}
      </Typography.Title>
      <Typography.Text type="secondary">{t('clickToLoadFile')}</Typography.Text>

      {Object.entries(grouped).map(([fileType, groupFiles]) => (
        <div key={fileType} style={{ width: '100%', maxWidth: 520 }}>
          <Typography.Text strong style={{ fontSize: 13, textTransform: 'uppercase' }}>
            <Tag color={FILE_TYPE_COLORS[fileType] || 'default'}>
              {typeLabels[fileType] || fileType}
            </Tag>
            {groupFiles.length > 1 && ` (${groupFiles.length})`}
          </Typography.Text>
          <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
            {groupFiles.map((file, idx) => (
              <Card
                key={`${file.original_name}-${idx}`}
                size="small"
                hoverable
                onClick={() => !loading && onLoad(file)}
                style={{ cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text
                      strong
                      style={{ fontSize: 13, display: 'block' }}
                      ellipsis
                      title={file.original_name}
                    >
                      <FileOutlined style={{ marginRight: 6 }} />
                      {file.original_name}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {file.format_detected}
                      {file.size_bytes > 0 && ` · ${formatFileSize(file.size_bytes)}`}
                    </Typography.Text>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    loading={loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      onLoad(file)
                    }}
                  >
                    {t('loadFile')}
                  </Button>
                </div>
              </Card>
            ))}
          </Space>
        </div>
      ))}

      {error && <Alert type="error" message={error} showIcon closable style={{ marginTop: 8 }} />}
    </div>
  )
}

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

const EMPTY_PCAP_FILTERS: import('./types/pcap').PcapFilters = {
  start_time: null,
  end_time: null,
  protocol: null,
  src_ip: null,
  dst_ip: null,
  src_port: null,
  dst_port: null,
  tcp_flags: null,
  keywords: null,
}

const EMPTY_HCI_FILTERS: import('./types/hci').HciFilters = {
  start_time: null,
  end_time: null,
  direction: null,
  hci_type: null,
  opcode: null,
  opcode_name: null,
  event_code: null,
  event_name: null,
  keywords: null,
}

const AppContent: React.FC<{
  isDark: boolean
  onToggleTheme: () => void
}> = ({ isDark, onToggleTheme }) => {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()

  const [language, setLanguage] = useState(() => localStorage.getItem('ala_language') || 'en')
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
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
  const [activeTab, setActiveTab] = useState<'log' | 'pcap' | 'hci' | 'trace'>('log')

  // Project state (lifted here so Header and AiPanel share it)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    // Restore last selected project on page load
    return localStorage.getItem('ala_last_project_id') || null
  })
  const [contextDocs, setContextDocs] = useState<ContextDoc[]>([])

  // Pending uploaded files — stored but not yet parsed (agent decides when to load)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])

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
    isDirectory,
    stats,
    totalLines,
    loadSource,
    triggerFilter,
    abort: abortParse,
    reset: resetLogs,
  } = useLazyLogStream()

  // PCAP state (lazy — upload to temp, filter on demand)
  const {
    displayEntries: pcapEntries,
    loading: pcapLoading,
    error: pcapError,
    fileNames: pcapFileNames,
    formatDetected: pcapFormat,
    sourcePath: pcapSourcePath,
    stats: pcapStats,
    loadSource: loadPcapSource,
    triggerFilter: triggerPcapFilter,
    abort: abortPcap,
    reset: resetPcap,
  } = useLazyPcapStream()

  // HCI state (lazy — upload to temp, filter on demand)
  const {
    displayEntries: hciEntries,
    loading: hciLoading,
    error: hciError,
    fileNames: hciFileNames,
    formatDetected: hciFormat,
    sourcePath: hciSourcePath,
    stats: hciStats,
    loadSource: loadHciSource,
    triggerFilter: triggerHciFilter,
    abort: abortHci,
    reset: resetHci,
  } = useLazyHciStream()

  const [traceResult, setTraceResult] = useState<TraceParseResult | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string | undefined>()
  const [filteredTraceResult, setFilteredTraceResult] = useState<TraceParseResult | null>(null)

  // PCAP filtered state
  const [filteredPcapEntries, setFilteredPcapEntries] = useState<
    import('./types/pcap').PcapEntry[]
  >([])

  // HCI filtered state
  const [filteredHciEntries, setFilteredHciEntries] = useState<HciEntry[]>([])

  // Detected file type from backend
  const [detectedFileType, setDetectedFileType] = useState<string | null>(null)

  // Reset filtered state when switching tabs
  useEffect(() => {
    setFilteredTraceResult(null)
    setFilteredPcapEntries([])
  }, [activeTab])

  // Clear stale sourceRef when trace data source changes
  useEffect(() => {
    if (traceResult) {
      resetLogs()
    }
  }, [traceResult, resetLogs])

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

  // Trigger backend lazy filter whenever debounced filters or source changes
  useEffect(() => {
    if (sourceRef && !isDirectory) {
      void triggerFilter(debouncedFilters)
    }
  }, [debouncedFilters, sourceRef, isDirectory])

  // Trigger PCAP lazy filter when source path changes (initial load — all packets)
  useEffect(() => {
    if (pcapSourcePath) {
      void triggerPcapFilter(EMPTY_PCAP_FILTERS)
    }
    // triggerPcapFilter is stable (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcapSourcePath])

  // Trigger HCI lazy filter when source path changes (initial load — all packets)
  useEffect(() => {
    if (hciSourcePath) {
      void triggerHciFilter(EMPTY_HCI_FILTERS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hciSourcePath])

  const hasActiveFilters = useMemo(() => hasFilterConditions(filters), [filters])
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K → toggle filter drawer
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setFilterDrawerOpen((v) => !v)
        return
      }
      // Ctrl+Shift+F / Cmd+Shift+F → focus keywords input in sidebar
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setActiveTab('log')
        setFilterDrawerOpen(true)
        return
      }
      // Ctrl+D / Cmd+D → toggle dark/light theme
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        onToggleTheme()
        return
      }
      // Esc → close upload popover, then filter drawer, then aiPanel
      if (e.key === 'Escape') {
        if (uploadPopoverOpen) {
          closeUploadPopover()
          return
        }
        if (filterDrawerOpen) {
          setFilterDrawerOpen(false)
          return
        }
        if (!aiPanelCollapsed) {
          setAiPanelCollapsed(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [uploadPopoverOpen, filterDrawerOpen, aiPanelCollapsed, onToggleTheme, closeUploadPopover])

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
      // Abort any in-flight parsing before clearing state
      abortParse()
      abortPcap()
      abortHci()
      // Reset all file / log / trace / pcap / hci state so the new project starts clean
      resetLogs()
      resetPcap()
      resetHci()
      setTraceResult(null)
      setFilteredTraceResult(null)
      setFilteredPcapEntries([])
      setFilteredHciEntries([])
      setDetectedFileType(null)
      setPendingFiles([])
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')
      setSelectedProjectId(projectId)
    },
    [abortParse, abortPcap, abortHci, resetLogs, resetPcap, resetHci],
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

  // --- Unified file handler — backend detects type, frontend routes ---

  const handleFiles = useCallback(
    async (files: File[]) => {
      // Clear all previous state
      abortParse()
      abortPcap()
      abortHci()
      resetLogs()
      resetPcap()
      resetHci()
      setTraceResult(null)
      setFilteredTraceResult(null)
      setFilteredPcapEntries([])
      setFilteredHciEntries([])
      setDetectedFileType(null)
      setTraceError(undefined)
      setTraceLoading(false)
      setPendingFiles([])

      try {
        const result = await uploadFiles(files)
        if (result.files.length === 0) {
          void message.error(t('parseError'))
          return
        }

        // Store files as pending — don't eager parse; agent decides when to load
        const pending: PendingFile[] = result.files.map((f) => ({
          original_name: f.original_name,
          saved_path: f.saved_path,
          file_type: f.file_type,
          format_detected: f.format_detected,
          size_bytes: f.size_bytes,
          trace_result: f.trace_result,
        }))
        setPendingFiles(pending)
        setDetectedFileType(result.files[0].file_type)
        setActiveTab(result.files[0].file_type === 'trace' ? 'trace' : 'log')
        void message.success(t('fileUploaded'))
      } catch {
        void message.error(t('parseError'))
      }
    },
    [abortParse, abortPcap, abortHci, resetLogs, resetPcap, resetHci, t, message],
  )

  // Load a pending file into the active viewer (triggered by user or agent)
  const handleLoadPendingFile = useCallback(
    (file: PendingFile) => {
      switch (file.file_type) {
        case 'log':
          if (file.saved_path) {
            setFilters(DEFAULT_FILTERS)
            loadSource(file.saved_path, [file.original_name])
            setActiveTab('log')
          }
          break
        case 'pcap':
          if (file.saved_path) {
            loadPcapSource(file.saved_path, [file.original_name], file.format_detected)
            setActiveTab('pcap')
          }
          break
        case 'hci':
          if (file.saved_path) {
            loadHciSource(file.saved_path, [file.original_name], file.format_detected)
            setActiveTab('hci')
          }
          break
        case 'trace':
          if (file.trace_result) {
            setTraceResult(file.trace_result as unknown as TraceParseResult)
            setActiveTab('trace')
          }
          break
      }
      setPendingFiles((prev) =>
        prev.filter((f) =>
          file.saved_path
            ? f.saved_path !== file.saved_path
            : f.original_name !== file.original_name,
        ),
      )
    },
    [loadSource, loadPcapSource, loadHciSource],
  )

  // Local path handler — passes path directly to lazy source (agent decides what to load)
  const handleLocalPath = useCallback(
    (path: string) => {
      setFilters(DEFAULT_FILTERS)
      setActiveTab('log')
      setPendingFiles([])
      const label = path.replace(/\\/g, '/').split('/').pop() || path
      loadSource(path, [label])
      void message.success(t('fileUploaded'))
    },
    [loadSource, t, message],
  )

  const showFileUpload =
    !sourceRef && !traceResult && !pcapSourcePath && !hciSourcePath && pendingFiles.length === 0

  const isLoading = loadingFile || pcapLoading || hciLoading || traceLoading
  const errorMessage = fileError || pcapError || hciError || traceError

  const loadedNames =
    fileNames.length > 0 ? fileNames : pcapFileNames.length > 0 ? pcapFileNames : hciFileNames

  // Upload popover — compact FileUpload + detected file info
  const hasLoadedFiles =
    fileNames.length > 0 ||
    pcapFileNames.length > 0 ||
    hciFileNames.length > 0 ||
    pendingFiles.length > 0

  const popoverFileInfo = hasLoadedFiles ? (
    <div style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('currentlyLoaded')}:
      </Typography.Text>
      {pendingFiles.length > 0
        ? pendingFiles.map((f, idx) => (
            <div
              key={`${f.original_name}-${idx}`}
              style={{ padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FileOutlined style={{ fontSize: 12 }} />
              <Typography.Text style={{ fontSize: 12 }} ellipsis title={f.original_name}>
                {f.original_name}
              </Typography.Text>
              <Tag
                color={FILE_TYPE_COLORS[f.file_type] || 'green'}
                style={{ fontSize: 10, marginLeft: 4 }}
              >
                {f.file_type}
              </Tag>
            </div>
          ))
        : loadedNames.map((name, idx) => (
            <div
              key={`${name}-${idx}`}
              style={{ padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FileOutlined style={{ fontSize: 12 }} />
              <Typography.Text style={{ fontSize: 12 }} ellipsis title={name}>
                {name}
              </Typography.Text>
              {detectedFileType && (
                <Tag
                  color={
                    detectedFileType === 'pcap'
                      ? 'blue'
                      : detectedFileType === 'hci'
                        ? 'purple'
                        : detectedFileType === 'trace'
                          ? 'orange'
                          : 'green'
                  }
                  style={{ fontSize: 10, marginLeft: 4 }}
                >
                  {detectedFileType}
                </Tag>
              )}
            </div>
          ))}
    </div>
  ) : null

  const uploadPopoverContent = (
    <div style={{ width: hasLoadedFiles ? 340 : 300 }}>
      {popoverFileInfo}
      <FileUpload
        compact={true}
        onFiles={(fs) => {
          void handleFiles(fs)
          closeUploadPopover()
        }}
        onLocalPath={(path) => {
          handleLocalPath(path)
          closeUploadPopover()
        }}
        loading={isLoading}
        error={errorMessage}
        fileNames={[]}
      />
    </div>
  )

  const tabBarExtra = (
    <div style={{ paddingRight: 8 }}>
      <Popover
        content={uploadPopoverContent}
        open={uploadPopoverOpen}
        onOpenChange={(open) => {
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
      children: isDirectory ? (
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
          <Empty description={t('directoryLoaded')} />
          <Typography.Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
            {t('directoryHint')}
          </Typography.Text>
        </div>
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
          logs={displayLogs}
          totalLogs={
            totalLines ?? filterProgress?.total ?? filterProgress?.scanned ?? displayLogs.length
          }
          highlights={highlights}
          wordWrap={wordWrap}
          formatDetected={formatDetected}
          parseProgress={
            filterProgress
              ? {
                  current: filterProgress.scanned ?? filterProgress.matched,
                  total: filterProgress.total ?? filterProgress.scanned,
                }
              : null
          }
        />
      ),
    },
    {
      key: 'pcap',
      label: t('pcapAnalysis'),
      children: (
        <PcapViewer
          entries={filteredPcapEntries.length > 0 ? filteredPcapEntries : pcapEntries}
          totalPackets={pcapEntries.length}
          formatDetected={pcapFormat}
          statistics={filteredPcapEntries.length > 0 ? null : pcapStats}
        />
      ),
    },
    {
      key: 'hci',
      label: t('hciAnalysis'),
      children: (
        <HciViewer
          entries={filteredHciEntries.length > 0 ? filteredHciEntries : hciEntries}
          totalPackets={hciEntries.length}
          formatDetected={hciFormat}
          statistics={filteredHciEntries.length > 0 ? null : hciStats}
        />
      ),
    },
    {
      key: 'trace',
      label: t('traceAnalysis'),
      children: <TraceViewer traceResult={filteredTraceResult || traceResult} />,
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
                    {/* Center + Right: Splitter for Log viewer and AI panel */}
                    <Splitter style={{ flex: 1, height: '100%' }} onResize={handleSplitterResize}>
                      {/* Center: Log/Trace viewer */}
                      <Splitter.Panel style={{ overflow: 'hidden', minWidth: 300 }}>
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          {showFileUpload ? (
                            <FileUpload
                              onFiles={(fs) => {
                                void handleFiles(fs)
                              }}
                              onLocalPath={(path) => {
                                handleLocalPath(path)
                              }}
                              loading={isLoading}
                              error={errorMessage}
                              fileNames={fileNames}
                            />
                          ) : pendingFiles.length > 0 ? (
                            <PendingFilesView
                              files={pendingFiles}
                              onLoad={handleLoadPendingFile}
                              loading={isLoading}
                              error={errorMessage}
                            />
                          ) : (
                            <Tabs
                              activeKey={activeTab}
                              onChange={(k) => setActiveTab(k as 'log' | 'pcap' | 'hci' | 'trace')}
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
                                totalLogs={
                                  totalLines ??
                                  filterProgress?.total ??
                                  filterProgress?.scanned ??
                                  displayLogs.length
                                }
                                filters={filters}
                                traceResult={traceResult}
                                pcapEntries={pcapEntries}
                                hciEntries={hciEntries}
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

                  {/* FilterDrawer — right-side context-aware filter UI (Ctrl+K) */}
                  <FilterDrawer
                    open={filterDrawerOpen}
                    onOpenChange={setFilterDrawerOpen}
                    activeTab={activeTab}
                    logFilters={filters}
                    onLogFiltersChange={setFilters}
                    logStatistics={stats}
                    highlights={highlights}
                    onHighlightsChange={setHighlights}
                    presets={presets}
                    onPresetsChange={handlePresetsChange}
                    wordWrap={wordWrap}
                    onWordWrapChange={setWordWrap}
                    selectedProjectId={selectedProjectId}
                    traceResult={traceResult}
                    onTraceFilteredResult={setFilteredTraceResult}
                    pcapEntries={pcapEntries}
                    onPcapFilteredEntries={setFilteredPcapEntries}
                    hciEntries={hciEntries}
                    onHciFilteredEntries={setFilteredHciEntries}
                  />
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

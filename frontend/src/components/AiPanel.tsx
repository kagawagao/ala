import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Button,
  Input,
  Typography,
  Space,
  Tooltip,
  Popconfirm,
  App,
  Empty,
  Tag,
  Collapse,
  Select,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
  RobotOutlined,
  UserOutlined,
  CodeOutlined,
  ToolOutlined,
  FileTextOutlined,
  CopyOutlined,
  LinkOutlined,
  BulbOutlined,
  DownloadOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  createSession,
  listSessions,
  deleteSession,
  sendMessage,
  setSessionTrace,
  setSessionLogs,
} from '../api/chat'
import {
  getConfiguredModels,
  groupByProvider,
  loadModelConfigs,
  getActiveModelIds,
  BUILTIN_MODELS,
  loadCustomModels,
} from '../utils/models'
import type {
  Session,
  LogEntry,
  LogFilters,
  TraceParseResult,
  Project,
  AgentEvent,
  ContextDoc,
  AIConfig,
  ModelPreset,
} from '../types'

const { Text } = Typography
const { TextArea } = Input

interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
}

// An ordered sequence of parts within an assistant message
type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool'; call: ToolCallInfo }
  | { type: 'thinking'; content: string }

interface DisplayMessage {
  role: 'user' | 'assistant' | 'system'
  content: string // plain text for session storage / history
  parts?: MessagePart[] // ordered rendering parts (streaming)
  toolCalls?: ToolCallInfo[] // legacy fallback for loaded sessions
  thinkingBlocks?: string[] // legacy fallback for loaded sessions
}

interface AiPanelProps {
  logs: LogEntry[]
  allLogs: LogEntry[]
  totalLogs: number
  filters: LogFilters
  traceResult: TraceParseResult | null
  aiConfigured: boolean
  selectedProjectId: string | null
  projects: Project[]
  contextDocs: ContextDoc[]
  aiConfig?: AIConfig
}

const ThinkingDisplay: React.FC<{ blocks: string[]; thinkingMode?: string }> = ({
  blocks,
  thinkingMode,
}) => {
  const { t } = useTranslation()
  if (blocks.length === 0) return null
  const defaultExpanded = thinkingMode === 'on' ? ['0'] : []
  return (
    <Collapse
      size="small"
      defaultActiveKey={defaultExpanded}
      style={{ marginBottom: 6, fontSize: 11 }}
      items={blocks.map((block, idx) => ({
        key: String(idx),
        label: (
          <Space size={4}>
            <BulbOutlined />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('thinking')}
            </Text>
          </Space>
        ),
        children: (
          <pre
            style={{
              fontSize: 10,
              maxHeight: 200,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {block}
          </pre>
        ),
      }))}
    />
  )
}

const ToolCallDisplay: React.FC<{ toolCalls: ToolCallInfo[] }> = ({ toolCalls }) => {
  const { t } = useTranslation()
  if (toolCalls.length === 0) return null

  return (
    <Collapse
      size="small"
      style={{ marginTop: 6, fontSize: 11 }}
      items={toolCalls.map((tc, idx) => ({
        key: idx,
        label: (
          <Space size={4}>
            <ToolOutlined />
            <Text code style={{ fontSize: 11 }}>
              {tc.name}
            </Text>
            {tc.result && (
              <Tag color="green" style={{ fontSize: 10, lineHeight: '16px' }}>
                {t('done')}
              </Tag>
            )}
          </Space>
        ),
        children: (
          <div style={{ fontSize: 11 }}>
            <div>
              <Text type="secondary">{t('toolArguments')}:</Text>
              <pre
                style={{
                  fontSize: 10,
                  maxHeight: 80,
                  overflow: 'auto',
                  margin: '2px 0',
                  padding: 4,
                  background: 'var(--ant-color-bg-container-disabled)',
                  borderRadius: 4,
                }}
              >
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(tc.arguments), null, 2)
                  } catch {
                    return tc.arguments
                  }
                })()}
              </pre>
            </div>
            {tc.result && (
              <div>
                <Text type="secondary">{t('toolResult')}:</Text>
                <pre
                  style={{
                    fontSize: 10,
                    maxHeight: 120,
                    overflow: 'auto',
                    margin: '2px 0',
                    padding: 4,
                    background: 'var(--ant-color-bg-container-disabled)',
                    borderRadius: 4,
                  }}
                >
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(tc.result), null, 2)
                    } catch {
                      return tc.result
                    }
                  })()}
                </pre>
              </div>
            )}
          </div>
        ),
      }))}
    />
  )
}

const AiPanel: React.FC<AiPanelProps> = ({
  logs: _logs,
  allLogs,
  totalLogs: _totalLogs,
  filters: _filters,
  traceResult,
  aiConfigured,
  selectedProjectId,
  projects,
  contextDocs,
  aiConfig,
}) => {
  const { t } = useTranslation()
  const { message: messageApi } = App.useApp()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  // Per-session model override: sessionId → ModelPreset (null = use global config)
  const [sessionModels, setSessionModels] = useState<Record<string, ModelPreset>>({})
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const logSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track previous project to detect changes (undefined = component not yet mounted)
  const prevProjectIdRef = useRef<string | null | undefined>(undefined)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    listSessions()
      .then((loaded) => {
        setSessions(loaded)
        if (loaded.length > 0) {
          const last = loaded[loaded.length - 1]
          setActiveSessionId(last.id)
          setMessages(last.messages)
        }
      })
      .catch(() => {
        /* backend may not be running */
      })
  }, [])

  // Reset session state whenever the active project changes so the user starts
  // fresh in the context of the new project.
  useEffect(() => {
    // Skip the initial mount — we just record the starting project here.
    if (prevProjectIdRef.current === undefined) {
      prevProjectIdRef.current = selectedProjectId
      return
    }
    if (prevProjectIdRef.current === selectedProjectId) return
    prevProjectIdRef.current = selectedProjectId

    // Abort any in-flight streaming response
    abortRef.current?.abort()
    // Cancel any pending log-sync debounce timer
    if (logSyncTimerRef.current) {
      clearTimeout(logSyncTimerRef.current)
      logSyncTimerRef.current = null
    }
    // Clear all session-related state
    setSessions([])
    setActiveSessionId(null)
    setMessages([])
    setSessionModels({})
    setStreaming(false)
  }, [selectedProjectId])

  // Keep the active session's trace in sync when traceResult changes
  useEffect(() => {
    if (activeSessionId && traceResult) {
      void setSessionTrace(
        activeSessionId,
        traceResult.summary as unknown as Record<string, unknown>,
      )
    }
  }, [traceResult, activeSessionId])

  // Debounced sync of allLogs to the active session (500ms debounce)
  useEffect(() => {
    if (!activeSessionId || allLogs.length === 0) return
    if (logSyncTimerRef.current) clearTimeout(logSyncTimerRef.current)
    logSyncTimerRef.current = setTimeout(() => {
      void setSessionLogs(activeSessionId, allLogs as unknown as Record<string, unknown>[])
    }, 500)
    return () => {
      if (logSyncTimerRef.current) clearTimeout(logSyncTimerRef.current)
    }
  }, [allLogs, activeSessionId])

  // Keyboard shortcut: Cmd/Ctrl+J to focus AI input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        textAreaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleNewSession = async () => {
    try {
      const contextType = allLogs.length > 0 ? 'log' : traceResult ? 'trace' : 'general'
      const session = await createSession(
        `${t('sessionTitle')} ${sessions.length + 1}`,
        contextType,
        selectedProjectId,
      )
      setSessions((prev) => [...prev, session])
      setActiveSessionId(session.id)
      setMessages(session.messages)
      if (traceResult) {
        await setSessionTrace(session.id, traceResult.summary as unknown as Record<string, unknown>)
      }
      if (allLogs.length > 0) {
        await setSessionLogs(session.id, allLogs as unknown as Record<string, unknown>[])
      }
    } catch {
      void messageApi.error(t('backendNotConnected'))
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeSessionId === id) {
        setActiveSessionId(null)
        setMessages([])
      }
    } catch {
      void messageApi.error(t('deleteSessionFailed'))
    }
  }

  const handleSelectSession = (id: string) => {
    const session = sessions.find((s) => s.id === id)
    if (session) {
      setActiveSessionId(id)
      setMessages(session.messages)
    }
  }

  const buildContext = (): string | undefined => {
    if (allLogs.length > 0) {
      return (
        `${allLogs.length} Android log entries are loaded in this session. ` +
        `Use the search_logs tool to filter by level/tag/pid/keyword, ` +
        `or query_log_overview for statistics.`
      )
    }
    if (traceResult) {
      const s = traceResult.summary
      const nProc = s.processes?.length ?? '?'
      const nEv = s.event_count ?? '?'
      const dur = s.duration_ms ?? '?'
      const fmt = traceResult.format ?? 'unknown'
      return (
        `Perfetto trace loaded in this session: format=${fmt}, duration=${dur}ms, ` +
        `${nProc} processes, ${nEv} events. ` +
        `Use the available trace tools (query_trace_overview, list_trace_processes, query_trace_slices) ` +
        `to explore details on demand.`
      )
    }
    return undefined
  }

  const handleSend = async () => {
    if (!inputValue.trim() || !activeSessionId || streaming) return

    // Determine the model config to use: session override has priority, else global config
    const sessionModelConfigs = loadModelConfigs()
    const sessionModelConfig = activeModelPreset
      ? sessionModelConfigs[activeModelPreset.id]
      : undefined
    const canSendNow = aiConfigured || !!sessionModelConfig?.api_key?.trim()

    if (!canSendNow) {
      void messageApi.warning(t('aiNotConfigured'))
      return
    }

    const userMsg: DisplayMessage = { role: 'user', content: inputValue.trim() }
    setMessages((prev) => [...prev, userMsg])
    const sentInput = inputValue
    setInputValue('')
    setStreaming(true)

    const assistantMsg: DisplayMessage = { role: 'assistant', content: '', parts: [] }
    setMessages((prev) => [...prev, assistantMsg])

    abortRef.current = new AbortController()

    // Helper: push or extend the last text part in the parts array
    const appendText = (parts: MessagePart[], delta: string): MessagePart[] => {
      const last = parts[parts.length - 1]
      if (last?.type === 'text') {
        return [...parts.slice(0, -1), { type: 'text', content: last.content + delta }]
      }
      return [...parts, { type: 'text', content: delta }]
    }

    try {
      const context = buildContext()
      let parts: MessagePart[] = []
      let accumulated = '' // plain text for session storage

      const updateMsg = (p: MessagePart[]) => {
        setMessages((prev) => {
          const updated = [...prev]
          const textContent = p
            .filter((x) => x.type === 'text')
            .map((x) => (x as { type: 'text'; content: string }).content)
            .join('')
          updated[updated.length - 1] = { role: 'assistant', content: textContent, parts: p }
          return updated
        })
      }

      for await (const chunk of sendMessage(
        activeSessionId,
        sentInput,
        context,
        abortRef.current.signal,
        activeModelPreset
          ? {
              model: activeModelPreset.model_id,
              api_endpoint: activeModelPreset.api_endpoint,
              anthropic_compatible: activeModelPreset.anthropic_compatible,
              ...sessionModelConfig,
            }
          : undefined,
      )) {
        if (chunk === '[DONE]') break

        // Fast path: plain text chunks (95%+ of events) skip JSON.parse entirely
        if (!chunk.startsWith('{')) {
          accumulated += chunk
          parts = appendText(parts, chunk)
          updateMsg(parts)
          continue
        }

        try {
          const data = JSON.parse(chunk) as AgentEvent | Record<string, unknown>

          if ('type' in data && data.type === 'thinking') {
            const event = data as { type: 'thinking'; content: string }
            parts = [...parts, { type: 'thinking', content: event.content }]
            updateMsg(parts)
            continue
          }

          if ('type' in data && data.type === 'tool_call') {
            const event = data as AgentEvent
            if (event.type === 'tool_call') {
              parts = [
                ...parts,
                { type: 'tool', call: { name: event.name, arguments: event.arguments } },
              ]
              updateMsg(parts)
            }
            continue
          }

          if ('type' in data && data.type === 'tool_result') {
            const event = data as AgentEvent
            if (event.type === 'tool_result') {
              // Find the most recent unresolved tool part with this name and attach result
              const idx = [...parts]
                .reverse()
                .findIndex((p) => p.type === 'tool' && p.call.name === event.name && !p.call.result)
              if (idx !== -1) {
                const realIdx = parts.length - 1 - idx
                const updated = [...parts]
                updated[realIdx] = {
                  type: 'tool',
                  call: {
                    ...(parts[realIdx] as { type: 'tool'; call: ToolCallInfo }).call,
                    result: event.content,
                  },
                }
                parts = updated
                updateMsg(parts)
              }
            }
            continue
          }

          // Regular text content
          const delta =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (data as any).choices?.[0]?.delta?.content ||
            (data as Record<string, unknown>).content ||
            chunk
          if (typeof delta === 'string' && delta) {
            accumulated += delta
            parts = appendText(parts, delta)
            updateMsg(parts)
          }
        } catch {
          // Plain text chunk
          accumulated += chunk
          parts = appendText(parts, chunk)
          updateMsg(parts)
        }
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { role: 'user' as const, content: sentInput },
                  { role: 'assistant' as const, content: accumulated },
                ],
              }
            : s,
        ),
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        void messageApi.error(String(err.message))
        setMessages((prev) => prev.slice(0, -1))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleCopy = async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    } catch {
      void messageApi.error('Copy failed')
    }
  }

  const handleDownload = (content: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ala-response-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const sessionHasProject = !!activeSession?.project_id
  const sessionHasTrace = activeSession?.context_type === 'trace'
  const sessionHasLog = activeSession?.context_type === 'log'

  // Build context indicator info (shows what data is linked to current session)
  const contextInfo =
    allLogs.length > 0
      ? { type: 'log' as const, detail: `${allLogs.length} ${t('logEntries')}` }
      : traceResult
        ? { type: 'trace' as const, detail: t('traceLoaded') }
        : null

  // All models with a configured API key
  const configuredModels = getConfiguredModels()

  // All active models (user-toggled) that also have API keys configured
  const activeModelIds = getActiveModelIds()
  const modelConfigsForActive = loadModelConfigs()
  const activeModels = [...BUILTIN_MODELS, ...loadCustomModels()].filter(
    (m) => activeModelIds.includes(m.id) && !!modelConfigsForActive[m.id]?.api_key?.trim(),
  )

  // The model preset active for this session (may differ from global active model)
  const activeModelPreset = activeSessionId ? sessionModels[activeSessionId] : undefined

  // Whether sending is possible
  const sessionModelConfigs = loadModelConfigs()
  const sessionModelConfigured = !!(
    activeModelPreset && sessionModelConfigs[activeModelPreset.id]?.api_key?.trim()
  )
  const canSend = aiConfigured || sessionModelConfigured

  // Build grouped options for the Select component
  const modelSelectOptions = groupByProvider(configuredModels).map(([provider, models]) => ({
    label: provider,
    options: models.map((m) => ({
      value: m.id,
      label: (
        <Space size={4}>
          <span style={{ fontSize: 12 }}>{m.name}</span>
          {m.description && (
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              · {m.description}
            </span>
          )}
        </Space>
      ),
    })),
  }))

  const handleModelChange = (presetId: string) => {
    if (!activeSessionId) return
    const preset = configuredModels.find((m) => m.id === presetId)
    if (!preset) return
    setSessionModels((prev) => ({ ...prev, [activeSessionId]: preset }))
  }

  // Click an active model chip to switch the session's model
  const handleActiveModelChipClick = (preset: ModelPreset) => {
    if (!activeSessionId) return
    setSessionModels((prev) => ({ ...prev, [activeSessionId]: preset }))
  }

  // The value shown in the Select: active session's preset id, else the global active model id
  const modelSelectValue = activeModelPreset?.id ?? configuredModels[0]?.id ?? undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Session list header */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--ant-color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 13, flex: 1 }}>
          <RobotOutlined /> {t('aiAssistant')}
        </Text>
        <Tooltip title={t('newSession')}>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              void handleNewSession()
            }}
          />
        </Tooltip>
      </div>

      {/* Context docs display */}
      {selectedProjectId && contextDocs.length > 0 && (
        <div
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          <Collapse
            size="small"
            items={[
              {
                key: 'context-docs',
                label: (
                  <Space size={4}>
                    <FileTextOutlined />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('contextDocsFound', { count: contextDocs.length })}
                    </Text>
                  </Space>
                ),
                children: (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {contextDocs.map((doc) => (
                      <Tooltip
                        key={doc.path}
                        title={`${doc.path} (${(doc.size / 1024).toFixed(1)}KB)`}
                      >
                        <Tag color="green">{doc.path}</Tag>
                      </Tooltip>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--ant-color-border)',
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          {sessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tag
                color={s.id === activeSessionId ? 'blue' : 'default'}
                style={{ cursor: 'pointer', margin: 0 }}
                onClick={() => handleSelectSession(s.id)}
              >
                {s.project_id && <CodeOutlined style={{ marginRight: 4 }} />}
                {s.title}
              </Tag>
              <Popconfirm
                title={t('deleteSessionConfirm')}
                onConfirm={() => {
                  void handleDeleteSession(s.id)
                }}
                okText={t('delete')}
                cancelText={t('cancel')}
              >
                <DeleteOutlined style={{ fontSize: 10, color: '#8c8c8c', cursor: 'pointer' }} />
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        {!activeSessionId ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space orientation="vertical" align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('noSessions')}
                </Text>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    void handleNewSession()
                  }}
                >
                  {t('newSession')}
                </Button>
              </Space>
            }
          />
        ) : (
          <>
            {sessionHasProject && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '4px 8px',
                  background: 'var(--ant-color-bg-container-disabled)',
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                <CodeOutlined style={{ marginRight: 4 }} />
                <Text type="secondary">
                  {t('agentMode')}:{' '}
                  {projects.find((p) => p.id === activeSession?.project_id)?.name || t('project')}
                </Text>
              </div>
            )}
            {!sessionHasProject && sessionHasTrace && traceResult && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '4px 8px',
                  background: 'var(--ant-color-bg-container-disabled)',
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                <ToolOutlined style={{ marginRight: 4 }} />
                <Text type="secondary">{t('traceAgentMode')}</Text>
              </div>
            )}
            {!sessionHasProject && sessionHasLog && allLogs.length > 0 && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '4px 8px',
                  background: 'var(--ant-color-bg-container-disabled)',
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                <FileTextOutlined style={{ marginRight: 4 }} />
                <Text type="secondary">
                  {t('logAgentMode')} ({allLogs.length} {t('logEntries')})
                </Text>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: msg.role === 'user' ? '#1677ff' : '#722ed1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {msg.role === 'user' ? (
                    <UserOutlined style={{ color: '#fff', fontSize: 13 }} />
                  ) : (
                    <RobotOutlined style={{ color: '#fff', fontSize: 13 }} />
                  )}
                </div>
                <div
                  style={{ maxWidth: '80%', position: 'relative' }}
                  className={`ai-bubble-wrapper${msg.role === 'user' ? ' ai-bubble-user' : ''}`}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius:
                        msg.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                      background:
                        msg.role === 'user' ? '#1677ff' : 'var(--ant-color-bg-container-disabled)',
                      color: msg.role === 'user' ? '#fff' : 'inherit',
                      fontSize: 13,
                      lineHeight: 1.5,
                      overflowX: 'auto',
                      wordBreak: 'break-word',
                    }}
                    className="ai-message-content"
                  >
                    {msg.role === 'assistant' ? (
                      <>
                        {msg.parts && msg.parts.length > 0 ? (
                          // Ordered parts rendering (streaming messages)
                          <>
                            {msg.parts.map((part, pIdx) => {
                              if (part.type === 'thinking') {
                                return (
                                  <ThinkingDisplay
                                    key={pIdx}
                                    blocks={[part.content]}
                                    thinkingMode={aiConfig?.thinking_mode}
                                  />
                                )
                              }
                              if (part.type === 'tool') {
                                return <ToolCallDisplay key={pIdx} toolCalls={[part.call]} />
                              }
                              // text part
                              return part.content ? (
                                <ReactMarkdown key={pIdx} remarkPlugins={[remarkGfm]}>
                                  {part.content}
                                </ReactMarkdown>
                              ) : null
                            })}
                            {streaming && idx === messages.length - 1 && !msg.content && (
                              <span className="typing-indicator">
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                              </span>
                            )}
                          </>
                        ) : (
                          // Legacy fallback for session-loaded messages
                          <>
                            {msg.thinkingBlocks && msg.thinkingBlocks.length > 0 && (
                              <ThinkingDisplay
                                blocks={msg.thinkingBlocks}
                                thinkingMode={aiConfig?.thinking_mode}
                              />
                            )}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <ToolCallDisplay toolCalls={msg.toolCalls} />
                            )}
                            {msg.content ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            ) : streaming && idx === messages.length - 1 ? (
                              <span className="typing-indicator">
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                              </span>
                            ) : msg.toolCalls?.length ? null : (
                              <Text type="secondary">...</Text>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    )}
                    {msg.role === 'assistant' &&
                      streaming &&
                      idx === messages.length - 1 &&
                      msg.content && <span className="typing-cursor" />}
                  </div>
                  {msg.role === 'assistant' &&
                    msg.content &&
                    !(streaming && idx === messages.length - 1) && (
                      <div
                        style={{
                          position: 'absolute',
                          right: 2,
                          bottom: -24,
                          display: 'flex',
                          gap: 2,
                        }}
                      >
                        <Tooltip title={copiedIdx === idx ? t('copied') : t('copy')}>
                          <Button
                            className="ai-copy-btn"
                            type="text"
                            size="small"
                            icon={copiedIdx === idx ? <LinkOutlined /> : <CopyOutlined />}
                            onClick={() => {
                              void handleCopy(msg.content, idx)
                            }}
                            style={{
                              fontSize: 12,
                              opacity: copiedIdx === idx ? 1 : undefined,
                              color:
                                copiedIdx === idx
                                  ? 'var(--ant-color-success)'
                                  : 'var(--ant-color-text-tertiary)',
                            }}
                          />
                        </Tooltip>
                        <Tooltip title={t('downloadMarkdown')}>
                          <Button
                            className="ai-copy-btn"
                            type="text"
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={() => handleDownload(msg.content)}
                            style={{
                              fontSize: 12,
                              color: 'var(--ant-color-text-tertiary)',
                            }}
                          />
                        </Tooltip>
                      </div>
                    )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      {activeSessionId && (
        <div
          style={{
            padding: '8px 10px',
            borderTop: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          {!canSend && (
            <Text type="warning" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
              {t('aiNotConfigured')}
            </Text>
          )}
          {contextInfo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginBottom: 6,
                fontSize: 11,
                color: 'var(--ant-color-text-secondary)',
              }}
            >
              <LinkOutlined style={{ fontSize: 11 }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {contextInfo.detail}
              </Text>
              <Tag color="green" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                {t('autoIncluded')}
              </Tag>
            </div>
          )}
          {/* Active model chips — quick switch */}
          {activeModels.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
              <Text type="secondary" style={{ fontSize: 10 }}>
                {t('activeModels')}:
              </Text>
              {activeModels.map((m) => {
                const isSelected = activeModelPreset?.id === m.id
                return (
                  <Tag
                    key={m.id}
                    color={isSelected ? 'blue' : 'default'}
                    style={{
                      cursor: 'pointer',
                      fontSize: 11,
                      lineHeight: '18px',
                      margin: 0,
                    }}
                    onClick={() => handleActiveModelChipClick(m)}
                  >
                    {m.name}
                  </Tag>
                )
              })}
            </div>
          )}
          {/* Model selector for this session */}
          {configuredModels.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <SwapOutlined style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }} />
              <Select
                size="small"
                style={{ flex: 1, fontSize: 11 }}
                placeholder={t('switchModel')}
                value={modelSelectValue}
                onChange={handleModelChange}
                disabled={streaming}
                options={modelSelectOptions}
                optionLabelProp="label"
                popupMatchSelectWidth={false}
              />
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <TextArea
              ref={textAreaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`${t('typeMessage')}  (Shift+Enter ${t('newLine') || '换行'})`}
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={streaming}
              style={{ fontSize: 13, paddingRight: 42 }}
            />
            <div style={{ position: 'absolute', right: 6, bottom: 6 }}>
              {streaming ? (
                <Button
                  icon={<StopOutlined />}
                  onClick={handleStop}
                  danger
                  size="small"
                  type="text"
                />
              ) : (
                <Button
                  type="text"
                  icon={<SendOutlined />}
                  onClick={() => {
                    void handleSend()
                  }}
                  disabled={!inputValue.trim() || !canSend}
                  size="small"
                  style={{
                    color: inputValue.trim() && canSend ? 'var(--ant-color-primary)' : undefined,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiPanel

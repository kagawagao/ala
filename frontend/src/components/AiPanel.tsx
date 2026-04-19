import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Button,
  Input,
  Typography,
  Space,
  Tooltip,
  Select,
  Popconfirm,
  message,
  Empty,
  Tag,
  Spin,
  Collapse,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
  PaperClipOutlined,
  RobotOutlined,
  UserOutlined,
  CodeOutlined,
  ToolOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createSession, listSessions, deleteSession, sendMessage } from '../api/chat'
import type {
  Session,
  LogEntry,
  LogFilters,
  TraceParseResult,
  Project,
  AgentEvent,
  ContextDoc,
} from '../types'

const { Text } = Typography
const { TextArea } = Input

const PRESET_KEYS = ['general', 'crash', 'performance', 'security'] as const

const PRESET_PROMPTS: Record<string, string> = {
  general: 'Please analyze the following Android log and provide a summary of what happened.',
  crash:
    'Please analyze this Android log for crashes, exceptions, and fatal errors. Identify root causes and suggest fixes.',
  performance:
    'Please analyze this Android log for performance issues: ANRs, slow operations, memory issues, and bottlenecks.',
  security:
    'Please analyze this Android log for security issues: permission errors, authentication failures, and suspicious activity.',
}

interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCallInfo[]
}

interface AiPanelProps {
  logs: LogEntry[]
  totalLogs: number
  filters: LogFilters
  traceResult: TraceParseResult | null
  aiConfigured: boolean
  selectedProjectId: string | null
  projects: Project[]
  contextDocs: ContextDoc[]
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
  logs,
  totalLogs,
  filters,
  traceResult,
  aiConfigured,
  selectedProjectId,
  projects,
  contextDocs,
}) => {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [preset, setPreset] = useState('general')
  const [contextAttached, setContextAttached] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const aiPresets = PRESET_KEYS.map((key) => ({
    value: key,
    label: t(`preset${key.charAt(0).toUpperCase()}${key.slice(1)}` as never),
  }))

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => {
        /* backend may not be running */
      })
  }, [])

  const handleNewSession = async () => {
    try {
      const contextType = logs.length > 0 ? 'log' : traceResult ? 'trace' : 'general'
      const session = await createSession(
        `${t('sessionTitle')} ${sessions.length + 1}`,
        contextType,
        selectedProjectId,
      )
      setSessions((prev) => [...prev, session])
      setActiveSessionId(session.id)
      setMessages(session.messages)
      setContextAttached(false)
    } catch {
      void message.error(t('backendNotConnected'))
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
      void message.error(t('deleteSessionFailed'))
    }
  }

  const handleSelectSession = (id: string) => {
    const session = sessions.find((s) => s.id === id)
    if (session) {
      setActiveSessionId(id)
      setMessages(session.messages)
      setContextAttached(false)
    }
  }

  const buildFilterSummary = (): string | null => {
    const parts: string[] = []
    if (filters.level) parts.push(`level=${filters.level}`)
    if (filters.tag) parts.push(`tag="${filters.tag}"`)
    if (filters.pid) parts.push(`pid=${filters.pid}`)
    if (filters.tid) parts.push(`tid=${filters.tid}`)
    if (filters.keywords) parts.push(`keywords="${filters.keywords}"`)
    if (filters.start_time) parts.push(`start_time="${filters.start_time}"`)
    if (filters.end_time) parts.push(`end_time="${filters.end_time}"`)
    return parts.length > 0 ? parts.join(', ') : null
  }

  const buildContext = (): string | undefined => {
    if (!contextAttached) return undefined
    if (logs.length > 0) {
      const sample = logs.slice(0, 200)
      const filterSummary = buildFilterSummary()
      const countNote =
        filterSummary !== null
          ? `${logs.length} of ${totalLogs} entries (filtered by: ${filterSummary})`
          : `${logs.length} entries`
      const showingNote = logs.length > 200 ? `, showing first 200` : ''
      return `Log context (${countNote}${showingNote}):\n\`\`\`\n${sample.map((l) => l.raw_line).join('\n')}\n\`\`\``
    }
    if (traceResult) {
      return `Trace context:\n${JSON.stringify(traceResult.summary, null, 2)}`
    }
    return undefined
  }

  const handleSend = async () => {
    if (!inputValue.trim() || !activeSessionId || streaming) return
    if (!aiConfigured) {
      void message.warning(t('aiNotConfigured'))
      return
    }

    const userMsg: DisplayMessage = { role: 'user', content: inputValue.trim() }
    setMessages((prev) => [...prev, userMsg])
    const sentInput = inputValue
    setInputValue('')
    setStreaming(true)

    const assistantMsg: DisplayMessage = { role: 'assistant', content: '', toolCalls: [] }
    setMessages((prev) => [...prev, assistantMsg])

    abortRef.current = new AbortController()

    try {
      const context = buildContext()
      const messageToSend =
        preset !== 'general' && context ? `${PRESET_PROMPTS[preset]}\n\n${sentInput}` : sentInput

      let accumulated = ''
      const toolCalls: ToolCallInfo[] = []

      for await (const chunk of sendMessage(
        activeSessionId,
        messageToSend,
        context,
        abortRef.current.signal,
      )) {
        if (chunk === '[DONE]') break
        try {
          const data = JSON.parse(chunk) as AgentEvent | Record<string, unknown>
          if ('type' in data && data.type === 'tool_call') {
            const event = data as AgentEvent
            if (event.type === 'tool_call') {
              toolCalls.push({ name: event.name, arguments: event.arguments })
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulated,
                  toolCalls: [...toolCalls],
                }
                return updated
              })
            }
            continue
          }
          if ('type' in data && data.type === 'tool_result') {
            const event = data as AgentEvent
            if (event.type === 'tool_result') {
              const lastTc = [...toolCalls]
                .reverse()
                .find((tc: ToolCallInfo) => tc.name === event.name && !tc.result)
              if (lastTc) {
                lastTc.result = event.content
              }
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: accumulated,
                  toolCalls: [...toolCalls],
                }
                return updated
              })
            }
            continue
          }
          // Regular content in JSON format
          const delta =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (data as any).choices?.[0]?.delta?.content ||
            (data as Record<string, unknown>).content ||
            chunk
          accumulated += delta
        } catch {
          // Plain text chunk
          accumulated += chunk
        }
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: accumulated,
            toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
          }
          return updated
        })
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
        void message.error(String(err.message))
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const sessionHasProject = !!activeSession?.project_id
  const hasContext = logs.length > 0 || traceResult != null

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
                  style={{
                    maxWidth: '80%',
                    padding: '8px 10px',
                    borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                    background:
                      msg.role === 'user' ? '#1677ff' : 'var(--ant-color-bg-container-disabled)',
                    color: msg.role === 'user' ? '#fff' : 'inherit',
                    fontSize: 13,
                    lineHeight: 1.5,
                    overflow: 'hidden',
                  }}
                  className={msg.role === 'assistant' ? 'ai-message-content' : undefined}
                >
                  {msg.role === 'assistant' ? (
                    <>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ToolCallDisplay toolCalls={msg.toolCalls} />
                      )}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content || (msg.toolCalls?.length ? '' : '...')}
                      </ReactMarkdown>
                    </>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                  )}
                  {msg.role === 'assistant' && streaming && idx === messages.length - 1 && (
                    <Spin size="small" style={{ marginLeft: 6 }} />
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
          {!aiConfigured && (
            <Text type="warning" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
              {t('aiNotConfigured')}
            </Text>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <Select
              size="small"
              value={preset}
              onChange={setPreset}
              options={aiPresets}
              style={{ flex: 1 }}
            />
            {hasContext && logs.length > 0 && (
              <Tooltip
                title={t(contextAttached ? 'contextAttachedFiltered' : 'attachContextFiltered', {
                  filtered: logs.length,
                  total: totalLogs,
                })}
              >
                <Button
                  size="small"
                  icon={<PaperClipOutlined />}
                  type={contextAttached ? 'primary' : 'default'}
                  onClick={() => setContextAttached((v) => !v)}
                />
              </Tooltip>
            )}
            {hasContext && logs.length === 0 && (
              <Tooltip title={contextAttached ? t('contextAttached') : t('attachContext')}>
                <Button
                  size="small"
                  icon={<PaperClipOutlined />}
                  type={contextAttached ? 'primary' : 'default'}
                  onClick={() => setContextAttached((v) => !v)}
                />
              </Tooltip>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('typeMessage')}
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={streaming}
              style={{ fontSize: 13 }}
            />
            {streaming ? (
              <Button icon={<StopOutlined />} onClick={handleStop} danger style={{ flexShrink: 0 }}>
                {t('stop')}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => {
                  void handleSend()
                }}
                disabled={!inputValue.trim() || !aiConfigured}
                style={{ flexShrink: 0 }}
              >
                {t('send')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AiPanel

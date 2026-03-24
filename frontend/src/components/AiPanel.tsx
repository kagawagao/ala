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
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
  PaperClipOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createSession, listSessions, deleteSession, sendMessage } from '../api/chat'
import type { Session, ChatMessage, LogEntry, TraceParseResult } from '../types'

const { Text } = Typography
const { TextArea } = Input

const AI_PRESETS = [
  { value: 'general', label: 'General Analysis' },
  { value: 'crash', label: 'Crash Analysis' },
  { value: 'performance', label: 'Performance Analysis' },
  { value: 'security', label: 'Security Analysis' },
]

const PRESET_PROMPTS: Record<string, string> = {
  general: 'Please analyze the following Android log and provide a summary of what happened.',
  crash: 'Please analyze this Android log for crashes, exceptions, and fatal errors. Identify root causes and suggest fixes.',
  performance: 'Please analyze this Android log for performance issues: ANRs, slow operations, memory issues, and bottlenecks.',
  security: 'Please analyze this Android log for security issues: permission errors, authentication failures, and suspicious activity.',
}

interface AiPanelProps {
  logs: LogEntry[]
  traceResult: TraceParseResult | null
  aiConfigured: boolean
}

const AiPanel: React.FC<AiPanelProps> = ({ logs, traceResult, aiConfigured }) => {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [preset, setPreset] = useState('general')
  const [contextAttached, setContextAttached] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => {/* backend may not be running */})
  }, [])

  const handleNewSession = async () => {
    try {
      const session = await createSession(
        `${t('sessionTitle')} ${sessions.length + 1}`,
        logs.length > 0 ? 'log' : traceResult ? 'trace' : 'general',
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
      void message.error('Failed to delete session')
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

  const buildContext = (): string | undefined => {
    if (!contextAttached) return undefined
    if (logs.length > 0) {
      const sample = logs.slice(0, 200)
      return `Log context (${logs.length} total entries, showing first 200):\n\`\`\`\n${sample.map((l) => l.raw_line).join('\n')}\n\`\`\``
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

    const userMsg: ChatMessage = { role: 'user', content: inputValue.trim() }
    setMessages((prev) => [...prev, userMsg])
    const sentInput = inputValue
    setInputValue('')
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages((prev) => [...prev, assistantMsg])

    abortRef.current = new AbortController()

    try {
      const context = buildContext()
      const messageToSend = preset !== 'general' && context
        ? `${PRESET_PROMPTS[preset]}\n\n${sentInput}`
        : sentInput

      let accumulated = ''
      for await (const chunk of sendMessage(
        activeSessionId,
        messageToSend,
        context,
        abortRef.current.signal,
      )) {
        if (chunk === '[DONE]') break
        try {
          const data = JSON.parse(chunk)
          const delta = data.choices?.[0]?.delta?.content || data.content || chunk
          accumulated += delta
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: accumulated }
            return updated
          })
        } catch {
          accumulated += chunk
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: accumulated }
            return updated
          })
        }
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  userMsg,
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
          <Button size="small" icon={<PlusOutlined />} onClick={() => { void handleNewSession() }} />
        </Tooltip>
      </div>

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
                {s.title}
              </Tag>
              <Popconfirm
                title={t('deleteSessionConfirm')}
                onConfirm={() => { void handleDeleteSession(s.id) }}
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
              <Space direction="vertical" align="center">
                <Text type="secondary" style={{ fontSize: 12 }}>{t('noSessions')}</Text>
                <Button size="small" icon={<PlusOutlined />} onClick={() => { void handleNewSession() }}>
                  {t('newSession')}
                </Button>
              </Space>
            }
          />
        ) : (
          <>
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
                    background: msg.role === 'user' ? '#1677ff' : 'var(--ant-color-bg-container-disabled)',
                    color: msg.role === 'user' ? '#fff' : 'inherit',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || '...'}</ReactMarkdown>
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
              options={AI_PRESETS}
              style={{ flex: 1 }}
            />
            {hasContext && (
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
              <Button
                icon={<StopOutlined />}
                onClick={handleStop}
                danger
                style={{ flexShrink: 0 }}
              >
                {t('stop')}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => { void handleSend() }}
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

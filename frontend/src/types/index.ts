export interface LogEntry {
  line_number: number
  timestamp: string | null
  pid: string | null
  tid: string | null
  level: string
  tag: string
  message: string
  raw_line: string
  source_file: string | null
}

export interface LogFilters {
  start_time: string
  end_time: string
  keywords: string
  level: string
  tag: string
  pid: string
  tid: string
  tag_keyword_relation: 'AND' | 'OR'
}

export interface HighlightItem {
  pattern: string
  color: string
}

export interface LogStatistics {
  total: number
  by_level: Record<string, number>
  tags: Record<string, number>
  pids: Record<string, number>
}

export interface ParseResult {
  logs: LogEntry[]
  total_lines: number
  format_detected: string
}

export interface TraceFilterRequest {
  result: TraceParseResult
  pids?: number[]
  process_name?: string
}

export interface TraceSummary {
  duration_ms: number | null
  process_count: number
  thread_count: number
  event_count: number
  processes: Array<{ pid: number; name: string; thread_count: number }>
  top_slices: Array<{ name: string; count: number; duration_ms: number }>
  ftrace_events: string[]
  metadata: Record<string, unknown>
}

export interface TraceParseResult {
  summary: TraceSummary
  format: string
  file_size: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface Session {
  id: string
  title: string
  messages: ChatMessage[]
  created_at: string
  context_type: 'log' | 'trace' | 'general'
  project_id: string | null
}

export interface AIConfig {
  api_endpoint: string
  api_key: string
  model: string
  temperature: number
  thinking_mode: 'off' | 'auto' | 'on'
  thinking_budget_tokens: number
  /** When set, overrides endpoint-based auto-detection of the API format. */
  anthropic_compatible?: boolean
}

export interface ModelConfig {
  api_key: string
  temperature: number
  thinking_mode: 'off' | 'auto' | 'on'
  thinking_budget_tokens: number
}

export interface FilterPreset {
  id: string
  name: string
  description?: string
  filters: LogFilters
}

export interface ModelPreset {
  id: string
  name: string
  provider: string
  model_id: string
  api_endpoint: string
  description?: string
  builtin?: boolean
  /** Whether this model requires the Anthropic API format (vs OpenAI-compatible). */
  anthropic_compatible?: boolean
  /** Whether this model supports thinking/reasoning mode as configured in this app. */
  supports_thinking?: boolean
}

export interface Project {
  id: string
  name: string
  paths: string[]
  include_patterns: string[]
  exclude_patterns: string[]
  filter_presets: FilterPreset[]
  created_at: string
}

export interface CreateProjectRequest {
  name: string
  paths: string[]
  include_patterns?: string[]
  exclude_patterns?: string[]
}

export interface ProjectFileInfo {
  path: string
  size: number
  extension: string
}

export interface LocalFileRef {
  session_file: string
  line_count: number
  size_bytes: number
  format_detected: string
  is_gzip: boolean
  is_zip: boolean
}

export interface ContextDoc {
  path: string
  content: string
  size: number
}

export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  arguments: string
}

export interface ToolResultEvent {
  type: 'tool_result'
  name: string
  content: string
}

export interface ThinkingEvent {
  type: 'thinking'
  content: string
}

export interface MaxRoundsReachedEvent {
  type: 'max_rounds_reached'
  message: string
}

export type AgentEvent = ToolCallEvent | ToolResultEvent | ThinkingEvent | MaxRoundsReachedEvent

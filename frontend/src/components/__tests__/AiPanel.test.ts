import { describe, it, expect } from 'vitest'
import {
  processSSEChunk,
  createSSEState,
  extractToolLogEntries,
  type MessagePart,
  type ToolCallInfo,
} from '../../utils/sseParser'

function textPart(content: string): MessagePart {
  return { type: 'text', content }
}

function thinkingPart(content: string): MessagePart {
  return { type: 'thinking', content }
}

function toolPart(name: string, args: string, result?: string): MessagePart {
  return { type: 'tool', call: { name, arguments: args, result } }
}

describe('processSSEChunk', () => {
  // AC2: Plain text chunk → accumulated + text part
  it('appends plain text chunk to accumulated and parts', () => {
    const initial = createSSEState()
    const result = processSSEChunk('Hello ', initial)
    expect(result.accumulated).toBe('Hello ')
    expect(result.parts).toEqual([textPart('Hello ')])
  })

  // AC3: thinking event → thinking block
  it('adds thinking block for thinking event', () => {
    const initial = createSSEState()
    const chunk = '{"type":"thinking","content":"Let me analyze this..."}'
    const result = processSSEChunk(chunk, initial)
    expect(result.parts).toEqual([thinkingPart('Let me analyze this...')])
    expect(result.accumulated).toBe('')
  })

  // AC4: tool_call event → tool block (no result)
  it('adds tool block for tool_call event', () => {
    const initial = createSSEState()
    const chunk =
      '{"type":"tool_call","name":"search_local_log","arguments":"{\\"query\\":\\"error\\"}"}'
    const result = processSSEChunk(chunk, initial)
    expect(result.parts).toEqual([toolPart('search_local_log', '{"query":"error"}')])
    expect(result.parts[0].type).toBe('tool')
    expect((result.parts[0] as { type: 'tool'; call: ToolCallInfo }).call.result).toBeUndefined()
  })

  // AC5: tool_result event (matching) → result attached to tool
  it('attaches tool_result to matching tool_call by name', () => {
    // Start with a tool_call already processed
    let state = createSSEState()
    state = processSSEChunk(
      '{"type":"tool_call","name":"search_local_log","arguments":"{}"}',
      state,
    )

    // Tool result arrives
    const resultChunk =
      '{"type":"tool_result","name":"search_local_log","content":"{\\"entries\\":[],\\"total_matches\\":0}"}'
    state = processSSEChunk(resultChunk, state)

    expect(state.parts.length).toBe(1)
    const toolP = state.parts[0] as { type: 'tool'; call: ToolCallInfo }
    expect(toolP.type).toBe('tool')
    expect(toolP.call.name).toBe('search_local_log')
    expect(toolP.call.result).toBe('{"entries":[],"total_matches":0}')
  })

  // AC6: max_rounds_reached → continueMessage set
  it('sets continueMessage for max_rounds_reached event', () => {
    const initial = createSSEState()
    const chunk = '{"type":"max_rounds_reached","message":"Maximum rounds reached. Continue?"}'
    const result = processSSEChunk(chunk, initial)
    expect(result.continueMessage).toBe('Maximum rounds reached. Continue?')
  })

  // AC7: agent_meta → silently discarded
  it('silently discards agent_meta events', () => {
    const initial = createSSEState()
    const initialWithText = processSSEChunk('Some text.', initial)
    const chunk = '{"type":"agent_meta","round":3,"tool_calls":5}'
    const result = processSSEChunk(chunk, initialWithText)
    // State should be identical to before agent_meta
    expect(result.parts).toEqual(initialWithText.parts)
    expect(result.accumulated).toEqual(initialWithText.accumulated)
    expect(result.continueMessage).toEqual(initialWithText.continueMessage)
  })

  // AC8: OpenAI delta format → text appended
  it('extracts delta from OpenAI choices format', () => {
    const initial = createSSEState()
    const chunk = '{"choices":[{"delta":{"content":"Hello"}}]}'
    const result = processSSEChunk(chunk, initial)
    expect(result.accumulated).toBe('Hello')
    expect(result.parts).toEqual([textPart('Hello')])
  })

  // AC9: [DONE] signal → state unchanged
  it('returns state unchanged for [DONE] signal', () => {
    const initial = processSSEChunk('Some text.', createSSEState())
    const result = processSSEChunk('[DONE]', initial)
    expect(result).toEqual(initial)
  })

  // AC10: Multiple text chunks concatenated
  it('concatenates consecutive text chunks into single text part', () => {
    let state = createSSEState()
    state = processSSEChunk('Hello ', state)
    state = processSSEChunk('world', state)
    expect(state.accumulated).toBe('Hello world')
    expect(state.parts).toEqual([textPart('Hello world')])
    expect(state.parts.length).toBe(1)
  })

  // AC11: tool_call + tool_result pairing through name matching
  it('pairs tool_result with correct tool_call when multiple tools exist', () => {
    let state = createSSEState()
    // Tool A
    state = processSSEChunk(
      '{"type":"tool_call","name":"search_local_log","arguments":"{}"}',
      state,
    )
    // Tool B
    state = processSSEChunk('{"type":"tool_call","name":"read_log_range","arguments":"{}"}', state)
    // Result for Tool B (should match most recent unresolved)
    state = processSSEChunk(
      '{"type":"tool_result","name":"read_log_range","content":"B result"}',
      state,
    )

    const parts = state.parts as Array<{ type: 'tool'; call: ToolCallInfo }>
    expect(parts[0].call.name).toBe('search_local_log')
    expect(parts[0].call.result).toBeUndefined()
    expect(parts[1].call.name).toBe('read_log_range')
    expect(parts[1].call.result).toBe('B result')
  })

  // AC12: JSON parse failure → treated as plain text
  it('treats JSON parse failure as plain text', () => {
    const initial = createSSEState()
    const result = processSSEChunk('{invalid json', initial)
    expect(result.accumulated).toBe('{invalid json')
    expect(result.parts).toEqual([textPart('{invalid json')])
  })

  // Additional: tool_result with no matching tool — ignored
  it('ignores tool_result when no matching unresolved tool exists', () => {
    const initial = createSSEState()
    const chunk = '{"type":"tool_result","name":"nonexistent","content":"orphan"}'
    const result = processSSEChunk(chunk, initial)
    expect(result.parts).toEqual([])
  })

  // Additional: empty JSON object with content field → text
  it('extracts content from JSON object without type', () => {
    const initial = createSSEState()
    const chunk = '{"content":"direct content"}'
    const result = processSSEChunk(chunk, initial)
    expect(result.accumulated).toBe('direct content')
    expect(result.parts).toEqual([textPart('direct content')])
  })

  // Additional: text chunk between tool_call and tool_result
  it('preserves text between tool events', () => {
    let state = createSSEState()
    state = processSSEChunk(
      '{"type":"tool_call","name":"search_local_log","arguments":"{}"}',
      state,
    )
    state = processSSEChunk('Searching logs...', state)
    state = processSSEChunk(
      '{"type":"tool_result","name":"search_local_log","content":"found"}',
      state,
    )
    // Should have: tool part (with result), text part
    expect(state.parts.length).toBe(2)
    expect(state.parts[0].type).toBe('tool')
    expect(state.parts[1].type).toBe('text')
    expect((state.parts[1] as { type: 'text'; content: string }).content).toBe('Searching logs...')
  })

  // Additional: consecutive thinking blocks
  it('handles multiple thinking blocks correctly', () => {
    let state = createSSEState()
    state = processSSEChunk('{"type":"thinking","content":"Step 1"}', state)
    state = processSSEChunk('{"type":"thinking","content":"Step 2"}', state)
    expect(state.parts).toEqual([thinkingPart('Step 1'), thinkingPart('Step 2')])
  })
})

describe('createSSEState', () => {
  it('creates empty initial state', () => {
    const state = createSSEState()
    expect(state.parts).toEqual([])
    expect(state.accumulated).toBe('')
    expect(state.continueMessage).toBeNull()
  })
})

describe('extractToolLogEntries', () => {
  it('returns empty array for non-log tools', () => {
    const result = extractToolLogEntries('other_tool', '{"entries":[{"line_number":1}]}')
    expect(result).toEqual([])
  })

  it('extracts entries from search_local_log result', () => {
    const content = JSON.stringify({
      entries: [
        {
          line_number: 1,
          timestamp: '12:00:00',
          level: 'I',
          tag: 'Test',
          pid: '100',
          tid: '200',
          message: 'hello',
          raw_line: 'hello',
          source_file: null,
        },
      ],
      total_matches: 1,
    })
    const result = extractToolLogEntries('search_local_log', content)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
    expect(result[0].level).toBe('I')
  })

  it('extracts entries from read_log_range result', () => {
    const content = JSON.stringify({
      entries: [
        {
          line_number: 10,
          timestamp: null,
          level: 'E',
          tag: 'Crash',
          pid: '1',
          tid: '1',
          message: 'error',
          raw_line: 'error',
          source_file: null,
        },
      ],
    })
    const result = extractToolLogEntries('read_log_range', content)
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('E')
  })

  it('returns empty array on JSON parse failure', () => {
    const result = extractToolLogEntries('search_local_log', '{invalid')
    expect(result).toEqual([])
  })

  it('returns empty array when entries is not an array', () => {
    const result = extractToolLogEntries('search_local_log', '{"entries": "not an array"}')
    expect(result).toEqual([])
  })
})

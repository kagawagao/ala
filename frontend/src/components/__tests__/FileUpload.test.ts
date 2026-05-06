import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectFileTypeByHeader } from '../FileUpload'

/**
 * Helper: create a mock File with controlled content (as ArrayBuffer) and name.
 */
function mockFile(name: string, bytes: Uint8Array): File {
  const blob = new Blob([bytes.buffer as ArrayBuffer])
  const file = new File([blob], name, { type: 'application/octet-stream' })

  // Mock slice() to return a Blob with the correct arrayBuffer()
  vi.spyOn(file, 'slice').mockImplementation((start?: number, end?: number) => {
    const s = start ?? 0
    const e = end ?? bytes.byteLength
    const sliced = bytes.slice(s, e)
    const slicedBlob = new Blob([sliced.buffer as ArrayBuffer])
    // Ensure arrayBuffer works on the sliced blob
    vi.spyOn(slicedBlob, 'arrayBuffer').mockResolvedValue(sliced.buffer.slice(0))
    return slicedBlob
  })

  return file
}

/**
 * Helper: create a mock File that throws on slice().
 */
function mockFileSliceThrows(name: string): File {
  const file = new File([''], name)
  vi.spyOn(file, 'slice').mockImplementation(() => {
    throw new Error('cannot read file')
  })
  return file
}

/**
 * Helper: create a mock File with text content.
 */
function mockTextFile(name: string, content: string): File {
  const encoder = new TextEncoder()
  return mockFile(name, encoder.encode(content))
}

describe('detectFileTypeByHeader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // AC2: GZ magic bytes (1F 8B) → 'log'
  it('identifies GZ magic bytes as log', async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00])
    const file = mockFile('test.gz', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC3: ZIP magic bytes (50 4B) → 'log'
  it('identifies ZIP magic bytes as log', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const file = mockFile('test.zip', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC4: Binary control bytes > 4 → 'trace'
  it('detects binary proto trace when control bytes exceed 4', async () => {
    // Create 256 bytes with 8 control bytes (0x00-0x07, excluding tab/lf/cr)
    const bytes = new Uint8Array(256)
    // Fill with printable 'A'
    bytes.fill(0x41)
    // Insert 8 control bytes at the start
    ;[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07].forEach((b, i) => {
      bytes[i] = b
    })
    const file = mockFile('trace.pb', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  // AC4 edge: exactly 4 control bytes → not trace (threshold is > 4)
  it('does not flag as trace when exactly 4 control bytes', async () => {
    const bytes = new Uint8Array(256)
    bytes.fill(0x41)
    // Only 4 control bytes
    ;[0x00, 0x01, 0x02, 0x03].forEach((b, i) => {
      bytes[i] = b
    })
    const file = mockFile('test.log', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log') // Falls through to extension fallback via text analysis
  })

  // AC5: JSON with "traceEvents" → 'trace'
  it('identifies JSON with traceEvents as trace', async () => {
    const content = '{"traceEvents": [{"ph": "X", "name": "test"}]}'
    const file = mockTextFile('trace.json', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  // AC6: Chrome Trace Event Format "ph" → 'trace'
  it('identifies Chrome trace format with ph key as trace', async () => {
    const content = '{"traceEvents": [{"ph": "B", "name": "draw"}]}'
    const file = mockTextFile('trace.json', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  // AC7: Plain text log → 'log'
  it('identifies plain text as log', async () => {
    const content = '01-01 12:00:00.000  1000  1000 I TestTag: Hello World\n'
    const file = mockTextFile('test.log', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC8: Extension fallback — .pb → 'trace', .log/.txt/.logcat → 'log'
  it('falls back to extension .pb for trace', async () => {
    // Plain text content but .pb extension → still trace (extension wins for known trace types)
    const content = 'some random binary-like but text content here'
    const file = mockTextFile('systrace.pb', content)
    const result = await detectFileTypeByHeader(file)
    // .pb is in TRACE_EXTS, and the text content won't have controlBytes > 4,
    // won't match gz/zip magic, won't contain traceEvents/ph → falls to extension check
    expect(result).toBe('trace')
  })

  it('falls back to extension .log for log', async () => {
    const content = '01-01 12:00:00.000  1000  1000 I Tag: Test'
    const file = mockTextFile('test.log', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  it('falls back to extension .txt for log', async () => {
    const content = 'some log content'
    const file = mockTextFile('test.txt', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  it('falls back to extension .logcat for log', async () => {
    const content = 'some logcat content'
    const file = mockTextFile('test.logcat', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC9: Empty file (0 bytes) → extension-based
  it('handles empty file by extension (.pb → trace)', async () => {
    const bytes = new Uint8Array(0)
    const file = mockFile('empty.pb', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  it('handles empty file by extension (.log → log)', async () => {
    const bytes = new Uint8Array(0)
    const file = mockFile('empty.log', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC10: CJK characters (UTF-8 high bytes 0x80-0xFF) not misdetected as binary
  it('does not flag CJK UTF-8 bytes as binary trace', async () => {
    // Chinese characters encoded as UTF-8
    const content = '日志内容：这是一条测试消息\n'.repeat(10)
    const file = mockTextFile('test.log', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // AC11: file.slice() throws → pure extension fallback
  it('falls back to extension when slice throws', async () => {
    const file = mockFileSliceThrows('test.pb')
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace') // .pb extension
  })

  it('falls back to log extension when slice throws for .log file', async () => {
    const file = mockFileSliceThrows('test.log')
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // Additional: GZ magic takes precedence over control byte count
  it('returns log for GZ even with many control bytes', async () => {
    const bytes = new Uint8Array(64)
    bytes[0] = 0x1f
    bytes[1] = 0x8b
    // Fill rest with control bytes
    for (let i = 2; i < 64; i++) {
      bytes[i] = 0x00
    }
    const file = mockFile('test.gz', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // Additional: ZIP magic takes precedence over control byte count
  it('returns log for ZIP even with many control bytes', async () => {
    const bytes = new Uint8Array(64)
    bytes[0] = 0x50
    bytes[1] = 0x4b
    for (let i = 2; i < 64; i++) {
      bytes[i] = 0x00
    }
    const file = mockFile('test.zip', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // Additional: systemTraceEvents detection
  it('identifies JSON with systemTraceEvents as trace', async () => {
    const content = '{"systemTraceEvents": "..."}'
    const file = mockTextFile('trace.json', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  // Additional: displayTimeUnit detection
  it('identifies JSON with displayTimeUnit as trace', async () => {
    const content = '{"displayTimeUnit": "ns", "traceEvents": []}'
    const file = mockTextFile('trace.json', content)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })

  // Additional: TAB/LF/CR not counted as control bytes
  it('does not count TAB/LF/CR as control bytes', async () => {
    const bytes = new Uint8Array(256)
    // Fill with printable and whitespace
    const text = 'Hello\tWorld\nTest\rLine\n'
    const encoder = new TextEncoder()
    const encoded = encoder.encode(text.repeat(20))
    bytes.set(encoded.slice(0, 256))
    const file = mockFile('test.log', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('log')
  })

  // Additional: .perfetto-trace extension
  it('identifies .perfetto-trace extension as trace', async () => {
    const bytes = new Uint8Array(0)
    const file = mockFile('trace.perfetto-trace', bytes)
    const result = await detectFileTypeByHeader(file)
    expect(result).toBe('trace')
  })
})

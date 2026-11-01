import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectFileTypeFromHeader, detectFileTypeFromPath } from './index.ts'

const ANR_TRACE = `----- pid 1234 at 2025-08-15 14:30:22 -----
Cmd line: com.example.app

"main" prio=5 tid=1 Native
  | group="main" sCount=1 dsCount=0
`

const TOMBSTONE = `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
Build fingerprint: 'google/raven/raven:14/AP1A/1:user/release-keys'
`

describe('detectFileTypeFromHeader', () => {
  it('treats empty input as a log', () => {
    expect(detectFileTypeFromHeader(Buffer.alloc(0))).toBe('log')
  })

  it.each([[0xd4c3b2a1], [0xa1b2c3d4], [0x4d3cb2a1], [0xa1b23c4d], [0x0a0d0d0a]])(
    'detects pcap magic 0x%s',
    (magic) => {
      const header = Buffer.alloc(16)
      header.writeUInt32BE(magic >>> 0, 0)
      expect(detectFileTypeFromHeader(header)).toBe('pcap')
    },
  )

  it('detects BTSnoop captures', () => {
    const header = Buffer.concat([Buffer.from('btsnoop\u0000', 'latin1'), Buffer.alloc(8)])
    expect(detectFileTypeFromHeader(header)).toBe('hci')
  })

  it('treats archives as logs', () => {
    expect(detectFileTypeFromHeader(Buffer.from([0x1f, 0x8b, 0x08]))).toBe('log')
    expect(detectFileTypeFromHeader(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('log')
    expect(detectFileTypeFromHeader(Buffer.from('Rar!\u001a\u0007\u0000', 'latin1'))).toBe('log')
    expect(detectFileTypeFromHeader(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00]))).toBe(
      'log',
    )
  })

  it('detects binary traces by control-byte density', () => {
    const header = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x41])
    expect(detectFileTypeFromHeader(header)).toBe('trace')
  })

  it('detects tombstones before ANR traces', () => {
    expect(detectFileTypeFromHeader(Buffer.from(TOMBSTONE))).toBe('tombstone')
  })

  it('detects ANR traces', () => {
    expect(detectFileTypeFromHeader(Buffer.from(ANR_TRACE))).toBe('anr')
  })

  it('detects JSON traces', () => {
    expect(detectFileTypeFromHeader(Buffer.from('{"traceEvents":[{"ph":"X"}]}'))).toBe('trace')
  })

  it('falls back to log for plain text', () => {
    expect(
      detectFileTypeFromHeader(Buffer.from('01-15 10:30:45.123  1234  5678 E Tag: boom')),
    ).toBe('log')
  })
})

describe('detectFileTypeFromPath', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ala-detect-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reads the header without consulting the extension', async () => {
    const path = join(directory, 'capture.log')
    const header = Buffer.alloc(24)
    header.writeUInt32BE(0xa1b2c3d4, 0)
    await writeFile(path, header)
    await expect(detectFileTypeFromPath(path)).resolves.toBe('pcap')
  })

  it('falls back to log for a missing file', async () => {
    await expect(detectFileTypeFromPath(join(directory, 'missing'))).resolves.toBe('log')
  })
})

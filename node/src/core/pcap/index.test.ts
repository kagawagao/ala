import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PcapAnalyzer, type PcapFilters } from './index.ts'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SAMPLE = join(ROOT, 'examples/sample-network.pcap')

const analyzer = new PcapAnalyzer()

/** Ethernet + IPv4 + TCP frame with src 192.168.1.1:80 → 192.168.1.2:1024 SYN. */
function tcpFrame(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0x08, 0x00]),
    Buffer.from([
      0x45, 0x00, 0x00, 0x28, 0x00, 0x00, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8, 0x01,
      0x01, 0xc0, 0xa8, 0x01, 0x02,
    ]),
    Buffer.from([
      0x00, 0x50, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x02, 0x20,
      0x00, 0x00, 0x00, 0x00, 0x00,
    ]),
  ])
}

function minimalPcap(frame = tcpFrame()): Buffer {
  const header = Buffer.alloc(24)
  header.writeUInt32LE(0xa1b2c3d4, 0)
  header.writeUInt16LE(2, 4)
  header.writeUInt16LE(4, 6)
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(0, 12)
  header.writeUInt32LE(65535, 16)
  header.writeUInt32LE(1, 20)
  const record = Buffer.alloc(16)
  record.writeUInt32LE(1_609_459_200, 0)
  record.writeUInt32LE(0, 4)
  record.writeUInt32LE(frame.length, 8)
  record.writeUInt32LE(frame.length, 12)
  return Buffer.concat([header, record, frame])
}

function bigEndianPcap(frame = tcpFrame()): Buffer {
  const header = Buffer.alloc(24)
  header.writeUInt32BE(0xa1b2c3d4, 0)
  header.writeUInt16BE(2, 4)
  header.writeUInt16BE(4, 6)
  header.writeUInt32BE(65535, 16)
  header.writeUInt32BE(1, 20)
  const record = Buffer.alloc(16)
  record.writeUInt32BE(1_609_459_200, 0)
  record.writeUInt32BE(0, 4)
  record.writeUInt32BE(frame.length, 8)
  record.writeUInt32BE(frame.length, 12)
  return Buffer.concat([header, record, frame])
}

function pcapng(frame = tcpFrame()): Buffer {
  const block = (type: number, body: Buffer): Buffer => {
    const total = 12 + body.length
    const header = Buffer.alloc(8)
    header.writeUInt32LE(type, 0)
    header.writeUInt32LE(total, 4)
    const trailer = Buffer.alloc(4)
    trailer.writeUInt32LE(total, 0)
    return Buffer.concat([header, body, trailer])
  }

  const sectionHeader = Buffer.alloc(16)
  sectionHeader.writeUInt32LE(0x1a2b3c4d, 0)
  sectionHeader.writeUInt16LE(1, 4)
  sectionHeader.writeUInt16LE(0, 6)
  sectionHeader.writeBigUInt64LE(0xffffffffffffffffn, 8)

  const interfaceDescription = Buffer.alloc(8)
  interfaceDescription.writeUInt16LE(1, 0) // Ethernet
  interfaceDescription.writeUInt16LE(0, 2)
  interfaceDescription.writeUInt32LE(65535, 4)

  const padded = Buffer.concat([frame, Buffer.alloc((4 - (frame.length % 4)) % 4)])
  const timestamp = 1_609_459_200_000_000n
  const enhanced = Buffer.alloc(20)
  enhanced.writeUInt32LE(0, 0)
  enhanced.writeUInt32LE(Number(timestamp >> 32n), 4)
  enhanced.writeUInt32LE(Number(timestamp & 0xffffffffn), 8)
  enhanced.writeUInt32LE(frame.length, 12)
  enhanced.writeUInt32LE(frame.length, 16)

  return Buffer.concat([
    block(0x0a0d0d0a, sectionHeader),
    block(0x00000001, interfaceDescription),
    block(0x00000006, Buffer.concat([enhanced, padded])),
  ])
}

describe('magic detection', () => {
  it('accepts every supported magic', () => {
    for (const magic of [
      Buffer.from([0xd4, 0xc3, 0xb2, 0xa1]),
      Buffer.from([0xa1, 0xb2, 0xc3, 0xd4]),
      Buffer.from([0x4d, 0x3c, 0xb2, 0xa1]),
      Buffer.from([0xa1, 0xb2, 0x3c, 0x4d]),
      Buffer.from([0x0a, 0x0d, 0x0d, 0x0a]),
    ]) {
      expect(analyzer.isPcapData(Buffer.concat([magic, Buffer.alloc(20)]))).toBe(true)
    }
  })

  it('rejects non-capture data', () => {
    expect(analyzer.isPcapData(Buffer.from('hello world'))).toBe(false)
    expect(analyzer.isPcapData(Buffer.alloc(0))).toBe(false)
  })
})

describe('classic pcap parsing', () => {
  it('decodes a TCP packet', () => {
    const result = analyzer.parsePcap(minimalPcap(), 'capture.pcap')
    expect(result.format_detected).toBe('pcap')
    expect(result.total_packets).toBe(1)
    expect(result.file_size).toBe(minimalPcap().length)
    const entry = result.entries[0]!
    expect(entry).toMatchObject({
      packet_number: 1,
      protocol: 'TCP',
      src_ip: '192.168.1.1',
      dst_ip: '192.168.1.2',
      src_port: 80,
      dst_port: 1024,
      length: 54,
      tcp_flags: 'SYN',
      source_file: 'capture.pcap',
    })
    expect(entry.info).toBe('192.168.1.1:80 → 192.168.1.2:1024 [SYN]')
  })

  it('uses UTC timestamps with millisecond precision', () => {
    const entry = analyzer.parsePcap(minimalPcap()).entries[0]!
    expect(entry.timestamp).toBe('2021-01-01 00:00:00.000')
  })

  it('parses big-endian captures', () => {
    const entry = analyzer.parsePcap(bigEndianPcap()).entries[0]!
    expect(entry.protocol).toBe('TCP')
    expect(entry.timestamp).toBe('2021-01-01 00:00:00.000')
  })

  it('parses nanosecond timestamps', () => {
    const data = minimalPcap()
    data.writeUInt32LE(0xa1b23c4d, 0)
    data.writeUInt32LE(500_000_000, 28)
    expect(analyzer.parsePcap(data).entries[0]!.timestamp).toBe('2021-01-01 00:00:00.500')
  })

  it('streams packets with the archive member as source file', () => {
    const packets = [...analyzer.streamPcap(minimalPcap(), 'device.pcap')]
    expect(packets).toHaveLength(1)
    expect(packets[0]!.source_file).toBe('device.pcap')
  })

  it('rejects invalid input', () => {
    expect(() => analyzer.parsePcap(Buffer.from('not a capture'), 'x.pcap')).toThrow(
      'valid PCAP or PCAPNG',
    )
  })
})

describe('pcapng parsing', () => {
  it('decodes an enhanced packet block', () => {
    const result = analyzer.parsePcap(pcapng(), 'capture.pcapng')
    expect(result.format_detected).toBe('pcapng')
    expect(result.total_packets).toBe(1)
    expect(result.entries[0]).toMatchObject({
      protocol: 'TCP',
      src_ip: '192.168.1.1',
      dst_ip: '192.168.1.2',
      timestamp: '2021-01-01 00:00:00.000',
    })
  })
})

describe('archives', () => {
  it('reads gzip captures', () => {
    const result = analyzer.parsePcap(gzipSync(minimalPcap()), 'capture.pcap.gz')
    expect(result.total_packets).toBe(1)
  })

  it('reads zip captures', () => {
    const zip = makeZip('network.pcap', minimalPcap())
    const result = analyzer.parsePcap(zip, 'logs.zip')
    expect(result.total_packets).toBe(1)
    expect(result.entries[0]!.source_file).toBe('network.pcap')
  })
})

/** Minimal stored-entry ZIP writer for tests. */
function makeZip(name: string, content: Buffer): Buffer {
  const nameBytes = Buffer.from(name)
  const crc = crc32(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(content.length, 18)
  local.writeUInt32LE(content.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  const localRecord = Buffer.concat([local, nameBytes, content])
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(content.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  const centralRecord = Buffer.concat([central, nameBytes])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralRecord.length, 12)
  end.writeUInt32LE(localRecord.length, 16)
  return Buffer.concat([localRecord, centralRecord, end])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

describe('filtering and statistics', () => {
  const entries = analyzer.parsePcap(minimalPcap(), 'capture.pcap').entries

  it('filters by protocol, IP, port, flags, and keyword', () => {
    expect(analyzer.filterPcap(entries, { protocol: 'tcp' })).toHaveLength(1)
    expect(analyzer.filterPcap(entries, { protocol: 'UDP' })).toHaveLength(0)
    expect(analyzer.filterPcap(entries, { src_ip: '192.168.1' })).toHaveLength(1)
    expect(analyzer.filterPcap(entries, { src_port: 80 })).toHaveLength(1)
    expect(analyzer.filterPcap(entries, { src_port: 81 })).toHaveLength(0)
    expect(analyzer.filterPcap(entries, { tcp_flags: 'syn' })).toHaveLength(1)
    expect(analyzer.filterPcap(entries, { keywords: 'syn' })).toHaveLength(1)
    expect(analyzer.filterPcap(entries, { start_time: '2022-01-01' })).toHaveLength(0)
    expect(analyzer.filterPcap(entries, { end_time: '2020-01-01' })).toHaveLength(0)
  })

  it('computes statistics', () => {
    const stats = analyzer.computeStatistics(entries)
    expect(stats.total).toBe(1)
    expect(stats.by_protocol).toEqual({ TCP: 1 })
    expect(stats.unique_ips).toBe(2)
    expect(stats.unique_connections).toBe(1)
  })

  it('returns empty statistics for no entries', () => {
    expect(analyzer.computeStatistics([])).toEqual({
      total: 0,
      by_protocol: {},
      unique_ips: 0,
      unique_connections: 0,
      duration_seconds: null,
    })
  })
})

describe('streamFilterFromPath', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ala-pcap-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('streams and filters a file on disk', async () => {
    const path = join(directory, 'capture.pcap')
    await writeFile(path, minimalPcap())
    const all = [...analyzer.streamFilterFromPath(path)]
    expect(all).toHaveLength(1)
    const filtered = [...analyzer.streamFilterFromPath(path, { protocol: 'UDP' })]
    expect(filtered).toHaveLength(0)
  })

  it('parses the repository sample capture', () => {
    const entries = [...analyzer.streamFilterFromPath(SAMPLE)]
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((entry) => entry.protocol === 'TCP')).toBe(true)
    const stats = analyzer.computeStatistics(entries)
    expect(stats.unique_ips).toBeGreaterThan(0)
  })

  it('rejects a missing path', () => {
    expect(() => [...analyzer.streamFilterFromPath(join(directory, 'missing.pcap'))]).toThrow(
      'PCAP file not found',
    )
  })
})

// Keep the imported type in use for readability of the filter literals above.
const _filters: PcapFilters = {}
void _filters

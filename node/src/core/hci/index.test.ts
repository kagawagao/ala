import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BTSNOOP_EPOCH_OFFSET_US,
  BTSNOOP_MAGIC,
  DIRECTION_CONTROLLER_TO_HOST,
  DIRECTION_HOST_TO_CONTROLLER,
  HCI_EVENTS,
  HCI_OPCODES,
  HCI_TYPE_NAMES,
  HciAnalyzer,
  LE_SUB_EVENTS,
  OGF_NAMES,
  decodeEvent,
  decodeHciOpcode,
  decodeOpcode,
  decompress,
  isHciData,
  matchHciEntry,
  parseBtsnoopHeader,
  payloadToHexStr,
  usToTimestamp,
  type HciEntry,
} from './index.ts'

const TS_BASE = 1_609_459_200_000_000 // 2021-01-01T00:00:00Z in Unix microseconds

// ── Inline BTSnoop fixture builders (mirror the Python test helpers) ───

function createBtsnoopHeader(version = 1, dataLinkType = 1001): Buffer {
  const header = Buffer.alloc(16)
  BTSNOOP_MAGIC.copy(header, 0)
  header.writeUInt32BE(version, 8)
  header.writeUInt32BE(dataLinkType, 12)
  return header
}

function createPacketRecord(
  originalLength: number,
  includedLength: number,
  packetFlags: number,
  cumulativeDrops: number,
  timestampUs: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(24)
  header.writeUInt32BE(originalLength, 0)
  header.writeUInt32BE(includedLength, 4)
  header.writeUInt32BE(packetFlags, 8)
  header.writeUInt32BE(cumulativeDrops, 12)
  header.writeBigUInt64BE(BigInt(timestampUs), 16)
  return Buffer.concat([header, payload])
}

/** Payload from Python's `struct.pack("<HHIHH15s", 0x2017, 0x0019, ...)`. */
function createCommandPayload(): Buffer {
  const payload = Buffer.alloc(27)
  payload.writeUInt16LE(0x2017, 0) // opcode LE_CREATE_CONNECTION
  payload.writeUInt16LE(0x0019, 2) // parameter length 25
  payload.writeUInt32LE(0x0010, 4) // scan_interval
  payload.writeUInt16LE(0x0010, 8) // scan_window
  payload.writeUInt16LE(0x0000, 10) // initiator_filter + own_addr_type
  return payload
}

/** Payload from Python's `struct.pack("<BBHHB", 0x0E, 0x04, 0x01, 0x2017, 0x00)`. */
function createEventPayload(): Buffer {
  const payload = Buffer.alloc(7)
  payload[0] = 0x0e // COMMAND_COMPLETE
  payload[1] = 0x04 // parameter length
  payload.writeUInt16LE(0x0001, 2) // num_hci_command_packets
  payload.writeUInt16LE(0x2017, 4) // opcode
  payload[6] = 0x00 // status = OK
  return payload
}

function createAclPayload(): Buffer {
  const text = Buffer.from('Hello Bluetooth!')
  const payload = Buffer.alloc(4 + text.length)
  payload.writeUInt16LE(0x000a, 0) // handle/PB/BC
  payload.writeUInt16LE(18, 2) // data length
  text.copy(payload, 4)
  return payload
}

function createMinimalBtsnoop(): Buffer {
  const command = createCommandPayload()
  const event = createEventPayload()
  return Buffer.concat([
    createBtsnoopHeader(),
    createPacketRecord(command.length, command.length, 0x00, 0, TS_BASE, command),
    createPacketRecord(event.length, event.length, 0x0d, 0, TS_BASE + 1000, event),
  ])
}

function createAclBtsnoop(): Buffer {
  const acl = createAclPayload()
  return Buffer.concat([
    createBtsnoopHeader(),
    createPacketRecord(acl.length, acl.length, 0x06, 0, TS_BASE + 2000, acl),
  ])
}

// ── Inline ZIP builder (no npm dependency, mirrors zipfile output) ─────

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipInput {
  name: string
  data: Buffer
  store?: boolean
}

function createZip(entries: ZipInput[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = entry.store ? entry.data : deflateRawSync(entry.data)
    const method = entry.store ? 0 : 8
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // local header offset
    centralParts.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const localBlock = Buffer.concat(localParts)
  const centralBlock = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8) // entries on this disk
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)
  return Buffer.concat([localBlock, centralBlock, eocd])
}

// A ZIP archive produced by Python 3 `zipfile.ZipFile(..., ZIP_DEFLATED)` from
// the exact minimal BTSnoop fixture above — validates the stdlib ZIP reader
// against a real-world writer rather than only our own builder.
const PYTHON_ZIP_BASE64 =
  'UEsDBBQAAAAIACa3YV1Z0SqgNQAAAGIAAAAPAAAAYnRzbm9vcF9oY2kubG9nSyopzsvPL2AAAkYGBuaXQFoaiiGAdfvp7KcNDOIKkgwCQK4AAzbADsW8CC3NL/hYGIHaGABQSwECFAMUAAAACAAmt2FdWdEqoDUAAABiAAAADwAAAAAAAAAAAAAAgAEAAAAAYnRzbm9vcF9oY2kubG9nUEsFBgAAAAABAAEAPQAAAGIAAAAAAA=='
// `gzip.compress(data, mtime=0)` from the same Python session.
const PYTHON_GZIP_BASE64 =
  'H4sIAAAAAAAA/0sqKc7Lzy9gAAJGBgbml0BaGoohgHX76eynDQziCpIMAkCuAAM2wA7FvAgtzS/4WBiB2hgAWdEqoGIAAAA='

describe('BTSnoop magic detection', () => {
  const analyzer = new HciAnalyzer()

  it('detects BTSnoop captures', () => {
    expect(analyzer.isHciData(createMinimalBtsnoop())).toBe(true)
    expect(isHciData(createMinimalBtsnoop())).toBe(true)
  })

  it('rejects non-HCI data', () => {
    expect(analyzer.isHciData(Buffer.from('hello world'))).toBe(false)
    expect(analyzer.isHciData(Buffer.alloc(0))).toBe(false)
    expect(analyzer.isHciData(Buffer.from('btsnoop'))).toBe(false)
    const pcap = Buffer.alloc(4)
    pcap.writeUInt32BE(0xa1b2c3d4, 0)
    expect(analyzer.isHciData(pcap)).toBe(false)
  })

  it('matches the magic bytes exactly and case-sensitively', () => {
    expect(analyzer.isHciData(Buffer.from('btsnoop\u0000', 'latin1'))).toBe(true)
    expect(analyzer.isHciData(Buffer.from('BTSNOOP\u0000', 'latin1'))).toBe(false)
    expect(analyzer.isHciData(Buffer.from('btsnoop', 'latin1'))).toBe(false)
    expect(BTSNOOP_MAGIC.length).toBe(8)
  })
})

describe('BTSnoop header parsing', () => {
  it('returns version, data link type and payload offset', () => {
    expect(parseBtsnoopHeader(createBtsnoopHeader(1, 1001))).toEqual([1, 1001, 16])
    expect(parseBtsnoopHeader(createBtsnoopHeader(1, 1002))).toEqual([1, 1002, 16])
  })

  it('rejects files shorter than 16 bytes', () => {
    expect(() => parseBtsnoopHeader(Buffer.from('btsnoop\u0000', 'latin1'))).toThrow(/too small/)
  })

  it('rejects invalid magic bytes', () => {
    expect(() => parseBtsnoopHeader(Buffer.from('nope!nope!12345678'))).toThrow(
      /Invalid BTSnoop magic bytes/,
    )
  })
})

describe('HCI parsing', () => {
  const analyzer = new HciAnalyzer()

  it('parses a minimal BTSnoop file', () => {
    const data = createMinimalBtsnoop()
    const result = analyzer.parseHci(data)

    expect(result.format_detected).toBe('btsnoop')
    expect(result.total_packets).toBe(2)
    expect(result.entries.length).toBe(2)
    expect(result.file_size).toBe(data.length)
  })

  it('parses command packets with opcode names', () => {
    const command = analyzer.parseHci(createMinimalBtsnoop()).entries[0]!

    expect(command.packet_number).toBe(1)
    expect(command.hci_type).toBe('COMMAND')
    expect(command.direction).toBe(DIRECTION_HOST_TO_CONTROLLER)
    expect(command.opcode).toBe(0x2017)
    expect(command.opcode_name).toBe('LE_CREATE_CONNECTION')
    expect(command.event_code).toBeNull()
    expect(command.event_name).toBeNull()
    expect(command.data_length).toBe(27)
    expect(command.timestamp).toBe('2021-01-01 00:00:00.000')
    expect(command.source_file).toBe('btsnoop_hci.log')
    expect(command.raw_summary).toContain('#1 | HOST_TO_CONTROLLER | COMMAND | 0x2017')
    expect(command.raw_summary).toContain('| len=27\n')
    expect(command.raw_summary).toContain('|')
  })

  it('parses event packets with event names', () => {
    const event = analyzer.parseHci(createMinimalBtsnoop()).entries[1]!

    expect(event.packet_number).toBe(2)
    expect(event.hci_type).toBe('EVENT')
    expect(event.direction).toBe(DIRECTION_CONTROLLER_TO_HOST)
    expect(event.event_code).toBe(0x0e)
    expect(event.event_name).toBe('COMMAND_COMPLETE')
    expect(event.opcode).toBeNull()
    expect(event.opcode_name).toBeNull()
    expect(event.data_length).toBe(7)
    expect(event.timestamp).toBe('2021-01-01 00:00:00.001')
    expect(event.raw_summary).toContain('Evt 0x0E (COMMAND_COMPLETE)')
  })

  it('parses ACL data packets', () => {
    const result = analyzer.parseHci(createAclBtsnoop())

    expect(result.total_packets).toBe(1)
    expect(result.entries[0]!.hci_type).toBe('ACL_DATA')
    expect(result.entries[0]!.opcode).toBeNull()
    expect(result.entries[0]!.event_code).toBeNull()
    expect(result.entries[0]!.data_length).toBe(20)
  })

  it('streams packets with sequential packet numbers', () => {
    const entries = [...analyzer.streamHci(createMinimalBtsnoop())]

    expect(entries.length).toBe(2)
    expect(entries[0]!.packet_number).toBe(1)
    expect(entries[1]!.packet_number).toBe(2)
    expect(entries.map((entry) => entry.hci_type)).toEqual(['COMMAND', 'EVENT'])
  })

  it('uses the supplied filename as source_file', () => {
    const result = analyzer.parseHci(createMinimalBtsnoop(), 'custom_btsnoop.cfa')

    expect(result.entries[0]!.source_file).toBe('custom_btsnoop.cfa')
    expect(result.entries[1]!.source_file).toBe('custom_btsnoop.cfa')
  })

  it('rejects non-BTSnoop input', () => {
    expect(() => analyzer.parseHci(Buffer.from('not a btsnoop file'))).toThrow(/valid BTSnoop/)
    expect(() => [...analyzer.streamHci(Buffer.from('not a btsnoop file'))]).toThrow(
      /valid BTSnoop/,
    )
  })

  it('rejects a truncated header', () => {
    expect(() => analyzer.parseHci(Buffer.from('btsnoop\u0000', 'latin1'))).toThrow(/too small/)
  })

  it('stops cleanly when a packet record is truncated', () => {
    const data = Buffer.concat([
      createBtsnoopHeader(),
      Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]),
    ])
    const result = analyzer.parseHci(data)

    expect(result.total_packets).toBe(0)
    expect(result.entries).toEqual([])
  })

  it('prefers the UART transport indicator over the flags', () => {
    // Flags claim EVENT, but the payload starts with the ACL_DATA indicator.
    const payload = Buffer.from([0x02, 0x41, 0x42])
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(payload.length, payload.length, 0x0d, 0, TS_BASE, payload),
    ])
    const entry = analyzer.parseHci(data).entries[0]!

    expect(entry.hci_type).toBe('ACL_DATA')
    expect(entry.data_length).toBe(2)
  })

  it('detects ISO data via flags bit 4', () => {
    const payload = Buffer.from([0x00, 0x11, 0x22])
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(payload.length, payload.length, 0x11, 0, TS_BASE, payload),
    ])
    const entry = analyzer.parseHci(data).entries[0]!

    expect(entry.hci_type).toBe('ISO_DATA')
    expect(entry.direction).toBe(DIRECTION_CONTROLLER_TO_HOST)
    expect(entry.data_length).toBe(3)
  })

  it('decodes LE meta events using the sub-event byte', () => {
    const payload = Buffer.from([0x3e, 0x01, 0x00])
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(payload.length, payload.length, 0x0d, 0, TS_BASE, payload),
    ])
    const entry = analyzer.parseHci(data).entries[0]!

    expect(entry.event_code).toBe(0x3e)
    expect(entry.event_name).toBe('LE_META: LE_CONNECTION_COMPLETE')
  })

  it('names unknown events', () => {
    const payload = Buffer.from([0xab, 0x00])
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(payload.length, payload.length, 0x0d, 0, TS_BASE, payload),
    ])
    const entry = analyzer.parseHci(data).entries[0]!

    expect(entry.event_name).toBe('UNKNOWN_EVENT_0xAB')
  })

  it('names unknown vendor opcodes', () => {
    const payload = Buffer.alloc(4)
    payload.writeUInt16LE(0xffff, 0)
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(payload.length, payload.length, 0x00, 0, TS_BASE, payload),
    ])
    const entry = analyzer.parseHci(data).entries[0]!

    expect(entry.opcode).toBe(0xffff)
    expect(entry.opcode_name).toBe('VENDOR_0xFFFF')
  })

  it('parses gzip input from bytes', () => {
    const data = createMinimalBtsnoop()
    const result = analyzer.parseHci(gzipSync(data), 'capture.log.gz')

    expect(result.total_packets).toBe(2)
    expect(result.file_size).toBe(data.length)
    expect(result.entries[0]!.source_file).toBe('capture.log')
  })

  it('parses zlib-created zip input from bytes', () => {
    const data = createMinimalBtsnoop()
    const zip = createZip([{ name: 'btsnoop_hci.log', data }])
    const result = analyzer.parseHci(zip, 'capture.zip')

    expect(result.total_packets).toBe(2)
    expect(result.format_detected).toBe('btsnoop')
    expect(result.entries[0]!.source_file).toBe('btsnoop_hci.log')
  })

  it('parses a zip archive produced by Python zipfile', () => {
    const zip = Buffer.from(PYTHON_ZIP_BASE64, 'base64')
    const result = analyzer.parseHci(zip, 'capture.zip')

    expect(result.total_packets).toBe(2)
    expect(result.entries[0]!.opcode).toBe(0x2017)
    expect(result.entries[1]!.event_code).toBe(0x0e)
  })

  it('parses gzip data produced by Python gzip', () => {
    const gz = Buffer.from(PYTHON_GZIP_BASE64, 'base64')
    const result = analyzer.parseHci(gz, 'capture.log.gz')

    expect(result.total_packets).toBe(2)
    expect(result.file_size).toBe(98)
  })

  it('rejects empty input', () => {
    expect(() => analyzer.parseHci(Buffer.alloc(0))).toThrow(/valid BTSnoop/)
  })
})

describe('HCI filtering', () => {
  const analyzer = new HciAnalyzer()
  const entries = analyzer.parseHci(createMinimalBtsnoop()).entries

  it('returns all entries for an empty filter', () => {
    expect(analyzer.filterHci(entries, {})).toHaveLength(2)
    expect(analyzer.filterHci(entries, { direction: null, hci_type: null })).toHaveLength(2)
  })

  it('filters by direction', () => {
    const result = analyzer.filterHci(entries, { direction: 'HOST_TO_CONTROLLER' })

    expect(result).toHaveLength(1)
    expect(result[0]!.hci_type).toBe('COMMAND')
  })

  it('filters by HCI type', () => {
    const result = analyzer.filterHci(entries, { hci_type: 'EVENT' })

    expect(result).toHaveLength(1)
    expect(result[0]!.hci_type).toBe('EVENT')
  })

  it('filters by opcode', () => {
    const result = analyzer.filterHci(entries, { opcode: 0x2017 })

    expect(result).toHaveLength(1)
    expect(result[0]!.opcode).toBe(0x2017)
    expect(analyzer.filterHci(entries, { opcode: 0x2016 })).toHaveLength(0)
  })

  it('filters by opcode name substring, case-insensitively', () => {
    expect(analyzer.filterHci(entries, { opcode_name: 'CREATE_CONNECTION' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { opcode_name: 'create_connection' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { opcode_name: 'NOPE' })).toHaveLength(0)
  })

  it('filters by event code', () => {
    const result = analyzer.filterHci(entries, { event_code: 0x0e })

    expect(result).toHaveLength(1)
    expect(result[0]!.event_code).toBe(0x0e)
    expect(analyzer.filterHci(entries, { event_code: 0x0f })).toHaveLength(0)
  })

  it('filters by event name substring', () => {
    expect(analyzer.filterHci(entries, { event_name: 'COMMAND_COMPLETE' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { event_name: 'command_complete' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { event_name: 'INQUIRY' })).toHaveLength(0)
  })

  it('filters by keywords in the raw summary', () => {
    expect(analyzer.filterHci(entries, { keywords: 'LE_CREATE' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { keywords: 'le_create' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { keywords: '0x0E' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { keywords: 'not-present' })).toHaveLength(0)
  })

  it('chains filters', () => {
    expect(
      analyzer.filterHci(entries, {
        direction: 'CONTROLLER_TO_HOST',
        hci_type: 'EVENT',
      }),
    ).toHaveLength(1)
    expect(
      analyzer.filterHci(entries, {
        direction: 'HOST_TO_CONTROLLER',
        hci_type: 'EVENT',
      }),
    ).toHaveLength(0)
  })

  it('filters by time range', () => {
    expect(analyzer.filterHci(entries, { start_time: '2021-01-01 00:00:00.000' })).toHaveLength(2)
    expect(analyzer.filterHci(entries, { end_time: '2021-01-01 00:00:00.000' })).toHaveLength(1)
    expect(analyzer.filterHci(entries, { start_time: '2021-01-01 00:00:00.001' })).toHaveLength(1)
  })

  it('excludes timestamp-less entries from filterHci time filters', () => {
    const entry: HciEntry = {
      packet_number: 1,
      timestamp: null,
      direction: 'HOST_TO_CONTROLLER',
      hci_type: 'COMMAND',
      opcode: null,
      opcode_name: null,
      event_code: null,
      event_name: null,
      data_length: 0,
      raw_summary: '',
      source_file: null,
    }

    expect(analyzer.filterHci([entry], { start_time: '2021-01-01 00:00:00.000' })).toEqual([])
    // Python's `_match_entry` (used by streamFilterFromPath) lets them through.
    expect(matchHciEntry(entry, { start_time: '2021-01-01 00:00:00.000' })).toBe(true)
  })
})

describe('HCI statistics', () => {
  const analyzer = new HciAnalyzer()
  const entries = analyzer.parseHci(createMinimalBtsnoop()).entries

  it('computes basic statistics', () => {
    const stats = analyzer.computeStatistics(entries)

    expect(stats.total).toBe(2)
    expect(stats.by_direction).toEqual({
      HOST_TO_CONTROLLER: 1,
      CONTROLLER_TO_HOST: 1,
    })
    expect(stats.by_type).toEqual({ COMMAND: 1, EVENT: 1 })
    expect(stats.unique_opcodes).toBe(1)
    expect(stats.duration_seconds).not.toBeNull()
    expect(stats.duration_seconds).toBeGreaterThan(0)
    expect(stats.duration_seconds).toBe(0.001)
  })

  it('returns empty statistics for no entries', () => {
    expect(analyzer.computeStatistics([])).toEqual({
      total: 0,
      by_direction: {},
      by_type: {},
      duration_seconds: null,
      unique_opcodes: 0,
    })
  })

  it('counts unique opcodes only for command packets', () => {
    const command = createCommandPayload()
    const other = Buffer.from(command)
    other.writeUInt16LE(0x200d, 0) // LE_SET_ADVERTISING_DATA
    const data = Buffer.concat([
      createBtsnoopHeader(),
      createPacketRecord(command.length, command.length, 0x00, 0, TS_BASE, command),
      createPacketRecord(other.length, other.length, 0x00, 0, TS_BASE + 500_000, other),
      createPacketRecord(command.length, command.length, 0x00, 0, TS_BASE + 900_000, command),
    ])
    const stats = analyzer.computeStatistics(analyzer.parseHci(data).entries)

    expect(stats.total).toBe(3)
    expect(stats.by_type).toEqual({ COMMAND: 3 })
    expect(stats.unique_opcodes).toBe(2)
    expect(stats.duration_seconds).toBe(0.9)
  })

  it('ignores unparsable timestamps when computing duration', () => {
    const base = createMinimalBtsnoop()
    const entry = analyzer.parseHci(base).entries[0]!

    for (const timestamp of ['ts=123us', '2021-02-30 00:00:00.000', '2021-01-01T00:00:00.000']) {
      const stats = analyzer.computeStatistics([
        { ...entry, timestamp },
        { ...entry, timestamp: '2021-01-01 00:00:00.500' },
      ])
      expect(stats.total).toBe(2)
      expect(stats.duration_seconds).toBeNull()
    }
  })
})

describe('HCI opcode and event decoding', () => {
  it('decodes a known opcode', () => {
    expect(decodeOpcode(0x2017)).toEqual([0x08, 0x17, 'LE_CREATE_CONNECTION'])
  })

  it('decodes a known opcode into an object shape', () => {
    expect(decodeHciOpcode(0x2017)).toEqual({
      ogf: 0x08,
      ocf: 0x17,
      name: 'LE_CREATE_CONNECTION',
    })
  })

  it('generates names for unknown opcodes', () => {
    const [, , vendorName] = decodeOpcode(0xffff)

    expect(vendorName).toContain('VENDOR')
    expect(vendorName).toContain('0xFFFF')
    // OGF 0x07 is not vendor-specific: fall back to its group name.
    expect(decodeOpcode(0x1c01)[2]).toBe('LE Controller_0x1C01')
    // Unknown OGF falls back to UNKNOWN.
    expect(decodeOpcode(0x0401)[2]).toBe('Link Control_0x0401')
  })

  it('decodes known events', () => {
    expect(decodeEvent(0x0e)).toBe('COMMAND_COMPLETE')
    expect(decodeEvent(0x03)).toBe('CONNECTION_COMPLETE')
  })

  it('decodes LE meta events with a known sub-event', () => {
    const name = decodeEvent(0x3e, Buffer.from([0x01]))

    expect(name).toContain('LE_META')
    expect(name).toContain('LE_CONNECTION_COMPLETE')
  })

  it('decodes LE meta events with an unknown sub-event', () => {
    expect(decodeEvent(0x3e, Buffer.from([0xee]))).toBe('LE_META: UNKNOWN_SUB_0xEE')
    expect(decodeEvent(0x3e)).toBe('LE_META_EVENT')
  })

  it('decodes unknown events', () => {
    expect(decodeEvent(0xab)).toBe('UNKNOWN_EVENT_0xAB')
  })

  it('exposes the full lookup tables', () => {
    expect(Object.keys(OGF_NAMES)).toHaveLength(9)
    expect(Object.keys(HCI_OPCODES)).toHaveLength(257)
    expect(Object.keys(HCI_EVENTS)).toHaveLength(110)
    expect(Object.keys(LE_SUB_EVENTS)).toHaveLength(35)
    expect(HCI_TYPE_NAMES).toEqual({
      0: 'COMMAND',
      1: 'ACL_DATA',
      2: 'SCO_DATA',
      3: 'EVENT',
      4: 'ISO_DATA',
    })
  })
})

describe('timestamps and payload previews', () => {
  it('formats Unix-epoch microsecond timestamps', () => {
    expect(usToTimestamp(TS_BASE)).toBe('2021-01-01 00:00:00.000')
    expect(usToTimestamp(TS_BASE + 999_000)).toBe('2021-01-01 00:00:00.999')
    expect(usToTimestamp(TS_BASE + 123_456)).toBe('2021-01-01 00:00:00.123')
  })

  it('corrects AD-0 epoch timestamps', () => {
    expect(usToTimestamp(BTSNOOP_EPOCH_OFFSET_US + BigInt(TS_BASE))).toBe('2021-01-01 00:00:00.000')
    expect(usToTimestamp(BigInt(TS_BASE))).toBe('2021-01-01 00:00:00.000')
  })

  it('falls back for out-of-range timestamps', () => {
    expect(usToTimestamp(2n ** 63n)).toMatch(/^ts=\d+us$/)
    expect(usToTimestamp(0n)).toBe('1970-01-01 00:00:00.000')
  })

  it('renders payload hex and ASCII previews', () => {
    expect(payloadToHexStr(Buffer.alloc(0))).toBe('(empty)')
    expect(payloadToHexStr(Buffer.from('Hello'))).toBe('48 65 6C 6C 6F  |Hello|')
    expect(payloadToHexStr(Buffer.from([0x00, 0x1f, 0x20, 0x7e, 0x7f]))).toBe(
      '00 1F 20 7E 7F  |.. ~.|',
    )
  })

  it('truncates previews after 64 bytes', () => {
    const summary = payloadToHexStr(Buffer.alloc(70, 0x41))

    expect(summary.endsWith('...')).toBe(true)
    expect(summary).toContain(`|${'A'.repeat(64)}|...`)
  })
})

describe('compression handling', () => {
  it('decompresses gzip and strips the extension', () => {
    const data = createMinimalBtsnoop()
    const [decompressed, filename] = decompress(gzipSync(data), 'capture.log.gz')

    expect(filename).toBe('capture.log')
    expect(decompressed.equals(data)).toBe(true)
  })

  it('extracts the first matching file from a zip', () => {
    const data = createMinimalBtsnoop()
    const zip = createZip([
      { name: 'readme.txt', data: Buffer.from('ignore me') },
      { name: 'nested/capture.hci', data },
    ])
    const [decompressed, filename] = decompress(zip, 'archive.zip')

    expect(filename).toBe('nested/capture.hci')
    expect(decompressed.equals(data)).toBe(true)
  })

  it('reads stored (uncompressed) zip entries', () => {
    const data = createMinimalBtsnoop()
    const zip = createZip([{ name: 'capture.btsnoop', data, store: true }])
    const [decompressed, filename] = decompress(zip, 'archive.zip')

    expect(filename).toBe('capture.btsnoop')
    expect(decompressed.equals(data)).toBe(true)
  })

  it('handles gzip-wrapped zip archives like Python', () => {
    const data = createMinimalBtsnoop()
    const zip = createZip([{ name: 'capture.cfa', data }])
    const [decompressed, filename] = decompress(gzipSync(zip), 'capture.zip.gz')

    expect(filename).toBe('capture.cfa')
    expect(decompressed.equals(data)).toBe(true)
  })

  it('rejects corrupt gzip data', () => {
    expect(() => decompress(Buffer.from('not gzip'), 'capture.log.gz')).toThrow(/Invalid gzip file/)
  })

  it('rejects corrupt zip data', () => {
    expect(() => decompress(Buffer.from('PK\u0003\u0004broken'), 'capture.zip')).toThrow(
      /Invalid ZIP file/,
    )
  })

  it('rejects zips without an HCI member', () => {
    const zip = createZip([{ name: 'readme.txt', data: Buffer.from('nope') }])

    expect(() => decompress(zip, 'capture.zip')).toThrow(
      /No \.log\/\.hci\/\.btsnoop\/\.cfa file found in zip archive/,
    )
  })
})

describe('streamFilterFromPath', () => {
  const analyzer = new HciAnalyzer()
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ala-hci-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('streams a plain BTSnoop file from disk', async () => {
    const path = join(directory, 'btsnoop_hci.log')
    await writeFile(path, createMinimalBtsnoop())

    const entries = [...analyzer.streamFilterFromPath(path)]

    expect(entries).toHaveLength(2)
    expect(entries[0]!.source_file).toBe('btsnoop_hci.log')
    expect(entries[0]!.packet_number).toBe(1)
  })

  it('applies filters while streaming from disk', async () => {
    const path = join(directory, 'btsnoop_hci.log')
    await writeFile(path, createMinimalBtsnoop())

    expect([...analyzer.streamFilterFromPath(path, { hci_type: 'EVENT' })]).toHaveLength(1)
    expect([...analyzer.streamFilterFromPath(path, { keywords: 'LE_CREATE' })]).toHaveLength(1)
    expect([...analyzer.streamFilterFromPath(path, {})]).toHaveLength(2)
  })

  it('streams gzip files from disk', async () => {
    const path = join(directory, 'capture.log.gz')
    await writeFile(path, gzipSync(createMinimalBtsnoop()))

    const entries = [...analyzer.streamFilterFromPath(path)]

    expect(entries).toHaveLength(2)
    // Python keeps the on-disk (still .gz) basename as source_file.
    expect(entries[0]!.source_file).toBe('capture.log.gz')
  })

  it('streams zip files from disk with the member name', async () => {
    const path = join(directory, 'capture.zip')
    await writeFile(path, createZip([{ name: 'nested/capture.log', data: createMinimalBtsnoop() }]))

    const entries = [...analyzer.streamFilterFromPath(path)]

    expect(entries).toHaveLength(2)
    expect(entries[0]!.source_file).toBe('nested/capture.log')
  })

  it('streams a Python-produced gzip file from disk', async () => {
    const path = join(directory, 'python.log.gz')
    await writeFile(path, Buffer.from(PYTHON_GZIP_BASE64, 'base64'))

    expect([...analyzer.streamFilterFromPath(path)]).toHaveLength(2)
  })

  it('throws for a missing path', () => {
    expect(() => [...analyzer.streamFilterFromPath(join(directory, 'missing.log'))]).toThrow(
      /HCI file not found/,
    )
  })

  it('throws for a plain file without BTSnoop magic', async () => {
    const path = join(directory, 'bogus.log')
    await writeFile(path, Buffer.from('definitely not btsnoop'))

    expect(() => [...analyzer.streamFilterFromPath(path)]).toThrow(/valid BTSnoop/)
  })

  it('throws for a zip without an HCI member', async () => {
    const path = join(directory, 'archive.zip')
    await writeFile(path, createZip([{ name: 'readme.txt', data: Buffer.from('x') }]))

    expect(() => [...analyzer.streamFilterFromPath(path)]).toThrow(
      /No HCI file found in zip archive/,
    )
  })
})

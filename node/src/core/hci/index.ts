/**
 * Bluetooth HCI (BTSnoop) log analyzer.
 *
 * TypeScript port of `backend/src/ala/services/hci_analyzer.py`. Parses the
 * BTSnoop capture format (Android `btsnoop_hci.log` / `.cfa`), decodes HCI
 * command opcodes and event codes, and exposes filtering + statistics with the
 * same wire field names (`snake_case`) as the Python dataclasses.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { extractFirstZipEntry, ZipFormatError } from './zip.ts'
import { HCI_EVENTS, HCI_OPCODES, LE_SUB_EVENTS, OGF_NAMES } from './tables.ts'

export { HCI_EVENTS, HCI_OPCODES, LE_SUB_EVENTS, OGF_NAMES }

// ── BTSnoop magic bytes ────────────────────────────────────────────────
export const BTSNOOP_MAGIC = Buffer.from('btsnoop\u0000', 'latin1')

// ── HCI packet type constants (from packet_flags bits 2-3) ─────────────
export const HCI_TYPE_COMMAND = 0
export const HCI_TYPE_ACL = 1
export const HCI_TYPE_SCO = 2
export const HCI_TYPE_EVENT = 3
export const HCI_TYPE_ISO = 4 // Bluetooth 5.2+, indicated by bit 4 in flags

export const HCI_TYPE_NAMES: Readonly<Record<number, string>> = {
  [HCI_TYPE_COMMAND]: 'COMMAND',
  [HCI_TYPE_ACL]: 'ACL_DATA',
  [HCI_TYPE_SCO]: 'SCO_DATA',
  [HCI_TYPE_EVENT]: 'EVENT',
  [HCI_TYPE_ISO]: 'ISO_DATA',
}

// Direction strings
export const DIRECTION_HOST_TO_CONTROLLER = 'HOST_TO_CONTROLLER'
export const DIRECTION_CONTROLLER_TO_HOST = 'CONTROLLER_TO_HOST'

// HCI UART transport layer indicators (first byte of BTSnoop payload on some
// captures). Python keeps this map private (`_HCI_UART_INDICATOR`); it is
// exported here because callers porting packet inspection need it.
export const HCI_UART_INDICATORS: Readonly<Record<number, string>> = {
  0x01: 'COMMAND',
  0x02: 'ACL_DATA',
  0x03: 'SCO_DATA',
  0x04: 'EVENT',
  0x05: 'ISO_DATA',
}

/** Microseconds between Jan 1, 0 AD and Jan 1, 1970 (Unix epoch). */
export const BTSNOOP_EPOCH_OFFSET_US = 62_135_596_800_000_000n

/** Smallest/largest millisecond epoch values Python's `datetime` can format. */
const MIN_EPOCH_MS = -62_135_596_800_000n // 0001-01-01T00:00:00Z
const MAX_EPOCH_MS = 253_402_300_799_999n // 9999-12-31T23:59:59.999Z

const HCI_ZIP_EXTENSIONS = ['.log', '.hci', '.btsnoop', '.cfa'] as const

// ── Data structures ────────────────────────────────────────────────────

/** A single HCI packet from a BTSnoop file. Mirrors the Python dataclass. */
export interface HciEntry {
  packet_number: number
  timestamp: string | null
  /** "HOST_TO_CONTROLLER" or "CONTROLLER_TO_HOST" */
  direction: string
  /** "COMMAND", "EVENT", "ACL_DATA", "SCO_DATA" or "ISO_DATA" */
  hci_type: string
  /** For Command packets: (OGF << 10) | OCF */
  opcode: number | null
  /** Human-readable command name */
  opcode_name: string | null
  /** For Event packets */
  event_code: number | null
  /** Human-readable event name */
  event_name: string | null
  data_length: number
  raw_summary: string
  source_file: string | null
}

/** Filter criteria for HCI entries. Mirrors the Python dataclass. */
export interface HciFilters {
  start_time?: string | null
  end_time?: string | null
  /** "HOST_TO_CONTROLLER" | "CONTROLLER_TO_HOST" */
  direction?: string | null
  /** "COMMAND" | "EVENT" | "ACL_DATA" | "SCO_DATA" | "ISO_DATA" */
  hci_type?: string | null
  opcode?: number | null
  /** Substring match */
  opcode_name?: string | null
  event_code?: number | null
  /** Substring match */
  event_name?: string | null
  /** Search in raw_summary */
  keywords?: string | null
}

/** Statistics about parsed HCI entries. Mirrors the Python dataclass. */
export interface HciStatistics {
  total: number
  by_direction: Record<string, number>
  by_type: Record<string, number>
  duration_seconds: number | null
  unique_opcodes: number
}

/** Result of parsing an HCI (BTSnoop) file. Mirrors the Python dataclass. */
export interface HciParseResult {
  entries: HciEntry[]
  total_packets: number
  /** Always "btsnoop" */
  format_detected: string
  file_size: number
}

/** Decoded BTSnoop packet record header + payload (Python's record dict). */
export interface HciPacketRecord {
  original_length: number
  included_length: number
  packet_flags: number
  cumulative_drops: number
  timestamp_us: bigint
  direction: string
  hci_type: string
  payload: Buffer
  next_offset: number
}

/** Python-compatible tuple return of `_decode_opcode`. */
export type DecodedOpcode = [ogf: number, ocf: number, name: string]

// ── Hex helpers ────────────────────────────────────────────────────────

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

/** Render bytes like Python's `repr(bytes)` for error messages. */
function pythonBytesRepr(bytes: Buffer): string {
  let body = ''
  for (const byte of bytes) {
    if (byte === 0x5c) body += '\\\\'
    else if (byte === 0x27) body += "\\'"
    else if (byte >= 0x20 && byte < 0x7f) body += String.fromCharCode(byte)
    else body += `\\x${hex(byte, 2).toLowerCase()}`
  }
  return `b'${body}'`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── Opcode / event decoding ────────────────────────────────────────────

/**
 * Decode an HCI command opcode into `[ogf, ocf, name]`.
 *
 * @throws never — unknown opcodes get a generated `<group>_0x<opcode>` name.
 */
export function decodeOpcode(opcode: number): DecodedOpcode {
  const ogf = (opcode >> 10) & 0x3f
  const ocf = opcode & 0x3ff
  let name = HCI_OPCODES[opcode]
  if (name === undefined) {
    const group = OGF_NAMES[ogf] ?? 'UNKNOWN'
    name = ogf !== 0x3f ? `${group}_0x${hex(opcode, 4)}` : `VENDOR_0x${hex(opcode, 4)}`
  }
  return [ogf, ocf, name]
}

/** Object-shaped convenience wrapper around {@link decodeOpcode}. */
export function decodeHciOpcode(opcode: number): {
  ogf: number
  ocf: number
  name: string
} {
  const [ogf, ocf, name] = decodeOpcode(opcode)
  return { ogf, ocf, name }
}

/**
 * Decode an HCI event code into a human-readable name.
 *
 * For LE_META_EVENT (0x3E), inspects the first payload byte for the sub-event
 * code.
 */
export function decodeEvent(eventCode: number, payload?: Uint8Array | null): string {
  const name = HCI_EVENTS[eventCode]
  if (name === undefined) {
    return `UNKNOWN_EVENT_0x${hex(eventCode, 2)}`
  }

  if (eventCode === 0x3e && payload && payload.length > 0) {
    const subCode = payload[0]!
    const subName = LE_SUB_EVENTS[subCode]
    if (subName) {
      return `LE_META: ${subName}`
    }
    return `LE_META: UNKNOWN_SUB_0x${hex(subCode, 2)}`
  }

  return name
}

// ── BTSnoop framing ────────────────────────────────────────────────────

/** Check whether `data` starts with the BTSnoop magic bytes. */
export function isHciData(data: Uint8Array): boolean {
  if (data.length < BTSNOOP_MAGIC.length) return false
  return Buffer.from(data.subarray(0, 8)).equals(BTSNOOP_MAGIC)
}

/**
 * Parse the 16-byte BTSnoop file header.
 *
 * Returns `[version, data_link_type, header_end_offset]`.
 *
 * @throws Error when the data is not a valid BTSnoop file.
 */
export function parseBtsnoopHeader(
  data: Buffer,
  offset = 0,
): [version: number, data_link_type: number, header_end_offset: number] {
  if (data.length - offset < 16) {
    throw new Error('File too small for BTSnoop header (minimum 16 bytes)')
  }

  const magic = data.subarray(offset, offset + 8)
  if (!magic.equals(BTSNOOP_MAGIC)) {
    throw new Error(
      `Invalid BTSnoop magic bytes: expected b'btsnoop\\x00', got ${pythonBytesRepr(magic)}`,
    )
  }

  const version = data.readUInt32BE(offset + 8)
  const dataLinkType = data.readUInt32BE(offset + 12)

  return [version, dataLinkType, offset + 16]
}

/**
 * Parse a single BTSnoop packet record.
 *
 * Returns `[record, offset]` (the Python helper's tuple shape) or `null` when
 * fewer than 24 header bytes remain.
 */
export function parsePacketRecord(
  data: Buffer,
  offset: number,
): [record: HciPacketRecord, offset: number] | null {
  if (data.length - offset < 24) {
    return null
  }

  const originalLength = data.readUInt32BE(offset)
  const includedLength = data.readUInt32BE(offset + 4)
  const packetFlags = data.readUInt32BE(offset + 8)
  const cumulativeDrops = data.readUInt32BE(offset + 12)
  const timestampUs = data.readBigUInt64BE(offset + 16)

  // Direction: bit 0 (0 = Host→Controller, 1 = Controller→Host)
  const direction = packetFlags & 0x01 ? DIRECTION_CONTROLLER_TO_HOST : DIRECTION_HOST_TO_CONTROLLER

  // HCI type: prefer the UART transport indicator (first payload byte) when
  // present, falling back to flags bits 2-3, mirroring Wireshark.
  const payloadStart = offset + 24
  const payloadEnd = payloadStart + Math.min(includedLength, data.length - payloadStart)
  let payload = data.subarray(payloadStart, payloadEnd)

  let hciTypeName = 'UNKNOWN'
  let uartIndicator = 0
  if (payload.length > 0) {
    uartIndicator = payload[0]!
    hciTypeName = HCI_UART_INDICATORS[uartIndicator] ?? ''
  }

  if (!hciTypeName) {
    // Fall back to flags-based detection
    let hciType: number
    if (packetFlags & 0x10) {
      // Bit 4 set = ISO data (Bluetooth 5.2+)
      hciType = HCI_TYPE_ISO
    } else {
      hciType = (packetFlags >> 2) & 0x03
    }
    hciTypeName = HCI_TYPE_NAMES[hciType] ?? `UNKNOWN_${hciType}`
  }

  // Strip the UART transport indicator from the payload when present.
  if (HCI_UART_INDICATORS[uartIndicator] !== undefined) {
    payload = payload.subarray(1)
  }

  return [
    {
      original_length: originalLength,
      included_length: includedLength,
      packet_flags: packetFlags,
      cumulative_drops: cumulativeDrops,
      timestamp_us: timestampUs,
      direction,
      hci_type: hciTypeName,
      payload,
      next_offset: offset + 24 + includedLength,
    },
    offset,
  ]
}

// ── Timestamps and payload previews ───────────────────────────────────

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * Convert a BTSnoop microsecond timestamp to a UTC `YYYY-MM-DD HH:MM:SS.mmm`
 * string.
 *
 * BTSnoop timestamps are microseconds since Jan 1, 0 AD nominal. Following
 * Wireshark: if the raw value exceeds the 0 AD → Unix epoch offset, assume it
 * is truly AD-0 epoch and correct to Unix; otherwise (boot-relative or
 * already-Unix values from Android) use the raw value directly.
 */
export function usToTimestamp(timestampUs: number | bigint): string {
  let value = typeof timestampUs === 'bigint' ? timestampUs : BigInt(Math.trunc(timestampUs))
  if (value > BTSNOOP_EPOCH_OFFSET_US) {
    value -= BTSNOOP_EPOCH_OFFSET_US
  }

  // Floor division so negative (pre-1970) microsecond values keep the same
  // millisecond as Python's `datetime.fromtimestamp`.
  const epochMs = value >= 0n ? value / 1000n : (value - 999n) / 1000n
  if (epochMs < MIN_EPOCH_MS || epochMs > MAX_EPOCH_MS) {
    return `ts=${value}us`
  }

  const date = new Date(Number(epochMs))
  const year = date.getUTCFullYear()
  return (
    `${pad(year, 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    ` ${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:` +
    `${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`
  )
}

/** Convert payload bytes to a hex + ASCII summary string. */
export function payloadToHexStr(payload: Uint8Array, maxBytes = 64): string {
  if (payload.length === 0) {
    return '(empty)'
  }

  const truncated = payload.subarray(0, maxBytes)
  const hexPart = Array.from(truncated, (byte) => hex(byte, 2)).join(' ')
  let asciiPart = ''
  for (const byte of truncated) {
    asciiPart += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.'
  }
  const suffix = payload.length > maxBytes ? '...' : ''
  return `${hexPart}  |${asciiPart}|${suffix}`
}

// ── Compression handling (gz / zip / plain) ────────────────────────────

/**
 * Handle `.gz` and `.zip` compression, returning `[data, filename]`.
 *
 * @throws Error with Python-matching message prefixes for corrupt archives.
 */
export function decompress(data: Buffer, filename: string): [Buffer, string] {
  let output = data
  let name = filename

  if (name.toLowerCase().endsWith('.gz')) {
    try {
      output = gunzipSync(output)
      name = name.slice(0, -3)
    } catch (error) {
      throw new Error(`Invalid gzip file: ${errorMessage(error)}`)
    }
  }

  if (name.toLowerCase().endsWith('.zip')) {
    let entry
    try {
      entry = extractFirstZipEntry(output, HCI_ZIP_EXTENSIONS)
    } catch (error) {
      if (error instanceof ZipFormatError) {
        throw new Error(`Invalid ZIP file: ${error.message}`)
      }
      throw error
    }
    if (entry === null) {
      throw new Error('No .log/.hci/.btsnoop/.cfa file found in zip archive')
    }
    output = entry.content
    name = entry.filename
  }

  return [output, name]
}

// ── Filtering ──────────────────────────────────────────────────────────

/**
 * Check whether a single entry matches all active filters.
 *
 * Mirrors Python's `_match_entry`: unlike {@link HciAnalyzer.filterHci},
 * entries without a timestamp are *not* rejected by time filters.
 */
export function matchHciEntry(entry: HciEntry, filters: HciFilters): boolean {
  if (filters.direction) {
    if (entry.direction !== filters.direction) return false
  }

  if (filters.hci_type) {
    if (entry.hci_type !== filters.hci_type) return false
  }

  if (filters.opcode !== null && filters.opcode !== undefined) {
    if (entry.opcode !== filters.opcode) return false
  }

  if (filters.opcode_name) {
    if (!entry.opcode_name) return false
    if (!entry.opcode_name.toUpperCase().includes(filters.opcode_name.toUpperCase())) {
      return false
    }
  }

  if (filters.event_code !== null && filters.event_code !== undefined) {
    if (entry.event_code !== filters.event_code) return false
  }

  if (filters.event_name) {
    if (!entry.event_name) return false
    if (!entry.event_name.toUpperCase().includes(filters.event_name.toUpperCase())) {
      return false
    }
  }

  if (filters.keywords) {
    const keyword = filters.keywords.toLowerCase()
    if (!entry.raw_summary.toLowerCase().includes(keyword)) return false
  }

  if (filters.start_time && entry.timestamp) {
    if (entry.timestamp < filters.start_time) return false
  }

  if (filters.end_time && entry.timestamp) {
    if (entry.timestamp > filters.end_time) return false
  }

  return true
}

// ── Analyzer ───────────────────────────────────────────────────────────

/** Analyzer for Bluetooth HCI (BTSnoop format) log files. */
export class HciAnalyzer {
  static readonly BTSNOOP_EPOCH_OFFSET_US = BTSNOOP_EPOCH_OFFSET_US

  static isHciData(data: Uint8Array): boolean {
    return isHciData(data)
  }

  static decompress(data: Buffer, filename: string): [Buffer, string] {
    return decompress(data, filename)
  }

  static parseHeader(
    data: Buffer,
    offset = 0,
  ): [version: number, data_link_type: number, header_end_offset: number] {
    return parseBtsnoopHeader(data, offset)
  }

  static parsePacketRecord(
    data: Buffer,
    offset: number,
  ): [record: HciPacketRecord, offset: number] | null {
    return parsePacketRecord(data, offset)
  }

  static usToTimestamp(timestampUs: number | bigint): string {
    return usToTimestamp(timestampUs)
  }

  static payloadToHexStr(payload: Uint8Array, maxBytes = 64): string {
    return payloadToHexStr(payload, maxBytes)
  }

  static matchEntry(entry: HciEntry, filters: HciFilters): boolean {
    return matchHciEntry(entry, filters)
  }

  /** Convert a parsed packet record into an HciEntry. */
  private recordToEntry(
    record: HciPacketRecord,
    packetNumber: number,
    sourceFile: string | null = null,
  ): HciEntry {
    const payload = record.payload
    const hciType = record.hci_type
    const timestamp = usToTimestamp(record.timestamp_us)

    let opcode: number | null = null
    let opcodeName: string | null = null
    let eventCode: number | null = null
    let eventName: string | null = null
    const summaryParts = [`#${packetNumber}`, record.direction, hciType]

    if (hciType === 'COMMAND' && payload.length >= 2) {
      opcode = payload.readUInt16LE(0)
      const [, , name] = decodeOpcode(opcode)
      opcodeName = name
      summaryParts.push(`0x${hex(opcode, 4)} (${name})`)
    } else if (hciType === 'EVENT' && payload.length >= 1) {
      eventCode = payload[0]!
      eventName = decodeEvent(eventCode, payload.length > 1 ? payload.subarray(1, 2) : null)
      summaryParts.push(`Evt 0x${hex(eventCode, 2)} (${eventName})`)
    }

    summaryParts.push(`len=${payload.length}`)
    const rawSummary = `${summaryParts.join(' | ')}\n${payloadToHexStr(payload)}`

    return {
      packet_number: packetNumber,
      timestamp,
      direction: record.direction,
      hci_type: hciType,
      opcode,
      opcode_name: opcodeName,
      event_code: eventCode,
      event_name: eventName,
      data_length: payload.length,
      raw_summary: rawSummary,
      source_file: sourceFile,
    }
  }

  /** Parse BTSnoop bytes and yield HciEntry objects one by one. */
  private *parseHciBytesIter(data: Buffer, sourceFile: string | null = null): Generator<HciEntry> {
    const [, , headerEnd] = parseBtsnoopHeader(data, 0)
    let offset = headerEnd
    let packetNumber = 0

    while (offset < data.length) {
      const result = parsePacketRecord(data, offset)
      if (result === null) break
      const [record] = result
      packetNumber += 1
      yield this.recordToEntry(record, packetNumber, sourceFile)
      offset = record.next_offset
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Check if data starts with BTSnoop magic bytes. */
  isHciData(data: Uint8Array): boolean {
    return isHciData(data)
  }

  /** Parse a BTSnoop file from raw bytes. */
  parseHci(data: Buffer, filename = 'btsnoop_hci.log'): HciParseResult {
    const [decompressed, sourceName] = decompress(data, filename)

    if (!isHciData(decompressed)) {
      throw new Error('File does not appear to be a valid BTSnoop (HCI) file')
    }

    const entries = [...this.parseHciBytesIter(decompressed, sourceName)]

    return {
      entries,
      total_packets: entries.length,
      format_detected: 'btsnoop',
      file_size: decompressed.length,
    }
  }

  /** Stream HCI packets from a BTSnoop file one by one. */
  *streamHci(data: Buffer, filename = 'btsnoop_hci.log'): Generator<HciEntry> {
    const [decompressed, sourceName] = decompress(data, filename)

    if (!isHciData(decompressed)) {
      throw new Error('File does not appear to be a valid BTSnoop (HCI) file')
    }

    yield* this.parseHciBytesIter(decompressed, sourceName)
  }

  /** Apply filters to a list of HCI entries. */
  filterHci(entries: HciEntry[], filters: HciFilters): HciEntry[] {
    let result = entries

    if (filters.direction) {
      result = result.filter((entry) => entry.direction === filters.direction)
    }

    if (filters.hci_type) {
      result = result.filter((entry) => entry.hci_type === filters.hci_type)
    }

    if (filters.opcode !== null && filters.opcode !== undefined) {
      result = result.filter((entry) => entry.opcode === filters.opcode)
    }

    if (filters.opcode_name) {
      const nameUpper = filters.opcode_name.toUpperCase()
      result = result.filter(
        (entry) => entry.opcode_name && entry.opcode_name.toUpperCase().includes(nameUpper),
      )
    }

    if (filters.event_code !== null && filters.event_code !== undefined) {
      result = result.filter((entry) => entry.event_code === filters.event_code)
    }

    if (filters.event_name) {
      const eventNameUpper = filters.event_name.toUpperCase()
      result = result.filter(
        (entry) => entry.event_name && entry.event_name.toUpperCase().includes(eventNameUpper),
      )
    }

    if (filters.keywords) {
      const keyword = filters.keywords.toLowerCase()
      result = result.filter((entry) => entry.raw_summary.toLowerCase().includes(keyword))
    }

    if (filters.start_time) {
      result = result.filter((entry) => entry.timestamp && entry.timestamp >= filters.start_time!)
    }

    if (filters.end_time) {
      result = result.filter((entry) => entry.timestamp && entry.timestamp <= filters.end_time!)
    }

    return result
  }

  /** Compute statistics for a list of HCI entries. */
  computeStatistics(entries: HciEntry[]): HciStatistics {
    if (entries.length === 0) {
      return {
        total: 0,
        by_direction: {},
        by_type: {},
        duration_seconds: null,
        unique_opcodes: 0,
      }
    }

    const byDirection: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const opcodes = new Set<number>()

    for (const entry of entries) {
      byDirection[entry.direction] = (byDirection[entry.direction] ?? 0) + 1
      byType[entry.hci_type] = (byType[entry.hci_type] ?? 0) + 1
      if (entry.opcode !== null) {
        opcodes.add(entry.opcode)
      }
    }

    let durationSeconds: number | null = null
    const timestamps = entries
      .map((entry) => entry.timestamp)
      .filter((timestamp): timestamp is string => Boolean(timestamp))
    if (timestamps.length >= 2) {
      const parsed = timestamps.map(parseTimestampMillis)
      if (parsed.every((value): value is number => value !== null)) {
        const duration = (Math.max(...parsed) - Math.min(...parsed)) / 1000
        durationSeconds = duration
      }
    }

    return {
      total: entries.length,
      by_direction: byDirection,
      by_type: byType,
      duration_seconds: durationSeconds,
      unique_opcodes: opcodes.size,
    }
  }

  /**
   * Stream filtered packets from a BTSnoop file on disk.
   *
   * Handles plain files, `.gz` and `.zip` inputs. For `.gz`/`.zip` the
   * `source_file` is the archive filename or the archive member name,
   * matching Python's behavior.
   */
  *streamFilterFromPath(filePath: string, filters: HciFilters | null = null): Generator<HciEntry> {
    const realPath = resolveRealPath(filePath)
    if (!isFile(realPath)) {
      throw new Error(`HCI file not found: ${realPath}`)
    }

    const lower = realPath.toLowerCase()

    if (lower.endsWith('.gz')) {
      const data = gunzipSync(readFileSync(realPath))
      let decompressed: Buffer = data
      try {
        const [inner] = decompress(data, basename(realPath))
        decompressed = inner
      } catch {
        decompressed = data
      }
      const sourceFile = basename(realPath)
      for (const entry of this.parseHciBytesIter(decompressed, sourceFile)) {
        if (filters === null || matchHciEntry(entry, filters)) {
          yield entry
        }
      }
      return
    }

    if (lower.endsWith('.zip')) {
      const data = readFileSync(realPath)
      const [decompressed, sourceName] = decompressArchive(data, basename(realPath))
      for (const entry of this.parseHciBytesIter(decompressed, sourceName)) {
        if (filters === null || matchHciEntry(entry, filters)) {
          yield entry
        }
      }
      return
    }

    const data = readFileSync(realPath)
    if (!isHciData(data)) {
      throw new Error('File does not appear to be a valid BTSnoop (HCI) file')
    }

    const sourceFile = basename(realPath)
    for (const entry of this.parseHciBytesIter(data, sourceFile)) {
      if (filters === null || matchHciEntry(entry, filters)) {
        yield entry
      }
    }
  }
}

// ── Internal path helpers ─────────────────────────────────────────────

function decompressArchive(data: Buffer, filename: string): [Buffer, string] {
  try {
    return decompress(data, filename)
  } catch {
    throw new Error('No HCI file found in zip archive')
  }
}

function resolveRealPath(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    return resolve(filePath)
  }
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Parse a `YYYY-MM-DD HH:MM:SS.ffffff` timestamp to epoch milliseconds.
 *
 * Returns `null` for anything Python's `datetime.strptime` would reject with a
 * `ValueError` (wrong shape, impossible calendar date, out-of-range field).
 */
function parseTimestampMillis(timestamp: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,6})$/.exec(timestamp)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const millis = Number(fraction!.padEnd(3, '0').slice(0, 3))

  // Python's datetime only supports years 1..9999.
  if (year < 1 || year > 9999) return null

  // `Date.UTC` maps years 0..99 to 1900..1999, so set the full year first.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, millis)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millis
  ) {
    return null
  }
  return date.getTime()
}

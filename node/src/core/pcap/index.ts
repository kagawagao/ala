/**
 * Network capture analysis (PCAP / PCAPng) — dependency-free port of
 * ``backend/src/ala/services/pcap_analyzer.py``.
 *
 * The Python implementation relies on scapy for packet decoding. This port
 * parses the capture container and the Ethernet/IP/TCP/UDP/ICMP layers itself,
 * producing the same `PcapEntry` fields (snake_case wire names).
 */
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { readZipEntries, readZipMember } from '../log/zip.ts'

export interface PcapEntry {
  packet_number: number
  timestamp: string | null
  protocol: string
  src_ip: string
  dst_ip: string
  src_port: number | null
  dst_port: number | null
  length: number
  tcp_flags: string | null
  info: string
  raw_summary: string
  source_file: string | null
}

export interface PcapFilters {
  start_time?: string | null
  end_time?: string | null
  protocol?: string | null
  src_ip?: string | null
  dst_ip?: string | null
  src_port?: number | null
  dst_port?: number | null
  tcp_flags?: string | null
  keywords?: string | null
}

export interface PcapStatistics {
  total: number
  by_protocol: Record<string, number>
  unique_ips: number
  unique_connections: number
  duration_seconds: number | null
}

export interface PcapParseResult {
  entries: PcapEntry[]
  total_packets: number
  format_detected: string
  file_size: number
}

// ── Link-layer and network-layer constants ──────────────────────────────

const PCAP_MAGIC_US_BE = 0xa1b2c3d4
const PCAP_MAGIC_US_LE = 0xd4c3b2a1
const PCAP_MAGIC_NS_BE = 0xa1b23c4d
const PCAP_MAGIC_NS_LE = 0x4d3cb2a1
const PCAPNG_SECTION_HEADER = 0x0a0d0d0a

const PCAPNG_INTERFACE_DESCRIPTION = 0x00000001
const PCAPNG_ENHANCED_PACKET = 0x00000006
const PCAPNG_SIMPLE_PACKET = 0x00000003

const LINKTYPE_NULL = 0
const LINKTYPE_ETHERNET = 1
const LINKTYPE_RAW_IP = 101
const LINKTYPE_LINUX_SLL = 113
const LINKTYPE_LINUX_SLL2 = 276

const IP_PROTOCOL_NAMES: Readonly<Record<number, string>> = {
  0: 'HOPOPT',
  1: 'ICMP',
  2: 'IGMP',
  6: 'TCP',
  17: 'UDP',
  41: 'IPv6',
  47: 'GRE',
  50: 'ESP',
  51: 'AH',
  58: 'ICMPv6',
  89: 'OSPF',
  132: 'SCTP',
}

interface FrameInfo {
  protocol: string
  src_ip: string
  dst_ip: string
  src_port: number | null
  dst_port: number | null
  tcp_flags: string | null
  layer_note: string
}

/** A capture packet with its captured bytes and timestamp in epoch seconds. */
interface RawPacket {
  data: Buffer
  seconds: number
  linktype: number
}

function magicOf(data: Uint8Array): number {
  if (data.length < 4) return 0
  return ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0
}

function formatTimestamp(seconds: number): string {
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('T', ' ').slice(0, 23)
}

function ipBytesToString(bytes: Uint8Array, offset: number, length: 4 | 16): string {
  if (length === 4) {
    return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`
  }
  const parts: string[] = []
  for (let index = 0; index < 16; index += 2) {
    parts.push(((bytes[offset + index]! << 8) | bytes[offset + index + 1]!).toString(16))
  }
  return parts.join(':')
}

function tcpFlagsOf(flagByte: number): string | null {
  const flags: string[] = []
  if (flagByte & 0x02) flags.push('SYN')
  if (flagByte & 0x10) flags.push('ACK')
  if (flagByte & 0x01) flags.push('FIN')
  if (flagByte & 0x04) flags.push('RST')
  if (flagByte & 0x08) flags.push('PSH')
  if (flagByte & 0x20) flags.push('URG')
  return flags.length > 0 ? flags.join(',') : null
}

function decodeTransport(
  data: Buffer,
  offset: number,
  protocolNumber: number,
): Pick<FrameInfo, 'protocol' | 'src_port' | 'dst_port' | 'tcp_flags'> {
  if (protocolNumber === 6 && data.length >= offset + 20) {
    const srcPort = data.readUInt16BE(offset)
    const dstPort = data.readUInt16BE(offset + 2)
    return {
      protocol: 'TCP',
      src_port: srcPort,
      dst_port: dstPort,
      tcp_flags: tcpFlagsOf(data[offset + 13]!),
    }
  }
  if (protocolNumber === 17 && data.length >= offset + 8) {
    return {
      protocol: 'UDP',
      src_port: data.readUInt16BE(offset),
      dst_port: data.readUInt16BE(offset + 2),
      tcp_flags: null,
    }
  }
  return {
    protocol: IP_PROTOCOL_NAMES[protocolNumber] ?? String(protocolNumber),
    src_port: null,
    dst_port: null,
    tcp_flags: null,
  }
}

/** Decode IPv4 starting at `offset`; returns null when the header is truncated. */
function decodeIPv4(data: Buffer, offset: number): FrameInfo | null {
  if (data.length < offset + 20) return null
  const version = data[offset]! >> 4
  if (version !== 4) return null
  const headerLength = (data[offset]! & 0x0f) * 4
  if (headerLength < 20) return null
  const protocolNumber = data[offset + 9]!
  const fragmentOffset = data.readUInt16BE(offset + 6) & 0x1fff
  const srcIp = ipBytesToString(data, offset + 12, 4)
  const dstIp = ipBytesToString(data, offset + 16, 4)
  if (fragmentOffset > 0) {
    return {
      protocol: IP_PROTOCOL_NAMES[protocolNumber] ?? String(protocolNumber),
      src_ip: srcIp,
      dst_ip: dstIp,
      src_port: null,
      dst_port: null,
      tcp_flags: null,
      layer_note: 'IP / fragment',
    }
  }
  const transport = decodeTransport(data, offset + headerLength, protocolNumber)
  return { ...transport, src_ip: srcIp, dst_ip: dstIp, layer_note: 'IP' }
}

/** Decode IPv6 starting at `offset`, walking extension headers to the transport. */
function decodeIPv6(data: Buffer, offset: number): FrameInfo | null {
  if (data.length < offset + 40) return null
  if (data[offset]! >> 4 !== 6) return null
  let nextHeader = data[offset + 6]!
  const srcIp = ipBytesToString(data, offset + 8, 16)
  const dstIp = ipBytesToString(data, offset + 24, 16)
  let cursor = offset + 40
  for (let hops = 0; hops < 8; hops += 1) {
    if (nextHeader === 0 || nextHeader === 43 || nextHeader === 60) {
      if (data.length < cursor + 2) break
      const length = (data[cursor + 1]! + 1) * 8
      nextHeader = data[cursor]!
      cursor += length
      continue
    }
    if (nextHeader === 51) {
      if (data.length < cursor + 2) break
      const length = (data[cursor + 1]! + 2) * 4
      nextHeader = data[cursor]!
      cursor += length
      continue
    }
    if (nextHeader === 44) {
      if (data.length < cursor + 8) break
      nextHeader = data[cursor]!
      cursor += 8
      continue
    }
    break
  }
  const transport = decodeTransport(data, cursor, nextHeader)
  return { ...transport, src_ip: srcIp, dst_ip: dstIp, layer_note: 'IPv6' }
}

/** Decode the captured frame according to the interface link type. */
function decodeFrame(data: Buffer, linktype: number): FrameInfo {
  const unknown: FrameInfo = {
    protocol: 'UNKNOWN',
    src_ip: '?',
    dst_ip: '?',
    src_port: null,
    dst_port: null,
    tcp_flags: null,
    layer_note: 'Raw',
  }

  if (linktype === LINKTYPE_NULL) {
    if (data.length < 4) return unknown
    const family = data.readUInt32LE(0)
    if (family === 2) return decodeIPv4(data, 4) ?? unknown
    return unknown
  }

  if (linktype === LINKTYPE_RAW_IP) {
    const version = data.length > 0 ? data[0]! >> 4 : 0
    if (version === 4) return decodeIPv4(data, 0) ?? unknown
    if (version === 6) return decodeIPv6(data, 0) ?? unknown
    return unknown
  }

  // Linux cooked captures: a 16-byte header, then the network layer.
  if (linktype === LINKTYPE_LINUX_SLL) {
    if (data.length < 16) return unknown
    return decodeFromEtherType(data.readUInt16BE(14), data, 16) ?? unknown
  }
  if (linktype === LINKTYPE_LINUX_SLL2) {
    if (data.length < 20) return unknown
    return decodeFromEtherType(data.readUInt16BE(0), data, 20) ?? unknown
  }

  // Ethernet (the default for captures ALA handles).
  if (data.length < 14) return unknown
  const outerType = data.readUInt16BE(12)
  let offset = 14
  let etherType = outerType
  for (let hops = 0; hops < 4; hops += 1) {
    if (etherType !== 0x8100 && etherType !== 0x88a8 && etherType !== 0x9100) break
    if (data.length < offset + 4) return unknown
    etherType = data.readUInt16BE(offset + 2)
    offset += 4
  }
  return decodeFromEtherType(etherType, data, offset) ?? unknown
}

function decodeFromEtherType(etherType: number, data: Buffer, offset: number): FrameInfo | null {
  if (etherType === 0x0800) return decodeIPv4(data, offset)
  if (etherType === 0x86dd) return decodeIPv6(data, offset)
  if (etherType === 0x0806) {
    return {
      protocol: 'ARP',
      src_ip: '?',
      dst_ip: '?',
      src_port: null,
      dst_port: null,
      tcp_flags: null,
      layer_note: 'ARP',
    }
  }
  return null
}

function packetToEntry(
  packet: RawPacket,
  packetNumber: number,
  sourceFile: string | null,
): PcapEntry {
  const frame = decodeFrame(packet.data, packet.linktype)
  const info =
    `${frame.src_ip}${frame.src_port !== null ? `:${frame.src_port}` : ''} → ` +
    `${frame.dst_ip}${frame.dst_port !== null ? `:${frame.dst_port}` : ''}` +
    (frame.tcp_flags ? ` [${frame.tcp_flags}]` : '')
  return {
    packet_number: packetNumber,
    timestamp: formatTimestamp(packet.seconds),
    protocol: frame.protocol,
    src_ip: frame.src_ip,
    dst_ip: frame.dst_ip,
    src_port: frame.src_port,
    dst_port: frame.dst_port,
    length: packet.data.length,
    tcp_flags: frame.tcp_flags,
    info,
    raw_summary: `Ether / ${frame.layer_note} / ${frame.protocol} ${info}`,
    source_file: sourceFile,
  }
}

// ── Container parsing ───────────────────────────────────────────────────

function* parseClassicPcap(data: Buffer, sourceFile: string | null): Generator<RawPacket> {
  const magic = magicOf(data)
  const littleEndian = magic === PCAP_MAGIC_US_LE || magic === PCAP_MAGIC_NS_LE
  const nanoseconds = magic === PCAP_MAGIC_NS_BE || magic === PCAP_MAGIC_NS_LE
  if (!littleEndian && magic !== PCAP_MAGIC_US_BE && magic !== PCAP_MAGIC_NS_BE) {
    throw new Error('File does not appear to be a valid PCAP or PCAPNG file')
  }
  if (data.length < 24) throw new Error('Failed to parse pcap file: truncated global header')
  const readU32 = littleEndian
    ? (offset: number) => data.readUInt32LE(offset)
    : (offset: number) => data.readUInt32BE(offset)
  const linktype = readU32(20) & 0xffff

  let offset = 24
  while (offset + 16 <= data.length) {
    const seconds = readU32(offset)
    const fraction = readU32(offset + 4)
    const includedLength = readU32(offset + 8)
    offset += 16
    if (includedLength === 0) break
    if (offset + includedLength > data.length) {
      throw new Error('Failed to parse pcap file: truncated packet record')
    }
    const packetData = data.subarray(offset, offset + includedLength)
    offset += includedLength
    const fractionSeconds = nanoseconds ? fraction / 1_000_000_000 : fraction / 1_000_000
    yield { data: packetData, seconds: seconds + fractionSeconds, linktype }
  }
  void sourceFile
}

function* parsePcapng(data: Buffer, sourceFile: string | null): Generator<RawPacket> {
  let offset = 0
  let littleEndian = true
  let interfaces: { linktype: number; timestampDivisor: number }[] = []

  const readU32 = (at: number, le = littleEndian): number =>
    le ? data.readUInt32LE(at) : data.readUInt32BE(at)

  while (offset + 12 <= data.length) {
    const blockType = readU32(offset)
    if (blockType === PCAPNG_SECTION_HEADER) {
      if (offset + 12 > data.length) break
      const byteOrderMagic = readU32(offset + 8, true)
      if (byteOrderMagic === 0x1a2b3c4d) littleEndian = true
      else if (byteOrderMagic === 0x4d3c2b1a) littleEndian = false
      else throw new Error('Failed to parse pcap file: invalid pcapng byte-order magic')
      interfaces = []
    }
    const totalLength = readU32(offset + 4)
    if (totalLength < 12 || offset + totalLength > data.length) {
      throw new Error('Failed to parse pcap file: invalid pcapng block length')
    }
    const body = offset + 8
    const bodyEnd = offset + totalLength - 4

    if (blockType === PCAPNG_INTERFACE_DESCRIPTION && body + 8 <= bodyEnd) {
      const linktype = littleEndian ? data.readUInt16LE(body) : data.readUInt16BE(body)
      let timestampDivisor = 1_000_000
      // if_tsresol option: code 9, length 1; high bit selects base 2.
      let option = body + 8
      while (option + 4 <= bodyEnd) {
        const code =
          littleEndian ? data.readUInt16LE(option) : data.readUInt16BE(option)
        const length =
          littleEndian ? data.readUInt16LE(option + 2) : data.readUInt16BE(option + 2)
        if (code === 0) break
        if (code === 9 && length >= 1 && option + 4 < bodyEnd) {
          const resolution = data[option + 4]!
          timestampDivisor = resolution & 0x80 ? 2 ** (resolution & 0x7f) : 10 ** resolution
        }
        option += 4 + length + ((4 - (length % 4)) % 4)
      }
      interfaces.push({ linktype, timestampDivisor })
    } else if (blockType === PCAPNG_ENHANCED_PACKET && body + 20 <= bodyEnd) {
      const interfaceId = readU32(body)
      const timestampHigh = readU32(body + 4)
      const timestampLow = readU32(body + 8)
      const capturedLength = readU32(body + 12)
      const packetStart = body + 20
      if (capturedLength > 0 && packetStart + capturedLength <= data.length) {
        const linktype = interfaces[interfaceId]?.linktype ?? LINKTYPE_ETHERNET
        const divisor = interfaces[interfaceId]?.timestampDivisor ?? 1_000_000
        const timestamp = timestampHigh * 2 ** 32 + timestampLow
        yield {
          data: data.subarray(packetStart, packetStart + capturedLength),
          seconds: timestamp / divisor,
          linktype,
        }
      }
    } else if (blockType === PCAPNG_SIMPLE_PACKET && body + 4 <= bodyEnd) {
      const capturedLength = Math.min(readU32(body), bodyEnd - (body + 4))
      if (capturedLength > 0) {
        yield {
          data: data.subarray(body + 4, body + 4 + capturedLength),
          seconds: 0,
          linktype: interfaces[0]?.linktype ?? LINKTYPE_ETHERNET,
        }
      }
    }
    offset += totalLength
  }
  void sourceFile
}

function* iterPackets(data: Buffer, sourceFile: string | null): Generator<RawPacket> {
  if (magicOf(data) === PCAPNG_SECTION_HEADER) yield* parsePcapng(data, sourceFile)
  else yield* parseClassicPcap(data, sourceFile)
}

/** Detect whether the buffer starts with a supported capture magic. */
export function isPcapData(data: Uint8Array): boolean {
  const magic = magicOf(data)
  return (
    magic === PCAP_MAGIC_US_BE ||
    magic === PCAP_MAGIC_US_LE ||
    magic === PCAP_MAGIC_NS_BE ||
    magic === PCAP_MAGIC_NS_LE ||
    magic === PCAPNG_SECTION_HEADER
  )
}

/** Decompress `.gz` or extract the first capture member of a `.zip`. */
function decompress(data: Buffer, filename: string): { data: Buffer; filename: string } {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.gz')) {
    try {
      return { data: gunzipSync(data), filename: filename.slice(0, -3) }
    } catch (error) {
      throw new Error(
        `Invalid gzip file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (lower.endsWith('.zip')) {
    let entries
    try {
      entries = readZipEntries(data)
    } catch (error) {
      throw new Error(`Invalid ZIP file: ${error instanceof Error ? error.message : String(error)}`)
    }
    const member = entries.find((entry) => {
      const name = entry.name.toLowerCase()
      return name.endsWith('.pcap') || name.endsWith('.pcapng')
    })
    if (!member) throw new Error('No .pcap or .pcapng file found in zip archive')
    return { data: readZipMember(data, member), filename: member.name }
  }
  return { data, filename }
}

function joinFlags(flags: string | null | undefined): string | null {
  return flags && flags.length > 0 ? flags : null
}

/** Port of the Python `_match_entry` (a null timestamp passes time filters). */
export function matchPcapEntry(entry: PcapEntry, filters: PcapFilters): boolean {
  if (filters.protocol && entry.protocol.toUpperCase() !== filters.protocol.toUpperCase()) {
    return false
  }
  if (filters.src_ip && !entry.src_ip.includes(filters.src_ip)) return false
  if (filters.dst_ip && !entry.dst_ip.includes(filters.dst_ip)) return false
  if (
    filters.src_port !== null &&
    filters.src_port !== undefined &&
    entry.src_port !== filters.src_port
  ) {
    return false
  }
  if (
    filters.dst_port !== null &&
    filters.dst_port !== undefined &&
    entry.dst_port !== filters.dst_port
  ) {
    return false
  }
  if (filters.tcp_flags) {
    const flags = joinFlags(entry.tcp_flags)
    if (!flags || !flags.toUpperCase().includes(filters.tcp_flags.toUpperCase())) return false
  }
  if (filters.keywords) {
    const keyword = filters.keywords.toLowerCase()
    if (
      !entry.info.toLowerCase().includes(keyword) &&
      !entry.raw_summary.toLowerCase().includes(keyword)
    ) {
      return false
    }
  }
  if (filters.start_time && entry.timestamp && entry.timestamp < filters.start_time) return false
  if (filters.end_time && entry.timestamp && entry.timestamp > filters.end_time) return false
  return true
}

export class PcapAnalyzer {
  /** Whether the buffer looks like a PCAP or PCAPng capture. */
  isPcapData(data: Uint8Array): boolean {
    return isPcapData(data)
  }

  /** Parse a capture held in memory (gz/zip handled by `filename`). */
  parsePcap(data: Buffer, filename = 'capture.pcap'): PcapParseResult {
    const decompressed = decompress(data, filename)
    if (!this.isPcapData(decompressed.data)) {
      throw new Error('File does not appear to be a valid PCAP or PCAPNG file')
    }
    const format = magicOf(decompressed.data) === PCAPNG_SECTION_HEADER ? 'pcapng' : 'pcap'
    const entries = [...this.iterEntries(decompressed.data, decompressed.filename)]
    return {
      entries,
      total_packets: entries.length,
      format_detected: format,
      file_size: decompressed.data.length,
    }
  }

  /** Stream packets from a capture held in memory. */
  *streamPcap(data: Buffer, filename = 'capture.pcap'): Generator<PcapEntry> {
    const decompressed = decompress(data, filename)
    if (!this.isPcapData(decompressed.data)) {
      throw new Error('File does not appear to be a valid PCAP or PCAPNG file')
    }
    yield* this.iterEntries(decompressed.data, decompressed.filename)
  }

  /** Filter decoded entries; null timestamp entries are dropped by a time filter. */
  filterPcap(entries: PcapEntry[], filters: PcapFilters): PcapEntry[] {
    return entries.filter((entry) => {
      if (filters.protocol && entry.protocol.toUpperCase() !== filters.protocol.toUpperCase()) {
        return false
      }
      if (filters.src_ip && !entry.src_ip.includes(filters.src_ip)) return false
      if (filters.dst_ip && !entry.dst_ip.includes(filters.dst_ip)) return false
      if (
        filters.src_port !== null &&
        filters.src_port !== undefined &&
        entry.src_port !== filters.src_port
      ) {
        return false
      }
      if (
        filters.dst_port !== null &&
        filters.dst_port !== undefined &&
        entry.dst_port !== filters.dst_port
      ) {
        return false
      }
      if (filters.tcp_flags) {
        if (
          !entry.tcp_flags ||
          !entry.tcp_flags.toUpperCase().includes(filters.tcp_flags.toUpperCase())
        ) {
          return false
        }
      }
      if (filters.keywords) {
        const keyword = filters.keywords.toLowerCase()
        if (
          !entry.info.toLowerCase().includes(keyword) &&
          !entry.raw_summary.toLowerCase().includes(keyword)
        ) {
          return false
        }
      }
      if (filters.start_time && (!entry.timestamp || entry.timestamp < filters.start_time))
        return false
      if (filters.end_time && (!entry.timestamp || entry.timestamp > filters.end_time)) return false
      return true
    })
  }

  /** Aggregate protocol/endpoint/duration statistics. */
  computeStatistics(entries: PcapEntry[]): PcapStatistics {
    if (entries.length === 0) {
      return {
        total: 0,
        by_protocol: {},
        unique_ips: 0,
        unique_connections: 0,
        duration_seconds: null,
      }
    }
    const byProtocol: Record<string, number> = {}
    const ips = new Set<string>()
    const connections = new Set<string>()
    for (const entry of entries) {
      byProtocol[entry.protocol] = (byProtocol[entry.protocol] ?? 0) + 1
      if (entry.src_ip !== '?') ips.add(entry.src_ip)
      if (entry.dst_ip !== '?') ips.add(entry.dst_ip)
      if (entry.src_port !== null && entry.dst_port !== null) {
        connections.add(
          `${entry.src_ip}\u0000${entry.src_port}\u0000${entry.dst_ip}\u0000${entry.dst_port}`,
        )
      }
    }
    const timestamps = entries
      .map((entry) => entry.timestamp)
      .filter((value): value is string => Boolean(value))
    let durationSeconds: number | null = null
    if (timestamps.length >= 2) {
      const parsed = timestamps.map((timestamp) => Date.parse(`${timestamp}Z`))
      if (parsed.every((value) => Number.isFinite(value))) {
        durationSeconds = (Math.max(...parsed) - Math.min(...parsed)) / 1000
      }
    }
    return {
      total: entries.length,
      by_protocol: byProtocol,
      unique_ips: ips.size,
      unique_connections: connections.size,
      duration_seconds: durationSeconds,
    }
  }

  /** Stream filtered packets from a capture on disk (.pcap/.pcapng/.gz/.zip). */
  *streamFilterFromPath(path: string, filters: PcapFilters | null = null): Generator<PcapEntry> {
    const realPath = resolve(path)
    let info
    try {
      info = statSync(realPath)
    } catch {
      throw new Error(`PCAP file not found: ${realPath}`)
    }
    if (!info.isFile()) throw new Error(`PCAP file not found: ${realPath}`)

    const data = readFileSync(realPath)
    const sourceFile = basename(realPath)
    const lower = realPath.toLowerCase()
    let entries: Generator<PcapEntry>
    if (lower.endsWith('.gz') || lower.endsWith('.zip')) {
      entries = this.streamPcap(data, sourceFile)
    } else {
      if (!this.isPcapData(data.subarray(0, 4))) {
        throw new Error('File does not appear to be a valid PCAP or PCAPNG file')
      }
      entries = this.streamPcap(data, sourceFile)
    }
    for (const entry of entries) {
      if (filters === null || matchPcapEntry(entry, filters)) yield entry
    }
  }

  private *iterEntries(data: Buffer, sourceFile: string): Generator<PcapEntry> {
    let number = 0
    for (const packet of iterPackets(data, sourceFile)) {
      number += 1
      yield packetToEntry(packet, number, sourceFile)
    }
  }
}

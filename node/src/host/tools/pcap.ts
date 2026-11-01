/** Agent tools for network packet captures (PCAP / PCAPng). */
import { PcapAnalyzer, type PcapEntry, type PcapFilters } from '../../core/pcap/index.ts'
import type { AlaHostContext } from '../context.ts'
import { requireFile, clip } from '../paths.ts'
import {
  jsonContent,
  numberArgument,
  objectSchema,
  optionalInt,
  optionalNumber,
  optionalString,
  requiredString,
  stringArgument,
} from '../schema.ts'
import { mount } from '../mount.ts'

const analyzer = new PcapAnalyzer()
const MAX_OVERVIEW_PACKETS = 200_000

const FILTER_PROPERTIES = {
  protocol: stringArgument('Protocol to keep: TCP, UDP, ICMP, ICMPv6, ARP, or OTHER'),
  src_ip: stringArgument('Exact source IP'),
  dst_ip: stringArgument('Exact destination IP'),
  src_port: numberArgument('Exact source port'),
  dst_port: numberArgument('Exact destination port'),
  tcp_flags: stringArgument('TCP flags the packet must contain (e.g. SYN, ACK, RST)'),
  keyword: stringArgument('Case-insensitive substring searched in the packet info summary'),
  start_time: stringArgument('Keep packets with a timestamp at or after this value'),
  end_time: stringArgument('Keep packets with a timestamp at or before this value'),
} as const

function pcapFilters(args: unknown): PcapFilters {
  const filters: PcapFilters = {
    protocol: optionalString(args, 'protocol') ?? null,
    src_ip: optionalString(args, 'src_ip') ?? null,
    dst_ip: optionalString(args, 'dst_ip') ?? null,
    tcp_flags: optionalString(args, 'tcp_flags') ?? null,
    keywords: optionalString(args, 'keyword') ?? null,
    start_time: optionalString(args, 'start_time') ?? null,
    end_time: optionalString(args, 'end_time') ?? null,
  }
  const srcPort = optionalNumber(args, 'src_port')
  const dstPort = optionalNumber(args, 'dst_port')
  if (srcPort !== null) filters.src_port = srcPort
  if (dstPort !== null) filters.dst_port = dstPort
  return filters
}

function packetView(entry: PcapEntry) {
  return {
    packet_number: entry.packet_number,
    timestamp: entry.timestamp,
    protocol: entry.protocol,
    src_ip: entry.src_ip,
    src_port: entry.src_port,
    dst_ip: entry.dst_ip,
    dst_port: entry.dst_port,
    length: entry.length,
    tcp_flags: entry.tcp_flags,
    info: clip(entry.info, 500),
    source_file: entry.source_file,
  }
}

export function mountPcapTools(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_pcap_overview',
    description:
      'Summarize a PCAP/PCAPng capture: packet count, protocol distribution, unique IPs and connections, duration, and a sample of packets.',
    parameters: objectSchema(
      { path: stringArgument('Path to the capture (.pcap, .pcapng, .gz or .zip)') },
      ['path'],
    ),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const entries: PcapEntry[] = []
      let total = 0
      for (const entry of analyzer.streamFilterFromPath(path, null)) {
        total += 1
        if (entries.length < MAX_OVERVIEW_PACKETS) entries.push(entry)
      }
      return {
        path,
        total_packets: total,
        scanned_packets: entries.length,
        truncated: total > entries.length,
        statistics: analyzer.computeStatistics(entries),
        sample: entries.slice(0, 10).map(packetView),
      }
    },
  })

  mount(ctx, {
    name: 'ala_pcap_search',
    description:
      'Filter network packets lazily by protocol, IP, port, TCP flags, keyword, or timestamp range. Returns matching packets with packet numbers.',
    parameters: objectSchema(
      {
        path: stringArgument('Path to the capture'),
        limit: numberArgument('Maximum packets to return (default 50, max 500)'),
        offset: numberArgument('Skip this many matches (default 0)'),
        ...FILTER_PROPERTIES,
      },
      ['path'],
    ),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const filters = pcapFilters(args)
      const limit = optionalInt(args, 'limit', 50, { min: 1, max: 500 })
      const offset = optionalInt(args, 'offset', 0, { min: 0, max: 1_000_000 })
      const entries: ReturnType<typeof packetView>[] = []
      let matched = 0
      for (const entry of analyzer.streamFilterFromPath(path, filters)) {
        if (matched >= offset && entries.length < limit) entries.push(packetView(entry))
        matched += 1
      }
      return { matched, offset, returned: entries.length, entries, filters }
    },
  })
}

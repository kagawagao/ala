/** Agent tools for Bluetooth HCI (BTSnoop) captures. */
import {
  HciAnalyzer,
  decodeHciOpcode,
  type HciEntry,
  type HciFilters,
} from '../../core/hci/index.ts'
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

const analyzer = new HciAnalyzer()
const MAX_OVERVIEW_PACKETS = 200_000

const FILTER_PROPERTIES = {
  direction: stringArgument('HOST_TO_CONTROLLER or CONTROLLER_TO_HOST'),
  hci_type: stringArgument('COMMAND, EVENT, ACL_DATA, SCO_DATA or ISO_DATA'),
  opcode: numberArgument('Exact command opcode ((OGF << 10) | OCF)'),
  opcode_name: stringArgument('Case-insensitive substring of the command name'),
  event_code: numberArgument('Exact HCI event code'),
  event_name: stringArgument('Case-insensitive substring of the event name'),
  keyword: stringArgument('Case-insensitive substring searched in the raw packet summary'),
  start_time: stringArgument('Keep packets with a timestamp at or after this value'),
  end_time: stringArgument('Keep packets with a timestamp at or before this value'),
} as const

function hciFilters(args: unknown): HciFilters {
  return {
    direction: optionalString(args, 'direction') ?? null,
    hci_type: optionalString(args, 'hci_type') ?? null,
    opcode: optionalNumber(args, 'opcode'),
    opcode_name: optionalString(args, 'opcode_name') ?? null,
    event_code: optionalNumber(args, 'event_code'),
    event_name: optionalString(args, 'event_name') ?? null,
    keywords: optionalString(args, 'keyword') ?? null,
    start_time: optionalString(args, 'start_time') ?? null,
    end_time: optionalString(args, 'end_time') ?? null,
  }
}

function entryView(entry: HciEntry) {
  return {
    packet_number: entry.packet_number,
    timestamp: entry.timestamp,
    direction: entry.direction,
    hci_type: entry.hci_type,
    opcode: entry.opcode,
    opcode_name: entry.opcode_name,
    event_code: entry.event_code,
    event_name: entry.event_name,
    data_length: entry.data_length,
    raw_summary: clip(entry.raw_summary, 500),
    source_file: entry.source_file,
  }
}

export function mountHciTools(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_hci_overview',
    description:
      'Summarize a Bluetooth HCI BTSnoop capture: packet counts by type and direction, duration, unique opcodes, and a sample of packets.',
    parameters: objectSchema(
      { path: stringArgument('Path to the BTSnoop capture (.log, .gz, .zip)') },
      ['path'],
    ),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const entries: HciEntry[] = []
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
        sample: entries.slice(0, 10).map(entryView),
      }
    },
  })

  mount(ctx, {
    name: 'ala_hci_search',
    description:
      'Filter Bluetooth HCI packets lazily by type, direction, opcode/event, name substring, keyword, or timestamp range. Returns matching packets with packet numbers.',
    parameters: objectSchema(
      {
        path: stringArgument('Path to the BTSnoop capture'),
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
      const filters = hciFilters(args)
      const limit = optionalInt(args, 'limit', 50, { min: 1, max: 500 })
      const offset = optionalInt(args, 'offset', 0, { min: 0, max: 1_000_000 })
      const entries: ReturnType<typeof entryView>[] = []
      let matched = 0
      for (const entry of analyzer.streamFilterFromPath(path, filters)) {
        if (matched >= offset && entries.length < limit) entries.push(entryView(entry))
        matched += 1
      }
      return { matched, offset, returned: entries.length, entries, filters }
    },
  })

  mount(ctx, {
    name: 'ala_decode_hci_opcode',
    description: 'Decode an HCI command opcode into OGF, OCF and the command name.',
    parameters: objectSchema({ opcode: numberArgument('Command opcode ((OGF << 10) | OCF)') }, [
      'opcode',
    ]),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const opcode = optionalInt(args, 'opcode', 0, { min: 0, max: 0xffff })
      const decoded = decodeHciOpcode(opcode)
      return {
        opcode,
        opcode_hex: `0x${opcode.toString(16).toUpperCase().padStart(4, '0')}`,
        ogf: decoded.ogf,
        ogf_hex: `0x${decoded.ogf.toString(16).toUpperCase().padStart(2, '0')}`,
        ocf: decoded.ocf,
        ocf_hex: `0x${decoded.ocf.toString(16).toUpperCase().padStart(3, '0')}`,
        name: decoded.name,
      }
    },
  })
}

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AlaHostContext, ToolDefinition } from './context.ts'
import { apply } from './index.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SAMPLE_LOG = join(ROOT, 'examples/sample-android.log')
const SAMPLE_PCAP = join(ROOT, 'examples/sample-network.pcap')

interface ToolMap {
  tools: Map<string, ToolDefinition>
}

async function mountPlugin(): Promise<ToolMap> {
  const tools = new Map<string, ToolDefinition>()
  const ctx: AlaHostContext = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
  }
  await apply(ctx)
  return { tools }
}

async function run(tools: Map<string, ToolDefinition>, name: string, args: unknown) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Tool ${name} is not registered`)
  return (await tool.execute(args, { signal: new AbortController().signal })) as Record<
    string,
    unknown
  >
}

const ANR_TRACE = `----- pid 1234 at 2025-08-15 14:30:22 -----
Cmd line: com.example.app

"main" prio=5 tid=1 Blocked
  | group="main" sCount=1 dsCount=0
  at com.example.app.MainActivity.onCreate(MainActivity.java:42)

"worker" prio=5 tid=2 Native
  at android.os.MessageQueue.nativePollOnce(Native Method)

----- end 1234 -----
`

/** A minimal BTSnoop capture with one command and one event packet. */
function minimalBtsnoop(): Buffer {
  const header = Buffer.concat([
    Buffer.from('btsnoop\u0000', 'latin1'),
    Buffer.from([0, 0, 0, 1, 0, 0, 3, 233]),
  ])
  const tsBase = 1_609_459_200_000_000n
  const record = (payload: Buffer, flags: number, timestamp: bigint): Buffer => {
    const recordHeader = Buffer.alloc(24)
    recordHeader.writeUInt32BE(payload.length, 0)
    recordHeader.writeUInt32BE(payload.length, 4)
    recordHeader.writeUInt32BE(flags, 8)
    recordHeader.writeUInt32BE(0, 12)
    recordHeader.writeBigUInt64BE(timestamp, 16)
    return Buffer.concat([recordHeader, payload])
  }
  const command = Buffer.alloc(4)
  command.writeUInt16LE(0x2017, 0)
  command.writeUInt16LE(0, 2)
  const event = Buffer.from([0x0e, 0x04, 0x01, 0x17, 0x20, 0x00])
  return Buffer.concat([header, record(command, 0x00, tsBase), record(event, 0x0d, tsBase + 1000n)])
}

describe('ala-dsh host plugin', () => {
  it('registers every tool', async () => {
    const { tools } = await mountPlugin()
    expect([...tools.keys()].sort()).toEqual([
      'ala_decode_hci_opcode',
      'ala_detect_file_type',
      'ala_hci_overview',
      'ala_hci_search',
      'ala_log_overview',
      'ala_log_read_range',
      'ala_log_search',
      'ala_log_tail',
      'ala_parse_diagnostic',
      'ala_pcap_overview',
      'ala_pcap_search',
    ])
  })

  it('detects the artifact type by content', async () => {
    const { tools } = await mountPlugin()
    const result = await run(tools, 'ala_detect_file_type', { path: SAMPLE_LOG })
    expect(result).toMatchObject({ type: 'log' })
  })

  it('summarizes a logcat file', async () => {
    const { tools } = await mountPlugin()
    const result = (await run(tools, 'ala_log_overview', { path: SAMPLE_LOG, level: 'E' })) as {
      format: string
      line_count: number
      matched: number
      by_level: Record<string, number>
      sample: { line_number: number; level: string }[]
    }
    expect(result.format).toBe('android_logcat')
    expect(result.line_count).toBe(47)
    expect(result.matched).toBe(3)
    expect(result.by_level.E).toBe(3)
    expect(result.sample[0]).toMatchObject({ level: 'E' })
  })

  it('searches with pagination and filters', async () => {
    const { tools } = await mountPlugin()
    const result = (await run(tools, 'ala_log_search', {
      path: SAMPLE_LOG,
      level: 'E',
      limit: 1,
      offset: 1,
    })) as { matched: number; returned: number; entries: { line_number: number }[] }
    expect(result.matched).toBe(3)
    expect(result.returned).toBe(1)
    expect(result.entries[0]?.line_number).toBe(16)
  })

  it('reads a line range and the tail', async () => {
    const { tools } = await mountPlugin()
    const range = (await run(tools, 'ala_log_read_range', {
      path: SAMPLE_LOG,
      start_line: 15,
      end_line: 16,
    })) as { returned: number; entries: { line_number: number }[] }
    expect(range.returned).toBe(2)
    expect(range.entries.map((entry) => entry.line_number)).toEqual([15, 16])

    const tail = (await run(tools, 'ala_log_tail', { path: SAMPLE_LOG, lines: 2 })) as {
      lines: number
      entries: { line_number: number }[]
    }
    expect(tail.lines).toBe(2)
    expect(tail.entries.map((entry) => entry.line_number)).toEqual([46, 47])
  })

  it('parses a native ANR trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ala-host-'))
    const path = join(directory, 'anr_1234')
    await writeFile(path, ANR_TRACE)
    const { tools } = await mountPlugin()
    const result = (await run(tools, 'ala_parse_diagnostic', { path })) as {
      type: string
      all_threads: unknown[]
    }
    expect(result.type).toBe('anr_trace')
    expect(result.all_threads.length).toBeGreaterThan(0)
  })

  it('summarizes a PCAP capture', async () => {
    const { tools } = await mountPlugin()
    const result = (await run(tools, 'ala_pcap_overview', { path: SAMPLE_PCAP })) as {
      total_packets: number
      statistics: { by_protocol: Record<string, number> }
    }
    expect(result.total_packets).toBeGreaterThan(0)
    expect(result.statistics.by_protocol.TCP).toBeGreaterThan(0)

    const search = (await run(tools, 'ala_pcap_search', {
      path: SAMPLE_PCAP,
      protocol: 'TCP',
      limit: 3,
    })) as { matched: number; returned: number; entries: { protocol: string }[] }
    expect(search.matched).toBeGreaterThan(0)
    expect(search.returned).toBeLessThanOrEqual(3)
    expect(search.entries.every((entry) => entry.protocol === 'TCP')).toBe(true)
  })

  it('summarizes a BTSnoop capture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ala-host-'))
    const path = join(directory, 'btsnoop_hci.log')
    await writeFile(path, minimalBtsnoop())
    const { tools } = await mountPlugin()
    const result = (await run(tools, 'ala_hci_overview', { path })) as {
      total_packets: number
      statistics: { by_type: Record<string, number> }
    }
    expect(result.total_packets).toBe(2)
    expect(result.statistics.by_type.COMMAND).toBe(1)
    expect(result.statistics.by_type.EVENT).toBe(1)

    const decoded = (await run(tools, 'ala_decode_hci_opcode', { opcode: 0x2017 })) as {
      opcode: number
      opcode_hex: string
      ogf: number
      ocf: number
      name: string
    }
    expect(decoded).toMatchObject({ opcode: 0x2017, opcode_hex: '0x2017', ogf: 8, ocf: 0x17 })
    expect(decoded.name).toContain('LE_CREATE_CONNECTION')
  })
})

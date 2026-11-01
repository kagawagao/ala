#!/usr/bin/env node
/** `ala` CLI: headless inspection of Android diagnostics artifacts, ported to Node. */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { detectFileTypeFromPath } from '../core/file-detect/index.ts'
import { LogAnalyzer, createLogFilter, type LogFilters } from '../core/log/index.ts'

const analyzer = new LogAnalyzer()

const USAGE = `ALA - Android Log Analyzer (Node CLI)

Usage:
  ala detect <file>
  ala overview <file> [--level L] [--keyword REGEX] [--tag REGEX] [--pid PID] [--tid TID]
  ala search <file> [--level L] [--keyword REGEX] [--tag REGEX] [--pid PID] [--tid TID]
                   [--start TIME] [--end TIME] [--relation AND|OR] [--limit N]
  ala tail <file> [--lines N]

Options shared by overview and search: --level, --keyword, --tag, --pid, --tid,
--start/--end (compared against the entry timestamp), --relation (tag/keyword).
`

interface ParsedOptions {
  positional: string[]
  options: Record<string, string>
}

function parseArguments(argv: string[]): ParsedOptions {
  const positional: string[] = []
  const options: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument.startsWith('--')) {
      const [rawKey, inlineValue] = argument.slice(2).split('=', 2)
      if (inlineValue !== undefined) {
        options[rawKey!] = inlineValue
      } else {
        const value = argv[index + 1]
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`Option --${rawKey} needs a value`)
        }
        options[rawKey!] = value
        index += 1
      }
    } else {
      positional.push(argument)
    }
  }
  return { positional, options }
}

function filtersFrom(options: Record<string, string>): LogFilters {
  return {
    level: options.level ?? null,
    keywords: options.keyword ?? null,
    tag: options.tag ?? null,
    pid: options.pid ?? null,
    tid: options.tid ?? null,
    start_time: options.start ?? null,
    end_time: options.end ?? null,
    tag_keyword_relation: options.relation === 'OR' ? 'OR' : 'AND',
  }
}

function formatEntry(entry: {
  line_number: number
  timestamp: string | null
  pid: string | null
  level: string
  tag: string
  message: string
}): string {
  const time = entry.timestamp ?? '-'
  const pid = entry.pid ?? '-'
  return `${String(entry.line_number).padStart(6)}  ${time}  ${entry.level}  ${pid.padStart(6)}  ${entry.tag}: ${entry.message}`
}

function printOverview(path: string, options: Record<string, string>): void {
  const meta = analyzer.scanFileMeta(path)
  const predicate = createLogFilter(filtersFrom(options))
  const levelCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  const samples: string[] = []
  let matched = 0
  for (const entry of analyzer.streamFile(meta.path)) {
    if (!predicate(entry)) continue
    matched += 1
    levelCounts.set(entry.level, (levelCounts.get(entry.level) ?? 0) + 1)
    if (entry.tag !== 'Unknown') tagCounts.set(entry.tag, (tagCounts.get(entry.tag) ?? 0) + 1)
    if (samples.length < 10) samples.push(formatEntry(entry))
  }

  console.log(`file       ${meta.path}`)
  console.log(`format     ${meta.format_detected}`)
  console.log(`lines      ${meta.line_count}${meta.truncated ? ' (truncated)' : ''}`)
  console.log(`size       ${meta.size_bytes} bytes`)
  console.log(`matched    ${matched}`)
  const levels = [...levelCounts.entries()].sort((a, b) => b[1] - a[1])
  if (levels.length > 0) console.log(`levels     ${levels.map(([k, v]) => `${k}=${v}`).join(' ')}`)
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (tags.length > 0) console.log(`top tags   ${tags.map(([k, v]) => `${k}=${v}`).join(' ')}`)
  if (samples.length > 0) {
    console.log('\nfirst matches:')
    for (const line of samples) console.log(line)
  }
}

function printSearch(path: string, options: Record<string, string>): void {
  const limit = Number(options.limit ?? '50')
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer')
  const predicate = createLogFilter(filtersFrom(options))
  let matched = 0
  let printed = 0
  for (const entry of analyzer.streamFile(path)) {
    if (!predicate(entry)) continue
    matched += 1
    if (printed < limit) {
      console.log(formatEntry(entry))
      printed += 1
    }
  }
  if (matched > printed)
    console.log(`... ${matched - printed} more matches; raise --limit to see them`)
  console.log(`\n${matched} match(es)`)
}

function printTail(path: string, options: Record<string, string>): void {
  const lines = Number(options.lines ?? '20')
  if (!Number.isInteger(lines) || lines <= 0) throw new Error('--lines must be a positive integer')
  const buffer: string[] = []
  for (const entry of analyzer.streamFile(path)) {
    buffer.push(formatEntry(entry))
    if (buffer.length > lines) buffer.shift()
  }
  for (const line of buffer) console.log(line)
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE)
    return 0
  }
  const { positional, options } = parseArguments(rest)
  const input = positional[0]
  if (!input) throw new Error('Missing file path')
  // The analyzer rejects `..` segments (a guard inherited from the web API);
  // resolve the user's path to an absolute real path first.
  const path = await realpath(resolve(input))

  switch (command) {
    case 'detect': {
      console.log(`${await detectFileTypeFromPath(path)}  ${path}`)
      return 0
    }
    case 'overview':
      printOverview(path, options)
      return 0
    case 'search':
      printSearch(path, options)
      return 0
    case 'tail':
      printTail(path, options)
      return 0
    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(USAGE)
      return 2
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })

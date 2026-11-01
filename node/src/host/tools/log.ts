/** Agent tools for logcat / plain-text log analysis. */
import {
  LogAnalyzer,
  createLogFilter,
  type LogEntry,
  type LogFilters,
} from '../../core/log/index.ts'
import type { AlaHostContext, ToolDefinition } from '../context.ts'
import { requireFile, clip } from '../paths.ts'
import { mount } from '../mount.ts'
import {
  jsonContent,
  numberArgument,
  objectSchema,
  optionalInt,
  optionalString,
  requiredString,
  stringArgument,
} from '../schema.ts'

const analyzer = new LogAnalyzer()

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args: unknown, value: unknown) => jsonContent(value),
} as const

/** The shared filter arguments accepted by the log tools. */
const FILTER_PROPERTIES = {
  start_time: stringArgument(
    'Keep entries whose timestamp sorts at or after this value (string comparison, e.g. "01-15 10:00:00.000")',
  ),
  end_time: stringArgument('Keep entries whose timestamp sorts at or before this value'),
  keyword: stringArgument(
    'JavaScript regular expression matched against message and raw line (case-insensitive)',
  ),
  level: stringArgument('Exact level to keep: V, D, I, W, E, F (or "U" for unparsed lines)'),
  tag: stringArgument('JavaScript regular expression matched against the tag (case-insensitive)'),
  pid: stringArgument('Exact PID'),
  tid: stringArgument('Exact TID'),
  relation: stringArgument('AND (default) or OR between the keyword and tag conditions'),
} as const

function logFilters(args: unknown): LogFilters {
  const relation = (optionalString(args, 'relation') ?? 'AND').toUpperCase()
  return {
    start_time: optionalString(args, 'start_time') ?? null,
    end_time: optionalString(args, 'end_time') ?? null,
    keywords: optionalString(args, 'keyword') ?? null,
    level: optionalString(args, 'level') ?? null,
    tag: optionalString(args, 'tag') ?? null,
    pid: optionalString(args, 'pid') ?? null,
    tid: optionalString(args, 'tid') ?? null,
    tag_keyword_relation: relation === 'OR' ? 'OR' : 'AND',
  }
}

function entryView(entry: LogEntry) {
  return {
    line_number: entry.line_number,
    timestamp: entry.timestamp,
    pid: entry.pid,
    tid: entry.tid,
    level: entry.level,
    tag: entry.tag,
    message: clip(entry.message, 1000),
    source_file: entry.source_file,
    ...(entry.raw_line !== entry.message ? { raw_line: clip(entry.raw_line, 2000) } : {}),
  }
}

function topCounts(counts: Map<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit),
  )
}

function overviewTool(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_log_overview',
    description:
      'Summarize a local log file: detected format, line count, level distribution, top tags, and the first matching entries. Use it before searching to learn the shape of the log.',
    parameters: objectSchema(
      { path: stringArgument('Path to the log file'), ...FILTER_PROPERTIES },
      ['path'],
    ),
    output: OUTPUT,
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const filters = logFilters(args)
      const predicate = createLogFilter(filters)
      const meta = analyzer.scanFileMeta(path, 2_000_000)
      const byLevel = new Map<string, number>()
      const tags = new Map<string, number>()
      const sample: ReturnType<typeof entryView>[] = []
      let matched = 0
      for (const entry of analyzer.streamFile(path)) {
        if (!predicate(entry)) continue
        matched += 1
        byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1)
        if (entry.tag !== 'Unknown') tags.set(entry.tag, (tags.get(entry.tag) ?? 0) + 1)
        if (sample.length < 10) sample.push(entryView(entry))
      }
      return {
        path,
        format: meta.format_detected,
        line_count: meta.line_count,
        truncated: meta.truncated,
        size_bytes: meta.size_bytes,
        matched,
        by_level: topCounts(byLevel, 10),
        top_tags: topCounts(tags, 15),
        sample,
        filters,
      }
    },
  })
}

function searchTool(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_log_search',
    description:
      'Search a local log file by level, keyword/tag regex, PID/TID and timestamp range. Scans the whole file lazily and returns matching entries with line numbers. Use "relation" to OR keyword and tag matches.',
    parameters: objectSchema(
      {
        path: stringArgument('Path to the log file'),
        limit: numberArgument('Maximum entries to return (default 50, max 500)'),
        offset: numberArgument('Skip this many matches (default 0)'),
        ...FILTER_PROPERTIES,
      },
      ['path'],
    ),
    output: OUTPUT,
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const filters = logFilters(args)
      const predicate = createLogFilter(filters)
      const limit = optionalInt(args, 'limit', 50, { min: 1, max: 500 })
      const offset = optionalInt(args, 'offset', 0, { min: 0, max: 1_000_000 })
      const entries: ReturnType<typeof entryView>[] = []
      let matched = 0
      for (const entry of analyzer.streamFile(path)) {
        if (!predicate(entry)) continue
        if (matched >= offset && entries.length < limit) entries.push(entryView(entry))
        matched += 1
      }
      return { matched, offset, returned: entries.length, entries, filters }
    },
  })
}

function readRangeTool(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_log_read_range',
    description:
      'Read a contiguous, line-numbered range of a local log file (1-based, inclusive). Use after a search to inspect context around an interesting line.',
    parameters: objectSchema(
      {
        path: stringArgument('Path to the log file'),
        start_line: numberArgument('First line number to return (1-based, inclusive)'),
        end_line: numberArgument('Last line number to return (1-based, inclusive)'),
      },
      ['path', 'start_line', 'end_line'],
    ),
    output: OUTPUT,
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const startLine = optionalInt(args, 'start_line', 1, { min: 1, max: Number.MAX_SAFE_INTEGER })
      const endLine = optionalInt(args, 'end_line', startLine, {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      })
      if (endLine < startLine)
        throw new Error('end_line must be greater than or equal to start_line')
      if (endLine - startLine > 2000)
        throw new Error('Requested range is too large; read at most 2000 lines')
      const entries: ReturnType<typeof entryView>[] = []
      for (const entry of analyzer.streamFile(path)) {
        if (entry.line_number < startLine) continue
        if (entry.line_number > endLine) break
        entries.push(entryView(entry))
      }
      return { path, start_line: startLine, end_line: endLine, returned: entries.length, entries }
    },
  })
}

function tailTool(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_log_tail',
    description:
      'Return the last entries of a local log file without loading it fully. Useful for recent crashes or the end of a captured session.',
    parameters: objectSchema(
      {
        path: stringArgument('Path to the log file'),
        lines: numberArgument('Number of trailing entries to return (default 50, max 500)'),
      },
      ['path'],
    ),
    output: OUTPUT,
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const lines = optionalInt(args, 'lines', 50, { min: 1, max: 500 })
      const buffer: ReturnType<typeof entryView>[] = []
      for (const entry of analyzer.streamFile(path)) {
        buffer.push(entryView(entry))
        if (buffer.length > lines) buffer.shift()
      }
      return { path, lines: buffer.length, entries: buffer }
    },
  })
}

export function mountLogTools(ctx: AlaHostContext): void {
  overviewTool(ctx)
  searchTool(ctx)
  readRangeTool(ctx)
  tailTool(ctx)
}

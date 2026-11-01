/**
 * Structured parser for Android diagnostic artifacts: ANR traces and native
 * crash tombstones.
 *
 * Port of `backend/src/ala/services/diagnostic_parser.py`. Every regex,
 * heuristic, limit and output field name is kept identical so the JSON
 * produced here matches the backend tool output exactly.
 *
 * The Python module is a set of static methods over plain strings; this port
 * preserves that shape while typing the returned dictionaries:
 *
 * @example
 * ```ts
 * const result = DiagnosticParser.parseAnr(text)
 * const result = DiagnosticParser.parseTombstone(text)
 * const result = DiagnosticParser.parseDiagnostic(text) // auto-detect
 * ```
 */
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

/**
 * Maximum diagnostic artifact size the Python parser advertises (200 KB).
 * The backend's tool layer enforces it before reading a file.
 */
export const MAX_FILE_SIZE = 200_000

// ═══════════════════════════════════════════════════════════════════════════════
// Result dictionaries (JSON shapes produced by the Python parser)
// ═══════════════════════════════════════════════════════════════════════════════

/** A single stack frame from a thread dump. */
export type StackFrameDict = {
  method: string
  class: string
  file: string | null
  line: number | null
  is_native: boolean
}

/** An Android thread snapshot from an ANR trace. */
export type ThreadDict = {
  name: string
  tid: number
  priority: number
  state: string
  daemon: boolean
  group: string
  sys_tid: number | null
  stack_trace: StackFrameDict[]
}

/** A thread waiting on a lock (`- waiting to lock` / `- waiting on`). */
export type LockWaiterDict = {
  thread: string
  tid: number
  waiting_since_line: string
}

/** Lock holder/waiters relationship. */
export type LockDict = {
  lock_class: string
  lock_address: string
  holder_thread: string
  holder_tid: number
  waiters: LockWaiterDict[]
}

/** Complete ANR trace parse result. */
export type AnrResultDict = {
  type: 'anr_trace'
  process: { name: string; pid: number }
  main_thread: ThreadDict
  all_threads: ThreadDict[]
  held_locks: LockDict[]
  total_threads: number
  anr_subject: string | null
  parse_time_ms: number
}

/** Signal metadata from a tombstone. */
export type SignalDict = {
  signal_number: number
  signal_name: string
  code: number
  code_name: string
  fault_address: string
}

/** A single native backtrace frame from a tombstone. */
export type BacktraceFrameDict = {
  frame: number
  address: string
  symbol: string
  offset: string | null
  file: string
}

/** Complete tombstone parse result. */
export type TombstoneResultDict = {
  type: 'tombstone'
  process: { name: string; pid: number; tid: number }
  signal: SignalDict
  abort_message: string | null
  registers: Record<string, string>
  backtrace: BacktraceFrameDict[]
  build_fingerprint: string | null
  abort_timestamp: string | null
  parse_time_ms: number
}

/** Failure payload — the only alternative shape the parser returns. */
export type DiagnosticErrorDict = { error: string }

/** Any shape returned by the diagnostic parser. */
export type DiagnosticResult = AnrResultDict | TombstoneResultDict | DiagnosticErrorDict

// ═══════════════════════════════════════════════════════════════════════════════
// Data model helpers (mirror the Python dataclasses)
// ═══════════════════════════════════════════════════════════════════════════════

/** A single stack frame from a thread dump. */
export class StackFrame {
  /** Method name, e.g. `nativePollOnce`. */
  method: string
  /** Fully-qualified class, e.g. `android.os.MessageQueue`. */
  class_name: string
  /** Source file name or `null` (for Native Method). */
  file: string | null
  /** Line number or `null`. */
  line: number | null
  /** True if the frame is `(Native Method)`. */
  is_native: boolean

  constructor(init: {
    method: string
    class_name: string
    file?: string | null
    line?: number | null
    is_native?: boolean
  }) {
    this.method = init.method
    this.class_name = init.class_name
    this.file = init.file ?? null
    this.line = init.line ?? null
    this.is_native = init.is_native ?? false
  }
}

/** Android thread snapshot from an ANR trace. */
export class ThreadInfo {
  /** Thread name, e.g. `main`, `AsyncTask #1`. */
  name: string
  /** Thread ID. */
  tid: number
  /** Nice priority. */
  priority: number
  /** `RUNNABLE` / `BLOCKED` / `WAITING` / `TIMED_WAITING` / `SLEEPING` / `NATIVE`. */
  state: string
  daemon: boolean
  /** Thread group, e.g. `main`, `system`. */
  group: string
  /** System-level TID (sysTid). */
  sys_tid: number | null
  stack_trace: StackFrame[]

  constructor(init: {
    name: string
    tid: number
    priority: number
    state: string
    daemon?: boolean
    group?: string
    sys_tid?: number | null
    stack_trace?: StackFrame[]
  }) {
    this.name = init.name
    this.tid = init.tid
    this.priority = init.priority
    this.state = init.state
    this.daemon = init.daemon ?? false
    this.group = init.group ?? 'main'
    this.sys_tid = init.sys_tid ?? null
    this.stack_trace = init.stack_trace ?? []
  }
}

/** Lock holder/waiters relationship. */
export class LockInfo {
  /** Lock object class name. */
  lock_class: string
  /** Hex address, e.g. `0x0a2b3c4d`. */
  lock_address: string
  /** Holder thread name. */
  holder_thread: string
  /** Holder TID. */
  holder_tid: number
  /** Waiters: `{ thread, tid, waiting_since_line }`. */
  waiters: LockWaiterDict[]

  constructor(init: {
    lock_class: string
    lock_address: string
    holder_thread: string
    holder_tid: number
    waiters?: LockWaiterDict[]
  }) {
    this.lock_class = init.lock_class
    this.lock_address = init.lock_address
    this.holder_thread = init.holder_thread
    this.holder_tid = init.holder_tid
    this.waiters = init.waiters ?? []
  }
}

/** Complete ANR trace parse result (dataclass counterpart, unused by the parser). */
export class AnrResult {
  process_name: string
  pid: number
  main_thread: ThreadInfo | null
  all_threads: ThreadInfo[]
  held_locks: LockInfo[]
  total_threads: number
  anr_subject: string | null
  parse_time_ms: number

  constructor(init: {
    process_name: string
    pid: number
    main_thread?: ThreadInfo | null
    all_threads?: ThreadInfo[]
    held_locks?: LockInfo[]
    total_threads?: number
    anr_subject?: string | null
    parse_time_ms?: number
  }) {
    this.process_name = init.process_name
    this.pid = init.pid
    this.main_thread = init.main_thread ?? null
    this.all_threads = init.all_threads ?? []
    this.held_locks = init.held_locks ?? []
    this.total_threads = init.total_threads ?? 0
    this.anr_subject = init.anr_subject ?? null
    this.parse_time_ms = init.parse_time_ms ?? 0.0
  }
}

/** Complete tombstone parse result (dataclass counterpart, unused by the parser). */
export class TombstoneResult {
  process_name: string
  pid: number
  tid: number
  signal_number: number
  signal_name: string
  code: number
  code_name: string
  fault_address: string
  registers: Record<string, string>
  backtrace: BacktraceFrameDict[]
  abort_message: string | null
  build_fingerprint: string | null
  abort_timestamp: string | null
  parse_time_ms: number

  constructor(init: {
    process_name: string
    pid: number
    tid: number
    signal_number: number
    signal_name: string
    code: number
    code_name: string
    fault_address: string
    registers?: Record<string, string>
    backtrace?: BacktraceFrameDict[]
    abort_message?: string | null
    build_fingerprint?: string | null
    abort_timestamp?: string | null
    parse_time_ms?: number
  }) {
    this.process_name = init.process_name
    this.pid = init.pid
    this.tid = init.tid
    this.signal_number = init.signal_number
    this.signal_name = init.signal_name
    this.code = init.code
    this.code_name = init.code_name
    this.fault_address = init.fault_address
    this.registers = init.registers ?? {}
    this.backtrace = init.backtrace ?? []
    this.abort_message = init.abort_message ?? null
    this.build_fingerprint = init.build_fingerprint ?? null
    this.abort_timestamp = init.abort_timestamp ?? null
    this.parse_time_ms = init.parse_time_ms ?? 0.0
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Python-compatible string helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Python `str.strip()` whitespace. `String.prototype.trim` misses the C0
 * separators and NEL that `str.isspace()` treats as whitespace, while JS `\s`
 * also matches U+FEFF, which Python does not consider whitespace.
 */
const PY_STRIP_PATTERN = /^(?:(?!\ufeff)\s|[\x1c-\x1f\x85])+|(?:(?!\ufeff)\s|[\x1c-\x1f\x85])+$/g

/** Equivalent of Python `str.strip()` (no argument form). */
function strip(value: string): string {
  return value.replace(PY_STRIP_PATTERN, '')
}

/**
 * Equivalent of Python `text[:limit]` — Python slices count code points,
 * while `String.prototype.slice` counts UTF-16 code units.
 */
function sliceCodePoints(text: string, limit: number): string {
  let count = 0
  let index = 0
  while (index < text.length && count < limit) {
    const codePoint = text.codePointAt(index)!
    index += codePoint > 0xffff ? 2 : 1
    count += 1
  }
  return text.slice(0, index)
}

/** Python `round(value, digits)` is used for `parse_time_ms` in the backend. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Base-10 integer parse for regex captures that Python reads with `int()`. */
function toInt(capture: string): number {
  return Number.parseInt(capture, 10)
}

// ═══════════════════════════════════════════════════════════════════════════════
// DiagnosticParser
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Static parser for Android diagnostic files (ANR traces & tombstones).
 * All methods are static — no state, no instantiation required.
 */
export class DiagnosticParser {
  // ── Constants ──────────────────────────────────────────────────────────────

  static readonly MAX_FILE_SIZE = MAX_FILE_SIZE

  // ── ANR regex patterns ─────────────────────────────────────────────────────

  /**
   * Python `----- pid (\d+) at .* -----` (unchanged, i.e. unanchored) — `.` is
   * translated to `[^\n]`. `parseAnr` matches it per line (Python `.match`),
   * `parseDiagnostic` searches the 8 KiB header (Python `.search`).
   */
  private static readonly RE_PID_LINE = /----- pid (\d+) at [^\n]* -----/
  /** Line-anchored variant emulating Python's `.match(line)` in `parseAnr`. */
  private static readonly RE_PID_LINE_ANCHORED = /^----- pid (\d+) at [^\n]* -----/
  private static readonly RE_CMD_LINE = /^Cmd line:\s*([^\n]+)/
  private static readonly RE_ANR_SUBJECT = /Subject:\s*([^\n]+)/
  /**
   * Python `\w` is Unicode-aware; `\p{L}\p{N}_` reproduces that so optional
   * flag words (e.g. `daemon`) behave the same for non-ASCII names.
   */
  private static readonly RE_THREAD_HEAD =
    /^"(?<name>[^"]+)"(?:\s+[\p{L}\p{N}_]+)*\s+prio=(?<prio>\d+)\s+tid=(?<tid>\d+)\s+(?<state>\S+)/u
  private static readonly RE_THREAD_ATTR = /^\s+\|\s+group="(\S+)"/
  private static readonly RE_SYS_TID = /sysTid=(\d+)/
  /** Python `\b` is Unicode-aware; emulate it with explicit `\w`-lookarounds. */
  private static readonly RE_DAEMON = /(?<![\p{L}\p{N}_])daemon(?![\p{L}\p{N}_])/u
  private static readonly RE_STACK_FRAME =
    /^\s+at\s+(?<cls>(?:\S+\.)*\S+)\.(?<method>\S+)\((?<file>[^:)]+)?(?::(?<line>\d+))?\)/
  private static readonly RE_NATIVE = /Native Method/i
  private static readonly RE_LOCKED = /- locked <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\)/
  private static readonly RE_WAITING_LOCK =
    /- waiting to lock <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\)[^\n]*held by thread (\d+)/
  private static readonly RE_WAITING_ON = /- waiting on <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\)/

  // ── Tombstone regex patterns ───────────────────────────────────────────────

  private static readonly RE_TOMBSTONE_MARKER = /\*{3} \*{3} \*{3} \*{3}/
  private static readonly RE_TOMBSTONE_PID = /pid:\s*(\d+),\s*tid:\s*(\d+),\s*name:\s*(\S+)/
  private static readonly RE_PROCESS_EXE = />>>\s*([^\n]+?)\s*<<</
  private static readonly RE_SIGNAL_LINE =
    /signal\s+(\d+)\s+\((\S+)\)[^\n]*?code\s+(\d+)\s*\(([^)]*)\)?[^\n]*?fault addr\s+(0x[0-9a-f]+)/
  /**
   * Python: `(?:^|\s{2,})` with MULTILINE. `^` after `\n` is emulated by the
   * `\n` alternative; the `\s{2,}` alternative still absorbs indentation.
   */
  private static readonly RE_REGISTER = /(?:^|\n|\s{2,})(x\d+|r\d+|pc|sp|lr)\s+([0-9a-f]+)/gi
  /**
   * Python: `#(\d+)\s+pc\s+(...)\s+(\S+.*?)\s*\((.+?)(?:\+(\d+))?\)$` with
   * MULTILINE — `$` becomes `(?=\n|$)` so a trailing `\r` (CRLF files) behaves
   * like it does in Python.
   */
  private static readonly RE_BACKTRACE_FRAME =
    /#(\d+)\s+pc\s+(0x[0-9a-f]+|[0-9a-f]+)\s+(\S+[^\n]*?)\s*\(([^\n]+?)(?:\+(\d+))?\)(?=\n|$)/g
  private static readonly RE_ABORT_MSG = /Abort message:\s*'([^\n]+)'/
  private static readonly RE_BUILD_FP = /Build fingerprint:\s*'([^\n]+)'/
  private static readonly RE_ABORT_TS = /Timestamp:\s*([^\n]+)/

  // ── State normalization map ────────────────────────────────────────────────

  private static readonly STATE_MAP = new Map<string, string>([
    ['Blocked', 'BLOCKED'],
    ['Waiting', 'WAITING'],
    ['TimedWaiting', 'TIMED_WAITING'],
    ['Sleeping', 'SLEEPING'],
    ['Runnable', 'RUNNABLE'],
    ['Native', 'NATIVE'],
    ['Running', 'RUNNABLE'],
  ])

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parse ANR trace text and return a JSON-serializable object.
   *
   * Keys: `type`, `process`, `main_thread`, `all_threads`, `held_locks`,
   * `total_threads`, `anr_subject`, `parse_time_ms`.
   * Returns `{ error: "..." }` on failure.
   */
  static parseAnr(text: string): Record<string, unknown> {
    const t0 = performance.now()
    const lines = text.split('\n')

    // 1. Extract process info from header (first 30 lines)
    let processName = ''
    let pid = 0
    let anrSubject: string | null = null
    for (const line of lines.slice(0, 30)) {
      const mPid = DiagnosticParser.RE_PID_LINE_ANCHORED.exec(line)
      if (mPid) {
        pid = toInt(mPid[1]!)
        continue
      }
      const mCmd = DiagnosticParser.RE_CMD_LINE.exec(line)
      if (mCmd) {
        processName = strip(mCmd[1]!)
        continue
      }
      const mSubject = DiagnosticParser.RE_ANR_SUBJECT.exec(line)
      if (mSubject) {
        anrSubject = strip(mSubject[1]!)
      }
    }

    if (pid === 0) {
      return { error: 'File does not appear to be a valid ANR trace (no pid header found)' }
    }

    // 2. Parse all threads
    const { threads, mainThread } = DiagnosticParser.parseAnrThreads(lines)
    if (mainThread === null) {
      return { error: 'File does not appear to be a valid ANR trace (no main thread found)' }
    }

    // 3. Build lock graph
    const heldLocks = DiagnosticParser.buildLockGraph(lines, threads)

    return {
      type: 'anr_trace',
      process: { name: processName, pid },
      main_thread: DiagnosticParser.threadToDict(mainThread),
      all_threads: threads.map((thread) => DiagnosticParser.threadToDict(thread)),
      held_locks: DiagnosticParser.locksToDicts(heldLocks),
      total_threads: threads.length,
      anr_subject: anrSubject,
      parse_time_ms: round((performance.now() - t0) * 1000, 2),
    }
  }

  /**
   * Parse tombstone text and return a JSON-serializable object.
   *
   * Keys: `type`, `process`, `signal`, `abort_message`, `registers`,
   * `backtrace`, `build_fingerprint`, `abort_timestamp`, `parse_time_ms`.
   * Returns `{ error: "..." }` on failure.
   */
  static parseTombstone(text: string): Record<string, unknown> {
    const t0 = performance.now()

    // 1. Process info
    let pid = 0
    let tid = 0
    let processName = ''
    const mPid = DiagnosticParser.RE_TOMBSTONE_PID.exec(text)
    if (mPid) {
      pid = toInt(mPid[1]!)
      tid = toInt(mPid[2]!)
      processName = mPid[3]!
    }
    // Try extracting executable path from >>> ... <<<
    const mExe = DiagnosticParser.RE_PROCESS_EXE.exec(text)
    if (mExe) {
      processName = strip(mExe[1]!)
    }

    if (pid === 0) {
      return { error: 'File does not appear to be a valid tombstone (no pid/tid found)' }
    }

    // 2. Signal info
    let signalInfo: SignalDict = {
      signal_number: 0,
      signal_name: '',
      code: 0,
      code_name: '',
      fault_address: '',
    }
    const mSig = DiagnosticParser.RE_SIGNAL_LINE.exec(text)
    if (mSig) {
      signalInfo = {
        signal_number: toInt(mSig[1]!),
        signal_name: mSig[2]!,
        code: toInt(mSig[3]!),
        code_name: mSig[4]! || '',
        fault_address: mSig[5]!,
      }
    } else {
      return { error: 'File does not appear to be a valid tombstone (no signal info found)' }
    }

    // 3. Registers
    const registers: Record<string, string> = {}
    for (const match of text.matchAll(DiagnosticParser.RE_REGISTER)) {
      registers[match[1]!.toLowerCase()] = match[2]!
    }

    // 4. Backtrace
    const backtrace: BacktraceFrameDict[] = []
    for (const match of text.matchAll(DiagnosticParser.RE_BACKTRACE_FRAME)) {
      let address = match[2]!
      if (!address.startsWith('0x')) {
        address = `0x${address}`
      }
      backtrace.push({
        frame: toInt(match[1]!),
        address,
        symbol: strip(match[4]!),
        offset: match[5] ? `+${match[5]}` : null,
        file: strip(match[3]!),
      })
    }

    // 5. Optional info
    let abortMessage: string | null = null
    const mAbort = DiagnosticParser.RE_ABORT_MSG.exec(text)
    if (mAbort) {
      abortMessage = mAbort[1]!
    }

    let buildFingerprint: string | null = null
    const mBuildFp = DiagnosticParser.RE_BUILD_FP.exec(text)
    if (mBuildFp) {
      buildFingerprint = mBuildFp[1]!
    }

    let abortTimestamp: string | null = null
    const mTimestamp = DiagnosticParser.RE_ABORT_TS.exec(text)
    if (mTimestamp) {
      abortTimestamp = mTimestamp[1]!
    }

    return {
      type: 'tombstone',
      process: { name: processName, pid, tid },
      signal: signalInfo,
      abort_message: abortMessage,
      registers,
      backtrace,
      build_fingerprint: buildFingerprint,
      abort_timestamp: abortTimestamp,
      parse_time_ms: round((performance.now() - t0) * 1000, 2),
    }
  }

  /**
   * Auto-detect the diagnostic flavour and dispatch to `parseAnr` or
   * `parseTombstone`.
   *
   * Detection priority:
   * 1. Tombstone marker (`*** *** *** ...`), only within the first 8 KiB.
   * 2. ANR pid header (`----- pid N at ... -----` + `"main" prio=`).
   * 3. Unrecognized → returns an error object.
   *
   * @param text Full diagnostic file content.
   * @param filePath Accepted for API parity with the Python module, which uses
   *   it for error messages only; it is never reflected in the result.
   */
  static parseDiagnostic(text: string, filePath?: string | null): Record<string, unknown> {
    void filePath
    if (strip(text).length === 0) {
      return { error: 'File is empty' }
    }

    const header = sliceCodePoints(text, 8192)

    // Detect tombstone first (more distinctive marker)
    if (DiagnosticParser.RE_TOMBSTONE_MARKER.test(header)) {
      return DiagnosticParser.parseTombstone(text)
    }

    // Detect ANR — Python searches the header for an (unanchored) pid line.
    if (DiagnosticParser.RE_PID_LINE.test(header) && header.includes('"main" prio=')) {
      return DiagnosticParser.parseAnr(text)
    }

    return { error: 'Unrecognized diagnostic format' }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private — ANR thread parsing
  // ═══════════════════════════════════════════════════════════════════════════

  /** Parse all threads from ANR trace lines, plus the main thread if found. */
  private static parseAnrThreads(lines: string[]): {
    threads: ThreadInfo[]
    mainThread: ThreadInfo | null
  } {
    const threads: ThreadInfo[] = []
    let mainThread: ThreadInfo | null = null
    let currentThread: ThreadInfo | null = null

    for (const line of lines) {
      // Detect thread header: "name" prio=N tid=N State
      const head = DiagnosticParser.RE_THREAD_HEAD.exec(line)
      if (head) {
        // Save previous thread
        if (currentThread !== null) {
          threads.push(currentThread)
        }

        const groups = head.groups!
        const name = groups.name!
        currentThread = new ThreadInfo({
          name,
          priority: toInt(groups.prio!),
          tid: toInt(groups.tid!),
          state: DiagnosticParser.normalizeState(groups.state!),
        })
        // Check if it's the main thread (name="main" and tid=1)
        if (name === 'main' && currentThread.tid === 1) {
          mainThread = currentThread
        }
        // Check for daemon flag on the header line
        if (DiagnosticParser.RE_DAEMON.test(line)) {
          currentThread.daemon = true
        }
        continue
      }

      if (currentThread === null) {
        continue
      }

      // Thread attribute line: | group="..." ... daemon ...
      const groupMatch = DiagnosticParser.RE_THREAD_ATTR.exec(line)
      if (groupMatch) {
        currentThread.group = groupMatch[1]!
        if (DiagnosticParser.RE_DAEMON.test(line)) {
          currentThread.daemon = true
        }
      }

      // sysTid
      const sysTid = DiagnosticParser.RE_SYS_TID.exec(line)
      if (sysTid) {
        currentThread.sys_tid = toInt(sysTid[1]!)
      }

      // Stack frame: at xxx.xxx.xxx(...)
      const frame = DiagnosticParser.RE_STACK_FRAME.exec(line)
      if (frame) {
        const groups = frame.groups!
        const filePart = groups.file ?? ''
        const isNative = DiagnosticParser.RE_NATIVE.test(filePart)
        currentThread.stack_trace.push(
          new StackFrame({
            method: groups.method!,
            class_name: groups.cls!,
            file: isNative ? null : filePart,
            line: groups.line ? toInt(groups.line) : null,
            is_native: isNative,
          }),
        )
      }
    }

    // Don't forget the last thread
    if (currentThread !== null) {
      threads.push(currentThread)
    }

    return { threads, mainThread }
  }

  /** Normalize a thread state string to its uppercase standard form. */
  private static normalizeState(raw: string): string {
    return DiagnosticParser.STATE_MAP.get(raw) ?? raw.toUpperCase()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private — Lock graph building
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build lock holder/waiter relationships from ANR trace lines.
   *
   * Strategy (mirrors the Python module):
   * 1. Scan all `- locked <addr>` → record `{addr: lock_class}`
   * 2. Scan all `- waiting to lock <addr> ... held by thread N` → record waiters
   * 3. Scan all `- waiting on <addr>` → record blocked waiters
   * 4. Associate each locked/waiting line with its preceding thread header
   * 5. Assemble LockInfo list
   */
  private static buildLockGraph(lines: string[], threads: ThreadInfo[]): LockInfo[] {
    // Build tid → thread name mapping
    const nameToTid = new Map<string, number>()
    for (const thread of threads) {
      nameToTid.set(thread.name, thread.tid)
    }

    // Held locks: addr → lock_class (Python keeps an unresolved holder tid
    // next to it, but the assembled output never reads it).
    const held = new Map<string, string>()
    for (const line of lines) {
      const locked = DiagnosticParser.RE_LOCKED.exec(line)
      if (locked) {
        held.set(locked[1]!, strip(locked[2]!))
      }
    }

    // Associate waiting lines and locked lines with their thread context by
    // tracking the current thread header as we scan.
    const lockHolder = new Map<string, string>() // addr → holder thread name
    const waitersByAddr = new Map<string, LockWaiterDict[]>()
    let currentThreadName = ''

    for (const line of lines) {
      // Track current thread
      const head = DiagnosticParser.RE_THREAD_HEAD.exec(line)
      if (head) {
        currentThreadName = head.groups!.name!
      }

      // - locked <addr> — record which thread holds this lock
      const locked = DiagnosticParser.RE_LOCKED.exec(line)
      if (locked) {
        lockHolder.set(locked[1]!, currentThreadName)
      }

      // - waiting to lock <addr> ... held by thread N
      const waitingLock = DiagnosticParser.RE_WAITING_LOCK.exec(line)
      if (waitingLock) {
        const addr = waitingLock[1]!
        const waiters = waitersByAddr.get(addr) ?? []
        waitersByAddr.set(addr, waiters)
        waiters.push({
          thread: currentThreadName,
          tid: nameToTid.get(currentThreadName) ?? -1,
          waiting_since_line: strip(waitingLock[2]!),
        })
      }

      // - waiting on <addr> (blocked, no explicit holder)
      const waitingOn = DiagnosticParser.RE_WAITING_ON.exec(line)
      if (waitingOn) {
        const addr = waitingOn[1]!
        const waiters = waitersByAddr.get(addr) ?? []
        waitersByAddr.set(addr, waiters)
        waiters.push({
          thread: currentThreadName,
          tid: nameToTid.get(currentThreadName) ?? -1,
          waiting_since_line: strip(waitingOn[2]!),
        })
      }
    }

    // Assemble result
    const result: LockInfo[] = []
    for (const [addr, lockClass] of held) {
      const holderName = lockHolder.get(addr) ?? 'unknown'
      result.push(
        new LockInfo({
          lock_class: lockClass,
          lock_address: addr,
          holder_thread: holderName,
          holder_tid: nameToTid.get(holderName) ?? -1,
          waiters: waitersByAddr.get(addr) ?? [],
        }),
      )
    }
    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private — Serialization helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /** Convert a ThreadInfo to a JSON-serializable object. */
  private static threadToDict(thread: ThreadInfo): ThreadDict {
    return {
      name: thread.name,
      tid: thread.tid,
      priority: thread.priority,
      state: thread.state,
      daemon: thread.daemon,
      group: thread.group,
      sys_tid: thread.sys_tid,
      stack_trace: thread.stack_trace.map((frame) => ({
        method: frame.method,
        class: frame.class_name,
        file: frame.file,
        line: frame.line,
        is_native: frame.is_native,
      })),
    }
  }

  /** Convert a list of LockInfo to JSON-serializable objects. */
  private static locksToDicts(locks: LockInfo[]): LockDict[] {
    return locks.map((lock) => ({
      lock_class: lock.lock_class,
      lock_address: lock.lock_address,
      holder_thread: lock.holder_thread,
      holder_tid: lock.holder_tid,
      waiters: lock.waiters,
    }))
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Convenience exports
// ═══════════════════════════════════════════════════════════════════════════════

/** Bound alias for {@link DiagnosticParser.parseAnr}. */
export const parseAnr = DiagnosticParser.parseAnr.bind(DiagnosticParser)

/** Bound alias for {@link DiagnosticParser.parseTombstone}. */
export const parseTombstone = DiagnosticParser.parseTombstone.bind(DiagnosticParser)

/** Bound alias for {@link DiagnosticParser.parseDiagnostic}. */
export const parseDiagnostic = DiagnosticParser.parseDiagnostic.bind(DiagnosticParser)

/**
 * Read a diagnostic file from disk (UTF-8, invalid sequences replaced with
 * U+FFFD — matching Python's `open(..., errors="replace")`) and parse it with
 * auto-detection.
 */
export async function parseDiagnosticFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8')
  return DiagnosticParser.parseDiagnostic(content, filePath)
}

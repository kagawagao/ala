/**
 * Tests for the TypeScript port of `diagnostic_parser.py`.
 *
 * Fixtures and expectations are ported 1:1 from
 * `backend/tests/test_diagnostic_parser.py`; every expected value was also
 * cross-checked against the Python implementation's JSON output.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AnrResult,
  DiagnosticParser,
  LockInfo,
  StackFrame,
  ThreadInfo,
  TombstoneResult,
  parseAnr,
  parseDiagnostic,
  parseDiagnosticFile,
  parseTombstone,
} from './index.ts'
import type {
  AnrResultDict,
  BacktraceFrameDict,
  DiagnosticErrorDict,
  LockDict,
  ThreadDict,
  TombstoneResultDict,
} from './index.ts'

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

// Sample ANR trace text (realistic Android ANR format)
const SAMPLE_ANR = `----- pid 1234 at 2025-08-15 14:30:22 -----
Cmd line: com.example.app
Build fingerprint: 'google/sunfish/sunfish:13/TQ3A.230805.001/20240805:user/release-keys'
ABI: 'arm64-v8a'
Build type: optimized

"main" prio=5 tid=1 Blocked
  | group="main" sCount=1 ucsCount=0 flags=1 obj=0x73e4b7a8 self=0x7b2c001400
  | sysTid=1234 nice=-10 cgrp=top-app sched=0/0 handle=0x7b2d51b548
  | state=S schedstat=( 3200000000 450000000 1800 ) utm=280 stm=40 core=4 HZ=100
  | stack=0x7fff8b200000-0x7fff8b400000 stackSize=8188KB
  | held mutexes=
  at android.os.MessageQueue.nativePollOnce(Native Method)
  at android.os.MessageQueue.next(MessageQueue.java:339)
  at android.os.MessageQueue.enqueueMessage(MessageQueue.java:567)
  at android.os.Handler.sendMessageAtTime(Handler.java:876)
  - locked <0x0a2b3c4d> (a java.lang.Object)

"AsyncTask #1" prio=5 tid=45 Waiting
  | group="main" sCount=1 ucsCount=0 flags=1 obj=0x73e4c100 self=0x7b2c005800
  | sysTid=1280 nice=0 cgrp=top-app sched=0/0 handle=0x7b2d520000
  | state=S schedstat=( 800000000 120000000 350 ) utm=60 stm=20 core=1 HZ=100
  | stack=0x7fff8a800000-0x7fff8aa00000 stackSize=8188KB
  | held mutexes=
  at java.lang.Object.wait(Object.java:456)
  - waiting to lock <0x0a2b3c4d> (a java.lang.Object) held by thread 1
  at com.example.app.AsyncTaskRunner.doInBackground(AsyncTaskRunner.java:123)
  at android.os.AsyncTask$2.call(AsyncTask.java:345)

"Signal Catcher" daemon prio=4 tid=432 Runnable
  | group="system" sCount=0 ucsCount=0 flags=0 obj=0x73e50000 self=0x7b2c100000
  | sysTid=1237 nice=0 cgrp=top-app sched=0/0 handle=0x7b2d540000
  | stack=0x7fff8b800000-0x7fff8ba00000 stackSize=8188KB
  | held mutexes=
  at dalvik.system.VMStack.getThreadStackTrace(Native Method)
  at java.lang.Thread.getStackTrace(Thread.java:1720)

"Binder:1234_1" prio=5 tid=12 Native
  | group="main" sCount=1 ucsCount=0 flags=1 obj=0x73e4d000 self=0x7b2c008800
  | sysTid=1246 nice=0 cgrp=top-app sched=0/0 handle=0x7b2d560000
  | stack=0x7fff8c000000-0x7fff8c200000 stackSize=8188KB
  | held mutexes=
  at android.os.BinderProxy.transactNative(Native Method)
  at android.os.BinderProxy.transact(Binder.java:678)

"HeapTaskDaemon" daemon prio=4 tid=56 Waiting
  | group="system" sCount=1 ucsCount=0 flags=1 obj=0x73e52000 self=0x7b2c180000
  | sysTid=1300 nice=0 cgrp=top-app sched=0/0 handle=0x7b2d580000
  | stack=0x7fff8c400000-0x7fff8c600000 stackSize=8188KB
  | held mutexes=
  at dalvik.system.VMRuntime.runHeapTasks(Native Method)
  at java.lang.Daemons$HeapTaskDaemon.run(Daemons.java:525)
`

// Sample Tombstone text (realistic Android native crash format)
const SAMPLE_TOMBSTONE = `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
Build fingerprint: 'google/sunfish/sunfish:13/TQ3A.230805.001/20240805:user/release-keys'
Revision: '0'
ABI: 'arm64'
Timestamp: 2025-08-15 14:30:22.456+0800
Process uptime: 12345s
Cmdline: /system/bin/surfaceflinger
pid: 789, tid: 790, name: surfaceflinger  >>> /system/bin/surfaceflinger <<<
uid: 1000
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010
    x0  0000000000000000  x1  0000000000000001  x2  0000007f8a123000
    x3  0000007f8a124000  x4  0000000000000000  x5  0000000000000000
    x6  0000000000000000  x7  0000000000000000  x8  0000007f8a125000
    x9  0000000000000000  x10 0000000000000000  x11 0000000000000000
    x12 0000000000000000  x13 0000000000000000  x14 0000000000000000
    pc  0000007f8a12345678  sp  0000007ff000123450  lr  0000007f8a12345600
    pstate 0000000060000000
Abort message: 'Check failed: format == HAL_PIXEL_FORMAT_RGBA_8888'
backtrace:
      #00 pc 0000000000002560  /system/lib64/libsurfaceflinger.so (android::SurfaceFlinger::setPowerMode(int)+128)
      #01 pc 0000000000003780  /system/lib64/libsurfaceflinger.so (android::SurfaceFlinger::onTransact(unsigned int, android::Parcel const&, android::Parcel*, unsigned int)+456)
      #02 pc 00000000000b1a7c  /system/lib64/libbinder.so (android::BBinder::transact(unsigned int, android::Parcel const&, android::Parcel*, unsigned int)+168)
`

// Malformed input
const GARBLED_TEXT =
  'this is not a valid diagnostic file at all 12345\nsome random text\nmaybe a log line'

const EMPTY_TEXT = ''

const NON_DIAGNOSTIC_TEXT = `01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 I ActivityManager: Activity resumed
`

const TRUNCATED_ANR = `----- pid 9999 at 2025-08-15 14:30:22 -----
Cmd line: com.broken.app

"main" prio=5 tid=1 Blocked
  at android.os.MessageQueue.nativePollOnce(Native Method)
`

// ANR with an explicit "Subject:" header line.
const ANR_WITH_SUBJECT = `----- pid 4242 at 2025-08-15 14:30:22 -----
Cmd line: com.subject.app
Subject: Input dispatching timed out (Waiting to send key event)
Build fingerprint: 'x/y/z'

"main" prio=5 tid=1 Sleeping
  | group="main" sysTid=4242
  at com.subject.app.Main.main(Main.java:10)
`

// ANR covering every state-normalization branch, including the uppercase fallback.
const STATES_ANR = `----- pid 7 at 2025-08-15 14:30:22 -----
Cmd line: com.states
"main" prio=5 tid=1 Running
  | group="main" sysTid=7
  at a.b.C.d(C.java:1)
"worker" prio=10 tid=2 TimedWaiting
"sleepy" prio=0 tid=3 Sleeping
"zombie" prio=0 tid=4 Zombie
"native" prio=0 tid=5 Native
  at a.b.C.n(Native Method)
`

// Two held locks, one with both a "waiting to lock" and a "waiting on" waiter.
const MULTI_LOCK_ANR = `----- pid 11 at 2025-08-15 14:30:22 -----
Cmd line: com.locks
"main" prio=5 tid=1 Blocked
  - locked <0x111> (a java.lang.String)
  - locked <0x222> (a com.example.Other)
"t1" prio=5 tid=2 Blocked
  - waiting to lock <0x111> (a java.lang.String) held by thread 1
  - waiting on <0x222> (a com.example.Other)
"t2" prio=5 tid=3 Blocked
  - waiting to lock <0x999> (a java.lang.Object) held by thread 2
`

// pid header present but the pid line is beyond the 30-line header scan.
const PID_AFTER_HEADER_WINDOW = `${'noise\n'.repeat(31)}----- pid 8 at 2025-08-15 14:30:22 -----
Cmd line: com.late
"main" prio=5 tid=1 Runnable
`

// pid header found, but no main thread (tid != 1).
const NO_MAIN_THREAD_ANR = `----- pid 42 at 2025-08-15 14:30:22 -----
Cmd line: com.nomain
"worker" prio=5 tid=9 Runnable
`

const ANR_ERROR = 'File does not appear to be a valid ANR trace (no pid header found)'
const NO_MAIN_ERROR = 'File does not appear to be a valid ANR trace (no main thread found)'
const TOMBSTONE_PID_ERROR = 'File does not appear to be a valid tombstone (no pid/tid found)'
const TOMBSTONE_SIGNAL_ERROR = 'File does not appear to be a valid tombstone (no signal info found)'

const expectedMainThread: ThreadDict = {
  name: 'main',
  tid: 1,
  priority: 5,
  state: 'BLOCKED',
  daemon: false,
  group: 'main',
  sys_tid: 1234,
  stack_trace: [
    {
      method: 'nativePollOnce',
      class: 'android.os.MessageQueue',
      file: null,
      line: null,
      is_native: true,
    },
    {
      method: 'next',
      class: 'android.os.MessageQueue',
      file: 'MessageQueue.java',
      line: 339,
      is_native: false,
    },
    {
      method: 'enqueueMessage',
      class: 'android.os.MessageQueue',
      file: 'MessageQueue.java',
      line: 567,
      is_native: false,
    },
    {
      method: 'sendMessageAtTime',
      class: 'android.os.Handler',
      file: 'Handler.java',
      line: 876,
      is_native: false,
    },
  ],
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests — ANR parsing
// ──────────────────────────────────────────────────────────────────────────────

describe('DiagnosticParser.parseAnr', () => {
  it('extracts process name and PID from the header', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    expect(result.type).toBe('anr_trace')
    expect(result.process).toEqual({ name: 'com.example.app', pid: 1234 })
    expect(typeof result.parse_time_ms).toBe('number')
  })

  it('returns the Python dict shape and key order', () => {
    const result = parseAnr(SAMPLE_ANR)
    expect(Object.keys(result)).toEqual([
      'type',
      'process',
      'main_thread',
      'all_threads',
      'held_locks',
      'total_threads',
      'anr_subject',
      'parse_time_ms',
    ])
  })

  it('extracts the main thread with its full stack trace', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    expect(result.main_thread).toEqual(expectedMainThread)
    expect(Object.keys(result.main_thread)).toEqual([
      'name',
      'tid',
      'priority',
      'state',
      'daemon',
      'group',
      'sys_tid',
      'stack_trace',
    ])
  })

  it('extracts every thread in the trace', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    const threads = result.all_threads
    expect(threads.length).toBeGreaterThanOrEqual(5)
    expect(threads.map((thread) => thread.name)).toEqual([
      'main',
      'AsyncTask #1',
      'Signal Catcher',
      'Binder:1234_1',
      'HeapTaskDaemon',
    ])
    expect(threads.map((thread) => thread.tid)).toEqual([1, 45, 432, 12, 56])
    expect(threads.map((thread) => thread.sys_tid)).toEqual([1234, 1280, 1237, 1246, 1300])
  })

  it('reports total_threads as the all_threads length', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    expect(result.total_threads).toBe(result.all_threads.length)
    expect(result.total_threads).toBe(5)
  })

  it('captures locked and waiting-to-lock relationships', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    const expectedLocks: LockDict[] = [
      {
        lock_class: 'java.lang.Object',
        lock_address: '0x0a2b3c4d',
        holder_thread: 'main',
        holder_tid: 1,
        waiters: [{ thread: 'AsyncTask #1', tid: 45, waiting_since_line: 'java.lang.Object' }],
      },
    ]
    expect(result.held_locks).toEqual(expectedLocks)
  })

  it('flags daemon threads', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    const daemonByName = new Map(result.all_threads.map((t) => [t.name, t.daemon]))
    expect(daemonByName.get('Signal Catcher')).toBe(true)
    expect(daemonByName.get('HeapTaskDaemon')).toBe(true)
    expect(daemonByName.get('main')).toBe(false)
    expect(daemonByName.get('AsyncTask #1')).toBe(false)
  })

  it('assigns thread groups from the attribute line', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    const groupByName = new Map(result.all_threads.map((t) => [t.name, t.group]))
    expect(groupByName.get('main')).toBe('main')
    expect(groupByName.get('Signal Catcher')).toBe('system')
    expect(groupByName.get('HeapTaskDaemon')).toBe('system')
  })

  it('marks Native Method frames as native', () => {
    const result = parseAnr(SAMPLE_ANR) as AnrResultDict
    const nativeFrames = result.main_thread.stack_trace.filter((frame) => frame.is_native)
    expect(nativeFrames).toHaveLength(1)
    expect(nativeFrames[0]).toEqual({
      method: 'nativePollOnce',
      class: 'android.os.MessageQueue',
      file: null,
      line: null,
      is_native: true,
    })
  })

  it('returns an error for an empty file', () => {
    expect(parseAnr(EMPTY_TEXT)).toEqual({ error: ANR_ERROR })
  })

  it('returns an error for non-ANR text', () => {
    expect(parseAnr(NON_DIAGNOSTIC_TEXT)).toEqual({ error: ANR_ERROR })
  })

  it('returns an error for garbled text', () => {
    expect(parseAnr(GARBLED_TEXT)).toEqual({ error: ANR_ERROR })
  })

  it('returns an error for whitespace-only text', () => {
    expect(parseAnr('  \n\t\n ')).toEqual({ error: ANR_ERROR })
  })

  it('returns an error when the pid header is beyond the 30-line window', () => {
    expect(parseAnr(PID_AFTER_HEADER_WINDOW)).toEqual({ error: ANR_ERROR })
  })

  it('returns an error when no main thread is present', () => {
    expect(parseAnr(NO_MAIN_THREAD_ANR)).toEqual({ error: NO_MAIN_ERROR })
  })

  it('parses a truncated trace with minimal content', () => {
    const result = parseAnr(TRUNCATED_ANR)
    expect(result).toEqual({
      type: 'anr_trace',
      process: { name: 'com.broken.app', pid: 9999 },
      main_thread: {
        name: 'main',
        tid: 1,
        priority: 5,
        state: 'BLOCKED',
        daemon: false,
        group: 'main',
        sys_tid: null,
        stack_trace: [
          {
            method: 'nativePollOnce',
            class: 'android.os.MessageQueue',
            file: null,
            line: null,
            is_native: true,
          },
        ],
      },
      all_threads: [
        {
          name: 'main',
          tid: 1,
          priority: 5,
          state: 'BLOCKED',
          daemon: false,
          group: 'main',
          sys_tid: null,
          stack_trace: [
            {
              method: 'nativePollOnce',
              class: 'android.os.MessageQueue',
              file: null,
              line: null,
              is_native: true,
            },
          ],
        },
      ],
      held_locks: [],
      total_threads: 1,
      anr_subject: null,
      parse_time_ms: expect.any(Number),
    })
  })

  it('extracts the ANR subject line', () => {
    const result = parseAnr(ANR_WITH_SUBJECT) as AnrResultDict
    expect(result.process).toEqual({ name: 'com.subject.app', pid: 4242 })
    expect(result.anr_subject).toBe('Input dispatching timed out (Waiting to send key event)')
    expect(result.main_thread.state).toBe('SLEEPING')
  })

  it('normalizes every thread state to the standard uppercase form', () => {
    const result = parseAnr(STATES_ANR) as AnrResultDict
    const states = result.all_threads.map((thread) => [thread.name, thread.state, thread.priority])
    expect(states).toEqual([
      ['main', 'RUNNABLE', 5],
      ['worker', 'TIMED_WAITING', 10],
      ['sleepy', 'SLEEPING', 0],
      ['zombie', 'ZOMBIE', 0],
      ['native', 'NATIVE', 0],
    ])
  })

  it('builds a lock graph with multiple locks and waiters', () => {
    const result = parseAnr(MULTI_LOCK_ANR) as AnrResultDict
    expect(result.held_locks).toEqual([
      {
        lock_class: 'java.lang.String',
        lock_address: '0x111',
        holder_thread: 'main',
        holder_tid: 1,
        waiters: [{ thread: 't1', tid: 2, waiting_since_line: 'java.lang.String' }],
      },
      {
        lock_class: 'com.example.Other',
        lock_address: '0x222',
        holder_thread: 'main',
        holder_tid: 1,
        waiters: [{ thread: 't1', tid: 2, waiting_since_line: 'com.example.Other' }],
      },
    ])
    // A "waiting to lock" address that was never locked is not reported.
    expect(result.held_locks.map((lock) => lock.lock_address)).not.toContain('0x999')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests — Tombstone parsing
// ──────────────────────────────────────────────────────────────────────────────

describe('DiagnosticParser.parseTombstone', () => {
  it('extracts process name, PID and TID (>>> <<< overrides the name)', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.type).toBe('tombstone')
    expect(result.process).toEqual({ name: '/system/bin/surfaceflinger', pid: 789, tid: 790 })
  })

  it('extracts signal information', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.signal).toEqual({
      signal_number: 11,
      signal_name: 'SIGSEGV',
      code: 1,
      code_name: 'SEGV_MAPERR',
      fault_address: '0x0000000000000010',
    })
  })

  it('extracts backtrace frames', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.backtrace).toHaveLength(3)
    expect(result.backtrace[0]).toEqual({
      frame: 0,
      address: '0x0000000000002560',
      symbol: 'android::SurfaceFlinger::setPowerMode(int)',
      offset: '+128',
      file: '/system/lib64/libsurfaceflinger.so',
    })
    expect(Object.keys(result.backtrace[0]!)).toEqual([
      'frame',
      'address',
      'symbol',
      'offset',
      'file',
    ])
    expect(result.backtrace[1]!.offset).toBe('+456')
    expect(result.backtrace[2]!.symbol).toContain('BBinder::transact')
  })

  it('extracts the abort message', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.abort_message).toBe('Check failed: format == HAL_PIXEL_FORMAT_RGBA_8888')
  })

  it('extracts the build fingerprint', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.build_fingerprint).toBe(
      'google/sunfish/sunfish:13/TQ3A.230805.001/20240805:user/release-keys',
    )
  })

  it('extracts the abort timestamp verbatim', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.abort_timestamp).toBe('2025-08-15 14:30:22.456+0800')
  })

  it('extracts the general-purpose and special registers', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(Object.keys(result.registers)).toEqual([
      'x0',
      'x1',
      'x2',
      'x3',
      'x4',
      'x5',
      'x6',
      'x7',
      'x8',
      'x9',
      'x10',
      'x11',
      'x12',
      'x13',
      'x14',
      'pc',
      'sp',
      'lr',
    ])
    expect(result.registers).toEqual({
      x0: '0000000000000000',
      x1: '0000000000000001',
      x2: '0000007f8a123000',
      x3: '0000007f8a124000',
      x4: '0000000000000000',
      x5: '0000000000000000',
      x6: '0000000000000000',
      x7: '0000000000000000',
      x8: '0000007f8a125000',
      x9: '0000000000000000',
      x10: '0000000000000000',
      x11: '0000000000000000',
      x12: '0000000000000000',
      x13: '0000000000000000',
      x14: '0000000000000000',
      pc: '0000007f8a12345678',
      sp: '0000007ff000123450',
      lr: '0000007f8a12345600',
    })
  })

  it('returns the full Python dict shape', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE)
    expect(Object.keys(result)).toEqual([
      'type',
      'process',
      'signal',
      'abort_message',
      'registers',
      'backtrace',
      'build_fingerprint',
      'abort_timestamp',
      'parse_time_ms',
    ])
    expect(typeof (result as TombstoneResultDict).parse_time_ms).toBe('number')
  })

  it('returns an error for an empty file', () => {
    expect(parseTombstone(EMPTY_TEXT)).toEqual({ error: TOMBSTONE_PID_ERROR })
  })

  it('returns an error for non-tombstone text', () => {
    expect(parseTombstone(NON_DIAGNOSTIC_TEXT)).toEqual({ error: TOMBSTONE_PID_ERROR })
  })

  it('returns an error for garbled text', () => {
    expect(parseTombstone(GARBLED_TEXT)).toEqual({ error: TOMBSTONE_PID_ERROR })
  })

  it('returns an error when pid is missing/zero', () => {
    const text = `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
pid: 0, tid: 0, name: foo
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x10
`
    expect(parseTombstone(text)).toEqual({ error: TOMBSTONE_PID_ERROR })
  })

  it('returns an error when signal info is missing', () => {
    const text = `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
pid: 1, tid: 2, name: foo
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)
`
    expect(parseTombstone(text)).toEqual({ error: TOMBSTONE_SIGNAL_ERROR })
  })

  it('handles backtraces without offsets and addresses without 0x', () => {
    const text = `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
pid: 5, tid: 6, name: foo  >>> /data/app/foo <<<
signal 11 (SIGSEGV), code 1 (), fault addr 0x10
backtrace:
      #00 pc 0000000000001000  /system/lib64/libc.so
      #01 pc 0000000000002000  /system/lib64/libm.so (no_offset)
`
    const result = parseTombstone(text) as TombstoneResultDict
    expect(result.process).toEqual({ name: '/data/app/foo', pid: 5, tid: 6 })
    expect(result.signal.code_name).toBe('')
    expect(result.backtrace).toEqual([
      {
        frame: 1,
        address: '0x0000000000002000',
        symbol: 'no_offset',
        offset: null,
        file: '/system/lib64/libm.so',
      },
    ])
    expect(result.abort_message).toBeNull()
    expect(result.build_fingerprint).toBeNull()
    expect(result.abort_timestamp).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests — Auto-detection (parseDiagnostic)
// ──────────────────────────────────────────────────────────────────────────────

describe('DiagnosticParser.parseDiagnostic', () => {
  it('auto-detects ANR text', () => {
    const result = parseDiagnostic(SAMPLE_ANR) as AnrResultDict
    expect(result.type).toBe('anr_trace')
    expect(result.process.pid).toBe(1234)
  })

  it('auto-detects tombstone text', () => {
    const result = parseDiagnostic(SAMPLE_TOMBSTONE) as TombstoneResultDict
    expect(result.type).toBe('tombstone')
    expect(result.process.pid).toBe(789)
  })

  it('returns an error for an empty file', () => {
    expect(parseDiagnostic(EMPTY_TEXT)).toEqual({ error: 'File is empty' })
  })

  it('returns an error for whitespace-only content', () => {
    expect(parseDiagnostic('  \n\t\n ')).toEqual({ error: 'File is empty' })
    // Python's str.strip() treats the C0 separators as whitespace...
    expect(parseDiagnostic('\x1c\x1d')).toEqual({ error: 'File is empty' })
    // ...but not U+FEFF, so a BOM-only file is merely unrecognized.
    expect(parseDiagnostic('\ufeff')).toEqual({ error: 'Unrecognized diagnostic format' })
  })

  it('returns an error for non-diagnostic text', () => {
    expect(parseDiagnostic(NON_DIAGNOSTIC_TEXT)).toEqual({
      error: 'Unrecognized diagnostic format',
    })
  })

  it('returns an error for garbled text', () => {
    expect(parseDiagnostic(GARBLED_TEXT)).toEqual({ error: 'Unrecognized diagnostic format' })
  })

  it('prefers the tombstone marker over an ANR header', () => {
    const result = parseDiagnostic(
      `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n${SAMPLE_ANR}`,
    )
    expect(result).toEqual({ error: TOMBSTONE_PID_ERROR })
  })

  it('accepts file_path for API parity without echoing it in the result', () => {
    const result = parseDiagnostic(SAMPLE_TOMBSTONE, '/tmp/crash.txt')
    expect(result).toMatchObject({ type: 'tombstone' })
    expect((result as Record<string, unknown>).file_path).toBeUndefined()
  })

  it('only inspects the first 8192 code points for detection', () => {
    const padded = `${'😀'.repeat(9000)}${SAMPLE_ANR}`
    expect(parseDiagnostic(padded)).toEqual({ error: 'Unrecognized diagnostic format' })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests — Data classes
// ──────────────────────────────────────────────────────────────────────────────

describe('data classes', () => {
  it('StackFrame: native frames carry is_native and no file', () => {
    const frame = new StackFrame({
      method: 'nativePollOnce',
      class_name: 'android.os.MessageQueue',
      file: null,
      line: null,
      is_native: true,
    })
    expect(frame.is_native).toBe(true)
    expect(frame.file).toBeNull()
    expect(frame.line).toBeNull()
  })

  it('StackFrame: Java frames carry file and line', () => {
    const frame = new StackFrame({
      method: 'next',
      class_name: 'android.os.MessageQueue',
      file: 'MessageQueue.java',
      line: 339,
      is_native: false,
    })
    expect(frame.file).toBe('MessageQueue.java')
    expect(frame.line).toBe(339)
    expect(frame.is_native).toBe(false)
  })

  it('ThreadInfo: default values match the Python dataclass', () => {
    const thread = new ThreadInfo({ name: 'test-thread', tid: 42, priority: 5, state: 'RUNNABLE' })
    expect(thread.daemon).toBe(false)
    expect(thread.group).toBe('main')
    expect(thread.sys_tid).toBeNull()
    expect(thread.stack_trace).toEqual([])
    expect(new ThreadInfo({ name: 'a', tid: 1, priority: 1, state: 'X' }).stack_trace).not.toBe(
      thread.stack_trace,
    )
  })

  it('LockInfo: waiters defaults to an empty list', () => {
    const lock = new LockInfo({
      lock_class: 'java.lang.Object',
      lock_address: '0x0a2b3c4d',
      holder_thread: 'main',
      holder_tid: 1,
    })
    expect(lock.waiters).toEqual([])
    expect(lock.lock_class).toBe('java.lang.Object')
    expect(lock.lock_address).toBe('0x0a2b3c4d')
    expect(lock.holder_thread).toBe('main')
    expect(lock.holder_tid).toBe(1)
  })

  it('AnrResult: optional fields default like the Python dataclass', () => {
    const result = new AnrResult({
      process_name: 'test',
      pid: 1,
      all_threads: [],
      held_locks: [],
      total_threads: 0,
    })
    expect(result.main_thread).toBeNull()
    expect(result.anr_subject).toBeNull()
    expect(result.parse_time_ms).toBe(0.0)
  })

  it('TombstoneResult: all fields are present with defaults', () => {
    const result = new TombstoneResult({
      process_name: 'test',
      pid: 1,
      tid: 2,
      signal_number: 11,
      signal_name: 'SIGSEGV',
      code: 1,
      code_name: 'SEGV_MAPERR',
      fault_address: '0x10',
      registers: {},
      backtrace: [],
    })
    expect(result.abort_message).toBeNull()
    expect(result.build_fingerprint).toBeNull()
    expect(result.abort_timestamp).toBeNull()
    expect(result.parse_time_ms).toBe(0.0)
  })

  it('exposes the Python size limit', () => {
    expect(DiagnosticParser.MAX_FILE_SIZE).toBe(200_000)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Integration tests — File path handling
// ──────────────────────────────────────────────────────────────────────────────

describe('parseDiagnosticFile', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ala-diagnostic-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('parses an ANR trace from an actual file', async () => {
    const file = join(directory, 'traces.txt')
    await writeFile(file, SAMPLE_ANR, 'utf8')
    const result = (await parseDiagnosticFile(file)) as AnrResultDict
    expect(result.type).toBe('anr_trace')
    expect(result.process.pid).toBe(1234)
    expect(result.main_thread.name).toBe('main')
  })

  it('parses a tombstone from an actual file', async () => {
    const file = join(directory, 'tombstone.txt')
    await writeFile(file, SAMPLE_TOMBSTONE, 'utf8')
    const result = (await parseDiagnosticFile(file)) as TombstoneResultDict
    expect(result.type).toBe('tombstone')
    expect(result.signal.signal_number).toBe(11)
    expect(result.abort_timestamp).toBe('2025-08-15 14:30:22.456+0800')
  })

  it('reports an empty file as empty', async () => {
    const file = join(directory, 'empty.txt')
    await writeFile(file, '', 'utf8')
    expect(await parseDiagnosticFile(file)).toEqual({ error: 'File is empty' })
  })

  it('decodes invalid UTF-8 with replacement characters', async () => {
    const file = join(directory, 'invalid-utf8.txt')
    const buffer = Buffer.concat([
      Buffer.from(
        `*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
pid: 3, tid: 4, name: foo  >>> /data/local/tmp/foo <<<
signal 6 (SIGABRT), code 6 (SI_TKILL), fault addr 0x10
Abort message: 'bad `,
      ),
      Buffer.from([0xff]),
      Buffer.from(" byte'\n"),
    ])
    await writeFile(file, buffer)
    const result = (await parseDiagnosticFile(file)) as TombstoneResultDict
    expect(result.type).toBe('tombstone')
    expect(result.abort_message).toBe('bad \ufffd byte')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Convenience exports
// ──────────────────────────────────────────────────────────────────────────────

describe('convenience exports', () => {
  it('exposes bound parseAnr / parseTombstone / parseDiagnostic helpers', () => {
    const withoutTiming = (result: Record<string, unknown>): Record<string, unknown> => {
      const { parse_time_ms: _ignored, ...rest } = result
      return rest
    }
    expect(withoutTiming(parseAnr(SAMPLE_ANR))).toEqual(
      withoutTiming(DiagnosticParser.parseAnr(SAMPLE_ANR)),
    )
    expect(withoutTiming(parseTombstone(SAMPLE_TOMBSTONE))).toEqual(
      withoutTiming(DiagnosticParser.parseTombstone(SAMPLE_TOMBSTONE)),
    )
    expect(withoutTiming(parseDiagnostic(SAMPLE_ANR))).toEqual(
      withoutTiming(DiagnosticParser.parseDiagnostic(SAMPLE_ANR)),
    )
  })

  it('errors include only the error key, like the Python dicts', () => {
    const result = parseAnr(GARBLED_TEXT) as DiagnosticErrorDict
    expect(Object.keys(result)).toEqual(['error'])
    expect(result.error).toBe(ANR_ERROR)
  })

  it('backtrace frames are plain JSON objects', () => {
    const result = parseTombstone(SAMPLE_TOMBSTONE) as TombstoneResultDict
    const frames: BacktraceFrameDict[] = JSON.parse(JSON.stringify(result.backtrace))
    expect(frames).toEqual(result.backtrace)
  })
})

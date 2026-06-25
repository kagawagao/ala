"""Tests for diagnostic_parser.py — ANR/Tombstone structured parser (TDD).

TDD: these tests are written BEFORE/ALONGSIDE the implementation.
"""

import os
import tempfile

from ala.services.diagnostic_parser import (
    AnrResult,
    DiagnosticParser,
    LockInfo,
    StackFrame,
    ThreadInfo,
    TombstoneResult,
)

# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


def _write_temp_file(content: str, suffix: str = ".txt") -> str:
    """Write *content* to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8")
    try:
        tmp.write(content)
    finally:
        tmp.close()
    return tmp.name


# ──────────────────────────────────────────────────────────────────────────────
# Sample ANR trace text (realistic Android ANR format)
# ──────────────────────────────────────────────────────────────────────────────

SAMPLE_ANR = """----- pid 1234 at 2025-08-15 14:30:22 -----
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
"""

# ──────────────────────────────────────────────────────────────────────────────
# Sample Tombstone text (realistic Android native crash format)
# ──────────────────────────────────────────────────────────────────────────────

SAMPLE_TOMBSTONE = """*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
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
"""

# Malformed input
GARBLED_TEXT = (
    "this is not a valid diagnostic file at all 12345\nsome random text\nmaybe a log line"
)

EMPTY_TEXT = ""

NON_DIAGNOSTIC_TEXT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 I ActivityManager: Activity resumed
"""

TRUNCATED_ANR = """----- pid 9999 at 2025-08-15 14:30:22 -----
Cmd line: com.broken.app

"main" prio=5 tid=1 Blocked
  at android.os.MessageQueue.nativePollOnce(Native Method)
"""


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests — ANR parsing
# ──────────────────────────────────────────────────────────────────────────────


class TestParseAnr:
    """Tests for DiagnosticParser.parse_anr()."""

    def test_parse_anr_basic_process_info(self):
        """ANR: extract process name, PID from header."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        assert result.get("type") == "anr_trace"
        assert result["process"]["name"] == "com.example.app"
        assert result["process"]["pid"] == 1234
        assert "parse_time_ms" in result

    def test_parse_anr_main_thread(self):
        """ANR: main thread is extracted correctly."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        main = result["main_thread"]
        assert main is not None
        assert main["name"] == "main"
        assert main["tid"] == 1
        assert main["priority"] == 5
        assert main["state"] == "BLOCKED"
        assert main["daemon"] is False
        assert main["group"] == "main"
        # Should have stack frames
        assert len(main["stack_trace"]) >= 1

    def test_parse_anr_all_threads(self):
        """ANR: all threads are extracted."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        threads = result["all_threads"]
        assert len(threads) >= 5  # main, AsyncTask #1, Signal Catcher, Binder, HeapTaskDaemon
        thread_names = {t["name"] for t in threads}
        assert "main" in thread_names
        assert "AsyncTask #1" in thread_names
        assert "Signal Catcher" in thread_names
        assert "Binder:1234_1" in thread_names
        assert "HeapTaskDaemon" in thread_names

    def test_parse_anr_total_threads(self):
        """ANR: total_threads count matches all_threads length."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        assert result["total_threads"] == len(result["all_threads"])

    def test_parse_anr_lock_detection(self):
        """ANR: lock detection — locked and waiting_to_lock are captured."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        locks = result["held_locks"]
        assert len(locks) >= 1
        # The main thread holds a lock
        lock_addrs = {item["lock_address"] for item in locks}
        assert "0x0a2b3c4d" in lock_addrs
        # Find that lock and check holder
        for lock_item in locks:
            if lock_item["lock_address"] == "0x0a2b3c4d":
                assert lock_item["holder_thread"] == "main"
                assert lock_item["holder_tid"] == 1
                assert len(lock_item["waiters"]) >= 1
                # AsyncTask #1 should be waiting on this lock
                waiter_names = [w["thread"] for w in lock_item["waiters"]]
                assert "AsyncTask #1" in waiter_names
                break

    def test_parse_anr_daemon_threads(self):
        """ANR: daemon threads are flagged correctly."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        threads = result["all_threads"]
        for t in threads:
            if t["name"] == "Signal Catcher":
                assert t["daemon"] is True
            if t["name"] == "HeapTaskDaemon":
                assert t["daemon"] is True
            if t["name"] == "main":
                assert t["daemon"] is False

    def test_parse_anr_native_method_detection(self):
        """ANR: is_native flag is set for Native Method frames."""
        result = DiagnosticParser.parse_anr(SAMPLE_ANR)
        main = result["main_thread"]
        native_frames = [f for f in main["stack_trace"] if f["is_native"]]
        assert len(native_frames) >= 1
        assert native_frames[0]["method"] == "nativePollOnce"

    def test_parse_anr_empty_file(self):
        """ANR: empty file returns error."""
        result = DiagnosticParser.parse_anr(EMPTY_TEXT)
        assert "error" in result

    def test_parse_anr_non_anr_text(self):
        """ANR: non-ANR text returns error."""
        result = DiagnosticParser.parse_anr(NON_DIAGNOSTIC_TEXT)
        assert "error" in result

    def test_parse_anr_garbled_text(self):
        """ANR: garbled text returns graceful error."""
        result = DiagnosticParser.parse_anr(GARBLED_TEXT)
        assert "error" in result

    def test_parse_anr_truncated_file(self):
        """ANR: truncated file with minimal content still parses what it can."""
        result = DiagnosticParser.parse_anr(TRUNCATED_ANR)
        assert result.get("type") == "anr_trace"
        assert result["process"]["pid"] == 9999
        assert result["main_thread"] is not None
        assert result["main_thread"]["name"] == "main"


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests — Tombstone parsing
# ──────────────────────────────────────────────────────────────────────────────


class TestParseTombstone:
    """Tests for DiagnosticParser.parse_tombstone()."""

    def test_parse_tombstone_process_info(self):
        """Tombstone: extract process name, PID, TID."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        assert result.get("type") == "tombstone"
        assert result["process"]["name"] == "/system/bin/surfaceflinger"
        assert result["process"]["pid"] == 789
        assert result["process"]["tid"] == 790

    def test_parse_tombstone_signal_info(self):
        """Tombstone: extract signal number, name, code, fault addr."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        sig = result["signal"]
        assert sig["signal_number"] == 11
        assert sig["signal_name"] == "SIGSEGV"
        assert sig["code"] == 1
        assert sig["code_name"] == "SEGV_MAPERR"
        assert sig["fault_address"] == "0x0000000000000010"

    def test_parse_tombstone_backtrace(self):
        """Tombstone: backtrace frames are extracted."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        bt = result["backtrace"]
        assert len(bt) >= 3
        # Frame 0
        f0 = bt[0]
        assert f0["frame"] == 0
        assert f0["address"] == "0x0000000000002560"
        assert "SurfaceFlinger" in f0["symbol"]
        assert f0["offset"] == "+128"
        assert "libsurfaceflinger.so" in f0["file"] or "SurfaceFlinger" in f0["file"]

    def test_parse_tombstone_abort_message(self):
        """Tombstone: abort message is extracted."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        assert result["abort_message"] is not None
        assert "HAL_PIXEL_FORMAT" in result["abort_message"]

    def test_parse_tombstone_build_fingerprint(self):
        """Tombstone: build fingerprint is extracted."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        assert result["build_fingerprint"] is not None
        assert "google/sunfish" in result["build_fingerprint"]

    def test_parse_tombstone_registers(self):
        """Tombstone: registers are extracted."""
        result = DiagnosticParser.parse_tombstone(SAMPLE_TOMBSTONE)
        regs = result["registers"]
        assert "pc" in regs
        assert "sp" in regs
        assert "lr" in regs
        assert "x0" in regs
        assert len(regs) >= 3

    def test_parse_tombstone_empty_file(self):
        """Tombstone: empty file returns error."""
        result = DiagnosticParser.parse_tombstone(EMPTY_TEXT)
        assert "error" in result

    def test_parse_tombstone_non_tombstone_text(self):
        """Tombstone: non-tombstone text returns error."""
        result = DiagnosticParser.parse_tombstone(NON_DIAGNOSTIC_TEXT)
        assert "error" in result

    def test_parse_tombstone_garbled_text(self):
        """Tombstone: garbled text returns graceful error."""
        result = DiagnosticParser.parse_tombstone(GARBLED_TEXT)
        assert "error" in result


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests — Auto-detection (parse_diagnostic)
# ──────────────────────────────────────────────────────────────────────────────


class TestParseDiagnostic:
    """Tests for DiagnosticParser.parse_diagnostic() auto-detection."""

    def test_auto_detect_anr(self):
        """Auto-detect: ANR text is detected and parsed as ANR."""
        result = DiagnosticParser.parse_diagnostic(SAMPLE_ANR)
        assert result.get("type") == "anr_trace"
        assert result["process"]["pid"] == 1234

    def test_auto_detect_tombstone(self):
        """Auto-detect: Tombstone text is detected and parsed."""
        result = DiagnosticParser.parse_diagnostic(SAMPLE_TOMBSTONE)
        assert result.get("type") == "tombstone"
        assert result["process"]["pid"] == 789

    def test_auto_detect_empty_file(self):
        """Auto-detect: empty file returns error."""
        result = DiagnosticParser.parse_diagnostic(EMPTY_TEXT)
        assert "error" in result

    def test_auto_detect_non_diagnostic(self):
        """Auto-detect: non-diagnostic file returns error."""
        result = DiagnosticParser.parse_diagnostic(NON_DIAGNOSTIC_TEXT)
        assert "error" in result


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests — Data classes
# ──────────────────────────────────────────────────────────────────────────────


class TestDataClasses:
    """Tests for data class constructors and defaults."""

    def test_stack_frame_native(self):
        """StackFrame: is_native defaults to False but can be True."""
        sf = StackFrame(
            method="nativePollOnce",
            class_name="android.os.MessageQueue",
            file=None,
            line=None,
            is_native=True,
        )
        assert sf.is_native is True
        assert sf.file is None

    def test_stack_frame_java(self):
        """StackFrame: Java frame with file and line."""
        sf = StackFrame(
            method="next",
            class_name="android.os.MessageQueue",
            file="MessageQueue.java",
            line=339,
            is_native=False,
        )
        assert sf.file == "MessageQueue.java"
        assert sf.line == 339
        assert not sf.is_native

    def test_thread_info_defaults(self):
        """ThreadInfo: default values are correct."""
        t = ThreadInfo(name="test-thread", tid=42, priority=5, state="RUNNABLE")
        assert t.daemon is False
        assert t.group == "main"
        assert t.sys_tid is None
        assert t.stack_trace == []

    def test_lock_info_empty_waiters(self):
        """LockInfo: waiters defaults to empty list."""
        lock = LockInfo(
            lock_class="java.lang.Object",
            lock_address="0x0a2b3c4d",
            holder_thread="main",
            holder_tid=1,
        )
        assert lock.waiters == []

    def test_anr_result_defaults(self):
        """AnrResult: defaults for optional fields."""
        r = AnrResult(process_name="test", pid=1, all_threads=[], held_locks=[], total_threads=0)
        assert r.main_thread is None
        assert r.anr_subject is None
        assert r.parse_time_ms == 0.0

    def test_tombstone_result_fields(self):
        """TombstoneResult: all fields are present."""
        r = TombstoneResult(
            process_name="test",
            pid=1,
            tid=2,
            signal_number=11,
            signal_name="SIGSEGV",
            code=1,
            code_name="SEGV_MAPERR",
            fault_address="0x10",
            registers={},
            backtrace=[],
        )
        assert r.abort_message is None
        assert r.build_fingerprint is None
        assert r.abort_timestamp is None


# ──────────────────────────────────────────────────────────────────────────────
# Integration tests — File path handling (via agent_tools pattern)
# ──────────────────────────────────────────────────────────────────────────────


class TestDiagnosticParserFromFile:
    """Tests that DiagnosticParser works with actual file paths."""

    def test_parse_anr_from_file(self):
        """Parse ANR from an actual temp file."""
        path = _write_temp_file(SAMPLE_ANR, suffix=".anr")
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read()
            result = DiagnosticParser.parse_anr(content)
            assert result.get("type") == "anr_trace"
            assert result["process"]["pid"] == 1234
        finally:
            os.unlink(path)

    def test_parse_tombstone_from_file(self):
        """Parse tombstone from an actual temp file."""
        path = _write_temp_file(SAMPLE_TOMBSTONE, suffix=".txt")
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read()
            result = DiagnosticParser.parse_tombstone(content)
            assert result.get("type") == "tombstone"
            assert result["signal"]["signal_number"] == 11
        finally:
            os.unlink(path)

    def test_file_size_limit(self):
        """MAX_FILE_SIZE constant is defined and reasonable."""
        assert DiagnosticParser.MAX_FILE_SIZE == 200_000

    def test_parse_diagnostic_auto_from_file(self):
        """parse_diagnostic auto-detects from actual file content."""
        path = _write_temp_file(SAMPLE_TOMBSTONE, suffix=".txt")
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read()
            result = DiagnosticParser.parse_diagnostic(content)
            assert result.get("type") == "tombstone"
        finally:
            os.unlink(path)

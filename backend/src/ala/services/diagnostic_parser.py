"""Diagnostic file structured parser for ANR traces and tombstones.

Pure-Python implementation with zero external dependencies beyond stdlib.
Provides static methods for parsing Android ANR traces and native crash
tombstones into structured JSON-serializable dicts.

Usage::

    result = DiagnosticParser.parse_anr(text)
    result = DiagnosticParser.parse_tombstone(text)
    result = DiagnosticParser.parse_diagnostic(text)  # auto-detect
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

# ═══════════════════════════════════════════════════════════════════════════════
# Data models
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class StackFrame:
    """A single stack frame from a thread dump."""

    method: str  # Method name, e.g. "nativePollOnce"
    class_name: str  # Fully-qualified class, e.g. "android.os.MessageQueue"
    file: str | None  # Source file name or None (for Native Method)
    line: int | None  # Line number or None
    is_native: bool  # True if (Native Method)


@dataclass
class ThreadInfo:
    """Android thread snapshot from an ANR trace."""

    name: str  # Thread name, e.g. "main", "AsyncTask #1"
    tid: int  # Thread ID
    priority: int  # Nice priority
    state: str  # RUNNABLE / BLOCKED / WAITING / TIMED_WAITING / SLEEPING / NATIVE
    daemon: bool = False
    group: str = "main"  # Thread group, e.g. "main", "system"
    sys_tid: int | None = None  # System-level TID (sysTid)
    stack_trace: list[StackFrame] = field(default_factory=list)


@dataclass
class LockInfo:
    """Lock holder/waiters relationship."""

    lock_class: str  # Lock object class name
    lock_address: str  # Hex address, e.g. "0x0a2b3c4d"
    holder_thread: str  # Holder thread name
    holder_tid: int  # Holder TID
    waiters: list[dict] = field(default_factory=list)
    # Each waiter: {"thread": str, "tid": int, "waiting_since_line": str}


@dataclass
class AnrResult:
    """Complete ANR trace parse result."""

    process_name: str
    pid: int
    main_thread: ThreadInfo | None = None
    all_threads: list[ThreadInfo] = field(default_factory=list)
    held_locks: list[LockInfo] = field(default_factory=list)
    total_threads: int = 0
    anr_subject: str | None = None
    parse_time_ms: float = 0.0


@dataclass
class TombstoneResult:
    """Complete tombstone parse result."""

    process_name: str
    pid: int
    tid: int
    signal_number: int
    signal_name: str
    code: int
    code_name: str
    fault_address: str
    registers: dict[str, str] = field(default_factory=dict)
    backtrace: list[dict] = field(default_factory=list)
    abort_message: str | None = None
    build_fingerprint: str | None = None
    abort_timestamp: str | None = None
    parse_time_ms: float = 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# DiagnosticParser
# ═══════════════════════════════════════════════════════════════════════════════


class DiagnosticParser:
    """Static parser for Android diagnostic files (ANR traces & tombstones).

    All methods are static — no state, no instantiation required.
    """

    # ── Constants ────────────────────────────────────────────────────────────

    MAX_FILE_SIZE: int = 200_000  # 200KB

    # ── ANR regex patterns ───────────────────────────────────────────────────

    _RE_PID_LINE = re.compile(r"----- pid (\d+) at .* -----")
    _RE_CMD_LINE = re.compile(r"Cmd line:\s*(.+)")
    _RE_ANR_SUBJECT = re.compile(r"Subject:\s*(.+)")
    _RE_THREAD_HEAD = re.compile(
        r'^"(?P<name>[^"]+)"(?:\s+\w+)*\s+prio=(?P<prio>\d+)\s+tid=(?P<tid>\d+)\s+(?P<state>\S+)'
    )
    _RE_THREAD_ATTR = re.compile(r'^\s+\|\s+group="(\S+)"')
    _RE_SYS_TID = re.compile(r"sysTid=(\d+)")
    _RE_DAEMON = re.compile(r"\bdaemon\b")
    _RE_STACK_FRAME = re.compile(
        r"^\s+at\s+(?P<cls>(?:\S+\.)*\S+)\.(?P<method>\S+)\((?P<file>[^:)]+)?(?::(?P<line>\d+))?\)"
    )
    _RE_NATIVE = re.compile(r"Native Method", re.IGNORECASE)
    _RE_LOCKED = re.compile(r"- locked <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\)")
    _RE_WAITING_LOCK = re.compile(
        r"- waiting to lock <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\).*held by thread (\d+)"
    )
    _RE_WAITING_ON = re.compile(r"- waiting on <(0x[0-9a-f]+)>\s*\((?:a\s+)?([^)]+)\)")

    # ── Tombstone regex patterns ─────────────────────────────────────────────

    _RE_TOMBSTONE_MARKER = re.compile(r"\*{3} \*{3} \*{3} \*{3}")
    _RE_TOMBSTONE_PID = re.compile(r"pid:\s*(\d+),\s*tid:\s*(\d+),\s*name:\s*(\S+)")
    _RE_PROCESS_EXE = re.compile(r">>>\s*(.+?)\s*<<<")
    _RE_SIGNAL_LINE = re.compile(
        r"signal\s+(\d+)\s+\((\S+)\).*?code\s+(\d+)\s*\(([^)]*)\)?.*?fault addr\s+(0x[0-9a-f]+)"
    )
    _RE_REGISTER = re.compile(
        r"(?:^|\s{2,})(x\d+|r\d+|pc|sp|lr)\s+([0-9a-f]+)", re.IGNORECASE | re.MULTILINE
    )
    _RE_BACKTRACE_FRAME = re.compile(
        r"#(\d+)\s+pc\s+(0x[0-9a-f]+|[0-9a-f]+)\s+(\S+.*?)\s*\((.+?)(?:\+(\d+))?\)$",
        re.MULTILINE,
    )
    _RE_ABORT_MSG = re.compile(r"Abort message:\s*'(.+)'")
    _RE_BUILD_FP = re.compile(r"Build fingerprint:\s*'(.+)'")
    _RE_ABORT_TS = re.compile(r"Timestamp:\s*(.+)")

    # ── State normalization map ──────────────────────────────────────────────

    _STATE_MAP: dict[str, str] = {
        "Blocked": "BLOCKED",
        "Waiting": "WAITING",
        "TimedWaiting": "TIMED_WAITING",
        "Sleeping": "SLEEPING",
        "Runnable": "RUNNABLE",
        "Native": "NATIVE",
        "Running": "RUNNABLE",
    }

    # ═══════════════════════════════════════════════════════════════════════════
    # Public API
    # ═══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def parse_anr(text: str) -> dict[str, Any]:
        """Parse ANR trace text and return a JSON-serializable dict.

        Returns:
            Dict with keys: type, process, main_thread, all_threads,
            held_locks, total_threads, anr_subject, parse_time_ms.
            Returns {"error": "..."} on failure.
        """
        t0 = time.monotonic()
        lines = text.split("\n")

        # 1. Extract process info from header (first 30 lines)
        process_name = ""
        pid = 0
        anr_subject: str | None = None
        for line in lines[:30]:
            if m := DiagnosticParser._RE_PID_LINE.match(line):
                pid = int(m.group(1))
            elif m := DiagnosticParser._RE_CMD_LINE.match(line):
                process_name = m.group(1).strip()
            elif m := DiagnosticParser._RE_ANR_SUBJECT.search(line):
                anr_subject = m.group(1).strip()

        if pid == 0:
            return {"error": "File does not appear to be a valid ANR trace (no pid header found)"}

        # 2. Parse all threads
        all_threads, main_thread = DiagnosticParser._parse_anr_threads(lines)
        if main_thread is None:
            return {"error": "File does not appear to be a valid ANR trace (no main thread found)"}

        # 3. Build lock graph
        held_locks = DiagnosticParser._build_lock_graph(lines, all_threads)

        return {
            "type": "anr_trace",
            "process": {"name": process_name, "pid": pid},
            "main_thread": DiagnosticParser._thread_to_dict(main_thread),
            "all_threads": [DiagnosticParser._thread_to_dict(t) for t in all_threads],
            "held_locks": DiagnosticParser._locks_to_dicts(held_locks),
            "total_threads": len(all_threads),
            "anr_subject": anr_subject,
            "parse_time_ms": round((time.monotonic() - t0) * 1000, 2),
        }

    @staticmethod
    def parse_tombstone(text: str) -> dict[str, Any]:
        """Parse tombstone text and return a JSON-serializable dict.

        Returns:
            Dict with keys: type, process, signal, abort_message, registers,
            backtrace, build_fingerprint, abort_timestamp, parse_time_ms.
            Returns {"error": "..."} on failure.
        """
        t0 = time.monotonic()

        # 1. Process info
        pid = tid = 0
        process_name = ""
        m_pid = DiagnosticParser._RE_TOMBSTONE_PID.search(text)
        if m_pid:
            pid = int(m_pid.group(1))
            tid = int(m_pid.group(2))
            process_name = m_pid.group(3)
        # Try extracting executable path from >>> ... <<<
        if m_exe := DiagnosticParser._RE_PROCESS_EXE.search(text):
            process_name = m_exe.group(1).strip()

        if pid == 0:
            return {"error": "File does not appear to be a valid tombstone (no pid/tid found)"}

        # 2. Signal info
        signal_info: dict[str, Any] = {
            "signal_number": 0,
            "signal_name": "",
            "code": 0,
            "code_name": "",
            "fault_address": "",
        }
        if m_sig := DiagnosticParser._RE_SIGNAL_LINE.search(text):
            signal_info = {
                "signal_number": int(m_sig.group(1)),
                "signal_name": m_sig.group(2),
                "code": int(m_sig.group(3)),
                "code_name": m_sig.group(4) or "",
                "fault_address": m_sig.group(5),
            }
        else:
            return {"error": "File does not appear to be a valid tombstone (no signal info found)"}

        # 3. Registers
        registers: dict[str, str] = {}
        for m in DiagnosticParser._RE_REGISTER.finditer(text):
            registers[m.group(1).lower()] = m.group(2)

        # 4. Backtrace
        backtrace: list[dict] = []
        for m in DiagnosticParser._RE_BACKTRACE_FRAME.finditer(text):
            addr = m.group(2)
            if not addr.startswith("0x"):
                addr = "0x" + addr
            backtrace.append(
                {
                    "frame": int(m.group(1)),
                    "address": addr,
                    "symbol": m.group(4).strip(),
                    "offset": f"+{m.group(5)}" if m.group(5) else None,
                    "file": m.group(3).strip(),
                }
            )

        # 5. Optional info
        abort_message: str | None = None
        if m_ab := DiagnosticParser._RE_ABORT_MSG.search(text):
            abort_message = m_ab.group(1)

        build_fingerprint: str | None = None
        if m_bf := DiagnosticParser._RE_BUILD_FP.search(text):
            build_fingerprint = m_bf.group(1)

        abort_timestamp: str | None = None
        if m_ts := DiagnosticParser._RE_ABORT_TS.search(text):
            abort_timestamp = m_ts.group(1)

        return {
            "type": "tombstone",
            "process": {"name": process_name, "pid": pid, "tid": tid},
            "signal": signal_info,
            "abort_message": abort_message,
            "registers": registers,
            "backtrace": backtrace,
            "build_fingerprint": build_fingerprint,
            "abort_timestamp": abort_timestamp,
            "parse_time_ms": round((time.monotonic() - t0) * 1000, 2),
        }

    @staticmethod
    def parse_diagnostic(text: str, file_path: str | None = None) -> dict[str, Any]:
        """Auto-detect file type and dispatch to parse_anr or parse_tombstone.

        Detection priority:
        1. Tombstone marker (``*** *** *** ...``)
        2. ANR pid header (``----- pid N at ... -----`` + ``"main" prio=``)
        3. Unrecognized → returns error dict

        Args:
            text: Full diagnostic file content.
            file_path: Optional file path (for error messages only).
        """
        if not text.strip():
            return {"error": "File is empty"}

        header = text[:8192]

        # Detect tombstone first (more distinctive marker)
        if DiagnosticParser._RE_TOMBSTONE_MARKER.search(header):
            return DiagnosticParser.parse_tombstone(text)

        # Detect ANR
        if DiagnosticParser._RE_PID_LINE.search(header) and '"main" prio=' in header:
            return DiagnosticParser.parse_anr(text)

        return {"error": "Unrecognized diagnostic format"}

    # ═══════════════════════════════════════════════════════════════════════════
    # Private — ANR thread parsing
    # ═══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _parse_anr_threads(lines: list[str]) -> tuple[list[ThreadInfo], ThreadInfo | None]:
        """Parse all threads from ANR trace lines.

        Returns:
            Tuple of (all_threads, main_thread_or_None).
        """
        threads: list[ThreadInfo] = []
        main_thread: ThreadInfo | None = None
        current_thread: ThreadInfo | None = None

        for line in lines:
            # Detect thread header: "name" prio=N tid=N State
            m_head = DiagnosticParser._RE_THREAD_HEAD.match(line)
            if m_head:
                # Save previous thread
                if current_thread is not None:
                    threads.append(current_thread)

                name = m_head.group("name")
                current_thread = ThreadInfo(
                    name=name,
                    priority=int(m_head.group("prio")),
                    tid=int(m_head.group("tid")),
                    state=DiagnosticParser._normalize_state(m_head.group("state")),
                    daemon=False,
                    group="main",
                    sys_tid=None,
                )
                # Check if it's the main thread (name="main" and tid=1)
                if name == "main" and current_thread.tid == 1:
                    main_thread = current_thread
                # Check for daemon flag on the header line
                if DiagnosticParser._RE_DAEMON.search(line):
                    current_thread.daemon = True
                continue

            if current_thread is None:
                continue

            # Thread attribute line: | group="..." ... daemon ...
            if m_grp := DiagnosticParser._RE_THREAD_ATTR.search(line):
                current_thread.group = m_grp.group(1)
                if DiagnosticParser._RE_DAEMON.search(line):
                    current_thread.daemon = True

            # sysTid
            if m_st := DiagnosticParser._RE_SYS_TID.search(line):
                current_thread.sys_tid = int(m_st.group(1))

            # Stack frame: at xxx.xxx.xxx(...)
            m_sf = DiagnosticParser._RE_STACK_FRAME.match(line)
            if m_sf:
                file_part = m_sf.group("file") or ""
                is_native = bool(DiagnosticParser._RE_NATIVE.search(file_part))
                current_thread.stack_trace.append(
                    StackFrame(
                        method=m_sf.group("method"),
                        class_name=m_sf.group("cls"),
                        file=file_part if not is_native else None,
                        line=int(m_sf.group("line")) if m_sf.group("line") else None,
                        is_native=is_native,
                    )
                )

        # Don't forget the last thread
        if current_thread is not None:
            threads.append(current_thread)

        return threads, main_thread

    @staticmethod
    def _normalize_state(raw: str) -> str:
        """Normalize thread state string to uppercase standard form."""
        return DiagnosticParser._STATE_MAP.get(raw, raw.upper())

    # ═══════════════════════════════════════════════════════════════════════════
    # Private — Lock graph building
    # ═══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _build_lock_graph(lines: list[str], threads: list[ThreadInfo]) -> list[LockInfo]:
        """Build lock holder/waiter relationships from ANR trace lines.

        Strategy:
        1. Scan all ``- locked <addr>`` → record {addr: lock_class}
        2. Scan all ``- waiting to lock <addr> ... held by thread N`` → record waiters
        3. Scan all ``- waiting on <addr>`` → record blocked waiters
        4. Associate each locked/waiting line with its preceding thread header
        5. Assemble LockInfo list
        """
        # Build tid → thread name mapping
        name_to_tid: dict[str, int] = {t.name: t.tid for t in threads}

        # Held locks: {addr: (lock_class, holder_tid)}
        held: dict[str, tuple[str, int]] = {}
        for line in lines:
            if m := DiagnosticParser._RE_LOCKED.search(line):
                addr = m.group(1)
                lock_class = m.group(2).strip()
                held[addr] = (lock_class, -1)  # holder_tid to be resolved

        # Associate waiting lines and locked lines with their thread context
        # by tracking the current thread header as we scan.
        lock_holder: dict[str, str] = {}  # addr → thread_name (of LOCK holder)
        waiters_by_addr: dict[str, list[dict]] = {}
        wait_owner: dict[str, str] = {}  # addr → thread_name (of WAITING thread)
        wait_owner_tid: dict[str, int] = {}  # addr → tid (of WAITING thread)
        current_thread_name = ""

        for line in lines:
            # Track current thread
            if m_head := DiagnosticParser._RE_THREAD_HEAD.match(line):
                current_thread_name = m_head.group("name")

            # - locked <addr> — record which thread holds this lock
            if m_locked := DiagnosticParser._RE_LOCKED.search(line):
                addr = m_locked.group(1)
                lock_holder[addr] = current_thread_name

            # - waiting to lock <addr> ... held by thread N
            if m_wl := DiagnosticParser._RE_WAITING_LOCK.search(line):
                addr = m_wl.group(1)
                lock_class = m_wl.group(2).strip()
                holder_tid = int(m_wl.group(3))
                if addr not in waiters_by_addr:
                    waiters_by_addr[addr] = []
                wait_owner[addr] = current_thread_name
                wait_owner_tid[addr] = name_to_tid.get(current_thread_name, -1)
                waiters_by_addr[addr].append(
                    {
                        "thread": current_thread_name,
                        "tid": wait_owner_tid[addr],
                        "waiting_since_line": lock_class,
                    }
                )
                # Update holder_tid if we know the lock
                if addr in held:
                    held[addr] = (held[addr][0], holder_tid)

            # - waiting on <addr> (blocked, no explicit holder)
            if m_wo := DiagnosticParser._RE_WAITING_ON.search(line):
                addr = m_wo.group(1)
                lock_class = m_wo.group(2).strip()
                if addr not in waiters_by_addr:
                    waiters_by_addr[addr] = []
                waiters_by_addr[addr].append(
                    {
                        "thread": current_thread_name,
                        "tid": name_to_tid.get(current_thread_name, -1),
                        "waiting_since_line": lock_class,
                    }
                )

        # Assemble result
        result: list[LockInfo] = []
        for addr, (lock_class, _) in held.items():
            holder_name = lock_holder.get(addr, "unknown")
            holder_tid_actual = name_to_tid.get(holder_name, -1)
            result.append(
                LockInfo(
                    lock_class=lock_class,
                    lock_address=addr,
                    holder_thread=holder_name,
                    holder_tid=holder_tid_actual,
                    waiters=waiters_by_addr.get(addr, []),
                )
            )
        return result

    # ═══════════════════════════════════════════════════════════════════════════
    # Private — Serialization helpers
    # ═══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _thread_to_dict(t: ThreadInfo) -> dict[str, Any]:
        """Convert a ThreadInfo to a JSON-serializable dict."""
        return {
            "name": t.name,
            "tid": t.tid,
            "priority": t.priority,
            "state": t.state,
            "daemon": t.daemon,
            "group": t.group,
            "sys_tid": t.sys_tid,
            "stack_trace": [
                {
                    "method": sf.method,
                    "class": sf.class_name,
                    "file": sf.file,
                    "line": sf.line,
                    "is_native": sf.is_native,
                }
                for sf in t.stack_trace
            ],
        }

    @staticmethod
    def _locks_to_dicts(locks: list[LockInfo]) -> list[dict[str, Any]]:
        """Convert a list of LockInfo to JSON-serializable dicts."""
        return [
            {
                "lock_class": L.lock_class,
                "lock_address": L.lock_address,
                "holder_thread": L.holder_thread,
                "holder_tid": L.holder_tid,
                "waiters": L.waiters,
            }
            for L in locks
        ]

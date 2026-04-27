"""Perfetto trace file analyzer."""

import io
import json
import re
from dataclasses import dataclass


class TraceParseError(Exception):
    pass


@dataclass
class TraceSummary:
    duration_ms: float | None
    process_count: int
    thread_count: int
    event_count: int
    processes: list[dict]
    top_slices: list[dict]
    ftrace_events: list[str]
    metadata: dict


@dataclass
class TraceParseResult:
    summary: TraceSummary
    format: str


@dataclass
class TraceFilters:
    """Filters to apply to a parsed Perfetto trace summary.

    Filtering is performed on the *processes* list already extracted from the
    trace.  All conditions are ANDed together.

    Attributes:
        pids: Keep only processes whose ``pid`` is in this list.
        process_name: Keep only processes whose ``name`` matches this regex
            (case-insensitive).
    """

    pids: list[int] | None = None
    process_name: str | None = None


class TraceAnalyzer:
    def parse_trace(self, content: bytes, filename: str) -> TraceParseResult:
        """Parse a trace file, preferring Perfetto TraceProcessor for all formats.

        Parsing order:
        1. Perfetto ``TraceProcessor`` – handles Perfetto proto binary, JSON
           Chrome traces, and systrace HTML/text files automatically.
        2. Custom JSON parser – lightweight fallback for Chrome-format JSON
           traces when TraceProcessor is unavailable or fails.
        3. Legacy varint scanner – last-resort heuristic for raw proto binary.
        """
        is_json = content[:1] in (b"{", b"[") or filename.endswith(".json")
        fmt_hint = "json_trace" if is_json else "perfetto_proto"

        # 1. Try Perfetto TraceProcessor (supports proto, JSON, systrace)
        try:
            from perfetto.trace_processor import TraceProcessor  # type: ignore[import-untyped]

            with TraceProcessor(trace=io.BytesIO(content)) as tp:
                return self._summarize_via_tp(tp, file_size=len(content), fmt=fmt_hint)
        except ImportError:
            pass
        except Exception:
            pass

        # 2. Custom JSON parser
        if is_json:
            try:
                return self._parse_json_trace(content)
            except (json.JSONDecodeError, KeyError):
                pass

        # 3. Legacy proto varint scanner
        if len(content) > 4:
            try:
                return self._parse_proto_trace_legacy(content)
            except Exception:
                pass

        # Unknown / unsupported format
        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=None,
                process_count=0,
                thread_count=0,
                event_count=0,
                processes=[],
                top_slices=[],
                ftrace_events=[],
                metadata={
                    "file_size": len(content),
                    "note": "Unknown or unsupported trace format",
                },
            ),
            format="unknown",
        )

    def filter_trace(self, result: TraceParseResult, filters: TraceFilters) -> TraceParseResult:
        """Return a new :class:`TraceParseResult` with only the matching processes.

        ``top_slices`` and ``ftrace_events`` are currently kept as-is because
        they are not tied to specific process pids in the summary representation.
        ``process_count`` and ``thread_count`` are updated to reflect the filtered
        set.
        """
        processes = result.summary.processes

        if filters.pids:
            pid_set = set(filters.pids)
            processes = [p for p in processes if p.get("pid") in pid_set]

        if filters.process_name and filters.process_name.strip():
            try:
                pattern = re.compile(filters.process_name, re.IGNORECASE)
            except re.error:
                pattern = None
            if pattern:
                processes = [p for p in processes if pattern.search(str(p.get("name", "")))]
            else:
                needle = filters.process_name.lower()
                processes = [p for p in processes if needle in str(p.get("name", "")).lower()]

        thread_count = sum(p.get("thread_count", 0) for p in processes)

        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=result.summary.duration_ms,
                process_count=len(processes),
                thread_count=thread_count,
                event_count=result.summary.event_count,
                processes=processes,
                top_slices=result.summary.top_slices,
                ftrace_events=result.summary.ftrace_events,
                metadata=result.summary.metadata,
            ),
            format=result.format,
        )

    def _parse_json_trace(self, content: bytes) -> TraceParseResult:
        text = content.decode("utf-8", errors="replace")
        data = json.loads(text)

        events = []
        if isinstance(data, dict):
            events = data.get("traceEvents", [])
            if not events:
                events = data.get("events", [])
        elif isinstance(data, list):
            events = data

        processes: dict[int, dict] = {}
        slices: dict[str, dict] = {}
        ftrace_events: set[str] = set()
        min_ts: float | None = None
        max_ts: float | None = None

        for evt in events:
            if not isinstance(evt, dict):
                continue

            ph = evt.get("ph", "")
            ts = evt.get("ts")
            pid = evt.get("pid", 0)
            tid = evt.get("tid", 0)
            name = evt.get("name", "")

            if ts is not None:
                ts_f = float(ts)
                if min_ts is None or ts_f < min_ts:
                    min_ts = ts_f
                if max_ts is None or ts_f > max_ts:
                    max_ts = ts_f

            # Process/thread name metadata events
            if ph == "M":
                args = evt.get("args", {})
                if name == "process_name":
                    if pid not in processes:
                        processes[pid] = {
                            "pid": pid,
                            "name": args.get("name", f"Process {pid}"),
                            "threads": set(),
                        }
                    else:
                        # Update name even if the process was already created
                        # (slice events may arrive before metadata events)
                        processes[pid]["name"] = args.get("name", processes[pid]["name"])
                elif name == "thread_name":
                    if pid not in processes:
                        processes[pid] = {
                            "pid": pid,
                            "name": f"Process {pid}",
                            "threads": set(),
                        }
                    processes[pid]["threads"].add(tid)

            # Complete slices and begin events
            if ph in ("X", "B"):
                if pid not in processes:
                    processes[pid] = {
                        "pid": pid,
                        "name": f"Process {pid}",
                        "threads": set(),
                    }
                processes[pid]["threads"].add(tid)

                if name:
                    dur = evt.get("dur", 0)
                    if name not in slices:
                        slices[name] = {"name": name, "count": 0, "total_dur_us": 0}
                    slices[name]["count"] += 1
                    slices[name]["total_dur_us"] += float(dur)

            # ftrace / instant events
            if name and ("ftrace" in name.lower() or ph == "i"):
                ftrace_events.add(name)

        duration_ms = None
        if min_ts is not None and max_ts is not None:
            duration_ms = (max_ts - min_ts) / 1000.0

        proc_list = [
            {
                "pid": pid,
                "name": info["name"],
                "thread_count": len(info["threads"]),
            }
            for pid, info in processes.items()
        ]

        top_slices = sorted(
            [
                {
                    "name": s["name"],
                    "count": s["count"],
                    "duration_ms": s["total_dur_us"] / 1000.0,
                }
                for s in slices.values()
            ],
            key=lambda x: x["duration_ms"],
            reverse=True,
        )

        thread_count = sum(len(info["threads"]) for info in processes.values())

        metadata: dict = {}
        if isinstance(data, dict):
            for key in ("metadata", "displayTimeUnit", "otherData"):
                if key in data:
                    metadata[key] = data[key]

        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=duration_ms,
                process_count=len(processes),
                thread_count=thread_count,
                event_count=len(events),
                processes=proc_list,
                top_slices=top_slices,
                ftrace_events=list(ftrace_events)[:30],
                metadata=metadata,
            ),
            format="json_trace",
        )

    def _parse_proto_trace(self, content: bytes) -> TraceParseResult:
        """Parse a Perfetto proto binary trace (kept for direct callers).

        Delegates to :meth:`parse_trace` with a ``'.perfetto-trace'`` filename
        hint so the Perfetto ``TraceProcessor`` is tried first.
        """
        return self.parse_trace(content, "trace.perfetto-trace")

    @staticmethod
    def _query_with_timeout(tp, sql: str, timeout: float = 30.0):
        """Run a TraceProcessor query with a timeout guard."""
        import concurrent.futures

        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(tp.query, sql)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise Exception(
                f"TraceProcessor query timed out after {timeout}s: {sql[:80]}..."
            )
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    # type: ignore[no-untyped-def]
    def _summarize_via_tp(
        self, tp, file_size: int, fmt: str = "perfetto_proto"
    ) -> TraceParseResult:
        """Extract a :class:`TraceParseResult` from an open ``TraceProcessor`` session."""

        # ── Processes ──────────────────────────────────────────────────────
        processes: list[dict] = []
        try:
            rows = self._query_with_timeout(tp,
                "SELECT p.pid, p.name, COUNT(t.utid) AS thread_count "
                "FROM process p "
                "LEFT JOIN thread t ON t.upid = p.upid "
                "WHERE p.pid IS NOT NULL AND p.pid != 0 "
                "GROUP BY p.upid"
            )
            for row in rows:
                processes.append(
                    {
                        "pid": row.pid,
                        "name": row.name or f"Process {row.pid}",
                        "thread_count": row.thread_count or 0,
                    }
                )
        except Exception:
            pass

        # ── Duration ───────────────────────────────────────────────────────
        duration_ms: float | None = None
        try:
            for row in self._query_with_timeout(tp, "SELECT start_ts, end_ts FROM trace_bounds"):
                if row.start_ts is not None and row.end_ts is not None:
                    duration_ms = (row.end_ts - row.start_ts) / 1e6
        except Exception:
            pass

        if duration_ms is None:
            try:
                for row in self._query_with_timeout(tp,
                    "SELECT MIN(ts) AS min_ts, "
                    "MAX(ts + CASE WHEN dur > 0 THEN dur ELSE 0 END) AS max_ts "
                    "FROM slice"
                ):
                    if row.min_ts is not None and row.max_ts is not None:
                        duration_ms = (row.max_ts - row.min_ts) / 1e6
            except Exception:
                pass

        # ── Event count ────────────────────────────────────────────────────
        event_count = 0
        try:
            for row in self._query_with_timeout(tp, "SELECT COUNT(*) AS cnt FROM slice"):
                event_count = row.cnt or 0
        except Exception:
            pass

        # ── Top slices ─────────────────────────────────────────────────────
        top_slices: list[dict] = []
        try:
            rows = self._query_with_timeout(tp,
                "SELECT name, COUNT(*) AS cnt, SUM(dur) / 1e6 AS duration_ms "
                "FROM slice "
                "WHERE dur > 0 AND name IS NOT NULL "
                "GROUP BY name "
                "ORDER BY duration_ms DESC "
            )
            for row in rows:
                top_slices.append(
                    {
                        "name": row.name,
                        "count": row.cnt,
                        "duration_ms": row.duration_ms or 0.0,
                    }
                )
        except Exception:
            pass

        # ── FTrace / raw events ────────────────────────────────────────────
        ftrace_events: list[str] = []
        try:
            for row in self._query_with_timeout(tp, "SELECT DISTINCT name FROM raw WHERE name IS NOT NULL LIMIT 30"):
                if row.name:
                    ftrace_events.append(row.name)
        except Exception:
            pass

        thread_count = sum(p.get("thread_count", 0) for p in processes)

        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=duration_ms,
                process_count=len(processes),
                thread_count=thread_count,
                event_count=event_count,
                processes=processes,
                top_slices=top_slices,
                ftrace_events=ftrace_events,
                metadata={"file_size": file_size, "format": fmt},
            ),
            format=fmt,
        )

    def _parse_proto_trace_legacy(self, content: bytes) -> TraceParseResult:
        """Lightweight fallback: scan protobuf varints without full proto definitions.

        Used when the ``perfetto`` package is unavailable or the
        ``trace_processor`` binary cannot be obtained.
        """
        ftrace_events: set[str] = set()
        event_count = 0
        offset = 0

        while offset < len(content) - 2:
            try:
                tag_varint, consumed = self._read_varint(content, offset)
                if consumed == 0 or tag_varint == 0:
                    break
                offset += consumed

                field_num = tag_varint >> 3
                wire_type = tag_varint & 0x7

                if wire_type == 0:  # varint
                    _val, consumed = self._read_varint(content, offset)
                    offset += consumed
                elif wire_type == 2:  # length-delimited
                    length, consumed = self._read_varint(content, offset)
                    offset += consumed
                    if offset + length > len(content):
                        break
                    field_data = content[offset : offset + length]
                    offset += length
                    event_count += 1

                    # Try to extract readable strings from known field numbers
                    if field_num in (3, 44, 60) and length > 0:
                        try:
                            text = field_data.decode("utf-8", errors="ignore")
                            if text and text.isprintable() and len(text) > 2:
                                ftrace_events.add(text[:50])
                        except Exception:
                            pass
                elif wire_type == 1:  # 64-bit
                    offset += 8
                elif wire_type == 5:  # 32-bit
                    offset += 4
                else:
                    break

                if event_count > 10000:
                    break

            except Exception:
                break

        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=None,
                process_count=0,
                thread_count=0,
                event_count=event_count,
                processes=[],
                top_slices=[],
                ftrace_events=list(ftrace_events)[:20],
                metadata={"file_size": len(content), "format": "perfetto_proto"},
            ),
            format="perfetto_proto",
        )

    def _read_varint(self, data: bytes, offset: int) -> tuple[int, int]:
        """Read a protobuf varint, return (value, bytes_consumed)."""
        result = 0
        shift = 0
        consumed = 0
        while offset + consumed < len(data):
            byte = data[offset + consumed]
            consumed += 1
            result |= (byte & 0x7F) << shift
            shift += 7
            if not (byte & 0x80):
                return result, consumed
            if shift >= 64:
                return 0, 0
        return 0, 0

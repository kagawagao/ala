"""Perfetto trace file analyzer."""
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
        # Try JSON format first
        if content[:1] in (b"{", b"[") or filename.endswith(".json"):
            try:
                return self._parse_json_trace(content)
            except (json.JSONDecodeError, KeyError):
                pass

        # Try Perfetto proto binary
        if len(content) > 4:
            try:
                return self._parse_proto_trace(content)
            except Exception:
                pass

        # Fallback: return minimal info
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

    def filter_trace(
        self, result: TraceParseResult, filters: TraceFilters
    ) -> TraceParseResult:
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
        )[:20]

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
        """Best-effort Perfetto protobuf trace parsing without full proto definitions.

        Perfetto trace proto format: sequence of TracePackets, each is a proto message.
        We do a basic protobuf field scan to extract known field IDs.
        """
        processes: dict = {}
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
                process_count=len(processes),
                thread_count=0,
                event_count=event_count,
                processes=list(processes.values()),
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

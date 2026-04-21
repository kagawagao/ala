"""Perfetto trace analysis endpoints."""

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services.trace_analyzer import TraceAnalyzer, TraceFilters, TraceParseError
from ..services.trace_analyzer import TraceParseResult as ServiceTraceParseResult
from ..services.trace_analyzer import TraceSummary as ServiceTraceSummary

router = APIRouter()
_analyzer = TraceAnalyzer()


class TraceSummary(BaseModel):
    duration_ms: float | None = None
    process_count: int
    thread_count: int
    event_count: int
    processes: list[dict]
    top_slices: list[dict]
    ftrace_events: list[str]
    metadata: dict


class TraceParseResult(BaseModel):
    summary: TraceSummary
    format: str
    file_size: int


class TraceFilterRequest(BaseModel):
    """Request body for ``POST /trace/filter``.

    Attributes:
        result: A previously parsed trace result (as returned by ``/trace/parse``).
        pids: Optional list of PIDs to keep (exact match).
        process_name: Optional regex pattern to match against process names
            (case-insensitive).
    """

    result: TraceParseResult
    pids: list[int] | None = None
    process_name: str | None = None


def _summary_from_service(s: ServiceTraceSummary) -> TraceSummary:
    return TraceSummary(
        duration_ms=s.duration_ms,
        process_count=s.process_count,
        thread_count=s.thread_count,
        event_count=s.event_count,
        processes=s.processes,
        top_slices=s.top_slices,
        ftrace_events=s.ftrace_events,
        metadata=s.metadata,
    )


def _result_to_service(r: TraceParseResult) -> ServiceTraceParseResult:
    """Convert an API-layer ``TraceParseResult`` back to the service type."""
    from ..services.trace_analyzer import TraceSummary as Svc

    return ServiceTraceParseResult(
        summary=Svc(
            duration_ms=r.summary.duration_ms,
            process_count=r.summary.process_count,
            thread_count=r.summary.thread_count,
            event_count=r.summary.event_count,
            processes=r.summary.processes,
            top_slices=r.summary.top_slices,
            ftrace_events=r.summary.ftrace_events,
            metadata=r.summary.metadata,
        ),
        format=r.format,
    )


@router.post("/parse", response_model=TraceParseResult)
async def parse_trace(file: UploadFile = File(...)):
    """Parse a Perfetto trace file.

    Supports JSON (Chrome Trace / Systrace JSON) and binary Perfetto proto
    (``.pb`` / ``.perfetto-trace``) formats.
    """
    content = await file.read()
    try:
        result = _analyzer.parse_trace(content, file.filename or "trace")
        return TraceParseResult(
            summary=_summary_from_service(result.summary),
            format=result.format,
            file_size=len(content),
        )
    except TraceParseError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/filter", response_model=TraceParseResult)
async def filter_trace(req: TraceFilterRequest):
    """Filter a parsed trace result by process PID(s) and/or process name.

    Pass the ``result`` from a previous ``/trace/parse`` call together with
    filter criteria.  Only matching processes are retained in the returned
    summary; ``process_count`` and ``thread_count`` are updated accordingly.
    """
    if not req.pids and not req.process_name:
        # No filter active – return unchanged (preserve original file_size)
        return req.result

    service_result = _result_to_service(req.result)
    filters = TraceFilters(pids=req.pids, process_name=req.process_name)
    filtered = _analyzer.filter_trace(service_result, filters)

    return TraceParseResult(
        summary=_summary_from_service(filtered.summary),
        format=filtered.format,
        file_size=req.result.file_size,
    )

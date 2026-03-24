"""Perfetto trace analysis endpoints."""
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services.trace_analyzer import TraceAnalyzer, TraceParseError

router = APIRouter()
_analyzer = TraceAnalyzer()


class TraceSummary(BaseModel):
    duration_ms: Optional[float] = None
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


@router.post("/parse", response_model=TraceParseResult)
async def parse_trace(file: UploadFile = File(...)):
    content = await file.read()
    try:
        result = _analyzer.parse_trace(content, file.filename or "trace")
        return TraceParseResult(
            summary=TraceSummary(
                duration_ms=result.summary.duration_ms,
                process_count=result.summary.process_count,
                thread_count=result.summary.thread_count,
                event_count=result.summary.event_count,
                processes=result.summary.processes,
                top_slices=result.summary.top_slices,
                ftrace_events=result.summary.ftrace_events,
                metadata=result.summary.metadata,
            ),
            format=result.format,
            file_size=len(content),
        )
    except TraceParseError as e:
        raise HTTPException(status_code=400, detail=str(e))

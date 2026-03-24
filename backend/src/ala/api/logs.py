"""Log analysis endpoints."""
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services.log_analyzer import LogAnalyzer
from ..services.log_analyzer import LogEntry as ServiceLogEntry
from ..services.log_analyzer import LogFilters as ServiceLogFilters

router = APIRouter()
_analyzer = LogAnalyzer()


class LogEntry(BaseModel):
    line_number: int
    timestamp: Optional[str] = None
    pid: Optional[str] = None
    tid: Optional[str] = None
    level: str
    tag: str
    message: str
    raw_line: str


class ParseResult(BaseModel):
    logs: list[LogEntry]
    total_lines: int
    format_detected: str


class LogFilters(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    keywords: Optional[str] = None
    level: Optional[str] = None
    tag: Optional[str] = None
    pid: Optional[str] = None
    tid: Optional[str] = None
    tag_keyword_relation: str = "AND"


class FilterRequest(BaseModel):
    logs: list[LogEntry]
    filters: LogFilters


class LogStatistics(BaseModel):
    total: int
    by_level: dict[str, int]
    tags: dict[str, int]
    pids: dict[str, int]


def _to_service_entry(e: LogEntry) -> ServiceLogEntry:
    return ServiceLogEntry(
        line_number=e.line_number,
        timestamp=e.timestamp,
        pid=e.pid,
        tid=e.tid,
        level=e.level,
        tag=e.tag,
        message=e.message,
        raw_line=e.raw_line,
    )


def _from_service_entry(e: ServiceLogEntry) -> LogEntry:
    return LogEntry(
        line_number=e.line_number,
        timestamp=e.timestamp,
        pid=e.pid,
        tid=e.tid,
        level=e.level,
        tag=e.tag,
        message=e.message,
        raw_line=e.raw_line,
    )


@router.post("/parse", response_model=ParseResult)
async def parse_log(file: UploadFile = File(...)):
    content = await file.read()
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")
    result = _analyzer.parse_log(text)
    return ParseResult(
        logs=[_from_service_entry(e) for e in result.logs],
        total_lines=result.total_lines,
        format_detected=result.format_detected,
    )


@router.post("/filter", response_model=list[LogEntry])
async def filter_logs(req: FilterRequest):
    service_logs = [_to_service_entry(e) for e in req.logs]
    service_filters = ServiceLogFilters(
        start_time=req.filters.start_time,
        end_time=req.filters.end_time,
        keywords=req.filters.keywords,
        level=req.filters.level,
        tag=req.filters.tag,
        pid=req.filters.pid,
        tid=req.filters.tid,
        tag_keyword_relation=req.filters.tag_keyword_relation,
    )
    filtered = _analyzer.filter_logs(service_logs, service_filters)
    return [_from_service_entry(e) for e in filtered]


@router.post("/statistics", response_model=LogStatistics)
async def get_statistics(logs: list[LogEntry]):
    service_logs = [_to_service_entry(e) for e in logs]
    stats = _analyzer.get_statistics(service_logs)
    return LogStatistics(
        total=stats.total,
        by_level=stats.by_level,
        tags=stats.tags,
        pids=stats.pids,
    )

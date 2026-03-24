"""Log analysis endpoints."""
import json

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.log_analyzer import LogAnalyzer
from ..services.log_analyzer import LogEntry as ServiceLogEntry
from ..services.log_analyzer import LogFilters as ServiceLogFilters

router = APIRouter()
_analyzer = LogAnalyzer()


class LogEntry(BaseModel):
    line_number: int
    timestamp: str | None = None
    pid: str | None = None
    tid: str | None = None
    level: str
    tag: str
    message: str
    raw_line: str
    source_file: str | None = None


class ParseResult(BaseModel):
    logs: list[LogEntry]
    total_lines: int
    format_detected: str


class LogFilters(BaseModel):
    start_time: str | None = None
    end_time: str | None = None
    keywords: str | None = None
    level: str | None = None
    tag: str | None = None
    pid: str | None = None
    tid: str | None = None
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
        source_file=e.source_file,
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
        source_file=e.source_file,
    )


@router.post("/parse", response_model=list[ParseResult])
async def parse_log(files: list[UploadFile] = File(...)):
    """Parse one or more log files.

    Accepts multiple files in a single request.  Each file may be:
    * A plain text log file (``.log``, ``.txt``, …)
    * A gzip-compressed log file (``.gz``)
    * A ZIP archive containing one or more log files (``.zip``)

    Returns a list of ``ParseResult`` – one per extracted text member.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    results: list[ParseResult] = []
    for upload in files:
        content = await upload.read()
        filename = upload.filename or "log"
        try:
            parse_results = _analyzer.parse_log_bytes(content, filename)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        for pr in parse_results:
            results.append(
                ParseResult(
                    logs=[_from_service_entry(e) for e in pr.logs],
                    total_lines=pr.total_lines,
                    format_detected=pr.format_detected,
                )
            )
    return results


@router.post("/parse/stream")
async def parse_log_stream(files: list[UploadFile] = File(...)):
    """Stream-parse one or more log files using NDJSON (newline-delimited JSON).

    Each line of the response body is a JSON-encoded ``LogEntry`` object.
    After the last entry a sentinel line ``{"_done": true, "total": <N>}`` is
    emitted so the client knows the stream is complete.

    This endpoint avoids loading the entire response into memory on either side
    and is the preferred endpoint for large files.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    async def _generate():
        total = 0
        for upload in files:
            data = await upload.read()
            filename = upload.filename or "log"
            try:
                for entry in _analyzer.stream_log_bytes(data, filename):
                    line = _from_service_entry(entry)
                    yield json.dumps(line.model_dump()) + "\n"
                    total += 1
            except ValueError as exc:
                yield json.dumps({"_error": str(exc)}) + "\n"
        yield json.dumps({"_done": True, "total": total}) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
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

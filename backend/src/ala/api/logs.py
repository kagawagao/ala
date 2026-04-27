"""Log analysis endpoints."""

import json
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.log_analyzer import LogAnalyzer, PathTraversalError
from ..services.log_analyzer import LogEntry as ServiceLogEntry
from ..services.log_analyzer import LogFilters as ServiceLogFilters

router = APIRouter()
_analyzer = LogAnalyzer()
logger = logging.getLogger(__name__)


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


class LocalPathRequest(BaseModel):
    """Request body for POST /api/logs/parse-local (FEAT-LAZY-LOG)."""
    path: str


class LocalPathResponse(BaseModel):
    """Response for POST /api/logs/parse-local."""
    session_file: str
    line_count: int
    size_bytes: int
    format_detected: str
    is_gzip: bool
    is_zip: bool


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


@router.post("/parse-local", response_model=LocalPathResponse)
async def parse_local_path(req: LocalPathRequest):
    """Register a local log file for lazy analysis (FEAT-LAZY-LOG).

    Validates the path, scans metadata, and sets the file as the active
    session data source. No log entries are loaded into memory.
    """
    try:
        validated = LogAnalyzer._validate_path(req.path)
    except PathTraversalError as e:
        raise HTTPException(
            status_code=403,
            detail=f"Path traversal rejected: {e}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    ref = _analyzer.scan_file_meta(validated)
    return LocalPathResponse(
        session_file=ref.path,
        line_count=ref.line_count,
        size_bytes=ref.size_bytes,
        format_detected=ref.format_detected,
        is_gzip=ref.is_gzip,
        is_zip=ref.is_zip,
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
        logger.debug("Parsing log file — name=%s size=%d", filename, len(content))
        try:
            parse_results = _analyzer.parse_log_bytes(content, filename)
        except ValueError as exc:
            logger.error("Failed to parse log file %r: %s", filename, exc)
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
            logger.debug("Stream-parsing log file — name=%s size=%d", filename, len(data))
            try:
                for entry in _analyzer.stream_log_bytes(data, filename):
                    line = _from_service_entry(entry)
                    yield json.dumps(line.model_dump()) + "\n"
                    total += 1
            except ValueError as exc:
                logger.error("Failed to stream-parse log file %r: %s", filename, exc)
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


class DirectoryRequest(BaseModel):
    path: str


class DirectoryFileInfo(BaseModel):
    name: str
    path: str  # relative path from the scanned root directory
    size: int
    is_log: bool


class DirectoryListResponse(BaseModel):
    files: list[DirectoryFileInfo]
    has_subdirectories: bool
    total_files: int
    max_depth: int


class DirectorySelectedRequest(BaseModel):
    path: str  # root directory
    selected_files: list[str]  # relative file paths to parse


LOG_EXTENSIONS = {".log", ".txt", ".logcat", ".gz", ".zip"}

MAX_SCAN_DEPTH = 5
MAX_SCAN_FILES = 500


def _scan_directory(
    root: str, max_depth: int = MAX_SCAN_DEPTH
) -> tuple[list[DirectoryFileInfo], bool, int]:
    """Recursively scan a directory for log files.

    Returns (files, has_subdirectories, max_depth_reached).
    """
    import os

    files: list[DirectoryFileInfo] = []
    has_subdirs = False
    deepest = 0

    def _walk(current: str, depth: int) -> None:
        nonlocal has_subdirs, deepest
        if depth > max_depth:
            return
        if depth > deepest:
            deepest = depth
        try:
            entries = sorted(os.scandir(current), key=lambda e: e.name)
        except PermissionError:
            return
        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir(follow_symlinks=False):
                has_subdirs = True
                _walk(entry.path, depth + 1)
            elif entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                is_log = ext in LOG_EXTENSIONS or not ext
                if is_log and len(files) < MAX_SCAN_FILES:
                    rel = os.path.relpath(entry.path, root)
                    stat = entry.stat()
                    files.append(
                        DirectoryFileInfo(
                            name=entry.name,
                            path=rel,
                            size=stat.st_size,
                            is_log=True,
                        )
                    )

    _walk(root, 0)
    return files, has_subdirs, deepest


@router.post("/directory/list", response_model=DirectoryListResponse)
async def list_directory_files(req: DirectoryRequest):
    """List log-like files in a local directory (recursive)."""
    import os

    dir_path = req.path
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=400, detail=f"Directory not found: {dir_path}")

    try:
        files, has_subdirs, depth = _scan_directory(dir_path)
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {dir_path}")

    return DirectoryListResponse(
        files=files,
        has_subdirectories=has_subdirs,
        total_files=len(files),
        max_depth=depth,
    )


@router.post("/directory/parse/stream")
async def parse_directory_stream(req: DirectoryRequest):
    """Stream-parse all log files in a local directory using NDJSON."""
    import os

    dir_path = req.path
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=400, detail=f"Directory not found: {dir_path}")

    async def _generate():
        total = 0
        try:
            for entry in sorted(os.scandir(dir_path), key=lambda e: e.name):
                if not entry.is_file():
                    continue
                ext = os.path.splitext(entry.name)[1].lower()
                if ext not in LOG_EXTENSIONS and ext:
                    continue
                try:
                    with open(entry.path, "rb") as f:
                        data = f.read()
                    for log_entry in _analyzer.stream_log_bytes(data, entry.name):
                        line = _from_service_entry(log_entry)
                        yield json.dumps(line.model_dump()) + "\n"
                        total += 1
                except (ValueError, OSError):
                    yield json.dumps({"_error": f"Failed to parse {entry.name}"}) + "\n"
        except PermissionError:
            yield json.dumps({"_error": f"Permission denied: {dir_path}"}) + "\n"
        yield json.dumps({"_done": True, "total": total}) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


@router.post("/directory/parse/selected/stream")
async def parse_selected_files_stream(req: DirectorySelectedRequest):
    """Stream-parse only user-selected log files from a directory."""
    import os

    dir_path = req.path
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=400, detail=f"Directory not found: {dir_path}")

    async def _generate():
        total = 0
        for rel_path in sorted(req.selected_files):
            full_path = os.path.normpath(os.path.join(dir_path, rel_path))
            # Prevent path traversal: resolve symlinks and compare real paths
            real_dir = os.path.realpath(dir_path)
            real_full = os.path.realpath(full_path)
            if os.path.commonpath([real_full, real_dir]) != real_dir:
                yield json.dumps({"_error": f"Invalid path: {rel_path}"}) + "\n"
                continue
            if not os.path.isfile(full_path):
                yield json.dumps({"_error": f"File not found: {rel_path}"}) + "\n"
                continue
            try:
                with open(full_path, "rb") as f:
                    data = f.read()
                source = rel_path
                for log_entry in _analyzer.stream_log_bytes(data, source):
                    line = _from_service_entry(log_entry)
                    yield json.dumps(line.model_dump()) + "\n"
                    total += 1
            except (ValueError, OSError):
                yield json.dumps({"_error": f"Failed to parse {rel_path}"}) + "\n"
        yield json.dumps({"_done": True, "total": total}) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )

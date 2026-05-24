"""Log analysis endpoints."""

import json
import logging
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
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
    truncated: bool = False


class AutoPathResponse(BaseModel):
    """Response for POST /api/logs/auto-path — discriminated by type."""

    type: str  # "file" or "directory"
    # File-specific fields (when type="file")
    session_file: str | None = None
    line_count: int | None = None
    size_bytes: int | None = None
    format_detected: str | None = None
    is_gzip: bool | None = None
    is_zip: bool | None = None
    truncated: bool | None = None  # True when scan stopped early (file only)
    # Directory-specific fields (when type="directory")
    files: list["DirectoryFileInfo"] | None = None
    has_subdirectories: bool | None = None
    total_files: int | None = None
    max_depth: int | None = None


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
            status_code=400,
            detail=f"Path traversal rejected: {e}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        ref = _analyzer.scan_file_meta(validated)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return LocalPathResponse(
        session_file=ref.path,
        line_count=ref.line_count,
        size_bytes=ref.size_bytes,
        format_detected=ref.format_detected,
        is_gzip=ref.is_gzip,
        is_zip=ref.is_zip,
        truncated=ref.truncated,
    )


@router.post("/auto-path", response_model=AutoPathResponse)
async def auto_path(req: LocalPathRequest):
    """Auto-detect path type — file or directory — and route accordingly.

    - File: returns file metadata (session_file, line_count, …) for lazy log analysis.
    - Directory: scans and returns log-like files list.
    """
    import os

    path = req.path

    # ── File path ─────────────────────────────────────────────────────────
    if os.path.isfile(path):
        try:
            validated = LogAnalyzer._validate_path(path)
        except PathTraversalError as e:
            raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            ref = _analyzer.scan_file_meta(validated, max_scan_lines=50000)
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except PathTraversalError as e:
            raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
        except (ValueError, OSError) as e:
            raise HTTPException(status_code=400, detail=str(e))

        return AutoPathResponse(
            type="file",
            session_file=ref.path,
            line_count=ref.line_count,
            size_bytes=ref.size_bytes,
            format_detected=ref.format_detected,
            is_gzip=ref.is_gzip,
            is_zip=ref.is_zip,
            truncated=ref.truncated,
        )

    # ── Directory path ────────────────────────────────────────────────────
    if os.path.isdir(path):
        try:
            files, has_subdirs, depth = _scan_directory(path)
        except PermissionError:
            raise HTTPException(status_code=403, detail=f"Permission denied: {path}")

        return AutoPathResponse(
            type="directory",
            files=files,
            has_subdirectories=has_subdirs,
            total_files=len(files),
            max_depth=depth,
        )

    raise HTTPException(status_code=404, detail=f"Path not found or unsupported: {path}")


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

    try:
        dir_path = LogAnalyzer._validate_path(req.path, allow_directory=True)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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

    try:
        dir_path = LogAnalyzer._validate_path(req.path, allow_directory=True)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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

    try:
        dir_path = LogAnalyzer._validate_path(req.path, allow_directory=True)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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


class FileStreamRequest(BaseModel):
    """Request body for POST /api/logs/file/parse/stream."""

    path: str


@router.post("/file/parse/stream")
async def parse_file_stream(req: FileStreamRequest):
    """Stream-parse a single local log file using NDJSON.

    Uses ``LogAnalyzer.stream_file()`` to yield entries one at a time
    without loading the entire file into memory.  Handles .gz, .zip,
    and plain text files.
    """
    try:
        validated = LogAnalyzer._validate_path(req.path)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def _generate():
        total = 0
        try:
            for entry in _analyzer.stream_file(validated):
                line = _from_service_entry(entry)
                yield json.dumps(line.model_dump()) + "\n"
                total += 1
        except (ValueError, OSError) as exc:
            yield json.dumps({"_error": str(exc)}) + "\n"
        yield json.dumps({"_done": True, "total": total}) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Lazy Log Streaming: filter helpers, upload-to-temp, temp cleanup
# ---------------------------------------------------------------------------


@dataclass
class CompiledFilters:
    """Pre-compiled filter matchers for efficient per-line evaluation."""

    start_time: str | None = None
    end_time: str | None = None
    level: str | None = None
    pid: str | None = None
    tid: str | None = None
    kw_regex: re.Pattern | None = None
    kw_fallback: str | None = None
    tag_regex: re.Pattern | None = None
    tag_fallback: str | None = None
    has_kw: bool = False
    has_tag: bool = False
    use_or: bool = False


def _precompile_filters(filters: LogFilters) -> CompiledFilters:
    """Pre-compile all filter conditions once, before line-by-line scanning."""
    kw_regex = None
    kw_fallback = None
    if filters.keywords and filters.keywords.strip():
        try:
            kw_regex = re.compile(filters.keywords, re.IGNORECASE)
        except re.error:
            kw_fallback = filters.keywords.lower()

    tag_regex = None
    tag_fallback = None
    if filters.tag and filters.tag.strip():
        try:
            tag_regex = re.compile(filters.tag, re.IGNORECASE)
        except re.error:
            tag_fallback = filters.tag.lower()

    return CompiledFilters(
        start_time=filters.start_time.strip() if filters.start_time and filters.start_time.strip() else None,
        end_time=filters.end_time.strip() if filters.end_time and filters.end_time.strip() else None,
        level=filters.level.strip()
        if filters.level and filters.level.strip() and filters.level.strip() != "ALL"
        else None,
        pid=filters.pid.strip() if filters.pid and filters.pid.strip() else None,
        tid=filters.tid.strip() if filters.tid and filters.tid.strip() else None,
        kw_regex=kw_regex,
        kw_fallback=kw_fallback,
        tag_regex=tag_regex,
        tag_fallback=tag_fallback,
        has_kw=kw_regex is not None or kw_fallback is not None,
        has_tag=tag_regex is not None or tag_fallback is not None,
        use_or=filters.tag_keyword_relation == "OR",
    )


def _line_matches(entry: ServiceLogEntry, cf: CompiledFilters) -> bool:
    """Check if a single LogEntry matches all compiled filter conditions."""
    if cf.start_time or cf.end_time:
        if not entry.timestamp:
            return False
        if cf.start_time and entry.timestamp < cf.start_time:
            return False
        if cf.end_time and entry.timestamp > cf.end_time:
            return False

    if cf.level and entry.level != cf.level:
        return False

    if cf.pid and entry.pid != cf.pid:
        return False

    if cf.tid and entry.tid != cf.tid:
        return False

    if cf.has_kw or cf.has_tag:
        kw_match = True
        if cf.has_kw:
            if cf.kw_regex is not None:
                kw_match = bool(
                    cf.kw_regex.search(entry.message) or cf.kw_regex.search(entry.raw_line)
                )
            elif cf.kw_fallback is not None:
                fb = cf.kw_fallback
                kw_match = fb in entry.message.lower() or fb in entry.raw_line.lower()
            else:
                kw_match = True

        tag_match = True
        if cf.has_tag:
            if cf.tag_regex is not None:
                tag_match = bool(cf.tag_regex.search(entry.tag))
            elif cf.tag_fallback is not None:
                tag_match = cf.tag_fallback in entry.tag.lower()
            else:
                tag_match = True

        if cf.use_or and cf.has_kw and cf.has_tag:
            if not (kw_match or tag_match):
                return False
        else:
            if not (kw_match and tag_match):
                return False

    return True


def _accumulate_stats(
    entry: ServiceLogEntry,
    by_level: dict[str, int],
    tags: dict[str, int],
    pids: dict[str, int],
) -> None:
    """Accumulate statistics for a matching entry (inline, no intermediate list)."""
    by_level[entry.level] = by_level.get(entry.level, 0) + 1
    tags[entry.tag] = tags.get(entry.tag, 0) + 1
    if entry.pid:
        pids[entry.pid] = pids.get(entry.pid, 0) + 1


def _get_temp_dir() -> Path:
    """Return the temp log storage directory, creating it if needed."""
    env_dir = os.environ.get("ALA_TEMP_DIR")
    if env_dir:
        temp_dir = Path(env_dir)
    else:
        temp_dir = Path.home() / ".ala" / "temp_logs"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


# ---- T1: POST /logs/filter/stream ----


class FileFilterRequest(BaseModel):
    """Request for POST /logs/filter/stream."""

    path: str
    filters: LogFilters


@router.post("/filter/stream")
async def filter_log_stream(req: FileFilterRequest, request: Request):
    """Stream-parse a log file, apply filters line-by-line, and stream only matching entries."""
    try:
        validated = LogAnalyzer._validate_path(req.path)
    except PathTraversalError as e:
        raise HTTPException(status_code=400, detail=f"Path traversal rejected: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    compiled = _precompile_filters(req.filters)

    async def _generate():
        matched = 0
        scanned = 0
        by_level: dict[str, int] = {}
        tags: dict[str, int] = {}
        pids: dict[str, int] = {}

        try:
            fmt = _analyzer.detect_log_format("")
            sample_lines: list[str] = []
            fh = _analyzer._open_log_path(validated)
            try:
                for raw_line in fh:
                    stripped = raw_line.strip()
                    if stripped and len(sample_lines) < 10:
                        sample_lines.append(stripped)
                    if len(sample_lines) >= 10:
                        break
            finally:
                if hasattr(fh, "close"):
                    fh.close()

            if sample_lines:
                fmt = _analyzer.detect_log_format("\n".join(sample_lines))

            lower_path = validated.lower()
            if lower_path.endswith(".zip") and not lower_path.endswith(".tar.gz"):
                import io as io_mod
                import zipfile as zf_mod

                with zf_mod.ZipFile(validated, "r") as zf:
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        if info.filename.lower().endswith("/"):
                            continue
                        source = info.filename
                        with zf.open(info) as member_fh:
                            wrapper = io_mod.TextIOWrapper(
                                member_fh, encoding="utf-8", errors="replace"
                            )
                            line_num = 0
                            for raw_line in wrapper:
                                line_num += 1
                                scanned += 1
                                if scanned % 100 == 0 and await request.is_disconnected():
                                    return
                                raw = raw_line.rstrip("\n\r")
                                if not raw.strip():
                                    continue
                                entry = _analyzer._parse_single_line(raw, line_num, fmt, source)
                                if _line_matches(entry, compiled):
                                    matched += 1
                                    _accumulate_stats(entry, by_level, tags, pids)
                                    line = _from_service_entry(entry)
                                    yield json.dumps(line.model_dump()) + "\n"
            else:
                source = Path(validated).name
                fh = _analyzer._open_log_path(validated)
                try:
                    line_num = 0
                    for raw_line in fh:
                        line_num += 1
                        scanned += 1
                        if scanned % 100 == 0 and await request.is_disconnected():
                            return
                        raw = raw_line.rstrip("\n\r")
                        if not raw.strip():
                            continue
                        entry = _analyzer._parse_single_line(raw, line_num, fmt, source)
                        if _line_matches(entry, compiled):
                            matched += 1
                            _accumulate_stats(entry, by_level, tags, pids)
                            line = _from_service_entry(entry)
                            yield json.dumps(line.model_dump()) + "\n"
                finally:
                    if hasattr(fh, "close"):
                        fh.close()

        except (ValueError, OSError) as exc:
            yield json.dumps({"_error": str(exc)}) + "\n"
            return

        yield json.dumps(
            {
                "_done": True,
                "matched": matched,
                "scanned": scanned,
                "stats": {
                    "total": matched,
                    "by_level": by_level,
                    "tags": tags,
                    "pids": pids,
                },
            }
        ) + "\n"

    return StreamingResponse(
        _generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


# ---- T3: POST /logs/upload/temp ----


class TempFileInfo(BaseModel):
    original_name: str
    saved_path: str
    size_bytes: int
    format_detected: str


class TempUploadResponse(BaseModel):
    session_uuid: str
    files: list[TempFileInfo]


@router.post("/upload/temp", response_model=TempUploadResponse)
async def upload_to_temp(files: list[UploadFile] = File(...)):
    """Save uploaded log files to a temp directory and return their paths."""
    session_uuid = str(uuid.uuid4())
    temp_root = _get_temp_dir()
    session_dir = temp_root / session_uuid
    session_dir.mkdir(parents=True, exist_ok=True)

    saved: list[TempFileInfo] = []
    for upload in files:
        safe_name = Path(upload.filename or "log").name
        dest_path = session_dir / safe_name

        content = await upload.read()
        with open(dest_path, "wb") as f:
            f.write(content)

        fmt = "unknown"
        try:
            with open(dest_path, "rb") as f:
                sample = f.read(4096)
            text_sample = sample.decode("utf-8", errors="replace")
            fmt = _analyzer.detect_log_format(text_sample).value
        except Exception:
            pass

        saved.append(
            TempFileInfo(
                original_name=safe_name,
                saved_path=str(dest_path),
                size_bytes=len(content),
                format_detected=fmt,
            )
        )

    return TempUploadResponse(session_uuid=session_uuid, files=saved)


# ---- T6: Temp cleanup ----


class TempStatusResponse(BaseModel):
    dir_path: str
    session_count: int
    total_size_bytes: int


@router.get("/temp/status", response_model=TempStatusResponse)
async def temp_status():
    """Return temp directory info: path, session count, total size."""
    temp_dir = _get_temp_dir()
    count = 0
    total = 0
    if temp_dir.exists():
        for entry in temp_dir.iterdir():
            if entry.is_dir():
                count += 1
                try:
                    for f in entry.rglob("*"):
                        if f.is_file():
                            total += f.stat().st_size
                except OSError:
                    pass
    return TempStatusResponse(
        dir_path=str(temp_dir),
        session_count=count,
        total_size_bytes=total,
    )


@router.post("/temp/cleanup")
async def temp_cleanup():
    """Delete temp session directories older than the configured max age (default 24h)."""
    max_age_hours = int(os.environ.get("ALA_TEMP_MAX_AGE_HOURS", "24"))
    temp_dir = _get_temp_dir()
    cutoff = time.time() - (max_age_hours * 3600)
    cleaned = 0

    if not temp_dir.exists():
        return {"cleaned": 0, "message": "Temp directory does not exist"}

    for entry in temp_dir.iterdir():
        if entry.is_dir():
            try:
                mtime = entry.stat().st_mtime
                if mtime < cutoff:
                    shutil.rmtree(entry)
                    cleaned += 1
                    logger.info("Cleaned up old temp session: %s", entry.name)
            except OSError:
                logger.warning("Failed to clean up temp dir: %s", entry)

    return {"cleaned": cleaned, "message": f"Cleaned {cleaned} old session(s)"}

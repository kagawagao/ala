"""PCAP network capture analysis endpoints."""

import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.pcap_analyzer import (
    PcapAnalyzer,
    PcapEntry,
    PcapFilters,
    PcapStatistics,
)

router = APIRouter()
_analyzer = PcapAnalyzer()
logger = logging.getLogger(__name__)

# ── Temporary storage for uploaded PCAP files ──────────────────────────


def _get_pcap_temp_dir() -> Path:
    """Return (and create if needed) the temp directory for PCAP uploads."""
    env_dir = os.getenv("ALA_PCAP_TEMP_DIR")
    if env_dir:
        temp_dir = Path(env_dir)
    else:
        temp_dir = Path.home() / ".ala" / "temp_pcap"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


# ── Shared models ──────────────────────────────────────────────────────


class PcapEntryModel(BaseModel):
    """API model for a single PCAP packet entry."""

    packet_number: int
    timestamp: str | None
    protocol: str
    src_ip: str
    dst_ip: str
    src_port: int | None
    dst_port: int | None
    length: int
    tcp_flags: str | None
    info: str
    raw_summary: str
    source_file: str | None = None


class PcapFiltersModel(BaseModel):
    """API model for PCAP filter criteria."""

    start_time: str | None = None
    end_time: str | None = None
    protocol: str | None = None
    src_ip: str | None = None
    dst_ip: str | None = None
    src_port: int | None = None
    dst_port: int | None = None
    tcp_flags: str | None = None
    keywords: str | None = None


class PcapStatisticsModel(BaseModel):
    """API model for PCAP statistics."""

    total: int
    by_protocol: dict[str, int]
    unique_ips: int
    unique_connections: int
    duration_seconds: float | None


class PcapFilterStreamRequest(BaseModel):
    """Request for POST /pcap/filter/stream — lazy on-disk filtering."""

    path: str
    filters: PcapFiltersModel | None = None


class PcapTempFileInfo(BaseModel):
    """Metadata about a single uploaded temp PCAP file."""

    original_name: str
    saved_path: str
    size_bytes: int
    format_detected: str


class PcapTempUploadResponse(BaseModel):
    """Response for POST /pcap/upload/temp."""

    session_uuid: str
    files: list[PcapTempFileInfo]


class PcapTempStatusResponse(BaseModel):
    """Response for GET /pcap/temp/status."""

    dir_path: str
    session_count: int
    total_size_bytes: int


# ── Converter helpers ──────────────────────────────────────────────────


def _entry_to_model(entry: PcapEntry) -> PcapEntryModel:
    """Convert service PcapEntry to API model."""
    return PcapEntryModel(
        packet_number=entry.packet_number,
        timestamp=entry.timestamp,
        protocol=entry.protocol,
        src_ip=entry.src_ip,
        dst_ip=entry.dst_ip,
        src_port=entry.src_port,
        dst_port=entry.dst_port,
        length=entry.length,
        tcp_flags=entry.tcp_flags,
        info=entry.info,
        raw_summary=entry.raw_summary,
        source_file=entry.source_file,
    )


def _model_to_entry(model: PcapEntryModel) -> PcapEntry:
    """Convert API model to service PcapEntry."""
    return PcapEntry(
        packet_number=model.packet_number,
        timestamp=model.timestamp,
        protocol=model.protocol,
        src_ip=model.src_ip,
        dst_ip=model.dst_ip,
        src_port=model.src_port,
        dst_port=model.dst_port,
        length=model.length,
        tcp_flags=model.tcp_flags,
        info=model.info,
        raw_summary=model.raw_summary,
        source_file=model.source_file,
    )


def _filters_to_service(model: PcapFiltersModel) -> PcapFilters:
    """Convert API filter model to service filters."""
    return PcapFilters(
        start_time=model.start_time,
        end_time=model.end_time,
        protocol=model.protocol,
        src_ip=model.src_ip,
        dst_ip=model.dst_ip,
        src_port=model.src_port,
        dst_port=model.dst_port,
        tcp_flags=model.tcp_flags,
        keywords=model.keywords,
    )


def _stats_to_model(stats: PcapStatistics) -> PcapStatisticsModel:
    """Convert service statistics to API model."""
    return PcapStatisticsModel(
        total=stats.total,
        by_protocol=stats.by_protocol,
        unique_ips=stats.unique_ips,
        unique_connections=stats.unique_connections,
        duration_seconds=stats.duration_seconds,
    )


# ── Lazy endpoints (file-based, stream from disk) ──────────────────────


@router.post("/upload/temp", response_model=PcapTempUploadResponse)
async def upload_pcap_to_temp(files: list[UploadFile] = File(...)):
    """Save uploaded PCAP files to a temp directory and return their paths.

    Does NOT parse the full file — only validates it's PCAP and detects format.
    The caller stores the saved_path and later calls /filter/stream for lazy access.
    """
    session_uuid = str(uuid.uuid4())
    temp_root = _get_pcap_temp_dir()
    session_dir = temp_root / session_uuid
    session_dir.mkdir(parents=True, exist_ok=True)

    saved: list[PcapTempFileInfo] = []
    for upload in files:
        safe_name = Path(upload.filename or "capture.pcap").name
        dest_path = session_dir / safe_name
        counter = 1
        stem, ext = os.path.splitext(safe_name)
        while dest_path.exists():
            dest_path = session_dir / f"{stem}_{counter}{ext}"
            counter += 1

        total_bytes = 0
        with open(dest_path, "wb") as f:
            while chunk := await upload.read(64 * 1024):
                f.write(chunk)
                total_bytes += len(chunk)

        fmt = "unknown"
        try:
            with open(dest_path, "rb") as f:
                magic = f.read(4)
            if _analyzer._is_pcap_data(magic):
                fmt = "pcapng" if magic[:4] == b"\x0a\x0d\x0d\x0a" else "pcap"
        except OSError:
            pass

        saved.append(
            PcapTempFileInfo(
                original_name=safe_name,
                saved_path=str(dest_path),
                size_bytes=total_bytes,
                format_detected=fmt,
            )
        )

    logger.debug(
        "PCAP upload/temp — session=%s files=%d bytes=%d",
        session_uuid,
        len(saved),
        sum(f.size_bytes for f in saved),
    )
    return PcapTempUploadResponse(session_uuid=session_uuid, files=saved)


@router.post("/filter/stream")
async def filter_pcap_stream(req: PcapFilterStreamRequest, request: Request):
    """Stream-filter a PCAP file on disk, returning only matching packets as NDJSON.

    Opens the saved PCAP file, parses packets one at a time, applies
    server-side filters, and streams matching entries as NDJSON lines.
    A sentinel `{"_done": true, "matched": N, "scanned": M, "stats": {...}}`
    is sent at the end.

    This is the lazy counterpart to /parse/stream — no entries are ever
    held in memory on the server side.
    """
    import os as _os

    # Path validation (mirrors log_analyzer._validate_path)
    path = req.path
    try:
        real = _os.path.realpath(path)
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {e}")

    temp_root = str(_get_pcap_temp_dir().resolve())
    if not real.startswith(temp_root + _os.sep):
        raise HTTPException(status_code=400, detail="Path is outside allowed temp directory")

    if not _os.path.isfile(real):
        raise HTTPException(status_code=404, detail=f"PCAP file not found: {real}")

    filters = _filters_to_service(req.filters) if req.filters else None

    async def generate():
        matched = 0
        scanned = 0
        stats_entries: list[PcapEntry] = []

        try:
            for entry in _analyzer.stream_filter_from_path(real, filters):
                scanned += 1
                if await request.is_disconnected():
                    return

                matched += 1
                stats_entries.append(entry)
                yield _entry_to_model(entry).model_dump_json() + "\n"

            # Compute and send stats sentinel
            stats = _analyzer.compute_statistics(stats_entries)
            yield (
                json.dumps(
                    {
                        "_done": True,
                        "matched": matched,
                        "scanned": scanned,
                        "stats": _stats_to_model(stats).model_dump(),
                    }
                )
                + "\n"
            )

        except FileNotFoundError as e:
            yield json.dumps({"_error": str(e)}) + "\n"
        except ValueError as e:
            logger.error("PCAP filter stream error: %s", e)
            yield json.dumps({"_error": str(e)}) + "\n"
        except Exception as e:
            logger.exception("Unexpected error in PCAP filter stream")
            yield json.dumps({"_error": f"Internal server error: {e}"}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/temp/status", response_model=PcapTempStatusResponse)
async def pcap_temp_status():
    """Return pcap temp directory info: path, session count, total size."""
    temp_dir = _get_pcap_temp_dir()
    count = 0
    total = 0
    if temp_dir.exists():
        for entry in temp_dir.iterdir():
            if entry.is_dir():
                count += 1
                for f in entry.iterdir():
                    if f.is_file():
                        total += f.stat().st_size
    return PcapTempStatusResponse(
        dir_path=str(temp_dir),
        session_count=count,
        total_size_bytes=total,
    )


@router.post("/temp/cleanup")
async def pcap_temp_cleanup():
    """Remove all files from the pcap temp directory."""
    import shutil

    temp_dir = _get_pcap_temp_dir()
    removed = 0
    if temp_dir.exists():
        for entry in temp_dir.iterdir():
            try:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
                removed += 1
            except OSError as e:
                logger.warning("Failed to remove pcap temp entry %s: %s", entry, e)

    logger.info("PCAP temp cleanup — removed %d sessions", removed)
    return {"removed": removed}

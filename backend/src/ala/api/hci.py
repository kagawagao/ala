"""Bluetooth HCI (BTSnoop) log analysis endpoints."""

import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.hci_analyzer import (
    HciAnalyzer,
    HciEntry,
    HciFilters,
    HciStatistics,
)

router = APIRouter()
_analyzer = HciAnalyzer()
logger = logging.getLogger(__name__)

# ── Temporary storage for uploaded HCI files ──────────────────────────


def _get_hci_temp_dir() -> Path:
    """Return (and create if needed) the temp directory for HCI uploads."""
    env_dir = os.getenv("ALA_HCI_TEMP_DIR")
    if env_dir:
        temp_dir = Path(env_dir)
    else:
        temp_dir = Path.home() / ".ala" / "temp_hci"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


# ── Shared models ──────────────────────────────────────────────────────


class HciEntryModel(BaseModel):
    """API model for a single HCI packet entry."""

    packet_number: int
    timestamp: str | None
    direction: str
    hci_type: str
    opcode: int | None = None
    opcode_name: str | None = None
    event_code: int | None = None
    event_name: str | None = None
    data_length: int
    raw_summary: str
    source_file: str | None = None


class HciFiltersModel(BaseModel):
    """API model for HCI filter criteria."""

    start_time: str | None = None
    end_time: str | None = None
    direction: str | None = None
    hci_type: str | None = None
    opcode: int | None = None
    opcode_name: str | None = None
    event_code: int | None = None
    event_name: str | None = None
    keywords: str | None = None


class HciStatisticsModel(BaseModel):
    """API model for HCI statistics."""

    total: int
    by_direction: dict[str, int]
    by_type: dict[str, int]
    duration_seconds: float | None
    unique_opcodes: int


class HciFilterStreamRequest(BaseModel):
    """Request for POST /hci/filter/stream — lazy on-disk filtering."""

    path: str
    filters: HciFiltersModel | None = None


class HciTempFileInfo(BaseModel):
    """Metadata about a single uploaded temp HCI file."""

    original_name: str
    saved_path: str
    size_bytes: int
    format_detected: str


class HciTempUploadResponse(BaseModel):
    """Response for POST /hci/upload/temp."""

    session_uuid: str
    files: list[HciTempFileInfo]


class HciTempStatusResponse(BaseModel):
    """Response for GET /hci/temp/status."""

    dir_path: str
    session_count: int
    total_size_bytes: int


# ── Converter helpers ──────────────────────────────────────────────────


def _entry_to_model(entry: HciEntry) -> HciEntryModel:
    """Convert service HciEntry to API model."""
    return HciEntryModel(
        packet_number=entry.packet_number,
        timestamp=entry.timestamp,
        direction=entry.direction,
        hci_type=entry.hci_type,
        opcode=entry.opcode,
        opcode_name=entry.opcode_name,
        event_code=entry.event_code,
        event_name=entry.event_name,
        data_length=entry.data_length,
        raw_summary=entry.raw_summary,
        source_file=entry.source_file,
    )


def _model_to_entry(model: HciEntryModel) -> HciEntry:
    """Convert API model to service HciEntry."""
    return HciEntry(
        packet_number=model.packet_number,
        timestamp=model.timestamp,
        direction=model.direction,
        hci_type=model.hci_type,
        opcode=model.opcode,
        opcode_name=model.opcode_name,
        event_code=model.event_code,
        event_name=model.event_name,
        data_length=model.data_length,
        raw_summary=model.raw_summary,
        source_file=model.source_file,
    )


def _filters_to_service(model: HciFiltersModel) -> HciFilters:
    """Convert API filter model to service filters."""
    return HciFilters(
        start_time=model.start_time,
        end_time=model.end_time,
        direction=model.direction,
        hci_type=model.hci_type,
        opcode=model.opcode,
        opcode_name=model.opcode_name,
        event_code=model.event_code,
        event_name=model.event_name,
        keywords=model.keywords,
    )


def _stats_to_model(stats: HciStatistics) -> HciStatisticsModel:
    """Convert service statistics to API model."""
    return HciStatisticsModel(
        total=stats.total,
        by_direction=stats.by_direction,
        by_type=stats.by_type,
        duration_seconds=stats.duration_seconds,
        unique_opcodes=stats.unique_opcodes,
    )


# ── Lazy endpoints (file-based, stream from disk) ──────────────────────


@router.post("/upload/temp", response_model=HciTempUploadResponse)
async def upload_hci_to_temp(files: list[UploadFile] = File(...)):
    """Save uploaded HCI files to a temp directory and return their paths.

    Does NOT parse the full file — only validates it's BTSnoop and detects format.
    The caller stores the saved_path and later calls /filter/stream for lazy access.
    """
    session_uuid = str(uuid.uuid4())
    temp_root = _get_hci_temp_dir()
    session_dir = temp_root / session_uuid
    session_dir.mkdir(parents=True, exist_ok=True)

    saved: list[HciTempFileInfo] = []
    for upload in files:
        safe_name = Path(upload.filename or "btsnoop_hci.log").name
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
                magic = f.read(8)
            if _analyzer._is_hci_data(magic):
                fmt = "btsnoop"
        except OSError:
            pass

        saved.append(
            HciTempFileInfo(
                original_name=safe_name,
                saved_path=str(dest_path),
                size_bytes=total_bytes,
                format_detected=fmt,
            )
        )

    logger.debug(
        "HCI upload/temp — session=%s files=%d bytes=%d",
        session_uuid,
        len(saved),
        sum(f.size_bytes for f in saved),
    )
    return HciTempUploadResponse(session_uuid=session_uuid, files=saved)


@router.post("/filter/stream")
async def filter_hci_stream(req: HciFilterStreamRequest, request: Request):
    """Stream-filter an HCI file on disk, returning only matching packets as NDJSON.

    Opens the saved HCI file, parses packets one at a time, applies
    server-side filters, and streams matching entries as NDJSON lines.
    A sentinel `{"_done": true, "matched": N, "scanned": M, "stats": {...}}`
    is sent at the end.
    """
    import os as _os

    path = req.path
    try:
        real = _os.path.realpath(path)
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {e}")

    temp_root = str(_get_hci_temp_dir().resolve())
    if not real.startswith(temp_root + _os.sep):
        raise HTTPException(status_code=400, detail="Path is outside allowed temp directory")

    if not _os.path.isfile(real):
        raise HTTPException(status_code=404, detail=f"HCI file not found: {real}")

    filters = _filters_to_service(req.filters) if req.filters else None

    async def generate():
        matched = 0
        scanned = 0
        stats_entries: list[HciEntry] = []

        try:
            for entry in _analyzer.stream_filter_from_path(real, filters):
                scanned += 1
                if await request.is_disconnected():
                    return

                matched += 1
                stats_entries.append(entry)
                yield _entry_to_model(entry).model_dump_json() + "\n"

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
            logger.error("HCI filter stream error: %s", e)
            yield json.dumps({"_error": str(e)}) + "\n"
        except Exception as e:
            logger.exception("Unexpected error in HCI filter stream")
            yield json.dumps({"_error": f"Internal server error: {e}"}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/temp/status", response_model=HciTempStatusResponse)
async def hci_temp_status():
    """Return HCI temp directory info: path, session count, total size."""
    temp_dir = _get_hci_temp_dir()
    count = 0
    total = 0
    if temp_dir.exists():
        for entry in temp_dir.iterdir():
            if entry.is_dir():
                count += 1
                for f in entry.iterdir():
                    if f.is_file():
                        total += f.stat().st_size
    return HciTempStatusResponse(
        dir_path=str(temp_dir),
        session_count=count,
        total_size_bytes=total,
    )


@router.post("/temp/cleanup")
async def hci_temp_cleanup():
    """Remove all files from the HCI temp directory."""
    import shutil

    temp_dir = _get_hci_temp_dir()
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
                logger.warning("Failed to remove HCI temp entry %s: %s", entry, e)

    logger.info("HCI temp cleanup — removed %d sessions", removed)
    return {"removed": removed}

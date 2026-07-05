"""Unified file upload endpoint — backend detects type, frontend routes."""

import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..file_detector import detect_file_type_from_header

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Persistent file storage (entries→file refactor) ────────────────────


def _get_files_dir() -> Path:
    """Return (and create) the unified persistent file storage directory.

    Files are stored under ~/.ala/files/{session-uuid}/ with no automatic
    cleanup — users manage file lifetime by deleting sessions.
    """
    env_dir = os.getenv("ALA_FILES_DIR")
    if env_dir:
        files_dir = Path(env_dir)
    else:
        files_dir = Path.home() / ".ala" / "files"
    files_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        files_dir.chmod(0o700)
    except OSError:
        logger.warning("Could not enforce private permissions on files dir: %s", files_dir)
    return files_dir


# ── Unified response models ────────────────────────────────────────────


class UnifiedFileInfo(BaseModel):
    original_name: str
    saved_path: str | None  # None for trace (returned inline)
    size_bytes: int
    file_type: str  # "log" | "pcap" | "hci" | "trace"
    format_detected: str
    # Only populated for trace files
    trace_result: dict | None = None


class UnifiedUploadResponse(BaseModel):
    session_uuid: str
    files: list[UnifiedFileInfo]
    # Bugreport-specific fields (populated only when a bugreport .zip is detected)
    bugreport_files: list[dict] | None = None
    bugreport_extracted: bool = False


# ── Endpoint ───────────────────────────────────────────────────────────


@router.post("/upload", response_model=UnifiedUploadResponse)
async def unified_upload(files: list[UploadFile] = File(...)):
    """Upload files of any supported type. Backend detects the type and responds.

    File type is detected from magic bytes / header content — file extension
    is never used for type routing.

    Returns per-file metadata including the detected ``file_type``. The
    frontend uses this to route to the correct viewer tab and downstream
    parse/filter endpoint.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    session_uuid = str(uuid.uuid4())
    result_files: list[UnifiedFileInfo] = []
    bugreport_files: list[dict] | None = None
    bugreport_extracted = False

    for upload in files:
        # Read enough of the file to detect type (up to 8 KB)
        content = await upload.read()
        if not content:
            continue

        filename = upload.filename or "unknown"
        header = content[:8192]
        file_type = detect_file_type_from_header(header)

        # ── Trace: parse inline (no temp storage needed) ────────────────
        if file_type == "trace":
            from ..services.trace_analyzer import TraceAnalyzer, TraceParseError

            try:
                trace_analyzer = TraceAnalyzer()
                result = trace_analyzer.parse_trace(content, filename)
                result_files.append(
                    UnifiedFileInfo(
                        original_name=filename,
                        saved_path=None,
                        size_bytes=len(content),
                        file_type="trace",
                        format_detected=result.format,
                        trace_result={
                            "summary": {
                                "duration_ms": result.summary.duration_ms,
                                "process_count": result.summary.process_count,
                                "thread_count": result.summary.thread_count,
                                "event_count": result.summary.event_count,
                                "processes": result.summary.processes,
                                "top_slices": result.summary.top_slices,
                                "ftrace_events": result.summary.ftrace_events,
                                "metadata": result.summary.metadata,
                            },
                            "format": result.format,
                            "file_size": len(content),
                        },
                    )
                )
            except TraceParseError as e:
                logger.warning("Trace parse failed for %r: %s — treating as log", filename, e)
                file_type = "log"
                # Fall through to log handling below
            else:
                continue  # Successfully handled as trace — skip to next file

        # ── Log / PCAP / HCI: save to unified persistent storage ───────
        temp_root = _get_files_dir()
        session_dir = temp_root / session_uuid
        session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

        safe_name = Path(filename).name
        dest_path = session_dir / safe_name
        counter = 1
        stem, ext = os.path.splitext(safe_name)
        while dest_path.exists():
            dest_path = session_dir / f"{stem}_{counter}{ext}"
            counter += 1

        fd = os.open(dest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(content)

        # ── Bugreport .zip detection and auto-extraction ─────────────────
        if file_type == "log" and content[:2] == b"\x50\x4b":  # ZIP magic
            try:
                from ..config import settings
                from ..services.bugreport_router import extract_bugreport, is_bugreport_zip
                from ..services.session_manager import SessionManager

                if is_bugreport_zip(str(dest_path)):
                    extract_dir = str(dest_path) + "_extracted"
                    extracted = extract_bugreport(str(dest_path), extract_dir)

                    # Add the zip itself to result files
                    result_files.append(
                        UnifiedFileInfo(
                            original_name=filename,
                            saved_path=str(dest_path),
                            size_bytes=len(content),
                            file_type=file_type,
                            format_detected="bugreport_zip",
                        )
                    )

                    # Populate bugreport-specific response fields
                    bugreport_files = [
                        {
                            "path": ef.path,
                            "original_name": ef.original_name,
                            "classified_type": ef.classified_type,
                            "size": ef.size,
                        }
                        for ef in extracted
                    ]
                    bugreport_extracted = True

                    # Create a session and set the source_path to the extracted dir
                    from datetime import UTC, datetime

                    _sm = SessionManager(max_sessions=settings.max_sessions)
                    _sm._db.execute(
                        "INSERT OR REPLACE INTO sessions (id, title, context_type, source_path, created_at) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (
                            session_uuid,
                            f"Bugreport: {filename}",
                            "bugreport",
                            extract_dir,
                            datetime.now(UTC).isoformat(),
                        ),
                    )
                    _sm._db.commit()

                    logger.info(
                        "Bugreport extracted: %d files from %s",
                        len(extracted),
                        filename,
                    )
                    continue  # skip normal format detection for this file
            except Exception as exc:
                logger.warning(
                    "Bugreport detection/extraction failed for %r: %s — "
                    "falling back to normal zip handling",
                    filename,
                    exc,
                )
                # Fall through to normal zip handling below

        # Detect format-specific sub-type
        format_detected = "unknown"
        try:
            if file_type == "pcap":
                from ..services.pcap_analyzer import PcapAnalyzer

                if PcapAnalyzer._is_pcap_data(content):  # noqa: SLF001
                    format_detected = "pcapng" if content[:4] == b"\x0a\x0d\x0d\x0a" else "pcap"
            elif file_type == "hci":
                from ..services.hci_analyzer import HciAnalyzer

                if HciAnalyzer._is_hci_data(content):  # noqa: SLF001
                    format_detected = "btsnoop"
            else:
                from ..services.log_analyzer import LogAnalyzer

                format_detected = LogAnalyzer.detect_log_format(content[:4096])
        except Exception:
            pass

        result_files.append(
            UnifiedFileInfo(
                original_name=filename,
                saved_path=str(dest_path),
                size_bytes=len(content),
                file_type=file_type,
                format_detected=format_detected,
            )
        )

    logger.debug(
        "Unified upload — session=%s files=%d types=%s",
        session_uuid,
        len(result_files),
        [f.file_type for f in result_files],
    )

    return UnifiedUploadResponse(
        session_uuid=session_uuid,
        files=result_files,
        bugreport_files=bugreport_files,
        bugreport_extracted=bugreport_extracted,
    )

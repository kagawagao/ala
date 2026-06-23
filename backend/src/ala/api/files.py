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

    return UnifiedUploadResponse(session_uuid=session_uuid, files=result_files)

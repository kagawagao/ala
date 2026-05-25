"""Unified file upload endpoint — backend detects type, frontend routes."""

import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Temp directory helpers ─────────────────────────────────────────────


def _get_temp_dir(sub: str) -> Path:
    """Return (and create) a type-specific temp directory."""
    env_key = f"ALA_{sub.upper()}_TEMP_DIR"
    env_dir = os.getenv(env_key)
    if env_dir:
        temp_dir = Path(env_dir)
    else:
        temp_dir = Path.home() / ".ala" / f"temp_{sub}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


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


# ── Type detection (magic bytes only — no extension fallback) ──────────


def _detect_file_type(header: bytes) -> str:
    """Detect file type from the first 8 KB of file content.

    Returns one of: "log", "pcap", "hci", "trace".
    Detection is purely header-based — file extension is never consulted.
    """
    if len(header) == 0:
        return "log"

    # PCAP magic bytes (4 bytes)
    if len(header) >= 4:
        magic = int.from_bytes(header[:4], "big")
        if magic in (
            0xD4C3B2A1,  # pcap le
            0xA1B2C3D4,  # pcap be
            0x4D3CB2A1,  # pcap ns le
            0xA1B23C4D,  # pcap ns be
            0x0A0D0D0A,  # pcapng
        ):
            return "pcap"

    # BTSnoop HCI: "btsnoop\\0" (8 bytes)
    if len(header) >= 8 and header[:8] == b"btsnoop\x00":
        return "hci"

    # GZ: 1F 8B
    if header[:2] == b"\x1f\x8b":
        return "log"

    # ZIP: 50 4B
    if header[:2] == b"\x50\x4b":
        return "log"

    # RAR: 52 61 72 21 1A 07 (00 | 01)
    if len(header) >= 7 and header[:6] == b"Rar!\x1a\x07" and header[6] in (0x00, 0x01):
        return "log"

    # 7Z: 37 7A BC AF 27 1C
    if len(header) >= 6 and header[:6] == b"\x37\x7a\xbc\xaf\x27\x1c":
        return "log"

    # Binary detection — count ASCII control bytes excluding TAB/LF/CR
    control_bytes = 0
    scan_len = min(len(header), 256)
    for i in range(scan_len):
        b = header[i]
        if b < 0x20 and b not in (0x09, 0x0A, 0x0D):
            control_bytes += 1
    if control_bytes > 4:
        return "trace"

    # JSON trace signature scan
    try:
        text = header.decode("utf-8", errors="replace")
        trimmed = text.lstrip()
        if trimmed.startswith("{") or trimmed.startswith("["):
            if any(
                marker in text
                for marker in (
                    '"traceEvents"',
                    '"systemTraceEvents"',
                    '"displayTimeUnit"',
                    '"ph"',
                )
            ):
                return "trace"
    except UnicodeDecodeError:
        pass

    return "log"


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
        file_type = _detect_file_type(header)

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

        # ── Log / PCAP / HCI: save to type-specific temp dir ───────────
        temp_root = _get_temp_dir(file_type)
        session_dir = temp_root / session_uuid
        session_dir.mkdir(parents=True, exist_ok=True)

        safe_name = Path(filename).name
        dest_path = session_dir / safe_name
        counter = 1
        stem, ext = os.path.splitext(safe_name)
        while dest_path.exists():
            dest_path = session_dir / f"{stem}_{counter}{ext}"
            counter += 1

        with open(dest_path, "wb") as f:
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

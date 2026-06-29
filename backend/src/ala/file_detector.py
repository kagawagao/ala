"""Shared file-type detection utilities.

Detection is purely header-based — file extension is never consulted.
"""

import re

_BTSNOOP_MAGIC = b"btsnoop\x00"

_PCAP_MAGICS = {
    0xD4C3B2A1,  # pcap le
    0xA1B2C3D4,  # pcap be
    0x4D3CB2A1,  # pcap ns le
    0xA1B23C4D,  # pcap ns be
    0x0A0D0D0A,  # pcapng
}

_TRACE_MARKERS = (
    '"traceEvents"',
    '"systemTraceEvents"',
    '"displayTimeUnit"',
    '"ph"',
)

# ── ANR trace header pattern ────────────────────────────────────────────────
# Matches: "----- pid 1234 at 2025-08-15 14:30:22 -----"
_ANR_HEADER_PATTERN = re.compile(r"----- pid \d+ at .* -----")

# ── Tombstone header pattern ────────────────────────────────────────────────
# Matches: "*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***"
_TOMBSTONE_HEADER_PATTERN = re.compile(r"\*{3} \*{3} \*{3} \*{3}")


def detect_file_type_from_header(header: bytes) -> str:
    """Detect file type from header bytes (first 8 KB recommended).

    Returns one of: "log", "pcap", "hci", "trace", "anr", "tombstone".
    """
    if len(header) == 0:
        return "log"

    # PCAP magic bytes (4 bytes)
    if len(header) >= 4:
        magic = int.from_bytes(header[:4], "big")
        if magic in _PCAP_MAGICS:
            return "pcap"

    # BTSnoop HCI (8 bytes)
    if len(header) >= 8 and header[:8] == _BTSNOOP_MAGIC:
        return "hci"

    # Archives — will be decompressed by the downstream parser
    if header[:2] == b"\x1f\x8b":  # GZ
        return "log"
    if header[:2] == b"\x50\x4b":  # ZIP
        return "log"
    if len(header) >= 7 and header[:6] == b"Rar!\x1a\x07" and header[6] in (0x00, 0x01):
        return "log"
    if len(header) >= 6 and header[:6] == b"\x37\x7a\xbc\xaf\x27\x1c":  # 7Z
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

    # ── ANR trace / Tombstone detection (text-based) ──────────────────────
    try:
        text = header.decode("utf-8", errors="replace")
        scan_window = text[:8192]
        trimmed = text.lstrip()

        # Tombstone: *** *** *** ... marker line
        if _TOMBSTONE_HEADER_PATTERN.search(scan_window):
            return "tombstone"

        # ANR trace: ----- pid N at ... ----- + "main" prio=
        if _ANR_HEADER_PATTERN.search(scan_window) and '"main" prio=' in scan_window:
            return "anr"

        # Fall through: JSON trace detection (existing)
        if trimmed.startswith("{") or trimmed.startswith("["):
            if any(marker in text for marker in _TRACE_MARKERS):
                return "trace"
    except UnicodeDecodeError:
        pass

    return "log"


def detect_file_type_from_path(file_path: str) -> str:
    """Detect file type from a file path by reading its header bytes.

    Returns one of: "log", "pcap", "hci", "trace", "anr", "tombstone".
    """
    try:
        with open(file_path, "rb") as f:
            header = f.read(8192)
    except OSError:
        return "log"
    return detect_file_type_from_header(header)

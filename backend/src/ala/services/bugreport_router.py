"""Bugreport .zip auto-routing — detection, extraction, and file classification.

Pure stdlib implementation that sits above ``file_detector`` without
modifying it.  All errors return graceful fallbacks — never crash the
upload flow.
"""

import logging
import os
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from ..file_detector import detect_file_type_from_header

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────

BUGREPORT_FILENAME_RE = re.compile(r"^bugreport(-.*)?\.zip$", re.I)

# EOCD internal-structure detection patterns
HIGH_WEIGHT_GLOBS = ["bugreport-*.txt", "ANR-*.txt", "tombstone_*"]
MEDIUM_WEIGHT_GLOBS = ["dumpstate_*.txt", "dumpsys.txt"]
LOW_WEIGHT_GLOBS = ["proto/*", "version.txt"]

# Zip bomb limits
MAX_COMPRESSION_RATIO = 100
MAX_UNCOMPRESSED_BOMB_BYTES = 500 * 1024 * 1024  # 500 MB
MAX_FILE_COUNT = 10_000

# Max header bytes to read for content-based classification
CLASSIFY_HEADER_BYTES = 4096


# ── Data structures ──────────────────────────────────────────────────────


@dataclass
class ExtractedFileInfo:
    """Metadata about a single extracted file from a bugreport zip."""

    path: str  # absolute path on disk
    original_name: str  # relative filename within the zip
    classified_type: str  # "log" | "pcap" | "hci" | "trace" | "anr" | "tombstone" | "other"
    size: int  # file size in bytes


# ── Public API ───────────────────────────────────────────────────────────


def is_bugreport_zip(file_path: str) -> bool:
    """Detect whether *file_path* is a bugreport .zip.

    Two-layer detection (fast-first):
    1. Filename pattern: ``^bugreport(-.*)?.zip$``
    2. Internal EOCD probe: look for characteristic files inside the zip
    """
    filename = os.path.basename(file_path)

    # Layer 1: filename pattern match
    if BUGREPORT_FILENAME_RE.match(filename):
        return True

    # Layer 2: internal structure probe via ZIP central directory
    try:
        with zipfile.ZipFile(file_path) as zf:
            names = [info.filename for info in zf.infolist()]
    except (zipfile.BadZipFile, OSError, RuntimeError):
        return False

    if not names:
        return False

    # Score characteristic files
    high = _count_matching(names, HIGH_WEIGHT_GLOBS)
    medium = _count_matching(names, MEDIUM_WEIGHT_GLOBS)
    low = _count_matching(names, LOW_WEIGHT_GLOBS)

    # Detection rule: high>=2 OR (high>=1 AND medium+low>=2)
    if high >= 2:
        return True
    if high >= 1 and (medium + low) >= 2:
        return True

    return False


def extract_bugreport(zip_path: str, output_dir: str) -> list[ExtractedFileInfo]:
    """Extract a bugreport .zip into *output_dir* and classify every file.

    Returns a list of :class:`ExtractedFileInfo` for each extracted file.
    Raises ``ValueError`` on zip bomb or corrupt zip.
    """
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    # ── Security pre-check: zip bomb & file count ──────────────────────
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = zf.infolist()
    except zipfile.BadZipFile as e:
        raise ValueError(f"Corrupt zip file: {e}") from e
    except RuntimeError as e:
        raise ValueError(f"Encrypted or unreadable zip: {e}") from e

    if len(infos) > MAX_FILE_COUNT:
        raise ValueError(f"Zip contains {len(infos)} files — exceeds maximum of {MAX_FILE_COUNT}")

    total_compressed = sum(info.compress_size for info in infos)
    total_uncompressed = sum(info.file_size for info in infos)

    # Independent uncompressed-size guard — catches low-compression
    # ZIPs that would otherwise bypass the ratio-based bomb check.
    if total_uncompressed > MAX_UNCOMPRESSED_BOMB_BYTES:
        raise ValueError(
            f"Zip too large: uncompressed size {total_uncompressed:,} bytes "
            f"exceeds maximum of {MAX_UNCOMPRESSED_BOMB_BYTES:,} bytes"
        )

    if total_compressed > 0:
        ratio = total_uncompressed / total_compressed
        if ratio > MAX_COMPRESSION_RATIO and total_uncompressed > MAX_UNCOMPRESSED_BOMB_BYTES:
            raise ValueError(
                f"Zip bomb detected: compression ratio {ratio:.0f}:1 "
                f"with uncompressed size {total_uncompressed:,} bytes"
            )

    # ── Extract ────────────────────────────────────────────────────────
    # Extract directly to *output_dir* after the security pre-checks above.
    # Path-traversal protection: normalize each member path and reject
    # absolute paths or parent-directory escapes.
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for member in zf.infolist():
                member_path = os.path.normpath(member.filename)
                if member_path.startswith("..") or os.path.isabs(member_path):
                    logger.warning("Skipping potentially unsafe path: %s", member.filename)
                    continue
                zf.extract(member, str(output))
    except (zipfile.BadZipFile, OSError, RuntimeError) as e:
        raise ValueError(f"Extraction failed: {e}") from e

    actual_extract_dir = output

    # ── Collect and classify extracted files ───────────────────────────
    results: list[ExtractedFileInfo] = []
    for root, _dirs, files in os.walk(actual_extract_dir):
        for fname in files:
            # Skip ALA internal marker files
            if fname.startswith(".ala_"):
                continue
            full_path = os.path.join(root, fname)
            # Path traversal guard — ensure path stays within extract dir
            if not _is_within_base(str(actual_extract_dir), full_path):
                logger.warning("Skipping path outside extract dir: %s", full_path)
                continue
            try:
                fsize = os.path.getsize(full_path)
            except OSError:
                continue
            classified = classify_extracted_file(full_path)
            rel_name = os.path.relpath(full_path, actual_extract_dir)
            results.append(
                ExtractedFileInfo(
                    path=full_path,
                    original_name=rel_name,
                    classified_type=classified,
                    size=fsize,
                )
            )

    logger.info(
        "Bugreport extracted: %d files from %s → %s",
        len(results),
        zip_path,
        actual_extract_dir,
    )
    return results


def classify_extracted_file(file_path: str) -> str:
    """Classify a single extracted file into one of the known types.

    Returns one of: ``"log"``, ``"pcap"``, ``"hci"``, ``"trace"``,
    ``"anr"``, ``"tombstone"``, ``"other"``.
    """
    filename = os.path.basename(file_path)
    basename = filename

    # ── Layer 1: filename patterns (fastest) ──────────────────────────
    if re.match(r"^bugreport-.*\.txt$", basename, re.I):
        return "log"
    if re.match(r"^ANR-.*\.txt$", basename, re.I):
        return "anr"
    if basename.startswith("tombstone_"):
        return "tombstone"

    # ── Layer 2: extension hints ──────────────────────────────────────
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".pcap", ".pcapng"):
        return "pcap"
    if basename.lower().startswith("btsnoop_") or ext == ".cfa":
        return "hci"
    if ext in (".pb", ".perfetto-trace"):
        return "trace"

    # ── Layer 3: magic bytes via file_detector ────────────────────────
    try:
        with open(file_path, "rb") as f:
            header = f.read(CLASSIFY_HEADER_BYTES)
    except OSError:
        return "other"

    if not header:
        return "other"

    ft = detect_file_type_from_header(header)
    if ft == "pcap":
        return "pcap"
    if ft == "hci":
        return "hci"
    if ft == "trace":
        # Only accept trace classification if file looks like text/JSON
        if _looks_like_text(header):
            return "trace"
        # Otherwise, binary data → fall through to 'other'

    # ── Layer 4: content-based detection (text files) ─────────────────
    try:
        text = header.decode("utf-8", errors="replace")
    except Exception:
        return "other"

    # ANR trace signature
    if "----- pid" in text and "Cmd line:" in text:
        return "anr"

    # Tombstone signature
    if "*** *** ***" in text and "Build fingerprint:" in text:
        return "tombstone"

    # ── Layer 5: text vs binary fallback ──────────────────────────────
    if _looks_like_text(header):
        return "log"

    return "other"


# ── Internal helpers ─────────────────────────────────────────────────────


def _count_matching(names: list[str], globs: list[str]) -> int:
    """Count how many *globs* have at least one matching entry in *names*."""
    import fnmatch

    total = 0
    for glob in globs:
        if any(fnmatch.fnmatch(name, glob) for name in names):
            total += 1
    return total


def _looks_like_text(header: bytes, threshold: int = 4) -> bool:
    """Return True if *header* looks like printable text (low binary chars)."""
    scan = header[:4096]
    control = sum(1 for b in scan if b < 0x20 and b not in (0x09, 0x0A, 0x0D))
    return control <= threshold


def _is_within_base(base_dir: str, target_path: str) -> bool:
    """Return True if *target_path* is within the *base_dir* tree (no traversal)."""
    try:
        base = Path(base_dir).resolve()
        target = Path(target_path).resolve()
        target.relative_to(base)
        return True
    except (ValueError, OSError):
        return False

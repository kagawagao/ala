"""Android log analyzer service - ported from TypeScript implementation."""

import gzip
import io
import os
import re
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class LogFormat(StrEnum):
    ANDROID_LOGCAT = "android_logcat"
    GENERIC_TIMESTAMPED = "generic_timestamped"
    UNKNOWN = "unknown"


@dataclass
class LogEntry:
    line_number: int
    timestamp: str | None
    pid: str | None
    tid: str | None
    level: str
    tag: str
    message: str
    raw_line: str
    source_file: str | None = None


@dataclass
class LogFilters:
    start_time: str | None = None
    end_time: str | None = None
    keywords: str | None = None
    level: str | None = None
    tag: str | None = None
    pid: str | None = None
    tid: str | None = None
    tag_keyword_relation: str = "AND"


@dataclass
class LogStatistics:
    total: int
    by_level: dict[str, int]
    tags: dict[str, int]
    pids: dict[str, int]


@dataclass
class ParseResult:
    logs: list[LogEntry]
    total_lines: int
    format_detected: str


@dataclass
class FileRef:
    """Metadata about a local log file, returned by scan_file_meta()."""

    path: str
    line_count: int
    size_bytes: int
    format_detected: str  # LogFormat value
    is_gzip: bool = False
    is_zip: bool = False
    truncated: bool = False  # True when scan stopped early due to max_scan_lines


class PathTraversalError(ValueError):
    """Raised when a file path contains traversal patterns like ../"""


# ---------------------------------------------------------------------------
# Archive / multi-file extraction helpers
# ---------------------------------------------------------------------------

#: File extensions treated as log text files (includes extensionless files
#: for ANR traces, tombstones, and other non-standard Android diagnostic text)
_LOG_TEXT_EXTS = {".log", ".txt", ".logcat", ".trace", ".anr", ""}

#: Maximum size (bytes) for a single decoded text file to prevent OOM
_MAX_DECODE_BYTES = 256 * 1024 * 1024  # 256 MB


def _is_log_name(name: str) -> bool:
    """Return True when *name* looks like a plain-text log file."""
    lower = name.lower()
    # Accept files without extension or with common log extensions
    import os

    ext = os.path.splitext(lower)[1]
    return ext in _LOG_TEXT_EXTS


def _extract_archive_to_disk(archive_path: str, filename: str) -> Path:
    """Extract an archive to ``{archive_path}_extracted/`` on disk.

    Returns the extraction directory path.  Nested archives are left as-is
    so the AI can decide whether to decompress them.
    """
    import logging
    import shutil
    import subprocess
    import sys

    _logger = logging.getLogger(__name__)

    extract_dir = Path(archive_path + "_extracted")
    lower = filename.lower()

    # Reuse existing extraction if already done (only if it has actual files)
    if extract_dir.exists():
        existing_files = [p for p in extract_dir.rglob("*") if p.is_file()]
        if existing_files:
            _logger.info(
                "Reusing existing extraction: %s (%d files)", extract_dir, len(existing_files)
            )
            return extract_dir
        else:
            # Previous extraction left empty directories — clean up and re-extract
            _logger.info("Existing extraction has no files — cleaning up: %s", extract_dir)
            shutil.rmtree(extract_dir)

    extract_dir.mkdir(parents=True, exist_ok=True)
    _logger.info("Extracting to: %s", extract_dir)

    if lower.endswith(".rar"):
        # ── Find a RAR extractor (system tools first — they are the gold standard) ─
        def _has_extracted_files(dir_: Path) -> bool:
            return any(p.is_file() for p in dir_.rglob("*"))

        extractor: str | None = None
        # 1) Search for system tools (7z, 7za, unrar) — correct & complete extraction
        extractor = shutil.which("7z") or shutil.which("7za") or shutil.which("unrar")
        if not extractor and sys.platform == "win32":
            for candidate in (
                r"C:\Program Files\7-Zip\7z.exe",
                r"C:\Program Files (x86)\7-Zip\7z.exe",
            ):
                if Path(candidate).exists():
                    extractor = candidate
                    break

        if extractor:
            # ── System tool available → use it directly ─
            _logger.info("Using system extractor: %s", extractor)
            if "7z" in extractor.lower():
                cmd = [extractor, "x", "-y", f"-o{extract_dir}", archive_path]
            else:
                cmd = [extractor, "x", "-y", archive_path, str(extract_dir) + "/"]
            try:
                subprocess.run(cmd, capture_output=True, check=True, timeout=300)
                _logger.info("Archive extraction complete via %s", extractor)
            except subprocess.CalledProcessError as e:
                stderr_text = e.stderr.decode(errors="replace") if e.stderr else ""
                _logger.warning("Extraction failed: %s", stderr_text[:500])
                # Detect split-archive "missing volume" errors
                if any(
                    keyword in stderr_text.lower()
                    for keyword in (
                        "cannot find volume",
                        "missing volume",
                        "need the following volume",
                        "next volume",
                        "can not open file",
                    )
                ):
                    raise ValueError(
                        f"Split archive extraction failed — missing parts. "
                        f"Ensure all parts of this split archive are downloaded "
                        f"to the same directory before extraction. Error: {stderr_text[:300]}"
                    ) from e
                raise ValueError(f"Archive extraction failed: {e}") from e
        else:
            # ── No system tool — fall back to rarfile library ─
            _logger.info("No system extractor found, trying rarfile library")
            try:
                import rarfile

                rf = rarfile.RarFile(archive_path)
                _logger.info("rarfile opened archive with %d members", len(rf.infolist()))
                rf.extractall(str(extract_dir))
                _logger.info("rarfile extraction complete")
            except ImportError:
                raise ValueError(
                    "Cannot extract RAR: install 7-Zip (https://7-zip.org) "
                    "or 'pip install rarfile' and ensure unrar is on your PATH."
                )
            except Exception as e:
                raise ValueError(
                    f"Cannot extract RAR: rarfile failed ({e}). "
                    "Install 7-Zip (https://7-zip.org) for reliable RAR extraction."
                ) from e

            # Verify rarfile actually produced files
            if not _has_extracted_files(extract_dir):
                raise ValueError(
                    "rarfile created directories but no files — the 'unrar' system tool "
                    "is required for RAR extraction. Install 7-Zip (https://7-zip.org) "
                    "or 'sudo apt install unrar'."
                )

    elif lower.endswith(".zip"):
        import zipfile

        with zipfile.ZipFile(archive_path) as zf:
            zf.extractall(str(extract_dir))
        _logger.info("ZIP extracted to: %s", extract_dir)

    elif lower.endswith(".gz") and not lower.endswith(".tar.gz"):
        import gzip

        inner_name = filename[:-3] if len(filename) > 3 else "log"
        dest = extract_dir / inner_name
        with gzip.open(archive_path, "rb") as gz_f, open(dest, "wb") as out_f:
            total = 0
            while True:
                chunk = gz_f.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_DECODE_BYTES:
                    raise ValueError(f"Decompressed size exceeds {_MAX_DECODE_BYTES:,} byte limit")
                out_f.write(chunk)
        _logger.info("GZ decompressed to: %s", dest)

    else:
        # Not a recognised archive — just return the directory
        _logger.debug("Not an archive: %s", filename)

    return extract_dir


def decompress_nested(root: Path) -> list[str]:
    """Recursively decompress ``.gz`` / ``.zip`` / ``.rar`` files found inside *root*.

    Called after initial archive extraction to flatten nested archives, and
    exposed as an AI agent tool for manual use.  Returns the names of files
    that were decompressed.
    """
    import gzip
    import logging
    import shutil
    import subprocess
    import sys
    import zipfile

    _logger = logging.getLogger(__name__)

    # ── Resolve RAR extractor once ──────────────────────────────────────
    _rar_extractor: str | None = None
    _rar_extractor_checked = False

    def _get_rar_extractor() -> str | None:
        nonlocal _rar_extractor, _rar_extractor_checked
        if _rar_extractor_checked:
            return _rar_extractor
        _rar_extractor_checked = True
        _rar_extractor = shutil.which("7z") or shutil.which("7za") or shutil.which("unrar")
        if not _rar_extractor and sys.platform == "win32":
            for candidate in (
                r"C:\Program Files\7-Zip\7z.exe",
                r"C:\Program Files (x86)\7-Zip\7z.exe",
            ):
                if Path(candidate).exists():
                    _rar_extractor = candidate
                    break
        return _rar_extractor

    decompressed: list[str] = []
    changed = True
    while changed:
        changed = False
        for f in sorted(root.rglob("*")):
            if not f.is_file():
                continue
            lower = f.name.lower()
            try:
                if lower.endswith(".gz") and not lower.endswith(".tar.gz"):
                    inner = f.with_suffix("")  # remove .gz
                    _logger.info("Decompressing nested: %s → %s", f.name, inner.name)
                    with gzip.open(f, "rb") as gz_f:
                        inner.write_bytes(gz_f.read())
                    f.unlink()  # remove .gz after decompression
                    decompressed.append(str(inner.relative_to(root)))
                    changed = True
                elif lower.endswith(".zip"):
                    _logger.info("Extracting nested ZIP: %s", f.name)
                    with zipfile.ZipFile(f) as zf:
                        zf.extractall(str(f.parent))
                    f.unlink()
                    decompressed.append(f"{f.name} → extracted")
                    changed = True
                elif lower.endswith(".rar"):
                    _logger.info("Extracting nested RAR: %s", f.name)
                    extractor = _get_rar_extractor()
                    if extractor:
                        if "7z" in extractor.lower():
                            cmd = [extractor, "x", "-y", f"-o{f.parent}", str(f)]
                        else:
                            cmd = [extractor, "x", "-y", str(f), str(f.parent) + "/"]
                        subprocess.run(cmd, capture_output=True, check=True, timeout=300)
                        f.unlink()
                        decompressed.append(f"{f.name} → extracted")
                        changed = True
                    else:
                        try:
                            import rarfile

                            rf = rarfile.RarFile(str(f))
                            rf.extractall(str(f.parent))
                            f.unlink()
                            decompressed.append(f"{f.name} → extracted")
                            changed = True
                        except ImportError:
                            _logger.warning(
                                "Cannot extract nested RAR %s: no extractor available", f.name
                            )
                        except Exception as e:
                            _logger.warning("rarfile extraction failed for %s: %s", f.name, e)
            except Exception as e:
                _logger.warning("Failed to decompress nested file %s: %s", f, e)
    return decompressed


def _format_size(size_bytes: int) -> str:
    """Format file size in human-readable form."""
    size_bytes = int(size_bytes)
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def _build_file_tree(root: Path, top_name: str | None = None) -> str:
    """Build a human-readable directory tree for the AI to browse.

    Limits to 200 entries; directories come first, then files sorted by size
    descending.  Compressed files and media files are tagged.
    """
    import logging

    _logger = logging.getLogger(__name__)
    all_items = sorted(root.rglob("*"), key=lambda p: (not p.is_dir(), p.as_posix().lower()))

    lines: list[str] = []
    max_items = 200
    for item in all_items[:max_items]:
        if item.name.startswith("."):
            continue
        try:
            size = item.stat().st_size if item.is_file() else 0
        except OSError:
            size = 0
        indent = "  " * (len(item.relative_to(root).parts) - 1)
        prefix = "📁" if item.is_dir() else "📄"
        tag = ""
        if item.is_file():
            lower = item.name.lower()
            if lower.endswith((".gz", ".zip", ".rar", ".7z", ".tar", ".tgz")):
                tag = " [compressed]"
            elif lower.endswith((".mp4", ".avi", ".mov", ".jpg", ".png", ".bmp", ".gif")):
                tag = " [media]"
            elif not _is_log_name(item.name):
                tag = " [other]"
        size_str = _format_size(size) if item.is_file() else ""
        lines.append(f"{indent}{prefix} {item.name}  {size_str}{tag}")
    if len(all_items) > max_items:
        lines.append(f"... and {len(all_items) - max_items} more items")
    return "\n".join(lines)


def _collect_log_files(root: Path) -> list[tuple[str, bytes]]:
    """Recursively collect log files from a directory tree."""
    results: list[tuple[str, bytes]] = []
    for f in root.rglob("*"):
        if f.is_file() and _is_log_name(f.name):
            content = f.read_bytes()
            if len(content) <= _MAX_DECODE_BYTES:
                # Use relative path from root as display name
                rel_name = str(f.relative_to(root))
                results.append((rel_name, content))
    if not results:
        results.append(("(empty archive)", b""))
    return results


#: Maximum recursion depth for nested archive decompression to prevent zip-bomb DoS
_MAX_DECOMPRESS_DEPTH = 5


def _is_compressed_name(name: str) -> bool:
    """Return True when *name* looks like a compressed/archive file."""
    lower = name.lower()
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        return True
    ext = os.path.splitext(lower)[1]
    return ext in {".gz", ".zip", ".rar", ".7z"}


def extract_text_files(
    data: bytes, filename: str, source_path: str | None = None, _depth: int = 0
) -> list[tuple[str, bytes]]:
    """Extract text file contents from *data* or from a file on disk.

    Returns a list of ``(member_name, raw_bytes)`` pairs.

    Nested archives (e.g. ``.zip`` containing ``.gz``, ``.rar`` containing
    ``.gz`` files) are decompressed recursively until plain-text files are
    reached.  *source_path* triggers on-disk extraction (essential for large
    archives that would exhaust memory).

    Supports:
    * ``.zip`` archives (may contain multiple log files)
    * ``.gz`` single-file gzip (e.g. ``logcat.log.gz``)
    * ``.rar`` archives
    * Plain text files (returned as-is)
    """
    import logging

    _logger = logging.getLogger(__name__)

    if _depth > _MAX_DECOMPRESS_DEPTH:
        _logger.warning("Max decompress depth reached for %s — returning as plain text", filename)
        return [(filename, data[:_MAX_DECODE_BYTES])]

    lower = filename.lower()

    # For disk-based archives, extract next to the source file, then collect.
    # Nested archives are left as-is — the AI decides on-demand via decompress_file tool.
    if source_path and (lower.endswith((".rar", ".zip", ".gz"))):
        extract_dir = _extract_archive_to_disk(source_path, filename)
        return _collect_log_files(extract_dir)

    data_mb = len(data) / (1024 * 1024)

    if lower.endswith(".zip"):
        _logger.info(
            "Extracting ZIP from memory: %s (%.1f MB, depth=%d)", filename, data_mb, _depth
        )
        results: list[tuple[str, bytes]] = []
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_name = info.filename
                    member_data = zf.read(info.filename)
                    if len(member_data) > _MAX_DECODE_BYTES:
                        _logger.warning("ZIP member too large, skipping: %s", member_name)
                        continue
                    if _is_compressed_name(member_name):
                        # Nested archive → recurse
                        _logger.info("ZIP member is compressed, recursing: %s", member_name)
                        results.extend(
                            extract_text_files(member_data, member_name, _depth=_depth + 1)
                        )
                    elif _is_log_name(member_name):
                        results.append((member_name, member_data))
                    else:
                        _logger.debug("Skipping non-log ZIP member: %s", member_name)
        except zipfile.BadZipFile as exc:
            raise ValueError(f"Invalid ZIP file: {exc}") from exc
        _logger.info("ZIP extracted %d log files from memory", len(results))
        return results if results else [("(empty zip)", b"")]

    if lower.endswith(".gz") and not lower.endswith(".tar.gz"):
        _logger.info(
            "Decompressing GZ from memory: %s (%.1f MB, depth=%d)", filename, data_mb, _depth
        )
        try:
            decompressed = gzip.decompress(data)
        except gzip.BadGzipFile as exc:
            raise ValueError(f"Invalid gzip file: {exc}") from exc
        inner_name = filename[:-3] if len(filename) > 3 else filename
        decomp_mb = len(decompressed) / (1024 * 1024)
        _logger.info("GZ decompressed: %s → %s (%.1f MB)", filename, inner_name, decomp_mb)

        # If the decompressed content is itself an archive, recurse
        if _is_compressed_name(inner_name):
            _logger.info("GZ inner file is compressed, recursing: %s", inner_name)
            return extract_text_files(decompressed, inner_name, _depth=_depth + 1)

        return [(inner_name, decompressed[:_MAX_DECODE_BYTES])]

    if lower.endswith(".rar"):
        # In-memory RAR (no source_path) — write to temp dir, extract, collect.
        # Nested archives are left as-is — the AI decides on-demand.
        import tempfile

        with tempfile.TemporaryDirectory(prefix="ala_rar_") as tmpdir:
            rar_path = Path(tmpdir) / filename
            rar_path.write_bytes(data)
            extract_dir = _extract_archive_to_disk(str(rar_path), filename)
            return _collect_log_files(extract_dir)

    # Plain text – return as-is
    _logger.debug("Treating as plain text: %s (%.1f MB)", filename, data_mb)
    return [(filename, data[:_MAX_DECODE_BYTES])]


class LogAnalyzer:
    def __init__(self):
        self._android_pattern = re.compile(
            r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3,6})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):+\s+(.*)$"
        )
        self._generic_pattern = re.compile(
            r"^(?:\[)?(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]?\s*"
            r"(?:\[)?([A-Z]+|VERBOSE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?:?\s*(?:-\s*)?(.+)$",
            re.IGNORECASE,
        )

    def detect_log_format(self, content: str) -> LogFormat:
        lines = [line for line in content.split("\n") if line.strip()]
        sample = lines[:10]
        if not sample:
            return LogFormat.UNKNOWN
        android_matches = sum(1 for line in sample if self._android_pattern.match(line.strip()))
        generic_matches = sum(1 for line in sample if self._generic_pattern.match(line.strip()))
        if android_matches >= len(sample) * 0.6:
            return LogFormat.ANDROID_LOGCAT
        if generic_matches >= len(sample) * 0.6:
            return LogFormat.GENERIC_TIMESTAMPED
        return LogFormat.UNKNOWN

    def parse_log(self, content: str, source_file: str | None = None) -> ParseResult:
        fmt = self.detect_log_format(content)
        if fmt == LogFormat.ANDROID_LOGCAT:
            logs = self._parse_android_logcat(content, source_file)
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            logs = self._parse_generic_timestamped(content, source_file)
        else:
            logs = self._parse_unknown(content, source_file)
        return ParseResult(logs=logs, total_lines=len(logs), format_detected=fmt.value)

    def parse_log_bytes(
        self, data: bytes, filename: str, source_path: str | None = None
    ) -> list[ParseResult]:
        """Parse one or more log files from *data*.

        Handles plain text, ``.zip`` archives, ``.gz`` single-file gzip, and ``.rar``.
        Returns one :class:`ParseResult` per extracted text file.

        When *source_path* is given, archives are extracted on disk next to
        the source file so large archives don't consume memory.
        """
        text_files = extract_text_files(data, filename, source_path=source_path)
        results: list[ParseResult] = []
        for name, raw_bytes in text_files:
            text = raw_bytes.decode("utf-8", errors="replace")
            results.append(self.parse_log(text, source_file=name))
        return results

    def stream_log_bytes(self, data: bytes, filename: str) -> Iterator[LogEntry]:
        """Yield :class:`LogEntry` objects one by one.

        Handles plain text, ``.zip``, and ``.gz`` files, yielding entries
        across all extracted members in order so callers can stream them
        without buffering the full result.
        """
        text_files = extract_text_files(data, filename)
        for name, raw_bytes in text_files:
            text = raw_bytes.decode("utf-8", errors="replace")
            yield from self.parse_log_iter(text, source_file=name)

    def _parse_android_logcat(self, content: str, source_file: str | None = None) -> list[LogEntry]:
        entries = []
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._android_pattern.match(line)
            if m:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=m.group(1).strip(),
                        pid=m.group(2).strip(),
                        tid=m.group(3).strip(),
                        level=m.group(4).strip(),
                        tag=m.group(5).strip(),
                        message=m.group(6).strip(),
                        raw_line=line,
                        source_file=source_file,
                    )
                )
            else:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=None,
                        pid=None,
                        tid=None,
                        level="U",
                        tag="Unknown",
                        message=line,
                        raw_line=line,
                        source_file=source_file,
                    )
                )
        return entries

    def _parse_generic_timestamped(
        self, content: str, source_file: str | None = None
    ) -> list[LogEntry]:
        entries = []
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._generic_pattern.match(line)
            if m:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=m.group(1).strip(),
                        pid=None,
                        tid=None,
                        level=self._normalize_level(m.group(2)),
                        tag="Generic",
                        message=m.group(3).strip(),
                        raw_line=line,
                        source_file=source_file,
                    )
                )
            else:
                entries.append(
                    LogEntry(
                        line_number=i,
                        timestamp=None,
                        pid=None,
                        tid=None,
                        level="U",
                        tag="Unknown",
                        message=line,
                        raw_line=line,
                        source_file=source_file,
                    )
                )
        return entries

    def _parse_unknown(self, content: str, source_file: str | None = None) -> list[LogEntry]:
        return [
            LogEntry(
                line_number=i,
                timestamp=None,
                pid=None,
                tid=None,
                level="U",
                tag="Unknown",
                message=line.strip(),
                raw_line=line.strip(),
                source_file=source_file,
            )
            for i, line in enumerate(content.split("\n"), 1)
            if line.strip()
        ]

    # ------------------------------------------------------------------
    # Iterator-based (streaming) parse methods — yield per-line, no list
    # ------------------------------------------------------------------

    def parse_log_iter(self, content: str, source_file: str | None = None) -> Iterator[LogEntry]:
        """Yield :class:`LogEntry` objects one at a time without building a list.

        Detects the log format and delegates to the appropriate streaming parser.
        """
        fmt = self.detect_log_format(content)
        if fmt == LogFormat.ANDROID_LOGCAT:
            yield from self._parse_android_logcat_iter(content, source_file)
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            yield from self._parse_generic_timestamped_iter(content, source_file)
        else:
            yield from self._parse_unknown_iter(content, source_file)

    def _parse_android_logcat_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._android_pattern.match(line)
            if m:
                yield LogEntry(
                    line_number=i,
                    timestamp=m.group(1).strip(),
                    pid=m.group(2).strip(),
                    tid=m.group(3).strip(),
                    level=m.group(4).strip(),
                    tag=m.group(5).strip(),
                    message=m.group(6).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
            else:
                yield LogEntry(
                    line_number=i,
                    timestamp=None,
                    pid=None,
                    tid=None,
                    level="U",
                    tag="Unknown",
                    message=line,
                    raw_line=line,
                    source_file=source_file,
                )

    def _parse_generic_timestamped_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            m = self._generic_pattern.match(line)
            if m:
                yield LogEntry(
                    line_number=i,
                    timestamp=m.group(1).strip(),
                    pid=None,
                    tid=None,
                    level=self._normalize_level(m.group(2)),
                    tag="Generic",
                    message=m.group(3).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
            else:
                yield LogEntry(
                    line_number=i,
                    timestamp=None,
                    pid=None,
                    tid=None,
                    level="U",
                    tag="Unknown",
                    message=line,
                    raw_line=line,
                    source_file=source_file,
                )

    def _parse_unknown_iter(
        self, content: str, source_file: str | None = None
    ) -> Iterator[LogEntry]:
        for i, raw in enumerate(content.split("\n"), 1):
            line = raw.strip()
            if not line:
                continue
            yield LogEntry(
                line_number=i,
                timestamp=None,
                pid=None,
                tid=None,
                level="U",
                tag="Unknown",
                message=line,
                raw_line=line,
                source_file=source_file,
            )

    def _normalize_level(self, level: str) -> str:
        u = level.upper()
        if u == "VERBOSE" or u == "V":
            return "V"
        if u == "DEBUG" or u == "D":
            return "D"
        if u == "INFO" or u == "I":
            return "I"
        if u in ("W", "WARN", "WARNING"):
            return "W"
        if u == "ERROR" or u == "E":
            return "E"
        if u == "FATAL" or u == "F":
            return "F"
        return "U"

    # ------------------------------------------------------------------
    # Lazy log file helpers (FEAT-LAZY-LOG)
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_path(
        file_path: str,
        sandbox_root: str | None = None,
        *,
        allow_directory: bool = False,
    ) -> str:
        """Validate and resolve a local path for security.

        Raises:
            PathTraversalError: If path contains traversal patterns.
            FileNotFoundError: If path does not exist.
            ValueError: If path points to a directory and allow_directory is False.
            PermissionError: If sandbox restricts access or path is unreadable.
        """
        # Resolve sandbox root from env var if not explicitly passed
        if sandbox_root is None:
            sandbox_root = os.environ.get("ALA_SANDBOX_ROOT")

        # Normalize alternate separators first (e.g. '/' on Windows), then
        # reject traversal tokens before normpath resolves them away.
        path_for_check = file_path
        if os.altsep:
            path_for_check = path_for_check.replace(os.altsep, os.sep)

        # Reject path traversal patterns — check original string first
        # (normpath would resolve ../ before we can detect it)
        if ".." in path_for_check.split(os.sep) or path_for_check.startswith(".."):
            raise PathTraversalError(f"Path traversal detected: {file_path}")
        normalized = os.path.normpath(path_for_check)
        # Double-check the normalized path too
        if ".." in normalized.split(os.sep):
            raise PathTraversalError(f"Path traversal detected (after normalization): {normalized}")

        # Resolve symlinks to real path
        real = os.path.realpath(normalized)

        # Check sandbox confinement
        if sandbox_root:
            sandbox_real = os.path.realpath(os.path.normpath(sandbox_root))
            # Both must be on the same path prefix
            if not os.path.commonpath([real, sandbox_real]).startswith(sandbox_real):
                raise PermissionError(
                    f"Path {file_path} is outside allowed sandbox root {sandbox_root}"
                )

        # Must exist
        if not os.path.exists(real):
            raise FileNotFoundError(f"File not found: {file_path}")

        if os.path.isdir(real):
            if not allow_directory:
                raise ValueError(f"Path is a directory, not a file: {file_path}")
        elif not os.path.isfile(real):
            raise ValueError(f"Path is not a regular file: {file_path}")

        # Must be readable
        if not os.access(real, os.R_OK):
            raise PermissionError(f"Permission denied: cannot read {file_path}")

        return real

    def scan_file_meta(self, file_path: str, max_scan_lines: int | None = None) -> FileRef:
        """Scan a local log file and return metadata without parsing entries.

        Counts lines, detects format, and identifies compression type.

        Args:
            file_path: Path to the log file.
            max_scan_lines: If set, stop counting after this many lines.
                            Format detection still uses the first 10 lines.
        """
        validated = self._validate_path(file_path)
        file_stat = os.stat(validated)

        lower = file_path.lower()
        is_gzip = lower.endswith(".gz") and not lower.endswith(".tar.gz")
        is_zip = lower.endswith(".zip")

        line_count = 0
        format_detected = LogFormat.UNKNOWN.value
        sample_lines = []
        truncated = False

        if is_zip:
            # For ZIP archives, iterate all text members to count lines and collect samples
            zf = zipfile.ZipFile(validated, "r")
            try:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_lower = info.filename.lower()
                    ext = os.path.splitext(member_lower)[1]
                    if ext not in _LOG_TEXT_EXTS:
                        continue
                    with io.TextIOWrapper(zf.open(info), encoding="utf-8", errors="replace") as fh:
                        for raw_line in fh:
                            line_count += 1
                            stripped = raw_line.strip()
                            if stripped and len(sample_lines) < 10:
                                sample_lines.append(stripped)
                            # Early exit: stop counting after max_scan_lines
                            if max_scan_lines is not None and line_count >= max_scan_lines:
                                truncated = True
                                break
                    if truncated:
                        break
            finally:
                zf.close()
        else:
            fh = self._open_log_path(validated)
            try:
                for raw_line in fh:
                    line_count += 1
                    stripped = raw_line.strip()
                    if stripped and len(sample_lines) < 10:
                        sample_lines.append(stripped)
                    # Early exit: stop counting after max_scan_lines
                    if max_scan_lines is not None and line_count >= max_scan_lines:
                        truncated = True
                        break
            finally:
                if hasattr(fh, "close"):
                    fh.close()

        sample = "\n".join(sample_lines)
        if sample:
            format_detected = self.detect_log_format(sample).value

        return FileRef(
            path=validated,
            line_count=line_count,
            size_bytes=file_stat.st_size,
            format_detected=format_detected,
            is_gzip=is_gzip,
            is_zip=is_zip,
            truncated=truncated,
        )

    def stream_file(self, file_path: str, sandbox_root: str | None = None) -> Iterator[LogEntry]:
        """Stream LogEntry objects from a local file path, one at a time.

        Never loads the entire file into memory. Handles .gz, .zip, and plain text.

        Yields:
            LogEntry objects one-by-one.
        """
        validated = self._validate_path(file_path, sandbox_root=sandbox_root)

        # Detect format from first 10 lines
        fmt = LogFormat.UNKNOWN
        sample_lines = []
        fh = self._open_log_path(validated)
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
            sample = "\n".join(sample_lines)
            fmt = self.detect_log_format(sample)

        # Re-open and parse all lines
        # For zip files, iterate all text members
        lower_path = validated.lower()
        if lower_path.endswith(".zip") and not lower_path.endswith(".tar.gz"):
            with zipfile.ZipFile(validated, "r") as zf:
                line_num = 0
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_lower = info.filename.lower()
                    ext = os.path.splitext(member_lower)[1]
                    if ext not in _LOG_TEXT_EXTS:
                        continue
                    source = info.filename
                    with zf.open(info) as member_fh:
                        fh = io.TextIOWrapper(member_fh, encoding="utf-8", errors="replace")
                        for raw_line in fh:
                            line_num += 1
                            line = raw_line.rstrip("\n\r")
                            if not line.strip():
                                continue
                            yield self._parse_single_line(line, line_num, fmt, source)
        else:
            source = Path(validated).name
            fh = self._open_log_path(validated)
            try:
                line_num = 0
                for raw_line in fh:
                    line_num += 1
                    line = raw_line.rstrip("\n\r")
                    if not line.strip():
                        continue
                    yield self._parse_single_line(line, line_num, fmt, source)
            finally:
                if hasattr(fh, "close"):
                    fh.close()

    @staticmethod
    def _open_log_path(file_path: str):
        """Open a log file for line-by-line reading.

        Handles plain text, .gz (gzip), and .zip (first text member).
        Returns a context-manager compatible object.  For zip files the returned
        TextIOWrapper is wrapped so closing it also closes the parent ZipFile.
        """
        lower = file_path.lower()

        if lower.endswith(".gz") and not lower.endswith(".tar.gz"):
            return gzip.open(file_path, mode="rt", encoding="utf-8", errors="replace")

        if lower.endswith(".zip"):
            zf = zipfile.ZipFile(file_path, "r")
            try:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    member_lower = info.filename.lower()
                    ext = os.path.splitext(member_lower)[1]
                    if ext in _LOG_TEXT_EXTS:
                        wrapper = io.TextIOWrapper(
                            zf.open(info), encoding="utf-8", errors="replace"
                        )
                        # Attach the ZipFile to the wrapper so it gets closed too
                        wrapper._ala_zipfile = zf  # type: ignore[attr-defined]
                        orig_close = wrapper.close

                        def _close_with_zip():
                            orig_close()
                            zf.close()

                        wrapper.close = _close_with_zip  # type: ignore[method-assign]
                        return wrapper
                # No text member found — close zip and return empty
                zf.close()
                return io.StringIO("")
            except Exception:
                zf.close()
                raise

        return open(file_path, encoding="utf-8", errors="replace")

    def _parse_single_line(
        self, line: str, line_number: int, fmt: LogFormat, source_file: str | None = None
    ) -> LogEntry:
        """Parse a single log line into a LogEntry.

        Args:
            line: The raw log line (already stripped of newline).
            line_number: 1-based line number in the file.
            fmt: Detected log format.
            source_file: Name of the source file.

        Returns:
            A LogEntry with parsed fields.
        """
        if fmt == LogFormat.ANDROID_LOGCAT:
            m = self._android_pattern.match(line.strip())
            if m:
                return LogEntry(
                    line_number=line_number,
                    timestamp=m.group(1).strip(),
                    pid=m.group(2).strip(),
                    tid=m.group(3).strip(),
                    level=m.group(4).strip(),
                    tag=m.group(5).strip(),
                    message=m.group(6).strip(),
                    raw_line=line,
                    source_file=source_file,
                )
        elif fmt == LogFormat.GENERIC_TIMESTAMPED:
            m = self._generic_pattern.match(line.strip())
            if m:
                return LogEntry(
                    line_number=line_number,
                    timestamp=m.group(1).strip(),
                    pid=None,
                    tid=None,
                    level=self._normalize_level(m.group(2)),
                    tag="Generic",
                    message=m.group(3).strip(),
                    raw_line=line,
                    source_file=source_file,
                )

        # Fallback: unknown format or no match
        return LogEntry(
            line_number=line_number,
            timestamp=None,
            pid=None,
            tid=None,
            level="U",
            tag="Unknown",
            message=line.strip(),
            raw_line=line,
            source_file=source_file,
        )

    # ------------------------------------------------------------------
    # End lazy log helpers
    # ------------------------------------------------------------------

    def filter_logs(self, logs: list[LogEntry], filters: LogFilters) -> list[LogEntry]:
        # Pre-compile regexes
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

        has_kw = kw_regex is not None or kw_fallback is not None
        has_tag = tag_regex is not None or tag_fallback is not None
        use_or = filters.tag_keyword_relation == "OR"

        result = []
        for log in logs:
            # Time filter
            if filters.start_time or filters.end_time:
                if not log.timestamp:
                    continue
                if filters.start_time and log.timestamp < filters.start_time:
                    continue
                if filters.end_time and log.timestamp > filters.end_time:
                    continue

            # Keyword + tag filter
            if has_kw or has_tag:
                kw_match = True
                if has_kw:
                    kw_match = bool(
                        (
                            kw_regex.search(log.message)
                            if kw_regex
                            else kw_fallback in log.message.lower()
                        )
                        or (
                            kw_regex.search(log.raw_line)
                            if kw_regex
                            else kw_fallback in log.raw_line.lower()
                        )
                    )

                tag_match = True
                if has_tag:
                    tag_match = bool(
                        tag_regex.search(log.tag) if tag_regex else tag_fallback in log.tag.lower()
                    )

                if use_or and has_kw and has_tag:
                    if not (kw_match or tag_match):
                        continue
                else:
                    if not (kw_match and tag_match):
                        continue

            # Level filter
            if filters.level and filters.level != "ALL" and log.level != filters.level:
                continue

            # PID filter
            if filters.pid and filters.pid.strip() and log.pid != filters.pid:
                continue

            # TID filter
            if filters.tid and filters.tid.strip() and log.tid != filters.tid:
                continue

            result.append(log)

        return result

    def get_statistics(self, logs: list[LogEntry]) -> LogStatistics:
        by_level: dict[str, int] = {}
        tags: dict[str, int] = {}
        pids: dict[str, int] = {}
        for log in logs:
            by_level[log.level] = by_level.get(log.level, 0) + 1
            tags[log.tag] = tags.get(log.tag, 0) + 1
            if log.pid:
                pids[log.pid] = pids.get(log.pid, 0) + 1
        return LogStatistics(total=len(logs), by_level=by_level, tags=tags, pids=pids)

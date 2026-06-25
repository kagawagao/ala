"""Tests for bugreport_router — detection, extraction, classification, and security."""

import os
import tempfile
import zipfile

import pytest

from ala.services.bugreport_router import (
    _count_matching,
    _is_within_base,
    _looks_like_text,
    classify_extracted_file,
    extract_bugreport,
    is_bugreport_zip,
)

# ── Fixtures ───────────────────────────────────────────────────────────────


def _create_zip(zip_path: str, files: dict[str, str | bytes]) -> None:
    """Create a zip file with the given name→content mapping."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            if isinstance(content, str):
                content = content.encode("utf-8")
            zf.writestr(name, content)


def _create_temp_zip(files: dict[str, str | bytes], suffix: str = ".zip") -> str:
    """Create a temporary zip file and return its path."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    _create_zip(path, files)
    return path


# ── is_bugreport_zip tests ─────────────────────────────────────────────────


class TestIsBugreportZip:
    def test_filename_pattern_basic(self):
        """bugreport-YYYY-MM-DD.zip should be detected by filename pattern."""
        path = _create_temp_zip({"bugreport-2026-06-26.txt": "log content"})
        new_path = os.path.join(os.path.dirname(path), "bugreport-2026-06-26.zip")
        os.rename(path, new_path)
        try:
            assert is_bugreport_zip(new_path) is True
        finally:
            os.unlink(new_path)

    def test_filename_pattern_simple(self):
        """bugreport.zip should be detected."""
        path = _create_temp_zip({"some.txt": "content"})
        new_path = os.path.join(os.path.dirname(path), "bugreport.zip")
        os.rename(path, new_path)
        try:
            assert is_bugreport_zip(new_path) is True
        finally:
            os.unlink(new_path)

    def test_filename_pattern_case_insensitive(self):
        """BugReport.zip should be detected (case insensitive)."""
        path = _create_temp_zip({"some.txt": "content"})
        new_path = os.path.join(os.path.dirname(path), "BugReport-2026-06-26.zip")
        os.rename(path, new_path)
        try:
            assert is_bugreport_zip(new_path) is True
        finally:
            os.unlink(new_path)

    def test_filename_with_device_prefix(self):
        """bugreport-PB2AX-2026-06-26-10-15-23.zip should match."""
        path = _create_temp_zip({"some.txt": "content"})
        new_path = os.path.join(os.path.dirname(path), "bugreport-PB2AX-2026-06-26-10-15-23.zip")
        os.rename(path, new_path)
        try:
            assert is_bugreport_zip(new_path) is True
        finally:
            os.unlink(new_path)

    def test_normal_zip_not_detected_by_filename(self):
        """A normal zip with non-bugreport name should not match by filename."""
        path = _create_temp_zip({"some.txt": "content"})
        try:
            assert is_bugreport_zip(path) is False
        finally:
            os.unlink(path)

    def test_internal_structure_detection_high_weight(self):
        """Zip with bugreport-*.txt + ANR-*.txt (2 high-weight) should be detected."""
        path = _create_temp_zip(
            {
                "bugreport-2026-06-26.txt": "log content",
                "ANR-2026-06-26-10-15-23.txt": "ANR content",
            },
            suffix="-logs.zip",
        )
        try:
            assert is_bugreport_zip(path) is True
        finally:
            os.unlink(path)

    def test_internal_structure_detection_tombstones(self):
        """Zip with tombstone_00 + bugreport.txt should be detected."""
        path = _create_temp_zip(
            {
                "bugreport-2026-06-26.txt": "log content",
                "tombstone_00": "tombstone content",
            },
            suffix="-logs.zip",
        )
        try:
            assert is_bugreport_zip(path) is True
        finally:
            os.unlink(path)

    def test_internal_structure_one_high_two_medium(self):
        """Zip with 1 high-weight + 2 medium-weight should be detected."""
        path = _create_temp_zip(
            {
                "bugreport-2026-06-26.txt": "log content",
                "dumpstate_log.txt": "dumpstate",
                "dumpsys.txt": "dumpsys",
            },
            suffix="-logs.zip",
        )
        try:
            assert is_bugreport_zip(path) is True
        finally:
            os.unlink(path)

    def test_internal_structure_insufficient(self):
        """Zip with only 1 high-weight and nothing else should not match."""
        path = _create_temp_zip(
            {"bugreport-2026-06-26.txt": "log content"},
            suffix="-data.zip",
        )
        try:
            assert is_bugreport_zip(path) is False
        finally:
            os.unlink(path)

    def test_empty_zip_not_bugreport(self):
        """Empty zip should not be detected as bugreport."""
        path = _create_temp_zip({}, suffix="-empty.zip")
        try:
            assert is_bugreport_zip(path) is False
        finally:
            os.unlink(path)

    def test_corrupt_zip_returns_false(self):
        """A corrupt zip file should gracefully return False."""
        fd, path = tempfile.mkstemp(suffix=".zip")
        os.write(fd, b"not a zip file at all")
        os.close(fd)
        try:
            assert is_bugreport_zip(path) is False
        finally:
            os.unlink(path)

    def test_non_existent_file_returns_false(self):
        """Non-existent file with non-matching name should return False.

        Note: /nonexistent/data.zip does NOT match the bugreport filename
        pattern, and the file doesn't exist so EOCD probe also fails.
        """
        assert is_bugreport_zip("/nonexistent/path/data.zip") is False

    def test_encrypted_zip_returns_false(self):
        """Encrypted zip should return False gracefully (skip if pyzipper missing)."""
        try:
            import pyzipper  # noqa: F811
        except ImportError:
            pytest.skip("pyzipper not installed")
            return

        fd, path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        try:
            with pyzipper.AESZipFile(
                path, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES
            ) as zf:
                zf.setpassword(b"secret")
                zf.writestr("test.txt", "encrypted content")
        except Exception:
            os.unlink(path)
            pytest.skip("pyzipper encryption failed")
            return
        try:
            assert is_bugreport_zip(path) is False
        finally:
            os.unlink(path)


# ── classify_extracted_file tests ──────────────────────────────────────────


class TestClassifyExtractedFile:
    def test_main_log_by_filename(self):
        """bugreport-2026-06-26.txt should be classified as 'log'."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL")
            path = f.name
        new_path = os.path.join(os.path.dirname(path), "bugreport-2026-06-26.txt")
        os.rename(path, new_path)
        try:
            assert classify_extracted_file(new_path) == "log"
        finally:
            os.unlink(new_path)

    def test_anr_trace_by_filename(self):
        """ANR-2026-06-26-10-15-23.txt should be classified as 'anr'."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("some content")
            path = f.name
        new_path = os.path.join(os.path.dirname(path), "ANR-2026-06-26-10-15-23.txt")
        os.rename(path, new_path)
        try:
            assert classify_extracted_file(new_path) == "anr"
        finally:
            os.unlink(new_path)

    def test_anr_trace_by_content(self):
        """File containing '----- pid' and 'Cmd line:' should be classified as 'anr'."""
        content = """----- pid 1234 at 2026-06-26 10:15:23 -----
Cmd line: com.example.app
"main" prio=5 tid=1 Native
  | group="main" sCount=1 ucsCount=0 flags=1 obj=0x74a4c278 self=0xb400007cef804000
  at android.os.MessageQueue.nativePollOnce(Native method)"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(content)
            path = f.name
        try:
            assert classify_extracted_file(path) == "anr"
        finally:
            os.unlink(path)

    def test_tombstone_by_filename(self):
        """tombstone_00 should be classified as 'tombstone'."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("some content")
            path = f.name
        new_path = os.path.join(os.path.dirname(path), "tombstone_00")
        os.rename(path, new_path)
        try:
            assert classify_extracted_file(new_path) == "tombstone"
        finally:
            os.unlink(new_path)

    def test_tombstone_by_content(self):
        """File containing '*** *** ***' and 'Build fingerprint:' should be classified as 'tombstone'."""
        content = """*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
Build fingerprint: 'google/sunfish/sunfish:13/TQ3A.230805.001/123456:user/release-keys'
Revision: '0'
ABI: 'arm64'
Timestamp: 2026-06-26 10:15:23.456789+0000
Process uptime: 12345s
Cmdline: com.example.app
pid: 1234, tid: 5678, name: crasher  >>> com.example.app <<<
signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(content)
            path = f.name
        try:
            assert classify_extracted_file(path) == "tombstone"
        finally:
            os.unlink(path)

    def test_pcap_by_extension(self):
        """File with .pcap extension should be classified as 'pcap'."""
        pcap_header = (
            b"\xd4\xc3\xb2\xa1"  # magic
            b"\x02\x00"  # major
            b"\x04\x00"  # minor
            b"\x00\x00\x00\x00"  # timezone
            b"\x00\x00\x00\x00"  # sigfigs
            b"\xff\xff\x00\x00"  # snaplen
            b"\x01\x00\x00\x00"  # linktype
        )
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".pcap", delete=False) as f:
            f.write(pcap_header)
            path = f.name
        try:
            assert classify_extracted_file(path) == "pcap"
        finally:
            os.unlink(path)

    def test_pcapng_by_extension(self):
        """File with .pcapng extension should be classified as 'pcap'."""
        pcapng_header = b"\x0a\x0d\x0d\x0a" + b"\x00" * 24
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".pcapng", delete=False) as f:
            f.write(pcapng_header)
            path = f.name
        try:
            assert classify_extracted_file(path) == "pcap"
        finally:
            os.unlink(path)

    def test_hci_by_filename(self):
        """btsnoop_hci.log should be classified as 'hci'."""
        hci_header = b"btsnoop\x00" + b"\x00" * 8
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".log", delete=False) as f:
            f.write(hci_header)
            path = f.name
        new_path = os.path.join(os.path.dirname(path), "btsnoop_hci.log")
        os.rename(path, new_path)
        try:
            assert classify_extracted_file(new_path) == "hci"
        finally:
            os.unlink(new_path)

    def test_hci_by_extension(self):
        """File with .cfa extension should be classified as 'hci'."""
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".cfa", delete=False) as f:
            f.write(b"btsnoop\x00\x00\x00\x00\x00\x00\x00\x00\x00")
            path = f.name
        try:
            assert classify_extracted_file(path) == "hci"
        finally:
            os.unlink(path)

    def test_trace_by_extension(self):
        """File with .pb extension should be classified as 'trace'."""
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".pb", delete=False) as f:
            f.write(b"\x00" * 100)
            path = f.name
        try:
            assert classify_extracted_file(path) == "trace"
        finally:
            os.unlink(path)

    def test_trace_by_magic(self):
        """File with JSON trace markers should be classified as 'trace'."""
        content = '{"traceEvents": [{"ph": "X", "name": "test"}]}'
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(content)
            path = f.name
        try:
            assert classify_extracted_file(path) == "trace"
        finally:
            os.unlink(path)

    def test_generic_log_fallback(self):
        """Plain text file with no specific markers should be classified as 'log'."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("This is a generic log file\nwith multiple lines\nof plain text.")
            path = f.name
        try:
            assert classify_extracted_file(path) == "log"
        finally:
            os.unlink(path)

    def test_binary_file_other(self):
        """Binary file should be classified as 'other'."""
        # Create truly binary data — random bytes with many control chars
        binary_data = bytes([i % 256 for i in range(1024)])
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".bin", delete=False) as f:
            f.write(binary_data)
            path = f.name
        try:
            assert classify_extracted_file(path) == "other"
        finally:
            os.unlink(path)

    def test_nonexistent_file_other(self):
        """Non-existent file should return 'other'."""
        assert classify_extracted_file("/nonexistent/file.txt") == "other"

    def test_empty_file(self):
        """Empty file should return 'other'."""
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".txt", delete=False) as f:
            path = f.name
        try:
            assert classify_extracted_file(path) == "other"
        finally:
            os.unlink(path)


# ── extract_bugreport tests ────────────────────────────────────────────────


class TestExtractBugreport:
    def test_extracts_and_classifies_files(self):
        """Extract should produce correct ExtractedFileInfo list."""
        anr_content = """----- pid 1234 at 2026-06-26 10:15:23 -----
Cmd line: com.example.app
"main" prio=5 tid=1 Native"""
        tombstone_content = """*** *** *** *** *** *** *** *** *** ***
Build fingerprint: 'google/sunfish/sunfish:13/...'"""

        zip_path = _create_temp_zip(
            {
                "bugreport-2026-06-26.txt": "01-15 10:30:45.123  1234  5678 E Tag: message",
                "ANR-2026-06-26-10-15-23.txt": anr_content,
                "tombstone_00": tombstone_content,
                "dumpsys.txt": "dumpsys content here",
            },
            suffix="-bugreport.zip",
        )

        with tempfile.TemporaryDirectory() as output_dir:
            results = extract_bugreport(zip_path, output_dir)

            assert len(results) == 4

            types = {r.original_name: r.classified_type for r in results}
            assert types["bugreport-2026-06-26.txt"] == "log"
            assert types["ANR-2026-06-26-10-15-23.txt"] == "anr"
            assert types["tombstone_00"] == "tombstone"
            # dumpsys.txt — generic text → log
            assert types["dumpsys.txt"] == "log"

            for r in results:
                assert r.size > 0
                assert os.path.isabs(r.path)
                assert os.path.exists(r.path)

        os.unlink(zip_path)

    def test_extract_creates_directory_structure(self):
        """Extract should create files in the output directory."""
        zip_path = _create_temp_zip(
            {"bugreport-2026-06-26.txt": "log content"},
            suffix="-bugreport.zip",
        )

        with tempfile.TemporaryDirectory() as output_dir:
            results = extract_bugreport(zip_path, output_dir)
            assert len(results) == 1
            assert results[0].original_name == "bugreport-2026-06-26.txt"
            assert results[0].classified_type == "log"
            assert os.path.exists(results[0].path)

        os.unlink(zip_path)

    def test_extract_with_nested_directories(self):
        """Extract should handle files in subdirectories."""
        zip_path = _create_temp_zip(
            {
                "subdir/bugreport-2026-06-26.txt": "log content",
                "subdir/data.txt": "some data",
            },
            suffix="-bugreport.zip",
        )

        with tempfile.TemporaryDirectory() as output_dir:
            results = extract_bugreport(zip_path, output_dir)
            assert len(results) == 2
            names = {r.original_name for r in results}
            assert "subdir/bugreport-2026-06-26.txt" in names
            assert "subdir/data.txt" in names

        os.unlink(zip_path)

    def test_corrupt_zip_raises(self):
        """Corrupt zip should raise ValueError."""
        fd, path = tempfile.mkstemp(suffix=".zip")
        os.write(fd, b"not a valid zip")
        os.close(fd)

        with tempfile.TemporaryDirectory() as output_dir:
            with pytest.raises(ValueError, match="[Cc]orrupt"):
                extract_bugreport(path, output_dir)

        os.unlink(path)

    def test_encrypted_zip_raises(self):
        """Encrypted zip should raise ValueError (skip if pyzipper missing)."""
        try:
            import pyzipper  # noqa: F811
        except ImportError:
            pytest.skip("pyzipper not installed")
            return

        fd, path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        try:
            with pyzipper.AESZipFile(
                path, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES
            ) as zf:
                zf.setpassword(b"secret")
                zf.writestr("test.txt", "encrypted content")
        except Exception:
            os.unlink(path)
            pytest.skip("pyzipper encryption failed")
            return

        with tempfile.TemporaryDirectory() as output_dir:
            with pytest.raises(ValueError, match="[Ee]ncrypted|[Uu]nreadable"):
                extract_bugreport(path, output_dir)

        os.unlink(path)

    def test_empty_zip_returns_empty_list(self):
        """Empty zip should return an empty list."""
        zip_path = _create_temp_zip({}, suffix="-bugreport.zip")

        with tempfile.TemporaryDirectory() as output_dir:
            results = extract_bugreport(zip_path, output_dir)
            assert results == []

        os.unlink(zip_path)


# ── Security tests ─────────────────────────────────────────────────────────


class TestSecurity:
    def test_zip_bomb_detection(self):
        """Zip with extreme compression ratio should be rejected."""
        fd, path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)

        # Create a zip bomb: lots of highly compressible data
        huge_repeated = b"A" * (1024 * 1024)  # 1 MB of 'A's (compresses to ~1KB)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for i in range(600):
                zf.writestr(f"file_{i}.txt", huge_repeated)

        with tempfile.TemporaryDirectory() as output_dir:
            with pytest.raises(ValueError, match="[Zz]ip bomb|[Cc]ompression ratio"):
                extract_bugreport(path, output_dir)

        os.unlink(path)

    def test_path_traversal_protection(self):
        """Normal extraction should work (path traversal guarded in _extract_archive_to_disk)."""
        zip_path = _create_temp_zip({"safe_file.txt": "content"}, suffix="-safe.zip")

        with tempfile.TemporaryDirectory() as output_dir:
            results = extract_bugreport(zip_path, output_dir)
            assert len(results) == 1
            assert results[0].original_name == "safe_file.txt"

        os.unlink(zip_path)

    def test_is_within_base_valid(self):
        """_is_within_base should return True for valid subpath."""
        assert _is_within_base("/tmp", "/tmp/sub/file.txt") is True

    def test_is_within_base_traversal(self):
        """_is_within_base should return False for path traversal."""
        assert _is_within_base("/tmp", "/etc/passwd") is False

    def test_is_within_base_nonexistent(self):
        """_is_within_base — nonexistent paths can still be logically within each other."""
        # Both paths don't exist, but "sub" is logically within the base
        assert _is_within_base("/nonexistent_base_12345", "/nonexistent_base_12345/sub") is True

    def test_is_within_base_different_nonexistent(self):
        """_is_within_base should return False for different nonexistent roots."""
        assert _is_within_base("/nonexistent_a", "/nonexistent_b/file") is False


# ── Internal helper tests ──────────────────────────────────────────────────


class TestCountMatching:
    def test_single_match(self):
        assert _count_matching(["bugreport-2026-06-26.txt"], ["bugreport-*.txt"]) == 1

    def test_no_match(self):
        assert _count_matching(["other.txt"], ["bugreport-*.txt"]) == 0

    def test_multiple_globs(self):
        names = ["bugreport-2026-06-26.txt", "ANR-2026-06-26.txt", "other.txt"]
        # other.txt matches other*
        assert _count_matching(names, ["bugreport-*.txt", "ANR-*.txt", "other*"]) == 3

    def test_one_name_satisfies_multiple_globs(self):
        """Each glob is counted once if any name matches it."""
        names = ["bugreport-2026-06-26.txt"]
        assert _count_matching(names, ["bugreport-*.txt", "*-2026-*.txt"]) == 2


class TestLooksLikeText:
    def test_plain_text(self):
        assert _looks_like_text(b"Hello, world!\nThis is text.") is True

    def test_logcat_text(self):
        text = b"01-15 10:30:45.123  1234  5678 E Tag: message\n"
        assert _looks_like_text(text) is True

    def test_binary_data(self):
        assert _looks_like_text(bytes(range(256))) is False

    def test_empty(self):
        assert _looks_like_text(b"") is True

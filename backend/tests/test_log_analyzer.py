"""Tests for the log analyzer service."""

import gzip
import io
import struct
import zipfile

import pytest

from ala.services.log_analyzer import LogAnalyzer, LogFilters, LogFormat, extract_text_files


@pytest.fixture
def analyzer():
    return LogAnalyzer()


SAMPLE_LOGCAT = """01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
"""


class TestLogParsing:
    def test_parse_android_logcat(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        assert result.total_lines == 5
        assert result.format_detected == "android_logcat"
        assert result.logs[0].level == "E"
        assert result.logs[0].tag == "AndroidRuntime"
        assert result.logs[0].pid == "1234"
        assert result.logs[0].tid == "5678"

    def test_parse_empty_content(self, analyzer):
        result = analyzer.parse_log("")
        assert result.total_lines == 0
        assert len(result.logs) == 0

    def test_parse_generic_log(self, analyzer):
        content = (
            "[2024-01-15 10:30:45] ERROR: Something went wrong\n"
            "[2024-01-15 10:30:46] INFO: Server started\n"
        )
        result = analyzer.parse_log(content)
        assert result.total_lines == 2
        assert result.format_detected in ("generic_timestamped", "android_logcat", "unknown")

    def test_parse_with_source_file(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT, source_file="device.log")
        assert all(e.source_file == "device.log" for e in result.logs)


class TestLogFiltering:
    def test_filter_by_level(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(level="E")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert all(e.level == "E" for e in filtered)
        assert len(filtered) == 2

    def test_filter_by_tag(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(tag="AndroidRuntime")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) == 2

    def test_filter_by_keyword(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(keywords="FATAL")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) >= 1

    def test_filter_no_match(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(keywords="XXXXXXXXXNOTFOUND")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) == 0

    def test_filter_tag_keyword_or(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        filters = LogFilters(tag="ActivityManager", keywords="FATAL", tag_keyword_relation="OR")
        filtered = analyzer.filter_logs(result.logs, filters)
        assert len(filtered) >= 2


class TestStatistics:
    def test_statistics(self, analyzer):
        result = analyzer.parse_log(SAMPLE_LOGCAT)
        stats = analyzer.get_statistics(result.logs)
        assert stats.total == 5
        assert stats.by_level["E"] == 2
        assert stats.by_level["D"] == 1
        assert stats.by_level["I"] == 1
        assert stats.by_level["W"] == 1


class TestExtractTextFiles:
    """Unit tests for archive extraction helpers."""

    def test_plain_text(self):
        data = b"hello log line\n"
        result = extract_text_files(data, "device.log")
        assert len(result) == 1
        assert result[0][0] == "device.log"
        assert result[0][1] == data

    def test_gzip(self):
        original = SAMPLE_LOGCAT.encode()
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(original)
        gz_data = buf.getvalue()
        result = extract_text_files(gz_data, "device.log.gz")
        assert len(result) == 1
        assert result[0][0] == "device.log"
        assert result[0][1] == original

    def test_zip_single_log(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
        result = extract_text_files(buf.getvalue(), "logs.zip")
        assert len(result) == 1
        assert result[0][0] == "system.log"
        assert result[0][1].decode() == SAMPLE_LOGCAT

    def test_zip_multiple_logs(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
            zf.writestr("radio.log", SAMPLE_LOGCAT)
        result = extract_text_files(buf.getvalue(), "bugreport.zip")
        assert len(result) == 2
        names = {r[0] for r in result}
        assert names == {"system.log", "radio.log"}

    def test_zip_skips_non_log_members(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("system.log", SAMPLE_LOGCAT)
            zf.writestr("image.png", b"\x89PNG\r\n")
        result = extract_text_files(buf.getvalue(), "mixed.zip")
        assert len(result) == 1
        assert result[0][0] == "system.log"

    def test_invalid_gzip_raises(self):
        with pytest.raises(ValueError, match="Invalid gzip"):
            extract_text_files(b"notgzip", "bad.gz")

    def test_invalid_zip_raises(self):
        with pytest.raises(ValueError, match="Invalid ZIP"):
            extract_text_files(b"notzip", "bad.zip")


class TestMultiFileParsing:
    """Tests for parse_log_bytes and stream_log_bytes."""

    def test_parse_plain_file(self, analyzer):
        results = analyzer.parse_log_bytes(SAMPLE_LOGCAT.encode(), "device.log")
        assert len(results) == 1
        assert results[0].total_lines == 5

    def test_parse_gz_file(self, analyzer):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(SAMPLE_LOGCAT.encode())
        results = analyzer.parse_log_bytes(buf.getvalue(), "device.log.gz")
        assert len(results) == 1
        assert results[0].total_lines == 5
        assert all(e.source_file == "device.log" for e in results[0].logs)

    def test_parse_zip_two_files(self, analyzer):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.log", SAMPLE_LOGCAT)
            zf.writestr("b.log", SAMPLE_LOGCAT)
        results = analyzer.parse_log_bytes(buf.getvalue(), "logs.zip")
        assert len(results) == 2
        for r in results:
            assert r.total_lines == 5

    def test_stream_gz_yields_entries(self, analyzer):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(SAMPLE_LOGCAT.encode())
        entries = list(analyzer.stream_log_bytes(buf.getvalue(), "device.log.gz"))
        assert len(entries) == 5

    def test_stream_zip_yields_all_entries(self, analyzer):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.log", SAMPLE_LOGCAT)
            zf.writestr("b.log", SAMPLE_LOGCAT)
        entries = list(analyzer.stream_log_bytes(buf.getvalue(), "logs.zip"))
        assert len(entries) == 10


def _create_minimal_pcap() -> bytes:
    """Create a minimal valid pcap file with one packet for testing."""
    # PCAP global header (little-endian)
    magic_number = 0xA1B2C3D4  # pcap magic
    version_major = 2
    version_minor = 4
    thiszone = 0
    sigfigs = 0
    snaplen = 65535
    network = 1  # Ethernet

    header = struct.pack(
        "<IHHIIII",
        magic_number,
        version_major,
        version_minor,
        thiszone,
        sigfigs,
        snaplen,
        network,
    )

    # Simple Ethernet + IP + TCP packet header
    # Packet record header
    ts_sec = 1609459200  # 2021-01-01 00:00:00
    ts_usec = 0
    incl_len = 54  # Ethernet(14) + IP(20) + TCP(20)
    orig_len = 54

    packet_header = struct.pack("<IIII", ts_sec, ts_usec, incl_len, orig_len)

    # Ethernet frame (14 bytes)
    eth_dst = b"\x00\x00\x00\x00\x00\x00"
    eth_src = b"\x00\x00\x00\x00\x00\x01"
    eth_type = b"\x08\x00"  # IPv4
    eth_frame = eth_dst + eth_src + eth_type

    # IP header (20 bytes)
    ip_header = (
        b"\x45\x00\x00\x28"  # Version, IHL, TOS, Total Length
        b"\x00\x00\x40\x00"  # ID, Flags, Fragment Offset
        b"\x40\x06\x00\x00"  # TTL, Protocol (TCP=6), Checksum
        b"\xc0\xa8\x01\x01"  # Source IP: 192.168.1.1
        b"\xc0\xa8\x01\x02"  # Dest IP: 192.168.1.2
    )

    # TCP header (20 bytes)
    tcp_header = (
        b"\x00\x50"  # Source port: 80
        b"\x04\x00"  # Dest port: 1024
        b"\x00\x00\x00\x00"  # Sequence number
        b"\x00\x00\x00\x00"  # Acknowledgment number
        b"\x50\x02"  # Data offset, flags (SYN)
        b"\x20\x00"  # Window size
        b"\x00\x00"  # Checksum
        b"\x00\x00"  # Urgent pointer
    )

    packet = eth_frame + ip_header + tcp_header

    return header + packet_header + packet


class TestPcapParsing:
    """Tests for pcap file parsing."""

    def test_is_pcap_data(self, analyzer):
        """Test pcap magic byte detection."""
        pcap_data = _create_minimal_pcap()
        assert analyzer._is_pcap_data(pcap_data)

        # Test non-pcap data
        assert not analyzer._is_pcap_data(b"hello world")
        assert not analyzer._is_pcap_data(b"")
        assert not analyzer._is_pcap_data(SAMPLE_LOGCAT.encode())

    def test_parse_pcap_file(self, analyzer):
        """Test parsing a minimal pcap file."""
        pytest.importorskip("scapy")
        pcap_data = _create_minimal_pcap()
        results = analyzer.parse_log_bytes(pcap_data, "capture.pcap")

        assert len(results) == 1
        result = results[0]
        assert result.format_detected == LogFormat.PCAP.value
        assert result.total_lines >= 1
        assert len(result.logs) >= 1

        # Check first packet entry
        entry = result.logs[0]
        assert entry.line_number == 1
        assert entry.timestamp is not None  # Should have extracted timestamp
        assert entry.tag in ("TCP", "UNKNOWN")  # Should detect protocol
        assert entry.source_file == "capture.pcap"
        assert entry.level in ("D", "I", "W", "E", "U")  # Valid log level

    def test_stream_pcap_file(self, analyzer):
        """Test streaming pcap file."""
        pytest.importorskip("scapy")
        pcap_data = _create_minimal_pcap()
        entries = list(analyzer.stream_log_bytes(pcap_data, "capture.pcap"))

        assert len(entries) >= 1
        entry = entries[0]
        assert entry.timestamp is not None
        assert entry.source_file == "capture.pcap"

    def test_pcap_in_zip(self, analyzer):
        """Test parsing pcap file inside a zip archive."""
        pytest.importorskip("scapy")
        pcap_data = _create_minimal_pcap()

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("network.pcap", pcap_data)

        results = analyzer.parse_log_bytes(buf.getvalue(), "logs.zip")
        assert len(results) == 1
        assert results[0].format_detected == LogFormat.PCAP.value

    def test_pcap_without_scapy_raises(self, analyzer, monkeypatch):
        """Test that parsing pcap without scapy raises helpful error."""
        # Mock SCAPY_AVAILABLE to False
        import ala.services.log_analyzer

        monkeypatch.setattr(ala.services.log_analyzer, "SCAPY_AVAILABLE", False)

        pcap_data = _create_minimal_pcap()
        with pytest.raises(ValueError, match="scapy library not installed"):
            analyzer.parse_log_bytes(pcap_data, "capture.pcap")


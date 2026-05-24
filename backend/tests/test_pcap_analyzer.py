"""Tests for the PCAP analyzer service."""

import io
import struct
import zipfile

import pytest

from ala.services.pcap_analyzer import PcapAnalyzer, PcapFilters

SAMPLE_LOGCAT = "01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main\n"


@pytest.fixture
def analyzer():
    return PcapAnalyzer()


def _create_minimal_pcap() -> bytes:
    """Create a minimal valid pcap file with one TCP packet for testing."""
    # PCAP global header (little-endian)
    header = struct.pack(
        "<IHHIIII",
        0xA1B2C3D4,  # magic (little-endian)
        2,  # version_major
        4,  # version_minor
        0,  # thiszone
        0,  # sigfigs
        65535,  # snaplen
        1,  # network (Ethernet)
    )

    # Packet record header
    ts_sec = 1609459200  # 2021-01-01 00:00:00 UTC
    packet_header = struct.pack("<IIII", ts_sec, 0, 54, 54)

    # Ethernet frame (14 bytes): dst + src + type=IPv4
    eth_frame = b"\x00" * 6 + b"\x00\x00\x00\x00\x00\x01" + b"\x08\x00"

    # IP header (20 bytes): src=192.168.1.1, dst=192.168.1.2, proto=TCP
    ip_header = (
        b"\x45\x00\x00\x28"
        b"\x00\x00\x40\x00"
        b"\x40\x06\x00\x00"
        b"\xc0\xa8\x01\x01"  # 192.168.1.1
        b"\xc0\xa8\x01\x02"  # 192.168.1.2
    )

    # TCP header (20 bytes): sport=80, dport=1024, flags=SYN
    tcp_header = (
        b"\x00\x50"  # src port: 80
        b"\x04\x00"  # dst port: 1024
        b"\x00\x00\x00\x00"  # seq
        b"\x00\x00\x00\x00"  # ack
        b"\x50\x02"  # data offset, SYN flag
        b"\x20\x00"  # window
        b"\x00\x00"  # checksum
        b"\x00\x00"  # urgent
    )

    return header + packet_header + eth_frame + ip_header + tcp_header


class TestPcapMagicDetection:
    """Tests for PCAP magic byte detection."""

    def test_pcap_data_detected(self, analyzer):
        pcap_data = _create_minimal_pcap()
        assert analyzer._is_pcap_data(pcap_data)

    def test_non_pcap_data_rejected(self, analyzer):
        assert not analyzer._is_pcap_data(b"hello world")
        assert not analyzer._is_pcap_data(b"")
        assert not analyzer._is_pcap_data(SAMPLE_LOGCAT.encode())

    def test_all_pcap_magic_variants(self, analyzer):
        for magic in [
            b"\xd4\xc3\xb2\xa1",  # little-endian
            b"\xa1\xb2\xc3\xd4",  # big-endian
            b"\x4d\x3c\xb2\xa1",  # nanosecond LE
            b"\xa1\xb2\x3c\x4d",  # nanosecond BE
            b"\x0a\x0d\x0d\x0a",  # pcapng
        ]:
            assert analyzer._is_pcap_data(magic + b"\x00" * 20)


class TestPcapParsing:
    """Tests for parsing PCAP files via PcapAnalyzer."""

    def test_parse_minimal_pcap(self, analyzer):
        pytest.importorskip("scapy")
        result = analyzer.parse_pcap(_create_minimal_pcap(), "capture.pcap")

        assert result.total_packets >= 1
        assert result.format_detected in ("pcap", "pcapng")
        assert len(result.entries) >= 1

        entry = result.entries[0]
        assert entry.packet_number == 1
        assert entry.timestamp is not None
        assert entry.protocol in ("TCP", "UNKNOWN")
        assert entry.src_ip == "192.168.1.1"
        assert entry.dst_ip == "192.168.1.2"
        assert entry.src_port == 80
        assert entry.dst_port == 1024
        assert entry.source_file == "capture.pcap"

    def test_timestamp_is_utc(self, analyzer):
        """Timestamps must use UTC (not local time) to avoid TZ-dependent comparisons."""
        pytest.importorskip("scapy")
        result = analyzer.parse_pcap(_create_minimal_pcap(), "capture.pcap")
        ts = result.entries[0].timestamp
        assert ts is not None
        # The packet has ts_sec=1609459200 which is 2021-01-01 00:00:00 UTC
        assert ts.startswith("2021-01-01 00:00:00")

    def test_stream_packets(self, analyzer):
        pytest.importorskip("scapy")
        packets = list(analyzer.stream_pcap(_create_minimal_pcap(), "capture.pcap"))
        assert len(packets) >= 1
        assert packets[0].source_file == "capture.pcap"

    def test_parse_pcap_in_zip(self, analyzer):
        pytest.importorskip("scapy")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("network.pcap", _create_minimal_pcap())

        result = analyzer.parse_pcap(buf.getvalue(), "logs.zip")
        assert result.total_packets >= 1

    def test_parse_without_scapy_raises(self, analyzer, monkeypatch):
        import ala.services.pcap_analyzer

        monkeypatch.setattr(ala.services.pcap_analyzer, "SCAPY_AVAILABLE", False)
        with pytest.raises(ValueError, match="scapy library not installed"):
            analyzer.parse_pcap(_create_minimal_pcap(), "capture.pcap")


class TestPcapFiltering:
    """Tests for PCAP entry filtering."""

    @pytest.fixture
    def entries(self, analyzer):
        pytest.importorskip("scapy")
        return analyzer.parse_pcap(_create_minimal_pcap(), "capture.pcap").entries

    def test_filter_by_protocol(self, analyzer, entries):
        f = PcapFilters(protocol="TCP")
        result = analyzer.filter_pcap(entries, f)
        assert all(e.protocol == "TCP" for e in result)

    def test_filter_by_src_ip(self, analyzer, entries):
        f = PcapFilters(src_ip="192.168.1.1")
        result = analyzer.filter_pcap(entries, f)
        assert all("192.168.1.1" in e.src_ip for e in result)

    def test_filter_by_src_port(self, analyzer, entries):
        f = PcapFilters(src_port=80)
        result = analyzer.filter_pcap(entries, f)
        assert all(e.src_port == 80 for e in result)

    def test_empty_filter_returns_all(self, analyzer, entries):
        result = analyzer.filter_pcap(entries, PcapFilters())
        assert len(result) == len(entries)


class TestPcapStatistics:
    """Tests for compute_statistics."""

    @pytest.fixture
    def entries(self, analyzer):
        pytest.importorskip("scapy")
        return analyzer.parse_pcap(_create_minimal_pcap(), "capture.pcap").entries

    def test_basic_statistics(self, analyzer, entries):
        stats = analyzer.compute_statistics(entries)
        assert stats.total == len(entries)
        assert "TCP" in stats.by_protocol
        assert stats.unique_ips >= 2

    def test_empty_statistics(self, analyzer):
        stats = analyzer.compute_statistics([])
        assert stats.total == 0
        assert stats.duration_seconds is None

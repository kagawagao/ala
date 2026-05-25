"""Tests for the Bluetooth HCI (BTSnoop) analyzer service."""

import io
import struct
import zipfile

import pytest

from ala.services.hci_analyzer import HciAnalyzer, HciFilters


@pytest.fixture
def analyzer():
    return HciAnalyzer()


def _create_btsnoop_header(version: int = 1, data_link_type: int = 1001) -> bytes:
    """Create a valid BTSnoop file header (16 bytes)."""
    magic = b"btsnoop\x00"  # 8 bytes
    return magic + struct.pack(">II", version, data_link_type)


def _create_packet_record(
    original_length: int,
    included_length: int,
    packet_flags: int,
    cumulative_drops: int,
    timestamp_us: int,
    payload: bytes,
) -> bytes:
    """Create a BTSnoop packet record (24-byte header + payload)."""
    header = struct.pack(
        ">IIIIQ",
        original_length,
        included_length,
        packet_flags,
        cumulative_drops,
        timestamp_us,
    )
    return header + payload


def _create_minimal_btsnoop() -> bytes:
    """Create a minimal valid BTSnoop file with one command and one event packet."""
    ts_base = 1609459200000000  # 2021-01-01T00:00:00 in Unix microseconds

    header = _create_btsnoop_header()

    # HCI Command: LE_CREATE_CONNECTION (OGF=0x08, OCF=0x17 → opcode=0x2017)
    cmd_payload = struct.pack(
        "<HHIHH15s",
        0x2017,  # opcode LE_CREATE_CONNECTION
        0x0019,  # parameter length 25
        # Scan params
        0x0010,  # scan_interval (2 bytes)
        0x0010,  # scan_window (2 bytes)
        0x0000,  # initiator_filter + own_addr_type
        b"\x00\x00\x00\x00\x00\x00\x00" + b"\x00" * 8,  # peer address + params
    )
    flags_cmd = 0x00  # bit 0=0 (Host→Controller), bits 2-3=0 (Command)
    pkt1 = _create_packet_record(
        len(cmd_payload), len(cmd_payload), flags_cmd, 0, ts_base, cmd_payload
    )

    # HCI Event: COMMAND_COMPLETE (0x0E)
    evt_payload = struct.pack(
        "<BBHHB",
        0x0E,  # event code = COMMAND_COMPLETE
        0x04,  # parameter length
        0x01,  # num_hci_command_packets
        0x2017,  # opcode (uint16 little-endian)
        0x00,  # status = OK
    )
    flags_evt = 0x0D  # bit 0=1 (Controller→Host), bits 2-3=3 (Event)
    pkt2 = _create_packet_record(
        len(evt_payload), len(evt_payload), flags_evt, 0, ts_base + 1000, evt_payload
    )

    return header + pkt1 + pkt2


def _create_acl_btsnoop() -> bytes:
    """Create a BTSnoop file with an ACL data packet."""
    ts_base = 1609459200000000

    header = _create_btsnoop_header()

    # ACL data packet
    acl_payload = (
        struct.pack(
            "<HH",
            0x000A,  # handle 10 + PB=00 + BC=00
            18,  # data length
        )
        + b"Hello Bluetooth!"
    )

    flags_acl = 0x06  # bit 0=0 (Host→Controller), bits 2-3=1 (ACL)
    pkt = _create_packet_record(
        len(acl_payload) + 4, len(acl_payload) + 4, flags_acl, 0, ts_base + 2000, acl_payload
    )

    return header + pkt


class TestHciMagicDetection:
    """Tests for BTSnoop magic byte detection."""

    def test_hci_data_detected(self, analyzer):
        data = _create_minimal_btsnoop()
        assert analyzer._is_hci_data(data)

    def test_non_hci_data_rejected(self, analyzer):
        assert not analyzer._is_hci_data(b"hello world")
        assert not analyzer._is_hci_data(b"")
        assert not analyzer._is_hci_data(b"btsnoop")  # missing null byte
        assert not analyzer._is_hci_data(struct.pack(">I", 0xA1B2C3D4))  # PCAP magic

    def test_btsnoop_magic_bytes_exact(self, analyzer):
        assert analyzer._is_hci_data(b"btsnoop\x00")
        assert not analyzer._is_hci_data(b"BTSNOOP\x00")  # case sensitive
        assert not analyzer._is_hci_data(b"btsnoop")  # too short


class TestHciParsing:
    """Tests for HCI packet parsing."""

    def test_parse_minimal_btsnoop(self, analyzer):
        data = _create_minimal_btsnoop()
        result = analyzer.parse_hci(data)

        assert result.format_detected == "btsnoop"
        assert result.total_packets == 2
        assert len(result.entries) == 2
        assert result.file_size == len(data)

    def test_parse_yields_correct_packet_types(self, analyzer):
        data = _create_minimal_btsnoop()
        result = analyzer.parse_hci(data)

        cmd = result.entries[0]
        assert cmd.hci_type == "COMMAND"
        assert cmd.direction == "HOST_TO_CONTROLLER"
        assert cmd.opcode == 0x2017
        assert cmd.opcode_name == "LE_CREATE_CONNECTION"
        assert cmd.event_code is None

        evt = result.entries[1]
        assert evt.hci_type == "EVENT"
        assert evt.direction == "CONTROLLER_TO_HOST"
        assert evt.event_code == 0x0E
        assert evt.event_name == "COMMAND_COMPLETE"
        assert evt.opcode is None

    def test_parse_acl_packet(self, analyzer):
        data = _create_acl_btsnoop()
        result = analyzer.parse_hci(data)

        assert result.total_packets == 1
        entry = result.entries[0]
        assert entry.hci_type == "ACL_DATA"

    def test_timestamp_is_formatted(self, analyzer):
        data = _create_minimal_btsnoop()
        result = analyzer.parse_hci(data)

        ts = result.entries[0].timestamp
        assert ts is not None
        assert ts.startswith("2021-01-01")

    def test_stream_hci_packets(self, analyzer):
        data = _create_minimal_btsnoop()
        entries = list(analyzer.stream_hci(data))

        assert len(entries) == 2
        assert entries[0].packet_number == 1
        assert entries[1].packet_number == 2

    def test_parse_rejects_non_btsnoop(self, analyzer):
        with pytest.raises(ValueError, match="valid BTSnoop"):
            analyzer.parse_hci(b"not a btsnoop file")

    def test_parse_truncated_file(self, analyzer):
        with pytest.raises(ValueError, match="too small"):
            analyzer.parse_hci(b"btsnoop\x00")  # only header magic, no full header

    def test_parse_btsnoop_in_zip(self, analyzer):
        data = _create_minimal_btsnoop()
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("btsnoop_hci.log", data)
        zip_data = zip_buf.getvalue()

        result = analyzer.parse_hci(zip_data, filename="capture.zip")
        assert result.total_packets == 2
        assert result.format_detected == "btsnoop"


class TestHciFiltering:
    """Tests for HCI entry filtering."""

    @pytest.fixture
    def entries(self, analyzer):
        data = _create_minimal_btsnoop()
        return analyzer.parse_hci(data).entries

    def test_filter_by_direction(self, analyzer, entries):
        filters = HciFilters(direction="HOST_TO_CONTROLLER")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1
        assert result[0].hci_type == "COMMAND"

    def test_filter_by_hci_type(self, analyzer, entries):
        filters = HciFilters(hci_type="EVENT")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1
        assert result[0].hci_type == "EVENT"

    def test_filter_by_opcode(self, analyzer, entries):
        filters = HciFilters(opcode=0x2017)
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1
        assert result[0].opcode == 0x2017

    def test_filter_by_opcode_name_substring(self, analyzer, entries):
        filters = HciFilters(opcode_name="CREATE_CONNECTION")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1

    def test_filter_by_event_code(self, analyzer, entries):
        filters = HciFilters(event_code=0x0E)
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1
        assert result[0].event_code == 0x0E

    def test_filter_by_event_name_substring(self, analyzer, entries):
        filters = HciFilters(event_name="COMMAND_COMPLETE")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1

    def test_filter_by_keywords(self, analyzer, entries):
        filters = HciFilters(keywords="LE_CREATE")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1

    def test_empty_filter_returns_all(self, analyzer, entries):
        filters = HciFilters()
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 2

    def test_chained_filters(self, analyzer, entries):
        filters = HciFilters(direction="CONTROLLER_TO_HOST", hci_type="EVENT")
        result = analyzer.filter_hci(entries, filters)
        assert len(result) == 1

        filters2 = HciFilters(direction="HOST_TO_CONTROLLER", hci_type="EVENT")
        result2 = analyzer.filter_hci(entries, filters2)
        assert len(result2) == 0


class TestHciStatistics:
    """Tests for HCI statistics computation."""

    @pytest.fixture
    def entries(self, analyzer):
        data = _create_minimal_btsnoop()
        return analyzer.parse_hci(data).entries

    def test_basic_statistics(self, analyzer, entries):
        stats = analyzer.compute_statistics(entries)

        assert stats.total == 2
        assert stats.by_direction["HOST_TO_CONTROLLER"] == 1
        assert stats.by_direction["CONTROLLER_TO_HOST"] == 1
        assert stats.by_type["COMMAND"] == 1
        assert stats.by_type["EVENT"] == 1
        assert stats.unique_opcodes == 1  # only cmd has opcode
        assert stats.duration_seconds is not None
        assert stats.duration_seconds > 0

    def test_empty_statistics(self, analyzer):
        stats = analyzer.compute_statistics([])
        assert stats.total == 0
        assert stats.by_direction == {}
        assert stats.duration_seconds is None


class TestHciOpcodeDecoding:
    """Tests for HCI opcode and event code decoding."""

    def test_decode_known_opcode(self):
        from ala.services.hci_analyzer import _decode_opcode

        ogf, ocf, name = _decode_opcode(0x2017)
        assert ogf == 0x08  # LE Controller
        assert ocf == 0x17
        assert name == "LE_CREATE_CONNECTION"

    def test_decode_unknown_opcode(self):
        from ala.services.hci_analyzer import _decode_opcode

        ogf, ocf, name = _decode_opcode(0xFFFF)
        assert name, "Should get a generated name"  # noqa: S101
        assert "0xFFFF" in name or "VENDOR" in name

    def test_decode_known_event(self):
        from ala.services.hci_analyzer import _decode_event

        name = _decode_event(0x0E)
        assert name == "COMMAND_COMPLETE"

    def test_decode_le_meta_event(self):
        from ala.services.hci_analyzer import _decode_event

        # LE_META_EVENT with sub-event LE_CONNECTION_COMPLETE (0x01)
        name = _decode_event(0x3E, b"\x01")
        assert "LE_META" in name
        assert "LE_CONNECTION_COMPLETE" in name

    def test_decode_unknown_event(self):
        from ala.services.hci_analyzer import _decode_event

        name = _decode_event(0xAB)
        assert "UNKNOWN" in name or "0xAB" in name

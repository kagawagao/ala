"""PCAP network capture analyzer service."""

import gzip
import io
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

try:
    from scapy.all import PcapReader
    from scapy.layers.inet import IP, TCP, UDP
    from scapy.layers.inet6 import IPv6
    from scapy.packet import Packet

    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False


@dataclass
class PcapEntry:
    """A single packet from a PCAP file."""

    packet_number: int
    timestamp: str | None
    protocol: str  # TCP, UDP, ICMP, etc.
    src_ip: str
    dst_ip: str
    src_port: int | None
    dst_port: int | None
    length: int
    tcp_flags: str | None  # SYN, ACK, FIN, RST, etc.
    info: str  # Human-readable packet summary
    raw_summary: str
    source_file: str | None = None


@dataclass
class PcapFilters:
    """Filter criteria for PCAP entries."""

    start_time: str | None = None
    end_time: str | None = None
    protocol: str | None = None  # TCP, UDP, etc.
    src_ip: str | None = None
    dst_ip: str | None = None
    src_port: int | None = None
    dst_port: int | None = None
    tcp_flags: str | None = None  # Filter by TCP flags
    keywords: str | None = None  # Search in info field


@dataclass
class PcapStatistics:
    """Statistics about parsed PCAP entries."""

    total: int
    by_protocol: dict[str, int]  # Protocol -> count
    unique_ips: int
    unique_connections: int
    duration_seconds: float | None


@dataclass
class PcapParseResult:
    """Result of parsing a PCAP file."""

    entries: list[PcapEntry]
    total_packets: int
    format_detected: str  # "pcap" or "pcapng"
    file_size: int


class PcapAnalyzer:
    """Analyzer for PCAP network capture files."""

    @staticmethod
    def _is_pcap_data(data: bytes) -> bool:
        """Check if data starts with pcap or pcapng magic bytes."""
        if len(data) < 4:
            return False
        magic = data[:4]
        pcap_magics = [
            b"\xd4\xc3\xb2\xa1",  # pcap little-endian
            b"\xa1\xb2\xc3\xd4",  # pcap big-endian
            b"\x4d\x3c\xb2\xa1",  # pcap nanosecond little-endian
            b"\xa1\xb2\x3c\x4d",  # pcap nanosecond big-endian
            b"\x0a\x0d\x0d\x0a",  # pcapng
        ]
        return magic in pcap_magics

    def parse_pcap(self, data: bytes, filename: str = "capture.pcap") -> PcapParseResult:
        """Parse a PCAP file from raw bytes.

        Args:
            data: Raw bytes of the PCAP file
            filename: Original filename for error messages and format detection

        Returns:
            PcapParseResult with all parsed packets

        Raises:
            ValueError: If scapy is not available or parsing fails
        """
        if not SCAPY_AVAILABLE:
            raise ValueError(
                "Cannot parse pcap file: scapy library not installed. "
                "Install with: pip install scapy"
            )

        # Handle .gz compression
        if filename.lower().endswith(".gz"):
            try:
                data = gzip.decompress(data)
                filename = filename[:-3]  # Strip .gz
            except gzip.BadGzipFile as exc:
                raise ValueError(f"Invalid gzip file: {exc}") from exc

        # Handle .zip archives
        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    # Find first .pcap or .pcapng file
                    for info in zf.infolist():
                        if info.filename.lower().endswith((".pcap", ".pcapng")):
                            data = zf.read(info.filename)
                            filename = info.filename
                            break
                    else:
                        raise ValueError("No .pcap or .pcapng file found in zip archive")
            except zipfile.BadZipFile as exc:
                raise ValueError(f"Invalid ZIP file: {exc}") from exc

        if not self._is_pcap_data(data):
            raise ValueError("File does not appear to be a valid PCAP or PCAPNG file")

        # Detect format
        format_detected = "pcapng" if data[:4] == b"\x0a\x0d\x0d\x0a" else "pcap"

        entries = list(self._parse_pcap_bytes_iter(data, filename))

        return PcapParseResult(
            entries=entries,
            total_packets=len(entries),
            format_detected=format_detected,
            file_size=len(data),
        )

    def stream_pcap(self, data: bytes, filename: str = "capture.pcap") -> Iterator[PcapEntry]:
        """Stream packets from a PCAP file one by one.

        Args:
            data: Raw bytes of the PCAP file
            filename: Original filename

        Yields:
            PcapEntry objects one at a time

        Raises:
            ValueError: If scapy is not available or parsing fails
        """
        if not SCAPY_AVAILABLE:
            raise ValueError(
                "Cannot parse pcap file: scapy library not installed. "
                "Install with: pip install scapy"
            )

        # Handle compression (same as parse_pcap)
        if filename.lower().endswith(".gz"):
            try:
                data = gzip.decompress(data)
                filename = filename[:-3]
            except gzip.BadGzipFile as exc:
                raise ValueError(f"Invalid gzip file: {exc}") from exc

        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    for info in zf.infolist():
                        if info.filename.lower().endswith((".pcap", ".pcapng")):
                            data = zf.read(info.filename)
                            filename = info.filename
                            break
                    else:
                        raise ValueError("No .pcap or .pcapng file found in zip archive")
            except zipfile.BadZipFile as exc:
                raise ValueError(f"Invalid ZIP file: {exc}") from exc

        if not self._is_pcap_data(data):
            raise ValueError("File does not appear to be a valid PCAP or PCAPNG file")

        yield from self._parse_pcap_bytes_iter(data, filename)

    def _parse_pcap_bytes_iter(
        self, data: bytes, source_file: str | None = None
    ) -> Iterator[PcapEntry]:
        """Parse pcap bytes and yield PcapEntry objects one by one."""
        pcap_io = io.BytesIO(data)
        try:
            reader = PcapReader(pcap_io)
            packet_number = 0
            for pkt in reader:
                packet_number += 1
                yield self._packet_to_entry(pkt, packet_number, source_file)
        except Exception as e:
            raise ValueError(f"Failed to parse pcap file: {e}") from e
        finally:
            pcap_io.close()

    def _packet_to_entry(
        self, pkt: "Packet", packet_number: int, source_file: str | None = None
    ) -> PcapEntry:
        """Convert a scapy Packet to a PcapEntry."""
        # Extract timestamp
        timestamp = None
        if hasattr(pkt, "time") and pkt.time:
            timestamp = datetime.fromtimestamp(pkt.time).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

        # Extract network layer info
        protocol = "UNKNOWN"
        src_ip = "?"
        dst_ip = "?"
        src_port = None
        dst_port = None
        tcp_flags = None

        # Check for IP layer
        if IP in pkt:
            ip_layer = pkt[IP]
            src_ip = ip_layer.src
            dst_ip = ip_layer.dst
            protocol = ip_layer.sprintf("%IP.proto%")
        elif IPv6 in pkt:
            ip_layer = pkt[IPv6]
            src_ip = ip_layer.src
            dst_ip = ip_layer.dst
            protocol = ip_layer.sprintf("%IPv6.nh%")

        # Check for TCP/UDP
        if TCP in pkt:
            tcp_layer = pkt[TCP]
            src_port = tcp_layer.sport
            dst_port = tcp_layer.dport
            protocol = "TCP"
            # Build TCP flags string
            flags = []
            if tcp_layer.flags & 0x02:
                flags.append("SYN")
            if tcp_layer.flags & 0x10:
                flags.append("ACK")
            if tcp_layer.flags & 0x01:
                flags.append("FIN")
            if tcp_layer.flags & 0x04:
                flags.append("RST")
            if tcp_layer.flags & 0x08:
                flags.append("PSH")
            if tcp_layer.flags & 0x20:
                flags.append("URG")
            tcp_flags = ",".join(flags) if flags else None
        elif UDP in pkt:
            udp_layer = pkt[UDP]
            src_port = udp_layer.sport
            dst_port = udp_layer.dport
            protocol = "UDP"

        # Get packet length
        length = len(pkt) if hasattr(pkt, "__len__") else 0

        # Build info message
        summary = pkt.summary()
        info = f"{src_ip}{':' + str(src_port) if src_port else ''} → {dst_ip}{':' + str(dst_port) if dst_port else ''}"
        if tcp_flags:
            info += f" [{tcp_flags}]"

        return PcapEntry(
            packet_number=packet_number,
            timestamp=timestamp,
            protocol=protocol,
            src_ip=src_ip,
            dst_ip=dst_ip,
            src_port=src_port,
            dst_port=dst_port,
            length=length,
            tcp_flags=tcp_flags,
            info=info,
            raw_summary=summary,
            source_file=source_file,
        )

    def filter_pcap(self, entries: list[PcapEntry], filters: PcapFilters) -> list[PcapEntry]:
        """Apply filters to a list of PCAP entries.

        Args:
            entries: List of PcapEntry objects
            filters: Filter criteria

        Returns:
            Filtered list of PcapEntry objects
        """
        result = entries

        if filters.protocol:
            proto_upper = filters.protocol.upper()
            result = [e for e in result if e.protocol.upper() == proto_upper]

        if filters.src_ip:
            result = [e for e in result if filters.src_ip in e.src_ip]

        if filters.dst_ip:
            result = [e for e in result if filters.dst_ip in e.dst_ip]

        if filters.src_port is not None:
            result = [e for e in result if e.src_port == filters.src_port]

        if filters.dst_port is not None:
            result = [e for e in result if e.dst_port == filters.dst_port]

        if filters.tcp_flags:
            flags_upper = filters.tcp_flags.upper()
            result = [e for e in result if e.tcp_flags and flags_upper in e.tcp_flags.upper()]

        if filters.keywords:
            kw = filters.keywords.lower()
            result = [e for e in result if kw in e.info.lower() or kw in e.raw_summary.lower()]

        # Time filtering
        if filters.start_time:
            result = [e for e in result if e.timestamp and e.timestamp >= filters.start_time]

        if filters.end_time:
            result = [e for e in result if e.timestamp and e.timestamp <= filters.end_time]

        return result

    def compute_statistics(self, entries: list[PcapEntry]) -> PcapStatistics:
        """Compute statistics for a list of PCAP entries.

        Args:
            entries: List of PcapEntry objects

        Returns:
            PcapStatistics with aggregated metrics
        """
        if not entries:
            return PcapStatistics(
                total=0,
                by_protocol={},
                unique_ips=0,
                unique_connections=0,
                duration_seconds=None,
            )

        by_protocol: dict[str, int] = {}
        ips = set()
        connections = set()

        for entry in entries:
            # Count by protocol
            by_protocol[entry.protocol] = by_protocol.get(entry.protocol, 0) + 1

            # Track unique IPs
            if entry.src_ip != "?":
                ips.add(entry.src_ip)
            if entry.dst_ip != "?":
                ips.add(entry.dst_ip)

            # Track unique connections (src_ip:port -> dst_ip:port)
            if entry.src_port and entry.dst_port:
                connections.add((entry.src_ip, entry.src_port, entry.dst_ip, entry.dst_port))

        # Calculate duration
        duration_seconds = None
        timestamps = [e.timestamp for e in entries if e.timestamp]
        if len(timestamps) >= 2:
            try:
                start = datetime.strptime(timestamps[0], "%Y-%m-%d %H:%M:%S.%f")
                end = datetime.strptime(timestamps[-1], "%Y-%m-%d %H:%M:%S.%f")
                duration_seconds = (end - start).total_seconds()
            except (ValueError, IndexError):
                pass

        return PcapStatistics(
            total=len(entries),
            by_protocol=by_protocol,
            unique_ips=len(ips),
            unique_connections=len(connections),
            duration_seconds=duration_seconds,
        )

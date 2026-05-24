"""PCAP network capture analysis endpoints."""

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.pcap_analyzer import (
    PcapAnalyzer,
    PcapEntry,
    PcapFilters,
    PcapStatistics,
)

router = APIRouter()
_analyzer = PcapAnalyzer()
logger = logging.getLogger(__name__)


class PcapEntryModel(BaseModel):
    """API model for a single PCAP packet entry."""

    packet_number: int
    timestamp: str | None
    protocol: str
    src_ip: str
    dst_ip: str
    src_port: int | None
    dst_port: int | None
    length: int
    tcp_flags: str | None
    info: str
    raw_summary: str
    source_file: str | None = None


class PcapFiltersModel(BaseModel):
    """API model for PCAP filter criteria."""

    start_time: str | None = None
    end_time: str | None = None
    protocol: str | None = None
    src_ip: str | None = None
    dst_ip: str | None = None
    src_port: int | None = None
    dst_port: int | None = None
    tcp_flags: str | None = None
    keywords: str | None = None


class PcapStatisticsModel(BaseModel):
    """API model for PCAP statistics."""

    total: int
    by_protocol: dict[str, int]
    unique_ips: int
    unique_connections: int
    duration_seconds: float | None


class PcapParseResultModel(BaseModel):
    """API model for PCAP parse result."""

    entries: list[PcapEntryModel]
    total_packets: int
    format_detected: str
    file_size: int


class FilterPcapRequest(BaseModel):
    """Request body for filtering PCAP entries."""

    entries: list[PcapEntryModel]
    filters: PcapFiltersModel


def _entry_to_model(entry: PcapEntry) -> PcapEntryModel:
    """Convert service PcapEntry to API model."""
    return PcapEntryModel(
        packet_number=entry.packet_number,
        timestamp=entry.timestamp,
        protocol=entry.protocol,
        src_ip=entry.src_ip,
        dst_ip=entry.dst_ip,
        src_port=entry.src_port,
        dst_port=entry.dst_port,
        length=entry.length,
        tcp_flags=entry.tcp_flags,
        info=entry.info,
        raw_summary=entry.raw_summary,
        source_file=entry.source_file,
    )


def _model_to_entry(model: PcapEntryModel) -> PcapEntry:
    """Convert API model to service PcapEntry."""
    return PcapEntry(
        packet_number=model.packet_number,
        timestamp=model.timestamp,
        protocol=model.protocol,
        src_ip=model.src_ip,
        dst_ip=model.dst_ip,
        src_port=model.src_port,
        dst_port=model.dst_port,
        length=model.length,
        tcp_flags=model.tcp_flags,
        info=model.info,
        raw_summary=model.raw_summary,
        source_file=model.source_file,
    )


def _filters_to_service(model: PcapFiltersModel) -> PcapFilters:
    """Convert API filter model to service filters."""
    return PcapFilters(
        start_time=model.start_time,
        end_time=model.end_time,
        protocol=model.protocol,
        src_ip=model.src_ip,
        dst_ip=model.dst_ip,
        src_port=model.src_port,
        dst_port=model.dst_port,
        tcp_flags=model.tcp_flags,
        keywords=model.keywords,
    )


def _stats_to_model(stats: PcapStatistics) -> PcapStatisticsModel:
    """Convert service statistics to API model."""
    return PcapStatisticsModel(
        total=stats.total,
        by_protocol=stats.by_protocol,
        unique_ips=stats.unique_ips,
        unique_connections=stats.unique_connections,
        duration_seconds=stats.duration_seconds,
    )


@router.post("/parse", response_model=PcapParseResultModel)
async def parse_pcap(file: UploadFile = File(...)):
    """Parse a PCAP or PCAPNG file.

    Supports .pcap, .pcapng, .gz, and .zip formats.
    Returns all packets parsed into PcapEntry objects.
    """
    content = await file.read()
    logger.debug("Parsing PCAP file — name=%s size=%d", file.filename, len(content))

    try:
        result = _analyzer.parse_pcap(content, file.filename or "capture.pcap")
        logger.debug(
            "PCAP parsed — format=%s packets=%d",
            result.format_detected,
            result.total_packets,
        )

        return PcapParseResultModel(
            entries=[_entry_to_model(e) for e in result.entries],
            total_packets=result.total_packets,
            format_detected=result.format_detected,
            file_size=result.file_size,
        )
    except ValueError as e:
        logger.error("Failed to parse PCAP file %r: %s", file.filename, e)
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/parse/stream")
async def parse_pcap_stream(file: UploadFile = File(...)):
    """Parse a PCAP file and stream entries as NDJSON.

    Each line is a JSON object representing a PcapEntry.
    The final line is a sentinel: {"_done": true, "total": N}
    """
    content = await file.read()
    logger.debug("Streaming PCAP parse — name=%s size=%d", file.filename, len(content))

    async def generate():
        """Generate NDJSON lines for each packet."""
        try:
            count = 0
            for entry in _analyzer.stream_pcap(content, file.filename or "capture.pcap"):
                model = _entry_to_model(entry)
                yield model.model_dump_json() + "\n"
                count += 1

            # Send sentinel
            import json

            yield json.dumps({"_done": True, "total": count}) + "\n"
            logger.debug("PCAP streaming complete — packets=%d", count)
        except ValueError as e:
            logger.error("Failed to stream PCAP file %r: %s", file.filename, e)
            import json

            yield json.dumps({"_error": str(e)}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.post("/filter", response_model=list[PcapEntryModel])
async def filter_pcap(req: FilterPcapRequest):
    """Filter PCAP entries by various criteria.

    Takes a list of entries and filter parameters, returns filtered entries.
    """
    try:
        service_entries = [_model_to_entry(e) for e in req.entries]
        service_filters = _filters_to_service(req.filters)

        filtered = _analyzer.filter_pcap(service_entries, service_filters)

        return [_entry_to_model(e) for e in filtered]
    except Exception as e:
        logger.error("Failed to filter PCAP entries: %s", e)
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/statistics", response_model=PcapStatisticsModel)
async def get_pcap_statistics(entries: list[PcapEntryModel]):
    """Compute statistics for a list of PCAP entries.

    Returns aggregated metrics like protocol distribution, unique IPs, etc.
    """
    try:
        service_entries = [_model_to_entry(e) for e in entries]
        stats = _analyzer.compute_statistics(service_entries)
        return _stats_to_model(stats)
    except Exception as e:
        logger.error("Failed to compute PCAP statistics: %s", e)
        raise HTTPException(status_code=400, detail=str(e)) from e

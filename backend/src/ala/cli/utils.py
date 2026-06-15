"""Shared utilities for the ALA CLI — file loading, stats computation."""

from __future__ import annotations

from pathlib import Path

import typer

from ..services.log_analyzer import LogAnalyzer, LogEntry
from .display import console

_analyzer = LogAnalyzer()


def load_entries(filepath: str) -> list[LogEntry]:
    """Load and parse a log file, returning parsed entries."""
    path = Path(filepath).expanduser().resolve()
    if not path.exists():
        console.print(f"[red]Error:[/] file not found — {filepath}")
        raise typer.Exit(code=1)

    text = path.read_text(encoding="utf-8", errors="replace")
    result = _analyzer.parse_log(text, source_file=path.name)
    console.print(
        f"[dim]Loaded {result.total_lines} entries from {path.name} ({result.format_detected})[/]"
    )
    return result.logs


def compute_overview(entries: list[LogEntry]) -> dict:
    """Compute overview statistics from parsed entries."""
    by_level: dict[str, int] = {}
    tags: dict[str, int] = {}
    pids: dict[str, int] = {}
    timestamps: list[str] = []

    for e in entries:
        by_level[e.level] = by_level.get(e.level, 0) + 1
        if e.tag:
            tags[e.tag] = tags.get(e.tag, 0) + 1
        if e.pid:
            pids[e.pid] = pids.get(e.pid, 0) + 1
        if e.timestamp:
            timestamps.append(e.timestamp)

    return {
        "total": len(entries),
        "by_level": by_level,
        "top_tags": sorted(tags.items(), key=lambda x: x[1], reverse=True)[:10],
        "top_pids": sorted(pids.items(), key=lambda x: x[1], reverse=True)[:10],
        "time_start": timestamps[0] if timestamps else "N/A",
        "time_end": timestamps[-1] if timestamps else "N/A",
    }

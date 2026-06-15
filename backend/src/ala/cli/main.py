"""ALA CLI — Typer-based CLI for Android log analysis.

Usage:
    ala overview <logfile>        # Show log summary with Rich table
    ala search <logfile> -l E     # Filter by level, colored output
    ala tail <logfile> -n 100     # Show last N lines, colored
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table
from rich.text import Text

from ..services.log_analyzer import LogAnalyzer, LogEntry

app = typer.Typer(
    name="ala",
    help="ALA — Android Log Analyzer CLI",
    no_args_is_help=True,
)

console = Console()
_analyzer = LogAnalyzer()

# --- Level → Rich style mapping -------------------------------------------------

LEVEL_STYLES: dict[str, str] = {
    "V": "dim",
    "D": "blue",
    "I": "green",
    "W": "yellow",
    "E": "red",
    "F": "red bold",
    "U": "dim",
}


def _color_level(level: str) -> Text:
    """Return a Rich Text with level-colored styling."""
    style = LEVEL_STYLES.get(level, "")
    return Text(level, style=style)


def _load_entries(filepath: str) -> list[LogEntry]:
    """Load and parse a log file, returning parsed entries."""
    path = Path(filepath).expanduser().resolve()
    if not path.exists():
        console.print(f"[red]Error:[/] file not found — {filepath}")
        raise typer.Exit(code=1)

    text = path.read_text(encoding="utf-8", errors="replace")
    result = _analyzer.parse_log(text, source_file=path.name)
    console.print(
        f"[dim]Loaded {result.total_lines} entries from {path.name} "
        f"({result.format_detected})[/]"
    )
    return result.logs


def _compute_overview(entries: list[LogEntry]) -> dict:
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


# --- Subcommands -----------------------------------------------------------------


@app.command()
def overview(
    logfile: Annotated[
        str, typer.Argument(help="Path to the Android log file (.log, .txt, .gz, .zip)")
    ],
) -> None:
    """Show log file overview: counts, levels, top tags, time range."""
    entries = _load_entries(logfile)
    stats = _compute_overview(entries)

    # Header
    console.print()
    console.rule("[bold]Log Overview")
    console.print(f"  File:        {Path(logfile).name}")
    console.print(f"  Format:      {_analyzer.detect_log_format(Path(logfile).read_text('utf-8', errors='replace')).value}")
    console.print(f"  Total lines: {stats['total']:,}")
    console.print(f"  Time range:  {stats['time_start']}  →  {stats['time_end']}")
    console.print()

    # Level distribution
    table = Table(title="Level Distribution", title_style="bold")
    table.add_column("Level", style="bold", width=6)
    table.add_column("Count", justify="right", width=10)
    table.add_column("Bar", width=30)

    order = ["F", "E", "W", "I", "D", "V", "U"]
    for lvl in order:
        count = stats["by_level"].get(lvl, 0)
        if count:
            pct = count / stats["total"] * 100
            bar = "█" * max(1, int(pct / 2))
            table.add_row(_color_level(lvl), f"{count:,}", f"{bar}  {pct:.1f}%")

    console.print(table)
    console.print()

    # Top tags
    tag_table = Table(title="Top Tags", title_style="bold")
    tag_table.add_column("Tag")
    tag_table.add_column("Count", justify="right")
    for tag, count in stats["top_tags"]:
        tag_table.add_row(tag, f"{count:,}")
    console.print(tag_table)

    # Top PIDs
    if stats["top_pids"]:
        console.print()
        pid_table = Table(title="Top PIDs", title_style="bold")
        pid_table.add_column("PID")
        pid_table.add_column("Count", justify="right")
        for pid, count in stats["top_pids"]:
            pid_table.add_row(pid, f"{count:,}")
        console.print(pid_table)

    console.print()


@app.command()
def search(
    logfile: Annotated[
        str, typer.Argument(help="Path to the Android log file")
    ],
    level: Annotated[
        str | None,
        typer.Option(
            "-l", "--level",
            help="Filter by log level (V, D, I, W, E, F)",
        ),
    ] = None,
    tag: Annotated[
        str | None,
        typer.Option("-t", "--tag", help="Filter by tag (substring match)"),
    ] = None,
    pattern: Annotated[
        str | None,
        typer.Option("-p", "--pattern", help="Keyword or regex in message"),
    ] = None,
    pid: Annotated[
        str | None,
        typer.Option("--pid", help="Filter by process ID"),
    ] = None,
    limit: Annotated[
        int,
        typer.Option("-n", "--limit", help="Max matching entries (default: 200)"),
    ] = 200,
) -> None:
    """Search and filter log entries. Results are color-coded by severity."""
    import re

    entries = _load_entries(logfile)

    # Build level priority map for filtering
    level_order = {"V": 0, "D": 1, "I": 2, "W": 3, "E": 4, "F": 5, "U": -1}
    min_priority = level_order.get(level.upper(), -1) if level else -1
    tag_lower = tag.lower() if tag else None
    pid_str = pid.strip() if pid else None
    pat = re.compile(pattern, re.IGNORECASE) if pattern else None

    matched = 0
    for entry in entries:
        if matched >= limit:
            break

        if min_priority >= 0 and entry.level not in level_order:
            continue
        if min_priority >= 0 and level_order.get(entry.level, -1) < min_priority:
            continue
        if tag_lower and tag_lower not in entry.tag.lower():
            continue
        if pid_str and entry.pid != pid_str:
            continue
        if pat and not pat.search(entry.message):
            continue

        matched += 1
        # Color-coded line
        ts = entry.timestamp or " " * 18
        lvl = _color_level(entry.level)
        t = Text(entry.tag[:20], style="cyan")
        msg = Text(entry.message[:120])
        console.print(
            Text.assemble(
                (ts, "dim"),
                "  ",
                lvl,
                "  ",
                t,
                "  ",
                msg,
            )
        )

    console.print()
    console.print(f"[dim]{matched} matching entries shown[/]")


@app.command()
def tail(
    logfile: Annotated[
        str, typer.Argument(help="Path to the Android log file")
    ],
    lines: Annotated[
        int,
        typer.Option("-n", "--lines", help="Number of lines from end (default: 100)"),
    ] = 100,
) -> None:
    """Show the last N lines of a log file with color-coded levels."""
    entries = _load_entries(logfile)
    tail_entries = entries[-lines:]

    console.print()
    console.rule(f"[bold]Last {len(tail_entries)} lines")
    console.print()

    for entry in tail_entries:
        ts = entry.timestamp or " " * 18
        lvl = _color_level(entry.level)
        tag = Text(entry.tag[:20], style="cyan") if entry.tag else Text("")
        msg = Text(entry.message[:120])
        console.print(
            Text.assemble(
                (ts, "dim"),
                "  ",
                lvl,
                "  ",
                tag,
                "  ",
                msg,
            )
        )

    console.print()


def main() -> None:
    """Entry point for console_scripts."""
    app()


if __name__ == "__main__":
    main()

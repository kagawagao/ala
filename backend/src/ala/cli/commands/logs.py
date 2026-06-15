"""Log analysis subcommands: ``ala overview``, ``ala search``, ``ala tail``."""

from __future__ import annotations

import re
from typing import Annotated

import typer
from rich.table import Table
from rich.text import Text

from ..display import LEVEL_DISPLAY_ORDER, color_level, console
from ..utils import compute_overview, load_entries

logs_app = typer.Typer(
    help="Android log analysis commands",
    no_args_is_help=True,
)


@logs_app.command()
def overview(
    logfile: Annotated[
        str, typer.Argument(help="Path to the Android log file (.log, .txt, .gz, .zip)")
    ],
) -> None:
    """Show log file overview: counts, levels, top tags, time range."""
    entries = load_entries(logfile)
    stats = compute_overview(entries)

    # Header
    console.print()
    console.rule("[bold]Log Overview")
    console.print(f"  File:        {logfile}")
    console.print(f"  Total lines: {stats['total']:,}")
    console.print(f"  Time range:  {stats['time_start']}  →  {stats['time_end']}")
    console.print()

    # Level distribution
    table = Table(title="Level Distribution", title_style="bold")
    table.add_column("Level", style="bold", width=6)
    table.add_column("Count", justify="right", width=10)
    table.add_column("Bar", width=30)

    for lvl in LEVEL_DISPLAY_ORDER:
        count = stats["by_level"].get(lvl, 0)
        if count:
            pct = count / stats["total"] * 100
            bar = "█" * max(1, int(pct / 2))
            table.add_row(color_level(lvl), f"{count:,}", f"{bar}  {pct:.1f}%")

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


@logs_app.command()
def search(
    logfile: Annotated[str, typer.Argument(help="Path to the Android log file")],
    level: Annotated[
        str | None,
        typer.Option(
            "-l",
            "--level",
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
    entries = load_entries(logfile)

    level_order = {"V": 0, "D": 1, "I": 2, "W": 3, "E": 4, "F": 5, "U": -1}
    min_priority = level_order.get(level.upper(), -1) if level else -1
    tag_lower = tag.lower() if tag else None
    pid_str = pid.strip() if pid else None
    try:
        pat = re.compile(pattern, re.IGNORECASE) if pattern else None
    except re.error as e:
        console.print(f"[red]Error:[/] invalid regex pattern — {e}")
        raise typer.Exit(code=1)

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
        ts = entry.timestamp or " " * 18
        lvl = color_level(entry.level)
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


@logs_app.command()
def tail(
    logfile: Annotated[str, typer.Argument(help="Path to the Android log file")],
    lines: Annotated[
        int,
        typer.Option("-n", "--lines", help="Number of lines from end (default: 100)"),
    ] = 100,
) -> None:
    """Show the last N lines of a log file with color-coded levels."""
    if lines < 1:
        console.print("[red]Error:[/] --lines must be a positive integer")
        raise typer.Exit(code=1)
    entries = load_entries(logfile)
    tail_entries = entries[-lines:]

    console.print()
    console.rule(f"[bold]Last {len(tail_entries)} lines")
    console.print()

    for entry in tail_entries:
        ts = entry.timestamp or " " * 18
        lvl = color_level(entry.level)
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

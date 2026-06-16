"""Rich display helpers for the ALA CLI — level colors, formatting."""

from __future__ import annotations

from rich.console import Console
from rich.text import Text

console = Console()

#: Log level → Rich style mapping.
LEVEL_STYLES: dict[str, str] = {
    "V": "dim",
    "D": "blue",
    "I": "green",
    "W": "yellow",
    "E": "red",
    "F": "red bold",
    "U": "dim",
}

#: Order used when rendering level distribution tables.
LEVEL_DISPLAY_ORDER: list[str] = ["F", "E", "W", "I", "D", "V", "U"]


def color_level(level: str) -> Text:
    """Return a Rich Text styled for the given log *level*."""
    return Text(level, style=LEVEL_STYLES.get(level, ""))

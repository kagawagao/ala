"""ALA CLI entry point — mounts pluggable sub-command modules.

Architecture
------------
``src/ala/cli/``
├── main.py           ← this file (Typer app, mounts sub-apps)
├── display.py        ← Rich styling helpers (LEVEL_STYLES, color_level)
├── utils.py          ← file loading, stats computation
└── commands/         ← one module per command group (pluggable)
    ├── __init__.py
    └── logs.py       ← ``logs_app`` — overview, search, tail

To add a new command group (e.g. projects, config):
    1. Create ``commands/projects.py`` with a Typer instance.
    2. Add ``app.add_typer(projects_app)`` below.
"""

from __future__ import annotations

import typer

from .commands.logs import logs_app

app = typer.Typer(
    name="ala",
    help="ALA — Android Log Analyzer CLI",
    no_args_is_help=True,
)

# ── Mount sub-command groups ──────────────────────────────────────────────────
app.add_typer(logs_app)

# Future command groups — add one line each:
#   from .commands.projects import projects_app; app.add_typer(projects_app)
#   from .commands.config   import config_app;   app.add_typer(config_app)
#   from .commands.models   import models_app;   app.add_typer(models_app)


def main() -> None:
    """Entry point for console_scripts."""
    app()


if __name__ == "__main__":
    main()

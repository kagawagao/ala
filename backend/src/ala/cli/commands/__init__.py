"""ALA CLI subcommand modules — each module is a Typer sub-app.

To add a new command group:

1. Create a new module (e.g. ``projects.py``) with a Typer instance.
2. Mount it in ``ala.cli.main`` with ``app.add_typer(projects_app)``.
"""

"""SQLite-backed project manager."""

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .database import get_db


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _default_storage_path() -> Path:
    """Use ~/.ala/projects.json as the default storage location (for backward compat)."""
    return Path.home() / ".ala" / "projects.json"


@dataclass
class Project:
    id: str
    name: str
    paths: list[str]
    include_patterns: list[str] = field(
        default_factory=lambda: ["**/*"]
    )
    exclude_patterns: list[str] = field(
        default_factory=lambda: ["**/build/**", "**/node_modules/**", "**/.gradle/**", "**/.git/**"]
    )
    filter_presets: list[dict] = field(default_factory=list)
    created_at: str = field(default_factory=_utcnow)


class ProjectManager:
    def __init__(self, max_projects: int = 20, db=None, storage_path: Path | None = None):
        self._max_projects = max_projects
        self._db = db if db is not None else get_db()
        self._storage_path = storage_path or _default_storage_path()

    def _row_to_project(self, row) -> Project:
        """Reconstruct a Project dataclass from a sqlite3.Row (projects table)."""
        pid = row["id"]
        # Load paths
        path_rows = self._db.execute(
            "SELECT path FROM project_paths WHERE project_id = ? ORDER BY ordering",
            (pid,),
        ).fetchall()
        paths = [p["path"] for p in path_rows]

        # Load include patterns
        inc_rows = self._db.execute(
            "SELECT pattern FROM project_patterns WHERE project_id = ? AND type = 'include' ORDER BY ordering",
            (pid,),
        ).fetchall()
        include_patterns = [p["pattern"] for p in inc_rows]

        # Load exclude patterns
        exc_rows = self._db.execute(
            "SELECT pattern FROM project_patterns WHERE project_id = ? AND type = 'exclude' ORDER BY ordering",
            (pid,),
        ).fetchall()
        exclude_patterns = [p["pattern"] for p in exc_rows]

        filter_presets = json.loads(row["filter_presets"]) if row["filter_presets"] else []

        return Project(
            id=pid,
            name=row["name"],
            paths=paths,
            include_patterns=include_patterns
            if include_patterns is not None
            else Project.__dataclass_fields__["include_patterns"].default_factory(),
            exclude_patterns=exclude_patterns
            if exclude_patterns is not None
            else Project.__dataclass_fields__["exclude_patterns"].default_factory(),
            filter_presets=filter_presets,
            created_at=row["created_at"],
        )

    def _save_paths(self, project_id: str, paths: list[str]) -> None:
        """Replace all paths for a project."""
        self._db.execute("DELETE FROM project_paths WHERE project_id = ?", (project_id,))
        for i, p in enumerate(paths):
            self._db.execute(
                "INSERT INTO project_paths (project_id, path, ordering) VALUES (?, ?, ?)",
                (project_id, p, i),
            )

    def _save_patterns(
        self, project_id: str, include_patterns: list[str], exclude_patterns: list[str]
    ) -> None:
        """Replace all patterns for a project."""
        self._db.execute("DELETE FROM project_patterns WHERE project_id = ?", (project_id,))
        for i, p in enumerate(include_patterns):
            self._db.execute(
                "INSERT INTO project_patterns (project_id, pattern, type, ordering) VALUES (?, ?, 'include', ?)",
                (project_id, p, i),
            )
        for i, p in enumerate(exclude_patterns):
            self._db.execute(
                "INSERT INTO project_patterns (project_id, pattern, type, ordering) VALUES (?, ?, 'exclude', ?)",
                (project_id, p, i),
            )

    def create_project(
        self,
        name: str,
        paths: list[str],
        include_patterns: list[str] | None = None,
        exclude_patterns: list[str] | None = None,
    ) -> Project:
        # Max projects eviction
        cur = self._db.execute("SELECT COUNT(*) FROM projects")
        if cur.fetchone()[0] >= self._max_projects:
            self._db.execute(
                "DELETE FROM projects WHERE id = ("
                "SELECT id FROM projects ORDER BY created_at ASC LIMIT 1"
                ")"
            )

        project = Project(
            id=str(uuid.uuid4()),
            name=name,
            paths=paths,
        )
        if include_patterns is not None:
            project.include_patterns = include_patterns
        if exclude_patterns is not None:
            project.exclude_patterns = exclude_patterns

        self._db.execute(
            "INSERT INTO projects (id, name, created_at, filter_presets) VALUES (?, ?, ?, ?)",
            (project.id, project.name, project.created_at, json.dumps(project.filter_presets)),
        )
        self._save_paths(project.id, project.paths)
        self._save_patterns(project.id, project.include_patterns, project.exclude_patterns)
        self._db.commit()
        return project

    def get_project(self, project_id: str) -> Project | None:
        row = self._db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_project(row)

    def list_projects(self) -> list[Project]:
        rows = self._db.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        return [self._row_to_project(row) for row in rows]

    def update_project(
        self,
        project_id: str,
        name: str | None = None,
        paths: list[str] | None = None,
        include_patterns: list[str] | None = None,
        exclude_patterns: list[str] | None = None,
    ) -> Project | None:
        row = self._db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            return None

        if name is not None:
            self._db.execute("UPDATE projects SET name = ? WHERE id = ?", (name, project_id))
        if paths is not None:
            self._save_paths(project_id, paths)
        if include_patterns is not None or exclude_patterns is not None:
            # Need current values if only updating one
            project = self._row_to_project(row)
            new_inc = include_patterns if include_patterns is not None else project.include_patterns
            new_exc = exclude_patterns if exclude_patterns is not None else project.exclude_patterns
            self._save_patterns(project_id, new_inc, new_exc)

        self._db.commit()
        # Re-read to return updated project
        return self.get_project(project_id)

    def delete_project(self, project_id: str) -> bool:
        cur = self._db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        self._db.commit()
        return cur.rowcount > 0

    def update_presets(self, project_id: str, presets: list[dict]) -> Project | None:
        cur = self._db.execute(
            "UPDATE projects SET filter_presets = ? WHERE id = ?",
            (json.dumps(presets), project_id),
        )
        self._db.commit()
        if cur.rowcount == 0:
            return None
        return self.get_project(project_id)

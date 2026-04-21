"""Persistent project manager backed by a JSON file."""
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _default_storage_path() -> Path:
    """Use ~/.ala/projects.json as the default storage location."""
    return Path.home() / ".ala" / "projects.json"


@dataclass
class Project:
    id: str
    name: str
    paths: list[str]
    include_patterns: list[str] = field(default_factory=lambda: ["**/*.java", "**/*.kt", "**/*.xml"])
    exclude_patterns: list[str] = field(
        default_factory=lambda: ["**/build/**", "**/node_modules/**", "**/.gradle/**", "**/.git/**"]
    )
    filter_presets: list[dict] = field(default_factory=list)
    created_at: str = field(default_factory=_utcnow)


class ProjectManager:
    def __init__(self, max_projects: int = 20, storage_path: Path | None = None):
        self._projects: dict[str, Project] = {}
        self._max_projects = max_projects
        self._storage_path = storage_path or _default_storage_path()
        self._load()

    def _load(self) -> None:
        """Load projects from disk."""
        if not self._storage_path.exists():
            return
        try:
            data = json.loads(self._storage_path.read_text(encoding="utf-8"))
            for item in data:
                project = Project(**item)
                self._projects[project.id] = project
        except (json.JSONDecodeError, TypeError, KeyError):
            pass  # Corrupt file – start fresh

    def _save(self) -> None:
        """Persist projects to disk."""
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        data = [asdict(p) for p in self._projects.values()]
        self._storage_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    def create_project(
        self,
        name: str,
        paths: list[str],
        include_patterns: list[str] | None = None,
        exclude_patterns: list[str] | None = None,
    ) -> Project:
        if len(self._projects) >= self._max_projects:
            oldest = next(iter(self._projects))
            del self._projects[oldest]
        project = Project(
            id=str(uuid.uuid4()),
            name=name,
            paths=paths,
        )
        if include_patterns is not None:
            project.include_patterns = include_patterns
        if exclude_patterns is not None:
            project.exclude_patterns = exclude_patterns
        self._projects[project.id] = project
        self._save()
        return project

    def get_project(self, project_id: str) -> Project | None:
        return self._projects.get(project_id)

    def list_projects(self) -> list[Project]:
        return list(self._projects.values())

    def update_project(
        self,
        project_id: str,
        name: str | None = None,
        paths: list[str] | None = None,
        include_patterns: list[str] | None = None,
        exclude_patterns: list[str] | None = None,
    ) -> Project | None:
        project = self._projects.get(project_id)
        if not project:
            return None
        if name is not None:
            project.name = name
        if paths is not None:
            project.paths = paths
        if include_patterns is not None:
            project.include_patterns = include_patterns
        if exclude_patterns is not None:
            project.exclude_patterns = exclude_patterns
        self._save()
        return project

    def delete_project(self, project_id: str) -> bool:
        if project_id in self._projects:
            del self._projects[project_id]
            self._save()
            return True
        return False

    def update_presets(self, project_id: str, presets: list[dict]) -> Project | None:
        project = self._projects.get(project_id)
        if not project:
            return None
        project.filter_presets = presets
        self._save()
        return project

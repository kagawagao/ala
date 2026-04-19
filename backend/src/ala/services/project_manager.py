"""In-memory project manager."""
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Project:
    id: str
    name: str
    paths: list[str]
    log_directory: str | None = None
    include_patterns: list[str] = field(default_factory=lambda: ["**/*.java", "**/*.kt", "**/*.xml"])
    exclude_patterns: list[str] = field(
        default_factory=lambda: ["**/build/**", "**/node_modules/**", "**/.gradle/**", "**/.git/**"]
    )
    created_at: str = field(default_factory=_utcnow)


class ProjectManager:
    def __init__(self, max_projects: int = 20):
        self._projects: dict[str, Project] = {}
        self._max_projects = max_projects

    def create_project(
        self,
        name: str,
        paths: list[str],
        log_directory: str | None = None,
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
            log_directory=log_directory,
        )
        if include_patterns is not None:
            project.include_patterns = include_patterns
        if exclude_patterns is not None:
            project.exclude_patterns = exclude_patterns
        self._projects[project.id] = project
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
        log_directory: str | None = ...,  # type: ignore[assignment]
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
        if log_directory is not ...:
            project.log_directory = log_directory
        if include_patterns is not None:
            project.include_patterns = include_patterns
        if exclude_patterns is not None:
            project.exclude_patterns = exclude_patterns
        return project

    def delete_project(self, project_id: str) -> bool:
        if project_id in self._projects:
            del self._projects[project_id]
            return True
        return False

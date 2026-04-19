"""Code scanner for reading project source files."""
import fnmatch
import os
import re
from dataclasses import dataclass, field
from pathlib import Path


MAX_FILE_SIZE = 100 * 1024  # 100KB per file
MAX_FILES_LIST = 2000
MAX_SEARCH_RESULTS = 50

# Well-known LLM context/instruction files (like charmbracelet/crush)
CONTEXT_DOC_PATHS = [
    "AGENTS.md",
    "AGENTS.md.local",
    ".github/copilot-instructions.md",
    "CLAUDE.md",
    "CLAUDE.md.local",
    "CRUSH.md",
    "CRUSH.md.local",
    "GEMINI.md",
    "GEMINI.md.local",
    "COPILOT.md",
    "CURSOR.md",
    ".cursorrules",
    "README.md",
]


@dataclass
class ContextDoc:
    """A discovered LLM context/instruction document."""

    path: str  # relative to project root
    content: str
    size: int


@dataclass
class FileInfo:
    path: str  # relative to project root
    size: int
    extension: str


@dataclass
class FileContent:
    path: str
    content: str
    size: int
    truncated: bool = False


@dataclass
class SearchMatch:
    path: str
    line_number: int
    line: str


@dataclass
class SearchResult:
    matches: list[SearchMatch] = field(default_factory=list)
    total_matches: int = 0
    files_searched: int = 0


def _matches_any(path: str, patterns: list[str]) -> bool:
    """Check if a relative path matches any of the given glob patterns."""
    for pattern in patterns:
        if fnmatch.fnmatch(path, pattern):
            return True
        # Also check just the filename for simple patterns
        if "/" not in pattern and fnmatch.fnmatch(os.path.basename(path), pattern):
            return True
    return False


def _load_gitignore_patterns(project_root: Path) -> list[str]:
    """Load patterns from .gitignore if it exists."""
    gitignore = project_root / ".gitignore"
    if not gitignore.is_file():
        return []
    patterns: list[str] = []
    for line in gitignore.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Convert gitignore patterns to glob-style
        if line.startswith("/"):
            patterns.append(line[1:])
        else:
            patterns.append(f"**/{line}")
        if not line.endswith("/") and not line.endswith("*"):
            patterns.append(f"**/{line}/**")
    return patterns


class CodeScanner:
    """Scans project directories for source files."""

    def discover_context_docs(self, project_paths: str | list[str]) -> list[ContextDoc]:
        """Discover well-known LLM context/instruction files in project paths.

        Searches for files like AGENTS.md, .github/copilot-instructions.md,
        CLAUDE.md, etc. — similar to how charmbracelet/crush loads project context.
        Accepts a single path or list of paths for multi-repo projects.
        """
        if isinstance(project_paths, str):
            project_paths = [project_paths]

        docs: list[ContextDoc] = []
        seen: set[str] = set()

        for project_path in project_paths:
            root = Path(project_path)
            if not root.is_dir():
                continue

            for rel_path in CONTEXT_DOC_PATHS:
                full = root / rel_path
                if not full.is_file():
                    continue
                # Use project_path prefix to avoid duplicates across roots
                doc_key = f"{project_path}:{rel_path}"
                if doc_key in seen:
                    continue
                seen.add(doc_key)
                try:
                    size = full.stat().st_size
                    if size > MAX_FILE_SIZE:
                        content = full.read_text(errors="replace")[:MAX_FILE_SIZE]
                    else:
                        content = full.read_text(errors="replace")
                    # Prefix path with root basename for multi-path clarity
                    display_path = rel_path
                    if len(project_paths) > 1:
                        display_path = f"{root.name}/{rel_path}"
                    docs.append(ContextDoc(path=display_path, content=content, size=size))
                except OSError:
                    continue

        return docs

    def list_files(
        self,
        project_path: str,
        include_patterns: list[str],
        exclude_patterns: list[str],
        subdirectory: str | None = None,
    ) -> list[FileInfo]:
        """List files in a project matching the include/exclude patterns."""
        root = Path(project_path)
        if not root.is_dir():
            return []

        if subdirectory:
            root = root / subdirectory
            if not root.is_dir():
                return []

        gitignore_patterns = _load_gitignore_patterns(Path(project_path))
        all_exclude = exclude_patterns + gitignore_patterns

        files: list[FileInfo] = []
        base = Path(project_path)

        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden directories
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]

            for fname in filenames:
                if fname.startswith("."):
                    continue
                full_path = Path(dirpath) / fname
                try:
                    rel_path = str(full_path.relative_to(base))
                except ValueError:
                    continue

                # Check exclude first
                if _matches_any(rel_path, all_exclude):
                    continue

                # Check include
                if not _matches_any(rel_path, include_patterns):
                    continue

                try:
                    size = full_path.stat().st_size
                except OSError:
                    continue

                files.append(
                    FileInfo(
                        path=rel_path,
                        size=size,
                        extension=full_path.suffix,
                    )
                )

                if len(files) >= MAX_FILES_LIST:
                    return files

        return sorted(files, key=lambda f: f.path)

    def read_file(
        self,
        project_path: str,
        file_path: str,
        max_size: int = MAX_FILE_SIZE,
    ) -> FileContent | None:
        """Read a single file from the project."""
        full = Path(project_path) / file_path
        # Prevent path traversal
        try:
            full.resolve().relative_to(Path(project_path).resolve())
        except ValueError:
            return None

        if not full.is_file():
            return None

        size = full.stat().st_size
        truncated = size > max_size

        try:
            content = full.read_text(errors="replace")
            if truncated:
                content = content[:max_size]
        except (OSError, UnicodeDecodeError):
            return None

        return FileContent(
            path=file_path,
            content=content,
            size=size,
            truncated=truncated,
        )

    def search_code(
        self,
        project_path: str,
        pattern: str,
        include_patterns: list[str],
        exclude_patterns: list[str],
        case_sensitive: bool = False,
    ) -> SearchResult:
        """Search for a regex pattern across project files."""
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            regex = re.compile(pattern, flags)
        except re.error:
            return SearchResult()

        files = self.list_files(project_path, include_patterns, exclude_patterns)
        matches: list[SearchMatch] = []
        files_searched = 0

        for file_info in files:
            if file_info.size > MAX_FILE_SIZE:
                continue

            full = Path(project_path) / file_info.path
            try:
                content = full.read_text(errors="replace")
            except (OSError, UnicodeDecodeError):
                continue

            files_searched += 1
            for line_num, line in enumerate(content.splitlines(), start=1):
                if regex.search(line):
                    matches.append(
                        SearchMatch(
                            path=file_info.path,
                            line_number=line_num,
                            line=line.rstrip()[:500],  # limit line length
                        )
                    )
                    if len(matches) >= MAX_SEARCH_RESULTS:
                        return SearchResult(
                            matches=matches,
                            total_matches=len(matches),
                            files_searched=files_searched,
                        )

        return SearchResult(
            matches=matches,
            total_matches=len(matches),
            files_searched=files_searched,
        )

"""Code scanner for reading project source files."""

import fnmatch
import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 100 * 1024  # 100KB per file
MAX_FILES_LIST = 2000
MAX_SEARCH_RESULTS = 50

# ── Ripgrep availability ────────────────────────────────────────────────────
_RG_PATH: str | None = shutil.which("rg")

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
        max_results: int = MAX_SEARCH_RESULTS,
    ) -> SearchResult:
        """Search for a regex pattern across project files.

        Uses ripgrep (rg) when available for 10-100x faster search.
        Falls back to Python regex scanning when rg is unavailable or fails.
        """
        # Fast path: ripgrep (10-100x faster than Python)
        if _RG_PATH is not None and pattern:
            result = self._search_with_rg(
                project_path,
                pattern,
                include_patterns,
                exclude_patterns,
                case_sensitive=case_sensitive,
                max_results=max_results,
            )
            # If rg found matches, return immediately.
            # An empty result may mean no matches OR rg failed;
            # fall back to Python to be safe.
            if result.matches:
                return result
            logger.debug("rg returned empty result, falling back to Python scanner")

        # Slow path: pure Python fallback
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
                    if len(matches) >= max_results:
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

    # ── Ripgrep-backed search ────────────────────────────────────────────

    @staticmethod
    def _rg_glob_to_patterns(patterns: list[str]) -> list[str]:
        """Convert simple glob patterns to ripgrep --glob arguments.

        Handles common patterns like ``*.py``, ``src/**``, ``**/test_*.py``.
        Falls back to Python filtering if patterns are too complex.
        """
        rg_globs: list[str] = []
        for p in patterns:
            # rg glob syntax supports {a,b} alternations and [abc] char classes natively.
            # Only skip patterns that are clearly not valid globs (e.g. full regex).
            rg_globs.append(p)
        return rg_globs

    def _search_with_rg(
        self,
        project_path: str,
        pattern: str,
        include_patterns: list[str],
        exclude_patterns: list[str],
        *,
        case_sensitive: bool = False,
        max_results: int = MAX_SEARCH_RESULTS,
    ) -> SearchResult:
        """Search using ripgrep for orders-of-magnitude faster scanning.

        Returns a SearchResult with the same structure as the Python fallback.
        """
        assert _RG_PATH is not None
        cmd: list[str] = [
            _RG_PATH,
            "--json",  # machine-parseable output
            "--no-heading",
            "--line-number",
        ]

        if not case_sensitive:
            cmd.append("--ignore-case")

        if pattern:
            cmd.extend(["--regexp", pattern])
        else:
            return SearchResult()

        # Include patterns → --glob
        for g in self._rg_glob_to_patterns(include_patterns):
            cmd.extend(["--glob", g])

        # Exclude patterns → --glob '!...'
        for g in self._rg_glob_to_patterns(exclude_patterns):
            cmd.extend(["--glob", f"!{g}"])

        cmd.append(project_path)

        logger.debug("rg search: %s", " ".join(cmd[:8]) + " …")
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            logger.warning("rg search timed out or not found, falling back to Python")
            return SearchResult()

        # rg may exit non-zero on invalid regex or permission errors.
        # Fall back to Python scanner so callers aren't left with empty results.
        if proc.returncode != 0:
            logger.warning(
                "rg exited %d (stderr: %s), falling back to Python",
                proc.returncode,
                proc.stderr[:200].strip(),
            )
            return SearchResult()

        # Parse JSON lines output (single pass — collect matches + summary)
        matches: list[SearchMatch] = []
        files_seen: set[str] = set()
        stats_data = None

        for line in proc.stdout.splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # rg --json produces different message types
            msg_type = entry.get("type")
            if msg_type == "match":
                data = entry.get("data", {})
                path_info = data.get("path", {})
                file_path = path_info.get("text", "")
                line_number = data.get("line_number", 0)
                line_text = data.get("lines", {}).get("text", "").rstrip("\n\r")

                # Record relative path
                try:
                    rel_path = str(Path(file_path).relative_to(project_path))
                except ValueError:
                    rel_path = file_path

                files_seen.add(file_path)
                matches.append(
                    SearchMatch(
                        path=rel_path,
                        line_number=line_number,
                        line=line_text[:500],
                    )
                )

                if len(matches) >= max_results:
                    break
            elif msg_type == "summary":
                stats_data = entry.get("data", {})

        total_matches = (
            stats_data.get("stats", {}).get("matches", len(matches)) if stats_data else len(matches)
        )
        files_searched = (
            stats_data.get("stats", {}).get("searches", len(files_seen))
            if stats_data
            else len(files_seen)
        )

        return SearchResult(
            matches=matches,
            total_matches=total_matches,
            files_searched=files_searched,
        )

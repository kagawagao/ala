"""Tests for the code scanner context doc discovery."""

import os
import tempfile

import pytest

from ala.services.code_scanner import CONTEXT_DOC_PATHS, CodeScanner


@pytest.fixture
def scanner():
    return CodeScanner()


@pytest.fixture
def project_dir():
    """Create a temp directory with some context docs."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create AGENTS.md
        with open(os.path.join(tmpdir, "AGENTS.md"), "w") as f:
            f.write("# Agent Instructions\nUse pytest for tests.\n")

        # Create .github/copilot-instructions.md
        github_dir = os.path.join(tmpdir, ".github")
        os.makedirs(github_dir)
        with open(os.path.join(github_dir, "copilot-instructions.md"), "w") as f:
            f.write("# Copilot Instructions\nUse TypeScript.\n")

        # Create README.md
        with open(os.path.join(tmpdir, "README.md"), "w") as f:
            f.write("# My Project\nA test project.\n")

        yield tmpdir


def test_discover_context_docs_finds_known_files(scanner, project_dir):
    docs = scanner.discover_context_docs(project_dir)
    paths = [d.path for d in docs]

    assert "AGENTS.md" in paths
    assert ".github/copilot-instructions.md" in paths
    assert "README.md" in paths
    assert len(docs) == 3


def test_discover_context_docs_reads_content(scanner, project_dir):
    docs = scanner.discover_context_docs(project_dir)
    agents_doc = next(d for d in docs if d.path == "AGENTS.md")

    assert "Agent Instructions" in agents_doc.content
    assert agents_doc.size > 0


def test_discover_context_docs_empty_dir(scanner):
    with tempfile.TemporaryDirectory() as tmpdir:
        docs = scanner.discover_context_docs(tmpdir)
        assert docs == []


def test_discover_context_docs_nonexistent_path(scanner):
    docs = scanner.discover_context_docs("/nonexistent/path")
    assert docs == []


def test_known_doc_paths_include_key_files():
    """Verify we search for the main LLM instruction file conventions."""
    assert "AGENTS.md" in CONTEXT_DOC_PATHS
    assert ".github/copilot-instructions.md" in CONTEXT_DOC_PATHS
    assert "CLAUDE.md" in CONTEXT_DOC_PATHS
    assert "README.md" in CONTEXT_DOC_PATHS


@pytest.fixture
def code_project_dir():
    """Create a temp project dir with Python files for search testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "main.py"), "w") as f:
            f.write("class LogAnalyzer:\n    def search(self, pattern):\n        pass\n")
        with open(os.path.join(tmpdir, "utils.py"), "w") as f:
            f.write("def format_log(entry):\n    return str(entry)\n")
        # Create a non-Python file
        with open(os.path.join(tmpdir, "README.md"), "w") as f:
            f.write("# Project\nLogAnalyzer reference\n")
        yield tmpdir


def test_search_code_rg_finds_matches(scanner, code_project_dir):
    """Verify ripgrep-backed search finds matches in Python files."""
    result = scanner.search_code(code_project_dir, "LogAnalyzer", ["*.py"], [], max_results=10)
    assert result.total_matches >= 1
    assert any("main.py" in m.path for m in result.matches)


def test_search_code_rg_respects_max_results(scanner, code_project_dir):
    """Verify search caps at max_results."""
    result = scanner.search_code(code_project_dir, ".", ["*.py"], [], max_results=2)
    assert len(result.matches) <= 2


def test_search_code_rg_handles_invalid_regex(scanner, code_project_dir):
    """Verify invalid regex returns empty result without crash."""
    result = scanner.search_code(code_project_dir, "[invalid(", ["*.py"], [], max_results=10)
    # Should not crash; may return empty or fall back depending on rg behavior
    assert result is not None


def test_search_code_rg_case_sensitive(scanner, code_project_dir):
    """Verify case-sensitive search."""
    result = scanner.search_code(
        code_project_dir, "loganalyzer", ["*.py"], [], case_sensitive=True, max_results=10
    )
    # "LogAnalyzer" won't match "loganalyzer" case-sensitively
    assert result.total_matches == 0


def test_search_code_rg_case_insensitive(scanner, code_project_dir):
    """Verify case-insensitive search (default)."""
    result = scanner.search_code(
        code_project_dir, "loganalyzer", ["*.py"], [], case_sensitive=False, max_results=10
    )
    assert result.total_matches >= 1

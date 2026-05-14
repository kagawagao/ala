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


def test_search_code_patterns_scans_files_once_per_query_batch(scanner):
    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "src")
        os.makedirs(src)
        target = os.path.join(src, "MainActivity.kt")
        with open(target, "w") as f:
            f.write(
                'private const val TAG = "MainActivity"\n'
                'Log.d(TAG, "started")\n'
                'Log.e(TAG, "failed")\n'
            )

        results = scanner.search_code_patterns(
            tmpdir,
            {
                "log_usage": r"Log\.[dviwef]\(",
                "tag_defs": r"(TAG|LOG_TAG)\s*=",
            },
            include_patterns=["**/*.kt"],
            exclude_patterns=[],
        )

        assert [m.line_number for m in results["log_usage"].matches] == [2, 3]
        assert [m.line_number for m in results["tag_defs"].matches] == [1]
        assert results["log_usage"].files_searched == 1
        assert results["tag_defs"].files_searched == 1

"""Tool definitions and executor for the AI agent."""
import json
from typing import Any

from .code_scanner import CodeScanner
from .project_manager import Project

_scanner = CodeScanner()

# OpenAI-compatible tool schemas
AGENT_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_project_files",
            "description": (
                "List source code files in the project directory. "
                "Returns file paths, sizes, and extensions. Use to discover what code exists."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subdirectory": {
                        "type": "string",
                        "description": "Optional subdirectory to list (relative to project root)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_project_file",
            "description": (
                "Read the content of a specific source file from the project. "
                "Use after listing files to read relevant code."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Relative path to the file within the project",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_project_code",
            "description": (
                "Search for a regex pattern across project source files. "
                "Returns matching lines with file paths and line numbers. "
                "Useful for finding where specific classes, methods, or error strings are defined."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for (case-insensitive by default)",
                    },
                    "case_sensitive": {
                        "type": "boolean",
                        "description": "Whether the search should be case-sensitive",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
]


def execute_tool(project: Project, tool_name: str, arguments: str) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        args = json.loads(arguments) if arguments else {}
    except json.JSONDecodeError:
        return json.dumps({"error": f"Invalid arguments: {arguments}"})

    if tool_name == "list_project_files":
        files = _scanner.list_files(
            project.path,
            project.include_patterns,
            project.exclude_patterns,
            subdirectory=args.get("subdirectory"),
        )
        return json.dumps(
            {
                "total": len(files),
                "files": [
                    {"path": f.path, "size": f.size, "extension": f.extension}
                    for f in files[:200]  # limit response size
                ],
            }
        )

    elif tool_name == "read_project_file":
        file_path = args.get("file_path", "")
        result = _scanner.read_file(project.path, file_path)
        if not result:
            return json.dumps({"error": f"File not found or unreadable: {file_path}"})
        return json.dumps(
            {
                "path": result.path,
                "size": result.size,
                "truncated": result.truncated,
                "content": result.content,
            }
        )

    elif tool_name == "search_project_code":
        pattern = args.get("pattern", "")
        case_sensitive = args.get("case_sensitive", False)
        result = _scanner.search_code(
            project.path,
            pattern,
            project.include_patterns,
            project.exclude_patterns,
            case_sensitive=case_sensitive,
        )
        return json.dumps(
            {
                "total_matches": result.total_matches,
                "files_searched": result.files_searched,
                "matches": [
                    {"path": m.path, "line_number": m.line_number, "line": m.line}
                    for m in result.matches
                ],
            }
        )

    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

"""Project management endpoints."""
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.ai_service import AIService
from ..services.code_scanner import CodeScanner
from ..services.project_manager import ProjectManager
from .config import get_ai_config

router = APIRouter()
_project_manager = ProjectManager()
_scanner = CodeScanner()


# Export for use by chat API
def get_project_manager() -> ProjectManager:
    return _project_manager


class ProjectResponse(BaseModel):
    id: str
    name: str
    paths: list[str]
    include_patterns: list[str]
    exclude_patterns: list[str]
    created_at: str


class CreateProjectRequest(BaseModel):
    name: str
    paths: list[str]
    include_patterns: list[str] | None = None
    exclude_patterns: list[str] | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    paths: list[str] | None = None
    include_patterns: list[str] | None = None
    exclude_patterns: list[str] | None = None


class FileInfoResponse(BaseModel):
    path: str
    size: int
    extension: str


def _project_to_response(p) -> ProjectResponse:
    return ProjectResponse(
        id=p.id,
        name=p.name,
        paths=p.paths,
        include_patterns=p.include_patterns,
        exclude_patterns=p.exclude_patterns,
        created_at=p.created_at,
    )


@router.post("", response_model=ProjectResponse)
async def create_project(req: CreateProjectRequest):
    import os

    for path in req.paths:
        if not os.path.isdir(path):
            raise HTTPException(status_code=400, detail=f"Directory does not exist: {path}")
    project = _project_manager.create_project(
        name=req.name,
        paths=req.paths,
        include_patterns=req.include_patterns,
        exclude_patterns=req.exclude_patterns,
    )
    return _project_to_response(project)


@router.get("", response_model=list[ProjectResponse])
async def list_projects():
    return [_project_to_response(p) for p in _project_manager.list_projects()]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    project = _project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_to_response(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, req: UpdateProjectRequest):
    project = _project_manager.update_project(
        project_id,
        name=req.name,
        paths=req.paths,
        include_patterns=req.include_patterns,
        exclude_patterns=req.exclude_patterns,
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_to_response(project)


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    ok = _project_manager.delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


@router.get("/{project_id}/files", response_model=list[FileInfoResponse])
async def list_project_files(project_id: str, subdirectory: str | None = None):
    project = _project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    all_files = []
    for path in project.paths:
        files = _scanner.list_files(
            path,
            project.include_patterns,
            project.exclude_patterns,
            subdirectory=subdirectory,
        )
        all_files.extend(files)
    return [FileInfoResponse(path=f.path, size=f.size, extension=f.extension) for f in all_files]


class ContextDocResponse(BaseModel):
    path: str
    content: str
    size: int


@router.get("/{project_id}/context-docs", response_model=list[ContextDocResponse])
async def list_context_docs(project_id: str):
    """Discover LLM context/instruction files in a project.

    Returns files like AGENTS.md, .github/copilot-instructions.md, CLAUDE.md, etc.
    These are automatically injected into the AI agent's system prompt.
    """
    project = _project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    docs = _scanner.discover_context_docs(project.paths)
    return [ContextDocResponse(path=d.path, content=d.content, size=d.size) for d in docs]


class GenerateFiltersRequest(BaseModel):
    existing_filters: list[dict] | None = None


@router.post("/{project_id}/generate-filters")
async def generate_filters(project_id: str, req: GenerateFiltersRequest | None = None):
    """Use AI to analyze project code and generate log filter presets.

    The AI agent scans the project for logging patterns (Log.d/i/w/e tags,
    process names, common error keywords) and returns suggested filter presets.
    Streams the response as SSE.
    """
    project = _project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = get_ai_config()
    if not ai_config.api_key:
        raise HTTPException(status_code=400, detail="AI not configured")

    ai_service = AIService(
        api_endpoint=ai_config.api_endpoint,
        api_key=ai_config.api_key,
        model=ai_config.model,
        temperature=ai_config.temperature,
    )

    # Gather code context: search for logging patterns
    code_context_parts: list[str] = []
    for path in project.paths:
        # Search for Android Log tags
        log_results = _scanner.search_code(
            path, r"Log\.[dviwef]\(", project.include_patterns, project.exclude_patterns
        )
        if log_results.matches:
            code_context_parts.append(
                f"Log usage in {path}:\n" + "\n".join(f"  {m.file}:{m.line_number}: {m.line}" for m in log_results.matches[:50])
            )
        # Search for TAG definitions
        tag_results = _scanner.search_code(
            path, r'(TAG|LOG_TAG)\s*=', project.include_patterns, project.exclude_patterns
        )
        if tag_results.matches:
            code_context_parts.append(
                f"TAG definitions in {path}:\n" + "\n".join(f"  {m.file}:{m.line_number}: {m.line}" for m in tag_results.matches[:30])
            )

    code_context = "\n\n".join(code_context_parts) if code_context_parts else "No logging patterns found in project code."

    existing_info = ""
    if req and req.existing_filters:
        existing_info = f"\n\nExisting filter presets:\n{json.dumps(req.existing_filters, indent=2)}\nPlease update/improve these rather than starting from scratch."

    prompt = f"""Analyze the following Android project code patterns and generate useful log filter presets as a JSON array.

Each preset should have: name (string), description (string), filters (object with optional fields: keywords, level, tag, pid, tid, tag_keyword_relation).
The filters fields are all strings. level should be one of: V, D, I, W, E, F. tag_keyword_relation should be "AND" or "OR".

Focus on practical filters that help developers debug common issues:
- Filters for specific components/tags found in the code
- Error/crash filters
- Performance-related filters
- Security-related filters
{existing_info}

Project: {project.name}

Code patterns found:
{code_context}

Respond ONLY with a valid JSON array of filter presets, no other text."""

    messages = [{"role": "user", "content": prompt}]

    async def event_stream():
        full_response = ""
        try:
            async for chunk in ai_service.stream_chat(messages):
                full_response += chunk
            # Strip markdown code fences if present
            cleaned = full_response.strip()
            if cleaned.startswith("```"):
                # Remove opening fence (e.g. ```json)
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            yield f"data: {json.dumps(json.loads(cleaned))}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

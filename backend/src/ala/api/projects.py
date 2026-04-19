"""Project management endpoints."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.code_scanner import CodeScanner
from ..services.project_manager import ProjectManager

router = APIRouter()
_project_manager = ProjectManager()
_scanner = CodeScanner()


# Export for use by chat API
def get_project_manager() -> ProjectManager:
    return _project_manager


class ProjectResponse(BaseModel):
    id: str
    name: str
    path: str
    include_patterns: list[str]
    exclude_patterns: list[str]
    created_at: str


class CreateProjectRequest(BaseModel):
    name: str
    path: str
    include_patterns: list[str] | None = None
    exclude_patterns: list[str] | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    path: str | None = None
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
        path=p.path,
        include_patterns=p.include_patterns,
        exclude_patterns=p.exclude_patterns,
        created_at=p.created_at,
    )


@router.post("", response_model=ProjectResponse)
async def create_project(req: CreateProjectRequest):
    import os

    if not os.path.isdir(req.path):
        raise HTTPException(status_code=400, detail=f"Directory does not exist: {req.path}")
    project = _project_manager.create_project(
        name=req.name,
        path=req.path,
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
        path=req.path,
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

    files = _scanner.list_files(
        project.path,
        project.include_patterns,
        project.exclude_patterns,
        subdirectory=subdirectory,
    )
    return [FileInfoResponse(path=f.path, size=f.size, extension=f.extension) for f in files]

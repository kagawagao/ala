# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for ALA (Android Log Analyzer).

Build prerequisites:
  1. Build the React frontend first:
       cd frontend && npm run build
  2. Install pyinstaller in the backend venv:
       cd backend && poetry install
  3. Run from the repo root:
       cd backend && poetry run pyinstaller ala.spec

Output: backend/dist/ala/   (directory with the executable inside)
"""
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

REPO_ROOT = Path(SPECPATH).parent  # noqa: F821 – SPECPATH is set by PyInstaller
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

if not FRONTEND_DIST.is_dir():
    raise FileNotFoundError(
        f"Frontend dist not found at {FRONTEND_DIST}. "
        "Run 'npm run build' in the frontend directory first."
    )

# ---------------------------------------------------------------------------
# Data files
# ---------------------------------------------------------------------------
datas = [
    # Embed the built React SPA.  It will be extracted to sys._MEIPASS/frontend_dist/
    (str(FRONTEND_DIST), "frontend_dist"),
]

# Collect data files shipped with perfetto (trace_processor binary)
datas += collect_data_files("perfetto", includes=["**/*"])

# Collect CA certificates bundled with certifi (required for HTTPS calls to Anthropic API)
datas += collect_data_files("certifi")

# httpx ships its own CA bundle too
datas += collect_data_files("httpx")

# ---------------------------------------------------------------------------
# Hidden imports that PyInstaller's static analysis misses
# ---------------------------------------------------------------------------
hiddenimports = [
    # uvicorn internals loaded dynamically
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # anyio backends
    "anyio._backends._asyncio",
    "anyio._backends._trio",
    # starlette / fastapi internals
    "starlette.middleware.cors",
    "starlette.staticfiles",
    "starlette.responses",
    # pydantic v2
    "pydantic.v1",
    # pydantic-settings
    "pydantic_settings",
    # sse-starlette
    "sse_starlette",
    "sse_starlette.sse",
    # python-multipart
    "multipart",
    # anthropic SDK
    "anthropic",
    "anthropic._streaming",
    "anthropic._client",
    # fastmcp
    "fastmcp",
    "mcp",
    "mcp.server",
    "mcp.server.streamable_http",
    # perfetto
    "perfetto",
    "perfetto.trace_processor",
    "perfetto.trace_processor.api",
]

# Collect all submodules of packages with heavy dynamic import usage
for pkg in ("anthropic", "fastmcp", "mcp"):
    hiddenimports += collect_submodules(pkg)

# ---------------------------------------------------------------------------
# Binaries (shared libraries)
# ---------------------------------------------------------------------------
binaries = []

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(  # noqa: F821
    ["ala_server.py"],
    pathex=[str(REPO_ROOT / "backend" / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy unused packages to keep binary size manageable
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "scipy",
        "PIL",
        "IPython",
        "jupyter",
        "notebook",
        "test",
        "unittest",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ala",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Keep console for log output; set to False for a pure GUI app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(REPO_ROOT / "assets" / "icons" / "icon.ico") if sys.platform == "win32" else (
        str(REPO_ROOT / "assets" / "icons" / "512x512.png") if sys.platform == "linux" else None
    ),
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ala",
)

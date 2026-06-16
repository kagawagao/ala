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
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules, copy_metadata

_spec_path = Path(SPECPATH)  # noqa: F821 – SPECPATH is set by PyInstaller
# SPECPATH may be either the spec directory (e.g. ".../backend") or the spec file
# path (e.g. ".../backend/ala.spec") depending on invocation context.
_spec_location = _spec_path if _spec_path.is_dir() else _spec_path.parent
REPO_ROOT = (
    _spec_location.parent if _spec_location.name == "backend" else _spec_location
)
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

# ── Bundled ripgrep binary ────────────────────────────────────────────────
# Include the platform-specific rg binary so the frozen app always has a
# ripgrep available.  The code in code_scanner._discover_rg() will still
# prefer a newer system install if one exists.
_RG_BIN_DIR = REPO_ROOT / "backend" / "src" / "ala" / "bin" / sys.platform
_RG_NAME = "rg.exe" if sys.platform == "win32" else "rg"
_RG_BINARY = _RG_BIN_DIR / _RG_NAME
if _RG_BINARY.is_file():
    # Extract to sys._MEIPASS/ala/bin/rg (matching _get_bundled_rg_path)
    datas.append((str(_RG_BINARY), "ala/bin"))
    print(f"  Bundled rg: {_RG_BINARY} ({_RG_BINARY.stat().st_size:,} bytes)")
else:
    print(f"  WARNING: Bundled rg not found at {_RG_BINARY} - rg will only work if installed on target")

# Copy .dist-info metadata for packages that call importlib.metadata.version() at import time.
# Without this, PackageNotFoundError is raised when the frozen exe tries to read package versions.
for _pkg in (
    "fastmcp",
    "mcp",
    "anthropic",
    "fastapi",
    "starlette",
    "uvicorn",
    "pydantic",
    "pydantic_settings",
    "anyio",
    "httpx",
    "sse_starlette",
):
    try:
        datas += copy_metadata(_pkg)
    except Exception:
        pass  # package not installed; skip gracefully

# ---------------------------------------------------------------------------
# Hidden imports that PyInstaller's static analysis misses
# ---------------------------------------------------------------------------
hiddenimports = [
    # Python stdlib C extensions sometimes missed on Windows
    "socket",          # ensures _socket.pyd is bundled (fixes pyi_rth_multiprocessing crash)
    "_ssl",            # also a C extension; belt-and-suspenders

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

# Collect all submodules of packages with heavy dynamic import usage.
# mcp is excluded from collect_submodules because mcp.cli requires the optional
# 'typer' package which is not a runtime dependency; we list mcp submodules manually.
for pkg in ("anthropic", "fastmcp"):
    hiddenimports += collect_submodules(pkg)

# Manually include the mcp submodules we actually use (skipping mcp.cli)
hiddenimports += collect_submodules("mcp", filter=lambda name: not name.startswith("mcp.cli"))

# ---------------------------------------------------------------------------
# Binaries (shared libraries)
# ---------------------------------------------------------------------------
binaries = []

# Collect OpenSSL DLLs required by the _ssl module on Windows.
# These live in the Python installation's DLLs directory but PyInstaller
# does not always pick them up automatically.
#
# DLL names vary across Python distributions:
#   python.org 3.12+      → libcrypto-3.dll / libssl-3.dll
#   some builds           → libcrypto-3-x64.dll / libssl-3-x64.dll
#   Python 3.11           → libcrypto-1_1.dll / libssl-1_1.dll
#   conda / MS Store      → may be in bin/ instead of DLLs/
#
# We search with glob patterns so we catch any naming variant.
if sys.platform == "win32":
    _ssl_search_dirs = [
        Path(sys.prefix) / "DLLs",
        Path(sys.prefix) / "bin",
    ]
    _ssl_dll_patterns = [
        "libcrypto-*.dll",
        "libssl-*.dll",
        "libcrypto_*.dll",
        "libssl_*.dll",
    ]

    _found_ssl = []
    for _search_dir in _ssl_search_dirs:
        if not _search_dir.is_dir():
            continue
        for _pat in _ssl_dll_patterns:
            for _dll_path in sorted(_search_dir.glob(_pat)):
                _name = _dll_path.name
                if _name not in _found_ssl:
                    binaries.append((str(_dll_path), "."))
                    _found_ssl.append(_name)
                    print(f"  Bundled {_name} from {_search_dir}")

    if not _found_ssl:
        # Failing to bundle OpenSSL DLLs means the frozen exe will crash
        # at startup with "ImportError: DLL load failed while importing _ssl".
        # Surface what's available so the problem is debuggable.
        print("  ERROR: No OpenSSL DLLs found! The frozen exe will fail at runtime.")
        print(f"  Searched dirs: {[str(d) for d in _ssl_search_dirs]}")
        for _search_dir in _ssl_search_dirs:
            if _search_dir.is_dir():
                _all = sorted(_search_dir.glob("*.dll"))
                print(f"  DLLs in {_search_dir}: {[d.name for d in _all]}")
        raise FileNotFoundError(
            "Cannot bundle OpenSSL DLLs – searched for libcrypto*/libssl* DLLs in "
            f"{[str(d) for d in _ssl_search_dirs]} but none were found. "
            "Install Python from python.org or ensure OpenSSL DLLs are available."
        )

    # Also collect Visual C++ Redistributable DLLs if they live next to Python.
    # _ssl.pyd (and many other C extensions) depend on VCRUNTIME140.dll.
    # PyInstaller normally picks these up, but only if they are on the DLL search
    # path during analysis.  Explicitly adding them is belt-and-suspenders.
    for _vc_name in ("VCRUNTIME140.dll", "VCRUNTIME140_1.dll"):
        for _search_dir in _ssl_search_dirs:
            _vc_path = _search_dir / _vc_name
            if _vc_path.is_file():
                binaries.append((str(_vc_path), "."))
                print(f"  Bundled {_vc_name}")
                break

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

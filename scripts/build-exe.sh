#!/usr/bin/env bash
# Build ALA as a standalone executable using PyInstaller.
#
# Usage:
#   bash scripts/build-exe.sh
#
# Prerequisites:
#   - Node.js 20+  (for frontend build)
#   - Python 3.12+ with Poetry  (for backend + PyInstaller)
#
# Output:
#   backend/dist/ala/ala  (or ala.exe on Windows via WSL)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info()  { echo "[ALA] $*"; }
ok()    { echo "[ALA] ✓ $*"; }
err()   { echo "[ALA] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Step 1: Build the React frontend
# ---------------------------------------------------------------------------
info "Building React frontend..."
cd "$REPO_ROOT/frontend"
npm install
npm run build
ok "Frontend built → frontend/dist/"

# ---------------------------------------------------------------------------
# Step 2: Install backend + PyInstaller dependencies
# ---------------------------------------------------------------------------
info "Installing backend dependencies (Poetry)..."
cd "$REPO_ROOT/backend"
poetry install
ok "Backend dependencies installed."

# ---------------------------------------------------------------------------
# Step 3: Run PyInstaller
# ---------------------------------------------------------------------------
info "Running PyInstaller..."
cd "$REPO_ROOT/backend"
poetry run pyinstaller ala.spec --noconfirm

ok "Build complete!"
info "Executable: backend/dist/ala/ala"
info ""
info "To run:  ./backend/dist/ala/ala"
info "         Then open http://localhost:8000 in your browser."
info ""
info "To distribute: zip/tar the backend/dist/ala/ directory."

#!/usr/bin/env bash
# ALA — Android Log Analyzer
# One-click helper script for Linux / macOS.
#
# Usage: ./scripts/ala.sh <command>
#
# Commands:
#   install   Install all dependencies (Node.js root/frontend + Python/Poetry backend)
#   dev       Start development servers (backend + frontend, hot-reload)
#   build     Build frontend for production
#   deploy    Deploy the full stack with Docker Compose

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_cyan='\033[0;36m'
_green='\033[0;32m'
_yellow='\033[0;33m'
_red='\033[0;31m'
_reset='\033[0m'

info()  { echo -e "${_cyan}[ALA]${_reset} $*"; }
ok()    { echo -e "${_green}[ALA]${_reset} $*"; }
warn()  { echo -e "${_yellow}[ALA]${_reset} $*"; }
err()   { echo -e "${_red}[ALA]${_reset} $*" >&2; exit 1; }

require() {
  local cmd="$1" hint="${2:-}"
  if ! command -v "$cmd" &>/dev/null; then
    err "'$cmd' not found.${hint:+ $hint}"
  fi
}

docker_compose() {
  # Prefer Docker Compose V2 plugin, fall back to standalone docker-compose
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    err "Docker Compose not found. Install from https://docs.docker.com/compose/"
  fi
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  install   Install all dependencies (Node.js root/frontend + Python/Poetry backend)
  dev       Start development servers (backend + frontend, hot-reload)
  build     Build frontend for production
  deploy    Deploy the full stack with Docker Compose

Examples:
  ./scripts/ala.sh install
  ./scripts/ala.sh dev
  ./scripts/ala.sh build
  ./scripts/ala.sh deploy
EOF
  exit 1
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_install() {
  info "Checking prerequisites..."
  require node   "Install Node.js 20+ from https://nodejs.org"
  require npm    "Install Node.js 20+ from https://nodejs.org"
  require poetry "Run: pip install poetry  (see https://python-poetry.org)"

  info "Installing root workspace dependencies..."
  cd "$REPO_ROOT"
  npm install

  info "Installing backend dependencies (Poetry)..."
  cd "$REPO_ROOT/backend"
  poetry install

  info "Installing frontend dependencies..."
  cd "$REPO_ROOT/frontend"
  npm install

  cd "$REPO_ROOT"
  ok "All dependencies installed successfully."
  info "Next step: ./scripts/ala.sh dev"
}

cmd_dev() {
  require node   "Install Node.js 20+ from https://nodejs.org"
  require poetry "Run: pip install poetry"

  info "Starting development servers (Ctrl+C to stop)..."
  info "  Backend  → http://localhost:8000"
  info "  Frontend → http://localhost:5173"
  cd "$REPO_ROOT"
  npm run dev
}

cmd_build() {
  require node "Install Node.js 20+ from https://nodejs.org"

  info "Building frontend for production..."
  cd "$REPO_ROOT"
  npm run build

  ok "Build complete — output: frontend/dist/"
}

cmd_deploy() {
  require docker "Install Docker from https://docs.docker.com/get-docker/"

  # Ensure backend .env exists
  if [[ ! -f "$REPO_ROOT/backend/.env" ]]; then
    info "Creating backend/.env from .env.example..."
    cp "$REPO_ROOT/backend/.env.example" "$REPO_ROOT/backend/.env"
    warn "Edit backend/.env and set AI_API_KEY to enable AI features."
  fi

  info "Building and starting containers with Docker Compose..."
  cd "$REPO_ROOT"
  docker_compose up --build -d

  ok "Deployed!"
  info "  Frontend → http://localhost"
  info "  Backend  → http://localhost:8000"
  info "  MCP      → http://localhost:8000/mcp"
  info ""
  info "View logs:   docker compose logs -f"
  info "Stop stack:  docker compose down"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
[[ $# -lt 1 ]] && usage

case "$1" in
  install) cmd_install ;;
  dev)     cmd_dev ;;
  build)   cmd_build ;;
  deploy)  cmd_deploy ;;
  *)       usage ;;
esac

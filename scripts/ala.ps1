# ALA — Android Log Analyzer
# One-click helper script for Windows (PowerShell 5.1+) and cross-platform PowerShell 7+.
#
# Usage: .\scripts\ala.ps1 <command>
#
# Commands:
#   install   Install all dependencies (Node.js root/frontend + Python/Poetry backend)
#   dev       Start development servers (backend + frontend, hot-reload)
#   build     Build frontend for production
#   deploy    Deploy the full stack with Docker Compose

param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet("install", "dev", "build", "deploy")]
  [string]$Command
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info  { param([string]$Msg) Write-Host "[ALA] $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[ALA] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[ALA] $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[ALA] ERROR: $Msg" -ForegroundColor Red; exit 1 }

function Require-Command {
  param([string]$Cmd, [string]$Hint = "")
  if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
    $msg = "'$Cmd' not found."
    if ($Hint) { $msg += " $Hint" }
    Write-Err $msg
  }
}

function Invoke-DockerCompose {
  param([string[]]$Args)
  # Prefer Docker Compose V2 plugin, fall back to standalone docker-compose
  $v2 = docker compose version 2>$null
  if ($LASTEXITCODE -eq 0) {
    docker compose @Args
  } else {
    $legacy = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($legacy) {
      docker-compose @Args
    } else {
      Write-Err "Docker Compose not found. Install from https://docs.docker.com/compose/"
    }
  }
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

function Invoke-Install {
  Write-Info "Checking prerequisites..."
  Require-Command "node"   "Install Node.js 20+ from https://nodejs.org"
  Require-Command "npm"    "Install Node.js 20+ from https://nodejs.org"
  Require-Command "poetry" "Run: pip install poetry  (see https://python-poetry.org)"

  Write-Info "Installing root workspace dependencies..."
  Set-Location $RepoRoot
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed" }

  Write-Info "Installing backend dependencies (Poetry)..."
  Set-Location "$RepoRoot\backend"
  poetry install
  if ($LASTEXITCODE -ne 0) { Write-Err "poetry install failed" }

  Write-Info "Installing frontend dependencies..."
  Set-Location "$RepoRoot\frontend"
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Err "npm install (frontend) failed" }

  Set-Location $RepoRoot
  Write-Ok "All dependencies installed successfully."
  Write-Info "Next step: .\scripts\ala.ps1 dev"
}

function Invoke-Dev {
  Require-Command "node"   "Install Node.js 20+ from https://nodejs.org"
  Require-Command "poetry" "Run: pip install poetry"

  Write-Info "Starting development servers (Ctrl+C to stop)..."
  Write-Info "  Backend  -> http://localhost:8000"
  Write-Info "  Frontend -> http://localhost:5173"
  Set-Location $RepoRoot
  npm run dev
}

function Invoke-Build {
  Require-Command "node" "Install Node.js 20+ from https://nodejs.org"

  Write-Info "Building frontend for production..."
  Set-Location $RepoRoot
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Err "Build failed" }

  Write-Ok "Build complete — output: frontend/dist/"
}

function Invoke-Deploy {
  Require-Command "docker" "Install Docker from https://docs.docker.com/get-docker/"

  # Ensure backend .env exists
  $envFile = "$RepoRoot\backend\.env"
  $envExample = "$RepoRoot\backend\.env.example"
  if (-not (Test-Path $envFile)) {
    Write-Info "Creating backend/.env from .env.example..."
    Copy-Item $envExample $envFile
    Write-Warn "Edit backend/.env and set AI_API_KEY to enable AI features."
  }

  Write-Info "Building and starting containers with Docker Compose..."
  Set-Location $RepoRoot
  Invoke-DockerCompose @("up", "--build", "-d")
  if ($LASTEXITCODE -ne 0) { Write-Err "Docker Compose failed" }

  Write-Ok "Deployed!"
  Write-Info "  Frontend -> http://localhost"
  Write-Info "  Backend  -> http://localhost:8000"
  Write-Info "  MCP      -> http://localhost:8000/mcp"
  Write-Info ""
  Write-Info "View logs:   docker compose logs -f"
  Write-Info "Stop stack:  docker compose down"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
switch ($Command) {
  "install" { Invoke-Install }
  "dev"     { Invoke-Dev }
  "build"   { Invoke-Build }
  "deploy"  { Invoke-Deploy }
}

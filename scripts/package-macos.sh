#!/usr/bin/env bash
# Package ALA as a macOS .app bundle and DMG.
#
# Usage:
#   bash scripts/package-macos.sh --version 2.3.4
#   bash scripts/package-macos.sh --version 2.3.4 --output-dir ./my-release --min-version 12.0
#
# Prerequisites:
#   - backend/dist/ala/ must exist (run scripts/build-exe.sh first)
#   - hdiutil (built-in on macOS)
#
# Output:
#   {output-dir}/ALA-{version}-macos.dmg

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERSION=""
OUTPUT_DIR="release-assets"
MACOS_MIN_VERSION="12.0"

usage() {
  echo "Usage: $0 --version <version> [--output-dir <dir>] [--min-version <ver>]"
  echo ""
  echo "  --version       Version string (default: read from package.json)"
  echo "  --output-dir    Output directory (default: release-assets)"
  echo "  --min-version   macOS deployment target (default: 12.0)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --min-version) MACOS_MIN_VERSION="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null) || true
  if [[ -z "$VERSION" ]]; then
    echo "ERROR: Could not read version from package.json. Provide --version."
    usage
  fi
  info "Version from package.json: $VERSION"
fi
[[ ! -d "$REPO_ROOT/backend/dist/ala" ]] && {
  echo "ERROR: backend/dist/ala/ not found. Run scripts/build-exe.sh first."
  exit 1
}

info()  { echo "[package-macos] $*"; }

info "Packaging ALA v$VERSION for macOS..."
info "  Deployment target: macOS $MACOS_MIN_VERSION"

# ---- .app bundle ----
APP_DIR="$REPO_ROOT/dist/macos/ALA.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

info "Copying PyInstaller output → $APP_DIR/Contents/MacOS/"
cp -R "$REPO_ROOT/backend/dist/ala/." "$APP_DIR/Contents/MacOS/"

# Icon
if [[ -f "$REPO_ROOT/assets/icons/icon.icns" ]]; then
  cp "$REPO_ROOT/assets/icons/icon.icns" "$APP_DIR/Contents/Resources/"
fi

# Info.plist
cat > "$APP_DIR/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>ala</string>
    <key>CFBundleIdentifier</key>
    <string>com.kagawagao.ala</string>
    <key>CFBundleName</key>
    <string>ALA</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>LSMinimumSystemVersion</key>
    <string>$MACOS_MIN_VERSION</string>
  </dict>
</plist>
EOF

# ---- DMG ----
OUTPUT_DIR_FULL="$REPO_ROOT/$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR_FULL"
DMG_PATH="$OUTPUT_DIR_FULL/ALA-$VERSION-macos.dmg"

info "Creating DMG..."
hdiutil create -volname "ALA" -srcfolder "$REPO_ROOT/dist/macos" -ov -format UDZO "$DMG_PATH"

echo ""
info "Done: $DMG_PATH"

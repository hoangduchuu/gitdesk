#!/usr/bin/env bash
# GitDesk installer for macOS (Apple Silicon).
# Usage: curl -fsSL https://raw.githubusercontent.com/hoangduchuu/gitdesk/develop/install.sh | bash
set -euo pipefail

REPO="hoangduchuu/gitdesk"
APP="GitDesk.app"
DEST="/Applications"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "GitDesk only supports macOS." >&2; exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "This build is for Apple Silicon (arm64) only." >&2; exit 1
fi

TMP="$(mktemp -d)"
MOUNT=""
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "→ Finding latest release..."
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*arm64\.dmg"' \
  | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[ -n "$URL" ] || { echo "Could not find a .dmg in the latest release." >&2; exit 1; }

echo "→ Downloading $URL"
curl -fL --progress-bar -o "$TMP/GitDesk.dmg" "$URL"

echo "→ Mounting..."
MOUNT="$(hdiutil attach "$TMP/GitDesk.dmg" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)"

pkill -x GitDesk 2>/dev/null || true
echo "→ Installing to $DEST"
rm -rf "$DEST/$APP"
cp -R "$MOUNT/$APP" "$DEST/"

# Files fetched by curl are not quarantined, but clear it anyway to be safe.
xattr -cr "$DEST/$APP"

echo "✓ Installed. Open it from Launchpad or run: open -a GitDesk"

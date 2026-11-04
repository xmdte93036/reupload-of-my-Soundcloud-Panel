#!/usr/bin/env bash
# Linux/macOS equivalent of build-extension.ps1. Needs: zip (or python3 as fallback).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
DIST="$ROOT/dist"

[[ -d "$EXT" ]] || { echo "Missing extension folder at $EXT" >&2; exit 1; }
mkdir -p "$DIST"

copy_common() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -r "$EXT/icons" "$dest/"
  for f in content.js content-spotify.js themes.css mini-player.html mini-player.js; do
    cp "$EXT/$f" "$dest/"
  done
}

# .xpi/.zip must have forward-slash entries; `zip -r` from inside the dir does that.
make_zip() {
  local dir="$1" out="$2"
  rm -f "$out"
  if command -v zip >/dev/null 2>&1; then
    (cd "$dir" && zip -qr "$out" . -x '.*')
  else
    python3 - "$dir" "$out" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, src).replace(os.sep, '/'))
PY
  fi
}

echo "Building Chrome/Edge (MV3)..."
CHROME="$DIST/extension-chrome"
copy_common "$CHROME"
for f in manifest.json background.js popup.html popup.js; do cp "$EXT/$f" "$CHROME/"; done
make_zip "$CHROME" "$DIST/soundcloud-mini-player-chrome.zip"

echo "Building Firefox (MV2)..."
FF="$DIST/extension-firefox"
copy_common "$FF"
for f in background-firefox.js popup-firefox.html popup-firefox.js; do cp "$EXT/$f" "$FF/"; done
# manifest-firefox.json is renamed to manifest.json in the built copy.
cp "$EXT/manifest-firefox.json" "$FF/manifest.json"
make_zip "$FF" "$DIST/soundcloud-mini-player-firefox-v3.3.xpi"

echo
echo "Done:"
echo " - $DIST/soundcloud-mini-player-chrome.zip"
echo " - $DIST/soundcloud-mini-player-firefox-v3.3.xpi"
echo " - unpacked dirs: $CHROME, $FF"
echo
echo "Chrome/Edge: chrome://extensions -> Developer mode -> Load unpacked -> $CHROME"
echo "Firefox:     about:debugging -> Load Temporary Add-on -> $FF/manifest.json"

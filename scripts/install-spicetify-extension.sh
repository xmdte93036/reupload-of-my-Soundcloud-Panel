#!/usr/bin/env bash
# Installs the Spicetify custom app (not a browser extension) into CustomApps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/spicetify/custom-apps/soundcloud-mini-player"
APP_FOLDER="soundcloud-mini-player"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/spicetify"
DEST_DIR="$CONFIG_DIR/CustomApps/$APP_FOLDER"
LEGACY_EXT="$CONFIG_DIR/Extensions/soundcloud-mini-player-bridge.js"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Source not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_DIR")"
rm -rf "$DEST_DIR"
cp -a "$SRC_DIR" "$DEST_DIR"
echo "Installed custom app: $DEST_DIR"
echo
echo "IMPORTANT: Restart Spotify completely after spicetify apply for bridge updates to load."

if [[ -f "$LEGACY_EXT" ]]; then
  rm -f "$LEGACY_EXT"
  echo "Removed old extension file: $LEGACY_EXT"
fi

if command -v spicetify >/dev/null 2>&1; then
  echo "Configuring Spicetify custom app..."
  current_apps="$(spicetify config custom_apps 2>/dev/null | tr -d '\r' || true)"
  if echo "$current_apps" | grep -Fq "$APP_FOLDER"; then
    echo "Custom app already listed."
  elif [[ -n "${current_apps// }" ]]; then
    spicetify config custom_apps "${current_apps}|${APP_FOLDER}"
  else
    spicetify config custom_apps "$APP_FOLDER"
  fi

  current_ext="$(spicetify config extensions 2>/dev/null | tr -d '\r' || true)"
  if echo "$current_ext" | grep -Fq 'soundcloud-mini-player-bridge'; then
    cleaned="$(echo "$current_ext" | tr '|' '\n' | grep -v '^$' | grep -v 'soundcloud-mini-player-bridge' | paste -sd '|' -)"
    spicetify config extensions "$cleaned"
    echo "Removed legacy extension entry from config."
  fi

  echo "Run: spicetify apply"
  echo "Restart Spotify. Open sidebar item: Mini Player"
else
  echo
  echo "Spicetify CLI not on PATH. Manual steps:"
  echo "  spicetify config custom_apps $APP_FOLDER"
  echo "  spicetify apply"
fi

echo
echo "Usage:"
echo "  1. Start the desktop mini player (npm start or the AppImage)."
echo "  2. Restart Spotify after spicetify apply."
echo "  3. Bridge starts with Spotify. Optional: open Mini Player in sidebar for status."

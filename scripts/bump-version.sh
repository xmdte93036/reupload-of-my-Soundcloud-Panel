#!/usr/bin/env bash
# Bump the release version everywhere it is hard-coded: package files, extension
# manifests, popup footers, README download names, and the Firefox XPI filename.
# Usage: ./scripts/bump-version.sh 3.2.0
set -euo pipefail

NEW="${1:?usage: bump-version.sh <version>  (e.g. 3.2.0)}"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Expected MAJOR.MINOR.PATCH, got '$NEW'" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OLD="$(node -p "require('./package.json').version")"
[[ "$OLD" != "$NEW" ]] || { echo "Already at $NEW"; exit 0; }
MINOR="${NEW%.*}"
MAJOR_MINOR="${NEW%.*}"

node - "$OLD" "$NEW" <<'NODE'
const fs = require('fs');
const [oldVer, newVer] = process.argv.slice(2);
const minorLabel = newVer.split('.').slice(0, 2).join('.');
const oldMinorLabel = oldVer.split('.').slice(0, 2).join('.');
const fromLabel = `SoundCloud Mini Player v${oldMinorLabel}`;

const edits = [
  ['package.json', `"version": "${oldVer}"`, `"version": "${newVer}"`],
  ['extension/manifest.json', `"version": "${oldVer}"`, `"version": "${newVer}"`],
  ['extension/manifest-firefox.json', `"version": "${oldVer}"`, `"version": "${newVer}"`],
  ['extension/popup.html', fromLabel, `SoundCloud Mini Player v${minorLabel}`],
  ['extension/popup-firefox.html', fromLabel, `SoundCloud Mini Player v${minorLabel}`],
  ['README.md', `${oldVer}.AppImage`, `${newVer}.AppImage`],
  ['README.md', `${oldVer}.exe`, `${newVer}.exe`],
];

for (const [file, from, to] of edits) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const next = from instanceof RegExp ? text.replace(from, to) : text.split(from).join(to);
  if (next === text) { console.warn(`skip (no match): ${file} <- ${from}`); continue; }
  fs.writeFileSync(file, next);
}

// package-lock appears twice: root "version" and packages."".version
const lock = 'package-lock.json';
if (fs.existsSync(lock)) {
  const text = fs.readFileSync(lock, 'utf8');
  fs.writeFileSync(lock, text.replace(new RegExp(`"version": "${oldVer.replace(/\./g, '\\.')}"`, 'g'), `"version": "${newVer}"`));
}
NODE

# Firefox XPI filename + the two echo lines that reference it.
for f in scripts/build-extension.sh scripts/build-extension.ps1; do
  [[ -f "$f" ]] || continue
  sed -i "s/soundcloud-mini-player-firefox-v[0-9][0-9.]*\.xpi/soundcloud-mini-player-firefox-v${MAJOR_MINOR}.xpi/g" "$f"
done
sed -i "s/firefox-v[0-9][0-9.]*\.xpi/firefox-v${MAJOR_MINOR}.xpi/g" README.md

echo "Bumped $OLD -> $NEW (extension/README label v${MAJOR_MINOR})"
grep -h '"version"' package.json extension/manifest.json extension/manifest-firefox.json

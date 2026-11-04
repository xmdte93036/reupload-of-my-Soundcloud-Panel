# SoundCloud Mini Player

Always-on-top mini player for **SoundCloud** and **Spotify**. It sits on your desktop, shows the current track, and talks to your browser (or Spicetify) over a local WebSocket bridge.

**License:** MIT — see [LICENSE](LICENSE).

## Downloads

Grab the latest files from **Releases**:

| Platform | File |
| --- | --- |
| Linux | `SoundCloud Mini Player-3.2.0.AppImage` |
| Windows | `SoundCloud Mini Player 3.2.0.exe` (portable, no installer) |

On first launch the app writes a Desktop shortcut to itself.

## What you need

- The desktop app (AppImage or `.exe`)
- **SoundCloud** or **Spotify in the browser:** load the `extension` folder unpacked in Chrome / Chromium / Brave / Edge
- **Spotify desktop (optional):** [Spicetify custom app](spicetify/README.md) instead of the browser extension — do not use both on Spotify at once

## Linux (Mint / Ubuntu)

1. Download the AppImage and mark it executable: `chmod +x "SoundCloud Mini Player-3.2.0.AppImage"`
2. Double-click it (or run it from a terminal)
3. Chrome → Extensions → Developer mode → **Load unpacked** → select the `extension` folder
4. Play something on SoundCloud or [open.spotify.com](https://open.spotify.com)

If Electron’s download stalls when building from source:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

If the AppImage asks for FUSE, install `libfuse2`.

## Windows

1. Download the portable `.exe` from Releases and double-click it
2. Edge/Chrome → Extensions → Developer mode → **Load unpacked** → `extension` folder

## Run from source

Node.js 18+:

```bash
npm install
npm start
```

The bridge listens on `ws://127.0.0.1:8765` (override with `SOUNDCLOUD_MINI_PLAYER_WS_PORT`).

## Build

```bash
npm install
npm run dist:linux   # AppImage → release/
npm run dist         # Windows portable .exe → release/
npm run pack         # unpacked dir only → release/linux-unpacked/ (fastest for testing)
```

Windows `.exe` builds are normally done on Windows. Building them from Linux needs Wine.

### Build the browser extension

Packages the extension into loadable folders plus uploadable archives.

Linux/macOS:

```bash
./scripts/build-extension.sh
```

Windows:

```powershell
.\scripts\build-extension.ps1
```

Both produce the same output:

| Output | Use |
| --- | --- |
| `dist/extension-chrome/` | Chrome/Edge — load unpacked |
| `dist/extension-firefox/` | Firefox — load temporary add-on |
| `dist/soundcloud-mini-player-chrome.zip` | Upload to the Chrome Web Store |
| `dist/soundcloud-mini-player-firefox-v3.2.xpi` | Upload to AMO |

The Firefox build renames `manifest-firefox.json` to `manifest.json`, so load `dist/extension-firefox/manifest.json` — not the source folder.

Requires `zip`, or falls back to `python3` automatically.

## Customizing the layout

All desktop-app layout lives in **`index.html`**. `main.js` only sets the window size (`360x105`); if you make the card taller, update both.

The player is a two-column grid: album art on the left, and a right column holding the title, artist, status, and controls. Both the text and the controls span the full height of the art; the buttons sit on top of the text's bottom-right corner rather than claiming their own row.

```css
.main-content {
    grid-template-columns: 64px minmax(0, 1fr);  /* art width | text+controls */
    column-gap: 8px;
}

.track-info      { grid-row: 1 / span 2; }  /* text uses the full art height */
.controls-section{ grid-row: 1 / span 2;    /* buttons overlay the bottom-right */
                   justify-self: end; align-self: end; }
```

### Move the title, artist, and status together

```css
.track-info {
    justify-content: center;  /* flex-start = top, center, flex-end = bottom */
    padding-top: 4px;         /* small nudge */
}
```

### Move one line only

`.song-title` and `.play-status` accept `position: relative` plus `top`. `.artist-name` is a flex line — nudge it with `margin-top` instead.

```css
.song-title  { position: relative; top: -3px; }
.artist-name { margin-top: 2px; }
.play-status { position: relative; top: 3px; }
```

### Move the controls

```css
.controls-section {
    top: -2px;   /* negative = up, positive = down */
    gap: 6px;    /* space between buttons */
}
```

The buttons overlay the text, so `.play-status` carries `padding-right: 120px` to keep its label clear of them. If you enlarge the buttons or add one, raise that padding.

### Featured artists

Titles containing `feat.`, `ft.`, or `featuring` are split: the title shows the song name alone, and the artist line reads `Artist • feat. Name1, Name2`. Works for `(feat. X)`, `[feat. X]`, and bare `ft. X` suffixes. Extraction lives in `extractFeats()`.

### Resize things

| What | Where | Default |
| --- | --- | --- |
| Album art | `.album-art` `width`/`height` | `64px` |
| Title | `.song-title` `font-size` | `17px` |
| Artist | `.artist-name` `font-size` | `12px` |
| Status | `.play-status` `font-size` | `11px` |
| Buttons | `.control-btn` `width`/`height` | `28px` |
| Card padding | `.player-container` `padding` | `8px 16px 6px` |

The card has `overflow: hidden`, so anything that does not fit is clipped rather than shown. If the controls disappear, the content is taller than the window — reduce a font size or grow the window height in `main.js` and the matching `body` rules in `index.html`.

### Bass visualizer and reactive cover art

Tuning lives in `startVisualization()` and `applyBassToArt()`:

| Knob | Default | Effect |
| --- | --- | --- |
| `noiseGate` | `6` | Higher = ignores quieter bass, less twitch |
| `smoothingTimeConstant` | `0.1` | Lower = snappier, less averaged |
| `lastVizUpdate < 8` | `8` ms | Frame cap; raise to reduce CPU |
| `applyBassToArt` `* 0.22` | `0.22` | Cover growth on a hit |
| `applyBassToArt` `0.3` | `0.3` | How fast the cover returns to rest |
| `Math.min(artScale, 1.22)` | `1.22` | Hard ceiling on cover scale |

Cover art is anchored `transform-origin: 0% 100%` so a big hit grows up and to the left, into the card edge rather than over the title.

## Tray only (no taskbar icon)

The window is created with `skipTaskbar: true`, plus `type: 'toolbar'` on Linux because Cinnamon/Mint ignores `skipTaskbar` on normal windows. Closing the window hides it to the tray; only tray **Exit** quits.

If the app stops responding to clicks after the Linux change, remove the `type: 'toolbar'` line in `createWindow()` — some window managers treat toolbar windows as non-focusable.

## Save button / Liked Songs

Default save target is **Liked Songs**.

Pick another playlist in Spotify → sidebar **Mini Player** → **Save destination**. That choice is stored in a writable config (and `save-target.txt`) that updates when you change it.

If the chosen playlist is missing or save fails, the app falls back to Liked Songs.

## Global hotkeys

Numeric **keypad** (not the top-row numbers), while the mini player is running:

| Shortcut | Action |
| --- | --- |
| Ctrl + Numpad 8 | Play / pause |
| Ctrl + Numpad 9 | Next |
| Ctrl + Numpad 7 | Previous |
| Ctrl + Numpad 4 | Save / like |

## GIFs

GIF artwork is optional and lives outside the portable app so updating or moving the binary never deletes your library:

```text
~/Documents/SoundCloud Mini Player/
├── config.json
└── *.gif
```

(If `Documents` does not exist, the folder is created in your home directory instead. GIFs bundled in an older `gifs/` folder are copied over on first launch.)

- **Tray → Use GIFs** — checkbox toggle that turns the GIF layer on or off immediately, no restart.
- **Tray → Open GIF Folder** — opens the folder so you can add or remove `.gif` files.

Settings live in `config.json`: `enabled`, `files`, `gifRotateMs`, `fallbackLoopMs`, `durationMsByFile`.

Track cover art still takes priority: when SoundCloud supplies artwork, it replaces the GIF until the cover is unavailable again.

## Spicetify

Linux:

```bash
bash scripts/install-spicetify-extension.sh
spicetify apply
```

Windows:

```powershell
.\scripts\install-spicetify-extension.ps1
spicetify apply
```

Restart Spotify after apply. Details: [spicetify/README.md](spicetify/README.md).

## Contributing

Issues and pull requests are welcome. Contributions are under the MIT license.

# Spicetify custom app (Spotify desktop)

This is a **Spicetify custom app** (folder with `index.js` + `manifest.json`), not a file in `Extensions/`. The WebSocket bridge runs on Spotify startup via `subfiles_extension` in the manifest.

## Install

Windows:

```powershell
.\scripts\install-spicetify-extension.ps1
spicetify apply
```

Linux:

```bash
bash scripts/install-spicetify-extension.sh
spicetify apply
```

Restart Spotify.

Manual copy: copy `custom-apps/soundcloud-mini-player` to:

`%AppData%\spicetify\CustomApps\soundcloud-mini-player`

Then:

```powershell
spicetify config custom_apps soundcloud-mini-player
spicetify apply
```

## In Spotify

- **Sidebar:** **Mini Player** — connection status, now playing preview, and **Save destination** playlist picker.
- **Bridge:** starts automatically when Spotify opens (you do not need to open the app page for the bridge to run).
- **Save target:** choose a playlist in the app, or set `savePlaylistUri` in `spotify/config.json` next to the desktop player. Blank = Liked Songs.

## Requirements

- Spicetify installed (`spicetify apply` works)
- Desktop mini player running (`npm start` or portable `.exe`)

## Project layout

```
custom-apps/soundcloud-mini-player/
  manifest.json      # app name, icons, subfiles_extension
  index.js           # React status page (render())
  bridge.js          # WebSocket bridge (runs on startup)
  style.css          # status page styles
```

## Update

Re-run `install-spicetify-extension.ps1`, then `spicetify apply`.

## Legacy extension

If you previously installed `Extensions/soundcloud-mini-player-bridge.js`, the install script removes it and drops the `extensions` config entry. Use the custom app only.

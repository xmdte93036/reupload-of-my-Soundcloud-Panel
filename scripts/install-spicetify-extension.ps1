# Installs the Spicetify *custom app* (not an extension) into CustomApps.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$srcDir = Join-Path $root "spicetify\custom-apps\soundcloud-mini-player"
$appFolder = "soundcloud-mini-player"
$destDir = Join-Path $env:APPDATA "spicetify\CustomApps\$appFolder"
$legacyExt = Join-Path $env:APPDATA "spicetify\Extensions\soundcloud-mini-player-bridge.js"

if (-not (Test-Path $srcDir)) {
  Write-Error "Source not found: $srcDir"
}

New-Item -ItemType Directory -Force -Path (Split-Path $destDir) | Out-Null
if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
Copy-Item -Recurse -Force $srcDir $destDir
Write-Host "Installed custom app: $destDir"
Write-Host ""
Write-Host "IMPORTANT: Restart Spotify completely after spicetify apply for bridge updates to load."

if (Test-Path $legacyExt) {
  Remove-Item -Force $legacyExt
  Write-Host "Removed old extension file: $legacyExt"
}

$spicetifyCmd = Get-Command spicetify -ErrorAction SilentlyContinue
if ($spicetifyCmd) {
  Write-Host "Configuring Spicetify custom app..."

  $currentApps = (& spicetify config custom_apps 2>&1 | Out-String).Trim()
  if ($currentApps -match [regex]::Escape($appFolder)) {
    Write-Host "Custom app already listed."
  } elseif ($currentApps) {
    & spicetify config custom_apps "$currentApps|$appFolder"
  } else {
    & spicetify config custom_apps $appFolder
  }

  $currentExt = (& spicetify config extensions 2>&1 | Out-String).Trim()
  if ($currentExt -match 'soundcloud-mini-player-bridge') {
    $cleaned = ($currentExt -split '\|' | Where-Object { $_ -and $_ -ne 'soundcloud-mini-player-bridge' }) -join '|'
    if ($cleaned) { & spicetify config extensions $cleaned }
    else { & spicetify config extensions '' }
    Write-Host "Removed legacy extension entry from config."
  }

  Write-Host "Run: spicetify apply"
  Write-Host "Restart Spotify. Open sidebar item: Mini Player"
} else {
  Write-Host ""
  Write-Host "Spicetify CLI not on PATH. Manual steps:"
  Write-Host "  spicetify config custom_apps $appFolder"
  Write-Host "  spicetify apply"
}

Write-Host ""
Write-Host "Usage:"
Write-Host "  1. Start the desktop mini player (bridge on port 8765)."
Write-Host "  2. Restart Spotify after spicetify apply."
Write-Host "  3. Bridge starts with Spotify (subfiles_extension). Optional: open Mini Player in sidebar for status."

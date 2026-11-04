param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$ext = Join-Path $ProjectRoot "extension"
$dist = Join-Path $ProjectRoot "dist"

if (!(Test-Path $ext)) {
  throw "Missing extension folder at $ext"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-FirefoxXpi([string]$sourceDir, [string]$destinationArchive) {
  if (Test-Path $destinationArchive) { Remove-Item -Force $destinationArchive }
  $sourceRoot = (Resolve-Path $sourceDir).Path
  $zip = [System.IO.Compression.ZipFile]::Open($destinationArchive, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -Path $sourceRoot -Recurse -File | ForEach-Object {
      $full = $_.FullName
      $rel = $full.Substring($sourceRoot.Length).TrimStart('\', '/')
      # Firefox validator expects ZIP-standard forward slashes in entry names.
      $entry = $rel -replace '\\', '/'
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip,
        $full,
        $entry,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $zip.Dispose()
  }
}

function New-CleanDir([string]$path) {
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

function Copy-ExtensionFiles([string]$targetDir) {
  Copy-Item -Recurse -Force (Join-Path $ext "icons") $targetDir
  Copy-Item -Force (Join-Path $ext "content.js") $targetDir
  Copy-Item -Force (Join-Path $ext "content-spotify.js") $targetDir
  Copy-Item -Force (Join-Path $ext "themes.css") $targetDir
  Copy-Item -Force (Join-Path $ext "mini-player.html") $targetDir
  Copy-Item -Force (Join-Path $ext "mini-player.js") $targetDir
}

Write-Host "Building Chrome/Edge (MV3)…"
$chromeDir = Join-Path $dist "extension-chrome"
New-CleanDir $chromeDir
Copy-ExtensionFiles $chromeDir
Copy-Item -Force (Join-Path $ext "manifest.json") (Join-Path $chromeDir "manifest.json")
Copy-Item -Force (Join-Path $ext "background.js") (Join-Path $chromeDir "background.js")
Copy-Item -Force (Join-Path $ext "popup.html") (Join-Path $chromeDir "popup.html")
Copy-Item -Force (Join-Path $ext "popup.js") (Join-Path $chromeDir "popup.js")

$chromeZip = Join-Path $dist "soundcloud-mini-player-chrome.zip"
if (Test-Path $chromeZip) { Remove-Item -Force $chromeZip }
Compress-Archive -Path (Join-Path $chromeDir "*") -DestinationPath $chromeZip

Write-Host "Building Firefox (MV2)…"
$ffDir = Join-Path $dist "extension-firefox"
New-CleanDir $ffDir
Copy-ExtensionFiles $ffDir
Copy-Item -Force (Join-Path $ext "manifest-firefox.json") (Join-Path $ffDir "manifest.json")
Copy-Item -Force (Join-Path $ext "background-firefox.js") (Join-Path $ffDir "background-firefox.js")
Copy-Item -Force (Join-Path $ext "popup-firefox.html") (Join-Path $ffDir "popup-firefox.html")
Copy-Item -Force (Join-Path $ext "popup-firefox.js") (Join-Path $ffDir "popup-firefox.js")

$ffXpi = Join-Path $dist "soundcloud-mini-player-firefox-v3.2.xpi"
if (Test-Path $ffXpi) { Remove-Item -Force $ffXpi }

# .xpi is a zip archive with manifest.json at root.
New-FirefoxXpi -sourceDir $ffDir -destinationArchive $ffXpi

Write-Host ""
Write-Host "Done:"
Write-Host " - $chromeZip"
Write-Host " - $ffXpi"
Write-Host ""
Write-Host "Notes:"
Write-Host " - Chrome/Edge: load unpacked from $chromeDir or import the zip."
Write-Host " - Firefox RELEASE: unsigned .xpi installs need xpinstall.signatures.required = false"
Write-Host "   (about:config), OR use Firefox Developer Edition / Firefox ESR policies, OR sign on AMO."
Write-Host "   If signatures are enforced, Firefox may incorrectly report corrupt instead of blocking signature."


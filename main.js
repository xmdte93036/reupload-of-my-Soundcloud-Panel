const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  session,
  desktopCapturer,
  globalShortcut,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL, fileURLToPath } = require('url');
const WebSocket = require('ws');
const { startSoundcloudMiniPlayerBridge } = require('./server.js');

const APP_DISPLAY_NAME = 'SoundCloud Mini Player';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch(
    'enable-features',
    'PulseaudioLoopbackForScreenShare,WebRTCPipeWireCapturer',
  );
  if (app.isPackaged) app.commandLine.appendSwitch('no-sandbox');
}

if (typeof app.setName === 'function') {
  try {
    app.setName(APP_DISPLAY_NAME);
  } catch (_) {
    /* ignore */
  }
}
try {
  process.title = APP_DISPLAY_NAME;
} catch (_) {
  /* ignore */
}

// Handle both development and packaged environments
const isPackaged = app.isPackaged || process.argv.includes('--portable');
const getAppBasePath = () => {
  if (!isPackaged) return __dirname;
  const exeDir = path.dirname(process.execPath);
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  for (const dir of [exeDir, resources]) {
    if (dir && fs.existsSync(path.join(dir, 'gifs'))) return dir;
  }
  return exeDir;
};

/**
 * GIFs live outside the app folder so a portable build can still be updated/replaced
 * without losing the user's library. Documents is writable and survives moving the exe.
 */
function getGifsDir() {
  const home = os.homedir();
  const documents = path.join(home, 'Documents');
  const base = fs.existsSync(documents) ? documents : home;
  return path.join(base, 'SoundCloud Mini Player');
}

const GIFS_DIR = getGifsDir();
const GIF_CONFIG_PATH = path.join(GIFS_DIR, 'config.json');

/** Legacy in-app folder — picked up once so existing libraries move over. */
const LEGACY_GIFS_DIR = path.join(getAppBasePath(), 'gifs');

const DEFAULT_SPOTIFY_CONFIG = {
  savePlaylistUri: '',
  savePlaylistName: '',
};

function getSpotifyDir() {
  if (isPackaged) return path.join(app.getPath('userData'), 'spotify');
  return path.join(getAppBasePath(), 'spotify');
}

function getSpotifyConfigPath() {
  return path.join(getSpotifyDir(), 'config.json');
}

function getSaveTargetLogPath() {
  return path.join(getSpotifyDir(), 'save-target.txt');
}

function normalizePlaylistUri(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  if (s.startsWith('spotify:playlist:')) return s;
  const urlMatch = s.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/i);
  if (urlMatch) return `spotify:playlist:${urlMatch[1]}`;
  if (/^[a-zA-Z0-9]{10,}$/.test(s)) return `spotify:playlist:${s}`;
  return s;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'wd.png'),
    path.join(__dirname, 'assets', 'wd.ico'),
    path.join(__dirname, 'extension', 'icons', 'icon128.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

// Create gifs directory if it doesn't exist (for portable mode)
function ensureGifsDirectory() {
  try {
    fs.mkdirSync(GIFS_DIR, { recursive: true });

    // Move an existing bundled library to the writable user folder once.
    if (LEGACY_GIFS_DIR !== GIFS_DIR && fs.existsSync(LEGACY_GIFS_DIR)) {
      for (const name of fs.readdirSync(LEGACY_GIFS_DIR)) {
        if (!/\.gif$/i.test(name)) continue;
        const from = path.join(LEGACY_GIFS_DIR, name);
        const to = path.join(GIFS_DIR, name);
        if (!fs.existsSync(to) && fs.statSync(from).isFile()) fs.copyFileSync(from, to);
      }
    }

    if (!fs.existsSync(GIF_CONFIG_PATH)) {
      fs.writeFileSync(GIF_CONFIG_PATH, JSON.stringify({
        enabled: true,
        files: [],
        gifRotateMs: 10000,
        fallbackLoopMs: 10000,
      }, null, 2));
    }
    console.log(`GIF folder: ${GIFS_DIR}`);
  } catch (err) {
    console.warn('Failed to create GIFs directory:', err.message);
  }
}

function readGifConfig() {
  if (!fs.existsSync(GIF_CONFIG_PATH)) return { enabled: true };
  try {
    const cfg = JSON.parse(fs.readFileSync(GIF_CONFIG_PATH, 'utf8'));
    return { ...cfg, enabled: cfg.enabled !== false };
  } catch (e) {
    console.warn('gifs/config.json:', e.message);
    return { enabled: true };
  }
}

function writeGifConfig(patch) {
  const next = { ...readGifConfig(), ...patch };
  try {
    fs.writeFileSync(GIF_CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('Failed to write gifs/config.json:', err.message);
  }
  return next;
}

function writeSaveTargetLog(cfg) {
  const label = cfg.savePlaylistUri
    ? `${cfg.savePlaylistName || 'Playlist'}\n${cfg.savePlaylistUri}`
    : 'Liked Songs (default)';
  try {
    fs.writeFileSync(
      getSaveTargetLogPath(),
      `${label}\nupdated ${new Date().toISOString()}\n`,
      'utf8',
    );
  } catch (err) {
    console.warn('Failed to write save-target.txt:', err.message);
  }
}

function ensureSpotifyDirectory() {
  const dir = getSpotifyDir();
  const configPath = getSpotifyConfigPath();
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_SPOTIFY_CONFIG, null, 2));
      writeSaveTargetLog(DEFAULT_SPOTIFY_CONFIG);
    }
  } catch (err) {
    console.warn('Failed to create Spotify config directory:', err.message);
  }
}

function readSpotifyConfig() {
  ensureSpotifyDirectory();
  const configPath = getSpotifyConfigPath();
  if (!fs.existsSync(configPath)) return { ...DEFAULT_SPOTIFY_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      savePlaylistUri: normalizePlaylistUri(raw.savePlaylistUri || ''),
      savePlaylistName: typeof raw.savePlaylistName === 'string' ? raw.savePlaylistName.trim() : '',
    };
  } catch (e) {
    console.warn('spotify/config.json:', e.message);
    return { ...DEFAULT_SPOTIFY_CONFIG };
  }
}

function writeSpotifyConfig(patch) {
  ensureSpotifyDirectory();
  const current = readSpotifyConfig();
  const next = {
    savePlaylistUri:
      patch.savePlaylistUri != null
        ? normalizePlaylistUri(patch.savePlaylistUri)
        : current.savePlaylistUri,
    savePlaylistName:
      patch.savePlaylistName != null ? String(patch.savePlaylistName).trim() : current.savePlaylistName,
  };
  try {
    fs.writeFileSync(getSpotifyConfigPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('Failed to write spotify/config.json:', err.message);
  }
  writeSaveTargetLog(next);
  return next;
}

function userDesktopDir() {
  if (process.platform === 'linux') {
    const envDir = process.env.XDG_DESKTOP_DIR;
    if (envDir) return envDir.replace(/^["']|["']$/g, '').replace(/^\$HOME/, os.homedir());
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.config', 'user-dirs.dirs'), 'utf8');
      const m = raw.match(/^XDG_DESKTOP_DIR="?(.+?)"?\s*$/m);
      if (m) return m[1].replace(/^\$HOME/, os.homedir()).replace(/^["']|["']$/g, '');
    } catch (_) {
      /* default below */
    }
  }
  return path.join(os.homedir(), 'Desktop');
}

function quoteDesktopExec(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function writeAppDesktopShortcut() {
  const dir = userDesktopDir();
  if (!dir || !fs.existsSync(dir)) return;
  const icon = resolveAppIconPath();
  const target = process.env.APPIMAGE || process.execPath;
  try {
    if (process.platform === 'linux') {
      const execLine = isPackaged
        ? quoteDesktopExec(target)
        : `${quoteDesktopExec(target)} ${quoteDesktopExec(__dirname)}`;
      const lines = [
        '[Desktop Entry]',
        'Type=Application',
        `Name=${APP_DISPLAY_NAME}`,
        `Comment=${APP_DISPLAY_NAME}`,
        `Exec=${execLine}`,
        'Terminal=false',
        'Categories=AudioVideo;Player;',
      ];
      if (icon) lines.push(`Icon=${icon}`);
      const file = path.join(dir, `${APP_DISPLAY_NAME}.desktop`);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
        fs.chmodSync(file, 0o755);
      }
    } else if (process.platform === 'win32') {
      const link = path.join(dir, `${APP_DISPLAY_NAME}.lnk`);
      const opts = {
        target: process.execPath,
        cwd: isPackaged ? path.dirname(process.execPath) : __dirname,
        description: APP_DISPLAY_NAME,
      };
      if (!isPackaged) opts.args = '.';
      if (icon) opts.icon = icon;
      if (!fs.existsSync(link)) {
        shell.writeShortcutLink(link, 'create', opts);
      }
    }
  } catch (err) {
    console.warn('App desktop shortcut:', err.message);
  }
}

/** Sum Graphic Control Extension delays (GIF89a) — one full loop for typical GIFs. */
function gifLoopDurationMs(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  if (buf.length < 14) return null;
  const sig = buf.toString('ascii', 0, 3);
  if (sig !== 'GIF') return null;
  let totalCs = 0;
  for (let i = 0; i <= buf.length - 8; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
      const delay = buf.readUInt16LE(i + 4);
      totalCs += delay === 0 ? 10 : delay;
    }
  }
  if (totalCs <= 0) return null;
  return totalCs * 10;
}

function listGifFilenames() {
  const cfg = readGifConfig();
  // Tray toggle: off means no GIF at all, even with files on disk.
  if (!cfg.enabled) return [];
  let fromConfig = [];
  if (Array.isArray(cfg.files)) fromConfig = cfg.files;
  else if (Array.isArray(cfg.gifs)) fromConfig = cfg.gifs;

  const safeList = fromConfig
    .map((name) => path.basename(String(name)))
    .filter((name) => /\.gif$/i.test(name));

  if (safeList.length) {
    return [...new Set(safeList)].filter((name) =>
      fs.existsSync(path.join(GIFS_DIR, name)),
    );
  }

  if (!fs.existsSync(GIFS_DIR)) return [];
  return fs
    .readdirSync(GIFS_DIR)
    .filter((f) => /\.gif$/i.test(f) && fs.statSync(path.join(GIFS_DIR, f)).isFile());
}

function pickRandomGifFileUrl(excludeBase) {
  let names = listGifFilenames();
  if (excludeBase) {
    const ex = path.basename(String(excludeBase));
    names = names.filter((n) => n !== ex);
  }
  if (!names.length) {
    names = listGifFilenames();
  }
  if (!names.length) return null;
  const pick = names[Math.floor(Math.random() * names.length)];
  return { href: pathToFileURL(path.join(GIFS_DIR, pick)).href, base: pick };
}

/** Stable order; advance to next file after each loop (wraps). */
function sortedGifFilenames() {
  const names = listGifFilenames();
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function pickNextGifFileUrl(currentBase) {
  const names = sortedGifFilenames();
  if (!names.length) return null;
  const cur = currentBase ? path.basename(String(currentBase)) : null;
  if (names.length === 1) {
    const n = names[0];
    return { href: pathToFileURL(path.join(GIFS_DIR, n)).href, base: n };
  }
  let idx = cur ? names.indexOf(cur) : -1;
  if (idx < 0) idx = 0;
  else idx = (idx + 1) % names.length;
  const pick = names[idx];
  return { href: pathToFileURL(path.join(GIFS_DIR, pick)).href, base: pick };
}

/** Streaming artwork CDNs often refuse requests without a site referer (file:// Electron has none). */
function ensureSoundCloudCdnReferer() {
  if (ensureSoundCloudCdnReferer._done) return;
  ensureSoundCloudCdnReferer._done = true;
  const filter = {
    urls: [
      '*://*.sndcdn.com/*',
      '*://*.sndcdns.com/*',
      '*://*.soundcloud.com/*',
      '*://*.scdn.co/*',
      '*://*.spotifycdn.com/*',
      '*://*.spotify.com/*',
    ],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const url = details.url || '';
    const referer =
      /spotify|scdn\.co/i.test(url) ? 'https://open.spotify.com/' : 'https://soundcloud.com/';
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Referer: referer,
      },
    });
  });
}

let mainWindow;
let tray = null;
let isQuitting = false;
let ws = null;
let reconnectTimer = null;
const WS_URL = 'ws://127.0.0.1:8765';

const { OPEN: READY_OPEN, CONNECTING: READY_CONNECTING } = WebSocket;

const outgoingQueue = [];

/** Last track payload from the browser/Spicetify bridge (for play/pause hotkey). */
let lastBridgeTrack = { isPlaying: false };
/** JSON of the last processed bridge message — suppresses relayed duplicates. */
let lastBridgeMessage = '';

const GLOBAL_HOTKEYS = [
  { accelerator: 'Control+num8', action: 'playPause' },
  { accelerator: 'Control+num9', action: 'next' },
  { accelerator: 'Control+num7', action: 'previous' },
  { accelerator: 'Control+num4', action: 'like' },
];

function sendSpotifyConfigToBridge() {
  const cfg = readSpotifyConfig();
  const payload = {
    type: 'spotify-config',
    savePlaylistUri: cfg.savePlaylistUri,
    savePlaylistName: cfg.savePlaylistName,
    timestamp: Date.now(),
  };
  if (ws && ws.readyState === READY_OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error('WebSocket config send failed:', err.message);
    }
  } else {
    outgoingQueue.push(payload);
    if (!ws || ws.readyState !== READY_CONNECTING) {
      connectBridge();
    }
  }
}

function sendBridgeCommand(action) {
  const command = { action, timestamp: Date.now() };
  if (action === 'like') {
    const cfg = readSpotifyConfig();
    if (cfg.savePlaylistUri) {
      command.savePlaylistUri = cfg.savePlaylistUri;
      if (cfg.savePlaylistName) command.savePlaylistName = cfg.savePlaylistName;
    }
  }
  if (ws && ws.readyState === READY_OPEN) {
    try {
      ws.send(JSON.stringify(command));
      return;
    } catch (err) {
      console.error('WebSocket send failed:', err.message);
    }
  }
  outgoingQueue.push(command);
  if (!ws || ws.readyState !== READY_CONNECTING) {
    connectBridge();
  }
}

function handleGlobalHotkey(kind) {
  switch (kind) {
    case 'playPause':
      sendBridgeCommand(lastBridgeTrack.isPlaying ? 'pause' : 'play');
      break;
    case 'next':
      sendBridgeCommand('next');
      break;
    case 'previous':
      sendBridgeCommand('previous');
      break;
    case 'like':
      sendBridgeCommand('like');
      break;
    default:
      break;
  }
}

function registerGlobalHotkeys() {
  globalShortcut.unregisterAll();
  for (const { accelerator, action } of GLOBAL_HOTKEYS) {
    const ok = globalShortcut.register(accelerator, () => handleGlobalHotkey(action));
    if (!ok) {
      console.warn(`Could not register global hotkey: ${accelerator}`);
    }
  }
}

function unregisterGlobalHotkeys() {
  globalShortcut.unregisterAll();
}

function pushConnectionStatus(connected) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('connection-status', connected);
}

function flushOutgoingQueue() {
  if (!ws || ws.readyState !== READY_OPEN) return;
  while (outgoingQueue.length) {
    const payload = outgoingQueue.shift();
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to send on WebSocket:', err.message);
      break;
    }
  }
}

function teardownSocket() {
  if (!ws) return;
  ws.removeAllListeners();
  try {
    ws.close();
  } catch (e) {
    /* ignore */
  }
  ws = null;
}

function connectBridge() {
  if (ws && ws.readyState === READY_CONNECTING) return;

  teardownSocket();
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Electron connected to bridge (port 8765)');
    pushConnectionStatus(true);
    sendSpotifyConfigToBridge();
    flushOutgoingQueue();
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      // Drop relayed duplicates (e.g. our own spotify-config echoed back).
      // The bridge broadcasts everything to everyone, so echoes are expected.
      if (message && typeof message === 'object') {
        const key = JSON.stringify(message);
        if (key === lastBridgeMessage) return;
        lastBridgeMessage = key;
      }
      if (message && message.type === 'request-spotify-config') {
        sendSpotifyConfigToBridge();
        return;
      }
      if (message && message.type === 'spotify-config') {
        writeSpotifyConfig({
          savePlaylistUri: message.savePlaylistUri,
          savePlaylistName: message.savePlaylistName,
        });
        return;
      }
      if (message && typeof message === 'object') {
        lastBridgeTrack = {
          isPlaying: !!message.isPlaying,
          song: message.song,
          artist: message.artist,
        };
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('track-update', message);
      }
    } catch (err) {
      console.error('Invalid JSON from bridge:', err.message);
    }
  });

  ws.on('close', () => {
    pushConnectionStatus(false);
    scheduleReconnect();
  });

  ws.on('error', () => {
    // `close` usually follows; still schedule reconnect defensively
    pushConnectionStatus(false);
  });
}

function scheduleReconnect() {
  teardownSocket();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, 1200);
}

function createWindow() {
  ensureSoundCloudCdnReferer();
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 360,
    height: 105,
    minWidth: 360,
    minHeight: 105,
    maxWidth: 360,
    maxHeight: 105,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: APP_DISPLAY_NAME,
    icon: iconPath || undefined,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: true,
    // Linux: 'toolbar' windows are excluded from the taskbar/pager by the WM.
    // skipTaskbar alone is unreliable on Cinnamon/Mint.
    ...(process.platform === 'linux' ? { type: 'toolbar' } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.platform === 'win32' || process.platform === 'linux') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setSkipTaskbar(true);
  }

  // Some WMs re-add the taskbar entry after hide/show; re-assert it.
  mainWindow.on('show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setSkipTaskbar(true);
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    pushConnectionStatus(!!(ws && ws.readyState === READY_OPEN));
  });

  let resizeTimeout = null;
  mainWindow.on('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const [width, height] = mainWindow.getSize();
      if (width !== 360 || height !== 105) {
        mainWindow.setSize(360, 105, false);
      }
    }, 100);
  });

  connectBridge();

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!isQuitting && app.isReady()) {
      createWindow();
      if (mainWindow) mainWindow.hide();
    }
  });
}

function createTray() {
  if (tray) return tray;
  const iconPath = resolveAppIconPath();
  if (!iconPath) return null;

  tray = new Tray(iconPath);
  tray.setToolTip(APP_DISPLAY_NAME);
  tray.on('double-click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  refreshTrayMenu();
  return tray;
}

/** Rebuilds the menu so the GIF toggle shows its state (some Linux trays draw checkboxes faintly). */
function refreshTrayMenu() {
  if (!tray) return;
  const gifOn = readGifConfig().enabled;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Player',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
          }
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: `Use GIFs  ${gifOn ? '[✓]' : '[  ]'}`,
        type: 'checkbox',
        checked: gifOn,
        click: (item) => {
          const cfg = writeGifConfig({ enabled: item.checked });
          refreshTrayMenu();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gifs:enabled-changed', cfg.enabled);
          }
        },
      },
      {
        label: 'Open GIF Folder',
        click: () => {
          shell.openPath(GIFS_DIR);
        },
      },
      {
        label: 'Hide Player',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.soundcloud.miniplayer.app');
  }
  ensureGifsDirectory();
  ensureSpotifyDirectory();
  writeSaveTargetLog(readSpotifyConfig());
  writeAppDesktopShortcut();
  startSoundcloudMiniPlayerBridge();
  ensureSoundCloudCdnReferer();
  // Auto-grant desktop capture with loopback audio for bass visualizer.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (!sources.length) {
          callback({});
          return;
        }
        callback({
          video: sources[0],
          audio: 'loopback',
        });
      })
      .catch(() => callback({}));
  });
  const boot = () => {
    createWindow();
    createTray();
    registerGlobalHotkeys();
  };
  // shortcut: Electron transparent windows need a short delay on Linux compositors
  if (process.platform === 'linux') setTimeout(boot, 300);
  else boot();
});

app.on('window-all-closed', () => {
  // Keep running in tray.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  unregisterGlobalHotkeys();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  teardownSocket();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Renderer uses ipcRenderer.send — must be ipcMain.on, not handle.
ipcMain.on('send-command', (_event, command) => {
  if (command?.action) {
    sendBridgeCommand(command.action);
  }
});

ipcMain.handle('gifs:is-enabled', () => readGifConfig().enabled);

ipcMain.handle('gifs:get-random', (_evt, opts) => {
  const exclude = opts && opts.exclude ? opts.exclude : null;
  return pickRandomGifFileUrl(exclude);
});

ipcMain.handle('gifs:get-next', (_evt, currentBase) => pickNextGifFileUrl(currentBase));

/** How long to show each GIF before advancing (extension UI rotation). */
ipcMain.handle('gifs:get-rotate-interval-ms', () => {
  const cfg = readGifConfig();
  const primary = Number(cfg.gifRotateMs);
  const fb = Number(cfg.fallbackLoopMs);
  if (Number.isFinite(primary) && primary >= 2000) return Math.round(primary);
  if (Number.isFinite(fb) && fb >= 2000) return Math.round(fb);
  return 10000;
});

ipcMain.on('app:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('gifs:get-duration-ms', (_evt, fileUrl) => {
  const cfg = readGifConfig();
  const fallback = Number(cfg.fallbackLoopMs) || 10000;
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith('file:')) {
    return fallback;
  }
  let filePath;
  try {
    filePath = fileURLToPath(new URL(fileUrl));
  } catch {
    try {
      filePath = fileURLToPath(fileUrl);
    } catch {
      return fallback;
    }
  }
  const base = path.basename(filePath);
  const byFile = cfg.durationMsByFile && typeof cfg.durationMsByFile === 'object' ? cfg.durationMsByFile : {};
  if (byFile[base] != null && Number(byFile[base]) > 0) {
    return Math.round(Number(byFile[base]));
  }
  const parsed = gifLoopDurationMs(filePath);
  return parsed && parsed > 300 ? parsed : fallback;
});


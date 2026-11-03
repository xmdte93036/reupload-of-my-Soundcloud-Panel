const react = Spicetify.React;
const { useState, useEffect } = Spicetify.React;

const STATE_KEY = 'soundcloud-mini-player:bridge';

function readBridgeState() {
  try {
    if (globalThis.__soundcloudMiniPlayerBridge) {
      return globalThis.__soundcloudMiniPlayerBridge;
    }
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return globalThis.__soundcloudMiniPlayerBridge || null;
  }
}

async function loadUserPlaylists() {
  if (!Spicetify.Platform?.RootlistAPI?.getContents) return [];

  const out = [];

  function walk(items) {
    for (const item of items || []) {
      if (item.type === 'playlist' && item.uri) {
        const name =
          item.name ||
          item.metadata?.name ||
          item.metadata?.title ||
          'Untitled playlist';
        out.push({ uri: item.uri, name: String(name).trim() || 'Untitled playlist' });
      } else if (item.type === 'folder' && item.items) {
        walk(item.items);
      }
    }
  }

  const root = await Spicetify.Platform.RootlistAPI.getContents();
  walk(root.items);
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

function SavePlaylistCard() {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedUri, setSelectedUri] = useState('');
  const [selectedName, setSelectedName] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setLoadError('');
      try {
        const list = await loadUserPlaylists();
        if (cancelled) return;
        setPlaylists(list);

        const bridge = readBridgeState();
        const current = bridge?.savePlaylist || {};
        const currentUri = current.savePlaylistUri || '';
        setSelectedUri(currentUri);
        setSelectedName(current.savePlaylistName || '');
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Could not load playlists.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    const sync = () => {
      const bridge = readBridgeState();
      const current = bridge?.savePlaylist || {};
      setSelectedUri(current.savePlaylistUri || '');
      setSelectedName(current.savePlaylistName || '');
    };
    const id = setInterval(sync, 800);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function applySelection(uri, name) {
    setSelectedUri(uri || '');
    setSelectedName(name || '');
    if (typeof globalThis.__soundcloudMiniPlayerSetSavePlaylist === 'function') {
      globalThis.__soundcloudMiniPlayerSetSavePlaylist(uri || '', name || '');
    }
  }

  const saveTargetLabel = selectedUri
    ? selectedName || selectedUri
    : 'Liked Songs (default)';

  return react.createElement(
    'div',
    { className: 'scmp-card' },
    react.createElement('h2', null, 'Save destination'),
    react.createElement(
      'p',
      { className: 'scmp-meta' },
      'Ctrl + Numpad 4 and the mini player save button add the current track here.',
    ),
    react.createElement('p', { className: 'scmp-save-target' }, `Current: ${saveTargetLabel}`),
    loading &&
      react.createElement('p', { className: 'scmp-hint' }, 'Loading your playlists…'),
    loadError &&
      react.createElement('p', { className: 'scmp-hint scmp-hint--error' }, loadError),
    !loading &&
      react.createElement(
        'label',
        { className: 'scmp-field' },
        react.createElement('span', { className: 'scmp-field-label' }, 'Playlist'),
        react.createElement(
          'select',
          {
            className: 'scmp-select',
            value: selectedUri,
            onChange: (event) => {
              const uri = event.target.value;
              if (!uri) {
                applySelection('', '');
                return;
              }
              const match = playlists.find((p) => p.uri === uri);
              applySelection(uri, match ? match.name : '');
            },
          },
          react.createElement('option', { value: '' }, 'Liked Songs (default)'),
          playlists.map((playlist) =>
            react.createElement(
              'option',
              { key: playlist.uri, value: playlist.uri },
              playlist.name,
            ),
          ),
        ),
      ),
    react.createElement(
      'p',
      { className: 'scmp-hint' },
      'You can also edit spotify/config.json next to the desktop app. Leave savePlaylistUri blank for Liked Songs.',
    ),
  );
}

function StatusPage() {
  const [state, setState] = useState(() => readBridgeState() || { connected: false, track: null });

  useEffect(() => {
    const tick = () => setState(readBridgeState() || { connected: false, track: null });
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const connected = !!state.connected;
  const track = state.track;
  const wsUrl = state.wsUrl || 'ws://127.0.0.1:8765';

  return react.createElement(
    'section',
    { className: 'contentSpacing scmp-app' },
    react.createElement(
      'div',
      { className: 'scmp-header' },
      react.createElement('h1', null, 'SoundCloud Mini Player'),
      react.createElement('p', { className: 'scmp-sub' }, 'Spotify desktop bridge for the floating mini player.'),
    ),
    react.createElement(
      'div',
      { className: `scmp-card ${connected ? 'scmp-card--ok' : 'scmp-card--warn'}` },
      react.createElement('h2', null, 'Bridge'),
      react.createElement('p', null, connected ? 'Connected to desktop player' : 'Not connected'),
      react.createElement('p', { className: 'scmp-mono' }, wsUrl),
      !connected &&
        react.createElement(
          'p',
          { className: 'scmp-hint' },
          'Start the desktop mini player first (npm start or the portable .exe), then restart Spotify if needed.',
        ),
    ),
    react.createElement(SavePlaylistCard),
    track &&
      react.createElement(
        'div',
        { className: 'scmp-card' },
        react.createElement('h2', null, 'Now playing'),
        track.albumArt &&
          react.createElement('img', {
            className: 'scmp-cover',
            src: track.albumArt,
            alt: '',
          }),
        react.createElement('p', { className: 'scmp-title' }, track.song || '—'),
        react.createElement('p', { className: 'scmp-artist' }, track.artist || '—'),
        react.createElement(
          'p',
          { className: 'scmp-meta' },
          track.isPlaying ? 'Playing' : 'Paused',
        ),
      ),
    react.createElement(
      'div',
      { className: 'scmp-card scmp-card--flat' },
      react.createElement('h2', null, 'Tips'),
      react.createElement(
        'ul',
        { className: 'scmp-list' },
        react.createElement('li', null, 'The bridge runs when Spotify starts (via this custom app).'),
        react.createElement('li', null, 'Use either this desktop bridge or the browser extension on Spotify — not both.'),
        react.createElement('li', null, 'Controls in the mini player: play, skip, save (heart).'),
      ),
    ),
  );
}

function render() {
  return react.createElement(StatusPage);
}

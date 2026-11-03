(function SoundCloudMiniPlayerBridgeExtension() {
  if (globalThis.__soundcloudMiniPlayerBridgeStarted) return;
  globalThis.__soundcloudMiniPlayerBridgeStarted = true;

  const WS_URL = 'ws://127.0.0.1:8765';
  const POLL_MS = 1200;
  const MIN_RECONNECT_MS = 800;
  const STATE_KEY = 'soundcloud-mini-player:bridge';
  const SAVE_PLAYLIST_KEY = 'soundcloud-mini-player:save-playlist';

  let ws = null;
  let isConnecting = false;
  let lastConnectionAttempt = 0;
  let connectionRetryCount = 0;
  let lastTrackKey = null;
  let lastStableAlbumArt = null;
  let lastSongArtistKey = null;
  let activeSavePlaylistUri = '';
  let activeSavePlaylistName = '';

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

  function readSavePlaylistConfig() {
    try {
      const raw = localStorage.getItem(SAVE_PLAYLIST_KEY);
      if (!raw) return { savePlaylistUri: '', savePlaylistName: '' };
      const parsed = JSON.parse(raw);
      return {
        savePlaylistUri: normalizePlaylistUri(parsed.savePlaylistUri || ''),
        savePlaylistName: String(parsed.savePlaylistName || '').trim(),
      };
    } catch {
      return { savePlaylistUri: '', savePlaylistName: '' };
    }
  }

  function applySavePlaylistConfig(uri, name) {
    activeSavePlaylistUri = normalizePlaylistUri(uri);
    activeSavePlaylistName = String(name || '').trim();
    const next = {
      savePlaylistUri: activeSavePlaylistUri,
      savePlaylistName: activeSavePlaylistName,
    };
    try {
      localStorage.setItem(SAVE_PLAYLIST_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    publishState({ savePlaylist: next });
    return next;
  }

  function resolveSavePlaylistUri(command) {
    const fromCommand = normalizePlaylistUri(command?.savePlaylistUri || '');
    if (fromCommand) return fromCommand;
    if (activeSavePlaylistUri) return activeSavePlaylistUri;
    return readSavePlaylistConfig().savePlaylistUri;
  }

  function publishState(patch) {
    const prev = globalThis.__soundcloudMiniPlayerBridge || {};
    const next = {
      wsUrl: WS_URL,
      connected: false,
      track: null,
      savePlaylist: {
        savePlaylistUri: activeSavePlaylistUri,
        savePlaylistName: activeSavePlaylistName,
      },
      ...prev,
      ...patch,
      updatedAt: Date.now(),
    };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'savePlaylist')) {
      next.savePlaylist = patch.savePlaylist;
    }
    globalThis.__soundcloudMiniPlayerBridge = next;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const bootConfig = readSavePlaylistConfig();
  activeSavePlaylistUri = bootConfig.savePlaylistUri;
  activeSavePlaylistName = bootConfig.savePlaylistName;
  publishState({ connected: false, track: null });

  function notify(message, isError) {
    try {
      if (typeof Spicetify?.showNotification === 'function') {
        Spicetify.showNotification(message, isError);
      }
    } catch {
      /* ignore */
    }
    console.log('[SoundCloud Mini Player]', message);
  }

  function sendSpotifyConfigToDesktop(uri, name) {
    const payload = {
      type: 'spotify-config',
      savePlaylistUri: normalizePlaylistUri(uri),
      savePlaylistName: String(name || '').trim(),
      timestamp: Date.now(),
    };
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  function requestSpotifyConfigFromDesktop() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'request-spotify-config', timestamp: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  globalThis.__soundcloudMiniPlayerSetSavePlaylist = (uri, name) => {
    const next = applySavePlaylistConfig(uri, name);
    sendSpotifyConfigToDesktop(next.savePlaylistUri, next.savePlaylistName);
    return next;
  };

  function waitForSpicetify() {
    const playerReady = !!globalThis.Spicetify?.Player;
    const playlistApiReady = !!globalThis.Spicetify?.Platform?.PlaylistAPI?.add;
    if (!playerReady || !playlistApiReady) {
      setTimeout(waitForSpicetify, 250);
      return;
    }
    main();
  }

  function buildArtUrl(meta) {
    if (!meta) return null;
    const raw =
      meta.image_xlarge_url ||
      meta.image_large_url ||
      meta.image_url ||
      meta.album_art_uri ||
      meta.album_cover_uri;
    if (!raw || typeof raw !== 'string') return null;
    if (raw.indexOf('localfile') !== -1) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const id = raw.substring(raw.lastIndexOf(':') + 1);
    if (!id) return null;
    return `https://i.scdn.co/image/${id}`;
  }

  function buildArtist(meta) {
    if (!meta) return 'Unknown Artist';
    let artist = (meta.artist_name || '').trim();
    let i = 1;
    while (meta[`artist_name:${i}`]) {
      const extra = String(meta[`artist_name:${i}`]).trim();
      if (extra) artist = artist ? `${artist}, ${extra}` : extra;
      i += 1;
    }
    if (!artist && meta.album_title) artist = String(meta.album_title).trim();
    return artist || 'Unknown Artist';
  }

  function getTrackInfo() {
    const empty = {
      song: 'Unknown Track',
      artist: 'Unknown Artist',
      albumArt: null,
      isPlaying: false,
      timestamp: Date.now(),
      source: 'spicetify',
    };

    try {
      const data = Spicetify.Player.data;
      if (!data?.item?.metadata) return empty;

      const meta = data.item.metadata;
      const song = (meta.title || meta.track_name || '').trim() || 'Unknown Track';
      const artist = buildArtist(meta);
      let albumArt = buildArtUrl(meta);

      const key = `${song}|${artist}`;
      if (albumArt) {
        lastStableAlbumArt = albumArt;
        lastSongArtistKey = key;
      } else if (lastStableAlbumArt && lastSongArtistKey === key) {
        albumArt = lastStableAlbumArt;
      }

      return {
        song,
        artist,
        albumArt,
        isPlaying: !data.isPaused,
        timestamp: Date.now(),
        source: 'spicetify',
      };
    } catch {
      return empty;
    }
  }

  function getCurrentTrackItem() {
    try {
      return Spicetify.Player.data?.item || Spicetify.Player.origin?._state?.item || null;
    } catch {
      return null;
    }
  }

  async function addTrackToPlaylist(playlistUri, trackUri) {
    const normalizedPlaylist = normalizePlaylistUri(playlistUri);
    const normalizedTrack = String(trackUri || '').trim();
    if (!normalizedPlaylist || !normalizedTrack) {
      throw new Error('Missing playlist or track URI');
    }

    if (Spicetify.Platform?.PlaylistAPI?.add) {
      await Spicetify.Platform.PlaylistAPI.add(
        normalizedPlaylist,
        [normalizedTrack],
        { after: 'end' },
      );
      return;
    }

    if (Spicetify.CosmosAsync?.post) {
      const playlistId = normalizedPlaylist.replace(/^spotify:playlist:/, '');
      await Spicetify.CosmosAsync.post(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        { uris: [normalizedTrack] },
      );
      return;
    }

    throw new Error('No playlist API available');
  }

  async function addToLikedSongs(trackUri) {
    const normalizedTrack = String(trackUri || '').trim();
    if (!normalizedTrack) throw new Error('Missing track URI');

    if (Spicetify.Platform?.LibraryAPI?.add) {
      await Spicetify.Platform.LibraryAPI.add({ uris: [normalizedTrack] });
      return;
    }

    if (Spicetify.CosmosAsync?.put) {
      const id = normalizedTrack.replace(/^spotify:track:/, '');
      await Spicetify.CosmosAsync.put(`https://api.spotify.com/v1/me/tracks?ids=${id}`);
      return;
    }

    if (typeof Spicetify.Player.toggleHeart === 'function') {
      Spicetify.Player.toggleHeart();
      return;
    }

    throw new Error('No Liked Songs API available');
  }

  function resetSaveTargetToLikedSongs() {
    applySavePlaylistConfig('', '');
    sendSpotifyConfigToDesktop('', '');
  }

  async function saveCurrentTrack(command) {
    const item = getCurrentTrackItem();
    const trackUri = item?.uri || item?.metadata?.uri;
    if (!trackUri) {
      notify('No track is playing', true);
      return;
    }

    const playlistUri = resolveSavePlaylistUri(command);
    if (playlistUri) {
      const label = activeSavePlaylistName || playlistUri;
      try {
        await addTrackToPlaylist(playlistUri, trackUri);
        notify(`Added to ${label}`);
        return;
      } catch (err) {
        console.error('[SoundCloud Mini Player] save failed:', err);
        resetSaveTargetToLikedSongs();
        notify('Playlist missing or blocked; using Liked Songs', true);
      }
    }

    try {
      await addToLikedSongs(trackUri);
      notify('Saved to Liked Songs');
    } catch (err) {
      console.error('[SoundCloud Mini Player] liked-songs save failed:', err);
      notify('Could not save track', true);
    }
  }

  function sendTrackInfo() {
    const track = getTrackInfo();
    publishState({ track });

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const key = `${track.song}|${track.artist}|${track.isPlaying}|${track.albumArt || ''}`;
      if (key === lastTrackKey) return;
      lastTrackKey = key;
      ws.send(JSON.stringify(track));
    } catch {
      /* ignore */
    }
  }

  function handleIncomingMessage(raw) {
    if (!raw || typeof raw !== 'object') return;

    if (raw.type === 'spotify-config') {
      applySavePlaylistConfig(raw.savePlaylistUri, raw.savePlaylistName);
      return;
    }

    handleCommand(raw);
  }

  function handleCommand(command) {
    if (!command?.action) return;
    const action = String(command.action).toLowerCase();
    try {
      switch (action) {
        case 'play':
          if (!Spicetify.Player.isPlaying()) Spicetify.Player.play();
          break;
        case 'pause':
          if (Spicetify.Player.isPlaying()) Spicetify.Player.pause();
          break;
        case 'toggle':
          Spicetify.Player.togglePlay();
          break;
        case 'next':
          Spicetify.Player.next();
          break;
        case 'previous':
          Spicetify.Player.back();
          break;
        case 'like':
          saveCurrentTrack(command).finally(() => setTimeout(sendTrackInfo, 300));
          return;
        default:
          break;
      }
      setTimeout(sendTrackInfo, 300);
    } catch {
      /* ignore */
    }
  }

  function connectWebSocket() {
    const now = Date.now();
    if (isConnecting || now - lastConnectionAttempt < MIN_RECONNECT_MS) return;
    isConnecting = true;
    lastConnectionAttempt = now;

    try {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        isConnecting = false;
        connectionRetryCount = 0;
        lastTrackKey = null;
        publishState({ connected: true });
        requestSpotifyConfigFromDesktop();
        sendTrackInfo();
        setTimeout(sendTrackInfo, 500);
      };

      ws.onmessage = (event) => {
        try {
          handleIncomingMessage(JSON.parse(event.data));
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        isConnecting = false;
        connectionRetryCount += 1;
        publishState({ connected: false });
        setTimeout(
          connectWebSocket,
          Math.min(5000 * Math.pow(2, connectionRetryCount), 30000),
        );
      };

      ws.onerror = () => {
        isConnecting = false;
        connectionRetryCount += 1;
        publishState({ connected: false });
        setTimeout(
          connectWebSocket,
          Math.min(3000 * Math.pow(2, connectionRetryCount), 20000),
        );
      };

      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          isConnecting = false;
          ws.close();
        }
      }, 5000);
    } catch {
      isConnecting = false;
      publishState({ connected: false });
      setTimeout(connectWebSocket, 5000);
    }
  }

  function main() {
    connectWebSocket();
    setInterval(sendTrackInfo, POLL_MS);

    Spicetify.Player.addEventListener('songchange', () => {
      lastTrackKey = null;
      setTimeout(sendTrackInfo, 120);
    });
    Spicetify.Player.addEventListener('onplaypause', () => {
      lastTrackKey = null;
      setTimeout(sendTrackInfo, 120);
    });

    window.addEventListener('beforeunload', () => {
      try {
        if (ws) ws.close();
      } catch {
        /* ignore */
      }
    });

    console.log('[SoundCloud Mini Player] Custom app bridge active →', WS_URL);
  }

  waitForSpicetify();
})();

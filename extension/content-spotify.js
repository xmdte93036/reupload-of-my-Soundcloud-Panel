(() => {
  if (window.__spotifyMiniPlayerInit) return;
  window.__spotifyMiniPlayerInit = true;

  let ws = null;
  let connectionRetryCount = 0;
  let lastTrackData = null;
  let lastSongArtistKey = null;
  let lastStableAlbumArt = null;
  let isConnecting = false;
  let lastConnectionAttempt = 0;
  const MIN_CONNECTION_INTERVAL = 800;

  function safeQuerySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function safeGetTextContent(el) {
    try {
      if (!el || typeof el.textContent !== 'string') return null;
      const t = el.textContent.trim();
      return t.length ? t : null;
    } catch {
      return null;
    }
  }

  function safeGetAttribute(el, name) {
    try {
      return el && el.getAttribute ? el.getAttribute(name) || null : null;
    } catch {
      return null;
    }
  }

  function srcFromPicture(img) {
    if (!img) return null;
    const direct =
      img.currentSrc ||
      img.src ||
      safeGetAttribute(img, 'data-src');
    if (direct && /^https?:\/\//i.test(direct)) return direct.trim();
    const srcset = safeGetAttribute(img, 'srcset');
    if (!srcset) return null;
    const url = srcset.split(',')[0].trim().split(/\s+/)[0];
    return url && /^https?:\/\//i.test(url) ? url.trim() : null;
  }

  function normalizeArtworkUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) return null;
    return u;
  }

  function isBadArtworkUrl(url) {
    if (!url) return true;
    const u = url.toLowerCase();
    return u.includes('placeholder') || u.includes('default') && u.includes('avatar');
  }

  function getNowPlayingRoot() {
    return (
      safeQuerySelector('[data-testid="now-playing-widget"]') ||
      safeQuerySelector('footer[data-testid="now-playing-bar"]') ||
      safeQuerySelector('[data-testid="player-controls"]')?.closest('footer') ||
      safeQuerySelector('nav[aria-label="Player controls"]')?.parentElement ||
      safeQuerySelector('[data-testid="player"]') ||
      null
    );
  }

  function getTrackInfo() {
    const result = {
      song: 'Unknown Track',
      artist: 'Unknown Artist',
      albumArt: null,
      isPlaying: false,
      timestamp: Date.now(),
      source: 'spotify',
    };

    try {
      const root = getNowPlayingRoot();

      const titleSelectors = [
        '[data-testid="context-item-info-title"]',
        'a[data-testid="context-item-link"] [data-testid="context-item-info-title"]',
        '[data-testid="now-playing-widget"] a[href*="/track/"]',
        '[data-testid="now-playing-widget"] a[href*="/episode/"]',
      ];
      let song = null;
      for (const sel of titleSelectors) {
        const el = root ? root.querySelector(sel) : safeQuerySelector(sel);
        const t = el && safeGetTextContent(el);
        if (t) {
          song = t;
          break;
        }
      }

      const artistSelectors = [
        '[data-testid="context-item-info-artist"] a',
        '[data-testid="context-item-info-artist"]',
        '[data-testid="now-playing-widget"] a[href*="/artist/"]',
      ];
      let artist = null;
      for (const sel of artistSelectors) {
        const el = root ? root.querySelector(sel) : safeQuerySelector(sel);
        const t = el && safeGetTextContent(el);
        if (t && t !== song) {
          artist = t;
          break;
        }
      }

      if (song) {
        song = song.replace(/^(current\s*track|now\s*playing|track|playing)\s*:\s*/i, '').trim();
        const dash = song.match(/^(.+?)\s+[-–—]\s+(.+)$/);
        if (dash && (!artist || artist === 'Unknown Artist')) {
          artist = dash[1].trim();
          song = dash[2].trim();
        }
      }

      let albumArt = null;
      const artSelectors = [
        '[data-testid="cover-art-image"]',
        '[data-testid="cover-art"] img',
        '[data-testid="now-playing-widget"] img[src*="spotifycdn"]',
        '[data-testid="now-playing-widget"] img',
      ];
      for (const sel of artSelectors) {
        const el = root ? root.querySelector(sel) : safeQuerySelector(sel);
        const src = el && (el.tagName === 'IMG' ? srcFromPicture(el) : null);
        if (src) {
          const norm = normalizeArtworkUrl(src);
          if (norm && !isBadArtworkUrl(norm)) {
            albumArt = norm;
            break;
          }
        }
      }

      if (!albumArt) {
        const og = safeQuerySelector('meta[property="og:image"]');
        const norm = normalizeArtworkUrl(og ? safeGetAttribute(og, 'content') : null);
        if (norm && !isBadArtworkUrl(norm)) albumArt = norm;
      }

      const playBtn =
        (root && root.querySelector('[data-testid="control-button-playpause"]')) ||
        safeQuerySelector('[data-testid="control-button-playpause"]');
      let isPlaying = false;
      if (playBtn) {
        const label = (safeGetAttribute(playBtn, 'aria-label') || '').toLowerCase();
        isPlaying = label.includes('pause') || label.includes('playing');
      }

      result.song = song || 'Unknown Track';
      result.artist = artist || 'Unknown Artist';

      const key = `${result.song}|${result.artist}`;
      if (albumArt) {
        lastStableAlbumArt = albumArt;
        lastSongArtistKey = key;
        result.albumArt = albumArt;
      } else if (lastStableAlbumArt && lastSongArtistKey === key) {
        result.albumArt = lastStableAlbumArt;
      } else {
        result.albumArt = albumArt;
      }
      result.isPlaying = isPlaying;
    } catch {
      /* ignore */
    }

    return result;
  }

  function sendTrackInfo() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const trackInfo = getTrackInfo();
      const trackKey = `${trackInfo.song}|${trackInfo.artist}|${trackInfo.isPlaying}|${trackInfo.albumArt || ''}`;
      if (!lastTrackData || trackKey !== lastTrackData) {
        lastTrackData = trackKey;
        ws.send(JSON.stringify(trackInfo));
      }
    } catch {
      /* ignore */
    }
  }

  function clickSelector(selectors) {
    for (const sel of selectors) {
      const btn = safeQuerySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function handleCommand(command) {
    if (!command || !command.action) return false;
    const action = String(command.action).toLowerCase();
    switch (action) {
      case 'play':
        return clickSelector(['[data-testid="control-button-playpause"]']);
      case 'pause':
        return clickSelector(['[data-testid="control-button-playpause"]']);
      case 'toggle':
        return clickSelector(['[data-testid="control-button-playpause"]']);
      case 'next':
        return clickSelector(['[data-testid="control-button-skip-forward"]']);
      case 'previous':
        return clickSelector(['[data-testid="control-button-skip-back"]']);
      case 'like':
        return clickSelector([
          '[data-testid="control-button-heart"]',
          '[data-testid="add-button"]',
          'button[aria-label*="Save to Your Library" i]',
          'button[aria-label*="Add to Your Library" i]',
        ]);
      default:
        return false;
    }
  }

  function connectWebSocket() {
    const now = Date.now();
    if (isConnecting || now - lastConnectionAttempt < MIN_CONNECTION_INTERVAL) return;
    isConnecting = true;
    lastConnectionAttempt = now;

    try {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      ws = new WebSocket('ws://127.0.0.1:8765');

      ws.onopen = () => {
        isConnecting = false;
        connectionRetryCount = 0;
        sendTrackInfo();
        setTimeout(sendTrackInfo, 500);
      };

      ws.onmessage = (event) => {
        try {
          handleCommand(JSON.parse(event.data));
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        isConnecting = false;
        connectionRetryCount++;
        setTimeout(connectWebSocket, Math.min(5000 * Math.pow(2, connectionRetryCount), 30000));
      };

      ws.onerror = () => {
        isConnecting = false;
        connectionRetryCount++;
        setTimeout(connectWebSocket, Math.min(3000 * Math.pow(2, connectionRetryCount), 20000));
      };

      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          isConnecting = false;
          ws.close();
        }
      }, 5000);
    } catch {
      isConnecting = false;
      setTimeout(connectWebSocket, 5000);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'getStatus') {
        sendResponse({ connected: !!(ws && ws.readyState === WebSocket.OPEN) });
      }
    });
  }

  connectWebSocket();
  // Polls even in background tabs: the mini player still needs the update.
  setInterval(sendTrackInfo, 1200);

  let lastUrl = location.href;
  const routeDebounce = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(sendTrackInfo, 500);
    }
  };
  new MutationObserver(routeDebounce).observe(document.documentElement, {
    subtree: true,
    childList: true,
  });

  const root = getNowPlayingRoot() || document.querySelector('footer');
  if (root) {
    new MutationObserver(() => {
      clearTimeout(root.__mpDebounce);
      root.__mpDebounce = setTimeout(sendTrackInfo, 260);
    }).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label', 'src', 'srcset', 'class'],
    });
  }
})();

(() => {
  if (window.__soundCloudMiniPlayerInit) return;
  window.__soundCloudMiniPlayerInit = true;

  let ws = null;
  let connectionRetryCount = 0;
  let lastTrackData = null;
  let currentTheme = 'regular';
  // SoundCloud DOM changes between play/pause and can temporarily cause albumArt extraction to fail.
  // Keep the last known-good cover for the same (song, artist) so pausing doesn't swap to avatar/GIF.
  let lastSongArtistKey = null;
  let lastStableAlbumArt = null;

// Modern SoundCloud 2024 CSS Selectors
const SELECTORS_2024 = {
  // Track title selectors (new SoundCloud design)
  title: [
    '[data-testid="sound-title"]',
    'h1[data-testid="sound-title"]',
    '.soundTitle__title',
    '.playbackSoundBadge__titleLink',
    '.playbackSoundBadge__title',
    'h1[class*="title"]',
    '.title__title',
    'a[href*="/"][class*="title"]',
    'span[class*="title"]',
    '.sc-font-light',
    // Fallback: any h1 with reasonable content
    'h1',
    'title'
  ],
  
  // Artist selectors (updated for 2024)
  artist: [
    '[data-testid="user-link"]',
    'a[data-testid="user-link"]',
    '.playbackSoundBadge__usernameLink',
    '.playbackSoundBadge__username',
    '.soundTitle__username',
    'a[href*="/"][class*="username"]',
    '.username',
    'span[class*="username"]',
    'a[class*="user"]',
    // Fallback: any link that looks like a user
    'a[href*="/soundcloud.com/"]',
    'a[href*="/users/"]'
  ],
  
  // Album art selectors (updated)
  albumArt: [
    '.playbackSoundBadge__avatar img',
    '.sc-artwork img',
    '.image__image img',
    'img[class*="artwork"]',
    'img[alt*="album"]',
    'img[alt*="cover"]',
    '.artwork__image img',
    'div[class*="artwork"] img',
    // Fallback: any image in player area
    '.player img',
    'img[src*="artwork"]',
    'img[src*="cover"]'
  ],
  
  // Play button selectors (updated)
  playButton: [
    '.playControl',
    '.playbackSoundBadge__play',
    '[data-testid="play-button"]',
    'button[aria-label*="play"]',
    'button[aria-label*="pause"]',
    '.sc-button-play',
    'button[class*="play"]',
    // Fallback: any button with play/pause text
    'button:has(.play)',
    'button:has(.pause)'
  ],
  
  // Next/Previous buttons
  nextButton: [
    '.skipControl__next',
    '.playbackControls__next',
    '[data-testid="next-button"]',
    'button[aria-label*="next"]',
    '.sc-button-next',
    'button:has(.next)'
  ],
  
  prevButton: [
    '.skipControl__previous',
    '.playbackControls__previous',
    '[data-testid="previous-button"]',
    'button[aria-label*="previous"]',
    'button[aria-label*="prev"]',
    '.sc-button-previous',
    'button:has(.prev)'
  ]
};

// Safe DOM utility functions
function safeGetTextContent(element) {
  try {
    if (!element || typeof element.textContent !== 'string') {
      return null;
    }
    const text = element.textContent.trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    return null;
  }
}

function safeGetAttribute(element, attribute) {
  try {
    if (!element || typeof element.getAttribute !== 'function') {
      return null;
    }
    return element.getAttribute(attribute) || null;
  } catch (e) {
    return null;
  }
}

function srcFromPicture(img) {
  if (!img) return null;
  const direct =
    img.currentSrc ||
    img.src ||
    safeGetAttribute(img, 'data-src') ||
    safeGetAttribute(img, 'data-lazy-src');
  if (direct && /^https?:\/\//i.test(direct)) return direct.trim();
  const srcset =
    safeGetAttribute(img, 'srcset');
  if (!srcset) return null;
  const firstDescriptor = srcset.split(',')[0];
  const url = firstDescriptor ? firstDescriptor.trim().split(/\s+/)[0] : '';
  return url && /^https?:\/\//i.test(url) ? url.trim() : null;
}

function normalizeArtworkUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  u = u.replace(/-(?:large|t300x300|t200x200)\.(jpg|jpeg|png|webp)(\?.*)?$/i, '-t500x500.$1$2');
  u = u.replace(/\/large\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/t500x500.$1$2');
  return u;
}

function isBadArtworkUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.toLowerCase();
  return (
    u.includes('default_avatar') ||
    u.includes('default_artwork') ||
    u.includes('placeholder')
  );
}

/** Prefer SoundCloud *track/cover* artwork over profile avatars shown in the same mini player. */
function isLikelyScTrackArtUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    /artworks[-/]/.test(u) ||
    /\.sndcdn\.com\/(.*\/)?artworks\b/.test(u) ||
    (u.includes('.sndcdn.com') && u.includes('/artwork'))
  );
}

/** Profile / avatar imagery (often a circle) bundled into the playback badge beside real track art. */
function isLikelyScAvatarArtUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('avatars-') || u.includes('/avatars/');
}

/** SoundCloud hides real track art in CSS backgrounds on spans/divs inside the playback badge — not always <img>. */
function parseUrlsFromCssValue(cssText) {
  if (!cssText || typeof cssText !== 'string') return [];
  const urls = [];
  const re = /url\(\s*['"]?(https?:[^'")\s]+)['"]?\s*\)/gi;
  let m;
  while ((m = re.exec(cssText))) {
    urls.push(m[1]);
  }
  return urls;
}

function readComputedBgUrls(el) {
  try {
    return parseUrlsFromCssValue(window.getComputedStyle(el).backgroundImage || '');
  } catch (e) {
    return [];
  }
}

function domArtScoreAdjust(el) {
  if (!el || typeof el.closest !== 'function') return 0;
  let s = 0;
  if (el.closest('.playbackSoundBadge__avatar, [class*="SoundBadge__avatar"], [class*="userAvatar"], [class*="UserAvatar"]'))
    s -= 140;
  if (el.closest('.sc-artwork, [class*="coverArt"], [class*="thumbnail"], [class*="badgeImage"], [data-testid*="artwork"], [data-testid*="thumbnail"]'))
    s += 100;
  return s;
}

function harvestJsonLdTrackArtUrls() {
  const urls = [];
  /** @type {NodeListOf<Element>} */
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach((s) => {
    let data;
    try {
      data = JSON.parse(s.textContent || '');
    } catch {
      return;
    }
    function pushImageField(imageField) {
      if (!imageField) return;
      if (typeof imageField === 'string' && /^https?:\/\//i.test(imageField)) urls.push(imageField);
      else if (Array.isArray(imageField)) imageField.forEach(pushImageField);
      else if (typeof imageField === 'object') {
        if (typeof imageField.url === 'string') urls.push(imageField.url);
        else if (Array.isArray(imageField.url)) pushImageField(imageField.url);
      }
    }

    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      let types = node['@type'];
      const tl = Array.isArray(types) ? types : types ? [types] : [];
      if (tl.includes('MusicRecording') && node.image) pushImageField(node.image);
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') visit(v);
      }
    }

    visit(data);
  });
  return urls;
}

function soundsLikeSongPermalink() {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  if (['you', 'discover', 'feed', 'stream', 'upload', 'settings', 'pages'].includes(parts[0])) return false;
  return true;
}

function collectBadgeArtCandidates(badgeRoot) {
  /** @type {{ url: string; score: number }[]} */
  const list = [];
  if (!badgeRoot) return list;

  function push(url, el, bonus) {
    const norm = normalizeArtworkUrl(url);
    if (!norm || isBadArtworkUrl(norm)) return;
    let score = isLikelyScTrackArtUrl(norm)
      ? 260
      : isLikelyScAvatarArtUrl(norm)
        ? 12
        : /\.sndcdn\.com/i.test(norm)
          ? 65
          : 28;
    if (typeof bonus === 'number') score += bonus;
    if (/waveform|\/waveform|wis\.sndcdn\.com\/waveform/i.test(norm)) score -= 60;
    score += domArtScoreAdjust(el);
    if (el && el.tagName === 'IMG') {
      const w = el.naturalWidth || el.width || 0;
      const h = el.naturalHeight || el.height || 0;
      if (w > 0 && h > 0) {
        const area = w * h;
        const ar = Math.max(w, h) / Math.min(w, h);
        if (ar < 1.45) score += 12;
        if (area < 1600) score -= 12;
      }
    }
    list.push({ url: norm, score });
  }

  badgeRoot.querySelectorAll('img, picture img').forEach((img) => {
    const u = srcFromPicture(img);
    if (u) push(u, img, null);
  });

  /** @type {Element[]} */
  const probeNodes = [...badgeRoot.querySelectorAll('[style*="url("], [style*="sndcdn"], span, div, a, picture')];

  probeNodes.slice(0, 450).forEach((el) => {
    const st = safeGetAttribute(el, 'style');
    if (st && st.includes('url(')) parseUrlsFromCssValue(st).forEach((u) => push(u, el, 8));

    let cn = '';
    try {
      cn = typeof el.className === 'string' ? el.className : el.className && el.className.baseVal;
    } catch (_) {
      cn = '';
    }
    const looksCovery =
      cn &&
      (cn.includes('artwork') ||
        cn.includes('Artwork') ||
        cn.includes('thumbnail') ||
        cn.includes('badgeImage') ||
        cn.includes('coverArt'));

    const testId = safeGetAttribute(el, 'data-testid') || '';
    const testCover = /artwork|thumb|cover|wave/i.test(testId);

    if (looksCovery || testCover || el.classList.contains('sc-artwork')) {
      readComputedBgUrls(el).forEach((u) => push(u, el, 18));
    }
  });

  return list;
}

function mergeBestCandidate(candidates) {
  const byUrl = new Map();
  candidates.forEach((c) => {
    if (!c || !c.url || typeof c.score !== 'number') return;
    const prev = byUrl.get(c.url);
    if (!prev || c.score > prev) byUrl.set(c.url, c.score);
  });
  let winner = null;
  let max = -Infinity;
  byUrl.forEach((score, url) => {
    if (score > max) {
      max = score;
      winner = url;
    }
  });
  if (!winner || !Number.isFinite(max) || max < 48) return null;
  return winner;
}

/** Track cover from player chrome (CSS + img). JSON-LD as tie-break when the bar is stingy about URLs. */
function resolveNowPlayingAlbumArt(playbackBadge) {
  /** @type {{ url: string; score: number }[]} */
  let all = [];

  const innerBadgeOnly = playbackBadge || safeQuerySelector('.playbackSoundBadge');
  const footerHost =
    innerBadgeOnly?.closest?.('footer') || playbackBadge?.closest?.('footer') || safeQuerySelector('footer');
  const badgeInFooter = footerHost && footerHost.querySelector && footerHost.querySelector('.playbackSoundBadge');

  const roots = [];
  if (innerBadgeOnly) roots.push(innerBadgeOnly);
  if (badgeInFooter && badgeInFooter !== innerBadgeOnly) roots.push(badgeInFooter);

  roots.forEach((r) => {
    all = all.concat(collectBadgeArtCandidates(r));
  });

  const ldBoost = soundsLikeSongPermalink() ? 55 : 0;
  harvestJsonLdTrackArtUrls().forEach((u) => {
    const norm = normalizeArtworkUrl(u);
    if (!norm || isBadArtworkUrl(norm)) return;
    let s = 142 + ldBoost;
    if (isLikelyScTrackArtUrl(norm)) s += 90;
    all.push({ url: norm, score: s });
  });

  return mergeBestCandidate(all);
}

/**
 * Prefer the real track cover inside SoundCloud's playback badge.
 * This is the most important path for the pause/unpause issue because the DOM
 * can temporarily contain extra artwork when SoundCloud swaps UI states.
 */
function tryResolveTrackCoverDirect(playbackBadge) {
  if (!playbackBadge) return null;

  // SoundCloud commonly uses ".sc-artwork" for the actual track art (not the avatar).
  const scArt =
    playbackBadge.querySelector('span.sc-artwork, .sc-artwork, [class*="sc-artwork"]') ||
    playbackBadge.querySelector('[data-testid*="artwork"], [data-testid*="thumbnail"], .artwork__image') ||
    null;

  const roots = scArt ? [scArt] : [playbackBadge];

  for (const root of roots) {
    // 1) Direct <img> inside the artwork container
    const img =
      root.querySelector('img[src*="artworks-"], img[src*="artwork"], img[src*="/artworks-"]') ||
      root.querySelector('img');
    if (img) {
      const cand = normalizeArtworkUrl(srcFromPicture(img));
      if (cand && !isBadArtworkUrl(cand) && isLikelyScTrackArtUrl(cand)) return cand;
    }

    // 2) CSS background-image URL inside artwork container
    try {
      const bg = window.getComputedStyle(root).backgroundImage || '';
      const urls = parseUrlsFromCssValue(bg);
      for (const u of urls) {
        const cand = normalizeArtworkUrl(u);
        if (cand && !isBadArtworkUrl(cand) && isLikelyScTrackArtUrl(cand)) return cand;
      }
    } catch (_) {
      /* ignore */
    }

    // 3) Look for any nested background-image URLs (limited to descendants)
    try {
      const nodes = root.querySelectorAll('[style*="url("]');
      for (const node of nodes) {
        const st = safeGetAttribute(node, 'style');
        const urls = parseUrlsFromCssValue(st);
        for (const u of urls) {
          const cand = normalizeArtworkUrl(u);
          if (cand && !isBadArtworkUrl(cand) && isLikelyScTrackArtUrl(cand)) return cand;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  return null;
}

function safeQuerySelector(selector) {
  try {
    return document.querySelector(selector);
  } catch (e) {
    return null;
  }
}

function stripLeadingCoverLabels(text) {
  if (!text) return '';
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/^by\s+/i, '').replace(/\s+by\s+/i, ' ').trim();
  t = t.replace(/\b(?:cover|cover\s*photo|album\s*cov(?:er)?|artwork|track\s*cov(?:er)?)\b\s*[:\-–·|_]*/gi, ' ');
  t = t.replace(/^[·\s\-–—|,/:]+/, '').trim();
  return t;
}

function normalizeArtistLabel(raw, songTitle) {
  let t = stripLeadingCoverLabels(raw);
  if (!t) return null;

  if (songTitle && t === songTitle) return null;
  if (t.length < 2) return null;
  if (/^cover$/i.test(t)) return null;
  if (t.includes('Play') || t.includes('Like') || t.includes('Repost')) {
    return null;
  }
  return t;
}

function parseArtistFromDocumentTitle() {
  const title = (document && document.title ? document.title : '').trim();
  if (!title) return null;

  // Common SoundCloud title patterns:
  // "Stream Track Name by Artist | Listen online..."
  // "Track Name by Artist"
  let m = title.match(/\bby\s+(.+?)(?:\s+\||$)/i);
  if (m && m[1]) {
    return normalizeArtistLabel(m[1], null);
  }

  // "Artist - Track | SoundCloud"
  m = title.match(/^(.+?)\s+[-–—]\s+.+?(?:\s+\||$)/);
  if (m && m[1]) {
    return normalizeArtistLabel(m[1], null);
  }

  return null;
}

function parseArtistFromMetaOrPath() {
  try {
    const creatorMeta =
      safeQuerySelector('meta[property="soundcloud:creator"]') ||
      safeQuerySelector('meta[name="author"]') ||
      safeQuerySelector('meta[property="og:site_name"]');
    const fromMeta = creatorMeta ? safeGetAttribute(creatorMeta, 'content') : null;
    const normalizedMeta = normalizeArtistLabel(fromMeta, null);
    if (normalizedMeta && !/soundcloud/i.test(normalizedMeta)) return normalizedMeta;
  } catch (e) {
    /* noop */
  }

  try {
    const path = (location && location.pathname ? location.pathname : '').split('/').filter(Boolean);
    // Track URLs are usually /<artist>/<track>
    if (path.length >= 2) {
      const slug = decodeURIComponent(path[0]).replace(/[-_]+/g, ' ').trim();
      const normalized = normalizeArtistLabel(slug, null);
      if (normalized) return normalized;
    }
  } catch (e) {
    /* noop */
  }

  return null;
}

// Connection throttling to prevent flooding
let isConnecting = false;
let lastConnectionAttempt = 0;
const MIN_CONNECTION_INTERVAL = 800;

// Robust WebSocket connection with throttling
function connectWebSocket() {
  // Prevent connection flooding
  const now = Date.now();
  if (isConnecting || (now - lastConnectionAttempt) < MIN_CONNECTION_INTERVAL) {
    return;
  }
  
  isConnecting = true;
  lastConnectionAttempt = now;
  
  try {
    // Close existing connection if any
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
    
    ws = new WebSocket('ws://127.0.0.1:8765');
    
    ws.onopen = () => {
      isConnecting = false;
      connectionRetryCount = 0;
      sendTrackInfo();
      // Send immediate status update
      setTimeout(sendTrackInfo, 500);
    };
    
    ws.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data);
        handleCommand(command);
      } catch (error) {
        // Silent error handling
      }
    };
    
    ws.onclose = () => {
      isConnecting = false;
      connectionRetryCount++;
      // Much longer backoff to prevent flooding
      const retryDelay = Math.min(5000 * Math.pow(2, connectionRetryCount), 30000);
      setTimeout(connectWebSocket, retryDelay);
    };
    
    ws.onerror = (error) => {
      isConnecting = false;
      connectionRetryCount++;
      const retryDelay = Math.min(3000 * Math.pow(2, connectionRetryCount), 20000);
      setTimeout(connectWebSocket, retryDelay);
    };
    
    // Connection timeout
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        isConnecting = false;
        ws.close();
      }
    }, 5000);
    
  } catch (error) {
    isConnecting = false;
    connectionRetryCount++;
    setTimeout(connectWebSocket, 5000);
  }
}

// Professional track info extraction with modern 2024 selectors
function getTrackInfo() {
  const result = {
    song: 'Unknown Track',
    artist: 'Unknown Artist', 
    albumArt: null,
    isPlaying: false,
    timestamp: Date.now()
  };

  try {
    // Validate document state
    if (!document || !document.body || !document.documentElement) {
      return result;
    }
    
    // Check if document is still valid (prevent DeadObject)
    try {
      document.body.tagName;
      document.documentElement.tagName;
    } catch (deadObjectError) {
      return result;
    }

    // Extract song title with modern selectors - prioritize currently playing
    let song = null;
    
    // First try to find currently playing track
    const playingSelectors = [
      '.playbackSoundBadge__titleLink.sc-link-primary',
      '.playbackSoundBadge__title',
      '[data-testid="sound-title"]',
      '.soundTitle__title'
    ];
    
    for (const selector of playingSelectors) {
      try {
        const element = safeQuerySelector(selector);
        if (element && safeGetTextContent(element)) {
          song = safeGetTextContent(element);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Fallback to all title selectors
    if (!song) {
      for (const selector of SELECTORS_2024.title) {
        try {
          const element = safeQuerySelector(selector);
          if (element && safeGetTextContent(element)) {
            song = safeGetTextContent(element);
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (song) {
      song = song.replace(/\s+/g, ' ').trim();
      song = song.replace(/\s+[-–—]\s+SoundCloud$/i, '').trim();
    }

    /** Footer “now playing” region — reuse for username + artwork so sidebar/cards don’t pollute labels. */
    let playbackBadge =
      safeQuerySelector('.playbackSoundBadge') ||
      safeQuerySelector('.playControls .playbackSoundBadge') ||
      safeQuerySelector('.playControls') ||
      safeQuerySelector('[class*="playControls"]');
    {
      const inner = playbackBadge && playbackBadge.querySelector && playbackBadge.querySelector('.playbackSoundBadge');
      if (inner) playbackBadge = inner;
    }

    let artist = null;
    const badgeArtistSelectors = [
      'a.playbackSoundBadge__usernameLink',
      '.playbackSoundBadge__usernameLink',
      '.playbackSoundBadge__usernameText',
      '.playbackSoundBadge__username'
    ];

    if (playbackBadge) {
      for (const selector of badgeArtistSelectors) {
        const el = playbackBadge.querySelector(selector);
        if (!el) continue;
        const label = normalizeArtistLabel(safeGetTextContent(el), song);
        if (label) {
          artist = label;
          break;
        }
      }
    }

    if (!artist) {
      const barScoped = ['.playbackSoundBadge__usernameLink', '.playbackSoundBadge__username', '[data-testid="user-link"]'];
      for (const selector of barScoped) {
        const element = safeQuerySelector(selector);
        const inBar =
          element &&
          (element.closest('.playbackSoundBadge') || element.closest('.playControls'));
        if (inBar && safeGetTextContent(element)) {
          const label = normalizeArtistLabel(safeGetTextContent(element), song);
          if (label) {
            artist = label;
            break;
          }
        }
      }
    }

    if (!artist) {
      for (const selector of SELECTORS_2024.artist) {
        try {
          const element = safeQuerySelector(selector);
          const inPlayerChrome =
            element &&
            (element.closest('.playbackSoundBadge') ||
              element.closest('.playControls') ||
              element.closest('[class*="playControls"]') ||
              element.closest('footer'));
          if (!inPlayerChrome || !safeGetTextContent(element)) continue;
          const label = normalizeArtistLabel(safeGetTextContent(element), song);
          if (label) {
            artist = label;
            break;
          }
        } catch (e) {
          /* continue */
        }
      }
    }

    if (!artist) {
      artist = parseArtistFromDocumentTitle() || parseArtistFromMetaOrPath();
    }

    // If SoundCloud gives a combined "Artist - Title" string, split it.
    if (song && (!artist || artist === 'Unknown Artist')) {
      const parts = song.split(/\s+[-–—]\s+/);
      if (parts.length >= 2) {
        const possibleArtist = normalizeArtistLabel(parts[0], null);
        const possibleTitle = parts.slice(1).join(' - ').trim();
        if (possibleArtist && possibleTitle && possibleTitle.length >= 2) {
          artist = possibleArtist;
          song = possibleTitle;
        }
      }
    }

    // "Artist / Title" in one string (spaced slash — avoids splitting AC/DC)
    if (song) {
      const sm = song.match(/^(.+?)\s\/\s(.+)$/);
      if (sm) {
        const left = sm[1].trim();
        const right = sm[2].trim();
        const nk = (s) =>
          String(s || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
        if ((!artist || artist === 'Unknown Artist') && left && right) {
          const lab = normalizeArtistLabel(left, right);
          artist = lab || left;
          song = right;
        } else if (artist && left && right && nk(left) === nk(artist)) {
          song = right;
        }
      }
    }

    // Pause/unpause changes SoundCloud DOM; first try the strict "track art" path.
    let albumArt = tryResolveTrackCoverDirect(playbackBadge);
    if (!albumArt) albumArt = resolveNowPlayingAlbumArt(playbackBadge);

    if (albumArt && isBadArtworkUrl(albumArt)) {
      albumArt = null;
    }

    if (!albumArt) {
      const og = safeQuerySelector('meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]');
      const metaUrl = og ? safeGetAttribute(og, 'content') : null;
      const normalized = normalizeArtworkUrl(metaUrl);
      if (normalized && !isBadArtworkUrl(normalized)) {
        albumArt = normalized;
      }
    }

    // Detect play state with modern selectors
    let isPlaying = false;
    for (const selector of SELECTORS_2024.playButton) {
      try {
        const element = safeQuerySelector(selector);
        if (element) {
          // Multiple detection methods
          const hasPlayingClass = element.classList.contains('playing') || 
                                element.classList.contains('sc-button-playing') ||
                                element.classList.contains('is-playing');
          const pauseLabel = safeGetAttribute(element, 'aria-label')?.toLowerCase().includes('pause');
          const playingChild = element.querySelector('.playing, .pause');
          const titleText = safeGetAttribute(element, 'title')?.toLowerCase().includes('pause');
          
          if (hasPlayingClass || pauseLabel || playingChild || titleText) {
            isPlaying = true;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (song) {
      song = song.replace(/^(current track:|now playing:|track:|playing:)\s*/i, '');
      while (song.length >= 4 && song.length % 2 === 0) {
        const half = song.length / 2;
        const a = song.slice(0, half);
        const b = song.slice(half);
        if (a !== b) break;
        song = a.trim();
      }
      song = song.replace(/\s+/g, ' ').trim();
      if (song.includes('SoundCloud') || song.includes('Upload') || song.includes('Stream')) {
        song = 'Unknown Track';
      }
    }

    // Final result assembly
    result.song = song || 'Unknown Track';
    result.artist = artist || 'Unknown Artist';
    // Preserve last good artwork for the same track when SoundCloud briefly renders paused-state UI differently.
    const songArtistKey = `${result.song}|${result.artist}`;
    if (albumArt) {
      lastStableAlbumArt = albumArt;
      lastSongArtistKey = songArtistKey;
      result.albumArt = albumArt;
    } else if (lastStableAlbumArt && lastSongArtistKey === songArtistKey) {
      result.albumArt = lastStableAlbumArt;
    } else {
      result.albumArt = albumArt;
      lastStableAlbumArt = albumArt || lastStableAlbumArt;
      lastSongArtistKey = songArtistKey;
    }
    result.isPlaying = isPlaying;

    return result;

  } catch (error) {
    return result;
  }
}

// Send track info to mini-player with bulletproof deduplication
function sendTrackInfo() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const trackInfo = getTrackInfo();
      
      // Create unique key without timestamp
      const trackKey = `${trackInfo.song}|${trackInfo.artist}|${trackInfo.isPlaying}|${trackInfo.albumArt || ''}`;
      
      // Only send if track actually changed
      if (!lastTrackData || trackKey !== lastTrackData) {
        lastTrackData = trackKey;
        currentTrack = trackInfo;
        ws.send(JSON.stringify(trackInfo));
      }
    } catch (error) {
      // Silent error handling
    }
  }
}

// Modern command handling with robust button controls
function handleCommand(command) {
  if (!command || !command.action) {
    return false;
  }

  try {
    let success = false;
    
    switch(command.action.toLowerCase()) {
      case 'play':
        success = executePlayCommand();
        break;
      case 'pause':
        success = executePauseCommand();
        break;
      case 'next':
        success = executeNextCommand();
        break;
      case 'previous':
        success = executePreviousCommand();
        break;
      case 'like':
        success = executeLikeCommand();
        break;
      case 'toggle':
        success = executeToggleCommand();
        break;
      default:
        return false;
    }
    
    return success;
    
  } catch (error) {
    return false;
  }
}

// Modern button control functions
function executePlayCommand() {
  const playStrategies = [
    () => {
      const btn = safeQuerySelector('.playControl:not(.playing)');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('button[aria-label*="play" i]:not([aria-label*="pause" i])');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('[data-testid="play-button"], .sc-button-play');
      if (btn && !btn.classList.contains('playing')) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('.playbackSoundBadge__play:not(.playing)');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      simulateKeyPress(' ');
      return true;
    }
  ];

  for (const strategy of playStrategies) {
    try {
      if (strategy()) return true;
    } catch (e) {
      continue;
    }
  }
  
  return false;
}

function executePauseCommand() {
  const pauseStrategies = [
    () => {
      const btn = safeQuerySelector('.playControl.playing');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('button[aria-label*="pause" i]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('[data-testid="play-button"].playing, .sc-button-play.playing');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('.playbackSoundBadge__play.playing');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      simulateKeyPress(' ');
      return true;
    }
  ];

  for (const strategy of pauseStrategies) {
    try {
      if (strategy()) return true;
    } catch (e) {
      continue;
    }
  }
  
  return false;
}

function executeNextCommand() {
  const nextStrategies = [
    () => {
      const btn = safeQuerySelector('.skipControl__next, .playbackControls__next');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('button[aria-label*="next" i]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('[data-testid="next-button"], .sc-button-next');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      simulateKeyPress('ArrowRight');
      return true;
    }
  ];

  for (const strategy of nextStrategies) {
    try {
      if (strategy()) return true;
    } catch (e) {
      continue;
    }
  }
  
  return false;
}

function executePreviousCommand() {
  const prevStrategies = [
    () => {
      const btn = safeQuerySelector('.skipControl__previous, .playbackControls__previous');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('button[aria-label*="previous" i], button[aria-label*="prev" i]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      const btn = safeQuerySelector('[data-testid="previous-button"], .sc-button-previous');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    () => {
      simulateKeyPress('ArrowLeft');
      return true;
    }
  ];

  for (const strategy of prevStrategies) {
    try {
      if (strategy()) return true;
    } catch (e) {
      continue;
    }
  }
  
  return false;
}

function executeToggleCommand() {
  const trackInfo = getTrackInfo();
  if (trackInfo.isPlaying) {
    return executePauseCommand();
  } else {
    return executePlayCommand();
  }
}

function executeLikeCommand() {
  const isLiked = (btn) => {
    if (!btn) return false;
    const ariaPressed = (safeGetAttribute(btn, 'aria-pressed') || '').toLowerCase();
    const ariaLabel = (safeGetAttribute(btn, 'aria-label') || '').toLowerCase();
    return (
      ariaPressed === 'true' ||
      ariaLabel.includes('unlike') ||
      btn.classList.contains('selected') ||
      btn.classList.contains('sc-button-selected') ||
      btn.classList.contains('m-activity--selected')
    );
  };

  const likeSelectors = [
    '.playbackSoundBadge__like',
    '.playbackSoundBadge button[aria-label*="Like" i]',
    '.playbackSoundBadge button[aria-label*="Unlike" i]',
    'button[aria-label*="Like" i]',
    '[data-testid="like-button"]',
    '.sc-button-like',
  ];

  for (const selector of likeSelectors) {
    const btn = safeQuerySelector(selector);
    if (!btn) continue;
    if (isLiked(btn)) return true;
    btn.click();
    return true;
  }

  // Keyboard fallback on SoundCloud.
  simulateKeyPress('l');
  return true;
}

// Professional keyboard event simulation
function simulateKeyPress(key) {
  try {
    const event = new KeyboardEvent('keydown', {
      key: key,
      code: key === ' ' ? 'Space' : key,
      keyCode: key === ' ' ? 32 : key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0,
      which: key === ' ' ? 32 : key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0,
      bubbles: true,
      cancelable: true
    });
    
    document.activeElement?.dispatchEvent(event);
    document.dispatchEvent(event);
  } catch (error) {
    /* noop */
  }
}

// Extension message handling - simplified for core connection
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getStatus') {
      const connected = !!(ws && ws.readyState === WebSocket.OPEN);
      sendResponse({ connected });
      return;
    }
    if (request.action === 'playPause') {
      simulateKeyPress(' ');
      sendResponse({ success: true });
    } else if (request.action === 'next') {
      simulateKeyPress('ArrowRight');
      sendResponse({ success: true });
    } else if (request.action === 'previous') {
      simulateKeyPress('ArrowLeft');
      sendResponse({ success: true });
    }
  });
}

// Initialize extension (singleton already enforced at top)
connectWebSocket();

// Polls even in background tabs: the mini player still needs the update.
setInterval(sendTrackInfo, 1200);

let playbackDomSyncTimer = null;
function schedulePlaybackDomSync() {
  if (playbackDomSyncTimer) return;
  playbackDomSyncTimer = setTimeout(() => {
    playbackDomSyncTimer = null;
    try {
      sendTrackInfo();
    } catch (_) {
      /* ignore */
    }
  }, 260);
}

function attachPlaybackArtObserver() {
  const mark = (root) => {
    if (!root || root.__soundcloudMiniPlayerArtObserved) return;
    root.__soundcloudMiniPlayerArtObserved = true;
    new MutationObserver(schedulePlaybackDomSync).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'src', 'srcset', 'class'],
    });
  };

  const foot = document.querySelector('footer');
  if (foot) mark(foot);

  const waitFooter = new MutationObserver(() => {
    const next = document.querySelector('footer');
    if (next) {
      mark(next);
      waitFooter.disconnect();
    }
  });
  waitFooter.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', schedulePlaybackDomSync, { once: true });
}

attachPlaybackArtObserver();

let lastUrl = location.href;
let routeDebounceTimer = null;
function scheduleRoutePoll() {
  if (routeDebounceTimer) return;
  routeDebounceTimer = setTimeout(() => {
    routeDebounceTimer = null;
    const href = location.href;
    if (href !== lastUrl) {
      lastUrl = href;
      setTimeout(sendTrackInfo, 500);
    }
  }, 400);
}

new MutationObserver(scheduleRoutePoll).observe(document.documentElement, {
  subtree: true,
  childList: true,
});

})(); /* end IIFE */


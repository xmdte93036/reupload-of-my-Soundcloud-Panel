// Firefox-specific background script for SoundCloud Mini Player extension
const STREAMING_PAGE_RE = /^https:\/\/(soundcloud\.com|open\.spotify\.com)\//i;
let currentTheme = 'regular';
let currentEnabled = true;

// Default themes
const THEMES = {
  regular: {
    name: 'Regular Black',
    description: 'Classic dark theme'
  },
  transparent: {
    name: 'Transparent',
    description: 'Glass-like transparent theme'
  },
  autumn: {
    name: 'Autumn',
    description: 'Warm autumn colors'
  },
  winter: {
    name: 'Snow/Winter',
    description: 'Cool winter theme'
  },
  kawaii: {
    name: 'Kawaii',
    description: 'Cute pastel theme'
  }
};

function notifyActiveTab(message) {
  browser.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (tabs && tabs[0]) {
        return browser.tabs.sendMessage(tabs[0].id, message);
      }
      return null;
    })
    .catch(() => {});
}

// Initialize theme + enabled on extension startup
browser.runtime.onInstalled.addListener(() => {
  browser.storage.sync.get(['theme', 'enabled']).then((result) => {
    currentTheme = result.theme || 'regular';
    currentEnabled = result.enabled !== false;
  }).catch(() => {});
});

// Handle theme changes from popup
browser.runtime.onMessage.addListener((request) => {
  if (request.action === 'getConnectionStatus') {
    return browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id || !STREAMING_PAGE_RE.test(tab.url || '')) {
          return { connected: false };
        }
        return browser.tabs.sendMessage(tab.id, { action: 'getStatus' })
          .then((resp) => ({ connected: !!(resp && resp.connected) }))
          .catch(() => ({ connected: false }));
      })
      .catch(() => ({ connected: false }));
  }

  if (request.action === 'setEnabled') {
    currentEnabled = !!request.enabled;
    browser.storage.sync.set({ enabled: currentEnabled });
    notifyActiveTab({
      action: 'enabledChanged',
      enabled: currentEnabled,
    });
    return Promise.resolve({ success: true });
  }

  if (request.action === 'getEnabled') {
    return Promise.resolve({ enabled: currentEnabled });
  }

  if (request.action === 'changeTheme') {
    currentTheme = request.theme;
    browser.storage.sync.set({ theme: currentTheme });

    notifyActiveTab({
      action: 'themeChanged',
      theme: currentTheme
    });
    return Promise.resolve({ success: true });
  }
  
  if (request.action === 'getCurrentTheme') {
    return Promise.resolve({ theme: currentTheme });
  }

  return Promise.resolve({});
});

// Handle storage changes
browser.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.theme) {
    currentTheme = changes.theme.newValue;
  }
  if (namespace === 'sync' && changes.enabled) {
    currentEnabled = changes.enabled.newValue !== false;
  }
});

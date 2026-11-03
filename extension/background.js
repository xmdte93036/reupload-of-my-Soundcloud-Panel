// Background script for SoundCloud Mini Player extension
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

// Initialize theme + enabled on extension startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['theme', 'enabled'], (result) => {
    currentTheme = result.theme || 'regular';
    currentEnabled = result.enabled !== false;
  });
});

// Handle theme changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getConnectionStatus') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !STREAMING_PAGE_RE.test(tab.url || '')) {
        sendResponse({ connected: false });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (resp) => {
        const connected = !!(resp && resp.connected);
        sendResponse({ connected });
      });
    });
    return true; // async response
  }

  if (request.action === 'setEnabled') {
    currentEnabled = !!request.enabled;
    chrome.storage.sync.set({ enabled: currentEnabled });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'enabledChanged',
          enabled: currentEnabled,
        });
      }
    });

    sendResponse({ success: true });
    return;
  }

  if (request.action === 'getEnabled') {
    sendResponse({ enabled: currentEnabled });
    return;
  }

  if (request.action === 'changeTheme') {
    currentTheme = request.theme;
    chrome.storage.sync.set({ theme: currentTheme });
    
    // Notify content script about theme change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'themeChanged',
          theme: currentTheme
        });
      }
    });
    
    sendResponse({ success: true });
  }
  
  if (request.action === 'getCurrentTheme') {
    sendResponse({ theme: currentTheme });
  }
});

// Handle storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.theme) {
    currentTheme = changes.theme.newValue;
  }
  if (namespace === 'sync' && changes.enabled) {
    currentEnabled = changes.enabled.newValue !== false;
  }
});

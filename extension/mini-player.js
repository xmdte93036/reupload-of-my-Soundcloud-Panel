// Mini Player JavaScript for extension
let currentTheme = 'regular';
const THEMES = ['regular', 'transparent', 'autumn', 'winter', 'kawaii'];

// Initialize theme
document.addEventListener('DOMContentLoaded', () => {
  // Load saved theme
  chrome.storage.sync.get(['theme'], (result) => {
    if (result.theme) {
      currentTheme = result.theme;
      applyTheme(currentTheme);
    }
  });

  // Setup theme button
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', cycleTheme);
  }

  // Listen for theme changes from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'themeChanged') {
      currentTheme = request.theme;
      applyTheme(currentTheme);
    }
    sendResponse({ success: true });
  });

  // Initialize audio visualizer (simplified)
  createBassBars();
  startSimpleVisualization();
});

function applyTheme(theme) {
  // Remove all theme classes
  THEMES.forEach(t => document.body.classList.remove(`theme-${t}`));
  // Add new theme class
  document.body.classList.add(`theme-${theme}`);
}

function cycleTheme() {
  const currentIndex = THEMES.indexOf(currentTheme);
  const nextIndex = (currentIndex + 1) % THEMES.length;
  currentTheme = THEMES[nextIndex];
  
  // Apply theme
  applyTheme(currentTheme);
  
  // Save theme
  chrome.storage.sync.set({ theme: currentTheme });
  
  // Notify background
  chrome.runtime.sendMessage({
    action: 'changeTheme',
    theme: currentTheme
  });
}

// Simple bass bars visualization
function createBassBars() {
  const bassBarsContainer = document.getElementById('bassBars');
  if (!bassBarsContainer) return;
  
  bassBarsContainer.replaceChildren();
  for (let i = 0; i < 200; i++) {
    const cell = document.createElement('div');
    cell.className = 'bass-cell';
    const bar = document.createElement('div');
    bar.className = 'bass-bar';
    bar.style.height = '10%';
    cell.appendChild(bar);
    bassBarsContainer.appendChild(cell);
  }
}

function startSimpleVisualization() {
  const bars = document.querySelectorAll('.bass-bar');
  
  function animate() {
    bars.forEach((bar, index) => {
      const height = Math.random() * 60 + 10; // Random height between 10-70%
      bar.style.height = `${height}%`;
    });
    
    requestAnimationFrame(animate);
  }
  
  animate();
}

// Update track info (placeholder for now)
function updateTrackInfo(track) {
  const songText = document.getElementById('songTitleText');
  const songClone = document.getElementById('songTitleTextClone');
  const songClone2 = document.getElementById('songTitleTextClone2');
  const artistElement = document.getElementById('artistName');
  const playStatus = document.getElementById('playStatus');
  const statusIndicator = document.getElementById('statusIndicator');
  const playBtnIcon = document.getElementById('playBtnIcon');
  const albumArt = document.getElementById('albumArt');

  if (track) {
    // Update song title
    const title = track.title || 'Unknown Track';
    songText.textContent = title;
    songClone.textContent = title;
    songClone2.textContent = title;

    // Update artist
    const artist = track.artist || '';
    artistElement.textContent = artist;

    // Update play status
    if (track.isPlaying) {
      playStatus.textContent = 'Playing';
      statusIndicator.classList.remove('paused');
      playBtnIcon.textContent = '⏸️';
      albumArt.classList.add('playing');
    } else {
      playStatus.textContent = 'Paused';
      statusIndicator.classList.add('paused');
      playBtnIcon.textContent = '▶️';
      albumArt.classList.remove('playing');
    }

    // Update album art
    if (track.artwork) {
      const cover = document.getElementById('albumCoverArt');
      if (cover) {
        cover.src = track.artwork;
        cover.style.display = 'block';
      }
    }
  }
}

// Control button handlers
document.getElementById('prevBtn')?.addEventListener('click', () => {
  // Send message to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'previous'
      });
    }
  });
});

document.getElementById('playBtn')?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'playPause'
      });
    }
  });
});

document.getElementById('nextBtn')?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'next'
      });
    }
  });
});

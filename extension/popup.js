// Popup script for theme selection
document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');

  function setConnectionStatus(connected) {
    const ok = !!connected;
    statusIndicator.classList.toggle('connected', ok);
    statusText.textContent = ok ? 'Connected' : 'Not Connected';
  }

  function refreshConnectionStatus() {
    chrome.runtime.sendMessage({ action: 'getConnectionStatus' }, (response) => {
      setConnectionStatus(response && response.connected === true);
    });
  }

  refreshConnectionStatus();
  setInterval(refreshConnectionStatus, 3000);

});

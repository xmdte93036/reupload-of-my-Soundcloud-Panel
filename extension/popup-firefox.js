// Firefox-specific popup script for theme selection
document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');

  function setConnectionStatus(connected) {
    const ok = !!connected;
    statusIndicator.classList.toggle('connected', ok);
    statusText.textContent = ok ? 'Connected' : 'Not Connected';
  }

  async function refreshConnectionStatus() {
    try {
      const response = await browser.runtime.sendMessage({ action: 'getConnectionStatus' });
      setConnectionStatus(response && response.connected === true);
    } catch {
      setConnectionStatus(false);
    }
  }

  refreshConnectionStatus();
  setInterval(refreshConnectionStatus, 3000);
  
});

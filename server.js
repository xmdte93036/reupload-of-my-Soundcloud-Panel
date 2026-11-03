const WebSocket = require('ws');

const DEFAULT_PORT = Number(process.env.SOUNDCLOUD_MINI_PLAYER_WS_PORT || 8765);

let wssInstance = null;

function startSoundcloudMiniPlayerBridge(port) {
  const listenPort = port != null ? Number(port) : DEFAULT_PORT;
  if (wssInstance) {
    return wssInstance;
  }

  const wss = new WebSocket.Server({ port: listenPort, host: '127.0.0.1' });
  wssInstance = wss;

  wss.on('listening', () => {
    console.log(`Mini-player bridge listening on ws://127.0.0.1:${listenPort}`);
  });

  wss.on('connection', (client) => {
    client.on('message', (raw) => {
      const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
      wss.clients.forEach((other) => {
        if (other !== client && other.readyState === WebSocket.OPEN) {
          other.send(payload);
        }
      });
    });

    client.on('close', () => {});

    client.on('error', (error) => {
      console.warn('Bridge client error:', error.message);
    });
  });

  wss.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${listenPort} is already in use (another Mini-Player or app?). Quit the other process or set SOUNDCLOUD_MINI_PLAYER_WS_PORT.`,
      );
    } else {
      console.error('WebSocket server error:', error.message);
    }
    wssInstance = null;
    if (require.main === module) {
      process.exit(1);
    }
  });

  return wss;
}

if (require.main === module) {
  startSoundcloudMiniPlayerBridge();
}

module.exports = {
  startSoundcloudMiniPlayerBridge,
  DEFAULT_PORT,
};

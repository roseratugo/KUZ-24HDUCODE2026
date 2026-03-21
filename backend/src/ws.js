import { WebSocketServer } from 'ws';

let wss = null;

export function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    ws.on('close', () => console.log('WebSocket client disconnected'));
  });

  console.log('WebSocket server ready on /ws');
}

export function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

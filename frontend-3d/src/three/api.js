import axios from 'axios';

const GAME_ID = 'kuz-team';

const client = axios.create({
  baseURL: '/backend-api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 3000
});

export async function fetchCells() {
  const res = await client.get(`/cells?gameId=${GAME_ID}`);
  return res.data;
}

export async function fetchIslands() {
  const res = await client.get(`/islands?gameId=${GAME_ID}`);
  return res.data;
}

export async function fetchShipPosition() {
  const res = await client.get(`/ship-position/${GAME_ID}`);
  return res.data;
}

export function connectWebSocket(onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  let ws = null;
  let reconnectTimer = null;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[3D] WebSocket connected');
      onMessage({ event: 'ws:connected' });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('[3D] WS parse error', e);
      }
    };

    ws.onclose = () => {
      console.log('[3D] WebSocket disconnected, reconnecting...');
      onMessage({ event: 'ws:disconnected' });
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}

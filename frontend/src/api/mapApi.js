import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const GAME_ID = import.meta.env.VITE_GAME_ID || 'kuz-default';

const mapClient = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const cellsApi = {
  getAll: () => mapClient.get(`/cells?gameId=${GAME_ID}`),

  getBounds: () => mapClient.get(`/cells/bounds?gameId=${GAME_ID}`),

  saveBulk: (cells) => mapClient.post('/cells/bulk', {
    gameId: GAME_ID,
    cells: cells.map(c => ({
      x: c.x,
      y: c.y,
      type: c.type,
      zone: c.zone,
      island: c.island || null
    }))
  }),

  updateState: (cells, state) => mapClient.patch('/cells/state', {
    gameId: GAME_ID,
    cells: cells.map(c => ({ x: c.x, y: c.y })),
    state
  }),

  clearAll: () => mapClient.delete(`/cells?gameId=${GAME_ID}`)
};

export const islandsApi = {
  getAll: () => mapClient.get(`/islands?gameId=${GAME_ID}`),

  save: (island) => mapClient.post('/islands', {
    gameId: GAME_ID,
    island
  }),

  addCell: (islandId, cell) => mapClient.post('/islands/add-cell', {
    gameId: GAME_ID,
    islandId,
    cell
  }),

  updateState: (islandId, state) => mapClient.patch(`/islands/${islandId}/state`, {
    gameId: GAME_ID,
    state
  }),

  clearAll: () => mapClient.delete(`/islands?gameId=${GAME_ID}`)
};

export const statsApi = {
  get: () => mapClient.get('/stats'),
  health: () => mapClient.get('/health')
};

export default mapClient;

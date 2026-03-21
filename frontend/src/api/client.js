import axios from 'axios';
import { CREDENTIALS } from './config';

const baseURL = '/api';

const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'codinggame-id': CREDENTIALS.codingGameId
  }
});

let historyStore = null;

export const setHistoryStore = (store) => {
  historyStore = store;
};

apiClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

// URLs to exclude from history (auto-refresh endpoints)
const excludeFromHistory = ['/players/details', '/resources'];

const shouldLogToHistory = (url) => {
  return !excludeFromHistory.some(excluded => url?.includes(excluded));
};

apiClient.interceptors.response.use(
  (response) => {
    const duration = Date.now() - response.config.metadata.startTime;
    if (historyStore && shouldLogToHistory(response.config.url)) {
      historyStore.addRequest({
        method: response.config.method,
        url: response.config.url,
        status: response.status,
        success: true,
        data: response.config.data ? JSON.parse(response.config.data) : null,
        response: response.data,
        duration
      });
    }
    return response;
  },
  (error) => {
    const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : null;
    if (historyStore && shouldLogToHistory(error.config?.url)) {
      historyStore.addRequest({
        method: error.config?.method,
        url: error.config?.url,
        status: error.response?.status || 0,
        success: false,
        data: error.config?.data ? JSON.parse(error.config.data) : null,
        error: error.response?.data?.message || error.message,
        duration
      });
    }
    return Promise.reject(error);
  }
);

export const playerApi = {
  getDetails: () => apiClient.get('/players/details'),
  getResources: () => apiClient.get('/resources')
};

export const shipApi = {
  build: () => apiClient.post('/ship/build'),
  move: (direction) => apiClient.post('/ship/move', { direction }),
  nextLevel: () => apiClient.get('/ship/next-level'),
  upgrade: (level) => apiClient.put('/ship/upgrade', { level })
};

export const storageApi = {
  nextLevel: () => apiClient.get('/storage/next-level'),
  upgrade: () => apiClient.put('/storage/upgrade')
};

export const theftsApi = {
  getAll: () => apiClient.get('/thefts'),
  steal: (resourceType, moneySpent) => apiClient.post('/thefts/player', { resourceType, moneySpent })
};

export const registrationApi = {
  signupCodes: (email) => apiClient.post('/signupcodes', { mail: email }),
  register: (name, signupCode) => apiClient.post('/players/register', { name }, {
    headers: { 'codinggame-signupcode': signupCode }
  })
};

export default apiClient;

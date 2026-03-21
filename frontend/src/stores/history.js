import { defineStore } from 'pinia';

export const useHistoryStore = defineStore('history', {
  state: () => ({
    requests: [],
    maxHistory: 100
  }),

  getters: {
    recentRequests: (state) => state.requests.slice(-50).reverse(),
    allRequests: (state) => [...state.requests].reverse()
  },

  actions: {
    addRequest(request) {
      const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        method: request.method?.toUpperCase() || 'GET',
        endpoint: request.url || request.endpoint,
        status: request.status || null,
        success: request.success ?? true,
        data: request.data || null,
        response: request.response || null,
        error: request.error || null,
        duration: request.duration || null
      };

      this.requests.push(entry);

      if (this.requests.length > this.maxHistory) {
        this.requests = this.requests.slice(-this.maxHistory);
      }
    },

    clearHistory() {
      this.requests = [];
    }
  }
});

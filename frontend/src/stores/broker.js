import { defineStore } from 'pinia';
import { CREDENTIALS } from '../api/config';

export const useBrokerStore = defineStore('broker', {
  state: () => ({
    ws: null,
    connectionStatus: 'disconnected',
    error: null,
    messages: [],
    maxMessages: 100,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectDelay: 5000,
    reconnectTimeout: null,
    lastEvents: {
      ACHAT: null,
      OFFRE: null,
      OFFRE_SUPPRIMEE: null,
      DISCOVERED_ISLAND: null,
      VOL: null
    },
    eventListeners: []
  }),

  getters: {
    isConnected: (state) => state.connectionStatus === 'connected',
    isConnecting: (state) => ['connecting', 'ws_ready'].includes(state.connectionStatus),
    latestMessage: (state) => state.messages[0] || null
  },

  actions: {
    connect(playerId, playerName) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return;
      }

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/broker`;

      this.connectionStatus = 'connecting';
      this.error = null;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connectionStatus = 'ws_ready';
          this.sendCredentials(playerId, playerName);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (err) {
            console.error('[BrokerStore] Message invalide:', err);
          }
        };

        this.ws.onerror = () => {
          this.connectionStatus = 'error';
          this.error = 'Erreur de connexion WebSocket';
        };

        this.ws.onclose = () => {
          this.connectionStatus = 'disconnected';
          this.ws = null;
          this.scheduleReconnect(playerId, playerName);
        };
      } catch (err) {
        this.connectionStatus = 'error';
        this.error = err.message;
      }
    },

    sendCredentials(playerId, playerName) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const username = (CREDENTIALS.brokerTeamName || playerName).replace(/ /g, '_');

      this.ws.send(JSON.stringify({
        type: 'connect',
        username,
        password: playerId,
        playerId
      }));
    },

    handleMessage(data) {
      switch (data.type) {
        case 'status':
          if (data.status === 'ready') {
            this.connectionStatus = 'connected';
            this.error = null;
            this.reconnectAttempts = 0;
          } else if (data.status === 'disconnected') {
            this.connectionStatus = 'disconnected';
          } else if (data.status === 'connecting') {
            this.connectionStatus = 'connecting';
          }
          break;

        case 'error':
          this.error = data.message;
          break;

        case 'message':
          this.handleBrokerEvent(data.data || data.raw);
          break;
      }
    },

    handleBrokerEvent(eventData) {
      if (!eventData) return;

      const eventType = eventData.type;
      const eventMessage = eventData.message;

      this.messages.unshift({
        id: Date.now(),
        type: eventType,
        data: eventMessage,
        timestamp: new Date().toISOString()
      });

      if (this.messages.length > this.maxMessages) {
        this.messages = this.messages.slice(0, this.maxMessages);
      }

      if (this.lastEvents.hasOwnProperty(eventType)) {
        this.lastEvents[eventType] = {
          data: eventMessage,
          timestamp: new Date().toISOString()
        };
      }

      this.notifyListeners(eventType, eventMessage);
    },

    subscribe(eventTypes, callback) {
      const listener = { eventTypes, callback };
      this.eventListeners.push(listener);

      return () => {
        const index = this.eventListeners.indexOf(listener);
        if (index > -1) {
          this.eventListeners.splice(index, 1);
        }
      };
    },

    notifyListeners(eventType, data) {
      this.eventListeners.forEach(listener => {
        if (listener.eventTypes.includes(eventType) || listener.eventTypes.includes('*')) {
          try {
            listener.callback(eventType, data);
          } catch (err) {
            console.error('[BrokerStore] Erreur listener:', err);
          }
        }
      });
    },

    scheduleReconnect(playerId, playerName) {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[BrokerStore] Reconnexion dans ${this.reconnectDelay/1000}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
          this.connect(playerId, playerName);
        }, this.reconnectDelay);
      } else {
        this.error = 'Nombre maximum de tentatives de reconnexion atteint';
      }
    },

    disconnect() {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      this.reconnectAttempts = this.maxReconnectAttempts;

      if (this.ws) {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        this.ws.close();
        this.ws = null;
      }

      this.connectionStatus = 'disconnected';
    },

    clearMessages() {
      this.messages = [];
    }
  }
});

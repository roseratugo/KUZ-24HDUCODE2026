/**
 * Client JS qui communique avec le bot Python (port 5001).
 */
import axios from 'axios';

const BOT_API = '/bot-api';

export class ExplorationBot {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.lastLogId = 0;
    this.pollInterval = null;

    this.onStatusChange = null;
    this.onLog = null;
    this.onMove = null;
    this.onDiscovery = null;
  }

  async start() {
    try {
      await axios.post(`${BOT_API}/start`);
      this.isRunning = true;
      this.lastLogId = 0;
      this.startPolling();
    } catch (err) {
      console.error('Erreur démarrage bot:', err);
      if (this.onLog) {
        this.onLog({
          timestamp: new Date().toLocaleTimeString(),
          message: '❌ Impossible de contacter le serveur bot (python explorer.py)',
          type: 'error'
        });
      }
    }
  }

  async stop() {
    try {
      await axios.post(`${BOT_API}/stop`);
    } catch (err) {
      console.error('Erreur arrêt bot:', err);
    }
    this.isRunning = false;
    this.stopPolling();
    if (this.onStatusChange) this.onStatusChange('stopped');
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.pollLogs(), 1500);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async pollLogs() {
    try {
      const res = await axios.get(`${BOT_API}/logs?since=${this.lastLogId}`);
      const logs = res.data.logs || [];
      for (const log of logs) {
        if (this.onLog) {
          this.onLog({
            timestamp: log.timestamp,
            message: log.message,
            type: log.type
          });
        }
        this.lastLogId = log.id;
      }

      // Vérifier le statut
      const status = await axios.get(`${BOT_API}/status`);
      const wasRunning = this.isRunning;
      this.isRunning = status.data.running;

      if (wasRunning && !this.isRunning) {
        this.stopPolling();
        if (this.onStatusChange) this.onStatusChange('stopped');
      }
    } catch (err) {
      // Serveur bot pas accessible
    }
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
    };
  }
}

export default ExplorationBot;

export class ExplorationBot {
  constructor(options = {}) {
    this.isRunning = false;
    this.isPaused = false;
    this.onStatusChange = null;
    this.onLog = null;
    this.onMove = null;
    this.onDiscovery = null;
  }

  async start(shipStore, mapStore, playerStore) {
    this.isRunning = true;
    // TODO: implémenter le bot ici
  }

  stop() {
    this.isRunning = false;
    if (this.onStatusChange) this.onStatusChange('stopped');
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }

  getStats() {
    return { isRunning: this.isRunning, isPaused: this.isPaused };
  }
}

export default ExplorationBot;

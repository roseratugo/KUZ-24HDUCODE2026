import { defineStore } from 'pinia';
import { shipApi } from '../api/client';
import { movesApi, shipPositionApi } from '../api/mapApi';

const STORAGE_KEY = 'kuz-ship-state';

const loadFromStorage = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load ship state from storage:', e);
  }
  return null;
};

const saveToStorage = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      position: state.position,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      shipLevel: state.shipLevel,
      lastMoveAt: state.lastMoveAt,
      lastUpdate: new Date().toISOString()
    }));
  } catch (e) {
    console.error('Failed to save ship state to storage:', e);
  }
};

export const useShipStore = defineStore('ship', {
  state: () => {
    const saved = loadFromStorage();
    return {
      ship: null,
      position: saved?.position || null,
      energy: saved?.energy ?? 0,
      maxEnergy: saved?.maxEnergy ?? 100,
      shipLevel: saved?.shipLevel || { name: 'Inconnu', visibilityRange: 1, speed: 5000 },
      discoveredCells: [],
      loading: false,
      error: null,
      moveHistory: [],
      lastUpdate: saved?.lastUpdate || null,
      lastMoveAt: saved?.lastMoveAt || null,
      cooldownRemaining: 0
    };
  },

  getters: {
    currentPosition: (state) => state.position,
    availableEnergy: (state) => state.energy,
    hasShip: (state) => state.ship !== null || state.position !== null,
    lastDiscoveredCells: (state) => state.discoveredCells,
    energyPercent: (state) => {
      if (!state.maxEnergy) return 0;
      return Math.round((state.energy / state.maxEnergy) * 100);
    },
    isOnCooldown: (state) => state.cooldownRemaining > 0,
    cooldownSeconds: (state) => Math.ceil(state.cooldownRemaining / 1000),
    shipSpeed: (state) => state.shipLevel?.speed || 5000
  },

  actions: {
    async buildShip() {
      this.loading = true;
      this.error = null;
      try {
        const response = await shipApi.build();
        this.ship = response.data;
        if (response.data.level) {
          this.shipLevel = response.data.level;
          this.maxEnergy = response.data.level.maxMovement || 100;
        }
        if (response.data.currentPosition) {
          this.position = response.data.currentPosition;
        }
        if (response.data.availableMove !== undefined) {
          this.energy = response.data.availableMove;
        }
        saveToStorage(this);
        return response.data;
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors de la construction du bateau';
        console.error('Error building ship:', err);
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async move(direction) {
      if (this.cooldownRemaining > 0) return;

      this.error = null;
      const speed = this.shipLevel?.speed || 5000;
      const fromPosition = this.position ? { ...this.position } : null;
      const energyBefore = this.energy;
      this.lastMoveAt = new Date().toISOString();
      this.cooldownRemaining = speed;
      this.startCooldownTimer();

      try {
        const response = await shipApi.move(direction);
        const data = response.data;

        this.position = data.position;
        this.energy = data.energy;
        this.discoveredCells = data.discoveredCells || [];
        this.lastUpdate = new Date().toISOString();

        const moveRecord = {
          direction,
          fromPosition,
          toPosition: data.position,
          energyBefore,
          energyAfter: data.energy,
          cellsDiscovered: this.discoveredCells.length,
          timestamp: new Date().toISOString()
        };

        this.moveHistory.push(moveRecord);

        // Save move to DB (fire and forget)
        movesApi.save(moveRecord).catch(err => {
          console.error('Failed to save move to DB:', err);
        });

        // Save position to DB (fire and forget)
        if (data.position) {
          shipPositionApi.save(data.position).catch(err => {
            console.error('Failed to save ship position to DB:', err);
          });
        }

        saveToStorage(this);

        return data;
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors du deplacement';
        console.error('Error moving ship:', err);
        throw err;
      }
    },

    async loadMoveHistory() {
      try {
        const response = await movesApi.getRecent(100);
        this.moveHistory = response.data.map(m => ({
          direction: m.direction,
          fromPosition: m.fromPosition,
          toPosition: m.toPosition,
          energyBefore: m.energyBefore,
          energyAfter: m.energyAfter,
          cellsDiscovered: m.cellsDiscovered,
          timestamp: m.timestamp
        })).reverse();
      } catch (err) {
        console.error('Failed to load move history:', err);
      }
    },

    async getMoveStats() {
      try {
        const response = await movesApi.getStats();
        return response.data;
      } catch (err) {
        console.error('Failed to get move stats:', err);
        return null;
      }
    },

    startCooldownTimer() {
      const interval = setInterval(() => {
        this.cooldownRemaining = Math.max(0, this.cooldownRemaining - 100);
        if (this.cooldownRemaining <= 0) {
          clearInterval(interval);
        }
      }, 100);
    },

    checkAndRestoreCooldown() {
      if (this.lastMoveAt) {
        const elapsed = Date.now() - new Date(this.lastMoveAt).getTime();
        const speed = this.shipLevel?.speed || 5000;
        const remaining = speed - elapsed;
        if (remaining > 0) {
          this.cooldownRemaining = remaining;
          this.startCooldownTimer();
        }
      }
    },

    updateFromMoveResponse(data) {
      if (data.position) {
        this.position = data.position;
      }
      if (data.energy !== undefined) {
        this.energy = data.energy;
      }
      if (data.discoveredCells) {
        this.discoveredCells = data.discoveredCells;
      }
      saveToStorage(this);
    },

    updateFromPlayerDetails(shipData) {
      // Update energy from availableMove
      if (shipData.availableMove !== undefined) {
        this.energy = shipData.availableMove;
      }
      // Update ship level info
      if (shipData.level) {
        this.shipLevel = shipData.level;
        this.maxEnergy = shipData.level.maxMovement || 15;
      }
      // Update lastMoveAt from API
      if (shipData.lastMoveAt) {
        const apiLastMove = new Date(shipData.lastMoveAt).getTime();
        const localLastMove = this.lastMoveAt ? new Date(this.lastMoveAt).getTime() : 0;
        // Only update if API has more recent move
        if (apiLastMove > localLastMove) {
          this.lastMoveAt = shipData.lastMoveAt;
          const elapsed = Date.now() - apiLastMove;
          const speed = shipData.level?.speed || 5000;
          const remaining = speed - elapsed;
          if (remaining > 0 && this.cooldownRemaining <= 0) {
            this.cooldownRemaining = remaining;
            this.startCooldownTimer();
          }
        }
      }
      this.lastUpdate = new Date().toISOString();
      saveToStorage(this);
    },

    setMaxEnergy(max) {
      this.maxEnergy = max;
      saveToStorage(this);
    },

    setShipLevel(level) {
      this.shipLevel = level;
      if (level.maxMovement) {
        this.maxEnergy = level.maxMovement;
      }
      saveToStorage(this);
    },

    clearHistory() {
      this.moveHistory = [];
      movesApi.clearAll().catch(err => {
        console.error('Failed to clear move history from DB:', err);
      });
    },

    async loadPositionFromDB() {
      try {
        const response = await shipPositionApi.get();
        if (response.data && response.data.x !== undefined) {
          this.position = {
            x: response.data.x,
            y: response.data.y,
            type: response.data.type,
            zone: response.data.zone
          };
          saveToStorage(this);
        }
      } catch (err) {
        // 404 = pas encore de position enregistrée, pas une erreur critique
        if (err.response?.status !== 404) {
          console.error('Failed to load ship position from DB:', err);
        }
      }
    },

    resetState() {
      localStorage.removeItem(STORAGE_KEY);
      this.position = null;
      this.energy = 0;
      this.maxEnergy = 100;
      this.discoveredCells = [];
      this.moveHistory = [];
      movesApi.clearAll().catch(err => {
        console.error('Failed to clear move history from DB:', err);
      });
    }
  }
});

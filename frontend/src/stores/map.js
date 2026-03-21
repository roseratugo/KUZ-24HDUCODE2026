import { defineStore } from 'pinia';
import { cellsApi, islandsApi, statsApi } from '../api/mapApi';

export const useMapStore = defineStore('map', {
  state: () => ({
    cells: new Map(),
    islands: new Map(),
    shipPosition: null,
    viewSettings: {
      zoom: 1,
      centerX: 0,
      centerY: 0
    },
    stats: null,
    loading: false,
    syncing: false,
    lastSync: null,
    error: null
  }),

  getters: {
    allCells: (state) => Array.from(state.cells.values()),

    mapBounds: (state) => {
      const cells = Array.from(state.cells.values());
      if (cells.length === 0) {
        return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
      }
      const xs = cells.map(c => c.x);
      const ys = cells.map(c => c.y);
      return {
        minX: Math.min(...xs) - 2,
        maxX: Math.max(...xs) + 2,
        minY: Math.min(...ys) - 2,
        maxY: Math.max(...ys) + 2
      };
    },

    getCellAt: (state) => (x, y) => {
      return state.cells.get(`${x},${y}`) || null;
    },

    islandCells: (state) => {
      return Array.from(state.cells.values()).filter(c => c.type === 'SAND');
    },

    cellCount: (state) => state.cells.size,
    islandCount: (state) => state.islands.size
  },

  actions: {
    async loadFromDB() {
      this.loading = true;
      this.error = null;
      try {
        const [cellsRes, islandsRes] = await Promise.all([
          cellsApi.getAll(),
          islandsApi.getAll()
        ]);

        this.cells.clear();
        cellsRes.data.forEach(cell => {
          const key = `${cell.x},${cell.y}`;
          this.cells.set(key, cell);
        });

        this.islands.clear();
        islandsRes.data.forEach(island => {
          this.islands.set(island.islandId, island);
        });

        console.log(`Loaded ${this.cells.size} cells and ${this.islands.size} islands from DB`);
      } catch (err) {
        console.error('Failed to load from DB:', err);
        this.error = 'Erreur de chargement depuis la base de donnees';
      } finally {
        this.loading = false;
      }
    },

    async addCells(cells, state = 'SEEN') {
      const newCells = [];

      cells.forEach(cell => {
        const key = `${cell.x},${cell.y}`;
        const existing = this.cells.get(key);

        if (!existing || this.getStateWeight(state) > this.getStateWeight(existing.state)) {
          const cellData = {
            ...cell,
            state,
            discoveredAt: existing?.discoveredAt || new Date().toISOString()
          };
          this.cells.set(key, cellData);
          newCells.push(cellData);

          if (cell.island) {
            this.addIsland(cell.island, cell);
          }
        }
      });

      if (newCells.length > 0) {
        this.syncToDB(newCells);
      }
    },

    async addIsland(island, cell) {
      if (!this.islands.has(island.id)) {
        this.islands.set(island.id, {
          islandId: island.id,
          name: island.name,
          bonusQuotient: island.bonusQuotient,
          cells: []
        });

        try {
          await islandsApi.save(island);
        } catch (err) {
          console.error('Failed to save island:', err);
        }
      }

      if (cell) {
        const islandData = this.islands.get(island.id);
        if (!islandData.cells.find(c => c.x === cell.x && c.y === cell.y)) {
          islandData.cells.push({ x: cell.x, y: cell.y, cellId: cell.id });

          try {
            await islandsApi.addCell(island.id, cell);
          } catch (err) {
            console.error('Failed to add cell to island:', err);
          }
        }
      }
    },

    async syncToDB(cells) {
      if (cells.length === 0) return;

      this.syncing = true;
      try {
        await cellsApi.saveBulk(cells);
        this.lastSync = new Date().toISOString();
      } catch (err) {
        console.error('Failed to sync to DB:', err);
        this.error = 'Erreur de synchronisation';
      } finally {
        this.syncing = false;
      }
    },

    getStateWeight(state) {
      const weights = { 'VISITED': 1, 'SEEN': 2, 'KNOWN': 3 };
      return weights[state] || 0;
    },

    async updateShipPosition(position) {
      this.shipPosition = position;
      if (position) {
        await this.addCells([position], 'KNOWN');
      }
    },

    setViewCenter(x, y) {
      this.viewSettings.centerX = x;
      this.viewSettings.centerY = y;
    },

    setZoom(zoom) {
      this.viewSettings.zoom = Math.max(0.5, Math.min(3, zoom));
    },

    centerOnShip() {
      if (this.shipPosition) {
        this.setViewCenter(this.shipPosition.x, this.shipPosition.y);
      }
    },

    async syncIslandStates(discoveredIslands) {
      for (const { island, islandState } of discoveredIslands) {
        if (islandState !== 'KNOWN') continue;

        const localIsland = Array.from(this.islands.values()).find(i => i.name === island.name);
        if (localIsland && localIsland.state !== 'KNOWN') {
          localIsland.state = 'KNOWN';
          try {
            await islandsApi.updateState(localIsland.islandId, 'KNOWN');
            console.log(`Island ${island.name} state updated to KNOWN`);
          } catch (err) {
            console.error(`Failed to update island ${island.name} state:`, err);
          }
        }
      }
    },

    async fetchStats() {
      try {
        const res = await statsApi.get();
        this.stats = res.data;
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    }
  }
});

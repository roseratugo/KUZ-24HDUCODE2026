import { defineStore } from 'pinia';
import { playerApi } from '../api/client';
import { useShipStore } from './ship';
import { useMapStore } from './map';

export const usePlayerStore = defineStore('player', {
  state: () => ({
    details: null,
    resources: [],
    loading: false,
    error: null
  }),

  getters: {
    playerName: (state) => state.details?.name || 'Non connecte',
    money: (state) => state.details?.money || 0,
    quotient: (state) => state.details?.quotient || 0,
    homeIsland: (state) => state.details?.home || null,
    discoveredIslands: (state) => state.details?.discoveredIslands || [],
    marketPlaceDiscovered: (state) => state.details?.marketPlaceDiscovered || false,
    resourceByType: (state) => (type) => {
      return state.resources.find(r => r.type === type)?.quantity || 0;
    }
  },

  actions: {
    async fetchDetails() {
      this.error = null;
      try {
        const response = await playerApi.getDetails();
        this.details = response.data;

        if (response.data.ship) {
          const shipStore = useShipStore();
          shipStore.updateFromPlayerDetails(response.data.ship);
        }

        if (response.data.discoveredIslands?.length) {
          const mapStore = useMapStore();
          if (mapStore.islands.size === 0) {
            await mapStore.loadFromDB();
          }
          await mapStore.syncIslandStates(response.data.discoveredIslands);
        }
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors du chargement des details';
        console.error('Error fetching player details:', err);
      }
    },

    async fetchResources() {
      this.error = null;
      try {
        const response = await playerApi.getResources();
        this.resources = response.data;
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors du chargement des ressources';
        console.error('Error fetching resources:', err);
      }
    },

    async refreshAll() {
      await Promise.all([
        this.fetchDetails(),
        this.fetchResources()
      ]);
    }
  }
});

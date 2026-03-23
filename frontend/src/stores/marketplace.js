import { defineStore } from 'pinia';
import { marketplaceApi } from '../api/client';
import { pricesApi, cachedOffersApi } from '../api/mapApi';
import { useBrokerStore } from './broker';
import { usePlayerStore } from './player';

export const useMarketplaceStore = defineStore('marketplace', {
  state: () => ({
    offers: [],
    priceHistory: {},
    loading: false,
    error: null,
    lastUpdate: null,
    unsubscribe: null
  }),

  getters: {
    offersByResource: (state) => (resourceType) => {
      return state.offers.filter(o => o.resourceType === resourceType);
    },
    myOffers: (state) => {
      const playerStore = usePlayerStore();
      return state.offers.filter(o => o.owner === playerStore.details?.id);
    },
    bestPriceByResource: (state) => (resourceType) => {
      const offers = state.offers.filter(o => o.resourceType === resourceType && o.quantity > 0);
      if (offers.length === 0) return null;
      return Math.min(...offers.map(o => o.unitPrice));
    },
    resourceStats: (state) => (resourceType) => {
      const history = state.priceHistory[resourceType] || [];
      if (history.length === 0) return null;

      const prices = history.map(h => h.avgPrice).filter(p => p > 0);
      if (prices.length === 0) return null;

      return {
        current: prices[prices.length - 1],
        min: Math.min(...prices),
        max: Math.max(...prices),
        avg: prices.reduce((a, b) => a + b, 0) / prices.length,
        trend: prices.length > 1 ? (prices[prices.length - 1] - prices[0]) / prices[0] * 100 : 0
      };
    }
  },

  actions: {
    async init() {
      const brokerStore = useBrokerStore();
      this.unsubscribe = brokerStore.subscribe(
        ['ACHAT', 'OFFRE', 'OFFRE_SUPPRIMEE'],
        this.handleBrokerEvent.bind(this)
      );

      try {
        await this.fetchOffers();
      } catch (err) {
        console.log('[MarketplaceStore] Fetch initial skipped (rate limiting), waiting for broker events');
      }

      await this.loadPriceHistory();
    },

    cleanup() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    },

    handleBrokerEvent(eventType, data) {
      console.log(`[MarketplaceStore] Event: ${eventType}`, data);

      switch (eventType) {
        case 'OFFRE':
          this.handleNewOffer(data);
          break;

        case 'ACHAT':
          this.handlePurchase(data);
          break;

        case 'OFFRE_SUPPRIMEE':
          this.handleOfferDeleted(data);
          break;
      }

      this.updatePriceHistory();
    },

    handleNewOffer(data) {
      if (!data) return;

      const normalizedData = {
        id: data.id,
        resourceType: data.resourceType,
        quantity: data.quantityIn || data.quantity || 0,
        quantityIn: data.quantityIn || data.quantity || 0,
        unitPrice: data.pricePerResource || data.unitPrice || 0,
        pricePerResource: data.pricePerResource || data.unitPrice || 0,
        owner: data.owner
      };

      const existingIndex = this.offers.findIndex(o => o.id === data.id);
      if (existingIndex >= 0) {
        const existing = this.offers[existingIndex];
        this.offers[existingIndex] = {
          ...existing,
          resourceType: normalizedData.resourceType || existing.resourceType,
          quantity: normalizedData.quantity > 0 ? normalizedData.quantity : existing.quantity,
          quantityIn: normalizedData.quantityIn > 0 ? normalizedData.quantityIn : existing.quantityIn,
          unitPrice: normalizedData.unitPrice > 0 ? normalizedData.unitPrice : existing.unitPrice,
          pricePerResource: normalizedData.pricePerResource > 0 ? normalizedData.pricePerResource : existing.pricePerResource,
          owner: normalizedData.owner || existing.owner
        };
      } else {
        this.offers.push(normalizedData);
      }

      this.lastUpdate = new Date().toISOString();
    },

    handlePurchase(data) {
      if (!data || !data.offerId) return;

      const offerIndex = this.offers.findIndex(o => o.id === data.offerId);
      if (offerIndex >= 0) {
        const offer = this.offers[offerIndex];
        offer.quantity = Math.max(0, (offer.quantity || 0) - (data.quantity || 0));

        if (offer.quantity <= 0) {
          this.offers.splice(offerIndex, 1);
        }
      }

      const playerStore = usePlayerStore();
      playerStore.fetchResources();

      this.lastUpdate = new Date().toISOString();
    },

    handleOfferDeleted(data) {
      if (!data || !data.id) return;

      const index = this.offers.findIndex(o => o.id === data.id);
      if (index >= 0) {
        this.offers.splice(index, 1);
      }

      this.lastUpdate = new Date().toISOString();
    },

    async fetchOffers() {
      this.loading = true;
      this.error = null;

      try {
        console.log('[MarketplaceStore] Fetching offers from cache...');
        const response = await cachedOffersApi.getAll();
        console.log('[MarketplaceStore] Cache response:', response.data);
        this.offers = response.data || [];
        this.lastUpdate = new Date().toISOString();
        console.log(`[MarketplaceStore] Loaded ${this.offers.length} offers from cache`);
        this.updatePriceHistory();
      } catch (cacheErr) {
        console.log('[MarketplaceStore] Cache unavailable:', cacheErr.message, 'trying external API');

        try {
          const response = await marketplaceApi.getOffers();
          this.offers = response.data || [];
          this.lastUpdate = new Date().toISOString();
          this.updatePriceHistory();
        } catch (err) {
          const errorCode = err.response?.data?.codeError;
          if (errorCode === 'TOO_FAST_TOO_FURIOUS') {
            this.error = 'Rate limiting - Les offres se mettront a jour via le broker';
            console.log('[MarketplaceStore] Rate limited, using broker for updates');
          } else {
            this.error = err.response?.data?.message || 'Erreur lors du chargement des offres';
            console.error('[MarketplaceStore] Error fetching offers:', err);
          }
        }
      } finally {
        this.loading = false;
      }
    },

    async loadPriceHistory() {
      try {
        const response = await pricesApi.getAll();
        const data = response.data || {};

        const historyByType = {};

        Object.entries(data).forEach(([resourceType, entries]) => {
          if (Array.isArray(entries)) {
            historyByType[resourceType] = entries.map(item => ({
              timestamp: item.time || item.timestamp,
              avgPrice: item.avg || item.avgPrice,
              minPrice: item.min || item.minPrice,
              maxPrice: item.max || item.maxPrice,
              totalQuantity: item.totalQuantity,
              offerCount: item.count || item.offerCount
            }));
          }
        });

        this.priceHistory = historyByType;
      } catch (err) {
        console.error('[MarketplaceStore] Error loading price history:', err);
      }
    },

    updatePriceHistory() {
      const resourceTypes = ['MUSIC', 'MUSIC_LEGACY', 'MUSIC_MODERN', 'ART', 'PHOTO', 'VIDEO'];
      const now = new Date().toISOString();
      const snapshots = [];

      resourceTypes.forEach(type => {
        const typeOffers = this.offers.filter(o => o.resourceType === type && o.quantity > 0);

        if (typeOffers.length > 0) {
          const prices = typeOffers.map(o => o.unitPrice);
          const quantities = typeOffers.map(o => o.quantity);
          const totalQty = quantities.reduce((a, b) => a + b, 0);

          const snapshot = {
            resourceType: type,
            timestamp: now,
            avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices),
            totalQuantity: totalQty,
            offerCount: typeOffers.length
          };

          snapshots.push(snapshot);

          if (!this.priceHistory[type]) {
            this.priceHistory[type] = [];
          }
          this.priceHistory[type].push(snapshot);

          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          this.priceHistory[type] = this.priceHistory[type].filter(
            h => new Date(h.timestamp).getTime() > oneDayAgo
          );
        }
      });

      if (snapshots.length > 0) {
        pricesApi.saveBulk(snapshots).catch(err => {
          console.error('[MarketplaceStore] Error saving price history:', err);
        });
      }
    },

    async createOffer(resourceType, quantity, unitPrice) {
      try {
        const payload = {
          resourceType,
          quantityIn: quantity,
          pricePerResource: unitPrice
        };
        console.log('[MarketplaceStore] Creating offer with payload:', payload);
        const response = await marketplaceApi.createOffer(payload);
        console.log('[MarketplaceStore] Create offer response:', response.data);

        if (response.data && response.data.id) {
          const playerStore = usePlayerStore();
          const newOffer = {
            id: response.data.id,
            owner: playerStore.details?.id || null,
            resourceType,
            quantity,
            quantityIn: quantity,
            unitPrice,
            pricePerResource: unitPrice
          };

          console.log('[MarketplaceStore] Adding offer locally:', newOffer);
          this.offers.push(newOffer);
          this.lastUpdate = new Date().toISOString();
          console.log('[MarketplaceStore] Total offers now:', this.offers.length, this.offers);

          cachedOffersApi.saveOwn(newOffer).then(res => {
            console.log('[MarketplaceStore] Own offer cached successfully:', res.data);
          }).catch(err => {
            console.log('[MarketplaceStore] Could not cache own offer:', err.message);
          });
        }

        return response.data;
      } catch (err) {
        throw err;
      }
    },

    async updateOffer(offerId, quantity, unitPrice) {
      try {
        const response = await marketplaceApi.updateOffer(offerId, {
          quantityIn: quantity,
          pricePerResource: unitPrice
        });

        const offerIndex = this.offers.findIndex(o => o.id === offerId);
        if (offerIndex >= 0) {
          this.offers[offerIndex].quantity = quantity;
          this.offers[offerIndex].quantityIn = quantity;
          this.offers[offerIndex].unitPrice = unitPrice;
          this.offers[offerIndex].pricePerResource = unitPrice;
          this.lastUpdate = new Date().toISOString();

          cachedOffersApi.saveOwn({
            id: offerId,
            ...this.offers[offerIndex]
          }).catch(err => {
            console.log('[MarketplaceStore] Could not update cached offer:', err.message);
          });
        }

        return response.data;
      } catch (err) {
        throw err;
      }
    },

    async deleteOffer(offerId) {
      try {
        await marketplaceApi.deleteOffer(offerId);
      } catch (err) {
        throw err;
      }
    },

    async purchase(offerId, quantity) {
      try {
        const response = await marketplaceApi.purchase(offerId, quantity);
        return response.data;
      } catch (err) {
        throw err;
      }
    }
  }
});

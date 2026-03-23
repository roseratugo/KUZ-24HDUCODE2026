/**
 * @file stores/marketplace.js
 * @description Store Pinia pour la gestion du marketplace (offres de ressources).
 *
 * Ce store gère les offres de vente de ressources entre joueurs.
 * Il utilise une stratégie de données à trois niveaux, par ordre de priorité :
 *
 *  1. BROKER (primaire, temps réel) : les événements WebSocket AMQP (OFFRE, ACHAT,
 *     OFFRE_SUPPRIMEE) mettent à jour l'état instantanément sans polling.
 *
 *  2. CACHE BACKEND (secondaire) : au démarrage, on tente de charger les offres
 *     depuis notre propre backend (cachedOffersApi) pour récupérer un état initial
 *     sans dépendre de la disponibilité de l'API du jeu.
 *
 *  3. API DU JEU (fallback) : si le cache backend échoue, on interroge directement
 *     l'API officielle. En cas de rate limiting (TOO_FAST_TOO_FURIOUS), on laisse
 *     le broker prendre le relais sans erreur bloquante.
 *
 * Normalisation des noms de champs :
 * L'API du jeu utilise 'quantityIn' et 'pricePerResource'.
 * Notre code interne utilise aussi 'quantity' et 'unitPrice' pour plus de lisibilité.
 * Les deux noms coexistent dans les objets offre pour garantir la compatibilité.
 *
 * Historique des prix :
 * À chaque mise à jour des offres, un snapshot de prix est calculé par ressource
 * et sauvegardé dans notre backend. L'historique est élagué à 24h glissantes.
 */

import { defineStore } from 'pinia';
import { marketplaceApi } from '../api/client';
import { pricesApi, cachedOffersApi } from '../api/mapApi';
import { useBrokerStore } from './broker';
import { usePlayerStore } from './player';

export const useMarketplaceStore = defineStore('marketplace', {
  state: () => ({
    offers: [],           // Liste des offres actives {id, resourceType, quantity, unitPrice, owner}
    priceHistory: {},     // Historique de prix par type : { 'MUSIC': [{timestamp, avgPrice, ...}] }
    loading: false,
    error: null,
    lastUpdate: null,     // ISO timestamp de la dernière modification des offres
    unsubscribe: null     // Fonction de désabonnement du broker (retournée par subscribe())
  }),

  getters: {
    /**
     * Filtre les offres par type de ressource.
     * Getter paramétré : retourne une fonction pour permettre l'argument en template.
     * Exemple : marketplaceStore.offersByResource('MUSIC')
     */
    offersByResource: (state) => (resourceType) => {
      return state.offers.filter(o => o.resourceType === resourceType);
    },

    /**
     * Offres appartenant au joueur connecté.
     * Utilise usePlayerStore() dans un getter : acceptable en Pinia
     * (cross-store dans les getters), mais à utiliser avec parcimonie.
     */
    myOffers: (state) => {
      const playerStore = usePlayerStore();
      return state.offers.filter(o => o.owner === playerStore.details?.id);
    },

    /**
     * Meilleur prix disponible pour une ressource donnée (prix minimum).
     * Retourne null si aucune offre n'est disponible (évite les NaN dans l'UI).
     * Filtre les offres à quantity > 0 pour exclure les offres épuisées.
     */
    bestPriceByResource: (state) => (resourceType) => {
      const offers = state.offers.filter(o => o.resourceType === resourceType && o.quantity > 0);
      if (offers.length === 0) return null;
      return Math.min(...offers.map(o => o.unitPrice));
    },

    /**
     * Statistiques de prix pour une ressource : min, max, moyenne, tendance.
     * trend = variation en % entre le premier et le dernier prix de l'historique.
     * Valeur positive = tendance haussière, négative = baissière.
     */
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
        // Tendance = variation % entre le premier et le dernier point d'historique
        trend: prices.length > 1 ? (prices[prices.length - 1] - prices[0]) / prices[0] * 100 : 0
      };
    }
  },

  actions: {
    /**
     * Initialise le store marketplace au montage de l'application.
     *
     * Étapes :
     * 1. S'abonne aux événements broker (ACHAT, OFFRE, OFFRE_SUPPRIMEE)
     *    → les mises à jour temps réel seront automatiques pendant toute la session
     * 2. Tente le chargement initial des offres (cache → API, avec fallback silencieux)
     * 3. Charge l'historique de prix depuis notre backend
     *
     * this.handleBrokerEvent.bind(this) est nécessaire car la méthode sera appelée
     * depuis le brokerStore, hors du contexte du store — bind() garantit que 'this'
     * pointe toujours vers ce store même dans ce contexte externe.
     */
    async init() {
      const brokerStore = useBrokerStore();

      // Abonnement au broker — unsubscribe est stocké pour cleanup dans cleanup()
      this.unsubscribe = brokerStore.subscribe(
        ['ACHAT', 'OFFRE', 'OFFRE_SUPPRIMEE'],
        this.handleBrokerEvent.bind(this)
      );

      // Chargement initial : on tolère l'échec car le broker prendra le relais
      try {
        await this.fetchOffers();
      } catch (err) {
        console.log('[MarketplaceStore] Fetch initial skipped (rate limiting), waiting for broker events');
      }

      // Chargement de l'historique des prix (ne bloque pas si indisponible)
      await this.loadPriceHistory();
    },

    /**
     * Nettoie les abonnements broker lors de la destruction du composant.
     * À appeler dans onUnmounted() pour éviter les listeners zombies.
     */
    cleanup() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    },

    /**
     * Point d'entrée pour les événements broker reçus en temps réel.
     * Pattern "Command Dispatcher" : délègue à un handler spécialisé selon le type.
     *
     * Chaque handler métier est isolé dans sa propre méthode pour la lisibilité
     * et la testabilité. Un snapshot de prix est recalculé après chaque événement.
     *
     * @param {string} eventType - 'OFFRE' | 'ACHAT' | 'OFFRE_SUPPRIMEE'
     * @param {object} data      - Payload de l'événement
     */
    handleBrokerEvent(eventType, data) {
      console.log(`[MarketplaceStore] Event: ${eventType}`, data);

      switch (eventType) {
        case 'OFFRE':
          // Nouvelle offre créée ou mise à jour
          this.handleNewOffer(data);
          break;

        case 'ACHAT':
          // Achat effectué : diminue la quantité disponible ou supprime l'offre
          this.handlePurchase(data);
          break;

        case 'OFFRE_SUPPRIMEE':
          // Offre retirée par son créateur
          this.handleOfferDeleted(data);
          break;
      }

      // Recalcul du snapshot de prix après chaque changement d'état du marché
      this.updatePriceHistory();
    },

    /**
     * Traite une nouvelle offre ou une mise à jour d'offre existante.
     *
     * Normalisation des noms de champs :
     * L'API du jeu envoie 'quantityIn' et 'pricePerResource'.
     * On maintient les deux noms (quantityIn/quantity et pricePerResource/unitPrice)
     * dans l'objet normalisé pour rester compatible avec tous les consommateurs.
     *
     * Logique upsert (insert-or-update) :
     *  - Si l'offre existe déjà (même id) → on met à jour en préservant les champs existants
     *    (un champ à 0 dans l'événement ne doit pas écraser une valeur valide)
     *  - Si l'offre est nouvelle → on l'ajoute au tableau
     *
     * @param {object} data - Données de l'offre depuis le broker
     */
    handleNewOffer(data) {
      if (!data) return;

      // Normalisation : on accepte les deux noms de champs (API jeu et notre convention)
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
        // Mise à jour : on fusionne avec l'existant et on ne remplace que les valeurs non nulles
        const existing = this.offers[existingIndex];
        this.offers[existingIndex] = {
          ...existing,
          resourceType: normalizedData.resourceType || existing.resourceType,
          // On garde l'ancienne quantité si la nouvelle est 0 (sécurité anti-écrasement)
          quantity: normalizedData.quantity > 0 ? normalizedData.quantity : existing.quantity,
          quantityIn: normalizedData.quantityIn > 0 ? normalizedData.quantityIn : existing.quantityIn,
          unitPrice: normalizedData.unitPrice > 0 ? normalizedData.unitPrice : existing.unitPrice,
          pricePerResource: normalizedData.pricePerResource > 0 ? normalizedData.pricePerResource : existing.pricePerResource,
          owner: normalizedData.owner || existing.owner
        };
      } else {
        // Nouvelle offre : ajout en fin de tableau
        this.offers.push(normalizedData);
      }

      this.lastUpdate = new Date().toISOString();
    },

    /**
     * Traite un achat : décrémente la quantité de l'offre achetée.
     * Si la quantité tombe à 0 ou moins, l'offre est supprimée de la liste.
     *
     * Déclenche également un refresh de l'inventaire du joueur car un achat
     * peut modifier ses ressources disponibles (si c'est lui qui a acheté).
     *
     * @param {object} data - { offerId, quantity } identifiant l'achat
     */
    handlePurchase(data) {
      if (!data || !data.offerId) return;

      const offerIndex = this.offers.findIndex(o => o.id === data.offerId);
      if (offerIndex >= 0) {
        const offer = this.offers[offerIndex];
        offer.quantity = Math.max(0, (offer.quantity || 0) - (data.quantity || 0));

        // Suppression automatique si stock épuisé
        if (offer.quantity <= 0) {
          this.offers.splice(offerIndex, 1);
        }
      }

      // Refresh des ressources du joueur car il a peut-être acheté cette offre
      const playerStore = usePlayerStore();
      playerStore.fetchResources();

      this.lastUpdate = new Date().toISOString();
    },

    /**
     * Supprime une offre retirée par son propriétaire.
     *
     * @param {object} data - { id } identifiant l'offre à supprimer
     */
    handleOfferDeleted(data) {
      if (!data || !data.id) return;

      const index = this.offers.findIndex(o => o.id === data.id);
      if (index >= 0) {
        this.offers.splice(index, 1);
      }

      this.lastUpdate = new Date().toISOString();
    },

    /**
     * Charge les offres en cours depuis le backend (cache) ou l'API du jeu (fallback).
     *
     * Stratégie waterfall à deux niveaux :
     *  1. cachedOffersApi (notre backend) → rapide, pas de rate limiting
     *  2. marketplaceApi (API du jeu) → si le cache est indisponible
     *
     * Gestion du rate limiting (TOO_FAST_TOO_FURIOUS) :
     * L'API du jeu bloque les requêtes trop fréquentes. Dans ce cas, on ne crash
     * pas mais on positionne un message informatif : le broker WebSocket prendra
     * le relais pour les mises à jour temps réel.
     */
    async fetchOffers() {
      this.loading = true;
      this.error = null;

      try {
        // Niveau 1 : cache de notre backend
        console.log('[MarketplaceStore] Fetching offers from cache...');
        const response = await cachedOffersApi.getAll();
        console.log('[MarketplaceStore] Cache response:', response.data);
        this.offers = response.data || [];
        this.lastUpdate = new Date().toISOString();
        console.log(`[MarketplaceStore] Loaded ${this.offers.length} offers from cache`);
        this.updatePriceHistory();
      } catch (cacheErr) {
        // Niveau 2 : fallback vers l'API officielle du jeu
        console.log('[MarketplaceStore] Cache unavailable:', cacheErr.message, 'trying external API');

        try {
          const response = await marketplaceApi.getOffers();
          this.offers = response.data || [];
          this.lastUpdate = new Date().toISOString();
          this.updatePriceHistory();
        } catch (err) {
          const errorCode = err.response?.data?.codeError;
          if (errorCode === 'TOO_FAST_TOO_FURIOUS') {
            // Rate limiting détecté → pas de crash, le broker continuera les mises à jour
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

    /**
     * Charge l'historique de prix depuis notre backend.
     * Normalise les noms de champs (l'API retourne 'avg', 'min', 'max', 'count'
     * que l'on renomme en avgPrice, minPrice, maxPrice, offerCount pour cohérence).
     */
    async loadPriceHistory() {
      try {
        const response = await pricesApi.getAll();
        const data = response.data || {};

        const historyByType = {};

        Object.entries(data).forEach(([resourceType, entries]) => {
          if (Array.isArray(entries)) {
            // Normalisation des noms de champs backend → convention interne
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

    /**
     * Calcule et sauvegarde un snapshot de prix pour chaque type de ressource.
     * Appelé automatiquement après chaque modification des offres.
     *
     * Pour chaque ressource :
     *  1. Filtre les offres actives (quantity > 0)
     *  2. Calcule les stats (min, max, moyenne des prix, quantité totale)
     *  3. Ajoute le snapshot à l'historique en mémoire
     *  4. Élague l'historique à 24h glissantes (évite la croissance infinie)
     *
     * Élagage (pruning) : on supprime les entrées datant de plus de 24h.
     * Cela garantit que priceHistory reste de taille raisonnable quelle que soit
     * la durée de la session.
     *
     * Sauvegarde en fire-and-forget : un échec ne bloque pas l'UI.
     */
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

          // Initialisation du tableau d'historique pour ce type si c'est la première fois
          if (!this.priceHistory[type]) {
            this.priceHistory[type] = [];
          }
          this.priceHistory[type].push(snapshot);

          // Élagage : on garde uniquement les 24 dernières heures
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          this.priceHistory[type] = this.priceHistory[type].filter(
            h => new Date(h.timestamp).getTime() > oneDayAgo
          );
        }
      });

      // Sauvegarde batch en fire-and-forget si au moins un snapshot à sauvegarder
      if (snapshots.length > 0) {
        pricesApi.saveBulk(snapshots).catch(err => {
          console.error('[MarketplaceStore] Error saving price history:', err);
        });
      }
    },

    /**
     * Crée une nouvelle offre de vente sur le marketplace.
     *
     * Envoie les champs avec les noms exigés par l'API du jeu
     * (quantityIn et pricePerResource), pas les alias internes.
     *
     * Après succès :
     * 1. Construit l'objet offre complet avec les deux conventions de nommage
     * 2. L'ajoute immédiatement au state local (optimistic update)
     * 3. La sauvegarde dans le cache backend (fire-and-forget)
     *
     * @param {string} resourceType - Type de ressource ('MUSIC', 'ART', etc.)
     * @param {number} quantity     - Quantité à vendre
     * @param {number} unitPrice    - Prix par unité
     * @returns {Promise<object>}   - Données de l'offre créée par l'API
     */
    async createOffer(resourceType, quantity, unitPrice) {
      try {
        // Payload avec les noms de champs officiels de l'API du jeu
        const payload = {
          resourceType,
          quantityIn: quantity,       // Nom exigé par l'API (pas 'quantity')
          pricePerResource: unitPrice // Nom exigé par l'API (pas 'unitPrice')
        };
        console.log('[MarketplaceStore] Creating offer with payload:', payload);
        const response = await marketplaceApi.createOffer(payload);
        console.log('[MarketplaceStore] Create offer response:', response.data);

        if (response.data && response.data.id) {
          const playerStore = usePlayerStore();

          // Construction de l'objet offre avec les deux conventions de nommage
          const newOffer = {
            id: response.data.id,
            owner: playerStore.details?.id || null,
            resourceType,
            quantity,           // Convention interne
            quantityIn: quantity, // Convention API jeu
            unitPrice,            // Convention interne
            pricePerResource: unitPrice // Convention API jeu
          };

          console.log('[MarketplaceStore] Adding offer locally:', newOffer);
          this.offers.push(newOffer);
          this.lastUpdate = new Date().toISOString();
          console.log('[MarketplaceStore] Total offers now:', this.offers.length, this.offers);

          // Mise en cache dans notre backend (fire-and-forget, non bloquant)
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

    /**
     * Met à jour une offre existante (quantité et/ou prix).
     * Synchronise l'état local ET le cache backend après succès.
     */
    async updateOffer(offerId, quantity, unitPrice) {
      try {
        const response = await marketplaceApi.updateOffer(offerId, {
          quantityIn: quantity,
          pricePerResource: unitPrice
        });

        // Mise à jour locale avec les deux noms de champs
        const offerIndex = this.offers.findIndex(o => o.id === offerId);
        if (offerIndex >= 0) {
          this.offers[offerIndex].quantity = quantity;
          this.offers[offerIndex].quantityIn = quantity;
          this.offers[offerIndex].unitPrice = unitPrice;
          this.offers[offerIndex].pricePerResource = unitPrice;
          this.lastUpdate = new Date().toISOString();

          // Mise à jour du cache backend (fire-and-forget)
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

    /** Supprime une offre via l'API. La mise à jour locale viendra via le broker (OFFRE_SUPPRIMEE). */
    async deleteOffer(offerId) {
      try {
        await marketplaceApi.deleteOffer(offerId);
      } catch (err) {
        throw err;
      }
    },

    /** Achète une quantité d'une offre. La mise à jour locale viendra via le broker (ACHAT). */
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

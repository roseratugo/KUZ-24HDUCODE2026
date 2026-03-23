/**
 * @file stores/player.js
 * @description Store Pinia pour les données du joueur connecté.
 *
 * Ce store est le point central des informations du joueur :
 * profil (nom, argent, quotient), îles découvertes, marketplace débloquée,
 * et inventaire de ressources.
 *
 * Responsabilités clés :
 *  - fetchDetails : récupère le profil complet ET synchronise les stores enfants
 *    (shipStore pour les points de mouvement, mapStore pour les états d'îles)
 *  - fetchResources : récupère l'inventaire de ressources séparément
 *  - refreshAll : lance les deux en parallèle (optimisation réseau)
 *
 * Ce store est appelé en polling toutes les 5 secondes depuis l'application
 * pour maintenir les données à jour sans WebSocket dédié.
 */

import { defineStore } from 'pinia';
import { playerApi } from '../api/client';
// Imports différés des autres stores : on les appelle à l'intérieur des actions
// et non au niveau module pour éviter les dépendances circulaires entre stores Pinia.
import { useShipStore } from './ship';
import { useMapStore } from './map';

export const usePlayerStore = defineStore('player', {
  /**
   * État initial du store.
   * details contient le profil complet renvoyé par l'API du jeu.
   * resources est un tableau de { type, quantity }.
   */
  state: () => ({
    details: null,      // Profil complet du joueur (null avant le premier fetch)
    resources: [],      // Inventaire courant de ressources
    loading: false,     // Indicateur de chargement pour l'UI
    error: null         // Dernier message d'erreur (null = pas d'erreur)
  }),

  /**
   * Getters : état dérivé calculé à partir du state.
   * Pattern : les getters Pinia sont l'équivalent des computed Vue —
   * ils sont mis en cache et recalculés uniquement quand leurs dépendances changent.
   * Cela évite de recalculer à la main dans chaque composant.
   */
  getters: {
    // Nom du joueur avec valeur par défaut lisible si non chargé
    playerName: (state) => state.details?.name || 'Non connecte',

    // Argent disponible (0 par défaut pour éviter les undefined dans les calculs)
    money: (state) => state.details?.money || 0,

    // Quotient : score/réputation du joueur dans le jeu
    quotient: (state) => state.details?.quotient || 0,

    // Île de départ/maison du joueur
    homeIsland: (state) => state.details?.home || null,

    // Liste des îles déjà découvertes (avec leur état de connaissance)
    discoveredIslands: (state) => state.details?.discoveredIslands || [],

    // Booléen : le joueur a-t-il débloqué l'accès au marketplace ?
    marketPlaceDiscovered: (state) => state.details?.marketPlaceDiscovered || false,

    /**
     * Getter paramétré (curried) : retourne la quantité d'une ressource par type.
     * Usage dans un composant : playerStore.resourceByType('MUSIC')
     * Pattern courant en Pinia pour les getters qui nécessitent un argument.
     */
    resourceByType: (state) => (type) => {
      return state.resources.find(r => r.type === type)?.quantity || 0;
    }
  },

  actions: {
    /**
     * Récupère le profil complet du joueur depuis l'API du jeu.
     *
     * Cette action fait plus que charger des données : elle orchestre
     * la synchronisation inter-stores (cross-store communication) :
     *
     * 1. Si l'API renvoie des données de navire → on met à jour shipStore
     *    (points de mouvement disponibles, vitesse, cooldown en cours)
     *
     * 2. Si l'API renvoie des îles découvertes → on s'assure que mapStore
     *    est chargé depuis la DB, puis on synchronise les états d'îles
     *    (une île peut passer à 'KNOWN' si le jeu l'indique)
     *
     * Ce couplage léger entre stores évite d'avoir à déclencher plusieurs
     * actions manuellement depuis les composants.
     */
    async fetchDetails() {
      this.error = null;
      try {
        const response = await playerApi.getDetails();
        this.details = response.data;

        // Synchronisation avec le store du navire si l'API renvoie l'état du navire
        if (response.data.ship) {
          const shipStore = useShipStore();
          // updateFromPlayerDetails gère la réconciliation avec l'état local
          // (localStorage, cooldown en cours, etc.)
          shipStore.updateFromPlayerDetails(response.data.ship);
        }

        // Synchronisation des états d'îles avec le store de carte
        if (response.data.discoveredIslands?.length) {
          const mapStore = useMapStore();

          // Chargement paresseux (lazy load) de la carte :
          // si le store de carte est vide, on charge depuis la DB avant de synchroniser.
          // Évite de faire un double chargement si la carte est déjà en mémoire.
          if (mapStore.islands.size === 0) {
            await mapStore.loadFromDB();
          }

          // Propage les états d'îles du jeu vers notre base de données locale
          await mapStore.syncIslandStates(response.data.discoveredIslands);
        }
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors du chargement des details';
        console.error('Error fetching player details:', err);
      }
    },

    /**
     * Récupère l'inventaire de ressources du joueur.
     * Séparé de fetchDetails car l'inventaire change plus souvent
     * (achats, ventes en temps réel via le marketplace).
     */
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

    /**
     * Lance fetchDetails et fetchResources en parallèle.
     *
     * Pattern : Promise.all() — les deux requêtes HTTP sont envoyées simultanément.
     * Le temps total est celui de la plus lente, et non la somme des deux.
     * Exemple : si chaque appel prend 200ms, refreshAll prend ~200ms et non ~400ms.
     *
     * C'est la méthode recommandée pour le polling toutes les 5 secondes.
     */
    async refreshAll() {
      await Promise.all([
        this.fetchDetails(),
        this.fetchResources()
      ]);
    }
  }
});

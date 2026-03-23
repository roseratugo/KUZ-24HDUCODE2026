/**
 * @file stores/map.js
 * @description Store Pinia pour la gestion de la carte du jeu.
 *
 * Ce store maintient la représentation en mémoire de toutes les cellules
 * et îles explorées, ainsi que la position actuelle du navire.
 *
 * Structure de données centrale :
 * Les cellules sont stockées dans une Map() JavaScript (et non un tableau)
 * avec pour clé la chaîne "x,y". Cette structure offre :
 *  - Accès en O(1) par coordonnées (vs O(n) pour un tableau)
 *  - Déduplication automatique (même clé = même cellule)
 *  - Itération native avec .values(), .keys(), .entries()
 *
 * Système de poids d'état (State Weight System) :
 * Chaque cellule a un état de connaissance : VISITED < SEEN < KNOWN.
 * Le poids empêche la dégradation d'état : une cellule VISITED ne peut pas
 * redevenir SEEN. C'est crucial pour ne pas perdre l'information
 * que le navire est passé sur une cellule.
 *
 * WebSocket temps réel :
 * Une connexion WebSocket vers /ws reçoit les mises à jour de carte en temps réel
 * (cells:update, island:update, ship:position). Auto-reconnexion après 3 secondes.
 * La variable ws est externe au store (module-level) pour éviter que Pinia
 * ne la rende réactive (un WebSocket n'est pas un objet réactif).
 *
 * Couplage inter-stores :
 * syncIslandStates() est appelée depuis playerStore.fetchDetails() pour propager
 * les états d'îles connus de l'API du jeu vers notre base de données locale.
 */

import { defineStore } from 'pinia';
import { cellsApi, islandsApi, statsApi } from '../api/mapApi';

/**
 * Instance WebSocket externe au store.
 * Intentionnellement hors du state Pinia : Pinia rendrait l'objet réactif (Proxy),
 * ce qui est incompatible avec WebSocket (les Proxies cassent les objets natifs).
 * Ce pattern "external reference" contourne cette limitation.
 */
let ws = null;

/**
 * Timer de reconnexion WebSocket (setTimeout).
 * Également externe au store pour les mêmes raisons (pas besoin de réactivité).
 * Stocké ici pour pouvoir l'annuler lors d'une déconnexion volontaire.
 */
let reconnectTimer = null;

export const useMapStore = defineStore('map', {
  /**
   * State : utilise Map() JavaScript (et non des objets React ou tableaux)
   * pour des performances O(1) en lecture/écriture par coordonnées.
   */
  state: () => ({
    /**
     * Map des cellules : clé "x,y" → objet cellule { x, y, type, zone, island, state }
     * Exemple : cells.get("3,-2") → { x: 3, y: -2, type: 'SEA', state: 'SEEN', ... }
     */
    cells: new Map(),

    /**
     * Map des îles : clé islandId → objet île { islandId, name, bonusQuotient, state, cells[] }
     */
    islands: new Map(),

    shipPosition: null,   // Coordonnées actuelles du navire {x, y, type, zone}
    viewSettings: {
      zoom: 1,
      centerX: 0,
      centerY: 0
    },
    stats: null,          // Statistiques globales de notre backend
    loading: false,
    syncing: false,       // true pendant une synchronisation vers la DB
    lastSync: null,       // Timestamp de la dernière synchronisation réussie
    error: null,
    wsConnected: false    // Reflet de l'état de la connexion WebSocket
  }),

  getters: {
    /**
     * Convertit la Map en tableau pour l'itération dans les templates Vue.
     * Les templates Vue ne peuvent pas itérer directement sur une Map().
     */
    allCells: (state) => Array.from(state.cells.values()),

    /**
     * Calcule les limites géographiques de la carte pour le rendu.
     * Ajoute une marge de 2 cellules autour des extrêmes pour
     * ne pas avoir la carte collée aux bords du canvas.
     * Valeurs par défaut (-5, 5) si aucune cellule n'est connue.
     */
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

    /**
     * Getter paramétré pour accéder à une cellule par ses coordonnées.
     * Exploite la Map pour un accès O(1) : getCellAt(3, -2) → cellule ou null.
     * La clé "x,y" doit être cohérente avec celle utilisée dans addCells().
     */
    getCellAt: (state) => (x, y) => {
      return state.cells.get(`${x},${y}`) || null;
    },

    /**
     * Filtre les cellules de type SAND (terrain d'île).
     * Utilisé par le composant de carte pour afficher les îles différemment.
     */
    islandCells: (state) => {
      return Array.from(state.cells.values()).filter(c => c.type === 'SAND');
    },

    cellCount: (state) => state.cells.size,
    islandCount: (state) => state.islands.size
  },

  actions: {
    /**
     * Charge la carte depuis notre backend (cellules + îles en parallèle).
     * Promise.all() optimise en lançant les deux requêtes simultanément.
     *
     * Reconstruction des Maps à partir des tableaux JSON :
     * JSON ne peut pas sérialiser une Map nativement → on reçoit des tableaux
     * et on reconstruit les Maps en parcourant les données.
     */
    async loadFromDB() {
      this.loading = true;
      this.error = null;
      try {
        // Chargement parallèle des cellules et des îles
        const [cellsRes, islandsRes] = await Promise.all([
          cellsApi.getAll(),
          islandsApi.getAll()
        ]);

        // Reconstruction de la Map des cellules depuis le tableau JSON
        this.cells.clear();
        cellsRes.data.forEach(cell => {
          const key = `${cell.x},${cell.y}`;   // Clé normalisée "x,y"
          this.cells.set(key, cell);
        });

        // Reconstruction de la Map des îles (indexées par islandId)
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

    /**
     * Ajoute des cellules à la carte en respectant le système de poids d'état.
     *
     * Règle du poids d'état (State Weight System) :
     * Une cellule ne peut PAS rétrograder vers un état de moindre connaissance.
     * Poids : VISITED(1) < SEEN(2) < KNOWN(3)
     *
     * Exemples :
     *  - SEEN sur une cellule VISITED → autorisé (le navire l'a vue de plus près)
     *  - SEEN sur une cellule KNOWN  → refusé (on sait déjà plus que ça)
     *  - VISITED sur une cellule SEEN → refusé (on ne "désapprend" pas)
     *
     * Si la cellule appartient à une île, on enregistre l'île via addIsland().
     * Les nouvelles cellules déclenchent une synchronisation vers la DB.
     *
     * @param {object[]} cells - Tableau de cellules { x, y, type, zone, island? }
     * @param {string}   state - 'SEEN' | 'VISITED' | 'KNOWN'
     */
    async addCells(cells, state = 'SEEN') {
      const newCells = [];

      cells.forEach(cell => {
        const key = `${cell.x},${cell.y}`;
        const existing = this.cells.get(key);

        // On met à jour uniquement si c'est une nouvelle cellule
        // OU si le nouvel état est plus informatif que l'état actuel
        if (!existing || this.getStateWeight(state) > this.getStateWeight(existing.state)) {
          const cellData = {
            ...cell,
            state,
            // Préserve la date de première découverte si la cellule existe déjà
            discoveredAt: existing?.discoveredAt || new Date().toISOString()
          };
          this.cells.set(key, cellData);
          newCells.push(cellData);

          // Si la cellule appartient à une île, on enregistre/met à jour l'île
          if (cell.island) {
            this.addIsland(cell.island, cell);
          }
        }
      });

      // Synchronisation en batch vers la DB (seulement si de nouvelles cellules)
      if (newCells.length > 0) {
        this.syncToDB(newCells);
      }
    },

    /**
     * Enregistre une île découverte et l'associe à une cellule.
     *
     * Logique d'upsert pour l'île :
     *  - Nouvelle île (id absent de la Map) → ajout en mémoire + sauvegarde en DB
     *  - Île existante → pas de recréation, on ajoute juste la cellule si nouvelle
     *
     * La déduplication des cellules par (x, y) évite les doublons
     * si addIsland est appelé plusieurs fois pour la même cellule.
     *
     * @param {object} island - { id, name, bonusQuotient }
     * @param {object} cell   - Cellule associée { x, y, id }
     */
    async addIsland(island, cell) {
      if (!this.islands.has(island.id)) {
        // Première découverte de cette île : on l'ajoute avec l'état initial
        this.islands.set(island.id, {
          islandId: island.id,
          name: island.name,
          bonusQuotient: island.bonusQuotient,
          state: 'DISCOVERED',
          cells: []
        });

        try {
          await islandsApi.save(island);
        } catch (err) {
          console.error('Failed to save island:', err);
        }
      }

      // Ajout de la cellule à l'île si elle n'y est pas déjà
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

    /**
     * Synchronise un lot de cellules vers notre backend.
     * Utilisé en interne après addCells(). syncing flag = indicateur UI.
     *
     * @param {object[]} cells - Cellules à persister
     */
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

    /**
     * Retourne le poids numérique d'un état de cellule.
     * Permet de comparer deux états pour décider si une mise à jour est autorisée.
     *
     * Hiérarchie :
     *  VISITED (1) : le navire est passé ici (connaissance basique)
     *  SEEN    (2) : le navire a vu cette cellule (dans son champ de vision)
     *  KNOWN   (3) : connaissance complète (île explorée, informations détaillées)
     *
     * Un état inconnu retourne 0 (sera toujours remplacé).
     *
     * @param {string} state - État à évaluer
     * @returns {number} Poids (0, 1, 2 ou 3)
     */
    getStateWeight(state) {
      const weights = { 'VISITED': 1, 'SEEN': 2, 'KNOWN': 3 };
      return weights[state] || 0;
    },

    /**
     * Met à jour la position du navire et marque sa cellule comme KNOWN.
     * La cellule de la position du navire est toujours la mieux connue (KNOWN).
     */
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

    /** Zoom clampé entre 0.5 et 3 pour éviter des vues inutilisables. */
    setZoom(zoom) {
      this.viewSettings.zoom = Math.max(0.5, Math.min(3, zoom));
    },

    /** Centre la vue sur le navire (raccourci UI). */
    centerOnShip() {
      if (this.shipPosition) {
        this.setViewCenter(this.shipPosition.x, this.shipPosition.y);
      }
    },

    /**
     * Synchronise les états d'îles entre l'API du jeu et notre backend.
     * Appelée depuis playerStore.fetchDetails() (cross-store communication).
     *
     * Le jeu API renvoie dans discoveredIslands l'état de connaissance
     * de chaque île ({island, islandState}). On ne traite que les îles KNOWN
     * (état maximal) pour éviter les régressions d'état.
     *
     * Recherche par nom (et non par id) car l'API du jeu et notre DB peuvent
     * avoir des identifiants différents pour la même île.
     *
     * @param {object[]} discoveredIslands - Tableau { island: {name}, islandState } de l'API jeu
     */
    async syncIslandStates(discoveredIslands) {
      for (const { island, islandState } of discoveredIslands) {
        // On ne traite que les îles complètement connues
        if (islandState !== 'KNOWN') continue;

        // Recherche de l'île dans notre store par son nom (cross-référencement)
        const localIsland = Array.from(this.islands.values()).find(i => i.name === island.name);

        if (localIsland && localIsland.state !== 'KNOWN') {
          // Mise à jour en mémoire immédiate, puis persistance en DB
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
    },

    /**
     * Établit la connexion WebSocket vers notre backend pour les mises à jour temps réel.
     *
     * Garde : si une connexion existe déjà, on ne crée pas de doublon.
     * La variable ws est externe au store (module-level) pour éviter que Pinia
     * ne la rende réactive (cf. commentaire en haut du fichier).
     *
     * Trois types d'événements reçus :
     *  - cells:update  : nouvelles cellules vues par un autre utilisateur (même équipe)
     *  - island:update : mise à jour d'une île (nom, état, cellules)
     *  - ship:position : position du navire mise à jour (depuis un autre onglet)
     *
     * Auto-reconnexion après 3 secondes en cas de coupure.
     * onclose → ws = null → reconnectTimer → connectWebSocket()
     */
    connectWebSocket() {
      // Évite les doublons de connexion
      if (ws) return;

      // Adaptation du protocole HTTP/HTTPS → WS/WSS
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;

      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('WebSocket connected');
        this.wsConnected = true;
        // Annule le timer de reconnexion s'il était en cours
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          // Déstructuration du message : { event: nom de l'événement, data: payload }
          const { event: evt, data } = JSON.parse(event.data);

          // Mise à jour de cellules reçues en temps réel depuis le backend
          if (evt === 'cells:update' && data.cells) {
            data.cells.forEach(cell => {
              const key = `${cell.x},${cell.y}`;
              const existing = this.cells.get(key);
              // On n'écrase pas les cellules déjà connues par le WebSocket
              // (le state local peut être plus riche que ce que le WS envoie)
              if (!existing) {
                this.cells.set(key, { ...cell, state: 'SEEN' });
              }
            });
          }

          // Mise à jour ou ajout d'une île reçue en temps réel
          if (evt === 'island:update' && data.island) {
            const island = data.island;
            this.islands.set(island.islandId, island);
          }

          // Mise à jour de la position du navire depuis un autre onglet/session
          if (evt === 'ship:position' && data.position) {
            this.shipPosition = data.position;
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 3s...');
        this.wsConnected = false;
        ws = null;
        // Planification de la reconnexion dans 3 secondes
        reconnectTimer = setTimeout(() => this.connectWebSocket(), 3000);
      };

      ws.onerror = () => {
        // En cas d'erreur, on ferme le socket → onclose prendra le relais pour la reconnexion
        ws?.close();
      };
    },

    /**
     * Ferme la connexion WebSocket et annule la reconnexion automatique.
     * À appeler lors de la déconnexion de l'utilisateur ou du démontage de l'app.
     */
    disconnectWebSocket() {
      // Annulation de tout timer de reconnexion en attente
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      this.wsConnected = false;
    }
  }
});

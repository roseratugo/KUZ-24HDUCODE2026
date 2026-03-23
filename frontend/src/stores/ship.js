/**
 * @file stores/ship.js
 * @description Store Pinia pour la gestion du navire du joueur.
 *
 * Ce store gère tout ce qui concerne le navire :
 *  - Position sur la carte
 *  - Énergie (points de mouvement disponibles / max)
 *  - Niveau du navire (vitesse, portée de vision)
 *  - Historique des déplacements
 *  - Système de cooldown entre deux déplacements
 *
 * Particularité importante : PERSISTANCE via localStorage.
 * La position, l'énergie, le niveau et le timestamp du dernier mouvement
 * sont sauvegardés dans localStorage à chaque modification.
 * Au rechargement de la page, l'état est restauré sans appel réseau.
 * Cela évite l'effet "position perdue" à chaque refresh.
 *
 * Double persistance : localStorage (rapide, côté client)
 *                    + backend DB (via mapApi, pour partage entre membres d'équipe)
 */

import { defineStore } from 'pinia';
import { shipApi } from '../api/client';
import { movesApi, shipPositionApi } from '../api/mapApi';

/** Clé utilisée pour le stockage dans localStorage. Constante pour éviter les typos. */
const STORAGE_KEY = 'kuz-ship-state';

/**
 * Charge l'état du navire depuis localStorage.
 * Encapsulé dans un try/catch car localStorage peut échouer :
 *  - En navigation privée sur certains navigateurs
 *  - Si le stockage est plein
 *  - Si les données sont corrompues (JSON invalide)
 *
 * @returns {object|null} L'état sauvegardé, ou null si absent/corrompu
 */
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

/**
 * Sauvegarde un sous-ensemble de l'état dans localStorage.
 * On ne sauvegarde que les champs pertinents à restaurer (pas loading, error, etc.).
 * lastUpdate horodate la sauvegarde pour détecter les données périmées si besoin.
 *
 * @param {object} state - L'état courant du store
 */
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
  /**
   * Initialisation de l'état avec restauration depuis localStorage.
   * Le pattern `saved?.field || default` applique les valeurs sauvegardées
   * si elles existent, sinon utilise les valeurs par défaut.
   *
   * Note : ?? (nullish coalescing) est préféré à || pour les valeurs numériques
   * car 0 est une valeur valide (energy: 0 ne doit pas déclencher le fallback).
   */
  state: () => {
    // Tentative de restauration depuis localStorage au démarrage
    const saved = loadFromStorage();
    return {
      ship: null,                          // Objet navire brut de l'API (après construction)
      position: saved?.position || null,   // Coordonnées {x, y, type, zone} restaurées
      energy: saved?.energy ?? 0,          // Points de mouvement disponibles (0 est valide)
      maxEnergy: saved?.maxEnergy ?? 100,  // Maximum selon le niveau du navire
      // Niveau par défaut avec visibilityRange et speed pour éviter les accès null
      shipLevel: saved?.shipLevel || { name: 'Inconnu', visibilityRange: 1, speed: 5000 },
      discoveredCells: [],                 // Cellules découvertes lors du dernier mouvement
      loading: false,
      error: null,
      moveHistory: [],                     // Historique en mémoire (rechargé depuis DB)
      lastUpdate: saved?.lastUpdate || null,
      lastMoveAt: saved?.lastMoveAt || null,  // Timestamp du dernier mouvement (pour cooldown)
      cooldownRemaining: 0                    // Millisecondes restantes avant prochain mouvement
    };
  },

  /**
   * Getters : état dérivé calculé.
   * Chaque getter est un raccourci lisible pour les composants,
   * et évite de dupliquer la logique de calcul partout dans l'UI.
   */
  getters: {
    currentPosition: (state) => state.position,
    availableEnergy: (state) => state.energy,

    // Le joueur a un navire si l'objet ship existe OU si une position est connue
    // (le navire peut être connu via localStorage sans avoir rechargé l'objet complet)
    hasShip: (state) => state.ship !== null || state.position !== null,

    lastDiscoveredCells: (state) => state.discoveredCells,

    // Pourcentage d'énergie pour les barres de progression dans l'UI
    energyPercent: (state) => {
      if (!state.maxEnergy) return 0;
      return Math.round((state.energy / state.maxEnergy) * 100);
    },

    // Booléen pratique pour désactiver le bouton de déplacement
    isOnCooldown: (state) => state.cooldownRemaining > 0,

    // Arrondi vers le haut : affiche "1s" même s'il reste 100ms
    cooldownSeconds: (state) => Math.ceil(state.cooldownRemaining / 1000),

    // Vitesse en millisecondes (durée du cooldown = durée d'un déplacement)
    shipSpeed: (state) => state.shipLevel?.speed || 5000
  },

  actions: {
    /**
     * Construit le navire via l'API du jeu.
     * Met à jour le state complet et persiste dans localStorage.
     */
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
        // Persistance immédiate après construction
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

    /**
     * Déplace le navire dans une direction.
     *
     * Stratégie "optimistic update" partielle :
     * Le cooldown est déclenché IMMÉDIATEMENT (avant la réponse API) pour rendre
     * l'interface réactive. La position et l'énergie sont mises à jour à la réception
     * de la réponse (source de vérité = serveur du jeu).
     *
     * Double sauvegarde après un déplacement réussi :
     *  1. localStorage → restauration rapide au rechargement
     *  2. movesApi.save() → historique persistant dans notre DB (fire-and-forget)
     *  3. shipPositionApi.save() → dernière position dans notre DB (fire-and-forget)
     *
     * Les appels DB sont fire-and-forget (.catch sans await) :
     * un échec de persistance ne bloque pas l'expérience de jeu.
     *
     * @param {string} direction - 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'
     */
    async move(direction) {
      // Garde : on ne peut pas bouger si le cooldown est encore actif
      if (this.cooldownRemaining > 0) return;

      this.error = null;
      const speed = this.shipLevel?.speed || 5000;

      // Snapshot de la position avant mouvement (pour l'enregistrement historique)
      const fromPosition = this.position ? { ...this.position } : null;
      const energyBefore = this.energy;

      // Démarrage du cooldown AVANT la réponse API : l'UI est bloquée immédiatement
      this.lastMoveAt = new Date().toISOString();
      this.cooldownRemaining = speed;
      this.startCooldownTimer();

      try {
        const response = await shipApi.move(direction);
        const data = response.data;

        // Mise à jour de l'état avec la réponse authoritative du serveur
        this.position = data.position;
        this.energy = data.energy;
        this.discoveredCells = data.discoveredCells || [];
        this.lastUpdate = new Date().toISOString();

        // Construction de l'enregistrement de mouvement pour l'historique
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

        // Fire-and-forget : on ne bloque pas l'UI sur la persistance DB
        movesApi.save(moveRecord).catch(err => {
          console.error('Failed to save move to DB:', err);
        });

        if (data.position) {
          shipPositionApi.save(data.position).catch(err => {
            console.error('Failed to save ship position to DB:', err);
          });
        }

        // Persistance locale après chaque mouvement réussi
        saveToStorage(this);

        return data;
      } catch (err) {
        this.error = err.response?.data?.message || 'Erreur lors du deplacement';
        console.error('Error moving ship:', err);
        throw err;
      }
    },

    /**
     * Charge l'historique des mouvements depuis notre backend.
     * .reverse() car l'API retourne du plus ancien au plus récent,
     * mais l'UI affiche du plus récent au plus ancien.
     */
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

    /**
     * Lance le timer de décompte du cooldown.
     *
     * Pattern : setInterval toutes les 100ms décrémente cooldownRemaining.
     * Pourquoi 100ms ? C'est suffisamment précis pour l'affichage (pas besoin du ms)
     * tout en évitant la surcharge de 1000 appels/seconde.
     *
     * L'intervalle se supprime lui-même quand cooldownRemaining atteint 0,
     * évitant les fuites mémoire (memory leaks).
     */
    startCooldownTimer() {
      const interval = setInterval(() => {
        // Math.max(0, ...) empêche les valeurs négatives
        this.cooldownRemaining = Math.max(0, this.cooldownRemaining - 100);
        if (this.cooldownRemaining <= 0) {
          clearInterval(interval);
        }
      }, 100);
    },

    /**
     * Restaure un cooldown en cours après rechargement de page.
     *
     * Problème résolu : si l'utilisateur recharge la page pendant un cooldown,
     * le timer JavaScript est perdu. Cette méthode calcule le temps écoulé
     * depuis le dernier mouvement (stocké dans localStorage via lastMoveAt)
     * et redémarre le timer pour la durée restante.
     *
     * À appeler au montage de l'application, après loadFromStorage().
     */
    checkAndRestoreCooldown() {
      if (this.lastMoveAt) {
        const elapsed = Date.now() - new Date(this.lastMoveAt).getTime();
        const speed = this.shipLevel?.speed || 5000;
        const remaining = speed - elapsed;

        // Ne restaure le timer que si le cooldown n'est pas déjà expiré
        if (remaining > 0) {
          this.cooldownRemaining = remaining;
          this.startCooldownTimer();
        }
      }
    },

    /**
     * Met à jour l'état depuis une réponse de déplacement (usage externe si besoin).
     * Toujours suivi d'une sauvegarde localStorage.
     */
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

    /**
     * Synchronise l'état du navire avec les données du polling /players/details.
     * Appelé toutes les 5 secondes par playerStore.fetchDetails().
     *
     * Logique de réconciliation pour le cooldown :
     * L'API peut renvoyer un lastMoveAt plus récent que notre valeur locale
     * (ex: mouvement effectué depuis un autre onglet ou par un coéquipier).
     * Dans ce cas, on démarre un nouveau cooldown basé sur la date API,
     * mais seulement si aucun cooldown local n'est déjà actif.
     *
     * @param {object} shipData - Données du navire issues de /players/details
     */
    updateFromPlayerDetails(shipData) {
      // availableMove = points de mouvement restants selon l'API
      if (shipData.availableMove !== undefined) {
        this.energy = shipData.availableMove;
      }

      // Mise à jour du niveau → recalcul de maxEnergy
      if (shipData.level) {
        this.shipLevel = shipData.level;
        this.maxEnergy = shipData.level.maxMovement || 15;
      }

      // Réconciliation du cooldown : on prend le lastMoveAt le plus récent
      if (shipData.lastMoveAt) {
        const apiLastMove = new Date(shipData.lastMoveAt).getTime();
        const localLastMove = this.lastMoveAt ? new Date(this.lastMoveAt).getTime() : 0;

        // L'API est plus récente que notre état local → un mouvement a eu lieu ailleurs
        if (apiLastMove > localLastMove) {
          this.lastMoveAt = shipData.lastMoveAt;
          const elapsed = Date.now() - apiLastMove;
          const speed = shipData.level?.speed || 5000;
          const remaining = speed - elapsed;

          // On démarre le timer seulement si le cooldown local est déjà terminé
          // (évite de réinitialiser un cooldown en cours causé par notre propre mouvement)
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

    /**
     * Vide l'historique en mémoire ET dans notre backend.
     * Fire-and-forget pour la suppression en DB.
     */
    clearHistory() {
      this.moveHistory = [];
      movesApi.clearAll().catch(err => {
        console.error('Failed to clear move history from DB:', err);
      });
    },

    /**
     * Charge la dernière position connue depuis notre backend.
     * Utile si localStorage est vide (nouvelle session, autre navigateur).
     * Ignore silencieusement les erreurs 404 (position jamais sauvegardée).
     */
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
        // 404 = aucune position sauvegardée → pas une erreur à signaler
        if (err.response?.status !== 404) {
          console.error('Failed to load ship position from DB:', err);
        }
      }
    },

    /**
     * Remet le store à zéro (nouvelle partie ou déconnexion).
     * Supprime la clé localStorage pour éviter de restaurer un ancien état.
     */
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

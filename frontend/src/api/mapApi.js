/**
 * @file mapApi.js
 * @description Client HTTP Axios pour NOTRE propre backend (API interne).
 *
 * Ce fichier est distinct de client.js : là où client.js parle à l'API officielle
 * du JEU (CodingGame, externe), mapApi.js parle à notre serveur Node/Express maison
 * qui sert de base de données persistante et de cache pour notre équipe.
 *
 * Notre backend expose des routes pour :
 *  - Sauvegarder et recharger la carte explorée (cellules, îles)
 *  - Historiser les déplacements du navire
 *  - Mémoriser la dernière position connue du navire
 *  - Stocker l'historique de prix du marketplace
 *  - Mettre en cache nos propres offres de vente
 *
 * Le GAME_ID isole les données par partie : on peut changer de partie
 * sans mélanger les données en base.
 */

import axios from 'axios';

/**
 * Identifiant de la partie en cours, lu depuis les variables d'environnement Vite.
 * VITE_GAME_ID est défini dans le fichier .env du frontend.
 * La valeur par défaut 'kuz-default' évite les crashes en dev si la variable est absente.
 *
 * Pattern : "Configuration par variable d'environnement" — les secrets et paramètres
 * d'environnement ne doivent jamais être écrits en dur dans le code source.
 */
const GAME_ID = import.meta.env.VITE_GAME_ID || 'kuz-default';

/**
 * Instance Axios dédiée à notre backend.
 * La baseURL /backend-api est proxifiée par Vite (en dev) ou Nginx (en prod)
 * vers notre serveur interne — ce préfixe évite les conflits CORS
 * et le besoin d'un deuxième port en développement.
 *
 * Contrairement à apiClient (client.js), pas de header codinggame-id ici :
 * notre backend ne requiert pas d'authentification par clé d'équipe.
 */
const mapClient = axios.create({
  baseURL: '/backend-api',
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Module d'API — Domaine : Cellules de carte
 * Gère la persistance des cellules de carte explorées.
 * Le gameId est toujours passé en paramètre pour isoler les données par partie.
 *
 * saveBulk normalise le format des cellules : on n'envoie que les champs
 * pertinents pour la base (x, y, type, zone, island), pas les métadonnées
 * locales comme discoveredAt ou state.
 */
export const cellsApi = {
  // Charge toutes les cellules connues pour cette partie
  getAll: () => mapClient.get(`/cells?gameId=${GAME_ID}`),

  // Récupère les bornes géographiques de la carte (pour le rendu)
  getBounds: () => mapClient.get(`/cells/bounds?gameId=${GAME_ID}`),

  // Sauvegarde un lot de cellules en une seule requête (plus efficace que N appels individuels)
  saveBulk: (cells) => mapClient.post('/cells/bulk', {
    gameId: GAME_ID,
    // Normalisation : on projette chaque cellule vers le format attendu par l'API
    cells: cells.map(c => ({
      x: c.x,
      y: c.y,
      type: c.type,
      zone: c.zone,
      island: c.island || null
    }))
  }),

  // Met à jour l'état de visibilité de plusieurs cellules d'un coup (SEEN, VISITED, KNOWN)
  updateState: (cells, state) => mapClient.patch('/cells/state', {
    gameId: GAME_ID,
    // On n'envoie que les coordonnées + le nouvel état commun, pas toute la cellule
    cells: cells.map(c => ({ x: c.x, y: c.y })),
    state
  }),

  // Supprime toutes les cellules de la partie (reset de carte)
  clearAll: () => mapClient.delete(`/cells?gameId=${GAME_ID}`)
};

/**
 * Module d'API — Domaine : Îles
 * Les îles sont des entités de premier niveau associées à des cellules de type SAND.
 * Elles ont leur propre état (DISCOVERED, KNOWN) et peuvent contenir un bonus de quotient.
 */
export const islandsApi = {
  getAll: () => mapClient.get(`/islands?gameId=${GAME_ID}`),

  // Sauvegarde une nouvelle île découverte avec ses métadonnées
  save: (island) => mapClient.post('/islands', {
    gameId: GAME_ID,
    island
  }),

  // Associe une cellule à une île (relation N-N stockée côté backend)
  addCell: (islandId, cell) => mapClient.post('/islands/add-cell', {
    gameId: GAME_ID,
    islandId,
    cell
  }),

  // Met à jour l'état de connaissance d'une île (progression dans le jeu)
  updateState: (islandId, state) => mapClient.patch(`/islands/${islandId}/state`, {
    gameId: GAME_ID,
    state
  }),

  clearAll: () => mapClient.delete(`/islands?gameId=${GAME_ID}`)
};

/**
 * Module d'API — Domaine : Déplacements
 * Historise chaque mouvement du navire avec position de départ, d'arrivée,
 * énergie consommée, et cellules découvertes. Utile pour l'analyse post-partie.
 */
export const movesApi = {
  getAll: () => mapClient.get(`/moves/${GAME_ID}`),

  // Récupère les N derniers mouvements (défaut 50) pour l'affichage dans l'UI
  getRecent: (limit = 50) => mapClient.get(`/moves/${GAME_ID}/recent/${limit}`),

  // Statistiques agrégées (nombre de moves, distance totale, etc.)
  getStats: () => mapClient.get(`/moves/${GAME_ID}/stats`),

  // Sauvegarde un enregistrement de déplacement — le spread operator fusionne les champs
  save: (moveData) => mapClient.post('/moves', {
    gameId: GAME_ID,
    ...moveData
  }),

  clearAll: () => mapClient.delete(`/moves/${GAME_ID}`)
};

/**
 * Module d'API — Domaine : Position du navire
 * Stocke la dernière position connue du navire dans notre backend.
 * Permet de restaurer la position après rechargement de page si localStorage est vide.
 * PUT (et non POST) car il n'y a qu'une seule position par partie (ressource singleton).
 */
export const shipPositionApi = {
  get: () => mapClient.get(`/ship-position/${GAME_ID}`),
  save: (position) => mapClient.put(`/ship-position/${GAME_ID}`, position)
};

/**
 * Module d'API — Domaine : Historique des prix
 * Stocke des snapshots de prix pour chaque type de ressource au fil du temps.
 * Permet d'afficher des graphiques de tendance et de calculer des statistiques de marché.
 *
 * saveBulk est privilégié pour envoyer tous les snapshots d'une mise à jour
 * en une seule requête réseau.
 */
export const pricesApi = {
  getAll: () => mapClient.get(`/prices/${GAME_ID}`),

  // Récupère l'historique d'une ressource spécifique avec une limite de points
  getByResource: (resourceType, limit = 100) =>
    mapClient.get(`/prices/${GAME_ID}/${resourceType}?limit=${limit}`),

  // Dernier prix connu pour toutes les ressources (utile au démarrage)
  getLatest: () => mapClient.get(`/prices/${GAME_ID}/latest/all`),

  save: (resourceType, data) => mapClient.post('/prices', {
    gameId: GAME_ID,
    resourceType,
    ...data
  }),

  // Sauvegarde plusieurs snapshots à la fois (optimisation réseau)
  saveBulk: (snapshots) => mapClient.post('/prices/bulk', {
    gameId: GAME_ID,
    snapshots
  }),

  clearAll: () => mapClient.delete(`/prices/${GAME_ID}`)
};

/**
 * Module d'API — Domaine : Cache des offres marketplace
 * Notre backend sert de cache pour les offres du marketplace du jeu.
 * Avantage : évite le rate limiting de l'API officielle lors des rechargements fréquents.
 * On ne cache que nos propres offres (saveOwn) pour ne pas stocker des données stale.
 */
export const cachedOffersApi = {
  // Récupère toutes les offres cachées connues pour cette partie
  getAll: () => mapClient.get(`/offers/${GAME_ID}`),

  // Filtre par type de ressource pour des requêtes ciblées
  getByResource: (resourceType) =>
    mapClient.get(`/offers/${GAME_ID}/${resourceType}`),

  // Vérifie l'état du cache (fraîcheur, nombre d'entrées)
  getStatus: () => mapClient.get(`/offers/${GAME_ID}/status`),

  // Sauvegarde uniquement NOS offres (celles que l'on a créées)
  saveOwn: (offer) => mapClient.post(`/offers/${GAME_ID}/own`, { offer })
};

/**
 * Module d'API — Domaine : Statistiques et santé
 * Endpoints utilitaires pour monitorer l'état de notre backend.
 */
export const statsApi = {
  get: () => mapClient.get('/stats'),
  health: () => mapClient.get('/health')
};

export default mapClient;

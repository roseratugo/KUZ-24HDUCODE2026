/**
 * @file client.js
 * @description Client HTTP Axios pour l'API EXTERNE du jeu (CodingGame).
 *
 * Ce fichier est le point d'entrée unique pour toutes les communications
 * avec l'API officielle du jeu. Il regroupe :
 *  - La configuration de l'instance Axios (baseURL, headers d'authentification)
 *  - Les intercepteurs de requête/réponse (timing, historique, logs d'erreur)
 *  - Les modules d'API organisés par domaine métier (playerApi, shipApi, etc.)
 *  - Un mécanisme d'injection du store d'historique (setHistoryStore)
 *
 * ATTENTION : ce client parle à l'API du JEU (/api).
 * Pour notre propre backend, voir mapApi.js (/backend-api).
 */

import axios from 'axios';
import { CREDENTIALS } from './config';

// Toutes les requêtes vers l'API du jeu passent par ce préfixe.
// Le proxy Vite (ou Nginx en production) redirige /api vers l'URL réelle du jeu.
const baseURL = '/api';

/**
 * Instance Axios partagée pour l'API du jeu.
 * On y centralise les headers communs pour ne pas les répéter dans chaque appel :
 *  - Content-Type : on envoie et reçoit du JSON
 *  - codinggame-id : identifiant d'équipe exigé par l'API pour toutes les requêtes
 */
const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'codinggame-id': CREDENTIALS.codingGameId
  }
});

/**
 * Référence vers le store Pinia d'historique des requêtes.
 * On utilise une variable module (injection tardive) plutôt qu'un import direct
 * pour éviter les dépendances circulaires : le store importe ce client,
 * et ce client ne peut donc pas importer le store à son tour au moment du chargement.
 * La fonction setHistoryStore() est appelée après l'initialisation de Pinia.
 *
 * Pattern : "Dependency Injection" (injection de dépendance)
 */
let historyStore = null;

/**
 * Injecte le store d'historique dans ce module.
 * À appeler une seule fois au démarrage de l'application, après initPinia().
 *
 * @param {object} store - L'instance du store Pinia d'historique
 */
export const setHistoryStore = (store) => {
  historyStore = store;
};

/**
 * INTERCEPTEUR DE REQUÊTE
 * Pattern : "Request Interceptor" d'Axios — s'exécute avant chaque envoi HTTP.
 *
 * On stocke l'horodatage de départ dans config.metadata.startTime.
 * Cela permet de calculer la durée de la requête dans l'intercepteur de réponse.
 * config.metadata est un champ libre que l'on ajoute nous-mêmes (non standard Axios).
 */
apiClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

/**
 * Liste des URLs à exclure de l'historique des requêtes.
 * Ces endpoints sont appelés en polling fréquent (toutes les 5 secondes) :
 * les logger à chaque fois polluerait l'historique et noierait les vraies actions.
 */
const excludeFromHistory = ['/players/details', '/resources'];

/**
 * Détermine si une URL doit être enregistrée dans l'historique.
 * Retourne false pour les endpoints de polling haute fréquence.
 *
 * @param {string|undefined} url - L'URL de la requête
 * @returns {boolean}
 */
const shouldLogToHistory = (url) => {
  return !excludeFromHistory.some(excluded => url?.includes(excluded));
};

/**
 * INTERCEPTEUR DE RÉPONSE
 * Pattern : "Response Interceptor" d'Axios — s'exécute après chaque réponse HTTP.
 *
 * Deux handlers sont définis :
 *  1. Succès (2xx) : calcule la durée, enregistre dans historyStore si applicable
 *  2. Erreur (4xx, 5xx, réseau) : log structuré en console + enregistrement en erreur
 *
 * Le fait de tout centraliser ici évite de dupliquer la logique de logging
 * dans chacune des dizaines de fonctions d'API du projet.
 */
apiClient.interceptors.response.use(
  // --- Handler de succès ---
  (response) => {
    // Calcul de la durée grâce au timestamp posé dans l'intercepteur de requête
    const duration = Date.now() - response.config.metadata.startTime;

    if (historyStore && shouldLogToHistory(response.config.url)) {
      historyStore.addRequest({
        method: response.config.method,
        url: response.config.url,
        status: response.status,
        success: true,
        // response.config.data est une chaîne JSON (sérialisée par Axios) : on la parse
        data: response.config.data ? JSON.parse(response.config.data) : null,
        response: response.data,
        duration
      });
    }
    return response;
  },

  // --- Handler d'erreur ---
  (error) => {
    // La durée peut être nulle si l'erreur survient avant même l'envoi (ex: CORS, réseau)
    const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : null;

    // Log structuré pour faciliter le débogage dans la console navigateur
    console.error(`[API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
      status: error.response?.status || 'No response',
      responseData: error.response?.data,
      requestHeaders: error.config?.headers,
      // IIFE pour parser le body sans planter si ce n'est pas du JSON valide
      requestBody: error.config?.data ? (() => { try { return JSON.parse(error.config.data); } catch { return error.config.data; } })() : null
    });

    if (historyStore && shouldLogToHistory(error.config?.url)) {
      historyStore.addRequest({
        method: error.config?.method,
        url: error.config?.url,
        // status 0 = pas de réponse du serveur (coupure réseau, timeout)
        status: error.response?.status || 0,
        success: false,
        data: error.config?.data ? JSON.parse(error.config.data) : null,
        // Tentatives successives d'extraction du message d'erreur selon le format de l'API
        error: error.response?.data?.message || error.response?.data?.error || JSON.stringify(error.response?.data) || error.message,
        duration
      });
    }
    // On rejette la promesse pour que les appelants puissent gérer l'erreur avec try/catch
    return Promise.reject(error);
  }
);

/**
 * Module d'API — Domaine : Joueur
 * Récupère les informations du joueur connecté (profil, état du navire, îles découvertes)
 * et ses ressources en inventaire.
 */
export const playerApi = {
  getDetails: () => apiClient.get('/players/details'),
  getResources: () => apiClient.get('/resources')
};

/**
 * Module d'API — Domaine : Navire
 * Construit le navire, le déplace, et gère les niveaux (vitesse, capacité).
 */
export const shipApi = {
  build: () => apiClient.post('/ship/build'),
  move: (direction) => apiClient.post('/ship/move', { direction }),
  nextLevel: () => apiClient.get('/ship/next-level'),
  upgrade: (level) => apiClient.put('/ship/upgrade', { level })
};

/**
 * Module d'API — Domaine : Stockage
 * Gère la capacité de stockage du navire (ressources transportables).
 */
export const storageApi = {
  nextLevel: () => apiClient.get('/storage/next-level'),
  upgrade: () => apiClient.put('/storage/upgrade')
};

/**
 * Module d'API — Domaine : Vols
 * Permet de voler des ressources à d'autres joueurs.
 */
export const theftsApi = {
  getAll: () => apiClient.get('/thefts'),
  steal: (resourceType, moneySpent) => apiClient.post('/thefts/player', { resourceType, moneySpent })
};

/**
 * Module d'API — Domaine : Inscription
 * Gestion du processus d'enregistrement d'un nouveau joueur :
 * demande de code d'invitation, puis inscription avec ce code en header.
 * Note : le signup code est passé en header HTTP, pas dans le body.
 */
export const registrationApi = {
  signupCodes: (email) => apiClient.post('/signupcodes', { mail: email }),
  register: (name, signupCode) => apiClient.post('/players/register', { name }, {
    headers: { 'codinggame-signupcode': signupCode }
  })
};

/**
 * Module d'API — Domaine : Marketplace
 * CRUD complet sur les offres de vente de ressources,
 * plus l'action d'achat qui consomme une offre existante.
 */
export const marketplaceApi = {
  getOffers: () => apiClient.get('/marketplace/offers'),
  getOffer: (id) => apiClient.get(`/marketplace/offers/${id}`),
  createOffer: (data) => apiClient.post('/marketplace/offers', data),
  updateOffer: (id, data) => apiClient.patch(`/marketplace/offers/${id}`, data),
  deleteOffer: (id) => apiClient.delete(`/marketplace/offers/${id}`),
  purchase: (offerId, quantity) => apiClient.post('/marketplace/purchases', { offerId, quantity })
};

export default apiClient;

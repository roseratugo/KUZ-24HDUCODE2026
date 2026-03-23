/**
 * @file stores/broker.js
 * @description Store Pinia pour la connexion au broker AMQP via WebSocket.
 *
 * Le broker est un serveur intermédiaire qui relaye les événements temps réel
 * du jeu (nouvelles offres, achats, découvertes d'îles, vols) vers notre frontend
 * via une connexion WebSocket persistante.
 *
 * Protocole de connexion en 3 étapes :
 *  1. connect()       → ouvre la connexion WebSocket vers /broker
 *  2. ws.onopen       → envoie les credentials (sendCredentials)
 *  3. message 'ready' → le broker confirme, on passe à l'état 'connected'
 *
 * Pattern pub/sub pour les autres stores :
 * Les stores intéressés (ex: marketplace) s'abonnent via subscribe() à des
 * types d'événements spécifiques. Quand un message arrive, notifyListeners()
 * dispatch vers tous les abonnés concernés.
 * subscribe() retourne une fonction de désabonnement (pattern "unsubscribe function").
 *
 * Auto-reconnexion :
 * En cas de déconnexion, scheduleReconnect() replanifie une tentative de connexion
 * après un délai fixe, jusqu'à maxReconnectAttempts.
 */

import { defineStore } from 'pinia';
import { CREDENTIALS } from '../api/config';

export const useBrokerStore = defineStore('broker', {
  state: () => ({
    ws: null,                     // Instance WebSocket active (null si déconnecté)
    connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'ws_ready' | 'connected' | 'error'
    error: null,                  // Dernier message d'erreur
    messages: [],                 // Historique des événements reçus (limité à maxMessages)
    maxMessages: 100,             // Taille maximale du buffer de messages
    reconnectAttempts: 0,         // Nombre de tentatives de reconnexion déjà effectuées
    maxReconnectAttempts: 10,     // Seuil au-delà duquel on abandonne la reconnexion
    reconnectDelay: 5000,         // Délai entre tentatives (5 secondes)
    reconnectTimeout: null,       // Référence au setTimeout de reconnexion (pour l'annuler si besoin)

    /**
     * Cache du dernier événement reçu par type.
     * Permet à un composant qui se monte après la réception d'un événement
     * de retrouver sa dernière valeur sans avoir à attendre le prochain message.
     */
    lastEvents: {
      ACHAT: null,
      OFFRE: null,
      OFFRE_SUPPRIMEE: null,
      DISCOVERED_ISLAND: null,
      VOL: null
    },

    /**
     * Liste des abonnés pub/sub.
     * Chaque entrée : { eventTypes: string[], callback: Function }
     * Modifié par subscribe() et unsubscribe() (via la fonction retournée).
     */
    eventListeners: []
  }),

  getters: {
    // Raccourci booléen pour les composants qui vérifient l'état de connexion
    isConnected: (state) => state.connectionStatus === 'connected',

    // 'ws_ready' = WebSocket ouvert mais credentials pas encore confirmés par le broker
    isConnecting: (state) => ['connecting', 'ws_ready'].includes(state.connectionStatus),

    // Dernier message reçu (messages[0] car on insère en tête avec unshift)
    latestMessage: (state) => state.messages[0] || null
  },

  actions: {
    /**
     * Ouvre la connexion WebSocket vers le broker.
     * Garde : si une connexion OPEN existe déjà, on ne crée pas de doublon.
     *
     * Le protocole s'adapte automatiquement à HTTP/HTTPS :
     *  - http: → ws:
     *  - https: → wss: (WebSocket sécurisé, exigé en production)
     *
     * Les 4 handlers WebSocket couvrent le cycle de vie complet :
     *  - onopen   : connexion établie → envoi des credentials
     *  - onmessage: réception d'un message → parsing JSON + dispatch
     *  - onerror  : erreur de connexion → mise à jour du statut
     *  - onclose  : fermeture → nettoyage + planification de reconnexion
     *
     * @param {string} playerId   - Identifiant du joueur (utilisé comme mot de passe AMQP)
     * @param {string} playerName - Nom du joueur (utilisé comme username AMQP)
     */
    connect(playerId, playerName) {
      // Évite les connexions en double
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return;
      }

      // Construction de l'URL WebSocket : même hôte que l'application, chemin /broker
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/broker`;

      this.connectionStatus = 'connecting';
      this.error = null;

      try {
        this.ws = new WebSocket(wsUrl);

        // Étape 1 du protocole : WebSocket ouvert → état 'ws_ready', envoi des credentials
        this.ws.onopen = () => {
          this.connectionStatus = 'ws_ready';
          this.sendCredentials(playerId, playerName);
        };

        // Réception d'un message : parsing JSON puis routage vers handleMessage
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (err) {
            console.error('[BrokerStore] Message invalide:', err);
          }
        };

        // Erreur WebSocket (ex: serveur injoignable)
        this.ws.onerror = () => {
          this.connectionStatus = 'error';
          this.error = 'Erreur de connexion WebSocket';
        };

        // Fermeture de la connexion → nettoyage et tentative de reconnexion
        this.ws.onclose = () => {
          this.connectionStatus = 'disconnected';
          this.ws = null;
          // On passe les credentials pour que la reconnexion puisse se ré-authentifier
          this.scheduleReconnect(playerId, playerName);
        };
      } catch (err) {
        this.connectionStatus = 'error';
        this.error = err.message;
      }
    },

    /**
     * Envoie les credentials au broker pour s'authentifier sur le bus AMQP.
     * Étape 2 du protocole de connexion.
     *
     * Les espaces dans le nom sont remplacés par des underscores car AMQP
     * n'accepte pas les espaces dans les noms d'utilisateurs.
     * brokerTeamName permet de forcer un username spécifique (config d'équipe).
     *
     * @param {string} playerId   - Sert de mot de passe AMQP
     * @param {string} playerName - Sert de username de fallback
     */
    sendCredentials(playerId, playerName) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const username = (CREDENTIALS.brokerTeamName || playerName).replace(/ /g, '_');

      this.ws.send(JSON.stringify({
        type: 'connect',
        username,
        password: playerId,
        playerId
      }));
    },

    /**
     * Route les messages WebSocket entrants selon leur type.
     *
     * Le broker utilise une enveloppe JSON avec un champ 'type' :
     *  - 'status'  : changement d'état de la connexion AMQP (ready, disconnected...)
     *  - 'error'   : erreur côté broker (auth échouée, canal fermé...)
     *  - 'message' : événement métier du jeu (OFFRE, ACHAT, VOL...)
     *
     * Pattern : "Message Router" — centralise le dispatch selon le type de message.
     *
     * @param {object} data - Message JSON parsé
     */
    handleMessage(data) {
      switch (data.type) {
        case 'status':
          if (data.status === 'ready') {
            // Étape 3 du protocole : broker confirme, connexion pleinement établie
            this.connectionStatus = 'connected';
            this.error = null;
            this.reconnectAttempts = 0; // Reset du compteur après reconnexion réussie
          } else if (data.status === 'disconnected') {
            this.connectionStatus = 'disconnected';
          } else if (data.status === 'connecting') {
            this.connectionStatus = 'connecting';
          }
          break;

        case 'error':
          // Erreur remontée par le broker (ex: mauvais credentials)
          this.error = data.message;
          break;

        case 'message':
          // Événement métier : data.data est le payload structuré, data.raw le brut
          this.handleBrokerEvent(data.data || data.raw);
          break;
      }
    },

    /**
     * Traite un événement métier du jeu reçu via le broker.
     *
     * Stocke le message dans l'historique (buffer circulaire limité à maxMessages)
     * et met à jour le cache lastEvents pour accès instantané au dernier événement.
     * Puis notifie tous les abonnés enregistrés pour ce type d'événement.
     *
     * Le buffer circulaire évite une croissance infinie du tableau :
     * slice(0, maxMessages) garde les N plus récents (les plus récents sont en tête).
     *
     * @param {object} eventData - Événement avec { type, message }
     */
    handleBrokerEvent(eventData) {
      if (!eventData) return;

      const eventType = eventData.type;
      const eventMessage = eventData.message;

      // Insertion en tête de tableau (unshift) : le plus récent est toujours en [0]
      this.messages.unshift({
        id: Date.now(),
        type: eventType,
        data: eventMessage,
        timestamp: new Date().toISOString()
      });

      // Buffer circulaire : on tronque si on dépasse la limite
      if (this.messages.length > this.maxMessages) {
        this.messages = this.messages.slice(0, this.maxMessages);
      }

      // Mise à jour du cache par type (seulement pour les types connus)
      if (this.lastEvents.hasOwnProperty(eventType)) {
        this.lastEvents[eventType] = {
          data: eventMessage,
          timestamp: new Date().toISOString()
        };
      }

      // Dispatch vers les abonnés
      this.notifyListeners(eventType, eventMessage);
    },

    /**
     * Abonne un callback à un ou plusieurs types d'événements.
     *
     * Pattern : "Observer / Pub-Sub"
     * Retourne une fonction de désabonnement (cleanup function) :
     * l'appelant stocke cette fonction et l'exécute dans onUnmounted()
     * pour éviter les fuites mémoire (listeners zombies sur des composants détruits).
     *
     * Exemple d'usage :
     *   const unsub = brokerStore.subscribe(['OFFRE', 'ACHAT'], (type, data) => { ... })
     *   onUnmounted(() => unsub())
     *
     * Le type spécial '*' permet de s'abonner à tous les événements.
     *
     * @param {string[]} eventTypes - Types d'événements à écouter (ou ['*'] pour tout)
     * @param {Function} callback   - Fonction appelée avec (eventType, data)
     * @returns {Function} Fonction de désabonnement
     */
    subscribe(eventTypes, callback) {
      const listener = { eventTypes, callback };
      this.eventListeners.push(listener);

      // La fonction retournée supprime ce listener spécifique du tableau
      return () => {
        const index = this.eventListeners.indexOf(listener);
        if (index > -1) {
          this.eventListeners.splice(index, 1);
        }
      };
    },

    /**
     * Notifie tous les abonnés compatibles avec le type d'événement reçu.
     * Les erreurs dans les callbacks sont catchées pour ne pas bloquer les autres.
     *
     * @param {string} eventType - Type de l'événement reçu
     * @param {*}      data      - Payload de l'événement
     */
    notifyListeners(eventType, data) {
      this.eventListeners.forEach(listener => {
        // Un listener correspond si son type est dans la liste OU s'il écoute tout ('*')
        if (listener.eventTypes.includes(eventType) || listener.eventTypes.includes('*')) {
          try {
            listener.callback(eventType, data);
          } catch (err) {
            // Isolation des erreurs : un listener défaillant ne bloque pas les autres
            console.error('[BrokerStore] Erreur listener:', err);
          }
        }
      });
    },

    /**
     * Planifie une tentative de reconnexion après disconnection.
     *
     * Annule d'abord tout timer de reconnexion précédent (sécurité anti-doublon).
     * Incrémente le compteur et abandonne si maxReconnectAttempts est atteint.
     *
     * On n'utilise pas de backoff exponentiel ici (délai fixe à 5s),
     * ce qui est suffisant pour la durée d'une partie de 24h.
     *
     * @param {string} playerId
     * @param {string} playerName
     */
    scheduleReconnect(playerId, playerName) {
      // Annule un timer de reconnexion déjà en attente (évite les tentatives en doublon)
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[BrokerStore] Reconnexion dans ${this.reconnectDelay/1000}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
          this.connect(playerId, playerName);
        }, this.reconnectDelay);
      } else {
        // Nombre maximum de tentatives atteint : on arrête et on informe l'utilisateur
        this.error = 'Nombre maximum de tentatives de reconnexion atteint';
      }
    },

    /**
     * Déconnecte proprement du broker et désactive la reconnexion automatique.
     *
     * Force reconnectAttempts au maximum pour que scheduleReconnect (appelé par onclose)
     * abandonne immédiatement sans planifier une nouvelle tentative.
     * Envoie un message 'disconnect' au broker avant de fermer le socket
     * pour lui permettre de nettoyer la connexion AMQP côté serveur.
     */
    disconnect() {
      // Annule la reconnexion automatique en cours
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Saturer le compteur empêche scheduleReconnect de replanifier après onclose
      this.reconnectAttempts = this.maxReconnectAttempts;

      if (this.ws) {
        // Signalement propre au broker avant fermeture
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        this.ws.close();
        this.ws = null;
      }

      this.connectionStatus = 'disconnected';
    },

    /** Vide le buffer de messages (utile pour les tests ou le reset d'UI). */
    clearMessages() {
      this.messages = [];
    }
  }
});

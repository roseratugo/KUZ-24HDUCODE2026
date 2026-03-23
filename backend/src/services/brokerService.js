/**
 * BrokerService — Relay AMQP vers WebSocket
 *
 * Le jeu 3026 utilise un broker AMQP (Amazon MQ) pour publier des evenements
 * en temps reel : nouvelles offres, achats, suppressions d'offres.
 * Probleme : les navigateurs ne parlent pas AMQP, seulement WebSocket.
 *
 * Ce service fait le pont :
 * 1. Le dashboard se connecte en WebSocket a /broker
 * 2. Il envoie ses credentials (username, password, playerId)
 * 3. Le backend ouvre une connexion AMQPS vers Amazon MQ
 * 4. Chaque message AMQP est retransmis au client WebSocket
 * 5. Les evenements marketplace sont aussi traites par OfferSyncService
 *
 * Chaque client WebSocket a sa propre connexion AMQP (1:1).
 * La Map wsClients stocke les connexions par socket WebSocket.
 */

import amqp from 'amqplib';
import { offerSyncService } from './offerSyncService.js';

// Adresse du broker AMQP du jeu (Amazon MQ sur AWS)
const DEFAULT_BROKER_HOST = process.env.BROKER_HOST || 'b-a5095b9b-3c4d-4fe7-8df1-8031e8808618.mq.eu-west-3.on.aws';
const DEFAULT_BROKER_PORT = process.env.BROKER_PORT || 5671;

// Types d'evenements broker qui concernent le marketplace
// et doivent etre traites par OfferSyncService pour mettre a jour la BDD
const MARKETPLACE_EVENTS = ['ACHAT', 'OFFRE', 'OFFRE_SUPPRIMEE'];

class BrokerService {
  constructor() {
    // Map<WebSocket, { connection, channel, playerId, username }>
    // Associe chaque client WebSocket a sa connexion AMQP
    this.wsClients = new Map();
  }

  /**
   * Enregistre un nouveau client WebSocket
   * Appele quand un client se connecte a ws://backend:3001/broker
   * On lui envoie "ws_ready" puis on attend qu'il envoie ses credentials
   */
  addClient(ws) {
    console.log('[Broker] Client WebSocket connecte');

    // Informe le client que le WebSocket est pret, il doit maintenant envoyer un message "connect"
    this.sendToClient(ws, {
      type: 'status',
      status: 'ws_ready',
      message: 'WebSocket connecte. En attente des credentials...',
      timestamp: new Date().toISOString()
    });

    // Ecoute les messages du client (connect, disconnect)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleClientMessage(ws, msg);
      } catch (err) {
        console.error('[Broker] Message invalide:', err.message);
        this.sendToClient(ws, {
          type: 'error',
          message: 'Message invalide',
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  /**
   * Dispatch les messages recus du client WebSocket
   * - "connect" : ouvre la connexion AMQP avec les credentials fournis
   * - "disconnect" : ferme proprement la connexion AMQP
   */
  handleClientMessage(ws, msg) {
    switch (msg.type) {
      case 'connect':
        this.connectToBroker(ws, msg.username, msg.password, msg.playerId);
        break;
      case 'disconnect':
        this.disconnectClient(ws);
        break;
      default:
        console.log('[Broker] Message inconnu:', msg.type);
    }
  }

  /**
   * Ouvre une connexion AMQPS vers le broker Amazon MQ
   *
   * Le protocole AMQPS = AMQP sur TLS (port 5671), equivalent de HTTPS pour AMQP.
   * Chaque joueur du jeu a une queue personnelle "user.<playerId>" sur le broker.
   *
   * @param {WebSocket} ws - le client WebSocket a qui retransmettre les messages
   * @param {string} username - nom d'equipe (espaces remplaces par _)
   * @param {string} password - identifiant de l'equipe
   * @param {string} playerId - identifiant du joueur (pour la queue)
   */
  async connectToBroker(ws, username, password, playerId) {
    // Si ce client avait deja une connexion AMQP, on la ferme d'abord
    if (this.wsClients.has(ws)) {
      await this.disconnectClient(ws);
    }

    console.log(`[Broker] Connexion AMQPS pour username="${username}" playerId="${playerId}"`);
    console.log(`[Broker] URL: amqps://${username}:***@${DEFAULT_BROKER_HOST}:${DEFAULT_BROKER_PORT}/`);

    this.sendToClient(ws, {
      type: 'status',
      status: 'connecting',
      message: `Connexion au broker AMQP pour ${username}...`,
      timestamp: new Date().toISOString()
    });

    // Queue personnelle du joueur sur le broker
    const queue = `user.${playerId}`;

    const url = `amqps://${username}:${password}@${DEFAULT_BROKER_HOST}:${DEFAULT_BROKER_PORT}/`;

    try {
      // Connexion AMQPS (TLS) — rejectUnauthorized: false car le certificat AWS
      // n'est pas toujours dans le trust store du container Docker
      const connection = await amqp.connect(url, {
        rejectUnauthorized: false
      });

      console.log(`[Broker] Connexion AMQPS etablie pour ${username}`);

      // Gestion des erreurs et deconnexions de la connexion AMQP
      connection.on('error', (err) => {
        console.error(`[Broker] Erreur connexion pour ${username}:`, err.message);
        this.sendToClient(ws, {
          type: 'error',
          message: err.message || 'Erreur de connexion AMQP',
          timestamp: new Date().toISOString()
        });
      });

      connection.on('close', () => {
        console.log(`[Broker] Connexion fermee pour ${username}`);
        this.sendToClient(ws, {
          type: 'status',
          status: 'disconnected',
          message: 'Connexion AMQP fermee',
          timestamp: new Date().toISOString()
        });
        this.wsClients.delete(ws);
      });

      // Un "channel" AMQP est un canal de communication virtuel dans la connexion
      // C'est sur le channel qu'on consomme les messages d'une queue
      const channel = await connection.createChannel();

      console.log(`[Broker] Channel cree, ecoute sur ${queue}`);

      // Consomme les messages de la queue du joueur
      // Chaque message est un evenement du jeu (offre creee, achat, etc.)
      channel.consume(queue, (msg) => {
        if (msg) {
          try {
            const content = msg.content.toString('utf8');
            console.log(`[Broker] Message recu pour ${username}:`, content.substring(0, 100));

            // Tente de parser le JSON — certains messages peuvent ne pas etre du JSON valide
            let parsed;
            try {
              parsed = JSON.parse(content);
            } catch {
              parsed = null;
            }

            // 1. Retransmet le message au client WebSocket (le dashboard)
            this.sendToClient(ws, {
              type: 'message',
              data: parsed,
              raw: parsed ? undefined : content, // Si pas JSON, envoie le contenu brut
              timestamp: new Date().toISOString()
            });

            // 2. Si c'est un evenement marketplace, on met a jour la BDD des offres
            // pour que les requetes REST retournent des donnees a jour
            if (parsed && parsed.type && MARKETPLACE_EVENTS.includes(parsed.type)) {
              offerSyncService.handleBrokerEvent(parsed.type, parsed.message);
            }

            // Confirme au broker que le message a ete traite (acknowledgement)
            // Sans ack, le broker re-enverrait le message indefiniment
            channel.ack(msg);
          } catch (err) {
            console.error('[Broker] Erreur traitement message:', err);
            channel.ack(msg); // On ack quand meme pour ne pas bloquer la queue
          }
        }
      });

      // Sauvegarde la connexion AMQP associee a ce client WebSocket
      this.wsClients.set(ws, { connection, channel, playerId, username });

      this.sendToClient(ws, {
        type: 'status',
        status: 'ready',
        message: `Connecte au broker. Ecoute sur ${queue}`,
        queue: queue,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error(`[Broker] Echec connexion pour ${username}:`, err.message);
      this.sendToClient(ws, {
        type: 'error',
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Ferme proprement la connexion AMQP d'un client
   * On ferme le channel puis la connexion pour liberer les ressources
   * sur le broker Amazon MQ (nombre de connexions limite)
   */
  async disconnectClient(ws) {
    const client = this.wsClients.get(ws);
    if (!client) return;

    console.log(`[Broker] Deconnexion client ${client.username || 'inconnu'}`);

    // Fermeture du channel puis de la connexion
    // Les try/catch ignorent les erreurs car le channel/connexion
    // peut deja etre ferme si le broker a coupe
    try {
      if (client.channel) await client.channel.close();
    } catch (e) { /* ignore */ }

    try {
      if (client.connection) await client.connection.close();
    } catch (e) { /* ignore */ }

    this.wsClients.delete(ws);
  }

  /**
   * Appele quand le client WebSocket se deconnecte (fermeture d'onglet, etc.)
   * Nettoie la connexion AMQP associee
   */
  removeClient(ws) {
    this.disconnectClient(ws);
    console.log(`[Broker] Client WebSocket retire. Total: ${this.wsClients.size}`);
  }

  /**
   * Envoie un message JSON au client WebSocket
   * Verifie que le socket est ouvert avant d'envoyer (readyState === 1 = OPEN)
   */
  sendToClient(ws, data) {
    if (ws.readyState === 1)
      ws.send(JSON.stringify(data));
    }
  }

// Singleton — une seule instance partagee dans toute l'application
// En ESM (import/export), le fichier n'est execute qu'une fois,
// donc tous les imports recoivent la meme instance
export const brokerService = new BrokerService();

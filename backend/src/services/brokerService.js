import amqp from 'amqplib';
import { offerSyncService } from './offerSyncService.js';

const DEFAULT_BROKER_HOST = process.env.BROKER_HOST || 'b-a5095b9b-3c4d-4fe7-8df1-8031e8808618.mq.eu-west-3.on.aws';
const DEFAULT_BROKER_PORT = process.env.BROKER_PORT || 5671;

const MARKETPLACE_EVENTS = ['ACHAT', 'OFFRE', 'OFFRE_SUPPRIMEE'];

class BrokerService {
  constructor() {
    this.wsClients = new Map();
  }

  addClient(ws) {
    console.log('[Broker] Client WebSocket connecte');

    this.sendToClient(ws, {
      type: 'status',
      status: 'ws_ready',
      message: 'WebSocket connecte. En attente des credentials...',
      timestamp: new Date().toISOString()
    });

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

  async connectToBroker(ws, username, password, playerId) {
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

    const queue = `user.${playerId}`;

    const url = `amqps://${username}:${password}@${DEFAULT_BROKER_HOST}:${DEFAULT_BROKER_PORT}/`;

    try {
      const connection = await amqp.connect(url, {
        rejectUnauthorized: false
      });

      console.log(`[Broker] Connexion AMQPS etablie pour ${username}`);

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

      const channel = await connection.createChannel();

      console.log(`[Broker] Channel cree, ecoute sur ${queue}`);

      channel.consume(queue, (msg) => {
        if (msg) {
          try {
            const content = msg.content.toString('utf8');
            console.log(`[Broker] Message recu pour ${username}:`, content.substring(0, 100));

            let parsed;
            try {
              parsed = JSON.parse(content);
            } catch {
              parsed = null;
            }

            this.sendToClient(ws, {
              type: 'message',
              data: parsed,
              raw: parsed ? undefined : content,
              timestamp: new Date().toISOString()
            });

            if (parsed && parsed.type && MARKETPLACE_EVENTS.includes(parsed.type)) {
              offerSyncService.handleBrokerEvent(parsed.type, parsed.message);
            }

            channel.ack(msg);
          } catch (err) {
            console.error('[Broker] Erreur traitement message:', err);
            channel.ack(msg);
          }
        }
      });

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

  async disconnectClient(ws) {
    const client = this.wsClients.get(ws);
    if (!client) return;

    console.log(`[Broker] Deconnexion client ${client.username || 'inconnu'}`);

    try {
      if (client.channel) await client.channel.close();
    } catch (e) { /* ignore */ }

    try {
      if (client.connection) await client.connection.close();
    } catch (e) { /* ignore */ }

    this.wsClients.delete(ws);
  }

  removeClient(ws) {
    this.disconnectClient(ws);
    console.log(`[Broker] Client WebSocket retire. Total: ${this.wsClients.size}`);
  }

  sendToClient(ws, data) {
    if (ws.readyState === 1)
      ws.send(JSON.stringify(data));
    }
  }

export const brokerService = new BrokerService();

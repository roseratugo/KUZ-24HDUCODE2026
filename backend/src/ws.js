/**
 * Module WebSocket /ws — broadcast des evenements du jeu
 *
 * Systeme simple de push unidirectionnel : le serveur envoie, les clients ecoutent.
 * Quand une route REST modifie des donnees (nouvelle cellule, position du bateau, etc.),
 * elle appelle broadcast() pour notifier tous les frontends connectes en temps reel.
 *
 * Evenements emis :
 * - "cells:update"    → nouvelles cellules decouvertes par le bot
 * - "ship:position"   → le bateau a bouge
 * - "island:update"   → nouvelle ile ou changement d'etat
 *
 * Format des messages : { "event": "cells:update", "data": { ... } }
 */

// Reference vers le serveur WebSocket, initialisee par setupWebSocket()
let wss = null;

/**
 * Initialise le serveur WebSocket /ws
 * Appele une seule fois au demarrage depuis index.js
 * @param {WebSocketServer} existingWss - le serveur WS cree dans index.js avec noServer: true
 */
export function setupWebSocket(existingWss) {
  wss = existingWss;

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    ws.on('close', () => console.log('WebSocket client disconnected'));
  });

  console.log('WebSocket server ready on /ws');
}

/**
 * Envoie un evenement a TOUS les clients WebSocket connectes
 * Utilise par les routes REST apres avoir modifie des donnees en base
 *
 * @param {string} event - nom de l'evenement (ex: "cells:update")
 * @param {object} data  - donnees associees
 *
 * Exemple d'appel : broadcast('ship:position', { x: 10, y: 20, type: 'SEA' })
 */
export function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    // readyState === 1 signifie que le client est connecte et pret a recevoir
    // (on evite d'envoyer a un client en cours de deconnexion)
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

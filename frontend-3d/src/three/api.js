/**
 * Couche API du frontend 3D — HTTP + WebSocket
 *
 * Deux clients Axios distincts :
 * - client     → notre backend Node.js (/backend-api) : cellules, iles, position, bot
 * - gameClient → API externe du jeu 3026 (/api) : deplacement, joueur, marketplace, vols
 *
 * Le header "codinggame-id" est le token JWT d'authentification pour l'API du jeu.
 *
 * La fonction connectWebSocket() ouvre une connexion WebSocket vers /ws
 * pour recevoir les evenements temps reel (cellules, position, iles).
 * Elle gere l'auto-reconnexion apres 3 secondes en cas de deconnexion.
 */

import axios from "axios";

const GAME_ID = "kuz-team";
// Token JWT fourni par l'organisateur pour s'authentifier aupres de l'API du jeu
const CODINGGAME_ID = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k";

// Client vers NOTRE backend (cellules, iles, position persistees en MongoDB)
// Timeout court (3s) car c'est un serveur local/Docker
const client = axios.create({
  baseURL: "/backend-api",
  headers: { "Content-Type": "application/json" },
  timeout: 3000,
});

// Client vers l'API EXTERNE du jeu 3026 (deplacements, marketplace, joueur)
// Timeout plus long (5s) car c'est un serveur distant sur AWS
const gameClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
    "codinggame-id": CODINGGAME_ID,
  },
  timeout: 5000,
});

// --- API interne (notre backend) ---

// Recupere toutes les cellules explorees de la carte
export async function fetchCells() {
  const res = await client.get(`/cells?gameId=${GAME_ID}`);
  return res.data;
}

// Recupere toutes les iles decouvertes
export async function fetchIslands() {
  const res = await client.get(`/islands?gameId=${GAME_ID}`);
  return res.data;
}

// Recupere la derniere position connue du bateau (depuis MongoDB)
export async function fetchShipPosition() {
  const res = await client.get(`/ship-position/${GAME_ID}`);
  return res.data;
}

// --- API externe (jeu 3026) ---

// Deplace le bateau dans une direction (N, NE, E, SE, S, SW, W, NW)
// Retourne la nouvelle position + les cellules decouvertes autour
export async function moveShip(direction) {
  const res = await gameClient.post("/ship/move", { direction });
  return res.data;
}

// Recupere les details du joueur (nom, or, bateau, iles decouvertes, etc.)
export async function fetchPlayerDetails() {
  const res = await gameClient.get("/players/details");
  return res.data;
}

// Recupere les quantites de chaque ressource du joueur
export async function fetchResources() {
  const res = await gameClient.get("/resources");
  return res.data;
}

// --- Marketplace ---

export async function fetchOffers() {
  const res = await gameClient.get("/marketplace/offers");
  return res.data;
}

export async function purchaseOffer(offerId, quantity) {
  const res = await gameClient.post("/marketplace/purchases", { offerId, quantity });
  return res.data;
}

// L'API du jeu utilise "quantityIn" et "pricePerResource" au lieu de "quantity" et "unitPrice"
export async function createOffer(resourceType, quantity, unitPrice) {
  const res = await gameClient.post("/marketplace/offers", { resourceType, quantityIn: quantity, pricePerResource: unitPrice });
  return res.data;
}

export async function deleteOffer(offerId) {
  const res = await gameClient.delete(`/marketplace/offers/${offerId}`);
  return res.data;
}

// --- Vols ---

export async function fetchThefts() {
  const res = await gameClient.get("/thefts");
  return res.data;
}

export async function launchTheft(resourceType, moneySpent) {
  const res = await gameClient.post("/thefts/player", { resourceType, moneySpent });
  return res.data;
}

// --- Bot d'exploration (proxy via notre backend → bot-python:3002) ---

export async function botStart() {
  const res = await client.post('/bot/start');
  return res.data;
}
export async function botStop() {
  const res = await client.post('/bot/stop');
  return res.data;
}
export async function botPause() {
  const res = await client.post('/bot/pause');
  return res.data;
}
export async function botResume() {
  const res = await client.post('/bot/resume');
  return res.data;
}
export async function botStatus() {
  const res = await client.get('/bot/status');
  return res.data;
}
export async function botLogs(since = 0) {
  const res = await client.get(`/bot/logs?since=${since}`);
  return res.data;
}
export async function botClearLogs() {
  const res = await client.delete('/bot/logs');
  return res.data;
}

/**
 * Connexion WebSocket vers /ws pour recevoir les evenements temps reel
 *
 * Evenements recus :
 * - cells:update   → nouvelles cellules decouvertes (le bot a bouge)
 * - ship:position  → le bateau a change de position
 * - island:update  → une ile a ete decouverte/modifiee
 * - ws:connected   → evenement synthetique emis a la connexion
 * - ws:disconnected → evenement synthetique emis a la deconnexion
 *
 * Retourne une fonction disconnect() pour fermer proprement la connexion.
 * Auto-reconnexion apres 3 secondes en cas de coupure.
 *
 * @param {function} onMessage - callback appelee pour chaque message recu
 * @returns {function} disconnect - ferme le WebSocket et annule la reconnexion
 */
export function connectWebSocket(onMessage) {
  // Detecte si la page est en HTTPS pour utiliser WSS (WebSocket securise)
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  let ws = null;
  let reconnectTimer = null;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[3D] WebSocket connected");
      // Envoie un evenement synthetique pour que App.vue mette a jour le statut
      onMessage({ event: "ws:connected" });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error("[3D] WS parse error", e);
      }
    };

    // Auto-reconnexion apres 3 secondes
    ws.onclose = () => {
      console.log("[3D] WebSocket disconnected, reconnecting...");
      onMessage({ event: "ws:disconnected" });
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  // Retourne la fonction de deconnexion propre
  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}

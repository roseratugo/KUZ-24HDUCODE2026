import axios from "axios";

const GAME_ID = "kuz-team";
const CODINGGAME_ID = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k";

const client = axios.create({
  baseURL: "/backend-api",
  headers: { "Content-Type": "application/json" },
  timeout: 3000,
});

const gameClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
    "codinggame-id": CODINGGAME_ID,
  },
  timeout: 5000,
});

export async function fetchCells() {
  const res = await client.get(`/cells?gameId=${GAME_ID}`);
  return res.data;
}

export async function fetchIslands() {
  const res = await client.get(`/islands?gameId=${GAME_ID}`);
  return res.data;
}

export async function fetchShipPosition() {
  const res = await client.get(`/ship-position/${GAME_ID}`);
  return res.data;
}

export async function moveShip(direction) {
  const res = await gameClient.post("/ship/move", { direction });
  return res.data;
}

export async function fetchPlayerDetails() {
  const res = await gameClient.get("/players/details");
  return res.data;
}

export async function fetchResources() {
  const res = await gameClient.get("/resources");
  return res.data;
}

// Marketplace
export async function fetchOffers() {
  const res = await gameClient.get("/marketplace/offers");
  return res.data;
}

export async function purchaseOffer(offerId, quantity) {
  const res = await gameClient.post("/marketplace/purchases", { offerId, quantity });
  return res.data;
}

export async function createOffer(resourceType, quantity, unitPrice) {
  const res = await gameClient.post("/marketplace/offers", { resourceType, quantity, unitPrice });
  return res.data;
}

export async function deleteOffer(offerId) {
  const res = await gameClient.delete(`/marketplace/offers/${offerId}`);
  return res.data;
}

// Thefts
export async function fetchThefts() {
  const res = await gameClient.get("/thefts");
  return res.data;
}

export async function launchTheft(resourceType, moneySpent) {
  const res = await gameClient.post("/thefts/player", { resourceType, moneySpent });
  return res.data;
}

export function connectWebSocket(onMessage) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  let ws = null;
  let reconnectTimer = null;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[3D] WebSocket connected");
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

    ws.onclose = () => {
      console.log("[3D] WebSocket disconnected, reconnecting...");
      onMessage({ event: "ws:disconnected" });
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}

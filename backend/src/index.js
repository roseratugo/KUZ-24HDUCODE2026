/**
 * Point d'entree du backend — serveur HTTP + WebSocket
 *
 * Ce fichier initialise :
 * 1. Le serveur Express (REST API sur /api/*)
 * 2. La connexion MongoDB via Mongoose
 * 3. Deux serveurs WebSocket sur le meme port :
 *    - /ws     : broadcast des evenements du jeu (cellules, position bateau, iles)
 *    - /broker : relay des messages AMQP du broker du jeu (marketplace temps reel)
 * 4. Le service de synchronisation des offres marketplace (polling toutes les 2 min)
 */

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cellRoutes from './routes/cells.js';
import islandRoutes from './routes/islands.js';
import moveRoutes from './routes/moves.js';
import shipPositionRoutes from './routes/shipPosition.js';
import priceHistoryRoutes from './routes/priceHistory.js';
import offersRoutes from './routes/offers.js';
import { brokerService } from './services/brokerService.js';
import { offerSyncService } from './services/offerSyncService.js';
import botRoutes from './routes/bot.js';
import { setupWebSocket } from './ws.js';

const app = express();
// On cree un serveur HTTP "brut" a partir d'Express pour pouvoir gerer
// les connexions WebSocket sur le meme port (3001)
const server = createServer(app);
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kuz3026';

// CORS autorise toutes les origines (necessaire car les frontends tournent sur d'autres ports)
app.use(cors());
// Parse automatiquement le body JSON des requetes POST/PUT/PATCH
app.use(express.json());

// Connexion a MongoDB — une fois connecte, on demarre le polling des offres marketplace
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // Lance le service qui synchronise les offres depuis l'API du jeu toutes les 2 min
    offerSyncService.start();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// --- WebSocket : deux serveurs sur le meme port ---
// noServer: true = le serveur WS ne bind pas de port lui-meme,
// c'est nous qui decidons manuellement quelle connexion lui envoyer (voir server.on('upgrade'))
const brokerWss = new WebSocketServer({ noServer: true });
const movesWss = new WebSocketServer({ noServer: true });

// Quand un client se connecte au WebSocket /broker, on le confie au BrokerService
// qui gerera l'authentification et la connexion AMQP
brokerWss.on('connection', (ws) => {
  console.log('[WebSocket] Nouveau client broker connecte');

  brokerService.addClient(ws);

  ws.on('close', () => {
    brokerService.removeClient(ws);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Erreur broker:', err.message);
    brokerService.removeClient(ws);
  });
});

/**
 * Routage des connexions WebSocket selon l'URL
 *
 * Quand un navigateur fait `new WebSocket('ws://backend:3001/broker')`,
 * le serveur HTTP recoit d'abord une requete HTTP classique avec le header "Upgrade: websocket".
 * On intercepte cet evenement pour router vers le bon serveur WS selon le pathname.
 */
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/broker') {
    // Connexion WS /broker → relay des messages AMQP du jeu (marketplace)
    brokerWss.handleUpgrade(request, socket, head, (ws) => {
      brokerWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    // Connexion WS /ws → broadcast des evenements internes (cellules, position, iles)
    movesWss.handleUpgrade(request, socket, head, (ws) => {
      movesWss.emit('connection', ws, request);
    });
  } else {
    // URL inconnue → on refuse la connexion WebSocket
    socket.destroy();
  }
});

// --- Routes REST ---
// Chaque fichier dans routes/ gere un domaine de l'API
app.use('/api/cells', cellRoutes);           // CRUD cellules de la carte
app.use('/api/islands', islandRoutes);       // CRUD iles decouvertes
app.use('/api/moves', moveRoutes);           // Historique des deplacements du bateau
app.use('/api/ship-position', shipPositionRoutes); // Position actuelle du bateau
app.use('/api/prices', priceHistoryRoutes);  // Historique des prix des ressources
app.use('/api/offers', offersRoutes);        // Offres marketplace
app.use('/api/bot', botRoutes);              // Proxy vers le bot Python (bot-python:3002)

// Health check — utile pour Docker et le monitoring
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stats globales de la base de donnees
app.get('/api/stats', async (req, res) => {
  try {
    const Cell = mongoose.model('Cell');
    const Island = mongoose.model('Island');

    const cellCount = await Cell.countDocuments();
    const islandCount = await Island.countDocuments();
    const seaCells = await Cell.countDocuments({ type: 'SEA' });
    const sandCells = await Cell.countDocuments({ type: 'SAND' });

    res.json({
      cells: cellCount,
      islands: islandCount,
      seaCells,
      sandCells,
      explorationPercent: cellCount > 0 ? Math.round((sandCells / cellCount) * 100) : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialise le serveur WebSocket /ws pour le broadcast des evenements
setupWebSocket(movesWss);

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket broker relay available at ws://localhost:${PORT}/broker`);
});

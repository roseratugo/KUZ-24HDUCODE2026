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
import botRoutes from './routes/bot.js';
import offersRoutes from './routes/offers.js';
import { brokerService } from './services/brokerService.js';
import { offerSyncService } from './services/offerSyncService.js';
import { setupWebSocket } from './ws.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kuz3026';

app.use(cors());
app.use(express.json());

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // Demarrer le service de sync des offres
    offerSyncService.start();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// WebSocket server pour le broker
const wss = new WebSocketServer({ server, path: '/broker' });

wss.on('connection', (ws) => {
  console.log('[WebSocket] Nouveau client connecte');

  brokerService.addClient(ws);

  ws.on('close', () => {
    brokerService.removeClient(ws);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Erreur:', err.message);
    brokerService.removeClient(ws);
  });
});

app.use('/api/cells', cellRoutes);
app.use('/api/islands', islandRoutes);
app.use('/api/moves', moveRoutes);
app.use('/api/ship-position', shipPositionRoutes);
app.use('/api/prices', priceHistoryRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/offers', offersRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket broker relay available at ws://localhost:${PORT}/broker`);
});

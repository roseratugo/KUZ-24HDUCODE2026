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

// WebSocket servers (noServer pour gerer le routing manuellement)
const brokerWss = new WebSocketServer({ noServer: true });
const movesWss = new WebSocketServer({ noServer: true });

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

// Router les connexions WebSocket vers le bon serveur
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/broker') {
    brokerWss.handleUpgrade(request, socket, head, (ws) => {
      brokerWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    movesWss.handleUpgrade(request, socket, head, (ws) => {
      movesWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.use('/api/cells', cellRoutes);
app.use('/api/islands', islandRoutes);
app.use('/api/moves', moveRoutes);
app.use('/api/ship-position', shipPositionRoutes);
app.use('/api/prices', priceHistoryRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/bot', botRoutes);

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

setupWebSocket(movesWss);

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`WebSocket broker relay available at ws://localhost:${PORT}/broker`);
});

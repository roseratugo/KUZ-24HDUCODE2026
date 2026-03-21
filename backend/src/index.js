import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cellRoutes from './routes/cells.js';
import islandRoutes from './routes/islands.js';
import moveRoutes from './routes/moves.js';
import shipPositionRoutes from './routes/shipPosition.js';

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kuz3026';

app.use(cors());
app.use(express.json());

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/cells', cellRoutes);
app.use('/api/islands', islandRoutes);
app.use('/api/moves', moveRoutes);
app.use('/api/ship-position', shipPositionRoutes);

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

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

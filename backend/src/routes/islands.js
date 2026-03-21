import express from 'express';
import Island from '../models/Island.js';
import Cell from '../models/Cell.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    const islands = await Island.find({ gameId }).lean();
    res.json(islands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { gameId, island } = req.body;

    if (!gameId || !island || !island.id) {
      return res.status(400).json({ error: 'gameId and island with id are required' });
    }

    const result = await Island.findOneAndUpdate(
      { gameId, islandId: island.id },
      {
        $set: {
          name: island.name,
          bonusQuotient: island.bonusQuotient || 0
        },
        $setOnInsert: {
          gameId,
          islandId: island.id,
          discoveredAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add-cell', async (req, res) => {
  try {
    const { gameId, islandId, cell } = req.body;

    if (!gameId || !islandId || !cell) {
      return res.status(400).json({ error: 'gameId, islandId and cell are required' });
    }

    const result = await Island.findOneAndUpdate(
      { gameId, islandId },
      {
        $addToSet: {
          cells: {
            x: cell.x,
            y: cell.y,
            cellId: cell.id
          }
        }
      },
      { new: true }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:islandId/state', async (req, res) => {
  try {
    const { gameId, state } = req.body;
    const { islandId } = req.params;

    if (!gameId || !state) {
      return res.status(400).json({ error: 'gameId and state are required' });
    }

    const result = await Island.findOneAndUpdate(
      { gameId, islandId },
      { $set: { state } },
      { new: true }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    const result = await Island.deleteMany({ gameId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

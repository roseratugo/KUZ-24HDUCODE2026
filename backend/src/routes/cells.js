import express from 'express';
import Cell from '../models/Cell.js';
import { broadcast } from '../ws.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    const cells = await Cell.find({ gameId }).lean();
    res.json(cells);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bounds', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    const cells = await Cell.find({ gameId }).select('x y').lean();

    if (cells.length === 0) {
      return res.json({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    }

    const xs = cells.map(c => c.x);
    const ys = cells.map(c => c.y);

    res.json({
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      count: cells.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const { gameId, cells } = req.body;

    if (!gameId || !cells || !Array.isArray(cells)) {
      return res.status(400).json({ error: 'gameId and cells array are required' });
    }

    const operations = cells.map(cell => ({
      updateOne: {
        filter: { gameId, x: cell.x, y: cell.y },
        update: {
          $set: {
            gameId,
            x: cell.x,
            y: cell.y,
            type: cell.type,
            zone: cell.zone,
            island: cell.island || null,
            lastSeenAt: new Date()
          },
          $setOnInsert: {
            discoveredAt: new Date(),
            state: 'SEEN'
          }
        },
        upsert: true
      }
    }));

    const result = await Cell.bulkWrite(operations);

    broadcast('cells:update', { gameId, cells });

    res.json({
      success: true,
      inserted: result.upsertedCount,
      modified: result.modifiedCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/state', async (req, res) => {
  try {
    const { gameId, cells, state } = req.body;

    if (!gameId || !cells || !state) {
      return res.status(400).json({ error: 'gameId, cells and state are required' });
    }

    const coordinates = cells.map(c => ({ x: c.x, y: c.y }));

    const result = await Cell.updateMany(
      {
        gameId,
        $or: coordinates.map(c => ({ x: c.x, y: c.y }))
      },
      { $set: { state } }
    );

    res.json({
      success: true,
      modified: result.modifiedCount
    });
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

    const result = await Cell.deleteMany({ gameId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

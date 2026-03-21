import express from 'express';
import PriceHistory from '../models/PriceHistory.js';

const router = express.Router();

// Get price history for a game (all resources)
router.get('/:gameId', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);

    const history = await PriceHistory.find({
      gameId: req.params.gameId,
      timestamp: { $gte: since }
    }).sort({ timestamp: -1 });

    // Group by resource type
    const grouped = {
      BOISIUM: [],
      FERONIUM: [],
      CHARBONIUM: []
    };

    history.forEach(h => {
      if (grouped[h.resourceType]) {
        grouped[h.resourceType].push({
          time: h.timestamp,
          avg: h.avgPrice,
          min: h.minPrice,
          max: h.maxPrice,
          count: h.offerCount,
          totalQuantity: h.totalQuantity
        });
      }
    });

    // Reverse to get chronological order
    Object.keys(grouped).forEach(key => {
      grouped[key].reverse();
    });

    res.json(grouped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get price history for a specific resource
router.get('/:gameId/:resourceType', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);

    const history = await PriceHistory.find({
      gameId: req.params.gameId,
      resourceType: req.params.resourceType,
      timestamp: { $gte: since }
    }).sort({ timestamp: -1 });

    res.json(history.reverse().map(h => ({
      time: h.timestamp,
      avg: h.avgPrice,
      min: h.minPrice,
      max: h.maxPrice,
      count: h.offerCount,
      totalQuantity: h.totalQuantity
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save a price snapshot
router.post('/', async (req, res) => {
  try {
    const { gameId, resourceType, avgPrice, minPrice, maxPrice, offerCount, totalQuantity } = req.body;

    if (!gameId || !resourceType || avgPrice === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const priceSnapshot = new PriceHistory({
      gameId,
      resourceType,
      avgPrice,
      minPrice: minPrice || avgPrice,
      maxPrice: maxPrice || avgPrice,
      offerCount: offerCount || 0,
      totalQuantity: totalQuantity || 0
    });

    await priceSnapshot.save();
    res.status(201).json(priceSnapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk save price snapshots (all resources at once)
router.post('/bulk', async (req, res) => {
  try {
    const { gameId, snapshots } = req.body;

    if (!gameId || !snapshots || !Array.isArray(snapshots)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const timestamp = new Date();
    const documents = snapshots.map(s => ({
      gameId,
      resourceType: s.resourceType,
      avgPrice: s.avgPrice,
      minPrice: s.minPrice || s.avgPrice,
      maxPrice: s.maxPrice || s.avgPrice,
      offerCount: s.offerCount || 0,
      totalQuantity: s.totalQuantity || 0,
      timestamp
    }));

    const saved = await PriceHistory.insertMany(documents);
    res.status(201).json({ saved: saved.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest prices for all resources
router.get('/:gameId/latest/all', async (req, res) => {
  try {
    const latest = {};

    for (const resourceType of ['BOISIUM', 'FERONIUM', 'CHARBONIUM']) {
      const entry = await PriceHistory.findOne({
        gameId: req.params.gameId,
        resourceType
      }).sort({ timestamp: -1 });

      if (entry) {
        latest[resourceType] = {
          avg: entry.avgPrice,
          min: entry.minPrice,
          max: entry.maxPrice,
          count: entry.offerCount,
          totalQuantity: entry.totalQuantity,
          timestamp: entry.timestamp
        };
      }
    }

    res.json(latest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear history for a game
router.delete('/:gameId', async (req, res) => {
  try {
    const result = await PriceHistory.deleteMany({ gameId: req.params.gameId });
    res.json({ deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

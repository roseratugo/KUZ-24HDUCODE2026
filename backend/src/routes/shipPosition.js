import express from 'express';
import ShipPosition from '../models/ShipPosition.js';

const router = express.Router();

// Get current ship position for a game
router.get('/:gameId', async (req, res) => {
  try {
    const pos = await ShipPosition.findOne({ gameId: req.params.gameId });
    if (!pos) return res.status(404).json({ error: 'No position found' });
    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert ship position for a game
router.put('/:gameId', async (req, res) => {
  try {
    const { x, y, type, zone } = req.body;
    const pos = await ShipPosition.findOneAndUpdate(
      { gameId: req.params.gameId },
      { x, y, type, zone },
      { upsert: true, new: true }
    );
    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

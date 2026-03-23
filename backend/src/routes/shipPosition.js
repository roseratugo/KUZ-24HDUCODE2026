import express from 'express';
import ShipPosition from '../models/ShipPosition.js';
import { broadcast } from '../ws.js';

const router = express.Router();

router.get('/:gameId', async (req, res) => {
  try {
    const pos = await ShipPosition.findOne({ gameId: req.params.gameId });
    if (!pos) return res.status(404).json({ error: 'No position found' });
    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:gameId', async (req, res) => {
  try {
    const { x, y, type, zone } = req.body;
    const pos = await ShipPosition.findOneAndUpdate(
      { gameId: req.params.gameId },
      { x, y, type, zone },
      { upsert: true, new: true }
    );
    broadcast('ship:position', { gameId: req.params.gameId, position: pos });

    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

/**
 * Routes REST pour la position du bateau
 *
 * Un seul document par partie (upsert) — il n'y a qu'un bateau par equipe.
 * Quand la position est mise a jour, un evenement WebSocket "ship:position"
 * est broadcast pour que le frontend 3D deplace le bateau en temps reel.
 *
 * Endpoints :
 * GET /api/ship-position/:gameId  → position actuelle
 * PUT /api/ship-position/:gameId  → mettre a jour la position (upsert)
 */

import express from 'express';
import ShipPosition from '../models/ShipPosition.js';
import { broadcast } from '../ws.js';

const router = express.Router();

// Recuperer la position actuelle du bateau
router.get('/:gameId', async (req, res) => {
  try {
    const pos = await ShipPosition.findOne({ gameId: req.params.gameId });
    if (!pos) return res.status(404).json({ error: 'No position found' });
    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mettre a jour la position du bateau
// upsert: true → cree le document s'il n'existe pas encore (premier mouvement)
// Declenche un broadcast WebSocket pour que le frontend 3D anime le deplacement
router.put('/:gameId', async (req, res) => {
  try {
    const { x, y, type, zone } = req.body;
    const pos = await ShipPosition.findOneAndUpdate(
      { gameId: req.params.gameId },
      { x, y, type, zone },
      { upsert: true, new: true }
    );
    // Notifie tous les frontends connectes que le bateau a bouge
    broadcast('ship:position', { gameId: req.params.gameId, position: pos });

    res.json(pos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

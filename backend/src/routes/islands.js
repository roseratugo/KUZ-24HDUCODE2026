/**
 * Routes REST pour les iles
 *
 * Dans le jeu 3026, la carte est composee de centaines d'iles a decouvrir.
 * Chaque ile a un nom, un bonus de productivite, et un etat :
 * - DISCOVERED : l'ile a ete vue (le bateau a apercu une cellule SAND)
 * - KNOWN : l'ile a ete validee (le bateau est revenu accoster sur une ile connue)
 * Seules les iles KNOWN augmentent la production de la ressource principale.
 *
 * Endpoints :
 * GET    /api/islands?gameId=              → lister toutes les iles
 * POST   /api/islands                       → creer/mettre a jour une ile (upsert)
 * POST   /api/islands/add-cell              → ajouter une cellule a une ile
 * PATCH  /api/islands/:islandId/state       → changer l'etat (DISCOVERED → KNOWN)
 * DELETE /api/islands?gameId=               → supprimer toutes les iles
 */

import express from 'express';
import Island from '../models/Island.js';
import { broadcast } from '../ws.js';

const router = express.Router();

// Lister toutes les iles d'une partie
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

// Creer ou mettre a jour une ile (upsert sur gameId + islandId)
// $set met a jour le nom et le bonus, $setOnInsert cree les champs initiaux
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

    // Notifie les frontends qu'une ile a ete decouverte/mise a jour
    broadcast('island:update', { gameId, island: result });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajouter une cellule a la liste des cellules d'une ile
// $addToSet evite les doublons (n'ajoute que si la cellule n'est pas deja dans le tableau)
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

// Changer l'etat d'une ile (ex: DISCOVERED → KNOWN)
// KNOWN signifie que l'equipe a valide la decouverte en accostant sur une ile connue
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

// Supprimer toutes les iles d'une partie (reset)
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

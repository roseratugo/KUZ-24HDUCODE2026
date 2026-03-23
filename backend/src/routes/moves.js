/**
 * Routes REST pour l'historique des deplacements du bateau
 *
 * Chaque mouvement du bateau est enregistre avec :
 * - La direction (N, NE, E, SE, S, SW, W, NW)
 * - La position de depart et d'arrivee
 * - L'energie avant/apres le deplacement
 * - Le nombre de cellules decouvertes grace a ce mouvement
 *
 * Ces donnees sont utilisees par le dashboard pour afficher des statistiques
 * d'exploration (nombre total de mouvements, directions preferees, etc.)
 *
 * Endpoints :
 * GET    /api/moves/:gameId                → les 500 derniers mouvements
 * GET    /api/moves/:gameId/recent/:limit  → les N derniers mouvements
 * POST   /api/moves                         → enregistrer un nouveau mouvement
 * GET    /api/moves/:gameId/stats           → statistiques agregees
 * DELETE /api/moves/:gameId                 → supprimer l'historique
 */

import express from 'express';
import Move from '../models/Move.js';

const router = express.Router();

// Les 500 derniers mouvements, tries du plus recent au plus ancien
router.get('/:gameId', async (req, res) => {
  try {
    const moves = await Move.find({ gameId: req.params.gameId })
      .sort({ timestamp: -1 })
      .limit(500);
    res.json(moves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Les N derniers mouvements (parametre dynamique dans l'URL)
router.get('/:gameId/recent/:limit', async (req, res) => {
  try {
    const limit = parseInt(req.params.limit) || 50;
    const moves = await Move.find({ gameId: req.params.gameId })
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json(moves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enregistrer un nouveau mouvement
router.post('/', async (req, res) => {
  try {
    const moveData = {
      gameId: req.body.gameId,
      shipId: req.body.shipId,
      direction: req.body.direction,
      fromPosition: req.body.fromPosition,
      toPosition: req.body.toPosition,
      energyBefore: req.body.energyBefore,
      energyAfter: req.body.energyAfter,
      cellsDiscovered: req.body.cellsDiscovered || 0,
      timestamp: req.body.timestamp || new Date()
    };

    const move = new Move(moveData);
    await move.save();

    res.status(201).json(move);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Statistiques agregees des mouvements
 *
 * Utilise l'aggregation MongoDB pour calculer en une seule requete :
 * - Nombre total de mouvements
 * - Nombre total de cellules decouvertes
 * - Comptage par direction (N, S, E, W, etc.)
 * - Premier et dernier mouvement
 *
 * $match filtre par gameId, $group agrege les resultats.
 * C'est bien plus efficace que de charger tous les mouvements en memoire.
 */
router.get('/:gameId/stats', async (req, res) => {
  try {
    const stats = await Move.aggregate([
      { $match: { gameId: req.params.gameId } },
      {
        $group: {
          _id: '$gameId',
          totalMoves: { $sum: 1 },
          totalCellsDiscovered: { $sum: '$cellsDiscovered' },
          directionCounts: {
            $push: '$direction' // Collecte toutes les directions dans un tableau
          },
          firstMove: { $min: '$timestamp' },
          lastMove: { $max: '$timestamp' }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalMoves: 0,
        totalCellsDiscovered: 0,
        directionCounts: {},
        firstMove: null,
        lastMove: null
      });
    }

    // Transforme le tableau de directions en objet { N: 42, S: 38, E: 51, ... }
    const directionCounts = {};
    stats[0].directionCounts.forEach(dir => {
      directionCounts[dir] = (directionCounts[dir] || 0) + 1;
    });

    res.json({
      totalMoves: stats[0].totalMoves,
      totalCellsDiscovered: stats[0].totalCellsDiscovered,
      directionCounts,
      firstMove: stats[0].firstMove,
      lastMove: stats[0].lastMove
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Supprimer tout l'historique des mouvements d'une partie
router.delete('/:gameId', async (req, res) => {
  try {
    const result = await Move.deleteMany({ gameId: req.params.gameId });
    res.json({ deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

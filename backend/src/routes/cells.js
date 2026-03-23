/**
 * Routes REST pour les cellules de la carte
 *
 * Chaque case de la carte du jeu est une "cellule" avec des coordonnees (x, y)
 * et un type : SEA (ocean) ou SAND (plage = partie d'une ile).
 * Le bot decouvre des cellules en se deplacant et les envoie ici pour les persister.
 *
 * Endpoints :
 * GET    /api/cells?gameId=         → toutes les cellules d'une partie
 * GET    /api/cells/bounds?gameId=  → limites min/max de la carte (pour le zoom)
 * POST   /api/cells/bulk            → insert/update en masse (utilise par le bot)
 * PATCH  /api/cells/state           → changer l'etat d'un lot de cellules
 * DELETE /api/cells?gameId=         → supprimer toutes les cellules d'une partie
 */

import express from 'express';
import Cell from '../models/Cell.js';
import { broadcast } from '../ws.js';

const router = express.Router();

// Recuperer toutes les cellules d'une partie
// .lean() retourne des objets JS bruts au lieu d'instances Mongoose (plus rapide, moins de memoire)
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

// Calculer les limites de la carte exploree (min/max des coordonnees)
// Utilise par le frontend pour centrer la vue sur la zone exploree
router.get('/bounds', async (req, res) => {
  try {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ error: 'gameId is required' });
    }

    // On ne recupere que x et y pour minimiser le transfert de donnees
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

/**
 * Insertion/mise a jour en masse de cellules (bulk upsert)
 *
 * C'est l'endpoint le plus appele du backend : le bot l'utilise apres chaque deplacement
 * pour envoyer les nouvelles cellules decouvertes.
 *
 * Le bulkWrite envoie toutes les operations en UNE seule requete MongoDB,
 * ce qui est beaucoup plus performant que de faire un save() par cellule.
 *
 * L'upsert: true fait que :
 * - Si la cellule n'existe pas → elle est creee (INSERT)
 * - Si elle existe deja → elle est mise a jour (UPDATE)
 *
 * $set met a jour les champs a chaque passage (lastSeenAt, type, etc.)
 * $setOnInsert ne s'execute qu'au premier insert (discoveredAt, state initial)
 */
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

    // Notifie tous les frontends connectes en WebSocket que de nouvelles cellules sont disponibles
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

// Changer l'etat de plusieurs cellules d'un coup (ex: SEEN → KNOWN)
router.patch('/state', async (req, res) => {
  try {
    const { gameId, cells, state } = req.body;

    if (!gameId || !cells || !state) {
      return res.status(400).json({ error: 'gameId, cells and state are required' });
    }

    const coordinates = cells.map(c => ({ x: c.x, y: c.y }));

    // $or permet de matcher plusieurs cellules par leurs coordonnees en une seule requete
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

// Supprimer toutes les cellules d'une partie (reset)
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

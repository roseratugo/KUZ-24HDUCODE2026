/**
 * Routes REST pour l'historique des prix
 *
 * Le dashboard affiche des graphiques d'evolution des prix pour les 3 ressources.
 * Les snapshots sont enregistres periodiquement et stockes en base.
 *
 * Le parametre ?hours= permet de limiter la fenetre temporelle (defaut: 24h).
 *
 * Endpoints :
 * GET    /api/prices/:gameId                   → historique groupe par ressource
 * GET    /api/prices/:gameId/:resourceType     → historique pour une ressource
 * POST   /api/prices                            → enregistrer un snapshot
 * POST   /api/prices/bulk                       → enregistrer plusieurs snapshots
 * GET    /api/prices/:gameId/latest/all         → dernier prix connu par ressource
 * DELETE /api/prices/:gameId                    → supprimer l'historique
 */

import express from 'express';
import PriceHistory from '../models/PriceHistory.js';

const router = express.Router();

/**
 * Historique des prix pour toutes les ressources, groupe par type
 * Retourne un objet { BOISIUM: [...], FERONIUM: [...], CHARBONIUM: [...] }
 * Chaque entree contient time, avg, min, max, count, totalQuantity
 *
 * Le parametre ?hours= limite la fenetre (defaut 24h)
 */
router.get('/:gameId', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    // Calcule la date de debut : maintenant - N heures
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000);

    // $gte = "greater than or equal" → tous les snapshots depuis `since`
    const history = await PriceHistory.find({
      gameId: req.params.gameId,
      timestamp: { $gte: since }
    }).sort({ timestamp: -1 });

    // Groupe les resultats par type de ressource
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

    // Inverse pour avoir l'ordre chronologique (le tri MongoDB est desc)
    Object.keys(grouped).forEach(key => {
      grouped[key].reverse();
    });

    res.json(grouped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historique pour une seule ressource
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

// Enregistrer un seul snapshot de prix
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

// Enregistrer plusieurs snapshots en une seule requete (un par ressource typiquement)
// insertMany est plus performant que plusieurs save() individuels
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
      timestamp // Meme timestamp pour tous les snapshots du meme lot
    }));

    const saved = await PriceHistory.insertMany(documents);
    res.status(201).json({ saved: saved.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dernier prix connu pour chaque ressource (utile pour afficher les prix actuels)
router.get('/:gameId/latest/all', async (req, res) => {
  try {
    const latest = {};

    for (const resourceType of ['BOISIUM', 'FERONIUM', 'CHARBONIUM']) {
      // sort({ timestamp: -1 }) + findOne = dernier snapshot
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

// Supprimer tout l'historique des prix d'une partie
router.delete('/:gameId', async (req, res) => {
  try {
    const result = await PriceHistory.deleteMany({ gameId: req.params.gameId });
    res.json({ deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

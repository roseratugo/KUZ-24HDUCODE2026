/**
 * Routes REST pour les offres marketplace
 *
 * La marketplace permet aux joueurs d'echanger des ressources.
 * Chaque equipe ne produit qu'une seule des 3 ressources primaires
 * (Boisium, Feronium ou Charbonium), le commerce est donc indispensable.
 *
 * Les offres sont maintenues a jour par deux sources :
 * - OfferSyncService (polling API du jeu toutes les 2 min)
 * - Evenements broker AMQP (temps reel)
 *
 * Les offres supprimees ne sont pas effacees de la BDD mais marquees deleted: true
 * (soft delete) pour garder l'historique.
 *
 * Note : l'API du jeu utilise des noms de champs differents de notre BDD
 * (quantityIn vs quantity, pricePerResource vs unitPrice) → on normalise dans les reponses.
 *
 * Endpoints :
 * GET  /api/offers/:gameId                    → toutes les offres actives
 * GET  /api/offers/:gameId/:resourceType      → offres filtrees par ressource
 * POST /api/offers/:gameId/sync               → sync complete (bulk upsert)
 * POST /api/offers/:gameId/broker/offer       → upsert une offre (evenement broker)
 * POST /api/offers/:gameId/broker/purchase    → traite un achat (decremente quantite)
 * POST /api/offers/:gameId/broker/delete      → soft delete une offre
 * POST /api/offers/:gameId/own                → cree/modifie notre propre offre
 * GET  /api/offers/:gameId/status             → derniere sync + nombre d'offres actives
 */

import express from "express";
import Offer from "../models/Offer.js";

const router = express.Router();

// Toutes les offres actives, triees par prix unitaire croissant
// Les offres supprimees (deleted: true) sont filtrees
// Le format de reponse inclut les deux noms de champs (quantityIn/quantity, etc.)
// pour etre compatible avec les differents frontends
router.get("/:gameId", async (req, res) => {
  try {
    const offers = await Offer.find({
      gameId: req.params.gameId,
      deleted: false,
    }).sort({ unitPrice: 1 });

    const formattedOffers = offers.map((o) => ({
      id: o.offerId,
      owner: o.owner,
      resourceType: o.resourceType,
      quantityIn: o.quantity,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      pricePerResource: o.unitPrice,
      createdAt: o.createdAt,
      lastSyncAt: o.lastSyncAt,
    }));

    res.json(formattedOffers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Offres filtrees par type de ressource (BOISIUM, FERONIUM, CHARBONIUM)
router.get("/:gameId/:resourceType", async (req, res) => {
  try {
    const offers = await Offer.find({
      gameId: req.params.gameId,
      resourceType: req.params.resourceType,
      deleted: false,
    }).sort({ unitPrice: 1 });

    const formattedOffers = offers.map((o) => ({
      id: o.offerId,
      owner: o.owner,
      resourceType: o.resourceType,
      quantityIn: o.quantity,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      pricePerResource: o.unitPrice,
      createdAt: o.createdAt,
      lastSyncAt: o.lastSyncAt,
    }));

    res.json(formattedOffers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Synchronisation complete des offres
 *
 * Recoit un tableau d'offres et :
 * 1. Upsert chaque offre (cree ou met a jour)
 * 2. Marque comme deleted les offres en base qui ne sont plus dans le tableau
 *    (elles ont ete supprimees/expirees depuis la derniere sync)
 *
 * C'est le meme principe que OfferSyncService.sync() mais expose en endpoint REST
 */
router.post("/:gameId/sync", async (req, res) => {
  try {
    const { offers } = req.body;
    const gameId = req.params.gameId;

    if (!Array.isArray(offers)) {
      return res.status(400).json({ error: "offers must be an array" });
    }

    const now = new Date();
    const syncedIds = [];

    for (const offer of offers) {
      const offerId = offer.id;
      syncedIds.push(offerId);

      await Offer.findOneAndUpdate(
        { gameId, offerId },
        {
          gameId,
          offerId,
          owner: offer.owner || null,
          resourceType: offer.resourceType,
          quantity: offer.quantityIn || offer.quantity || 0,
          unitPrice: offer.pricePerResource || offer.unitPrice || 0,
          lastSyncAt: now,
          deleted: false,
        },
        { upsert: true, new: true },
      );
    }

    // $nin = "not in" : toutes les offres dont l'ID n'est pas dans syncedIds
    await Offer.updateMany(
      {
        gameId,
        offerId: { $nin: syncedIds },
        deleted: false,
      },
      {
        deleted: true,
        lastSyncAt: now,
      },
    );

    res.json({
      synced: syncedIds.length,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert une offre a partir d'un evenement broker AMQP
router.post("/:gameId/broker/offer", async (req, res) => {
  try {
    const { offer } = req.body;
    const gameId = req.params.gameId;

    if (!offer || !offer.id) {
      return res.status(400).json({ error: "offer with id required" });
    }

    const result = await Offer.findOneAndUpdate(
      { gameId, offerId: offer.id },
      {
        gameId,
        offerId: offer.id,
        owner: offer.owner || null,
        resourceType: offer.resourceType,
        quantity: offer.quantityIn || offer.quantity || 0,
        unitPrice: offer.pricePerResource || offer.unitPrice || 0,
        lastSyncAt: new Date(),
        deleted: false,
      },
      { upsert: true, new: true },
    );

    res.json({ success: true, offer: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Traiter un achat : decremente la quantite de l'offre
// Si la quantite tombe a 0 ou moins → soft delete
router.post("/:gameId/broker/purchase", async (req, res) => {
  try {
    const { offerId, quantity } = req.body;
    const gameId = req.params.gameId;

    if (!offerId || quantity === undefined) {
      return res.status(400).json({ error: "offerId and quantity required" });
    }

    const offer = await Offer.findOne({ gameId, offerId });

    if (offer) {
      offer.quantity = Math.max(0, offer.quantity - quantity);
      offer.lastSyncAt = new Date();

      if (offer.quantity <= 0) {
        offer.deleted = true;
      }

      await offer.save();
      res.json({ success: true, offer });
    } else {
      res.json({ success: false, message: "Offer not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Soft delete d'une offre (quand le vendeur la retire)
router.post("/:gameId/broker/delete", async (req, res) => {
  try {
    const { offerId } = req.body;
    const gameId = req.params.gameId;

    if (!offerId) {
      return res.status(400).json({ error: "offerId required" });
    }

    await Offer.findOneAndUpdate(
      { gameId, offerId },
      { deleted: true, lastSyncAt: new Date() },
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Creer/modifier notre propre offre (isOwn: true pour la differencier des autres)
router.post("/:gameId/own", async (req, res) => {
  try {
    const { offer } = req.body;
    const gameId = req.params.gameId;

    if (!offer || !offer.id) {
      return res.status(400).json({ error: "offer with id required" });
    }

    const result = await Offer.findOneAndUpdate(
      { gameId, offerId: offer.id },
      {
        gameId,
        offerId: offer.id,
        owner: offer.owner || null,
        resourceType: offer.resourceType,
        quantity: offer.quantityIn || offer.quantity || 0,
        unitPrice: offer.pricePerResource || offer.unitPrice || 0,
        lastSyncAt: new Date(),
        deleted: false,
        isOwn: true, // Flag pour identifier notre propre offre dans le dashboard
      },
      { upsert: true, new: true },
    );

    console.log(`[Offers] Own offer saved: ${offer.id}`);
    res.json({ success: true, offer: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Etat de la synchronisation : derniere date de sync + nombre d'offres actives
router.get("/:gameId/status", async (req, res) => {
  try {
    const lastOffer = await Offer.findOne({ gameId: req.params.gameId }).sort({
      lastSyncAt: -1,
    });

    const count = await Offer.countDocuments({
      gameId: req.params.gameId,
      deleted: false,
    });

    res.json({
      lastSync: lastOffer?.lastSyncAt || null,
      activeOffers: count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

import express from "express";
import Offer from "../models/Offer.js";

const router = express.Router();

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
        isOwn: true,
      },
      { upsert: true, new: true },
    );

    console.log(`[Offers] Own offer saved: ${offer.id}`);
    res.json({ success: true, offer: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

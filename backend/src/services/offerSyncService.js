import Offer from '../models/Offer.js';

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL || 'http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443';
const CODINGGAME_ID = process.env.CODINGGAME_ID || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k';
const GAME_ID = process.env.GAME_ID || 'kuz-default';
const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

class OfferSyncService {
  constructor() {
    this.syncInterval = null;
    this.lastSync = null;
    this.syncing = false;
  }

  start() {
    console.log('[OfferSync] Starting sync service (interval: 2 minutes)');

    this.sync();

    this.syncInterval = setInterval(() => {
      this.sync();
    }, SYNC_INTERVAL);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('[OfferSync] Sync service stopped');
  }

  async sync() {
    if (this.syncing) {
      console.log('[OfferSync] Sync already in progress, skipping');
      return;
    }

    this.syncing = true;
    console.log('[OfferSync] Starting sync...');

    try {
      const response = await fetch(`${EXTERNAL_API_URL}/marketplace/offers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'codinggame-id': CODINGGAME_ID
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.codeError === 'TOO_FAST_TOO_FURIOUS') {
          console.log('[OfferSync] Rate limited, will retry next interval');
          return;
        }

        throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const offers = await response.json();
      console.log(`[OfferSync] Received ${offers.length} offers from API`);

      const now = new Date();
      const syncedIds = [];

      for (const offer of offers) {
        const offerId = offer.id;
        syncedIds.push(offerId);

        await Offer.findOneAndUpdate(
          { gameId: GAME_ID, offerId },
          {
            gameId: GAME_ID,
            offerId,
            owner: offer.owner || null,
            resourceType: offer.resourceType,
            quantity: offer.quantityIn || offer.quantity || 0,
            unitPrice: offer.pricePerResource || offer.unitPrice || 0,
            lastSyncAt: now,
            deleted: false
          },
          { upsert: true, new: true }
        );
      }

      const deleteResult = await Offer.updateMany(
        {
          gameId: GAME_ID,
          offerId: { $nin: syncedIds },
          deleted: false
        },
        {
          deleted: true,
          lastSyncAt: now
        }
      );

      this.lastSync = now;
      console.log(`[OfferSync] Sync complete: ${syncedIds.length} offers synced, ${deleteResult.modifiedCount} marked as deleted`);

    } catch (error) {
      console.error('[OfferSync] Sync error:', error.message);
    } finally {
      this.syncing = false;
    }
  }

  async handleBrokerEvent(eventType, data) {
    try {
      switch (eventType) {
        case 'OFFRE':
          await this.handleNewOffer(data);
          break;
        case 'ACHAT':
          await this.handlePurchase(data);
          break;
        case 'OFFRE_SUPPRIMEE':
          await this.handleDelete(data);
          break;
      }
    } catch (error) {
      console.error(`[OfferSync] Error handling ${eventType}:`, error.message);
    }
  }

  async handleNewOffer(data) {
    if (!data || !data.id) return;

    const newQuantity = data.quantityIn || data.quantity || 0;
    const newPrice = data.pricePerResource || data.unitPrice || 0;

    const existing = await Offer.findOne({ gameId: GAME_ID, offerId: data.id });

    if (existing) {
      const updateData = {
        lastSyncAt: new Date(),
        deleted: false
      };

      if (data.resourceType) updateData.resourceType = data.resourceType;
      if (newQuantity > 0) updateData.quantity = newQuantity;
      if (newPrice > 0) updateData.unitPrice = newPrice;
      if (data.owner) updateData.owner = data.owner;

      await Offer.findOneAndUpdate(
        { gameId: GAME_ID, offerId: data.id },
        updateData
      );
      console.log(`[OfferSync] Offer updated: ${data.id} (preserved existing values)`);
    } else {
      await Offer.create({
        gameId: GAME_ID,
        offerId: data.id,
        owner: data.owner || null,
        resourceType: data.resourceType,
        quantity: newQuantity,
        unitPrice: newPrice,
        lastSyncAt: new Date(),
        deleted: false
      });
      console.log(`[OfferSync] New offer added: ${data.id}`);
    }
  }

  async handlePurchase(data) {
    if (!data || !data.offerId) return;

    const offer = await Offer.findOne({ gameId: GAME_ID, offerId: data.offerId });

    if (offer) {
      offer.quantity = Math.max(0, offer.quantity - (data.quantity || 0));
      offer.lastSyncAt = new Date();

      if (offer.quantity <= 0) {
        offer.deleted = true;
      }

      await offer.save();
      console.log(`[OfferSync] Purchase processed: ${data.offerId}, remaining: ${offer.quantity}`);
    }
  }

  async handleDelete(data) {
    if (!data || !data.id) return;

    await Offer.findOneAndUpdate(
      { gameId: GAME_ID, offerId: data.id },
      { deleted: true, lastSyncAt: new Date() }
    );

    console.log(`[OfferSync] Offer deleted: ${data.id}`);
  }

  getStatus() {
    return {
      lastSync: this.lastSync,
      syncing: this.syncing,
      interval: SYNC_INTERVAL
    };
  }
}

export const offerSyncService = new OfferSyncService();

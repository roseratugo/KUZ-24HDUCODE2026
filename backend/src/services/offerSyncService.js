/**
 * OfferSyncService — Synchronisation des offres marketplace
 *
 * Ce service maintient la collection MongoDB "offers" a jour en utilisant
 * deux strategies complementaires :
 *
 * 1. POLLING (toutes les 2 minutes) :
 *    Appelle GET /marketplace/offers sur l'API du jeu,
 *    upsert toutes les offres, et marque les absentes comme supprimees.
 *    → Garantit la coherence globale meme si le broker rate un evenement.
 *
 * 2. TEMPS REEL (via les evenements du broker AMQP) :
 *    Quand BrokerService recoit un evenement OFFRE/ACHAT/OFFRE_SUPPRIMEE,
 *    il appelle handleBrokerEvent() pour mettre a jour la BDD immediatement.
 *    → Permet une reactivite instantanee dans le dashboard.
 *
 * Les offres ne sont jamais vraiment supprimees de la BDD (soft delete) :
 * on met deleted: true au lieu de les supprimer, pour garder l'historique.
 */

import Offer from '../models/Offer.js';

// URL de l'API du jeu 3026 (serveur de l'organisateur)
const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL || 'http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443';
// Token JWT d'authentification pour l'API du jeu
const CODINGGAME_ID = process.env.CODINGGAME_ID || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiZTQ2MmE1ZWItOWQxNi00M2Q2LTg4MTYtMzc2N2MzMzZiZjczIiwicm9sZXMiOlsiVVNFUiJdfQ.i4gq-3ey6r0m1BOQjGTcjhvONZe9UXmPJo8ojcMf-7k';
const GAME_ID = process.env.GAME_ID || 'kuz-default';
const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

class OfferSyncService {
  constructor() {
    this.syncInterval = null;  // Reference au setInterval pour pouvoir l'arreter
    this.lastSync = null;      // Date de la derniere sync reussie
    this.syncing = false;      // Verrou pour eviter les syncs paralleles
  }

  /**
   * Demarre le service de polling
   * Lance une sync immediate puis programme un polling toutes les 2 minutes
   */
  start() {
    console.log('[OfferSync] Starting sync service (interval: 2 minutes)');

    // Sync immediate au demarrage pour avoir des donnees tout de suite
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

  /**
   * Synchronise les offres depuis l'API du jeu
   *
   * Le flag this.syncing empeche deux syncs de tourner en parallele
   * (si une sync prend plus de 2 min, le setInterval en declencherait une 2eme).
   * Le finally garantit que le flag est remis a false meme en cas d'erreur.
   */
  async sync() {
    // Verrou : si une sync est deja en cours, on skip
    if (this.syncing) {
      console.log('[OfferSync] Sync already in progress, skipping');
      return;
    }

    this.syncing = true;
    console.log('[OfferSync] Starting sync...');

    try {
      // Appel a l'API du jeu pour recuperer toutes les offres actives
      const response = await fetch(`${EXTERNAL_API_URL}/marketplace/offers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'codinggame-id': CODINGGAME_ID  // Header d'auth specifique au jeu
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // L'API du jeu a un rate limit — si on appelle trop souvent,
        // elle repond "TOO_FAST_TOO_FURIOUS". On attend le prochain cycle
        // au lieu de crasher le service.
        if (errorData.codeError === 'TOO_FAST_TOO_FURIOUS') {
          console.log('[OfferSync] Rate limited, will retry next interval');
          return;
        }

        throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const offers = await response.json();
      console.log(`[OfferSync] Received ${offers.length} offers from API`);

      const now = new Date();
      const syncedIds = []; // Liste des IDs recus pour detecter les offres supprimees

      // Upsert chaque offre : cree si n'existe pas, met a jour sinon
      for (const offer of offers) {
        const offerId = offer.id;
        syncedIds.push(offerId);

        // L'API du jeu utilise des noms de champs differents (quantityIn vs quantity,
        // pricePerResource vs unitPrice), on normalise avec des fallbacks
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
            deleted: false  // Si l'offre est dans la reponse, elle est active
          },
          { upsert: true, new: true }
        );
      }

      // Soft delete : les offres qui etaient en base mais ne sont plus dans la reponse API
      // ont ete supprimees/expirees → on les marque deleted: true
      // $nin = "not in" → toutes les offres dont l'ID n'est pas dans syncedIds
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
      // Le finally s'execute TOUJOURS, meme si une erreur a ete throw
      // Sans ca, une erreur bloquerait le flag syncing a true definitivement
      this.syncing = false;
    }
  }

  /**
   * Traite un evenement marketplace recu du broker AMQP (temps reel)
   * Appele par BrokerService quand il recoit un message de type OFFRE/ACHAT/OFFRE_SUPPRIMEE
   *
   * @param {string} eventType - OFFRE | ACHAT | OFFRE_SUPPRIMEE
   * @param {object} data - contenu de l'evenement
   */
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

  /**
   * Traite un evenement "nouvelle offre" ou "offre modifiee"
   *
   * Subtilite : les evenements broker peuvent avoir des champs manquants.
   * Si l'offre existe deja, on ne met a jour QUE les champs presents dans l'evenement
   * pour ne pas ecraser des valeurs existantes avec undefined.
   */
  async handleNewOffer(data) {
    if (!data || !data.id) return;

    const newQuantity = data.quantityIn || data.quantity || 0;
    const newPrice = data.pricePerResource || data.unitPrice || 0;

    const existing = await Offer.findOne({ gameId: GAME_ID, offerId: data.id });

    if (existing) {
      // L'offre existe → mise a jour selective (on ne touche pas aux champs absents)
      const updateData = {
        lastSyncAt: new Date(),
        deleted: false // Si on recoit un evenement OFFRE, elle est forcement active
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
      // Nouvelle offre → creation complete
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

  /**
   * Traite un evenement "achat" — quelqu'un a achete une partie d'une offre
   * On decremente la quantite restante. Si elle tombe a 0, soft delete.
   */
  async handlePurchase(data) {
    if (!data || !data.offerId) return;

    const offer = await Offer.findOne({ gameId: GAME_ID, offerId: data.offerId });

    if (offer) {
      // Math.max(0, ...) pour ne jamais avoir de quantite negative
      offer.quantity = Math.max(0, offer.quantity - (data.quantity || 0));
      offer.lastSyncAt = new Date();

      // Si plus rien a vendre, l'offre est terminee
      if (offer.quantity <= 0) {
        offer.deleted = true;
      }

      await offer.save();
      console.log(`[OfferSync] Purchase processed: ${data.offerId}, remaining: ${offer.quantity}`);
    }
  }

  /**
   * Traite un evenement "offre supprimee" — le vendeur a retire son offre
   * Soft delete : on met deleted: true sans supprimer le document
   */
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

// Singleton — meme instance partagee par index.js et brokerService.js
export const offerSyncService = new OfferSyncService();

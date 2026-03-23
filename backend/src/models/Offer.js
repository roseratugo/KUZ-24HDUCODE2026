/**
 * Model Offer — une offre sur le marketplace
 *
 * La marketplace permet aux joueurs d'echanger des ressources.
 * Chaque offre est une vente : un joueur propose X unites de sa ressource
 * a un prix unitaire donne.
 *
 * Les offres sont synchronisees depuis deux sources :
 * - Polling de l'API du jeu (toutes les 2 min par OfferSyncService)
 * - Evenements temps reel du broker AMQP (OFFRE, ACHAT, OFFRE_SUPPRIMEE)
 *
 * Soft delete : les offres supprimees gardent deleted: true au lieu d'etre effacees.
 * Ca permet de garder l'historique et de ne pas perdre de donnees si un evenement
 * broker est traite avant la confirmation du polling.
 *
 * isOwn: true identifie notre propre offre parmi toutes les autres.
 *
 * Index compose {gameId, resourceType, deleted} → requetes rapides sur les offres
 * actives d'un type de ressource donne (ex: toutes les offres BOISIUM non supprimees).
 */

import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  // ID de l'offre dans l'API du jeu
  offerId: {
    type: String,
    required: true,
    index: true
  },
  gameId: {
    type: String,
    required: true,
    index: true
  },
  // Joueur qui a cree l'offre
  owner: {
    id: String,
    name: String
  },
  // BOISIUM, FERONIUM ou CHARBONIUM
  resourceType: {
    type: String,
    required: true,
    index: true
  },
  // Nombre d'unites disponibles a la vente
  quantity: {
    type: Number,
    required: true
  },
  // Prix par unite (en OR)
  unitPrice: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Date de la derniere synchronisation (polling ou broker)
  lastSyncAt: {
    type: Date,
    default: Date.now
  },
  // Soft delete : true = l'offre a ete retiree ou entierement achetee
  deleted: {
    type: Boolean,
    default: false
  },
  // true = c'est notre propre offre (pour l'afficher differemment dans le dashboard)
  isOwn: {
    type: Boolean,
    default: false
  }
});

// Index unique : une seule entree par offre par partie
offerSchema.index({ gameId: 1, offerId: 1 }, { unique: true });
// Index compose pour les requetes filtrees : "toutes les offres BOISIUM actives"
// L'ordre des champs dans l'index est important :
// gameId en premier (toujours present), puis resourceType (souvent filtre), puis deleted
offerSchema.index({ gameId: 1, resourceType: 1, deleted: 1 });

export default mongoose.model('Offer', offerSchema);

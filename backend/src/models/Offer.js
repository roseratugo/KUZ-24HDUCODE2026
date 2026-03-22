import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  // ID de l'offre depuis l'API externe
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
  // Proprietaire de l'offre
  owner: {
    id: String,
    name: String
  },
  // Type de ressource
  resourceType: {
    type: String,
    required: true,
    index: true
  },
  // Quantite disponible
  quantity: {
    type: Number,
    required: true
  },
  // Prix unitaire
  unitPrice: {
    type: Number,
    required: true
  },
  // Date de creation de l'offre
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Derniere mise a jour depuis l'API
  lastSyncAt: {
    type: Date,
    default: Date.now
  },
  // Marquer comme supprimee (soft delete)
  deleted: {
    type: Boolean,
    default: false
  },
  // Marquer comme notre propre offre (creee par nous)
  isOwn: {
    type: Boolean,
    default: false
  }
});

// Index compose pour recherche rapide
offerSchema.index({ gameId: 1, offerId: 1 }, { unique: true });
offerSchema.index({ gameId: 1, resourceType: 1, deleted: 1 });

export default mongoose.model('Offer', offerSchema);

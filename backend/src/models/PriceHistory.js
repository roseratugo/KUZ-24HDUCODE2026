/**
 * Model PriceHistory — snapshot des prix du marketplace
 *
 * A intervalles reguliers, on enregistre un snapshot des prix par ressource :
 * prix moyen, min, max, nombre d'offres et quantite totale disponible.
 *
 * Ces snapshots sont utilises par le dashboard pour afficher des graphiques
 * d'evolution des prix (courbes BOISIUM, FERONIUM, CHARBONIUM dans le temps).
 *
 * L'index {gameId, resourceType, timestamp: -1} permet de recuperer efficacement
 * les derniers snapshots d'une ressource donnee (tri decroissant par date).
 */

import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  // Les 3 ressources primaires du jeu
  resourceType: {
    type: String,
    enum: ['BOISIUM', 'FERONIUM', 'CHARBONIUM'],
    required: true
  },
  // Prix moyen des offres actives au moment du snapshot
  avgPrice: {
    type: Number,
    required: true
  },
  // Prix le plus bas (meilleure offre)
  minPrice: {
    type: Number,
    required: true
  },
  // Prix le plus haut
  maxPrice: {
    type: Number
  },
  // Nombre d'offres actives au moment du snapshot
  offerCount: {
    type: Number,
    default: 0
  },
  // Quantite totale disponible a la vente
  totalQuantity: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index pour les requetes "historique des prix BOISIUM des 24 dernieres heures"
// Le -1 sur timestamp permet un tri decroissant efficace
priceHistorySchema.index({ gameId: 1, resourceType: 1, timestamp: -1 });

export default mongoose.model('PriceHistory', priceHistorySchema);

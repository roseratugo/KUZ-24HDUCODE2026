/**
 * Model Move — un deplacement du bateau
 *
 * Chaque fois que le bot deplace le bateau, un document Move est cree.
 * On enregistre la direction, les positions de depart/arrivee, l'energie
 * consommee et le nombre de cellules decouvertes.
 *
 * Ces donnees alimentent les statistiques du dashboard :
 * - Nombre total de mouvements
 * - Directions les plus utilisees
 * - Cellules decouvertes par mouvement
 *
 * L'index {gameId, timestamp: -1} permet de recuperer efficacement
 * les derniers mouvements (tri decroissant par date).
 */

import mongoose from 'mongoose';

const moveSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  shipId: {
    type: String,
    index: true
  },
  // Les 8 directions cardinales (N, NE, E, SE, S, SW, W, NW)
  direction: {
    type: String,
    enum: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    required: true
  },
  // Position avant le deplacement
  fromPosition: {
    x: Number,
    y: Number,
    type: { type: String }, // "type: { type: String }" car "type" est un mot reserve Mongoose
    zone: Number
  },
  // Position apres le deplacement
  toPosition: {
    x: Number,
    y: Number,
    type: { type: String },
    zone: Number
  },
  // Points de mouvement avant/apres (le bateau a une capacite limitee)
  energyBefore: Number,
  energyAfter: Number,
  // Nombre de nouvelles cellules decouvertes grace a ce deplacement
  cellsDiscovered: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index compose pour les requetes "derniers mouvements" triees par date
// Le -1 indique un tri decroissant (plus recent en premier)
moveSchema.index({ gameId: 1, timestamp: -1 });

export default mongoose.model('Move', moveSchema);

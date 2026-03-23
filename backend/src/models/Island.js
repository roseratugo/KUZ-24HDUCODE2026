/**
 * Model Island — une ile du jeu 3026
 *
 * La carte contient des centaines d'iles a decouvrir. Chaque ile a :
 * - Un nom unique
 * - Un bonus de productivite (bonusQuotient) qui augmente la production de ressources
 * - Un etat : DISCOVERED (vue) ou KNOWN (validee en accostant sur une ile connue)
 * - Une liste de cellules SAND qui la composent
 *
 * Decouvrir des iles est le coeur du jeu : plus on en decouvre, plus on produit.
 * Le premier joueur a decouvrir une ile recoit un bonus en OR.
 *
 * Index unique sur {gameId, islandId} → une seule entree par ile.
 */

import mongoose from 'mongoose';

const islandSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  // ID de l'ile dans l'API du jeu
  islandId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // Bonus de productivite : multiplie la production de la ressource principale
  bonusQuotient: {
    type: Number,
    default: 0
  },
  // DISCOVERED = vue depuis la mer, KNOWN = validee (le bateau a accost sur une ile connue)
  state: {
    type: String,
    enum: ['DISCOVERED', 'KNOWN'],
    default: 'DISCOVERED'
  },
  // Liste des cellules SAND qui composent cette ile
  cells: [{
    x: Number,
    y: Number,
    cellId: String
  }],
  discoveredAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Une seule ile par ID par partie
islandSchema.index({ gameId: 1, islandId: 1 }, { unique: true });

const Island = mongoose.model('Island', islandSchema);

export default Island;

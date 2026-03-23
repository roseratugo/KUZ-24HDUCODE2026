/**
 * Model Cell — une case de la carte du jeu
 *
 * La carte de 3026 est une grille de cellules avec des coordonnees (x, y).
 * Chaque cellule a un type :
 * - SEA  : ocean (navigable)
 * - SAND : plage (partie d'une ile, navigable aussi)
 * - ROCKS : recifs (zone dangereuse)
 *
 * Les cellules peuvent appartenir a une ile (champ island) et ont un etat :
 * - SEEN : la cellule a ete vue par le bateau
 * - VISITED : le bateau est passe dessus
 * - KNOWN : la decouverte a ete validee (retour sur une ile connue)
 *
 * Index unique sur {gameId, x, y} → une seule entree par case de la carte.
 * C'est l'index le plus important car il empeche les doublons lors du bulk upsert.
 */

import mongoose from 'mongoose';

const cellSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  x: {
    type: Number,
    required: true
  },
  y: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['SEA', 'SAND', 'ROCKS'],
    required: true
  },
  // Zone de la carte (les zones delimitent des regions avec potentiellement des risques)
  zone: {
    type: Number,
    required: true
  },
  // Si la cellule fait partie d'une ile, on stocke les infos de l'ile
  island: {
    id: String,
    name: String,
    bonusQuotient: Number
  },
  state: {
    type: String,
    enum: ['VISITED', 'SEEN', 'KNOWN'],
    default: 'SEEN'
  },
  // Date de la premiere decouverte (ne change jamais apres creation grace a $setOnInsert)
  discoveredAt: {
    type: Date,
    default: Date.now
  },
  // Date du dernier passage (mise a jour a chaque bulk upsert)
  lastSeenAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // Ajoute automatiquement createdAt et updatedAt
});

// Index unique compound : garantit qu'on ne peut pas avoir deux cellules
// aux memes coordonnees pour la meme partie. Utilise par le bulk upsert.
cellSchema.index({ gameId: 1, x: 1, y: 1 }, { unique: true });
// Index pour filtrer rapidement par type (ex: compter les cellules SEA vs SAND)
cellSchema.index({ gameId: 1, type: 1 });
// Index pour trouver toutes les cellules d'une ile donnee
cellSchema.index({ gameId: 1, 'island.id': 1 });

const Cell = mongoose.model('Cell', cellSchema);

export default Cell;

/**
 * Model ShipPosition — position actuelle du bateau
 *
 * Un seul document par partie (gameId est unique).
 * A chaque deplacement, le document est ecrase (upsert) avec les nouvelles coordonnees.
 * C'est le document le plus simple du backend.
 *
 * Le type de la cellule actuelle (SEA/SAND) et la zone sont aussi stockes
 * pour que le frontend sache si le bateau est sur l'ocean ou sur une ile.
 */

import mongoose from 'mongoose';

const shipPositionSchema = new mongoose.Schema({
  // unique: true → un seul document par partie (upsert remplace a chaque update)
  gameId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  // Type de la cellule sous le bateau (SEA ou SAND)
  type: { type: String },
  // Zone de la carte (certaines zones contiennent des risques)
  zone: { type: Number }
}, {
  timestamps: true // createdAt + updatedAt automatiques
});

export default mongoose.model('ShipPosition', shipPositionSchema);

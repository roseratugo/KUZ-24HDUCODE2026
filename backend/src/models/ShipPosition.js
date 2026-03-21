import mongoose from 'mongoose';

const shipPositionSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  type: { type: String },
  zone: { type: Number }
}, {
  timestamps: true
});

export default mongoose.model('ShipPosition', shipPositionSchema);

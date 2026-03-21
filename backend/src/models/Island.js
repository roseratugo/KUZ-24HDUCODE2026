import mongoose from 'mongoose';

const islandSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  islandId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  bonusQuotient: {
    type: Number,
    default: 0
  },
  state: {
    type: String,
    enum: ['DISCOVERED', 'KNOWN'],
    default: 'DISCOVERED'
  },
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

islandSchema.index({ gameId: 1, islandId: 1 }, { unique: true });

const Island = mongoose.model('Island', islandSchema);

export default Island;

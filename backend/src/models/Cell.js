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
  zone: {
    type: Number,
    required: true
  },
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
  discoveredAt: {
    type: Date,
    default: Date.now
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

cellSchema.index({ gameId: 1, x: 1, y: 1 }, { unique: true });
cellSchema.index({ gameId: 1, type: 1 });
cellSchema.index({ gameId: 1, 'island.id': 1 });

const Cell = mongoose.model('Cell', cellSchema);

export default Cell;

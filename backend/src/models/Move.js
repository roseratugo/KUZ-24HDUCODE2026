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
  direction: {
    type: String,
    enum: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    required: true
  },
  fromPosition: {
    x: Number,
    y: Number,
    type: { type: String },
    zone: Number
  },
  toPosition: {
    x: Number,
    y: Number,
    type: { type: String },
    zone: Number
  },
  energyBefore: Number,
  energyAfter: Number,
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

// Index for efficient queries
moveSchema.index({ gameId: 1, timestamp: -1 });

export default mongoose.model('Move', moveSchema);

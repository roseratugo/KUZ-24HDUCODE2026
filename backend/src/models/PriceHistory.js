import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    index: true
  },
  resourceType: {
    type: String,
    enum: ['BOISIUM', 'FERONIUM', 'CHARBONIUM'],
    required: true
  },
  avgPrice: {
    type: Number,
    required: true
  },
  minPrice: {
    type: Number,
    required: true
  },
  maxPrice: {
    type: Number
  },
  offerCount: {
    type: Number,
    default: 0
  },
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

// Index for efficient queries
priceHistorySchema.index({ gameId: 1, resourceType: 1, timestamp: -1 });

export default mongoose.model('PriceHistory', priceHistorySchema);

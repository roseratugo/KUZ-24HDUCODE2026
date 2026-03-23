import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  offerId: {
    type: String,
    required: true,
    index: true
  },
  gameId: {
    type: String,
    required: true,
    index: true
  },
  owner: {
    id: String,
    name: String
  },
  resourceType: {
    type: String,
    required: true,
    index: true
  },
  quantity: {
    type: Number,
    required: true
  },
  unitPrice: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastSyncAt: {
    type: Date,
    default: Date.now
  },
  deleted: {
    type: Boolean,
    default: false
  },
  isOwn: {
    type: Boolean,
    default: false
  }
});

offerSchema.index({ gameId: 1, offerId: 1 }, { unique: true });
offerSchema.index({ gameId: 1, resourceType: 1, deleted: 1 });

export default mongoose.model('Offer', offerSchema);

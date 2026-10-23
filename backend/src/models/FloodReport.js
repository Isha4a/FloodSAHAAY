const mongoose = require('mongoose');

const FloodReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed, // allows ObjectId or string for in-memory / guest
    required: true,
    index: true
  },
  userName: {
    type: String,
    default: 'Citizen'
  },
  type: {
    type: String,
    enum: ['water_level', 'road_blocked', 'bridge_damaged', 'power_outage', 'landslide', 'need_help'],
    required: true,
    index: true
  },
  waterLevel: {
    type: String,
    enum: ['ankle', 'knee', 'waist', 'chest', 'above_head', null],
    default: null,
    validate: {
      validator: function(v) {
        if (this.type === 'water_level') {
          return ['ankle', 'knee', 'waist', 'chest', 'above_head'].includes(v);
        }
        return true;
      },
      message: 'waterLevel is required and must be valid when type is water_level'
    }
  },
  description: {
    type: String,
    maxlength: 280,
    default: ''
  },
  photo: {
    type: String,
    default: ''
  },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  accuracyMeters: {
    type: Number,
    default: 10
  },
  status: {
    type: String,
    enum: ['unverified', 'verified', 'disputed', 'resolved', 'expired'],
    default: 'unverified',
    index: true
  },
  confidenceScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 40
  },
  confirmations: [{
    userId: { type: String, required: true },
    vote: { type: String, enum: ['confirm', 'dispute'], required: true },
    at: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, { timestamps: true });

// Geo / compound index if in MongoDB mode
FloodReportSchema.index({ 'location.lat': 1, 'location.lng': 1 });

module.exports = mongoose.model('FloodReport', FloodReportSchema);

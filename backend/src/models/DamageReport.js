const mongoose = require('mongoose');

const DamageReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  userName: {
    type: String,
    default: 'Citizen'
  },
  phone: {
    type: String,
    default: ''
  },
  district: {
    type: String,
    default: 'Default District',
    index: true
  },
  category: {
    type: String,
    enum: ['house', 'crop', 'vehicle', 'livestock', 'infrastructure', 'other'],
    required: true,
    index: true
  },
  severity: {
    type: String,
    enum: ['minor', 'moderate', 'severe', 'destroyed'],
    required: true,
    index: true
  },
  estimatedLossINR: {
    type: Number,
    min: 0,
    required: true
  },
  description: {
    type: String,
    maxlength: 1000,
    default: ''
  },
  photos: [{
    type: String // file path or base64 data url
  }],
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  address: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['submitted', 'under_review', 'verified', 'rejected'],
    default: 'submitted',
    index: true
  },
  reviewerNotes: {
    type: String,
    default: ''
  },
  reviewedBy: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('DamageReport', DamageReportSchema);

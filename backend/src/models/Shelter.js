const mongoose = require('mongoose');

const ShelterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true
  },
  lat: {
    type: Number,
    required: true
  },
  lng: {
    type: Number,
    required: true
  },
  capacity: {
    type: Number,
    required: true
  },
  managerId: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  currentOccupancy: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['open', 'full', 'closed', 'near_full', 'preparing'],
    default: 'open'
  },
  resources: {
    food: { type: String, enum: ['ok', 'low', 'out'], default: 'ok' },
    water: { type: String, enum: ['ok', 'low', 'out'], default: 'ok' },
    medicine: { type: String, enum: ['ok', 'low', 'out'], default: 'ok' },
    blankets: { type: String, enum: ['ok', 'low', 'out'], default: 'ok' }
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },
  amenities: [{
    type: String
  }],
  phone: {
    type: String,
    default: ''
  },
  contactPhone: {
    type: String,
    default: ''
  },
  accessibility: [{
    type: String,
    default: ['wheelchair_ramp']
  }],
  operatedBy: {
    type: String,
    default: 'Municipal Corporation'
  },
  isDemo: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Shelter', ShelterSchema);

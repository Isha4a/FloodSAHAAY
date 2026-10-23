const mongoose = require('mongoose');

const SafetyCheckinSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['safe', 'need_help', 'evacuating'],
    required: true,
    index: true
  },
  message: {
    type: String,
    maxlength: 140,
    default: ''
  },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  shareToken: {
    type: String,
    index: true,
    default: null
  },
  shareExpiresAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('SafetyCheckin', SafetyCheckinSchema);

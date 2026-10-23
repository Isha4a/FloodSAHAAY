const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  avatar: {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' }
  },
  settings: {
    notifications: {
      floodAlerts: { type: Boolean, default: true },
      sosAlerts: { type: Boolean, default: true },
      pushEnabled: { type: Boolean, default: false }
    },
    privacy: {
      shareLocation: { type: Boolean, default: true }
    },
    theme: { type: String, default: 'light' }
  },
  pushSubscription: {
    endpoint: String,
    keys: {
      p256dh: String,
      auth: String
    }
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['citizen', 'volunteer', 'shelter_manager', 'responder', 'admin'],
    default: 'citizen',
    index: true
  },
  district: {
    type: String,
    default: ''
  },
  verifiedResponder: {
    type: Boolean,
    default: false
  },
  lastKnownLocation: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);

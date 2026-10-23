const mongoose = require('mongoose');

const VolunteerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    unique: true,
    index: true
  },
  userName: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    default: ''
  },
  skills: [{
    type: String,
    enum: ['boat', 'medical', 'driving', 'food', 'rescue', 'translation']
  }],
  vehicle: {
    type: String,
    default: 'none'
  },
  capacity: {
    type: Number,
    default: 1
  },
  location: {
    lat: { type: Number, default: 26.8467 },
    lng: { type: Number, default: 80.9462 }
  },
  availability: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'available',
    index: true
  },
  languages: [{
    type: String,
    default: ['Hindi', 'English']
  }]
}, { timestamps: true });

module.exports = mongoose.model('VolunteerProfile', VolunteerProfileSchema);

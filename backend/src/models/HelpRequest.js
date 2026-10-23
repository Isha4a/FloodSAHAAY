const mongoose = require('mongoose');

const HelpRequestSchema = new mongoose.Schema({
  requesterId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  requesterName: {
    type: String,
    default: 'Citizen'
  },
  phone: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    enum: ['rescue', 'medical', 'food', 'water', 'transport', 'shelter'],
    required: true,
    index: true
  },
  urgency: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  },
  peopleCount: {
    type: Number,
    min: 1,
    default: 1
  },
  vulnerable: [{
    type: String,
    enum: ['elderly', 'infant', 'disabled', 'medical', 'pregnant']
  }],
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  address: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    maxlength: 500,
    default: ''
  },
  status: {
    type: String,
    enum: ['open', 'matched', 'in_progress', 'fulfilled', 'cancelled'],
    default: 'open',
    index: true
  },
  matchedVolunteerId: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  matchedVolunteerName: {
    type: String,
    default: ''
  },
  matchedAt: {
    type: Date,
    default: null
  },
  fulfilledAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('HelpRequest', HelpRequestSchema);

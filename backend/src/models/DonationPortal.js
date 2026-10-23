const mongoose = require('mongoose');

const DonationPortalSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  authority: {
    type: String,
    required: true,
    trim: true
  },
  // 'national' | 'state' | 'ngo'
  tier: {
    type: String,
    enum: ['national', 'state', 'ngo'],
    default: 'national'
  },
  description: {
    type: String,
    required: true
  },
  officialUrl: {
    type: String,
    required: true
  },
  // UPI Virtual Payment Address (e.g. "pmcares@sbi")
  upiId: {
    type: String,
    default: ''
  },
  // For NEFT / RTGS bank transfer info
  accountDetails: {
    bankName: { type: String, default: '' },
    accountNo: { type: String, default: '' },
    ifsc: { type: String, default: '' }
  },
  // ISO date when URL / UPI was last verified by admin
  lastVerified: {
    type: Date,
    default: Date.now
  },
  // Lower number = displayed first
  priority: {
    type: Number,
    default: 99
  },
  active: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('DonationPortal', DonationPortalSchema);

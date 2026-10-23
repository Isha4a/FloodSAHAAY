const mongoose = require('mongoose');

const IncidentLogSchema = new mongoose.Schema({
  incidentId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  incidentType: {
    type: String,
    enum: ['sos', 'report', 'shelter', 'help_request'],
    default: 'sos'
  },
  actorId: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  actorName: {
    type: String,
    default: 'Authority'
  },
  action: {
    type: String,
    enum: ['acknowledged', 'assigned', 'resolved', 'note_added', 'status_change'],
    required: true
  },
  note: {
    type: String,
    default: ''
  },
  at: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('IncidentLog', IncidentLogSchema);

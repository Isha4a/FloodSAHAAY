const EventEmitter = require('events');
const mongoose = require('mongoose');

class AdminEventEmitter extends EventEmitter {}
const adminEvents = new AdminEventEmitter();
adminEvents.setMaxListeners(100);

// In-Memory collections for standalone / offline-MongoDB mode
const inMemoryStore = {
  floodReports: [],
  safetyCheckins: [],
  incidentLogs: [],
  shelters: [],
  volunteerProfiles: [],
  helpRequests: [],
  damageReports: [],
  sosEvents: [],
  shareTokens: new Map() // token -> { userId, checkinId, expiresAt }
};

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  inMemoryStore,
  adminEvents,
  isDbConnected
};

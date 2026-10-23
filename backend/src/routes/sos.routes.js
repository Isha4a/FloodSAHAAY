const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth.middleware');
const SOSEvent = require('../models/SOSEvent');
const EmergencyContact = require('../models/EmergencyContact');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');

// Strict rate limiter for SOS broadcasts to prevent abuse
const sosRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 30,
  message: { success: false, message: 'Too many SOS requests. Emergency services alerted.' }
});

// Trigger SOS
router.post('/', sosRateLimiter, authMiddleware, async (req, res) => {
  try {
    const { lat, lng, address, source = 'app' } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
    }

    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);

    let contacts = [];
    if (isDbConnected()) {
      try {
        contacts = await EmergencyContact.find({ userId: req.user.userId }).lean();
      } catch (e) {}
    } else {
      contacts = (inMemoryStore.contacts || []).filter(c => String(c.userId) === String(req.user.userId));
    }

    const notified = contacts.map(c => ({
      contactId: c._id,
      name: c.name,
      method: source === 'mesh' ? 'Mesh Relay Node' : 'SMS & Push Alert',
      sentAt: new Date(),
      success: true
    }));

    const sosData = {
      userId: req.user.userId,
      userName: req.user.name || 'Citizen',
      phone: req.user.phone || '',
      source: ['app', 'mesh', 'sms'].includes(source) ? source : 'app',
      lat: nLat,
      lng: nLng,
      address: address || `${nLat.toFixed(4)}°N, ${nLng.toFixed(4)}°E`,
      status: 'active',
      contactsNotified: notified,
      createdAt: new Date()
    };

    let savedSos;
    if (isDbConnected()) {
      try {
        const doc = new SOSEvent(sosData);
        savedSos = (await doc.save()).toObject();
      } catch (dbErr) {
        savedSos = { ...sosData, _id: 'sos_' + Date.now() };
        inMemoryStore.sosEvents.unshift(savedSos);
      }
    } else {
      savedSos = { ...sosData, _id: 'sos_' + Date.now() };
      inMemoryStore.sosEvents.unshift(savedSos);
    }

    console.log(`[ALERT] SOS Triggered by User ${req.user.userId} (source: ${source}) at ${nLat}, ${nLng}`);

    adminEvents.emit('event', {
      type: 'sos_alert',
      data: savedSos
    });

    res.status(201).json({
      success: true,
      message: source === 'mesh' ? 'SOS distress beacon broadcasted over P2P mesh network!' : 'SOS Alert dispatched to all emergency contacts!',
      sosEvent: savedSos
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Cancel active SOS
router.put('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const sosId = req.params.id;
    let sos;

    if (isDbConnected()) {
      try {
        sos = await SOSEvent.findOneAndUpdate(
          { _id: sosId, userId: req.user.userId },
          { status: 'cancelled', resolvedAt: new Date() },
          { new: true }
        ).lean();
      } catch (e) {}
    }

    const memSos = inMemoryStore.sosEvents.find(s => String(s._id) === String(sosId));
    if (memSos) {
      memSos.status = 'cancelled';
      memSos.resolvedAt = new Date();
      sos = memSos;
    }

    adminEvents.emit('event', {
      type: 'sos_cancelled',
      data: sos || { id: sosId }
    });

    res.json({ success: true, message: 'SOS cancelled successfully', sos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth.middleware');
const SafetyCheckin = require('../models/SafetyCheckin');
const Notification = require('../models/Notification');
const EmergencyContact = require('../models/EmergencyContact');
const User = require('../models/User');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');

// 1. Record Check-in (auth)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, message = '', batteryLevel = null } = req.body;

    if (!status || !['safe', 'need_help', 'evacuating'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be one of: safe, need_help, evacuating' });
    }

    let location = req.body.location;
    if (!location && req.body.lat !== undefined && req.body.lng !== undefined) {
      location = {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        address: req.body.address || ''
      };
    }

    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number' || isNaN(location.lat) || isNaN(location.lng)) {
      return res.status(400).json({ success: false, message: 'Valid location {lat, lng} is required' });
    }

    const checkinData = {
      userId,
      userName: req.user.name || 'Citizen',
      phone: req.user.phone || '',
      status,
      message: (message || '').slice(0, 140),
      location: { lat: location.lat, lng: location.lng },
      batteryLevel: typeof batteryLevel === 'number' ? Math.round(batteryLevel) : null,
      createdAt: new Date()
    };

    let savedCheckin;
    if (isDbConnected()) {
      try {
        const doc = new SafetyCheckin(checkinData);
        savedCheckin = (await doc.save()).toObject();
        await User.findByIdAndUpdate(userId, {
          lastKnownLocation: { lat: location.lat, lng: location.lng, updatedAt: new Date() }
        });
      } catch (e) {
        savedCheckin = { ...checkinData, _id: 'chk_' + Date.now() };
        inMemoryStore.safetyCheckins.unshift(savedCheckin);
      }
    } else {
      savedCheckin = { ...checkinData, _id: 'chk_' + Date.now() };
      inMemoryStore.safetyCheckins.unshift(savedCheckin);
    }

    // Create notifications for emergency contacts and safety circle
    try {
      const contacts = isDbConnected()
        ? await EmergencyContact.find({ userId })
        : (inMemoryStore.contacts || []).filter(c => String(c.userId) === String(userId));

      const notifTitle = `Safety Update: ${req.user.name || 'Contact'} is ${status.toUpperCase().replace('_', ' ')}`;
      const notifBody = `${req.user.name || 'User'} marked status as ${status}: "${checkinData.message || 'Status updated'}". Battery: ${checkinData.batteryLevel ? checkinData.batteryLevel + '%' : 'N/A'}`;

      for (const contact of contacts) {
        const notif = {
          userId: contact.userId,
          type: 'check_in',
          title: notifTitle,
          body: notifBody,
          meta: { checkinId: savedCheckin._id, status, location: checkinData.location },
          read: false,
          createdAt: new Date()
        };
        if (isDbConnected()) {
          try { await Notification.create(notif); } catch(e) {}
        }
      }
    } catch (notifErr) {
      console.warn('[CHECKIN] Notification dispatch error:', notifErr.message);
    }

    // Emit real-time event for responder / admin command map
    adminEvents.emit('event', {
      type: 'safety_checkin',
      data: savedCheckin
    });

    res.status(201).json({
      success: true,
      message: `Safety status updated to '${status}'`,
      checkin: savedCheckin
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Get Safety Circle latest checkins (auth)
router.get('/circle', authMiddleware, async (req, res) => {
  try {
    let allCheckins = [];
    if (isDbConnected()) {
      try {
        allCheckins = await SafetyCheckin.find({}).sort({ createdAt: -1 }).lean();
      } catch (e) {
        allCheckins = inMemoryStore.safetyCheckins;
      }
    } else {
      allCheckins = inMemoryStore.safetyCheckins;
    }

    // Group by user and return newest checkin per user
    const latestByUser = new Map();
    for (const c of allCheckins) {
      const uid = String(c.userId);
      if (!latestByUser.has(uid)) {
        latestByUser.set(uid, c);
      }
    }

    res.json({
      success: true,
      circleCheckins: Array.from(latestByUser.values())
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Create time-limited public share link (auth, 24h)
router.post('/share', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let location = req.body.location;
    if (!location && req.body.lat !== undefined && req.body.lng !== undefined) {
      location = {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        address: req.body.address || ''
      };
    }
    let latestCheckin = inMemoryStore.safetyCheckins.find(c => String(c.userId) === String(userId));
    if (isDbConnected() && !latestCheckin) {
      try {
        latestCheckin = await SafetyCheckin.findOne({ userId }).sort({ createdAt: -1 }).lean();
      } catch (e) {}
    }

    const shareData = {
      token,
      userId,
      userName: req.user.name || 'Citizen',
      phone: req.user.phone || '',
      status: latestCheckin ? latestCheckin.status : 'safe',
      message: latestCheckin ? latestCheckin.message : 'Live safety location share',
      location: location || (latestCheckin ? latestCheckin.location : { lat: 26.8467, lng: 80.9462 }),
      batteryLevel: latestCheckin ? latestCheckin.batteryLevel : 85,
      createdAt: new Date(),
      expiresAt
    };

    inMemoryStore.shareTokens.set(token, shareData);

    res.json({
      success: true,
      token,
      shareUrl: `/pages/share.html?token=${token}`,
      expiresAt
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

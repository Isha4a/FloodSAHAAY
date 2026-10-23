const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const VolunteerProfile = require('../models/VolunteerProfile');
const { inMemoryStore, isDbConnected } = require('../services/store.service');
const { filterWithinRadius } = require('../services/geo.service');

// 1. GET /api/volunteers/profile (Current user's volunteer profile)
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    let profile;

    if (isDbConnected()) {
      try {
        profile = await VolunteerProfile.findOne({ userId }).lean();
      } catch (e) {}
    }

    if (!profile) {
      profile = inMemoryStore.volunteerProfiles.find(v => String(v.userId) === String(userId));
    }

    if (!profile) {
      // Return default template
      profile = {
        userId,
        userName: req.user.name || 'Volunteer',
        phone: req.user.phone || '',
        skills: ['rescue', 'driving'],
        vehicle: 'Car / SUV',
        capacity: 2,
        location: { lat: 26.8467, lng: 80.9462 },
        availability: 'available',
        languages: ['Hindi', 'English']
      };
    }

    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. PUT /api/volunteers/profile (Update volunteer profile)
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { skills, vehicle, capacity, location, availability, languages } = req.body;

    const updateData = {
      userId,
      userName: req.user.name || 'Volunteer',
      phone: req.user.phone || '',
      skills: Array.isArray(skills) ? skills : ['rescue'],
      vehicle: vehicle || 'none',
      capacity: parseInt(capacity) || 1,
      location: location || { lat: 26.8467, lng: 80.9462 },
      availability: availability || 'available',
      languages: Array.isArray(languages) ? languages : ['Hindi', 'English']
    };

    let updated;
    if (isDbConnected()) {
      try {
        updated = await VolunteerProfile.findOneAndUpdate(
          { userId },
          updateData,
          { upsert: true, new: true }
        ).lean();
      } catch (e) {}
    }

    const memIdx = inMemoryStore.volunteerProfiles.findIndex(v => String(v.userId) === String(userId));
    if (memIdx >= 0) {
      inMemoryStore.volunteerProfiles[memIdx] = { ...inMemoryStore.volunteerProfiles[memIdx], ...updateData };
      updated = inMemoryStore.volunteerProfiles[memIdx];
    } else {
      updated = { ...updateData, _id: 'vol_' + Date.now() };
      inMemoryStore.volunteerProfiles.push(updated);
    }

    res.json({
      success: true,
      message: 'Volunteer profile updated successfully.',
      profile: updated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET /api/volunteers/nearby (Nearby volunteers for coordination)
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 26.8467;
    const lng = parseFloat(req.query.lng) || 80.9462;
    const radiusKm = parseFloat(req.query.radiusKm) || 20;

    let volunteers = [];
    if (isDbConnected()) {
      try {
        volunteers = await VolunteerProfile.find({ availability: { $in: ['available', 'busy'] } }).lean();
      } catch (e) {
        volunteers = inMemoryStore.volunteerProfiles;
      }
    } else {
      volunteers = inMemoryStore.volunteerProfiles;
    }

    const nearby = filterWithinRadius(volunteers, lat, lng, radiusKm, v => v.location);

    res.json({
      success: true,
      count: nearby.length,
      volunteers: nearby
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

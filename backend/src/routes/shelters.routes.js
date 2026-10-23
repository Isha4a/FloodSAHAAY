const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Shelter = require('../models/Shelter');
const authMiddleware = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');
const { getDistanceKm } = require('../services/geo.service');

const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)));

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function findNearbyOpenStreetMapShelters(lat, lng) {
  const query = `[out:json][timeout:2];(nwr["amenity"~"shelter|community_centre|school|hospital"](around:10000,${lat},${lng}););out center tags;`;
  const response = await fetchWithTimeout(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'FloodSAHAAY-App/1.0' }
  });
  if (!response.ok) throw new Error(`Shelter lookup failed with status ${response.status}`);

  const data = await response.json();
  return (data.elements || []).map(item => {
    const tags = item.tags || {};
    const itemLat = item.lat ?? item.center?.lat;
    const itemLng = item.lon ?? item.center?.lon;
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return null;
    return {
      _id: `osm_${item.type}_${item.id}`,
      name: tags.name || tags['name:en'] || `${(tags.amenity || 'facility').replace('_', ' ')} nearby`,
      address: [tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ') || 'Address unavailable',
      lat: itemLat,
      lng: itemLng,
      capacity: Number(tags.capacity) || 150,
      currentOccupancy: 0,
      status: 'open',
      resources: { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' },
      amenities: tags.amenity === 'hospital' ? ['Medical'] : ['Water', 'Beds'],
      source: 'OpenStreetMap',
      isDemo: true
    };
  }).filter(Boolean).slice(0, 20);
}

// Helper to find shelter across DB and memory
async function findShelter(id) {
  if (isDbConnected()) {
    try {
      const s = await Shelter.findById(id);
      if (s) return { shelter: s, isDb: true };
    } catch (e) {}
  }
  const memS = inMemoryStore.shelters.find(s => String(s._id) === String(id));
  if (memS) return { shelter: memS, isDb: false };
  return { shelter: null, isDb: false };
}

// Helper to check manager authorization (shelter_manager for own shelter, or admin)
function canManageShelter(reqUser, shelter) {
  const role = reqUser.role || 'citizen';
  if (role === 'admin') return true;
  if (role === 'shelter_manager') {
    if (!shelter.managerId || String(shelter.managerId) === String(reqUser.userId)) {
      return true;
    }
  }
  return false;
}

// 1. Get nearby shelters dynamically centered on user coordinates
router.get('/', async (req, res) => {
  try {
    const userLat = parseFloat(req.query.lat) || 26.8467;
    const userLng = parseFloat(req.query.lng) || 80.9462;
    const locationName = req.query.locationName || 'Local Area';
    const shortName = locationName.split(',')[0].trim();
    let shelters = [];

    if (isDbConnected()) {
      try {
        shelters = await Shelter.find({}).lean();
      } catch (e) {
        shelters = inMemoryStore.shelters;
      }
    } else {
      shelters = inMemoryStore.shelters;
    }

    // If database and in-memory are empty, fall back to OSM or area placeholders
    if (!shelters || shelters.length === 0) {
      try {
        shelters = await findNearbyOpenStreetMapShelters(userLat, userLng);
      } catch (lookupError) {
        console.warn('[SHELTERS] OpenStreetMap lookup failed:', lookupError.message);
        shelters = [];
      }

      if (shelters.length === 0) {
        shelters = [
          { _id: `local_1_${userLat}_${userLng}`, name: `${shortName} Relief Center`, address: `Near ${shortName}`, lat: userLat + 0.006, lng: userLng + 0.007, capacity: 150, currentOccupancy: 65, status: 'open', resources: { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' }, amenities: ['Medical', 'Food', 'Water', 'Beds'], isDemo: true },
          { _id: `local_2_${userLat}_${userLng}`, name: `${shortName} Public School Shelter`, address: `Main Road, ${shortName}`, lat: userLat - 0.008, lng: userLng + 0.005, capacity: 250, currentOccupancy: 245, status: 'full', resources: { food: 'low', water: 'ok', medicine: 'low', blankets: 'ok' }, amenities: ['Water', 'Beds', 'Power'], isDemo: true },
          { _id: `local_3_${userLat}_${userLng}`, name: `${shortName} Community Hall`, address: `Central Area, ${shortName}`, lat: userLat + 0.014, lng: userLng - 0.010, capacity: 300, currentOccupancy: 85, status: 'open', resources: { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' }, amenities: ['Food', 'Water', 'Beds', 'Medical'], isDemo: true },
          { _id: `local_4_${userLat}_${userLng}`, name: `${shortName} Assembly Point`, address: `Outer Road, ${shortName}`, lat: userLat - 0.018, lng: userLng - 0.015, capacity: 120, currentOccupancy: 0, status: 'preparing', resources: { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' }, amenities: ['Food', 'Water', 'Beds'], isDemo: true }
        ];
        // Populate in-memory store with generated ones so manager can edit them
        inMemoryStore.shelters = [...shelters];
      }
    }

    // Attach computed distance & drive time, and rank full shelters lower
    const mapped = shelters.map(s => {
      const dist = getDistanceKm(userLat, userLng, s.lat, s.lng);
      const driveTime = Math.max(2, Math.round(dist * 3.2));
      const capacity = Number(s.capacity) || 100;
      const occupancy = Number(s.currentOccupancy ?? s.occupancy ?? 0);
      const isFull = s.status === 'full' || occupancy >= capacity;

      return {
        ...s,
        currentOccupancy: occupancy,
        capacity,
        resources: s.resources || { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' },
        status: isFull ? 'full' : (s.status || 'open'),
        distanceKm: parseFloat(dist.toFixed(1)),
        driveTimeMinutes: driveTime,
        isFull
      };
    });

    // Rank: Available first by distance, full shelters pushed down
    mapped.sort((a, b) => {
      if (a.isFull && !b.isFull) return 1;
      if (!a.isFull && b.isFull) return -1;
      return a.distanceKm - b.distanceKm;
    });

    res.json({ success: true, shelters: mapped });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET /api/shelters/:id (Single shelter)
router.get('/:id', async (req, res) => {
  try {
    const { shelter } = await findShelter(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: 'Shelter not found' });
    }
    res.json({ success: true, shelter });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. PUT /api/shelters/:id/occupancy (Role: shelter_manager, admin)
router.put('/:id/occupancy', authMiddleware, requireRole('shelter_manager', 'admin'), async (req, res) => {
  try {
    const { shelter, isDb } = await findShelter(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: 'Shelter not found' });
    }

    if (!canManageShelter(req.user, shelter)) {
      return res.status(403).json({ success: false, message: 'You are not assigned as manager for this shelter.' });
    }

    let { delta, occupancy } = req.body;
    let newOccupancy = shelter.currentOccupancy ?? 0;

    if (typeof occupancy === 'number') {
      newOccupancy = occupancy;
    } else if (typeof delta === 'number') {
      newOccupancy += delta;
    } else {
      return res.status(400).json({ success: false, message: 'Provide either delta or occupancy as a number.' });
    }

    const capacity = shelter.capacity || 100;
    if (newOccupancy < 0) newOccupancy = 0;
    if (newOccupancy > capacity) newOccupancy = capacity;

    shelter.currentOccupancy = newOccupancy;
    shelter.lastUpdatedAt = new Date();

    // Auto-update status
    if (newOccupancy >= capacity) {
      shelter.status = 'full';
    } else if (newOccupancy >= capacity * 0.85) {
      shelter.status = 'near_full';
    } else {
      shelter.status = 'open';
    }

    if (isDb) {
      await shelter.save();
    }

    adminEvents.emit('event', {
      type: 'shelter_updated',
      data: shelter
    });

    res.json({
      success: true,
      message: `Shelter occupancy updated to ${newOccupancy}/${capacity} (${shelter.status})`,
      shelter
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. POST /api/shelters/:id/checkin (Role: shelter_manager, admin)
router.post('/:id/checkin', authMiddleware, requireRole('shelter_manager', 'admin'), async (req, res) => {
  try {
    const { shelter, isDb } = await findShelter(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: 'Shelter not found' });
    }

    const countVal = req.body.headcount ?? req.body.count ?? 1;
    const count = Math.max(1, parseInt(countVal) || 1);
    const capacity = shelter.capacity || 100;

    let newOccupancy = (shelter.currentOccupancy || 0) + count;
    if (newOccupancy > capacity) newOccupancy = capacity;

    shelter.currentOccupancy = newOccupancy;
    shelter.lastUpdatedAt = new Date();
    if (newOccupancy >= capacity) shelter.status = 'full';
    else if (newOccupancy >= capacity * 0.85) shelter.status = 'near_full';

    if (isDb) {
      await shelter.save();
    }

    adminEvents.emit('event', {
      type: 'shelter_checkin',
      data: { shelterId: shelter._id, headcount: count, vulnerable: req.body.vulnerable || [], name: req.body.name || '' }
    });

    res.json({
      success: true,
      message: `Checked in ${count} evacuee(s). Current occupancy: ${newOccupancy}/${capacity}`,
      currentOccupancy: shelter.currentOccupancy,
      shelter
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. POST /api/shelters/:id/checkout (Role: shelter_manager, admin)
router.post('/:id/checkout', authMiddleware, requireRole('shelter_manager', 'admin'), async (req, res) => {
  try {
    const { shelter, isDb } = await findShelter(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: 'Shelter not found' });
    }

    const { headcount = 1 } = req.body;
    const count = Math.max(1, parseInt(headcount) || 1);
    const capacity = shelter.capacity || 100;

    let newOccupancy = Math.max(0, (shelter.currentOccupancy || 0) - count);
    shelter.currentOccupancy = newOccupancy;
    shelter.lastUpdatedAt = new Date();
    if (newOccupancy < capacity * 0.85) shelter.status = 'open';
    else if (newOccupancy < capacity) shelter.status = 'near_full';

    if (isDb) {
      await shelter.save();
    }

    adminEvents.emit('event', {
      type: 'shelter_checkout',
      data: { shelterId: shelter._id, headcount: count }
    });

    res.json({
      success: true,
      message: `Checked out ${count} evacuee(s). Current occupancy: ${newOccupancy}/${capacity}`,
      shelter
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. PUT /api/shelters/:id/resources (Supply levels: ok | low | out)
router.put('/:id/resources', authMiddleware, requireRole('shelter_manager', 'admin'), async (req, res) => {
  try {
    const { shelter, isDb } = await findShelter(req.params.id);
    if (!shelter) {
      return res.status(404).json({ success: false, message: 'Shelter not found' });
    }

    const { food, water, medicine, blankets } = req.body;
    const validLevels = ['ok', 'low', 'out'];

    shelter.resources = shelter.resources || { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' };
    if (food && validLevels.includes(food)) shelter.resources.food = food;
    if (water && validLevels.includes(water)) shelter.resources.water = water;
    if (medicine && validLevels.includes(medicine)) shelter.resources.medicine = medicine;
    if (blankets && validLevels.includes(blankets)) shelter.resources.blankets = blankets;
    shelter.lastUpdatedAt = new Date();

    if (isDb) {
      await shelter.save();
    }

    adminEvents.emit('event', {
      type: 'shelter_resources',
      data: shelter
    });

    res.json({
      success: true,
      message: 'Shelter supply levels updated successfully.',
      resources: shelter.resources,
      shelter
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

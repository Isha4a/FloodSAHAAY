const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const FloodReport = require('../models/FloodReport');
const HelpRequest = require('../models/HelpRequest');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');
const { getDistanceKm, filterWithinRadius } = require('../services/geo.service');
const {
  getTtlMs,
  computeEffectiveConfidence,
  getUserReputationAdjustment,
  checkUserShadowLimit
} = require('../services/reportScoring.service');

// In-memory rate limiting map: userId -> [timestamps]
const userReportTimestamps = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const timestamps = (userReportTimestamps.get(String(userId)) || []).filter(t => now - t < windowMs);
  
  if (timestamps.length >= 10) {
    return false;
  }
  timestamps.push(now);
  userReportTimestamps.set(String(userId), timestamps);
  return true;
}

// Helper to fetch user's past reports for reputation/shadow limiting
async function getUserReports(userId) {
  if (isDbConnected()) {
    try {
      return await FloodReport.find({ userId }).sort({ createdAt: -1 }).lean();
    } catch (e) {
      // fallback
    }
  }
  return inMemoryStore.floodReports.filter(r => String(r.userId) === String(userId));
}

// 1. Create a Report
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type, waterLevel, description = '', accuracyMeters = 10 } = req.body;
    const photo = req.body.photo || req.body.photoUrl || '';

    let location = req.body.location;
    if (!location && req.body.lat !== undefined && req.body.lng !== undefined) {
      location = {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        address: req.body.address || ''
      };
    }

    if (!type || !location || typeof location.lat !== 'number' || typeof location.lng !== 'number' || isNaN(location.lat) || isNaN(location.lng)) {
      return res.status(400).json({ success: false, message: 'Type and valid location {lat, lng} are required.' });
    }

    if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
      return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90, Longitude between -180 and 180.' });
    }

    const validTypes = ['water_level', 'road_blocked', 'bridge_damaged', 'power_outage', 'landslide', 'need_help'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid report type. Allowed types: ${validTypes.join(', ')}` });
    }

    if (type === 'water_level') {
      const validWaterLevels = ['ankle', 'knee', 'waist', 'chest', 'above_head'];
      if (!waterLevel || !validWaterLevels.includes(waterLevel)) {
        return res.status(400).json({ success: false, message: `waterLevel is required for water_level reports: ${validWaterLevels.join(', ')}` });
      }
    }

    if (description && description.length > 280) {
      return res.status(400).json({ success: false, message: 'Description must not exceed 280 characters.' });
    }

    // Photo validation (1.5 MB size limit)
    if (photo) {
      const isBase64 = photo.startsWith('data:image/');
      const isUrl = photo.startsWith('http://') || photo.startsWith('https://');
      if (!isBase64 && !isUrl) {
        return res.status(400).json({ success: false, message: 'Photo must be an image URL or valid base64 image data.' });
      }
      if (isBase64) {
        const approxBytes = (photo.length * 3) / 4;
        if (approxBytes > 1.5 * 1024 * 1024) {
          return res.status(400).json({ success: false, message: 'Photo exceeds the 1.5 MB maximum allowed size.' });
        }
      }
    }

    // Rate limiting: 10 per hour
    if (!checkRateLimit(userId)) {
      return res.status(429).json({ success: false, message: 'Rate limit exceeded: maximum 10 reports per user per hour.' });
    }

    const pastUserReports = await getUserReports(userId);

    // Anti-Spam: Shadow limit if last 3 were disputed
    if (checkUserShadowLimit(pastUserReports)) {
      return res.status(429).json({ success: false, message: 'Submission throttled: previous reports received multiple disputes. Please try again later.' });
    }

    // Anti-Spam: Duplicate suppression (same user, same type, within 100m, within 15 mins)
    const fifteenMinsAgo = Date.now() - (15 * 60 * 1000);
    const recentSameType = pastUserReports.filter(r => 
      r.type === type && 
      new Date(r.createdAt).getTime() > fifteenMinsAgo
    );

    for (const r of recentSameType) {
      const rLat = r.location?.lat ?? r.lat;
      const rLng = r.location?.lng ?? r.lng;
      const distKm = getDistanceKm(location.lat, location.lng, rLat, rLng);
      if (distKm <= 0.1) { // 100 meters
        return res.status(409).json({
          success: false,
          message: 'Duplicate report detected: you submitted a similar report at this location within the last 15 minutes.'
        });
      }
    }

    // Calculate initial confidence & TTL
    const ttlMs = getTtlMs(type);
    const now = Date.now();
    const createdAt = req.body.createdAt ? new Date(req.body.createdAt) : new Date(now);
    const expiresAt = new Date(createdAt.getTime() + ttlMs);

    const userRepAdjustment = getUserReputationAdjustment(pastUserReports);
    let initialScore = 40;
    if (photo) initialScore += 10;
    initialScore += userRepAdjustment;
    initialScore = Math.max(0, Math.min(100, initialScore));

    const initialStatus = initialScore >= 70 ? 'verified' : (initialScore <= 20 ? 'disputed' : 'unverified');

    const reportData = {
      userId,
      userName: req.user.name || 'Citizen',
      type,
      waterLevel: type === 'water_level' ? waterLevel : null,
      description: description.trim(),
      photo: photo || '',
      location: { lat: location.lat, lng: location.lng },
      accuracyMeters,
      status: initialStatus,
      confidenceScore: initialScore,
      confirmations: [],
      createdAt,
      expiresAt
    };

    let savedReport;

    if (isDbConnected()) {
      try {
        const newReport = new FloodReport(reportData);
        savedReport = (await newReport.save()).toObject();
      } catch (dbErr) {
        console.warn('[REPORTS] Mongo save failed, falling back to memory:', dbErr.message);
        savedReport = { ...reportData, _id: 'rep_' + Date.now() };
        inMemoryStore.floodReports.unshift(savedReport);
      }
    } else {
      savedReport = { ...reportData, _id: 'rep_' + Date.now() };
      inMemoryStore.floodReports.unshift(savedReport);
    }

    // If type === 'need_help', auto-create a HelpRequest
    if (type === 'need_help') {
      const helpReq = {
        requesterId: userId,
        requesterName: req.user.name || 'Citizen in Distress',
        phone: req.user.phone || '',
        category: 'rescue',
        urgency: 4,
        peopleCount: 1,
        vulnerable: [],
        location: { lat: location.lat, lng: location.lng },
        address: description || 'Emergency need help report',
        notes: `Auto-generated from crowd report: ${description}`,
        status: 'open',
        createdAt: new Date()
      };
      if (isDbConnected()) {
        try {
          await HelpRequest.create(helpReq);
        } catch (e) {
          inMemoryStore.helpRequests.unshift({ ...helpReq, _id: 'req_' + Date.now() });
        }
      } else {
        inMemoryStore.helpRequests.unshift({ ...helpReq, _id: 'req_' + Date.now() });
      }
    }

    // Broadcast SSE to admin / responders
    adminEvents.emit('event', {
      type: 'report_created',
      data: savedReport
    });

    res.status(201).json({
      success: true,
      message: 'Flood report submitted successfully.',
      report: savedReport
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET /api/reports?lat=&lng=&radiusKm=&type=&status=
router.get('/', async (req, res) => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat) : 26.8467;
    const lng = req.query.lng ? parseFloat(req.query.lng) : 80.9462;
    const radiusKm = Math.min(50, Math.max(1, parseFloat(req.query.radiusKm) || 10));
    const filterType = req.query.type;
    const filterStatus = req.query.status;

    let allReports = [];
    if (isDbConnected()) {
      try {
        allReports = await FloodReport.find({}).lean();
      } catch (err) {
        allReports = inMemoryStore.floodReports;
      }
    } else {
      allReports = inMemoryStore.floodReports;
    }

    const now = Date.now();

    // Re-evaluate decay and filter expired
    const activeReports = [];
    for (const r of allReports) {
      const evalResult = computeEffectiveConfidence(r, now);
      if (evalResult.isExpired && r.status !== 'resolved') {
        continue;
      }

      const updatedReport = {
        ...r,
        confidenceScore: evalResult.confidenceScore,
        status: evalResult.status
      };

      if (filterType && updatedReport.type !== filterType) continue;
      if (filterStatus && updatedReport.status !== filterStatus) continue;

      activeReports.push(updatedReport);
    }

    // Filter within radius using Haversine
    const nearby = filterWithinRadius(activeReports, lat, lng, radiusKm, r => r.location || { lat: r.lat, lng: r.lng });

    res.json({
      success: true,
      count: nearby.length,
      radiusKm,
      center: { lat, lng },
      reports: nearby
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper: GET /api/reports/blocked-roads
router.get('/blocked-roads', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 26.8467;
    const lng = parseFloat(req.query.lng) || 80.9462;
    const radiusKm = Math.min(50, parseFloat(req.query.radiusKm) || 10);

    let allReports = [];
    if (isDbConnected()) {
      try {
        allReports = await FloodReport.find({
          type: { $in: ['road_blocked', 'bridge_damaged'] },
          status: { $ne: 'resolved' }
        }).lean();
      } catch (err) {
        allReports = inMemoryStore.floodReports;
      }
    } else {
      allReports = inMemoryStore.floodReports;
    }

    const blocked = allReports.filter(r => 
      ['road_blocked', 'bridge_damaged'].includes(r.type) &&
      r.status !== 'resolved' &&
      r.status !== 'expired'
    );

    const nearby = filterWithinRadius(blocked, lat, lng, radiusKm, r => r.location || { lat: r.lat, lng: r.lng });

    res.json({
      success: true,
      count: nearby.length,
      blockedRoads: nearby
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET /api/reports/:id
router.get('/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    let report;

    if (isDbConnected()) {
      try {
        report = await FloodReport.findById(reportId).lean();
      } catch (e) {
        // invalid ObjectId format
      }
    }

    if (!report) {
      report = inMemoryStore.floodReports.find(r => String(r._id) === String(reportId));
    }

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const evalResult = computeEffectiveConfidence(report, Date.now());
    const confirmations = report.confirmations || [];
    const confirmCount = confirmations.filter(c => c.vote === 'confirm').length;
    const disputeCount = confirmations.filter(c => c.vote === 'dispute').length;

    res.json({
      success: true,
      report: {
        ...report,
        confidenceScore: evalResult.confidenceScore,
        status: evalResult.status,
        confirmCount,
        disputeCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. POST /api/reports/:id/vote (auth)
router.post('/:id/vote', authMiddleware, async (req, res) => {
  try {
    const reportId = req.params.id;
    const userId = String(req.user.userId);
    const { vote, lat, lng } = req.body;

    if (!vote || !['confirm', 'dispute'].includes(vote)) {
      return res.status(400).json({ success: false, message: "Vote must be either 'confirm' or 'dispute'." });
    }

    let report;
    let isDb = false;

    if (isDbConnected()) {
      try {
        report = await FloodReport.findById(reportId);
        if (report) isDb = true;
      } catch (e) {}
    }

    if (!report) {
      report = inMemoryStore.floodReports.find(r => String(r._id) === String(reportId));
    }

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // A user cannot vote on their own report
    if (String(report.userId) === userId) {
      return res.status(403).json({ success: false, message: 'You cannot vote on your own report.' });
    }

    // Voter must be within 2 km of the report location
    const repLat = report.location?.lat ?? report.lat;
    const repLng = report.location?.lng ?? report.lng;
    const voterLat = Number(lat);
    const voterLng = Number(lng);

    if (Number.isFinite(voterLat) && Number.isFinite(voterLng)) {
      const distanceToReport = getDistanceKm(voterLat, voterLng, repLat, repLng);
      if (distanceToReport > 2.0) {
        return res.status(403).json({
          success: false,
          message: `You must be within 2 km of the incident to verify it (you are ${distanceToReport.toFixed(1)} km away).`
        });
      }
    }

    // A user can vote once per report; changing vote overwrites it
    let confirmations = report.confirmations || [];
    const existingIndex = confirmations.findIndex(c => String(c.userId) === userId);
    const isNewConfirm = vote === 'confirm' && (existingIndex === -1 || confirmations[existingIndex].vote !== 'confirm');

    if (existingIndex >= 0) {
      confirmations[existingIndex].vote = vote;
      confirmations[existingIndex].at = new Date();
    } else {
      confirmations.push({ userId, vote, at: new Date() });
    }

    report.confirmations = confirmations;

    // Fresh confirm extends expiresAt by 50% of the original TTL
    if (isNewConfirm) {
      const originalTtl = getTtlMs(report.type);
      const extensionMs = Math.round(originalTtl * 0.5);
      const currentExpiry = new Date(report.expiresAt).getTime();
      report.expiresAt = new Date(Math.max(Date.now() + 1000 * 60 * 30, currentExpiry + extensionMs));
    }

    // Recompute effective confidence & status
    const evalResult = computeEffectiveConfidence(report, Date.now());
    report.confidenceScore = evalResult.confidenceScore;
    report.status = evalResult.status;

    if (isDb) {
      await report.save();
    }

    adminEvents.emit('event', {
      type: 'report_voted',
      data: report
    });

    const confirmCount = confirmations.filter(c => c.vote === 'confirm').length;
    const disputeCount = confirmations.filter(c => c.vote === 'dispute').length;

    res.json({
      success: true,
      message: `Vote recorded: ${vote}`,
      confidenceScore: report.confidenceScore,
      status: report.status,
      report: {
        _id: report._id,
        status: report.status,
        confidenceScore: report.confidenceScore,
        confirmCount,
        disputeCount,
        expiresAt: report.expiresAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. PUT /api/reports/:id/resolve (auth, owner or admin/responder)
router.put('/:id/resolve', authMiddleware, async (req, res) => {
  try {
    const reportId = req.params.id;
    const userId = String(req.user.userId);
    const userRole = req.user.role || 'citizen';

    let report;
    let isDb = false;

    if (isDbConnected()) {
      try {
        report = await FloodReport.findById(reportId);
        if (report) isDb = true;
      } catch (e) {}
    }

    if (!report) {
      report = inMemoryStore.floodReports.find(r => String(r._id) === String(reportId));
    }

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const isOwner = String(report.userId) === userId;
    const isAuthority = ['admin', 'responder'].includes(userRole);

    if (!isOwner && !isAuthority) {
      return res.status(403).json({ success: false, message: 'Only the author or an emergency responder/admin can resolve this report.' });
    }

    report.status = 'resolved';

    if (isDb) {
      await report.save();
    }

    adminEvents.emit('event', {
      type: 'report_resolved',
      data: report
    });

    res.json({
      success: true,
      message: 'Report marked as resolved.',
      report
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Periodic background job (every 5 minutes) to expire reports
setInterval(() => {
  try {
    const now = Date.now();
    for (const r of inMemoryStore.floodReports) {
      if (r.status !== 'resolved' && r.status !== 'expired') {
        const evalResult = computeEffectiveConfidence(r, now);
        if (evalResult.isExpired) {
          r.status = 'expired';
          r.confidenceScore = 0;
        } else {
          r.confidenceScore = evalResult.confidenceScore;
          r.status = evalResult.status;
        }
      }
    }
  } catch (e) {
    console.warn('[REPORTS DECAY JOB] Error during periodic decay:', e.message);
  }
}, 5 * 60 * 1000);

module.exports = router;

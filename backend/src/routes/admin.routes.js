const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const User = require('../models/User');
const Shelter = require('../models/Shelter');
const FloodReport = require('../models/FloodReport');
const SOSEvent = require('../models/SOSEvent');
const SafetyCheckin = require('../models/SafetyCheckin');
const VolunteerProfile = require('../models/VolunteerProfile');
const HelpRequest = require('../models/HelpRequest');
const DamageReport = require('../models/DamageReport');
const IncidentLog = require('../models/IncidentLog');
const Notification = require('../models/Notification');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');
const { inMemoryUsers } = require('../controllers/auth.controller');
const { getDistanceKm, filterWithinRadius } = require('../services/geo.service');

// SSE Authentication helper (accepts ?token= or Authorization header)
function sseAuthMiddleware(req, res, next) {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication token required for event stream.' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'super_secret_floodsahaay_jwt_key_2026_dev';
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (e) {
      decoded = jwt.verify(token, 'super_secret_limitflood_jwt_key_2026_dev');
    }

    req.user = decoded;
    const role = decoded.role || 'citizen';
    if (!['admin', 'responder'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin or responder role required.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired stream token.' });
  }
}

// 1. GET /api/admin/stream (SSE)
router.get('/stream', sseAuthMiddleware, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Admin SSE stream established', timestamp: new Date() })}\n\n`);

  const onEvent = (eventData) => {
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch (e) {
      console.warn('[SSE WRITE ERROR]', e.message);
    }
  };

  adminEvents.on('event', onEvent);

  // Heartbeat every 15 seconds to keep connection alive
  const heartbeatTimer = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    adminEvents.off('event', onEvent);
  });
});

// Protect all remaining admin endpoints
router.use(authMiddleware);

// 2. GET /api/admin/stats
router.get('/stats', requireRole('admin', 'responder'), async (req, res) => {
  try {
    let sosList = [], reportsList = [], sheltersList = [], volunteersList = [];

    if (isDbConnected()) {
      try {
        sosList = await SOSEvent.find({ status: 'active' }).lean();
        reportsList = await FloodReport.find({ status: { $ne: 'resolved' } }).lean();
        sheltersList = await Shelter.find({}).lean();
        volunteersList = await VolunteerProfile.find({ availability: 'available' }).lean();
      } catch (e) {
        sosList = inMemoryStore.sosEvents.filter(s => s.status === 'active');
        reportsList = inMemoryStore.floodReports.filter(r => r.status !== 'resolved');
        sheltersList = inMemoryStore.shelters;
        volunteersList = inMemoryStore.volunteerProfiles.filter(v => v.availability === 'available');
      }
    } else {
      sosList = inMemoryStore.sosEvents.filter(s => s.status === 'active');
      reportsList = inMemoryStore.floodReports.filter(r => r.status !== 'resolved');
      sheltersList = inMemoryStore.shelters;
      volunteersList = inMemoryStore.volunteerProfiles.filter(v => v.availability === 'available');
    }

    const unverifiedReports = reportsList.filter(r => r.status === 'unverified').length;
    const verifiedHazards = reportsList.filter(r => r.status === 'verified').length;
    const sheltersNearCapacity = sheltersList.filter(s => {
      const cap = Number(s.capacity) || 1;
      const occ = Number(s.currentOccupancy ?? s.occupancy) || 0;
      return (occ / cap) >= 0.85;
    }).length;

    res.json({
      success: true,
      stats: {
        activeSOS: sosList.length,
        totalReports: reportsList.length,
        unverifiedReports,
        verifiedHazards,
        sheltersNearCapacity,
        volunteersAvailable: volunteersList.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET /api/admin/incidents (Prioritized Triage Queue)
router.get('/incidents', requireRole('admin', 'responder'), async (req, res) => {
  try {
    const { district, timeWindowHours, type, status, query } = req.query;

    let sosList = [], reportsList = [], helpRequests = [];

    if (isDbConnected()) {
      try {
        sosList = await SOSEvent.find({}).sort({ createdAt: -1 }).lean();
        reportsList = await FloodReport.find({}).sort({ createdAt: -1 }).lean();
        helpRequests = await HelpRequest.find({}).sort({ createdAt: -1 }).lean();
      } catch (e) {
        sosList = inMemoryStore.sosEvents;
        reportsList = inMemoryStore.floodReports;
        helpRequests = inMemoryStore.helpRequests;
      }
    } else {
      sosList = inMemoryStore.sosEvents;
      reportsList = inMemoryStore.floodReports;
      helpRequests = inMemoryStore.helpRequests;
    }

    const incidents = [];
    const now = Date.now();

    // Map SOS events
    for (const s of sosList) {
      const ageHours = (now - new Date(s.createdAt).getTime()) / (3600 * 1000);
      let priorityScore = Math.max(10, Math.round(90 - ageHours * 5)); // Fresh SOS starts ~90
      if (s.source === 'mesh') priorityScore += 5; // mesh is high urgency

      incidents.push({
        id: String(s._id),
        type: 'sos',
        source: s.source || 'app',
        title: `EMERGENCY SOS: ${s.userName || 'Citizen'}`,
        description: s.address || 'Distress SOS ping triggered',
        reporterName: s.userName || 'Citizen',
        phone: s.phone || '',
        location: { lat: s.lat, lng: s.lng },
        status: s.status || 'active',
        priorityScore: Math.min(100, Math.max(1, priorityScore)),
        createdAt: s.createdAt,
        raw: s
      });
    }

    // Map citizen reports (especially need_help, road_blocked, water_level)
    for (const r of reportsList) {
      if (r.status === 'expired') continue;
      const ageHours = (now - new Date(r.createdAt).getTime()) / (3600 * 1000);
      let priorityScore = Math.round((r.confidenceScore || 40) * 0.6);
      if (r.type === 'need_help') priorityScore += 35;
      else if (r.type === 'road_blocked' || r.type === 'bridge_damaged') priorityScore += 20;
      priorityScore = Math.max(5, Math.round(priorityScore - ageHours * 2));

      incidents.push({
        id: String(r._id),
        type: 'report',
        reportType: r.type,
        title: `Report: ${r.type.toUpperCase().replace('_', ' ')}`,
        description: r.description || `Water level: ${r.waterLevel || 'unspecified'}`,
        reporterName: r.userName || 'Citizen',
        phone: '',
        location: r.location || { lat: r.lat, lng: r.lng },
        status: r.status || 'unverified',
        confidenceScore: r.confidenceScore,
        priorityScore: Math.min(100, Math.max(1, priorityScore)),
        createdAt: r.createdAt,
        raw: r
      });
    }

    // Map help requests
    for (const h of helpRequests) {
      const ageHours = (now - new Date(h.createdAt).getTime()) / (3600 * 1000);
      let priorityScore = (h.urgency || 3) * 16 + (h.peopleCount || 1) * 3;
      if (h.vulnerable && h.vulnerable.length > 0) priorityScore += h.vulnerable.length * 5;
      priorityScore = Math.max(5, Math.round(priorityScore - ageHours * 2));

      incidents.push({
        id: String(h._id),
        type: 'help_request',
        category: h.category,
        title: `Help Request: ${h.category.toUpperCase()} (${h.peopleCount || 1} pax)`,
        description: h.notes || h.address,
        reporterName: h.requesterName || 'Citizen',
        phone: h.phone || '',
        location: h.location,
        status: h.status || 'open',
        priorityScore: Math.min(100, Math.max(1, priorityScore)),
        createdAt: h.createdAt,
        raw: h
      });
    }

    // Apply filters
    let filtered = incidents;

    if (type) {
      filtered = filtered.filter(i => i.type === type || i.reportType === type || i.category === type);
    }

    if (status) {
      filtered = filtered.filter(i => i.status === status);
    }

    if (timeWindowHours) {
      const maxAgeMs = parseFloat(timeWindowHours) * 3600 * 1000;
      filtered = filtered.filter(i => (now - new Date(i.createdAt).getTime()) <= maxAgeMs);
    }

    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(i => 
        (i.reporterName && i.reporterName.toLowerCase().includes(q)) ||
        (i.phone && i.phone.includes(q)) ||
        (i.description && i.description.toLowerCase().includes(q)) ||
        (i.title && i.title.toLowerCase().includes(q))
      );
    }

    // Sort by priorityScore descending
    filtered.sort((a, b) => b.priorityScore - a.priorityScore);

    res.json({
      success: true,
      count: filtered.length,
      incidents: filtered
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. POST /api/admin/incidents/:id/action (Triage actions: acknowledge, assign, resolve, note)
router.post('/incidents/:id/action', requireRole('admin', 'responder'), async (req, res) => {
  try {
    const incidentId = req.params.id;
    const actorId = req.user.userId;
    const actorName = req.user.name || 'Emergency Responder';
    const { action, note = '', assignedTo = null, incidentType = 'sos' } = req.body;

    const validActions = ['acknowledged', 'assigned', 'dispatched', 'dispatch_team', 'resolved', 'note_added', 'status_change'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action type.' });
    }

    const logEntry = {
      incidentId,
      incidentType,
      actorId,
      actorName,
      action,
      note: note.trim() || `Incident ${action}`,
      at: new Date()
    };

    if (isDbConnected()) {
      try {
        await IncidentLog.create(logEntry);
      } catch (e) {
        inMemoryStore.incidentLogs.push({ ...logEntry, _id: 'log_' + Date.now() });
      }
    } else {
      inMemoryStore.incidentLogs.push({ ...logEntry, _id: 'log_' + Date.now() });
    }

    // Update the incident itself
    if (incidentType === 'sos') {
      const newStatus = action === 'resolved' ? 'resolved' : (action === 'acknowledged' ? 'acknowledged' : 'active');
      if (isDbConnected()) {
        try { await SOSEvent.findByIdAndUpdate(incidentId, { status: newStatus, resolvedAt: action === 'resolved' ? new Date() : undefined }); } catch(e){}
      }
      const memSOS = inMemoryStore.sosEvents.find(s => String(s._id) === String(incidentId));
      if (memSOS) memSOS.status = newStatus;
    } else if (incidentType === 'report') {
      const newStatus = action === 'resolved' ? 'resolved' : 'verified';
      if (isDbConnected()) {
        try { await FloodReport.findByIdAndUpdate(incidentId, { status: newStatus }); } catch(e){}
      }
      const memRep = inMemoryStore.floodReports.find(r => String(r._id) === String(incidentId));
      if (memRep) memRep.status = newStatus;
    } else if (incidentType === 'help_request') {
      const newStatus = action === 'resolved' ? 'fulfilled' : (action === 'assigned' ? 'matched' : 'in_progress');
      if (isDbConnected()) {
        try { await HelpRequest.findByIdAndUpdate(incidentId, { status: newStatus, matchedVolunteerName: assignedTo }); } catch(e){}
      }
      const memReq = inMemoryStore.helpRequests.find(h => String(h._id) === String(incidentId));
      if (memReq) {
        memReq.status = newStatus;
        if (assignedTo) memReq.matchedVolunteerName = assignedTo;
      }
    }

    adminEvents.emit('event', {
      type: 'incident_action',
      data: logEntry
    });

    res.json({
      success: true,
      message: `Action '${action}' recorded successfully.`,
      log: logEntry
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. GET /api/admin/incidents/:id/logs (Audit Trail)
router.get('/incidents/:id/logs', requireRole('admin', 'responder'), async (req, res) => {
  try {
    const incidentId = req.params.id;
    let logs = [];

    if (isDbConnected()) {
      try {
        logs = await IncidentLog.find({ incidentId }).sort({ at: 1 }).lean();
      } catch (e) {
        logs = inMemoryStore.incidentLogs.filter(l => String(l.incidentId) === String(incidentId));
      }
    } else {
      logs = inMemoryStore.incidentLogs.filter(l => String(l.incidentId) === String(incidentId));
    }

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. GET /api/admin/export/incidents.csv
router.get('/export/incidents.csv', requireRole('admin', 'responder'), async (req, res) => {
  try {
    let sosList = [], reportsList = [], helpList = [];
    if (isDbConnected()) {
      try {
        sosList = await SOSEvent.find({}).lean();
        reportsList = await FloodReport.find({}).lean();
        helpList = await HelpRequest.find({}).lean();
      } catch(e) {
        sosList = inMemoryStore.sosEvents;
        reportsList = inMemoryStore.floodReports;
        helpList = inMemoryStore.helpRequests;
      }
    } else {
      sosList = inMemoryStore.sosEvents;
      reportsList = inMemoryStore.floodReports;
      helpList = inMemoryStore.helpRequests;
    }

    const rows = [
      ['Timestamp', 'Incident_Type', 'Subtype', 'Status', 'Reporter_Name', 'Phone', 'Latitude', 'Longitude', 'Details']
    ];

    for (const s of sosList) {
      rows.push([
        new Date(s.createdAt).toISOString(),
        'SOS',
        s.source || 'app',
        s.status,
        `"${(s.userName || 'Citizen').replace(/"/g, '""')}"`,
        s.phone || '',
        s.lat,
        s.lng,
        `"${(s.address || '').replace(/"/g, '""')}"`
      ]);
    }

    for (const r of reportsList) {
      rows.push([
        new Date(r.createdAt).toISOString(),
        'Citizen_Report',
        r.type,
        r.status,
        `"${(r.userName || 'Citizen').replace(/"/g, '""')}"`,
        '',
        r.location?.lat ?? r.lat,
        r.location?.lng ?? r.lng,
        `"${(r.description || '').replace(/"/g, '""')}"`
      ]);
    }

    for (const h of helpList) {
      rows.push([
        new Date(h.createdAt).toISOString(),
        'Help_Request',
        h.category,
        h.status,
        `"${(h.requesterName || 'Citizen').replace(/"/g, '""')}"`,
        h.phone || '',
        h.location?.lat,
        h.location?.lng,
        `"${(h.notes || '').replace(/"/g, '""')}"`
      ]);
    }

    const csvContent = rows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="flood_incidents_export.csv"');
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 7. POST /api/admin/broadcast (Area Alert)
router.post('/broadcast', requireRole('admin', 'responder'), async (req, res) => {
  try {
    const { title, message, severity = 'warning', center, radiusKm = 10 } = req.body;

    if (!title || !message || !center || typeof center.lat !== 'number' || typeof center.lng !== 'number') {
      return res.status(400).json({ success: false, message: 'Title, message, and center {lat, lng} are required.' });
    }

    // Create system alert
    const alertData = {
      userId: 'system',
      type: 'flood_alert',
      title: `[EMERGENCY BROADCAST] ${title}`,
      body: message,
      meta: { severity, center, radiusKm },
      read: false,
      createdAt: new Date()
    };

    if (isDbConnected()) {
      try {
        await Notification.create(alertData);
      } catch (e) {
        inMemoryStore.notifications = inMemoryStore.notifications || [];
        inMemoryStore.notifications.unshift({ ...alertData, _id: 'notif_' + Date.now() });
      }
    }

    adminEvents.emit('event', {
      type: 'broadcast_alert',
      data: alertData
    });

    res.status(201).json({
      success: true,
      message: `Area broadcast dispatched to all residents within ${radiusKm} km radius.`,
      alert: alertData
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 8. PUT /api/admin/users/:id/role (Admin only)
router.put('/users/:id/role', requireRole('admin'), async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { role, district, verifiedResponder } = req.body;

    const validRoles = ['citizen', 'volunteer', 'shelter_manager', 'responder', 'admin'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Allowed: ${validRoles.join(', ')}` });
    }

    let updatedUser;
    if (isDbConnected()) {
      try {
        const updateFields = {};
        if (role) updateFields.role = role;
        if (district !== undefined) updateFields.district = district;
        if (verifiedResponder !== undefined) updateFields.verifiedResponder = verifiedResponder;

        updatedUser = await User.findByIdAndUpdate(targetUserId, updateFields, { new: true }).select('-passwordHash').lean();
      } catch (e) {}
    }

    const memUser = (inMemoryUsers || []).find(u => String(u._id || u.id) === String(targetUserId));
    if (memUser) {
      if (role) memUser.role = role;
      if (district !== undefined) memUser.district = district;
      if (verifiedResponder !== undefined) memUser.verifiedResponder = verifiedResponder;
      updatedUser = memUser;
    }

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: `User role updated to '${role || updatedUser.role}'`,
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 9. GET /api/admin/users (Admin only list of registered users)
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    let users = [];
    if (isDbConnected()) {
      try {
        users = await User.find({}).select('-passwordHash').lean();
      } catch (e) {
        users = inMemoryUsers;
      }
    } else {
      users = inMemoryUsers;
    }

    res.json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        id: u._id || u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role || 'citizen',
        district: u.district || '',
        verifiedResponder: Boolean(u.verifiedResponder)
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

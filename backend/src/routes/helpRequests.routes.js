const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const HelpRequest = require('../models/HelpRequest');
const VolunteerProfile = require('../models/VolunteerProfile');
const { inMemoryStore, adminEvents, isDbConnected } = require('../services/store.service');
const { matchVolunteersForRequest } = require('../services/matching.service');
const { filterWithinRadius } = require('../services/geo.service');

// 1. Create Help Request (Citizens, SOS, or Auto)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { category, urgency = 3, peopleCount = 1, vulnerable = [], notes = '', address = '' } = req.body;

    let location = req.body.location;
    if (!location && req.body.lat !== undefined && req.body.lng !== undefined) {
      location = {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        address: req.body.address || ''
      };
    }

    const vuln = Array.isArray(vulnerable) && vulnerable.length > 0 
      ? vulnerable 
      : (Array.isArray(req.body.vulnerabilityFlags) ? req.body.vulnerabilityFlags : []);

    const validCategories = ['rescue', 'medical', 'food', 'water', 'transport', 'shelter'];
    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: `Category must be one of: ${validCategories.join(', ')}` });
    }

    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number' || isNaN(location.lat) || isNaN(location.lng)) {
      return res.status(400).json({ success: false, message: 'Valid location {lat, lng} is required' });
    }

    const requestData = {
      requesterId: userId,
      requesterName: req.user.name || 'Citizen',
      phone: req.user.phone || '',
      category,
      urgency: Math.min(5, Math.max(1, parseInt(urgency) || 3)),
      peopleCount: Math.max(1, parseInt(peopleCount) || 1),
      vulnerable: vuln,
      location: { lat: location.lat, lng: location.lng },
      address: address || '',
      notes: notes.slice(0, 500),
      status: 'open',
      createdAt: new Date()
    };

    let savedRequest;
    if (isDbConnected()) {
      try {
        const doc = new HelpRequest(requestData);
        savedRequest = (await doc.save()).toObject();
      } catch (e) {
        savedRequest = { ...requestData, _id: 'req_' + Date.now() };
        inMemoryStore.helpRequests.unshift(savedRequest);
      }
    } else {
      savedRequest = { ...requestData, _id: 'req_' + Date.now() };
      inMemoryStore.helpRequests.unshift(savedRequest);
    }

    adminEvents.emit('event', {
      type: 'help_request_created',
      data: savedRequest
    });

    res.status(201).json({
      success: true,
      message: 'Help request registered successfully. Volunteers have been notified.',
      request: savedRequest
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET /api/help-requests (List requests with filters)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, category, lat, lng, radiusKm, mine } = req.query;

    let all = [];
    if (isDbConnected()) {
      try {
        all = await HelpRequest.find({}).sort({ createdAt: -1 }).lean();
      } catch (e) {
        all = inMemoryStore.helpRequests;
      }
    } else {
      all = inMemoryStore.helpRequests;
    }

    let filtered = all;

    if (mine === 'true') {
      filtered = filtered.filter(r => String(r.requesterId) === String(req.user.userId));
    }

    if (status) {
      filtered = filtered.filter(r => r.status === status);
    }

    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    if (lat && lng) {
      filtered = filterWithinRadius(filtered, parseFloat(lat), parseFloat(lng), parseFloat(radiusKm) || 15, r => r.location);
    }

    res.json({
      success: true,
      count: filtered.length,
      requests: filtered
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET /api/help-requests/:id/matches (Suggest top 5 volunteers)
router.get('/:id/matches', authMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id;
    let request;
    if (isDbConnected()) {
      try { request = await HelpRequest.findById(requestId).lean(); } catch(e){}
    }
    if (!request) {
      request = inMemoryStore.helpRequests.find(r => String(r._id) === String(requestId));
    }

    if (!request) {
      return res.status(404).json({ success: false, message: 'Help request not found' });
    }

    let volunteers = [];
    if (isDbConnected()) {
      try { volunteers = await VolunteerProfile.find({}).lean(); } catch(e){}
    }
    if (!volunteers || volunteers.length === 0) {
      volunteers = inMemoryStore.volunteerProfiles;
    }

    const matches = matchVolunteersForRequest(request, volunteers);

    res.json({
      success: true,
      request: { id: request._id, category: request.category, urgency: request.urgency, location: request.location },
      matches
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. POST /api/help-requests/:id/accept (Race-Safe First Acceptor Wins)
router.post('/:id/accept', authMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id;
    const volunteerId = req.user.userId;
    const volunteerName = req.user.name || 'Field Volunteer';

    let request;
    let isDb = false;

    if (isDbConnected()) {
      try {
        request = await HelpRequest.findById(requestId);
        if (request) isDb = true;
      } catch (e) {}
    }

    if (!request) {
      request = inMemoryStore.helpRequests.find(r => String(r._id) === String(requestId));
    }

    if (!request) {
      return res.status(404).json({ success: false, message: 'Help request not found' });
    }

    // Race-safe check: only 'open' requests can be accepted
    if (request.status !== 'open') {
      return res.status(409).json({
        success: false,
        message: `This help request has already been accepted by ${request.matchedVolunteerName || 'another volunteer'}.`
      });
    }

    request.status = 'matched';
    request.matchedVolunteerId = volunteerId;
    request.matchedVolunteerName = volunteerName;
    request.matchedAt = new Date();

    if (isDb) {
      await request.save();
    }

    adminEvents.emit('event', {
      type: 'help_request_accepted',
      data: request
    });

    res.json({
      success: true,
      message: `You have successfully accepted this help request!`,
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. PUT /api/help-requests/:id/status (Update status: in_progress, fulfilled, cancelled)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status } = req.body;
    const validStatuses = ['open', 'matched', 'in_progress', 'fulfilled', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    let request;
    let isDb = false;

    if (isDbConnected()) {
      try {
        request = await HelpRequest.findById(requestId);
        if (request) isDb = true;
      } catch (e) {}
    }

    if (!request) {
      request = inMemoryStore.helpRequests.find(r => String(r._id) === String(requestId));
    }

    if (!request) {
      return res.status(404).json({ success: false, message: 'Help request not found' });
    }

    request.status = status;
    if (status === 'fulfilled') {
      request.fulfilledAt = new Date();
    }

    if (isDb) {
      await request.save();
    }

    adminEvents.emit('event', {
      type: 'help_request_status',
      data: request
    });

    res.json({
      success: true,
      message: `Help request status updated to '${status}'.`,
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

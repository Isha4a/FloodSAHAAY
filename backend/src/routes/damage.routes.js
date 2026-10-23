const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const DamageReport = require('../models/DamageReport');
const { inMemoryStore, isDbConnected } = require('../services/store.service');

// 1. POST /api/damage (Submit damage assessment report)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      category,
      severity,
      estimatedLossINR,
      description = '',
      photos = [],
      location,
      address = '',
      district = 'Lucknow'
    } = req.body;

    const validCategories = ['house', 'crop', 'vehicle', 'livestock', 'infrastructure', 'other'];
    const validSeverities = ['minor', 'moderate', 'severe', 'destroyed'];

    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: `Category must be one of: ${validCategories.join(', ')}` });
    }

    if (!severity || !validSeverities.includes(severity)) {
      return res.status(400).json({ success: false, message: `Severity must be one of: ${validSeverities.join(', ')}` });
    }

    const lossAmount = parseFloat(estimatedLossINR);
    if (!Number.isFinite(lossAmount) || lossAmount < 0) {
      return res.status(400).json({ success: false, message: 'Valid estimatedLossINR is required.' });
    }

    let loc = location;
    if (!loc && req.body.lat !== undefined && req.body.lng !== undefined) {
      loc = {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        address: address || req.body.address || ''
      };
    }

    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number' || isNaN(loc.lat) || isNaN(loc.lng)) {
      return res.status(400).json({ success: false, message: 'Valid location {lat, lng} is required.' });
    }

    // Limit photos to up to 3 and check size
    const sanitizedPhotos = Array.isArray(photos) ? photos.slice(0, 3) : [];
    for (const p of sanitizedPhotos) {
      if (typeof p === 'string' && p.startsWith('data:image/')) {
        const approxBytes = (p.length * 3) / 4;
        if (approxBytes > 1.5 * 1024 * 1024) {
          return res.status(400).json({ success: false, message: 'Each photo must not exceed 1.5 MB.' });
        }
      }
    }

    const reportData = {
      userId,
      userName: req.user.name || 'Citizen',
      phone: req.user.phone || '',
      district: district || 'Lucknow',
      category,
      severity,
      estimatedLossINR: lossAmount,
      description: (description || '').slice(0, 1000),
      photos: sanitizedPhotos,
      location: { lat: loc.lat, lng: loc.lng },
      address: address || '',
      status: 'submitted',
      reviewerNotes: '',
      createdAt: new Date()
    };

    let savedReport;
    if (isDbConnected()) {
      try {
        const doc = new DamageReport(reportData);
        savedReport = (await doc.save()).toObject();
      } catch (e) {
        savedReport = { ...reportData, _id: 'dmg_' + Date.now() };
        inMemoryStore.damageReports.unshift(savedReport);
      }
    } else {
      savedReport = { ...reportData, _id: 'dmg_' + Date.now() };
      inMemoryStore.damageReports.unshift(savedReport);
    }

    res.status(201).json({
      success: true,
      message: 'Damage assessment claim submitted successfully for authority review.',
      report: savedReport
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. GET /api/damage/mine (Citizen's own damage submissions)
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    let reports = [];

    if (isDbConnected()) {
      try {
        reports = await DamageReport.find({ userId }).sort({ createdAt: -1 }).lean();
      } catch (e) {
        reports = inMemoryStore.damageReports.filter(r => String(r.userId) === String(userId));
      }
    } else {
      reports = inMemoryStore.damageReports.filter(r => String(r.userId) === String(userId));
    }

    res.json({
      success: true,
      count: reports.length,
      reports
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. GET /api/damage (Admin/Responder list all reports with filters)
router.get('/', authMiddleware, requireRole('admin', 'responder'), async (req, res) => {
  try {
    const { category, severity, status, district } = req.query;
    let all = [];

    if (isDbConnected()) {
      try {
        all = await DamageReport.find({}).sort({ createdAt: -1 }).lean();
      } catch (e) {
        all = inMemoryStore.damageReports;
      }
    } else {
      all = inMemoryStore.damageReports;
    }

    let filtered = all;
    if (category) filtered = filtered.filter(r => r.category === category);
    if (severity) filtered = filtered.filter(r => r.severity === severity);
    if (status) filtered = filtered.filter(r => r.status === status);
    if (district) filtered = filtered.filter(r => r.district && r.district.toLowerCase() === district.toLowerCase());

    res.json({
      success: true,
      count: filtered.length,
      reports: filtered
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. PUT /api/damage/:id/review (Admin/Responder update assessment status and notes)
router.put('/:id/review', authMiddleware, requireRole('admin', 'responder'), async (req, res) => {
  try {
    const reportId = req.params.id;
    const { status } = req.body;
    const reviewerNotes = req.body.reviewerNotes || req.body.reviewNotes || '';
    const validStatuses = ['submitted', 'under_review', 'verified', 'approved', 'rejected'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    let report;
    let isDb = false;

    if (isDbConnected()) {
      try {
        report = await DamageReport.findById(reportId);
        if (report) isDb = true;
      } catch (e) {}
    }

    if (!report) {
      report = inMemoryStore.damageReports.find(r => String(r._id) === String(reportId));
    }

    if (!report) {
      return res.status(404).json({ success: false, message: 'Damage report not found.' });
    }

    report.status = status;
    report.reviewerNotes = reviewerNotes;
    report.reviewedBy = req.user.userId;
    report.reviewedAt = new Date();

    if (isDb) {
      await report.save();
    }

    res.json({
      success: true,
      message: `Damage report status updated to '${status}'.`,
      report
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. GET /api/admin/damage/summary (Aggregate damage statistics for dashboard chart)
router.get('/summary', authMiddleware, requireRole('admin', 'responder'), async (req, res) => {
  try {
    let reports = [];
    if (isDbConnected()) {
      try {
        reports = await DamageReport.find({}).lean();
      } catch (e) {
        reports = inMemoryStore.damageReports;
      }
    } else {
      reports = inMemoryStore.damageReports;
    }

    const byCategory = {};
    const bySeverity = {};
    const byDistrict = {};
    let totalLossINR = 0;

    for (const r of reports) {
      const cat = r.category || 'other';
      const sev = r.severity || 'minor';
      const dist = r.district || 'Other';
      const loss = Number(r.estimatedLossINR) || 0;

      byCategory[cat] = (byCategory[cat] || 0) + 1;
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      byDistrict[dist] = (byDistrict[dist] || 0) + loss;
      totalLossINR += loss;
    }

    res.json({
      success: true,
      summary: {
        totalReports: reports.length,
        totalLossINR,
        byCategory,
        bySeverity,
        byDistrict
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

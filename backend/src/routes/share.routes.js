const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { inMemoryStore } = require('../services/store.service');

// Stricter rate limiter on public share endpoints
const publicShareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests on public tracking endpoint. Please try again later.' }
});

router.get('/:token', publicShareLimiter, (req, res) => {
  try {
    const token = req.params.token;
    const shareData = inMemoryStore.shareTokens.get(token);

    if (!shareData) {
      return res.status(404).json({ success: false, message: 'Share link is invalid or has expired.' });
    }

    if (new Date() > new Date(shareData.expiresAt)) {
      inMemoryStore.shareTokens.delete(token);
      return res.status(410).json({ success: false, message: 'This location share link has expired.' });
    }

    res.json({
      success: true,
      location: shareData.location,
      share: {
        userName: shareData.userName,
        status: shareData.status,
        message: shareData.message,
        location: shareData.location,
        batteryLevel: shareData.batteryLevel,
        updatedAt: shareData.createdAt,
        expiresAt: shareData.expiresAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

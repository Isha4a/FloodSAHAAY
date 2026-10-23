const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const Notification = require('../models/Notification');

const mongoose = require('mongoose');

// In-memory fallback notifications store with rich sample alerts
let inMemoryNotifications = [
  {
    _id: 'n1',
    userId: 'system',
    type: 'flood_alert',
    title: '🚨 HIGH RISK ADVISORY — Gomti River Basin',
    body: 'Water level at Gomti Barrage has crossed 108.4m (Warning Level: 108.0m). Low-lying areas in Gomti Nagar and Daliganj are advised to prepare evacuation kits.',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 15)
  },
  {
    _id: 'n2',
    userId: 'system',
    type: 'shelter_update',
    title: '🏠 Emergency Shelter Capacity Update',
    body: 'Gomti Nagar Community Hall shelter is near capacity (84%). Diverting incoming evacuees to Hazratganj Relief Camp (Capacity: 62% available).',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 45)
  },
  {
    _id: 'n3',
    userId: 'system',
    type: 'warning',
    title: '🚧 Road Inundation Hazard Reported',
    body: 'Lohia Path underpass has been barricaded by traffic police due to 2.5 feet standing water. Avoid route.',
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 120)
  },
  {
    _id: 'n4',
    userId: 'system',
    type: 'info',
    title: '📡 SDRF & NDRF Rapid Response Units Deployed',
    body: '3 Motor rescue boats stationed at 1090 Chauraha for immediate civilian extraction if required.',
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 240)
  }
];

// Get user notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isDbConnected = mongoose.connection.readyState === 1;
    let notifications = [];

    if (isDbConnected) {
      notifications = await Notification.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    } else {
      notifications = inMemoryNotifications.filter(n => n.userId === req.user.userId || n.userId === 'system');
    }

    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Mark all as read
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    const isDbConnected = mongoose.connection.readyState === 1;

    if (isDbConnected) {
      await Notification.updateMany({ $or: [{ userId: req.user.userId }, { userId: 'system' }] }, { read: true });
    } else {
      inMemoryNotifications.forEach(n => {
        n.read = true;
      });
    }


    res.json({ success: true, message: 'All notifications marked as read', unreadCount: 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

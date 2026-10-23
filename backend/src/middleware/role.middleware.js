const mongoose = require('mongoose');
const User = require('../models/User');
const authController = require('../controllers/auth.controller');

/**
 * Middleware to restrict access to specific roles.
 * Supports both MongoDB mode and in-memory fallback mode.
 * Usage: requireRole('admin') or requireRole('admin', 'responder')
 */
const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      let userRole = req.user.role;

      // If role not directly present in token payload, look up user
      if (!userRole) {
        const isDbConnected = mongoose.connection.readyState === 1;
        if (isDbConnected) {
          const dbUser = await User.findById(req.user.userId).lean();
          if (dbUser) userRole = dbUser.role;
        } else {
          const memUser = (authController.inMemoryUsers || []).find(
            u => String(u._id || u.id) === String(req.user.userId)
          );
          if (memUser) userRole = memUser.role;
        }
      }

      userRole = userRole || 'citizen';
      req.user.role = userRole;

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: requires one of [${allowedRoles.join(', ')}] role(s). Your role is '${userRole}'.`
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
};

module.exports = { requireRole };

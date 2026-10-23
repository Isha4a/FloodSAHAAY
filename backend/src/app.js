const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// Security Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());

// Global Rate Limiter for general endpoints
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api', globalLimiter);

// Body Parsing Middleware (allow up to 2MB for photo data URIs)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../frontend')));

// Import Routes
const authRoutes = require('./routes/auth.routes');
const profileRoutes = require('./routes/profile.routes');
const locationRoutes = require('./routes/location.routes');
const weatherRoutes = require('./routes/weather.routes');
const floodRiskRoutes = require('./routes/floodRisk.routes');
const sosRoutes = require('./routes/sos.routes');
const contactsRoutes = require('./routes/contacts.routes');
const sheltersRoutes = require('./routes/shelters.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const donationRoutes = require('./routes/donation.routes');


// Tier 4 & Tier 5 Routes
const reportsRoutes = require('./routes/reports.routes');
const checkinsRoutes = require('./routes/checkins.routes');
const shareRoutes = require('./routes/share.routes');
const adminRoutes = require('./routes/admin.routes');
const volunteersRoutes = require('./routes/volunteers.routes');
const helpRequestsRoutes = require('./routes/helpRequests.routes');
const damageRoutes = require('./routes/damage.routes');

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/flood-risk', floodRiskRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/shelters', sheltersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/donations', donationRoutes);


// Tier 4 & Tier 5 Mounts
app.use('/api/reports', reportsRoutes);
app.use('/api/checkins', checkinsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/volunteers', volunteersRoutes);
app.use('/api/help-requests', helpRequestsRoutes);
app.use('/api/damage', damageRoutes);

// Auto-seed in-memory/dev data on startup
const { seedData } = require('./services/seed.service');
seedData().catch(err => console.error('[SEED INITIALIZATION ERROR]', err.message));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'FloodSAHAAY API Server Running',
    version: '2.0.0 (Tier 4 & Tier 5 Active)',
    timestamp: new Date()
  });
});

// Global Error Middleware
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
});

module.exports = app;

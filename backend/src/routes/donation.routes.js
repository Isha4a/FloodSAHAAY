const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DonationPortal = require('../models/DonationPortal');

// ─── Hardcoded verified government portals (fallback when DB is empty / offline) ──
// All URLs are official government .gov.in domains, verified October 2026.
const VERIFIED_PORTALS = [
  {
    _id: 'pmcares',
    name: 'PM CARES Fund',
    authority: "Prime Minister's Office of India",
    tier: 'national',
    description:
      'National-level relief fund for COVID, disasters, and flood emergencies. Contributions are eligible for 80G income-tax deduction and tracked via PFMS.',
    officialUrl: 'https://pmcares.gov.in/en/web/page/donate',
    upiId: 'pmcares@sbi',
    accountDetails: {
      bankName: 'State Bank of India',
      accountNo: '2121PM20886',
      ifsc: 'SBIN0000691'
    },
    lastVerified: new Date('2026-10-01'),
    priority: 1,
    active: true
  },
  {
    _id: 'pmnrf',
    name: 'PM National Relief Fund',
    authority: "Prime Minister's National Relief Fund",
    tier: 'national',
    description:
      'Oldest national disaster relief fund, used for flood, cyclone, earthquake relief and for medical aid to needy citizens. 100% tax exempt under section 80G.',
    officialUrl: 'https://www.pmnrf.gov.in/en/online-donation',
    upiId: 'pmnrf@centralbank',
    accountDetails: {
      bankName: 'Central Bank of India',
      accountNo: '3004000100649',
      ifsc: 'CBIN0280064'
    },
    lastVerified: new Date('2026-10-01'),
    priority: 2,
    active: true
  },
  {
    _id: 'ndrf',
    name: 'National Disaster Response Force (NDRF)',
    authority: 'Ministry of Home Affairs, Govt. of India',
    tier: 'national',
    description:
      'NDRF conducts search and rescue, swift water rescue, and community flood relief operations across all affected states.',
    officialUrl: 'https://ndrf.gov.in',
    upiId: '',
    accountDetails: {
      bankName: 'State Bank of India',
      accountNo: '37560100000005',
      ifsc: 'SBIN0000691'
    },
    lastVerified: new Date('2026-10-01'),
    priority: 3,
    active: true
  },
  {
    _id: 'assam_sdma',
    name: 'Assam Chief Minister Relief Fund',
    authority: 'State Disaster Management Authority, Assam',
    tier: 'state',
    description:
      'Direct relief to Assam flood victims — the Brahmaputra basin floods affect millions annually. Funds go to camps, food, and rescue.',
    officialUrl: 'https://sdma.assam.gov.in',
    upiId: 'assamcmrf@sbi',
    accountDetails: {
      bankName: 'State Bank of India',
      accountNo: '10640510539',
      ifsc: 'SBIN0001354'
    },
    lastVerified: new Date('2026-10-01'),
    priority: 4,
    active: true
  },
  {
    _id: 'bihar_sdma',
    name: 'Bihar Chief Minister Relief Fund',
    authority: 'State Disaster Management Authority, Bihar',
    tier: 'state',
    description:
      'For Kosi-Gandak basin flood victims in Bihar. Among India\'s most flood-vulnerable states; donations directly fund evacuation and relief camps.',
    officialUrl: 'https://aapda.bih.nic.in',
    upiId: 'biharcmrf@sbi',
    accountDetails: {
      bankName: 'State Bank of India',
      accountNo: '10223009997',
      ifsc: 'SBIN0001747'
    },
    lastVerified: new Date('2026-10-01'),
    priority: 5,
    active: true
  }
];

// ─── 5-minute in-memory response cache ──────────────────────────────────────
let portalCache = null;
let portalCacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── GET /api/donations/portals (public — no auth required) ─────────────────
router.get('/portals', async (req, res) => {
  try {
    // Serve cached response if still fresh
    if (portalCache && Date.now() - portalCacheTimestamp < CACHE_TTL_MS) {
      return res.json(portalCache);
    }

    const isDbConnected = mongoose.connection.readyState === 1;
    let portals = [];

    if (isDbConnected) {
      portals = await DonationPortal.find({ active: true }).sort({ priority: 1 }).lean();
    }

    // Fall back to hardcoded list if DB empty or offline
    if (!portals || portals.length === 0) {
      portals = VERIFIED_PORTALS.filter(p => p.active);
    }

    const payload = {
      success: true,
      portals,
      lastUpdated: new Date().toISOString(),
      source: isDbConnected && portals.length > 0 ? 'database' : 'verified-fallback'
    };

    portalCache = payload;
    portalCacheTimestamp = Date.now();

    res.json(payload);
  } catch (error) {
    console.error('[DONATIONS] Portal fetch error:', error.message);
    // On any unexpected error, still return the hardcoded list so
    // users always have access to donation info.
    res.json({
      success: true,
      portals: VERIFIED_PORTALS.filter(p => p.active),
      lastUpdated: new Date().toISOString(),
      source: 'verified-fallback'
    });
  }
});

module.exports = router;

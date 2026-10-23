const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
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
const { inMemoryStore, isDbConnected } = require('./store.service');
const { inMemoryUsers } = require('../controllers/auth.controller');

let seedPromise = null;

function seedData() {
  if (!seedPromise) {
    seedPromise = _executeSeed();
  }
  return seedPromise;
}

async function _executeSeed() {
  try {
    const salt = await bcrypt.genSalt(10);
    const demoPasswordHash = await bcrypt.hash('Password123!', salt);

    const demoUsers = [
      {
        _id: 'user_admin_001',
        name: 'Rajesh Kumar (Command Admin)',
        email: 'admin@floodsahaay.local',
        phone: '+91 98765 00001',
        passwordHash: demoPasswordHash,
        role: 'admin',
        district: 'Lucknow',
        verifiedResponder: true,
        isPhoneVerified: true
      },
      {
        _id: 'user_responder_001',
        name: 'Inspector Amit Singh (SDRF)',
        email: 'responder@floodsahaay.local',
        phone: '+91 98765 00002',
        passwordHash: demoPasswordHash,
        role: 'responder',
        district: 'Lucknow',
        verifiedResponder: true,
        isPhoneVerified: true
      },
      {
        _id: 'user_shelter_001',
        name: 'Dr. Sunita Rao (Shelter Ops)',
        email: 'shelter@floodsahaay.local',
        phone: '+91 98765 00003',
        passwordHash: demoPasswordHash,
        role: 'shelter_manager',
        district: 'Lucknow',
        verifiedResponder: true,
        isPhoneVerified: true
      },
      {
        _id: 'user_volunteer_001',
        name: 'Vikram Patel (Rescue & Boat Ops)',
        email: 'volunteer1@floodsahaay.local',
        phone: '+91 98765 00004',
        passwordHash: demoPasswordHash,
        role: 'volunteer',
        district: 'Lucknow',
        verifiedResponder: false,
        isPhoneVerified: true
      },
      {
        _id: 'user_volunteer_002',
        name: 'Pooja Sharma (Medical First Aid)',
        email: 'volunteer2@floodsahaay.local',
        phone: '+91 98765 00005',
        passwordHash: demoPasswordHash,
        role: 'volunteer',
        district: 'Lucknow',
        verifiedResponder: false,
        isPhoneVerified: true
      },
      {
        _id: 'user_citizen_001',
        name: 'Aarav Verma (Citizen)',
        email: 'citizen@floodsahaay.local',
        phone: '+91 98765 00006',
        passwordHash: demoPasswordHash,
        role: 'citizen',
        district: 'Lucknow',
        verifiedResponder: false,
        isPhoneVerified: true
      }
    ];

    const demoShelters = [
      {
        _id: 'shelter_lko_001',
        name: 'Gomti Nagar Municipal Relief Center',
        address: 'Vipin Khand, Gomti Nagar, Lucknow',
        lat: 26.8520,
        lng: 80.9920,
        capacity: 350,
        currentOccupancy: 120,
        status: 'open',
        managerId: 'user_shelter_001',
        resources: { food: 'ok', water: 'ok', medicine: 'ok', blankets: 'ok' },
        contactPhone: '+91 98765 00003',
        accessibility: ['wheelchair_ramp', 'medical_bay', 'generators'],
        operatedBy: 'Lucknow Municipal Corporation',
        lastUpdatedAt: new Date(),
        isDemo: true
      },
      {
        _id: 'shelter_lko_002',
        name: 'Hazratganj Girls High School Shelter',
        address: 'MG Marg, Hazratganj, Lucknow',
        lat: 26.8480,
        lng: 80.9460,
        capacity: 200,
        currentOccupancy: 185,
        status: 'near_full',
        managerId: 'user_shelter_001',
        resources: { food: 'low', water: 'ok', medicine: 'low', blankets: 'ok' },
        contactPhone: '+91 522 2234567',
        accessibility: ['wheelchair_ramp', 'women_safety_desk'],
        operatedBy: 'District Administration Lucknow',
        lastUpdatedAt: new Date(),
        isDemo: true
      },
      {
        _id: 'shelter_lko_003',
        name: 'Alambagh Stadium Evacuation Camp',
        address: 'VIP Road, Alambagh, Lucknow',
        lat: 26.8120,
        lng: 80.9020,
        capacity: 500,
        currentOccupancy: 500,
        status: 'full',
        managerId: 'user_shelter_001',
        resources: { food: 'low', water: 'low', medicine: 'out', blankets: 'low' },
        contactPhone: '+91 522 2456789',
        accessibility: ['wheelchair_ramp', 'large_helipad_access'],
        operatedBy: 'Disaster Relief Cell',
        lastUpdatedAt: new Date(),
        isDemo: true
      }
    ];

    const now = Date.now();
    const demoReports = [
      {
        _id: 'report_demo_001',
        userId: 'user_citizen_001',
        userName: 'Aarav Verma',
        type: 'water_level',
        waterLevel: 'waist',
        description: 'Water has risen waist-deep near Gomti riverbank road. Road completely inundated.',
        photo: 'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=400&q=80',
        location: { lat: 26.8530, lng: 80.9520 },
        accuracyMeters: 5,
        status: 'verified',
        confidenceScore: 85,
        confirmations: [
          { userId: 'user_responder_001', vote: 'confirm', at: new Date(now - 1000 * 60 * 20) },
          { userId: 'user_volunteer_001', vote: 'confirm', at: new Date(now - 1000 * 60 * 15) }
        ],
        createdAt: new Date(now - 1000 * 60 * 30),
        expiresAt: new Date(now + 1000 * 60 * 60 * 5)
      },
      {
        _id: 'report_demo_002',
        userId: 'user_volunteer_001',
        userName: 'Vikram Patel',
        type: 'road_blocked',
        description: 'Fallen tree and waterlogged underpass blocking traffic towards Hazratganj.',
        photo: '',
        location: { lat: 26.8490, lng: 80.9420 },
        accuracyMeters: 8,
        status: 'verified',
        confidenceScore: 75,
        confirmations: [
          { userId: 'user_citizen_001', vote: 'confirm', at: new Date(now - 1000 * 60 * 10) }
        ],
        createdAt: new Date(now - 1000 * 60 * 45),
        expiresAt: new Date(now + 1000 * 60 * 60 * 11)
      },
      {
        _id: 'report_demo_003',
        userId: 'user_citizen_001',
        userName: 'Aarav Verma',
        type: 'need_help',
        description: 'Elderly couple trapped on ground floor, need boat evacuation immediately.',
        photo: '',
        location: { lat: 26.8560, lng: 80.9580 },
        accuracyMeters: 10,
        status: 'verified',
        confidenceScore: 80,
        confirmations: [
          { userId: 'user_responder_001', vote: 'confirm', at: new Date(now - 1000 * 60 * 5) }
        ],
        createdAt: new Date(now - 1000 * 60 * 15),
        expiresAt: new Date(now + 1000 * 60 * 60 * 2.5)
      },
      {
        _id: 'report_demo_004',
        userId: 'user_volunteer_002',
        userName: 'Pooja Sharma',
        type: 'bridge_damaged',
        description: 'Minor structural cracks noticed on old river bridge span; cautious traffic only.',
        photo: '',
        location: { lat: 26.8610, lng: 80.9350 },
        accuracyMeters: 12,
        status: 'unverified',
        confidenceScore: 50,
        confirmations: [],
        createdAt: new Date(now - 1000 * 60 * 10),
        expiresAt: new Date(now + 1000 * 60 * 60 * 7.5)
      }
    ];

    const demoSOSEvents = [
      {
        _id: 'sos_demo_001',
        userId: 'user_citizen_001',
        userName: 'Aarav Verma',
        phone: '+91 98765 00006',
        source: 'app',
        lat: 26.8565,
        lng: 80.9575,
        address: 'Near Gomti Barrage, Sector 4, Lucknow',
        status: 'active',
        contactsNotified: [
          { name: 'Dr. Sunita Rao', method: 'SMS & Push', sentAt: new Date(now - 1000 * 60 * 12), success: true }
        ],
        createdAt: new Date(now - 1000 * 60 * 12)
      },
      {
        _id: 'sos_demo_002',
        userId: 'user_mesh_node_942',
        userName: 'Mesh Node #FS-942 (Relayed)',
        phone: 'Unregistered Radio Peer',
        source: 'mesh',
        lat: 26.8505,
        lng: 80.9490,
        address: 'Offline BLE Mesh Packet (Hop Count: 2)',
        status: 'active',
        contactsNotified: [],
        createdAt: new Date(now - 1000 * 60 * 5)
      }
    ];

    const demoCheckins = [
      {
        _id: 'chk_demo_001',
        userId: 'user_citizen_001',
        userName: 'Aarav Verma',
        phone: '+91 98765 00006',
        status: 'safe',
        message: 'Reached second floor terrace, safe for now.',
        location: { lat: 26.8475, lng: 80.9470 },
        batteryLevel: 78,
        createdAt: new Date(now - 1000 * 60 * 25)
      },
      {
        _id: 'chk_demo_002',
        userId: 'user_volunteer_001',
        userName: 'Vikram Patel',
        phone: '+91 98765 00004',
        status: 'safe',
        message: 'On rescue boat deploying near Gomti bank.',
        location: { lat: 26.8510, lng: 80.9530 },
        batteryLevel: 92,
        createdAt: new Date(now - 1000 * 60 * 10)
      }
    ];

    const demoVolunteers = [
      {
        _id: 'vol_demo_001',
        userId: 'user_volunteer_001',
        userName: 'Vikram Patel',
        phone: '+91 98765 00004',
        skills: ['boat', 'rescue', 'driving'],
        vehicle: 'Motor Inflatable Boat + SUV',
        capacity: 6,
        location: { lat: 26.8510, lng: 80.9530 },
        availability: 'available',
        languages: ['Hindi', 'English', 'Awadhi']
      },
      {
        _id: 'vol_demo_002',
        userId: 'user_volunteer_002',
        userName: 'Pooja Sharma',
        phone: '+91 98765 00005',
        skills: ['medical', 'food', 'translation'],
        vehicle: 'Ambulance Volunteer Van',
        capacity: 3,
        location: { lat: 26.8450, lng: 80.9420 },
        availability: 'available',
        languages: ['Hindi', 'English']
      }
    ];

    const demoHelpRequests = [
      {
        _id: 'req_demo_001',
        requesterId: 'user_citizen_001',
        requesterName: 'Aarav Verma',
        phone: '+91 98765 00006',
        category: 'rescue',
        urgency: 5,
        peopleCount: 4,
        vulnerable: ['elderly', 'infant'],
        location: { lat: 26.8560, lng: 80.9580 },
        address: 'House 42, Gomti Nagar Riverfront, Lucknow',
        notes: 'Water entering ground floor rooms. Need boat to move 2 seniors and 1 infant to shelter.',
        status: 'open',
        createdAt: new Date(now - 1000 * 60 * 20)
      },
      {
        _id: 'req_demo_002',
        requesterId: 'user_citizen_001',
        requesterName: 'Kamla Devi',
        phone: '+91 98765 43210',
        category: 'medical',
        urgency: 4,
        peopleCount: 1,
        vulnerable: ['medical'],
        location: { lat: 26.8490, lng: 80.9480 },
        address: 'Flat 3B, MG Marg, Hazratganj, Lucknow',
        notes: 'Diabetic patient requiring insulin pack delivery due to flooded street.',
        status: 'open',
        createdAt: new Date(now - 1000 * 60 * 40)
      }
    ];

    const demoDamageReports = [
      {
        _id: 'dmg_demo_001',
        userId: 'user_citizen_001',
        userName: 'Aarav Verma',
        phone: '+91 98765 00006',
        district: 'Lucknow',
        category: 'house',
        severity: 'severe',
        estimatedLossINR: 150000,
        description: 'Ground floor boundary wall collapsed; interior furniture and appliances destroyed by flood water.',
        photos: ['https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=400&q=80'],
        location: { lat: 26.8530, lng: 80.9520 },
        address: 'Gomti Nagar, Lucknow',
        status: 'submitted',
        createdAt: new Date(now - 1000 * 60 * 60 * 2)
      },
      {
        _id: 'dmg_demo_002',
        userId: 'user_citizen_001',
        userName: 'Ramesh Singh',
        phone: '+91 98765 11111',
        district: 'Lucknow',
        category: 'crop',
        severity: 'destroyed',
        estimatedLossINR: 280000,
        description: '4 acres of paddy cropland submerged completely under 4 feet water.',
        photos: [],
        location: { lat: 26.8200, lng: 80.9100 },
        address: 'Banthra Rural Block, Lucknow',
        status: 'under_review',
        reviewerNotes: 'Field inspection scheduled with agricultural officer.',
        createdAt: new Date(now - 1000 * 60 * 60 * 8)
      }
    ];

    const demoIncidentLogs = [
      {
        _id: 'log_demo_001',
        incidentId: 'sos_demo_001',
        incidentType: 'sos',
        actorId: 'user_responder_001',
        actorName: 'Inspector Amit Singh (SDRF)',
        action: 'acknowledged',
        note: 'SDRF Unit 4 alerted. En route to Gomti Barrage sector.',
        at: new Date(now - 1000 * 60 * 10)
      }
    ];

    // Populate in-memory store
    for (const u of demoUsers) {
      if (!inMemoryUsers.some(x => x.email === u.email)) {
        inMemoryUsers.push(u);
      }
    }
    inMemoryStore.shelters = [...demoShelters];
    inMemoryStore.floodReports = [...demoReports];
    inMemoryStore.sosEvents = [...demoSOSEvents];
    inMemoryStore.safetyCheckins = [...demoCheckins];
    inMemoryStore.volunteerProfiles = [...demoVolunteers];
    inMemoryStore.helpRequests = [...demoHelpRequests];
    inMemoryStore.damageReports = [...demoDamageReports];
    inMemoryStore.incidentLogs = [...demoIncidentLogs];

    console.log('[SEED] In-memory demo data loaded successfully.');

    // Strip custom string _id fields — Mongoose will auto-generate ObjectIds
    const stripId = (arr) => arr.map(({ _id, ...rest }) => rest);

    // Wait for MongoDB to become ready (Render may connect asynchronously)
    const waitForDb = async (maxWaitMs = 15000) => {
      const start = Date.now();
      while (!isDbConnected() && Date.now() - start < maxWaitMs) {
        await new Promise(r => setTimeout(r, 500));
      }
      return isDbConnected();
    };

    if (await waitForDb()) {
      try {
        const demoAdmin = await User.findOne({ email: 'admin@floodsahaay.local' });
        if (!demoAdmin) {
          // Remove any stale/broken demo data from a previous failed seed
          const userCount = await User.countDocuments();
          if (userCount > 0) {
            console.log(`[SEED] Found ${userCount} user(s) but no demo admin — clearing stale data for fresh seed...`);
            await User.deleteMany({ email: { $regex: /@floodsahaay\.local$/ } });
          }
          console.log('[SEED] Seeding MongoDB with initial demo data...');
          await User.insertMany(stripId(demoUsers));
          await Shelter.insertMany(stripId(demoShelters)).catch(() => {});
          await FloodReport.insertMany(stripId(demoReports)).catch(() => {});
          await SOSEvent.insertMany(stripId(demoSOSEvents)).catch(() => {});
          await SafetyCheckin.insertMany(stripId(demoCheckins)).catch(() => {});
          await VolunteerProfile.insertMany(stripId(demoVolunteers)).catch(() => {});
          await HelpRequest.insertMany(stripId(demoHelpRequests)).catch(() => {});
          await DamageReport.insertMany(stripId(demoDamageReports)).catch(() => {});
          await IncidentLog.insertMany(stripId(demoIncidentLogs)).catch(() => {});
          console.log('[SEED] MongoDB demo data seeded successfully.');
        } else {
          console.log(`[SEED] Demo admin user exists in MongoDB, skipping seed.`);
        }
      } catch (dbSeedErr) {
        console.error('[SEED] MongoDB seed error:', dbSeedErr.message);
      }
    } else {
      console.warn('[SEED] MongoDB not connected after waiting — running on in-memory data only.');
    }
  } catch (err) {
    console.error('[SEED ERROR]', err.message);
  }
}

module.exports = { seedData };

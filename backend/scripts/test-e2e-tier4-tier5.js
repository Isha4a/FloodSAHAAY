/**
 * End-to-End Integration Test Suite for Tier 4 & Tier 5 Endpoints
 */
const http = require('http');
const app = require('../src/app');

let server;
let port;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers
    };
    const req = http.request(url, {
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

const { seedData } = require('../src/services/seed.service');

async function runTests() {
  console.log('\n=============================================');
  console.log('STARTING TIER 4 & TIER 5 INTEGRATION TESTS');
  console.log('=============================================\n');

  // Ensure seed data is completely hashed and loaded
  await seedData();

  // Start test server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // 1. Auth & Roles
    console.log('\n--- 1. Testing Auth & Role Logins ---');
    const citizenLogin = await request('POST', '/api/auth/login', {
      email: 'citizen@floodsahaay.local',
      password: 'Password123!'
    });
    assert(citizenLogin.status === 200, 'Citizen login successful');
    assert(citizenLogin.data.user.role === 'citizen', 'Citizen has citizen role');
    const citizenToken = citizenLogin.data.token;

    const adminLogin = await request('POST', '/api/auth/login', {
      email: 'admin@floodsahaay.local',
      password: 'Password123!'
    });
    assert(adminLogin.status === 200, 'Admin login successful');
    assert(adminLogin.data.user.role === 'admin', 'Admin has admin role');
    const adminToken = adminLogin.data.token;

    const responderLogin = await request('POST', '/api/auth/login', {
      email: 'responder@floodsahaay.local',
      password: 'Password123!'
    });
    assert(responderLogin.status === 200, 'Responder login successful');
    assert(responderLogin.data.user.role === 'responder', 'Responder has responder role');
    const responderToken = responderLogin.data.token;

    const volunteerLogin = await request('POST', '/api/auth/login', {
      email: 'volunteer1@floodsahaay.local',
      password: 'Password123!'
    });
    assert(volunteerLogin.status === 200, 'Volunteer login successful');
    assert(volunteerLogin.data.user.role === 'volunteer', 'Volunteer has volunteer role');
    const volunteerToken = volunteerLogin.data.token;

    // 2. Part A: Tier 4 Flood Reports & Consensus Scoring
    console.log('\n--- 2. Testing Part A: Tier 4 Flood Reports & Consensus ---');
    const createReportRes = await request('POST', '/api/reports', {
      type: 'water_level',
      waterLevel: 'waist',
      description: 'Severe waterlogging at Gomti Nagar Sector 4',
      lat: 26.8520,
      lng: 80.9995,
      address: 'Sector 4, Gomti Nagar'
    }, { Authorization: `Bearer ${citizenToken}` });
    assert(createReportRes.status === 201, 'Flood report created');
    assert(createReportRes.data.report.confidenceScore >= 40, 'Initial score includes track record adjustment');
    const reportId = createReportRes.data.report._id;

    // Vote Confirm
    const voteConfirmRes = await request('POST', `/api/reports/${reportId}/vote`, {
      vote: 'confirm',
      lat: 26.8525,
      lng: 80.9990
    }, { Authorization: `Bearer ${volunteerToken}` });
    assert(voteConfirmRes.status === 200, 'Vote confirm accepted within 2km');
    assert(voteConfirmRes.data.confidenceScore > 40, `Confidence increased to ${voteConfirmRes.data.confidenceScore}`);

    // Blocked Roads query
    const blockedRoadsRes = await request('GET', '/api/reports/blocked-roads?lat=26.8500&lng=81.0000', null, {
      Authorization: `Bearer ${citizenToken}`
    });
    assert(blockedRoadsRes.status === 200, 'Blocked roads query succeeded');
    assert(Array.isArray(blockedRoadsRes.data.blockedRoads), 'Returns array of blocked roads');

    // 3. Part A: Check-ins, Battery & Public Share
    console.log('\n--- 3. Testing Part A: Safety Check-ins & Public Share ---');
    const checkinRes = await request('POST', '/api/checkins', {
      status: 'safe',
      lat: 26.8500,
      lng: 80.9990,
      batteryLevel: 14,
      message: 'Battery low, but safe.'
    }, { Authorization: `Bearer ${citizenToken}` });
    assert(checkinRes.status === 201, 'Safety check-in recorded');

    const shareTokenRes = await request('POST', '/api/checkins/share', {
      lat: 26.8500,
      lng: 80.9990
    }, { Authorization: `Bearer ${citizenToken}` });
    assert(shareTokenRes.status === 200, '24h public share token generated');
    const shareToken = shareTokenRes.data.token;

    const publicShareRes = await request('GET', `/api/share/${shareToken}`);
    assert(publicShareRes.status === 200, 'Public read-only share endpoint returned location');
    assert(publicShareRes.data.location.lat === 26.8500, 'Public share coordinates match');

    // 4. Part A: Flood Risk Crowd Signal
    console.log('\n--- 4. Testing Flood Risk Crowd Signal Integration ---');
    const floodRiskRes = await request('GET', '/api/flood-risk?lat=26.8500&lng=80.9990', null, {
      Authorization: `Bearer ${citizenToken}`
    });
    assert(floodRiskRes.status === 200, 'Flood risk endpoint succeeded');
    assert(floodRiskRes.data.data.crowdSignal !== undefined, 'Flood risk contains crowdSignal component');

    // 5. Part B: Authority Command Center
    console.log('\n--- 5. Testing Part B: Admin Command Center ---');
    const adminStatsRes = await request('GET', '/api/admin/stats', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(adminStatsRes.status === 200, 'Admin stats returned');
    assert(adminStatsRes.data.stats.totalReports >= 1, 'Total reports counted');

    const incidentsRes = await request('GET', '/api/admin/incidents', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(incidentsRes.status === 200, 'Incident triage queue returned');
    assert(Array.isArray(incidentsRes.data.incidents), 'Incidents returned as array');

    const incident = incidentsRes.data.incidents[0];
    if (incident) {
      const triageRes = await request('POST', `/api/admin/incidents/${incident.id}/action`, {
        action: 'dispatch_team',
        notes: 'Dispatched NDRF Boat 2 to location'
      }, { Authorization: `Bearer ${adminToken}` });
      assert(triageRes.status === 200, 'Incident action logged with audit trail');

      const logsRes = await request('GET', `/api/admin/incidents/${incident.id}/logs`, null, {
        Authorization: `Bearer ${adminToken}`
      });
      assert(logsRes.status === 200, 'Incident audit trail returned');
      assert(logsRes.data.logs.length >= 1, 'At least 1 audit log entry present');
    }

    // Role-based protection test
    const citizenForbidden = await request('GET', '/api/admin/stats', null, {
      Authorization: `Bearer ${citizenToken}`
    });
    assert(citizenForbidden.status === 403, 'Citizen blocked from admin stats (403 Forbidden)');

    // 6. Part B: Shelter Occupancy Management
    console.log('\n--- 6. Testing Part B: Shelter Occupancy Management ---');
    const sheltersRes = await request('GET', '/api/shelters', null, {
      Authorization: `Bearer ${citizenToken}`
    });
    const shelter = sheltersRes.data.shelters[0];
    assert(shelter !== undefined, 'At least one shelter exists');

    const checkinShelterRes = await request('POST', `/api/shelters/${shelter._id}/checkin`, {
      count: 2
    }, { Authorization: `Bearer ${adminToken}` });
    assert(checkinShelterRes.status === 200, 'Shelter check-in updated occupancy');
    assert(checkinShelterRes.data.currentOccupancy === shelter.currentOccupancy + 2, 'Occupancy incremented by 2');

    // 7. Part B: Volunteer & Help Request Matching
    console.log('\n--- 7. Testing Part B: Volunteers & Help Requests ---');
    const helpReqRes = await request('POST', '/api/help-requests', {
      category: 'rescue',
      urgency: 5,
      peopleCount: 3,
      vulnerabilityFlags: ['elderly', 'infant'],
      address: 'Submerged building near River bank',
      lat: 26.8530,
      lng: 80.9980
    }, { Authorization: `Bearer ${citizenToken}` });
    assert(helpReqRes.status === 201, 'Emergency help request created');
    const helpReqId = helpReqRes.data.request._id;

    // Matching
    const matchesRes = await request('GET', `/api/help-requests/${helpReqId}/matches`, null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(matchesRes.status === 200, 'Matched volunteers calculated');
    assert(Array.isArray(matchesRes.data.matches), 'Matches returned as array');

    // Race-safe Claim
    const acceptRes = await request('POST', `/api/help-requests/${helpReqId}/accept`, {}, {
      Authorization: `Bearer ${volunteerToken}`
    });
    assert(acceptRes.status === 200, 'Volunteer successfully accepted request');

    // Second accept should return 409 conflict
    const doubleAcceptRes = await request('POST', `/api/help-requests/${helpReqId}/accept`, {}, {
      Authorization: `Bearer ${responderToken}`
    });
    assert(doubleAcceptRes.status === 409, 'Double-claim rejected with 409 Conflict');

    // 8. Part B: Post-Flood Damage Claims
    console.log('\n--- 8. Testing Part B: Post-Flood Damage Claims ---');
    const damageRes = await request('POST', '/api/damage', {
      category: 'house',
      severity: 'severe',
      estimatedLossINR: 150000,
      description: 'Boundary wall collapse and ground floor water damage',
      lat: 26.8500,
      lng: 80.9990,
      address: 'House 14, Gomti Nagar'
    }, { Authorization: `Bearer ${citizenToken}` });
    assert(damageRes.status === 201, 'Damage claim submitted');
    const damageId = damageRes.data.report._id;

    const reviewRes = await request('PUT', `/api/damage/${damageId}/review`, {
      status: 'approved',
      reviewNotes: 'Initial compensation verified via satellite survey'
    }, { Authorization: `Bearer ${adminToken}` });
    assert(reviewRes.status === 200, 'Damage claim reviewed by admin');
    assert(reviewRes.data.report.status === 'approved', 'Damage claim status is approved');

    console.log('\n=============================================');
    console.log('ALL TIER 4 & TIER 5 INTEGRATION TESTS PASSED!');
    console.log('=============================================\n');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

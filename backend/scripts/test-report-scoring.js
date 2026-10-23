/**
 * Test script for report scoring, consensus, decay, and anti-spam logic.
 * Run with: node scripts/test-report-scoring.js
 */

const {
  computeBaseConfidence,
  computeEffectiveConfidence,
  getUserReputationAdjustment,
  checkUserShadowLimit,
  getTtlMs
} = require('../src/services/reportScoring.service');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log('--- RUNNING REPORT SCORING & DECAY TESTS ---');

// Test 1: Base score starts at 40
const baseScore = computeBaseConfidence({ hasPhoto: false, confirmations: [] });
assert(baseScore === 40, `Base score starts at 40 (got ${baseScore})`);

// Test 2: Photo adds +10
const photoScore = computeBaseConfidence({ hasPhoto: true, confirmations: [] });
assert(photoScore === 50, `Photo adds +10 to confidence (got ${photoScore})`);

// Test 3: Confirmations add +15 each, disputes subtract -20 each
const twoConfirms = computeBaseConfidence({
  hasPhoto: true,
  confirmations: [
    { vote: 'confirm' },
    { vote: 'confirm' }
  ]
});
assert(twoConfirms === 80, `Photo + 2 confirms = 50 + 30 = 80 (got ${twoConfirms})`);

const disputedScore = computeBaseConfidence({
  hasPhoto: false,
  confirmations: [
    { vote: 'dispute' },
    { vote: 'dispute' }
  ]
});
assert(disputedScore === 0, `2 disputes on base 40 clamp to 0 (got ${disputedScore})`);

// Test 4: Good track record +10, bad track record -15
const goodUserRep = getUserReputationAdjustment([
  { status: 'verified' },
  { status: 'verified' },
  { status: 'unverified' }
]);
assert(goodUserRep === 10, `Good user track record gives +10 (got ${goodUserRep})`);

const badUserRep = getUserReputationAdjustment([
  { status: 'disputed' },
  { status: 'disputed' },
  { status: 'disputed' }
]);
assert(badUserRep === -15, `Poor user track record gives -15 (got ${badUserRep})`);

// Test 5: Effective confidence & decay
const now = Date.now();
const reportTtl = getTtlMs('water_level'); // 6 hours
const mockReport = {
  type: 'water_level',
  photo: 'data:image/png;base64,mock',
  createdAt: new Date(now),
  expiresAt: new Date(now + reportTtl),
  confirmations: [{ vote: 'confirm' }, { vote: 'confirm' }], // 40 + 10 + 30 = 80
  status: 'unverified'
};

const immediate = computeEffectiveConfidence(mockReport, now);
assert(immediate.confidenceScore === 80, `Immediate effective score is 80 (got ${immediate.confidenceScore})`);
assert(immediate.status === 'verified', `Score >= 70 transitions status to verified (got ${immediate.status})`);

// Halfway through lifetime (3 hours)
const halfway = computeEffectiveConfidence(mockReport, now + (3 * 3600 * 1000));
assert(halfway.confidenceScore < 80 && halfway.confidenceScore >= 60, `Decayed score at halfway point is ${halfway.confidenceScore}`);

// Expired report
const expired = computeEffectiveConfidence(mockReport, now + reportTtl + 1000);
assert(expired.isExpired === true, 'Report after TTL is marked expired');
assert(expired.status === 'expired', `Expired report status is expired (got ${expired.status})`);

// Test 6: Anti-spam shadow limit
const shadowLimited = checkUserShadowLimit([
  { status: 'disputed', createdAt: new Date(now - 1000 * 60 * 30) }, // 30m ago
  { status: 'disputed', createdAt: new Date(now - 1000 * 60 * 60) }, // 1h ago
  { status: 'disputed', createdAt: new Date(now - 1000 * 60 * 120) } // 2h ago
]);
assert(shadowLimited === true, 'User with last 3 reports disputed within 6h is shadow limited');

const notShadowLimited = checkUserShadowLimit([
  { status: 'verified', createdAt: new Date(now - 1000 * 60 * 30) },
  { status: 'disputed', createdAt: new Date(now - 1000 * 60 * 60) },
  { status: 'disputed', createdAt: new Date(now - 1000 * 60 * 120) }
]);
assert(notShadowLimited === false, 'User without 3 consecutive disputes is not shadow limited');

console.log('--- ALL SCORING & DECAY TESTS PASSED SUCCESSFULLY! ---');

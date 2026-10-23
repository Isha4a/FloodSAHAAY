/**
 * Report Scoring and Verification Service
 * Calculates consensus score, time decay, user reputation modifiers, and auto-expiration.
 */

const TTL_CONFIG = {
  water_level: 6 * 60 * 60 * 1000,   // 6 hours
  road_blocked: 12 * 60 * 60 * 1000, // 12 hours
  need_help: 3 * 60 * 60 * 1000,     // 3 hours
  bridge_damaged: 8 * 60 * 60 * 1000,// 8 hours
  power_outage: 8 * 60 * 60 * 1000,  // 8 hours
  landslide: 8 * 60 * 60 * 1000      // 8 hours
};

const DEFAULT_TTL = 8 * 60 * 60 * 1000;

function getTtlMs(type) {
  return TTL_CONFIG[type] || DEFAULT_TTL;
}

/**
 * Calculates user track record adjustment:
 * +10 for good track record (majority previous confirmed)
 * -15 for poor track record (majority disputed)
 * 0 for neutral / new user
 */
function getUserReputationAdjustment(userReports = []) {
  if (!userReports || userReports.length === 0) return 0;

  let confirmedCount = 0;
  let disputedCount = 0;

  for (const r of userReports) {
    if (r.status === 'verified') confirmedCount++;
    else if (r.status === 'disputed') disputedCount++;
  }

  const totalEvaluated = confirmedCount + disputedCount;
  if (totalEvaluated < 2) return 0;

  const confirmRatio = confirmedCount / totalEvaluated;
  if (confirmRatio >= 0.65) return 10;
  if (confirmRatio <= 0.35 || disputedCount >= 3) return -15;

  return 0;
}

/**
 * Computes base confidence before time decay.
 */
function computeBaseConfidence({
  hasPhoto = false,
  confirmations = [],
  userReputationAdjustment = 0
}) {
  let score = 40; // Base score

  if (hasPhoto) {
    score += 10;
  }

  score += userReputationAdjustment;

  for (const c of confirmations) {
    if (c.vote === 'confirm') {
      score += 15;
    } else if (c.vote === 'dispute') {
      score -= 20;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculates current decayed confidence and status given creation time, expiresAt, and now.
 * Confidence decreases linearly over the lifetime [createdAt, expiresAt].
 */
function computeEffectiveConfidence(report, now = Date.now()) {
  const createdTime = new Date(report.createdAt).getTime();
  const expiresTime = new Date(report.expiresAt).getTime();
  const currentTime = typeof now === 'number' ? now : new Date(now).getTime();

  // If already past expiry and not resolved
  if (currentTime >= expiresTime) {
    return {
      confidenceScore: 0,
      status: report.status === 'resolved' ? 'resolved' : 'expired',
      isExpired: true
    };
  }

  // Base confidence with photo + votes + user track record
  const userRepAdjustment = report.userReputationAdjustment ?? 0;
  const baseConf = computeBaseConfidence({
    hasPhoto: Boolean(report.photo),
    confirmations: report.confirmations || [],
    userReputationAdjustment: userRepAdjustment
  });

  const totalLifetime = Math.max(1, expiresTime - createdTime);
  const elapsed = Math.max(0, currentTime - createdTime);
  const fractionElapsed = Math.min(1, elapsed / totalLifetime);

  // Linear decay: decays by at most 50% of the score over its lifetime before expiring
  // This preserves consensus while reflecting freshness
  const decayFactor = 1 - (fractionElapsed * 0.5);
  const effectiveScore = Math.max(0, Math.min(100, Math.round(baseConf * decayFactor)));

  let status = report.status;
  if (status !== 'resolved') {
    if (effectiveScore >= 70) {
      status = 'verified';
    } else if (effectiveScore <= 20) {
      status = 'disputed';
    } else {
      status = 'unverified';
    }
  }

  return {
    confidenceScore: effectiveScore,
    status,
    isExpired: false
  };
}

/**
 * Checks if a user is shadow rate-limited due to spam/disputed history
 */
function checkUserShadowLimit(userReports = []) {
  if (!userReports || userReports.length < 3) return false;

  // Sort newest first
  const sorted = [...userReports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const last3 = sorted.slice(0, 3);

  const allDisputed = last3.every(r => r.status === 'disputed');
  if (!allDisputed) return false;

  // If last 3 were all disputed, limit to 1 report per 6 hours
  const latestReport = last3[0];
  const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
  if (new Date(latestReport.createdAt).getTime() > sixHoursAgo) {
    return true; // shadow limited
  }

  return false;
}

module.exports = {
  TTL_CONFIG,
  DEFAULT_TTL,
  getTtlMs,
  computeBaseConfidence,
  computeEffectiveConfidence,
  getUserReputationAdjustment,
  checkUserShadowLimit
};

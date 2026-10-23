const { getDistanceKm } = require('./geo.service');

const CATEGORY_SKILL_MAP = {
  rescue: ['rescue', 'boat'],
  medical: ['medical'],
  food: ['food', 'driving'],
  water: ['driving', 'boat'],
  transport: ['driving', 'boat'],
  shelter: ['rescue', 'food']
};

/**
 * Calculates matching score between a HelpRequest and a VolunteerProfile
 * Score = skillMatch * 0.4 + proximity * 0.3 + availability * 0.2 + languageMatch * 0.1
 */
function scoreVolunteer(volunteer, request) {
  // 1. Skill Match (0.4 weight)
  const requiredSkills = CATEGORY_SKILL_MAP[request.category] || ['rescue'];
  const volunteerSkills = volunteer.skills || [];
  const matchedSkillCount = requiredSkills.filter(s => volunteerSkills.includes(s)).length;
  const skillMatch = Math.min(1.0, matchedSkillCount / Math.max(1, requiredSkills.length));

  // 2. Proximity (0.3 weight)
  const reqLat = request.location?.lat ?? 26.8467;
  const reqLng = request.location?.lng ?? 80.9462;
  const volLat = volunteer.location?.lat ?? 26.8467;
  const volLng = volunteer.location?.lng ?? 80.9462;
  const distKm = getDistanceKm(reqLat, reqLng, volLat, volLng);
  // Full points if within 2 km, decays to 0 at 25 km
  const proximity = Math.max(0, Math.min(1.0, 1 - (distKm / 25)));

  // 3. Availability (0.2 weight)
  let availability = 0;
  if (volunteer.availability === 'available') availability = 1.0;
  else if (volunteer.availability === 'busy') availability = 0.3;
  else availability = 0.0;

  // 4. Language Match (0.1 weight)
  const volLanguages = volunteer.languages || [];
  const languageMatch = volLanguages.length > 0 ? 1.0 : 0.5;

  const totalScore = (skillMatch * 0.4) + (proximity * 0.3) + (availability * 0.2) + (languageMatch * 0.1);

  return {
    volunteer,
    totalScore: parseFloat(totalScore.toFixed(3)),
    distanceKm: parseFloat(distKm.toFixed(1)),
    skillMatch: parseFloat((skillMatch * 100).toFixed(0)),
    breakdown: {
      skillScore: parseFloat((skillMatch * 0.4).toFixed(3)),
      proximityScore: parseFloat((proximity * 0.3).toFixed(3)),
      availabilityScore: parseFloat((availability * 0.2).toFixed(3)),
      languageScore: parseFloat((languageMatch * 0.1).toFixed(3))
    }
  };
}

/**
 * Suggests top 5 volunteers for a HelpRequest
 */
function matchVolunteersForRequest(request, allVolunteers = []) {
  if (!allVolunteers || allVolunteers.length === 0) return [];

  const scored = allVolunteers.map(v => scoreVolunteer(v, request));

  // Sort descending by totalScore
  scored.sort((a, b) => b.totalScore - a.totalScore);

  return scored.slice(0, 5);
}

module.exports = {
  scoreVolunteer,
  matchVolunteersForRequest,
  CATEGORY_SKILL_MAP
};

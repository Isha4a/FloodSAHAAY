/**
 * Geo Service
 * Haversine distance calculations and spatial filtering for both
 * MongoDB mode and in-memory fallback mode.
 */

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates great-circle distance between two coordinates in kilometers.
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (![nLat1, nLon1, nLat2, nLon2].every(Number.isFinite)) {
    return Infinity;
  }

  const R = 6371; // Earth radius in km
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(nLat1)) *
      Math.cos(toRad(nLat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if target coord is within radiusKm of center coord.
 */
function isWithinRadius(centerLat, centerLng, targetLat, targetLng, radiusKm) {
  const dist = getDistanceKm(centerLat, centerLng, targetLat, targetLng);
  return dist <= radiusKm;
}

/**
 * Filters a collection of items with lat/lng within a given radius in km.
 */
function filterWithinRadius(items, centerLat, centerLng, radiusKm, getCoords = null) {
  if (!Array.isArray(items)) return [];
  const cLat = Number(centerLat);
  const cLng = Number(centerLng);
  const rad = Number(radiusKm);

  return items
    .map(item => {
      let lat, lng;
      if (typeof getCoords === 'function') {
        const coords = getCoords(item) || {};
        lat = coords.lat ?? coords.latitude;
        lng = coords.lng ?? coords.lon ?? coords.longitude;
      } else if (item.location && typeof item.location.lat === 'number') {
        lat = item.location.lat;
        lng = item.location.lng;
      } else {
        lat = item.lat;
        lng = item.lng;
      }

      const distanceKm = getDistanceKm(cLat, cLng, lat, lng);
      return { item, distanceKm };
    })
    .filter(entry => entry.distanceKm <= rad)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(entry => ({
      ...entry.item,
      distanceKm: parseFloat(entry.distanceKm.toFixed(2))
    }));
}

/**
 * Minimum distance in km from point P to line segment AB
 */
function distanceToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  // Convert lat/lng to approximate equirectangular plane projection centered at A
  const degToKm = 111.32;
  const cosLat = Math.cos(toRad(aLat));

  const px = (pLng - aLng) * degToKm * cosLat;
  const py = (pLat - aLat) * degToKm;
  const bx = (bLng - aLng) * degToKm * cosLat;
  const by = (bLat - aLat) * degToKm;

  const segmentLenSq = bx * bx + by * by;
  if (segmentLenSq === 0) {
    return Math.sqrt(px * px + py * py);
  }

  // Projection parameter t
  let t = (px * bx + py * by) / segmentLenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = t * bx;
  const projY = t * by;

  const dx = px - projX;
  const dy = py - projY;
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  getDistanceKm,
  isWithinRadius,
  filterWithinRadius,
  distanceToSegmentKm
};

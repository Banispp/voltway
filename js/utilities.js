/**
 * VoltWay 2W - Essential Rider Utilities
 * SOS Nearest Charger, Charging Time Estimator, Geocoding & Sunlight Mode
 */

const Utilities = (function () {

  /**
   * Distance between two coordinates in km
   */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * SOS: Pinpoint nearest fast and slow chargers from current rider GPS position
   * @param {Object} userCoords { lat, lng }
   * @returns {Object} Nearest fast charger, nearest slow charger, and absolute closest
   */
  function findNearestChargers(userCoords) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    if (!userCoords || !allChargers || allChargers.length === 0) {
      return null;
    }

    let nearestFast = null;
    let minFastDist = Infinity;

    let nearestSlow = null;
    let minSlowDist = Infinity;

    let nearestAther = null;
    let minAtherDist = Infinity;

    for (let i = 0; i < allChargers.length; i++) {
      const c = allChargers[i];
      const dist = haversine(userCoords.lat, userCoords.lng, c.lat, c.lng);

      if (c.type === 'FAST') {
        if (dist < minFastDist) {
          minFastDist = dist;
          nearestFast = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
        if (c.network === 'ATHER_GRID' && dist < minAtherDist) {
          minAtherDist = dist;
          nearestAther = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
      } else if (c.type === 'SLOW') {
        if (dist < minSlowDist) {
          minSlowDist = dist;
          nearestSlow = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
      }
    }

    // Absolute closest charger
    let absoluteClosest = null;
    if (minFastDist <= minSlowDist) {
      absoluteClosest = nearestFast;
    } else {
      absoluteClosest = nearestSlow;
    }

    return {
      nearestFast,
      nearestSlow,
      nearestAther,
      absoluteClosest,
      userCoords
    };
  }

  /**
   * Charging Time Estimator
   *
   * Fast Charger:
   * - Based on standard 2W DC fast charging curves (Ather Grid / Bolt Fast ~3.3 kW DC)
   * - ~1 km range gained per minute (~35 mins for 20% to 80% SoC)
   * - Tapers after 80% to protect lithium-ion cell chemistry
   *
   * Slow 15A Socket:
   * - Based on standard 5A/15A portable charger (1.2 - 1.5 kW AC)
   * - ~18% to 20% charge gain per hour (~4.5 to 5 hours for 0% to 100%)
   *
   * @param {number} currentPct Starting battery % (e.g. 20)
   * @param {number} targetPct Target battery % (e.g. 80)
   * @param {number} efficiency Vehicle efficiency (km/1%, default 0.85)
   * @returns {Object} Estimated duration and range gained
   */
  function estimateChargingTime(currentPct, targetPct, efficiency = 0.85) {
    currentPct = Math.max(0, Math.min(100, Number(currentPct) || 0));
    targetPct = Math.max(currentPct, Math.min(100, Number(targetPct) || 80));

    const gainPct = targetPct - currentPct;
    const rangeGainedKm = Math.round(gainPct * efficiency * 10) / 10;

    // --- Fast Charger Calculation ---
    // Fast charging rates:
    // 0-80%: ~1.7% per minute (~35 mins for 60% gain)
    // 80-100%: ~0.8% per minute (tapered trickle)
    let fastMinutes = 0;
    if (currentPct < 80) {
      const fastPortion = Math.min(targetPct, 80) - currentPct;
      fastMinutes += Math.round(fastPortion / 1.7);
    }
    if (targetPct > 80) {
      const tricklePortion = targetPct - Math.max(currentPct, 80);
      fastMinutes += Math.round(tricklePortion / 0.8);
    }

    // --- Slow 15A Socket Calculation ---
    // 15A Socket rate: ~18.5% per hour (~0.31% per min)
    const slowMinutes = Math.round((gainPct / 18.5) * 60);

    return {
      currentPct,
      targetPct,
      gainPct,
      rangeGainedKm,
      fastMinutes,
      fastTimeFormatted: formatMinutes(fastMinutes),
      slowMinutes,
      slowTimeFormatted: formatMinutes(slowMinutes)
    };
  }

  function formatMinutes(mins) {
    if (mins < 60) {
      return `${mins} min${mins === 1 ? '' : 's'}`;
    }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs} hr${hrs === 1 ? '' : 's'}`;
  }

  /**
   * Geocode a place query via OpenStreetMap Nominatim API
   */
  async function searchPlace(query) {
    if (!query || query.trim().length < 2) return [];
    const encoded = encodeURIComponent(query.trim() + ', India');
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=in&limit=6&addressdetails=1`;

    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.map(item => ({
        name: item.display_name.split(',')[0],
        fullName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
    } catch (e) {
      console.warn('Nominatim geocode failed:', e);
      return [];
    }
  }

  return {
    haversine,
    findNearestChargers,
    estimateChargingTime,
    formatMinutes,
    searchPlace
  };
})();

window.Utilities = Utilities;

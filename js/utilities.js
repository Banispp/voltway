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

  // Pre-indexed major Indian cities, towns & EV travel corridors for 0ms instant autocomplete
  const POPULAR_INDIAN_PLACES = [
    // Kerala
    { name: 'Kochi (Cochin)', fullName: 'Kochi, Ernakulam, Kerala, India', lat: 9.9312, lng: 76.2673 },
    { name: 'Ernakulam', fullName: 'Ernakulam, Kochi, Kerala, India', lat: 9.9816, lng: 76.2999 },
    { name: 'Edappally', fullName: 'Edappally, Kochi, Kerala, India', lat: 10.0246, lng: 76.3079 },
    { name: 'Aluva', fullName: 'Aluva, Ernakulam, Kerala, India', lat: 10.1076, lng: 76.3516 },
    { name: 'Kakkanad (Infopark)', fullName: 'Kakkanad, Kochi, Kerala, India', lat: 10.0159, lng: 76.3419 },
    { name: 'Fort Kochi', fullName: 'Fort Kochi, Kerala, India', lat: 9.9658, lng: 76.2421 },
    { name: 'Vytilla', fullName: 'Vytilla Mobility Hub, Kochi, Kerala, India', lat: 9.9678, lng: 76.3195 },
    { name: 'Thiruvananthapuram (Trivandrum)', fullName: 'Thiruvananthapuram, Kerala, India', lat: 8.5241, lng: 76.9366 },
    { name: 'Kozhikode (Calicut)', fullName: 'Kozhikode, Kerala, India', lat: 11.2588, lng: 75.7804 },
    { name: 'Thrissur', fullName: 'Thrissur, Kerala, India', lat: 10.5276, lng: 76.2144 },
    { name: 'Palakkad', fullName: 'Palakkad, Kerala, India', lat: 10.7867, lng: 76.6548 },
    { name: 'Kannur', fullName: 'Kannur, Kerala, India', lat: 11.8745, lng: 75.3704 },
    { name: 'Alappuzha (Alleppey)', fullName: 'Alappuzha, Kerala, India', lat: 9.4981, lng: 76.3388 },
    { name: 'Kollam (Quilon)', fullName: 'Kollam, Kerala, India', lat: 8.8932, lng: 76.6141 },
    { name: 'Kottayam', fullName: 'Kottayam, Kerala, India', lat: 9.5916, lng: 76.5222 },
    { name: 'Malappuram', fullName: 'Malappuram, Kerala, India', lat: 11.0510, lng: 76.0711 },
    { name: 'Kasaragod', fullName: 'Kasaragod, Kerala, India', lat: 12.4996, lng: 74.9869 },
    { name: 'Wayanad (Kalpetta)', fullName: 'Kalpetta, Wayanad, Kerala, India', lat: 11.6050, lng: 76.0828 },
    { name: 'Munnar', fullName: 'Munnar, Idukki, Kerala, India', lat: 10.0889, lng: 77.0595 },
    { name: 'Idukki', fullName: 'Idukki Township, Kerala, India', lat: 9.8494, lng: 76.9719 },
    { name: 'Guruvayur', fullName: 'Guruvayur, Thrissur, Kerala, India', lat: 10.5946, lng: 76.0422 },
    { name: 'Perinthalmanna', fullName: 'Perinthalmanna, Malappuram, Kerala, India', lat: 10.9760, lng: 76.2254 },
    { name: 'Manjeri', fullName: 'Manjeri, Malappuram, Kerala, India', lat: 11.1215, lng: 76.1214 },
    { name: 'Thalassery', fullName: 'Thalassery, Kannur, Kerala, India', lat: 11.7480, lng: 75.4894 },
    { name: 'Vadakara', fullName: 'Vadakara, Kozhikode, Kerala, India', lat: 11.6044, lng: 75.5917 },
    { name: 'Kayamkulam', fullName: 'Kayamkulam, Alappuzha, Kerala, India', lat: 9.1724, lng: 76.5011 },
    { name: 'Thiruvalla', fullName: 'Thiruvalla, Pathanamthitta, Kerala, India', lat: 9.3835, lng: 76.5741 },
    { name: 'Pathanamthitta', fullName: 'Pathanamthitta, Kerala, India', lat: 9.2648, lng: 76.7870 },
    { name: 'Angamaly', fullName: 'Angamaly, Ernakulam, Kerala, India', lat: 10.1960, lng: 76.3860 },
    { name: 'Chalakudy', fullName: 'Chalakudy, Thrissur, Kerala, India', lat: 10.3070, lng: 76.3330 },
    { name: 'Nedumbassery (COK Airport)', fullName: 'Cochin International Airport, Nedumbassery, Kerala, India', lat: 10.1518, lng: 76.3930 },

    // Karnataka
    { name: 'Bengaluru (Bangalore)', fullName: 'Bengaluru, Karnataka, India', lat: 12.9716, lng: 77.5946 },
    { name: 'Indiranagar', fullName: 'Indiranagar, Bengaluru, Karnataka, India', lat: 12.9784, lng: 77.6408 },
    { name: 'Koramangala', fullName: 'Koramangala, Bengaluru, Karnataka, India', lat: 12.9352, lng: 77.6245 },
    { name: 'Whitefield', fullName: 'Whitefield, Bengaluru, Karnataka, India', lat: 12.9698, lng: 77.7500 },
    { name: 'HSR Layout', fullName: 'HSR Layout, Bengaluru, Karnataka, India', lat: 12.9121, lng: 77.6446 },
    { name: 'Jayanagar', fullName: 'Jayanagar, Bengaluru, Karnataka, India', lat: 12.9308, lng: 77.5838 },
    { name: 'Electronic City', fullName: 'Electronic City, Bengaluru, Karnataka, India', lat: 12.8399, lng: 77.6770 },
    { name: 'Yelahanka', fullName: 'Yelahanka, Bengaluru, Karnataka, India', lat: 13.1007, lng: 77.5963 },
    { name: 'Hebbal', fullName: 'Hebbal, Bengaluru, Karnataka, India', lat: 13.0358, lng: 77.5970 },
    { name: 'Mysuru (Mysore)', fullName: 'Mysuru, Karnataka, India', lat: 12.2958, lng: 76.6394 },
    { name: 'Mangaluru (Mangalore)', fullName: 'Mangaluru, Karnataka, India', lat: 12.9141, lng: 74.8560 },
    { name: 'Udupi', fullName: 'Udupi, Karnataka, India', lat: 13.3409, lng: 74.7421 },
    { name: 'Nandi Hills', fullName: 'Nandi Hills, Chikkaballapur, Karnataka, India', lat: 13.3702, lng: 77.6835 },
    { name: 'Hubballi (Hubli)', fullName: 'Hubballi, Karnataka, India', lat: 15.3647, lng: 75.1240 },
    { name: 'Belagavi (Belgaum)', fullName: 'Belagavi, Karnataka, India', lat: 15.8497, lng: 74.4977 },
    { name: 'Shivamogga (Shimoga)', fullName: 'Shivamogga, Karnataka, India', lat: 13.9299, lng: 75.5681 },
    { name: 'Tumakuru (Tumkur)', fullName: 'Tumakuru, Karnataka, India', lat: 13.3379, lng: 77.1010 },

    // Tamil Nadu
    { name: 'Chennai', fullName: 'Chennai, Tamil Nadu, India', lat: 13.0827, lng: 80.2707 },
    { name: 'Coimbatore', fullName: 'Coimbatore, Tamil Nadu, India', lat: 11.0168, lng: 76.9558 },
    { name: 'Madurai', fullName: 'Madurai, Tamil Nadu, India', lat: 9.9252, lng: 78.1198 },
    { name: 'Salem', fullName: 'Salem, Tamil Nadu, India', lat: 11.6643, lng: 78.1460 },
    { name: 'Tiruchirappalli (Trichy)', fullName: 'Tiruchirappalli, Tamil Nadu, India', lat: 10.7905, lng: 78.7047 },
    { name: 'Ooty (Udhagamandalam)', fullName: 'Ooty, Nilgiris, Tamil Nadu, India', lat: 11.4102, lng: 76.6950 },
    { name: 'Kodaikanal', fullName: 'Kodaikanal, Dindigul, Tamil Nadu, India', lat: 10.2381, lng: 77.4892 },
    { name: 'Hosur', fullName: 'Hosur, Krishnagiri, Tamil Nadu, India', lat: 12.7409, lng: 77.8253 },
    { name: 'Tiruppur', fullName: 'Tiruppur, Tamil Nadu, India', lat: 11.1085, lng: 77.3411 },
    { name: 'Erode', fullName: 'Erode, Tamil Nadu, India', lat: 11.3410, lng: 77.7172 },
    { name: 'Vellore', fullName: 'Vellore, Tamil Nadu, India', lat: 12.9165, lng: 79.1325 },

    // Other Major Metros
    { name: 'Hyderabad', fullName: 'Hyderabad, Telangana, India', lat: 17.3850, lng: 78.4867 },
    { name: 'Mumbai', fullName: 'Mumbai, Maharashtra, India', lat: 19.0760, lng: 72.8777 },
    { name: 'Pune', fullName: 'Pune, Maharashtra, India', lat: 18.5204, lng: 73.8567 },
    { name: 'Delhi (NCR)', fullName: 'New Delhi, Delhi, India', lat: 28.6139, lng: 77.2090 },
    { name: 'Goa (Panaji)', fullName: 'Panaji, Goa, India', lat: 15.4909, lng: 73.8278 }
  ];

  /**
   * Geocode a place query via Local Database (Instant) + OpenStreetMap Nominatim API
   */
  async function searchPlace(query) {
    if (!query || query.trim().length < 2) return [];
    const qLower = query.trim().toLowerCase();

    // 1. Instant local matching (0ms latency)
    const localMatches = POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    );

    // 2. Query OSM Nominatim in parallel with 2.5s timeout
    let osmResults = [];
    try {
      const encoded = encodeURIComponent(query.trim() + ', India');
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=in&limit=5&addressdetails=1`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        osmResults = data.map(item => ({
          name: item.display_name.split(',')[0],
          fullName: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon)
        }));
      }
    } catch (e) {
      console.warn('[VoltWay] Nominatim geocode fallback to local:', e);
    }

    // Merge and deduplicate by proximity
    const combined = [...localMatches];
    osmResults.forEach(osm => {
      const exists = combined.some(c =>
        Math.abs(c.lat - osm.lat) < 0.03 && Math.abs(c.lng - osm.lng) < 0.03
      );
      if (!exists) {
        combined.push(osm);
      }
    });

    return combined.slice(0, 7);
  }

  function getLocalPlaces(query) {
    if (!query || query.trim().length < 2) return [];
    const qLower = query.trim().toLowerCase();
    return POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    ).slice(0, 6);
  }

  return {
    haversine,
    findNearestChargers,
    estimateChargingTime,
    formatMinutes,
    searchPlace,
    getLocalPlaces,
    POPULAR_INDIAN_PLACES
  };
})();

window.Utilities = Utilities;

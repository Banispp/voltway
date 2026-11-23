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
   * Accurate physical charging duration for 2-wheeler lithium batteries
   * Fast DC: 0-80% at 1.5% SoC/min (~1.5 km/min gain, Ather Grid & 3.3 kW DC Fast)
   *          80-100% tapered CC-CV at 0.55% SoC/min
   * Slow AC 15A Socket: ~0.33% SoC/min (~20% per hour, standard portable charger)
   */
  function computeChargingDuration(chargeNeededPct, startSoC = 20, isFast = true) {
    if (chargeNeededPct <= 0) return 0;
    if (isFast) {
      const start = Math.max(0, Math.min(100, Number(startSoC) || 0));
      const end = Math.min(100, start + chargeNeededPct);
      const upTo80 = Math.max(0, Math.min(80, end) - Math.min(80, start));
      const above80 = Math.max(0, end - Math.max(80, start));
      return Math.round((upTo80 / 1.5) + (above80 / 0.55));
    } else {
      return Math.round(chargeNeededPct / 0.33);
    }
  }

  /**
   * Charging Time Estimator
   *
   * Fast Charger:
   * - Based on standard 2W DC fast charging curves (Ather Grid / Bolt Fast ~3.3 kW DC)
   * - ~1.5 km range gained per minute (~40 mins for 20% to 80% SoC)
   * - Tapers after 80% to protect lithium-ion cell chemistry
   *
   * Slow 15A Socket:
   * - Based on standard 5A/15A portable charger (750W - 1.2 kW AC)
   * - ~20% charge gain per hour (~5 hours for 0% to 100%)
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

    const fastMinutes = computeChargingDuration(gainPct, currentPct, true);
    const slowMinutes = computeChargingDuration(gainPct, currentPct, false);

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
    { name: 'Ponnani', fullName: 'Ponnani, Malappuram, Kerala, India', lat: 10.7744, lng: 75.9250 },
    { name: 'Valanchery', fullName: 'Valanchery, Malappuram, Kerala, India', lat: 10.8791, lng: 76.0718 },
    { name: 'Tirur', fullName: 'Tirur, Malappuram, Kerala, India', lat: 10.9167, lng: 75.9239 },
    { name: 'Kottakkal', fullName: 'Kottakkal, Malappuram, Kerala, India', lat: 11.0005, lng: 76.0048 },
    { name: 'Kunnamkulam', fullName: 'Kunnamkulam, Thrissur, Kerala, India', lat: 10.6489, lng: 76.0706 },
    { name: 'Cherthala', fullName: 'Cherthala, Alappuzha, Kerala, India', lat: 9.6845, lng: 76.3317 },
    { name: 'Kanhangad', fullName: 'Kanhangad, Kasaragod, Kerala, India', lat: 12.3080, lng: 75.0931 },
    { name: 'Payyanur', fullName: 'Payyanur, Kannur, Kerala, India', lat: 12.1009, lng: 75.2023 },
    { name: 'Nilambur', fullName: 'Nilambur, Malappuram, Kerala, India', lat: 11.2778, lng: 76.2263 },
    { name: 'Sulthan Bathery', fullName: 'Sulthan Bathery, Wayanad, Kerala, India', lat: 11.6627, lng: 76.2570 },
    { name: 'Mananthavady', fullName: 'Mananthavady, Wayanad, Kerala, India', lat: 11.8026, lng: 76.0033 },
    { name: 'Attingal', fullName: 'Attingal, Thiruvananthapuram, Kerala, India', lat: 8.6966, lng: 76.8143 },
    { name: 'Neyyattinkara', fullName: 'Neyyattinkara, Thiruvananthapuram, Kerala, India', lat: 8.4002, lng: 77.0869 },
    { name: 'Muvattupuzha', fullName: 'Muvattupuzha, Ernakulam, Kerala, India', lat: 9.9822, lng: 76.5772 },
    { name: 'Kothamangalam', fullName: 'Kothamangalam, Ernakulam, Kerala, India', lat: 10.0617, lng: 76.6272 },
    { name: 'Perumbavoor', fullName: 'Perumbavoor, Ernakulam, Kerala, India', lat: 10.1118, lng: 76.4754 },
    { name: 'Pala', fullName: 'Pala, Kottayam, Kerala, India', lat: 9.7118, lng: 76.6835 },
    { name: 'Changanassery', fullName: 'Changanassery, Kottayam, Kerala, India', lat: 9.4447, lng: 76.5383 },

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
   * Geocode a place query via Local Database (Instant) + High-Speed Photon (Komoot) API + OSM Nominatim Fallback
   * Photon handles any town, village, junction, or street in Kerala & India within 150ms with zero rate limits!
   */
  async function searchPlace(query) {
    if (!query || query.trim().length < 2) return [];
    const qLower = query.trim().toLowerCase();

    // 1. Instant local matching (0ms latency)
    const localMatches = POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    );

    // 2. High-Speed Photon (Komoot) Geocoding API with South India Proximity Bias (10.5 N, 76.2 E)
    let photonResults = [];
    try {
      const encoded = encodeURIComponent(query.trim());
      const url = `https://photon.komoot.io/api/?q=${encoded}&limit=7&lat=10.5&lon=76.2`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        if (data && data.features && data.features.length > 0) {
          photonResults = data.features.map(f => {
            const props = f.properties || {};
            const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
            const name = props.name || props.street || query.trim();
            const locationParts = [
              name,
              props.city || props.town || props.village || props.county,
              props.state,
              props.country
            ].filter(Boolean);

            return {
              name: name,
              fullName: locationParts.join(', '),
              lat: coords[1],
              lng: coords[0]
            };
          });
        }
      }
    } catch (e) {
      console.warn('[VoltWay] Photon geocoding fallback to Nominatim:', e);
    }

    // 3. Fallback to OSM Nominatim if Photon yielded no results
    let osmResults = [];
    if (photonResults.length === 0) {
      try {
        const encoded = encodeURIComponent(query.trim() + ', India');
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=in&limit=5&addressdetails=1`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

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
        console.warn('[VoltWay] Nominatim geocode fallback:', e);
      }
    }

    // Merge and deduplicate by proximity (3km threshold)
    const combined = [...localMatches];
    const incoming = photonResults.length > 0 ? photonResults : osmResults;
    incoming.forEach(item => {
      const exists = combined.some(c =>
        Math.abs(c.lat - item.lat) < 0.03 && Math.abs(c.lng - item.lng) < 0.03
      );
      if (!exists) {
        combined.push(item);
      }
    });

    return combined.slice(0, 8);
  }

  /**
   * Expands short Google Maps URLs (maps.app.goo.gl or goo.gl/maps)
   * Uses native CapacitorHttp on Android, or free CORS proxies on Web
   */
  async function unshortenUrl(shortUrl) {
    if (!shortUrl) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(shortUrl, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (resp && resp.url && resp.url !== shortUrl && resp.url.includes('google.com/maps')) {
        return resp.url;
      }
    } catch (e) {}

    const proxies = [
      `https://corsproxy.io/?${encodeURIComponent(shortUrl)}`,
      `https://api.allorigins.win/get?url=${encodeURIComponent(shortUrl)}`
    ];
    for (const p of proxies) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(p, { signal: controller.signal });
        clearTimeout(timer);
        if (resp && resp.ok) {
          if (resp.url && resp.url.includes('google.com/maps')) return resp.url;
          const text = await resp.text();
          const match = text.match(/https?:\/\/(?:www\.)?google\.com\/maps\/[^\s"'<>]+/i);
          if (match) return match[0];
          const coordMatch = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
          if (coordMatch) return text;
        }
      } catch (e) {}
    }
    return null;
  }

  /**
   * Universal Location Input & Link Resolver:
   * Handles ALL mobile and desktop location inputs:
   * 1. Direct Coordinates: "10.0246, 76.3079"
   * 2. DMS Coordinates: 10°01'28.6"N 76°18'28.5"E
   * 3. Google Maps URLs (@lat,lng, ?q=lat,lng, /place/Name, dir/)
   * 4. Google Maps Mobile Shared Text (multiline "Dropped pin near Alappuzha https://...")
   * 5. Short Google Maps URLs (maps.app.goo.gl/xyz, goo.gl/maps/xyz)
   * 6. Plain Text Names: "Valanchery", "Ponnani", "MG Road Kochi" (Photon 150ms Geocoder)
   *
   * @param {string} rawInput 
   * @returns {Promise<Object|null>} { lat, lng, name, fullName }
   */
  async function resolveLocationInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    let text = rawInput.trim();
    if (!text) return null;

    // 1. Direct coordinate format (e.g. "10.0246, 76.3079" or "10.0246 76.3079")
    const coordMatch = text.match(/^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return {
          lat,
          lng,
          name: `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          fullName: `GPS Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
        };
      }
    }

    // 2. Degrees Minutes Seconds (DMS) format e.g. 10°01'28.6"N 76°18'28.5"E
    const dmsMatch = text.match(/(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NS])\s*[, ]\s*(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([EW])/i);
    if (dmsMatch) {
      let lat = parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60 + parseFloat(dmsMatch[3]) / 3600;
      if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
      let lng = parseInt(dmsMatch[5], 10) + parseInt(dmsMatch[6], 10) / 60 + parseFloat(dmsMatch[7]) / 3600;
      if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
      return {
        lat: Math.round(lat * 1000000) / 1000000,
        lng: Math.round(lng * 1000000) / 1000000,
        name: `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        fullName: `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      };
    }

    // Helper to extract coordinates from Google Maps URLs
    const extractFromUrlString = (urlStr) => {
      const atMatch = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (atMatch) {
        return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
      }
      const qMatch = urlStr.match(/[?&](?:q|daddr|saddr|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/i);
      if (qMatch) {
        return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
      }
      const protoMatch = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || urlStr.match(/!2d(-?\d+\.\d+)!1d(-?\d+\.\d+)/);
      if (protoMatch) {
        return { lat: parseFloat(protoMatch[1]), lng: parseFloat(protoMatch[2]) };
      }
      return null;
    };

    // 3. Embedded coordinates in URL (@lat,lng or q=lat,lng or ll=lat,lng or !3d!4d)
    const directCoords = extractFromUrlString(text);
    if (directCoords) {
      return {
        lat: directCoords.lat,
        lng: directCoords.lng,
        name: `Map Location (${directCoords.lat.toFixed(4)}, ${directCoords.lng.toFixed(4)})`,
        fullName: `Google Maps Pin: ${directCoords.lat.toFixed(5)}, ${directCoords.lng.toFixed(5)}`
      };
    }

    // 4. Place name inside URL (e.g. /place/Edappally,+Kochi/)
    const placeInUrlMatch = text.match(/\/maps\/place\/([^/@?]+)/i);
    if (placeInUrlMatch) {
      const decodedPlace = decodeURIComponent(placeInUrlMatch[1]).replace(/\+/g, ' ').trim();
      if (decodedPlace) {
        const results = await searchPlace(decodedPlace);
        if (results && results.length > 0) return results[0];
      }
    }

    // 5. Shared text accompanied with URL or short link (Standard Android & iOS Google Maps share)
    // E.g. "Kozhikode Beach\nhttps://maps.app.goo.gl/xyz" or "Dropped pin\nnear Alappuzha\nhttps://..."
    if (text.includes('http://') || text.includes('https://') || text.includes('goo.gl')) {
      const urlMatch = text.match(/https?:\/\/[^\s]+/i);
      const url = urlMatch ? urlMatch[0] : null;

      // Extract cleaned place name text from multiline shared message
      let cleanText = text
        .replace(/https?:\/\/[^\s]+/gi, '')
        .replace(/\b(shared location|dropped pin|directions to|location:?|near)\b/gi, '')
        .replace(/[\r\n\t]+/g, ' ')
        .trim();

      if (cleanText.length >= 2) {
        const results = await searchPlace(cleanText);
        if (results && results.length > 0) return results[0];
      }

      // If text alone didn't resolve or was empty (pure short link), unshorten the URL
      if (url) {
        const expanded = await unshortenUrl(url);
        if (expanded) {
          const expCoords = extractFromUrlString(expanded);
          if (expCoords) {
            return {
              lat: expCoords.lat,
              lng: expCoords.lng,
              name: `Map Location (${expCoords.lat.toFixed(4)}, ${expCoords.lng.toFixed(4)})`,
              fullName: `Google Maps Pin: ${expCoords.lat.toFixed(5)}, ${expCoords.lng.toFixed(5)}`
            };
          }
          const expPlaceMatch = expanded.match(/\/maps\/place\/([^/@?]+)/i);
          if (expPlaceMatch) {
            const placeName = decodeURIComponent(expPlaceMatch[1]).replace(/\+/g, ' ').trim();
            const results = await searchPlace(placeName);
            if (results && results.length > 0) return results[0];
          }
        }
      }
    }

    // 6. Standard text place query (e.g. "Valanchery", "Ponnani", "Cherthala")
    const searchResults = await searchPlace(text);
    if (searchResults && searchResults.length > 0) {
      return searchResults[0];
    }

    return null;
  }

  function getLocalPlaces(query) {
    if (!query || query.trim().length < 2) return [];
    const qLower = query.trim().toLowerCase();
    return POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    ).slice(0, 6);
  }

  /**
   * Universal Rider Amenities Component (< 200m)
   * Displays Tea / Cafe, Snacks, Washroom, Fuel & Air with 1-tap Google Maps nearby search
   */
  function renderAmenitiesHtml(lat, lng, name = '', address = '') {
    const latVal = typeof lat === 'number' ? lat.toFixed(5) : (lat || '');
    const lngVal = typeof lng === 'number' ? lng.toFixed(5) : (lng || '');
    const hasCoords = Boolean(latVal && lngVal);
    const gmapsBase = hasCoords ? 'https://www.google.com/maps/search/' : '';

    // Check if place name or address explicitly mentions food / cafe / fuel
    const textCorpus = ((name || '') + ' ' + (address || '')).toLowerCase();
    const hasCafeOnSite = /cafe|coffee|tea|bakery|chai/.test(textCorpus);
    const hasFoodOnSite = /restaurant|hotel|dhaba|food|bhojanalaya|kitchen|biryani|bhavan|inn/.test(textCorpus);
    const hasFuelOnSite = /petrol|fuel|pump|hpcl|bpcl|ioc|indianoil|shell/.test(textCorpus);

    return `
      <div class="popup-amenities-section" style="margin: 8px 0 6px 0; padding: 8px 10px; background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;">
        <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
          <span>☕ Nearby Rider Amenities (&lt; 200m)</span>
          <span style="font-size: 0.65rem; color: #94a3b8; font-weight: normal;">Tap to find on Maps</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 5px;">
          <a class="amenity-chip-pill ${hasCafeOnSite ? 'amenity-highlight' : ''}" href="javascript:void(0)" onclick="event.stopPropagation(); window.open('${gmapsBase}tea+coffee+cafe/@${latVal},${lngVal},16z', '_blank');" title="Search nearby tea stalls & cafes on Google Maps" style="font-size: 0.70rem; font-weight: 600; background: ${hasCafeOnSite ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.07)'}; color: ${hasCafeOnSite ? '#38bdf8' : '#f1f5f9'}; padding: 3px 7px; border-radius: 6px; border: 1px solid ${hasCafeOnSite ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">☕ Tea / Cafe${hasCafeOnSite ? ' ★' : ''}</a>
          <a class="amenity-chip-pill ${hasFoodOnSite ? 'amenity-highlight' : ''}" href="javascript:void(0)" onclick="event.stopPropagation(); window.open('${gmapsBase}restaurant+food/@${latVal},${lngVal},16z', '_blank');" title="Search nearby restaurants & snacks on Google Maps" style="font-size: 0.70rem; font-weight: 600; background: ${hasFoodOnSite ? 'rgba(0, 230, 118, 0.22)' : 'rgba(255, 255, 255, 0.07)'}; color: ${hasFoodOnSite ? '#00e676' : '#f1f5f9'}; padding: 3px 7px; border-radius: 6px; border: 1px solid ${hasFoodOnSite ? '#00e676' : 'rgba(255, 255, 255, 0.1)'}; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">🍽️ Snacks / Dine${hasFoodOnSite ? ' ★' : ''}</a>
          <a class="amenity-chip-pill" href="javascript:void(0)" onclick="event.stopPropagation(); window.open('${gmapsBase}public+toilet+restroom/@${latVal},${lngVal},16z', '_blank');" title="Search nearby washrooms on Google Maps" style="font-size: 0.70rem; font-weight: 600; background: rgba(255, 255, 255, 0.07); color: #f1f5f9; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); text-decoration: none; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">🚻 Washroom</a>
          <a class="amenity-chip-pill ${hasFuelOnSite ? 'amenity-highlight' : ''}" href="javascript:void(0)" onclick="event.stopPropagation(); window.open('${gmapsBase}petrol+pump/@${latVal},${lngVal},16z', '_blank');" title="Search nearby fuel pump & air on Google Maps" style="font-size: 0.70rem; font-weight: 600; background: ${hasFuelOnSite ? 'rgba(251, 191, 36, 0.22)' : 'rgba(255, 255, 255, 0.07)'}; color: ${hasFuelOnSite ? '#fbbf24' : '#f1f5f9'}; padding: 3px 7px; border-radius: 6px; border: 1px solid ${hasFuelOnSite ? '#fbbf24' : 'rgba(255, 255, 255, 0.1)'}; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; cursor: pointer;">⛽ Fuel / Air 24x7${hasFuelOnSite ? ' ★' : ''}</a>
        </div>
      </div>
    `;
  }

  /**
   * Universal Mobile & WebView Clipboard Copy Utility
   */
  async function copyToClipboard(text, successToast = 'Copied to clipboard!') {
    if (!text) return false;
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        success = true;
      }
    } catch (err) {
      console.warn('[VoltWay Utilities] navigator.clipboard fallback:', err);
    }

    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, 99999);
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (e) {
        console.warn('[VoltWay Utilities] execCommand fallback failed:', e);
      }
    }

    if (success) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(successToast);
      } else {
        alert(successToast);
      }
    } else {
      prompt('Copy link:', text);
    }
    return success;
  }

  return {
    haversine,
    findNearestChargers,
    computeChargingDuration,
    estimateChargingTime,
    formatMinutes,
    searchPlace,
    unshortenUrl,
    resolveLocationInput,
    getLocalPlaces,
    renderAmenitiesHtml,
    copyToClipboard,
    POPULAR_INDIAN_PLACES
  };
})();

window.Utilities = Utilities;
window.copyTextToClipboard = Utilities.copyToClipboard;

/**
 * VoltWay 2W - Essential Rider Utilities
 * SOS Nearest Charger, Physics-Aware Charging Estimator, Geocoding & Verified Station Helpers
 */

const Utilities = (function () {

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

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * SOS: Pinpoint nearest compatible fast and slow chargers from current rider GPS position
   */
  function findNearestChargers(userCoords) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : [];
    if (!userCoords || !allChargers || allChargers.length === 0) {
      return null;
    }

    let nearestFast = null;
    let minFastDist = Infinity;

    let nearestSlow = null;
    let minSlowDist = Infinity;

    let nearestCompatibleFast = null;
    let minCompFastDist = Infinity;

    const hasCompatCheck = window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function';

    for (let i = 0; i < allChargers.length; i++) {
      const c = allChargers[i];
      if (c.is_2w === false) continue;

      const dist = haversine(userCoords.lat, userCoords.lng, c.lat, c.lng);
      const compat = hasCompatCheck ? window.BatteryEngine.isChargerCompatible(c) : { compatible: true, direct: true };

      if (c.type === 'FAST') {
        if (compat.compatible && dist < minCompFastDist) {
          minCompFastDist = dist;
          nearestCompatibleFast = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
        if (dist < minFastDist) {
          minFastDist = dist;
          nearestFast = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
      } else if (c.type === 'SLOW') {
        if (dist < minSlowDist) {
          minSlowDist = dist;
          nearestSlow = { ...c, distanceKm: Math.round(dist * 10) / 10 };
        }
      }
    }

    const bestFast = nearestCompatibleFast || nearestFast;
    const effectiveFastDist = nearestCompatibleFast ? minCompFastDist : minFastDist;
    const absoluteClosest = (bestFast && effectiveFastDist <= minSlowDist) ? bestFast : (nearestSlow || bestFast);

    return {
      nearestFast: bestFast,
      nearestSlow,
      absoluteClosest,
      userCoords
    };
  }

  /**
   * Physics-aware charging duration estimator for 2-wheeler lithium batteries.
   * Accounts for vehicle battery capacity (kWh), charger kW rating (converted at ~90% efficiency),
   * and CC-CV taper above 80% SoC on DC Fast chargers.
   */
  function computeChargingDuration(chargeNeededPct, startSoC = 20, isFast = true, chargerPowerKw = null, vehicleDetails = null) {
    if (!chargeNeededPct || chargeNeededPct <= 0) return 0;

    const batState = vehicleDetails
      ? { vehicleDetails }
      : (window.BatteryEngine ? window.BatteryEngine.getState() : null);
    const v = (batState && batState.vehicleDetails) || {
      batteryCapacity: 3.7,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    };

    const capacityKWh = Math.max(1.5, Number(v.batteryCapacity) || 3.7);
    const start = Math.max(0, Math.min(100, Number(startSoC) || 0));
    const end = Math.min(100, start + chargeNeededPct);

    if (isFast) {
      const stationKw = Number(chargerPowerKw) > 0 ? Number(chargerPowerKw) : 3.0;
      const effectiveKw = Math.min(stationKw, v.dcFastMaxKw || 3.3) * 0.88;
      // % gained per minute in Constant-Current region (0-80%)
      const ccRatePctPerMin = Math.max(0.5, (effectiveKw / capacityKWh) * (100 / 60));
      // Tapered CV region (80-100%) runs ~38% of CC rate
      const cvRatePctPerMin = ccRatePctPerMin * 0.38;

      const upTo80 = Math.max(0, Math.min(80, end) - Math.min(80, start));
      const above80 = Math.max(0, end - Math.max(80, start));
      const rawMins = (upTo80 / ccRatePctPerMin) + (above80 / cvRatePctPerMin);
      return Math.max(1, Math.round(rawMins));
    } else {
      const acKw = Math.max(0.35, Number(v.acChargerKw) || 0.75) * 0.88;
      const acRatePctPerMin = Math.max(0.15, (acKw / capacityKWh) * (100 / 60));
      return Math.max(1, Math.round(chargeNeededPct / acRatePctPerMin));
    }
  }

  function estimateChargingTime(currentPct, targetPct, efficiency = 0.85, vehicleDetails = null) {
    currentPct = Math.max(0, Math.min(100, Number(currentPct) || 0));
    targetPct = Math.max(currentPct, Math.min(100, Number(targetPct) || 80));

    const gainPct = Math.max(0, targetPct - currentPct);
    const rangeGainedKm = Math.round(gainPct * efficiency * 10) / 10;

    const fastMinutes = computeChargingDuration(gainPct, currentPct, true, 3.0, vehicleDetails);
    const slowMinutes = computeChargingDuration(gainPct, currentPct, false, 1.5, vehicleDetails);

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
    const safeMins = Math.max(0, Math.round(Number(mins) || 0));
    if (safeMins < 60) {
      return `${safeMins} min${safeMins === 1 ? '' : 's'}`;
    }
    const hrs = Math.floor(safeMins / 60);
    const remMins = safeMins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs} hr${hrs === 1 ? '' : 's'}`;
  }

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

  async function searchPlace(query) {
    if (!query || query.trim().length < 2) return [];
    const qLower = query.trim().toLowerCase();

    const localMatches = POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    );

    // Offline-first guard: skip network geocoders when device is offline
    if (!navigator.onLine) {
      return localMatches.slice(0, 8);
    }

    let photonResults = [];
    try {
      const encoded = encodeURIComponent(query.trim());
      const url = `https://photon.komoot.io/api/?q=${encoded}&limit=7&lat=10.5&lon=76.2`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2200);
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
    } catch (e) {}

    let osmResults = [];
    if (photonResults.length === 0) {
      try {
        const encoded = encodeURIComponent(query.trim() + ', India');
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=in&limit=5&addressdetails=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2200);
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
      } catch (e) {}
    }

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

  const shortUrlCache = new Map();

  function hasMapLinkOrCoords(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    return /https?:\/\/|geo:|maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps|maps\.google\.com|google\.com\/maps/i.test(rawText) ||
      /-?\d{1,2}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+/.test(rawText) ||
      /\d+[°\s]+\d+['\s]+[\d.]+"?\s*[NS]/i.test(rawText);
  }

  function extractFromUrlString(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const geoMatch = urlStr.match(/geo:(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (geoMatch) return { lat: parseFloat(geoMatch[1]), lng: parseFloat(geoMatch[2]) };
    const atMatch = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    const qMatch = urlStr.match(/[?&](?:q|daddr|saddr|ll|query)=(?:loc:)?(-?\d+\.\d+)(?:,|%2C|\s)+(-?\d+\.\d+)/i);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    const searchCoordMatch = urlStr.match(/\/maps\/(?:search|place)\/(-?\d+\.\d+)(?:,|%2C|\+)+\s*(-?\d+\.\d+)/i);
    if (searchCoordMatch) return { lat: parseFloat(searchCoordMatch[1]), lng: parseFloat(searchCoordMatch[2]) };
    const protoMatch = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (protoMatch) return { lat: parseFloat(protoMatch[1]), lng: parseFloat(protoMatch[2]) };
    // Google Maps place/preview embeds protobuf !2d<lng>!3d<lat> (both literal and %21-encoded)
    const proto2d3d = urlStr.match(/(?:!|%21)2d(-?\d+\.\d+)(?:!|%21)3d(-?\d+\.\d+)/i);
    if (proto2d3d) return { lat: parseFloat(proto2d3d[2]), lng: parseFloat(proto2d3d[1]) };
    const protoLngLat = urlStr.match(/!2d(-?\d+\.\d+)!1d(-?\d+\.\d+)/);
    if (protoLngLat) return { lat: parseFloat(protoLngLat[2]), lng: parseFloat(protoLngLat[1]) };
    const centerMatch = urlStr.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i);
    if (centerMatch) return { lat: parseFloat(centerMatch[1]), lng: parseFloat(centerMatch[2]) };
    return null;
  }

  function extractPlaceTitleFromHtml(html) {
    if (!html || typeof html !== 'string') return '';
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const titleMatch = ogMatch || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!titleMatch || !titleMatch[1]) return '';
    let clean = titleMatch[1]
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s*[-–·]\s*Google Maps\s*$/i, '')
      .split('·')[0]
      .trim();
    if (!clean || /^google maps$/i.test(clean) || /^consent/i.test(clean) || clean.length < 2) return '';
    return clean;
  }

  function extractBestMapInfoFromHtmlOrUrl(resolvedUrl, htmlBody = '') {
    const out = { url: resolvedUrl || '', title: '', coords: null };
    if (resolvedUrl) {
      out.coords = extractFromUrlString(resolvedUrl);
      const urlPlaceM = resolvedUrl.match(/\/maps\/(?:place|search)\/([^/@?]+)/i);
      if (urlPlaceM && urlPlaceM[1]) {
        try {
          const decoded = decodeURIComponent(urlPlaceM[1]).replace(/\+/g, ' ').trim();
          if (decoded && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(decoded)) {
            out.title = decoded;
          }
        } catch (e) {}
      }
    }
    if (htmlBody && typeof htmlBody === 'string') {
      // 1. Try coordinate formats across full HTML body first (center=, !2d!3d, @lat,lng)
      if (!out.coords) out.coords = extractFromUrlString(htmlBody);

      // 2. APP_INITIALIZATION_STATE=[[[scale, LNG, LAT], ...]] — Google embeds LNG first, LAT second
      if (!out.coords) {
        const appStateM = htmlBody.match(/APP_INITIALIZATION_STATE\s*=\s*\[\[\[[^,\]]+,(-?\d{1,3}\.\d{3,}),(-?\d{1,2}\.\d{3,})/);
        if (appStateM) {
          const first = parseFloat(appStateM[1]);
          const second = parseFloat(appStateM[2]);
          if (second >= -90 && second <= 90 && first >= -180 && first <= 180) {
            out.coords = { lat: second, lng: first };
          }
        }
      }

      // 3. Fallback embedded maps URL in HTML
      if (!out.url) {
        const mapsUrlMatch = htmlBody.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^\s"'<>\\]+/i);
        if (mapsUrlMatch) {
          out.url = mapsUrlMatch[0].replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&');
          if (!out.coords) out.coords = extractFromUrlString(out.url);
        }
      }

      if (!out.title) out.title = extractPlaceTitleFromHtml(htmlBody);
    }
    return out;
  }

  /**
   * Resolves short Google Maps URLs using native VoltWayNative plugin (with DoH fallback),
   * CapacitorHttp fallback, or local serve.py endpoint. Cached to avoid duplicate calls.
   */
  async function unshortenUrl(shortUrl) {
    if (!shortUrl) return null;
    const trimmed = shortUrl.trim();
    if (shortUrlCache.has(trimmed)) return shortUrlCache.get(trimmed);
    if (!navigator.onLine) return null;

    // Strip ?g_st=ac Android app-link hint so servers favor web redirect -> @lat,lng
    const cleanedUrl = trimmed
      .replace(/([?&])g_st=[^&]*&?/i, '$1')
      .replace(/[?&]$/, '');

    // 1. Primary on Android APK: native Java resolver (handles Jio DNS timeouts via DoH + extracts HTML coords)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoltWayNative &&
        typeof window.Capacitor.Plugins.VoltWayNative.resolveMapUrl === 'function') {
      try {
        const res = await window.Capacitor.Plugins.VoltWayNative.resolveMapUrl({ url: cleanedUrl });
        if (res && res.success) {
          const coords = (typeof res.lat === 'number' && typeof res.lng === 'number' && !isNaN(res.lat) && !isNaN(res.lng))
            ? { lat: res.lat, lng: res.lng }
            : (res.url ? extractFromUrlString(res.url) : null);
          if (coords || (res.url && res.url.includes('google.'))) {
            const info = { url: res.url || cleanedUrl, title: res.title || '', coords };
            shortUrlCache.set(trimmed, info);
            return info;
          }
        }
      } catch (err) {}
    }

    // 2. Secondary on Android APK: CapacitorHttp with strict 3s timeout (single fast check)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
      try {
        const resp = await window.Capacitor.Plugins.CapacitorHttp.get({
          url: cleanedUrl,
          connectTimeout: 3000,
          readTimeout: 3000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });
        const headerLoc = (resp && resp.headers && (resp.headers['location'] || resp.headers['Location'])) || '';
        const finalUrl = (resp && resp.url && resp.url !== cleanedUrl && resp.url !== trimmed)
          ? resp.url
          : (headerLoc && headerLoc.includes('google') ? headerLoc : '');
        const bodyStr = (resp && typeof resp.data === 'string') ? resp.data : '';
        const info = extractBestMapInfoFromHtmlOrUrl(finalUrl, bodyStr);
        if (info.coords || (info.url && info.url.includes('google.'))) {
          shortUrlCache.set(trimmed, info);
          return info;
        }
      } catch (err) {}
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`/api/resolve-maps-url?url=${encodeURIComponent(cleanedUrl)}`, { signal: controller.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json();
          if (data.success && data.resolved_url) {
            shortUrlCache.set(trimmed, data.resolved_url);
            return data.resolved_url;
          }
        }
      } catch (e) {}
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const resp = await fetch(cleanedUrl, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (resp && resp.url && resp.url !== cleanedUrl && resp.url.includes('google.com/maps')) {
        shortUrlCache.set(trimmed, resp.url);
        return resp.url;
      }
    } catch (e) {}

    return null;
  }

  function parseGoogleMapsDirectionsUrl(urlOrInfo) {
    const url = (urlOrInfo && typeof urlOrInfo === 'object') ? urlOrInfo.url : urlOrInfo;
    if (!url || typeof url !== 'string' || !url.includes('/maps/dir/')) return null;
    try {
      const qMatch = url.match(/[?&]origin=([^&]+).*?[?&]destination=([^&]+)/i);
      if (qMatch) {
        const origin = decodeURIComponent(qMatch[1]).replace(/\+/g, ' ');
        const destination = decodeURIComponent(qMatch[2]).replace(/\+/g, ' ');
        const wpMatch = url.match(/[?&]waypoints=([^&]+)/i);
        const waypoints = wpMatch ? decodeURIComponent(wpMatch[1]).replace(/\+/g, ' ').split('|') : [];
        return { origin, destination, waypoints };
      }

      const pathMatch = url.match(/\/maps\/dir\/(.*?)(?:\/@|\?|$)/i);
      if (pathMatch) {
        const rawParts = pathMatch[1]
          .split('/')
          .map(p => decodeURIComponent(p).replace(/\+/g, ' ').trim())
          .filter(p => p && !p.startsWith('@') && !p.startsWith('data='));
        if (rawParts.length >= 2) {
          return {
            origin: rawParts[0],
            destination: rawParts[rawParts.length - 1],
            waypoints: rawParts.slice(1, -1)
          };
        }
      }
    } catch (e) {}
    return null;
  }

  async function resolveLocationInput(rawInput, preExpanded = null) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const text = rawInput.trim();
    if (!text) return null;

    // 1. Direct coordinates ("10.0246, 76.3079") or geo: URI ("geo:10.0246,76.3079?q=Name")
    const coordMatch = text.match(/^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return {
          lat,
          lng,
          name: `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          fullName: `GPS Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          isMapLink: true
        };
      }
    }

    // 2. Degrees Minutes Seconds (DMS)
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
        fullName: `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        isMapLink: true
      };
    }

    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    let labelHint = '';
    for (const line of lines) {
      const textOnly = line
        .replace(/https?:\/\/[^\s]+/gi, '')
        .replace(/geo:[^\s]+/gi, '')
        .replace(/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps)[^\s]*/gi, '')
        .replace(/^(?:dropped pin|shared location|near:?|location:?)\s*/i, '')
        .replace(/[-–:|,\s]+$/, '')
        .trim();
      if (textOnly.length >= 2 && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(textOnly)) {
        labelHint = textOnly;
        break;
      }
    }

    // Extract geo: query name if present (e.g. geo:10.0,76.3?q=10.0,76.3(Ather%20Space))
    if (!labelHint && /^geo:/i.test(text)) {
      const parenMatch = text.match(/\(([^)]+)\)/);
      if (parenMatch && parenMatch[1]) {
        labelHint = decodeURIComponent(parenMatch[1]).replace(/\+/g, ' ').trim();
      }
    }

    const directCoords = extractFromUrlString(text);
    if (directCoords) {
      const placeInDirectUrl = text.match(/\/maps\/place\/([^/@?]+)/i);
      const urlPlaceLabel = placeInDirectUrl ? decodeURIComponent(placeInDirectUrl[1]).replace(/\+/g, ' ').trim() : '';
      const display = labelHint || urlPlaceLabel || `Map Pin (${directCoords.lat.toFixed(4)}, ${directCoords.lng.toFixed(4)})`;
      return {
        lat: directCoords.lat,
        lng: directCoords.lng,
        name: display,
        fullName: `Google Maps Pin: ${directCoords.lat.toFixed(5)}, ${directCoords.lng.toFixed(5)}`,
        isMapLink: true
      };
    }

    const placeInUrlMatch = text.match(/\/maps\/place\/([^/@?]+)/i) || text.match(/\/maps\/search\/([^/@?]+)/i);
    if (placeInUrlMatch) {
      const decodedPlace = decodeURIComponent(placeInUrlMatch[1]).replace(/\+/g, ' ').trim();
      if (decodedPlace) {
        const results = await searchPlace(decodedPlace);
        if (results && results.length > 0) return { ...results[0], isMapLink: true };
      }
    }

    // 3. Resolve URL (short link like maps.app.goo.gl/...?g_st=ac) BEFORE falling back to label line text search
    if (/https?:\/\/|goo\.gl|maps\.app/i.test(text)) {
      const bareShortMatch = text.match(/(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps)\/[^\s]+/i);
      const urlMatch = text.match(/https?:\/\/[^\s]+/i);
      const url = urlMatch ? urlMatch[0] : (bareShortMatch ? `https://${bareShortMatch[0]}` : null);
      if (url) {
        const expandedRaw = preExpanded || await unshortenUrl(url);
        if (expandedRaw) {
          const expUrl = typeof expandedRaw === 'object' ? (expandedRaw.url || '') : String(expandedRaw);
          const expTitle = typeof expandedRaw === 'object' ? (expandedRaw.title || '') : '';
          const expCoords = (typeof expandedRaw === 'object' && expandedRaw.coords) || extractFromUrlString(expUrl);
          const expPlaceMatch = expUrl.match(/\/maps\/place\/([^/@?]+)/i) || expUrl.match(/\/maps\/search\/([^/@?]+)/i);
          const expPlace = expPlaceMatch ? decodeURIComponent(expPlaceMatch[1]).replace(/\+/g, ' ').trim() : '';

          if (expCoords) {
            const bestName = labelHint || expTitle || expPlace || `Map Pin (${expCoords.lat.toFixed(4)}, ${expCoords.lng.toFixed(4)})`;
            return {
              lat: expCoords.lat,
              lng: expCoords.lng,
              name: bestName,
              fullName: `Google Maps Pin: ${expCoords.lat.toFixed(5)}, ${expCoords.lng.toFixed(5)}`,
              isMapLink: true
            };
          }
          if (expPlace || expTitle) {
            const results = await searchPlace(expPlace || expTitle);
            if (results && results.length > 0) return { ...results[0], isMapLink: true };
          }
          if (expTitle) {
            const results = await searchPlace(expTitle);
            if (results && results.length > 0) return { ...results[0], isMapLink: true };
          }
        }
      }

      if (labelHint) {
        const results = await searchPlace(labelHint);
        if (results && results.length > 0) return { ...results[0], isMapLink: true };
      }
      return null;
    }

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
   * Honest Address-Verified Venue Hints ONLY.
   * Does NOT invent unverified washroom, cafe, or fuel claims.
   */
  function renderAmenitiesHtml(name = '', address = '') {
    const textCorpus = `${name || ''} ${address || ''}`.toLowerCase();
    const hints = [];
    if (/\b(cafe|coffee|tea|bakery|chai)\b/.test(textCorpus)) hints.push('☕ Cafe / Tea Shop');
    if (/\b(restaurant|hotel|dhaba|food|bhojanalaya|kitchen|biryani|inn|resort)\b/.test(textCorpus)) hints.push('🍽️ Restaurant / Hotel');
    if (/\b(petrol|fuel|pump|hpcl|bpcl|ioc|indianoil|shell|nayara)\b/.test(textCorpus)) hints.push('⛽ Fuel Station');
    if (/\b(mall|plaza|complex|arcade|supermarket|hub|showroom)\b/.test(textCorpus)) hints.push('🏬 Commercial Hub');

    if (hints.length === 0) return '';

    return `
      <div class="popup-amenities-section">
        <div class="amenities-hdr">
          <span>📍 Venue Hint (From Address)</span>
        </div>
        <div class="amenities-row">
          ${hints.map(h => `<span class="amenity-chip-pill amenity-verified">${escapeHtml(h)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  async function copyToClipboard(text, successToast = 'Copied to clipboard!') {
    if (!text) return false;
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        success = true;
      }
    } catch (err) {}

    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, 99999);
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (e) {}
    }

    if (success && window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
      window.SyncEngine.showAutoUpdateToast(successToast);
    }
    return success;
  }

  return {
    haversine,
    escapeHtml,
    findNearestChargers,
    computeChargingDuration,
    estimateChargingTime,
    formatMinutes,
    searchPlace,
    unshortenUrl,
    hasMapLinkOrCoords,
    parseGoogleMapsDirectionsUrl,
    resolveLocationInput,
    getLocalPlaces,
    renderAmenitiesHtml,
    copyToClipboard,
    POPULAR_INDIAN_PLACES
  };
})();

window.Utilities = Utilities;

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
    { name: 'Mukkam', fullName: 'Mukkam, Kozhikode, Kerala, India', lat: 11.3210, lng: 75.9950 },
    { name: 'Thamarassery', fullName: 'Thamarassery, Kozhikode, Kerala, India', lat: 11.4141, lng: 75.9369 },
    { name: 'Koduvally', fullName: 'Koduvally, Kozhikode, Kerala, India', lat: 11.3591, lng: 75.9144 },
    { name: 'Koyilandy (Quilandy)', fullName: 'Koyilandy, Kozhikode, Kerala, India', lat: 11.4426, lng: 75.6976 },
    { name: 'Balussery', fullName: 'Balussery, Kozhikode, Kerala, India', lat: 11.4472, lng: 75.8256 },
    { name: 'Ramanattukara', fullName: 'Ramanattukara, Kozhikode, Kerala, India', lat: 11.1795, lng: 75.8644 },
    { name: 'Kondotty', fullName: 'Kondotty, Malappuram, Kerala, India', lat: 11.1456, lng: 75.9639 },
    { name: 'Karipur (CCJ Airport)', fullName: 'Calicut International Airport, Karipur, Malappuram, Kerala, India', lat: 11.1368, lng: 75.9553 },
    { name: 'Wandoor', fullName: 'Wandoor, Malappuram, Kerala, India', lat: 11.1955, lng: 76.2360 },
    { name: 'Edakkara', fullName: 'Edakkara, Malappuram, Kerala, India', lat: 11.3592, lng: 76.3046 },
    { name: 'Edappal', fullName: 'Edappal, Malappuram, Kerala, India', lat: 10.7858, lng: 76.0063 },
    { name: 'Kuttippuram', fullName: 'Kuttippuram, Malappuram, Kerala, India', lat: 10.8442, lng: 76.0285 },
    { name: 'Tanur', fullName: 'Tanur, Malappuram, Kerala, India', lat: 10.9776, lng: 75.8758 },
    { name: 'Pattambi', fullName: 'Pattambi, Palakkad, Kerala, India', lat: 10.8068, lng: 76.1912 },
    { name: 'Shornur', fullName: 'Shornur, Palakkad, Kerala, India', lat: 10.7615, lng: 76.2711 },
    { name: 'Ottapalam', fullName: 'Ottapalam, Palakkad, Kerala, India', lat: 10.7725, lng: 76.3771 },
    { name: 'Mannarkkad', fullName: 'Mannarkkad, Palakkad, Kerala, India', lat: 10.9926, lng: 76.4622 },
    { name: 'Wadakkanchery', fullName: 'Wadakkanchery, Thrissur, Kerala, India', lat: 10.6632, lng: 76.2496 },
    { name: 'Kodungallur', fullName: 'Kodungallur, Thrissur, Kerala, India', lat: 10.2237, lng: 76.1973 },
    { name: 'Irinjalakuda', fullName: 'Irinjalakuda, Thrissur, Kerala, India', lat: 10.3435, lng: 76.2152 },
    { name: 'North Paravur', fullName: 'North Paravur, Ernakulam, Kerala, India', lat: 10.1449, lng: 76.2248 },
    { name: 'Thodupuzha', fullName: 'Thodupuzha, Idukki, Kerala, India', lat: 9.8959, lng: 76.7184 },
    { name: 'Kattappana', fullName: 'Kattappana, Idukki, Kerala, India', lat: 9.7563, lng: 77.1149 },
    { name: 'Kumily (Thekkady)', fullName: 'Kumily, Thekkady, Idukki, Kerala, India', lat: 9.6031, lng: 77.1615 },
    { name: 'Adimali', fullName: 'Adimali, Idukki, Kerala, India', lat: 10.0110, lng: 76.9532 },
    { name: 'Vagamon', fullName: 'Vagamon, Idukki, Kerala, India', lat: 9.6862, lng: 76.9052 },
    { name: 'Adoor', fullName: 'Adoor, Pathanamthitta, Kerala, India', lat: 9.1528, lng: 76.7356 },
    { name: 'Ranni', fullName: 'Ranni, Pathanamthitta, Kerala, India', lat: 9.3863, lng: 76.7859 },
    { name: 'Chengannur', fullName: 'Chengannur, Alappuzha, Kerala, India', lat: 9.3156, lng: 76.6152 },
    { name: 'Mavelikara', fullName: 'Mavelikara, Alappuzha, Kerala, India', lat: 9.2458, lng: 76.5446 },
    { name: 'Haripad', fullName: 'Haripad, Alappuzha, Kerala, India', lat: 9.2775, lng: 76.4631 },
    { name: 'Kottarakkara', fullName: 'Kottarakkara, Kollam, Kerala, India', lat: 9.0005, lng: 76.7793 },
    { name: 'Punalur', fullName: 'Punalur, Kollam, Kerala, India', lat: 9.0177, lng: 76.9261 },
    { name: 'Karunagappally', fullName: 'Karunagappally, Kollam, Kerala, India', lat: 9.0556, lng: 76.5356 },
    { name: 'Varkala', fullName: 'Varkala, Thiruvananthapuram, Kerala, India', lat: 8.7379, lng: 76.7163 },
    { name: 'Technopark (Kazhakkoottam)', fullName: 'Technopark, Kazhakkoottam, Thiruvananthapuram, Kerala, India', lat: 8.5562, lng: 76.8816 },
    { name: 'Taliparamba', fullName: 'Taliparamba, Kannur, Kerala, India', lat: 12.0434, lng: 75.3607 },
    { name: 'Mattannur', fullName: 'Mattannur, Kannur, Kerala, India', lat: 11.9333, lng: 75.5681 },
    { name: 'Iritty', fullName: 'Iritty, Kannur, Kerala, India', lat: 11.9814, lng: 75.6730 },
    { name: 'Nileshwar', fullName: 'Nileshwar, Kasaragod, Kerala, India', lat: 12.2576, lng: 75.1342 },
    { name: 'Lulu Mall Kochi', fullName: 'LuLu International Shopping Mall, Edappally, Kochi, Kerala, India', lat: 10.0275, lng: 76.3079 },
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

  const OLC_ALPHABET = '23456789CFGHJMPQRVWX';
  const PLUS_CODE_RE = /\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4})\b/;

  function extractPlusCode(str) {
    if (!str || typeof str !== 'string') return '';
    const m = str.toUpperCase().match(PLUS_CODE_RE);
    return m ? m[1] : '';
  }

  function decodeFullPlusCode(fullCode) {
    if (!fullCode) return null;
    const clean = fullCode.toUpperCase().replace('+', '');
    if (clean.length < 8) return null;
    const res = [20.0, 1.0, 0.05, 0.0025, 0.000125];
    let lat = -90.0;
    let lng = -180.0;
    const pairs = Math.min(5, Math.floor(clean.length / 2));
    for (let i = 0; i < pairs; i++) {
      const cLat = OLC_ALPHABET.indexOf(clean[i * 2]);
      const cLng = OLC_ALPHABET.indexOf(clean[i * 2 + 1]);
      if (cLat < 0 || cLng < 0) return null;
      lat += cLat * res[i];
      lng += cLng * res[i];
    }
    const step = res[pairs - 1];
    return {
      lat: Math.round((lat + step / 2) * 1000000) / 1000000,
      lng: Math.round((lng + step / 2) * 1000000) / 1000000
    };
  }

  function recoverPlusCode(codeStr, refLat, refLng) {
    if (!codeStr || !codeStr.includes('+')) return null;
    const upper = codeStr.toUpperCase().trim();
    const plusIdx = upper.indexOf('+');
    if (plusIdx >= 8) return decodeFullPlusCode(upper);
    if (typeof refLat !== 'number' || typeof refLng !== 'number' || isNaN(refLat) || isNaN(refLng)) return null;

    if (plusIdx === 4) {
      let best = null;
      const baseLat = Math.floor(refLat + 90);
      const baseLng = Math.floor(refLng + 180);
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLng = -1; dLng <= 1; dLng++) {
          const rLat = baseLat + dLat;
          const rLng = baseLng + dLng;
          if (rLat < 0 || rLng < 0) continue;
          const i20Lat = Math.floor(rLat / 20);
          const i1Lat = rLat % 20;
          const i20Lng = Math.floor(rLng / 20);
          const i1Lng = rLng % 20;
          if (i20Lat >= 20 || i20Lng >= 20) continue;
          const prefix = OLC_ALPHABET[i20Lat] + OLC_ALPHABET[i20Lng] + OLC_ALPHABET[i1Lat] + OLC_ALPHABET[i1Lng];
          const pt = decodeFullPlusCode(prefix + upper);
          if (!pt) continue;
          const d = (pt.lat - refLat) * (pt.lat - refLat) + (pt.lng - refLng) * (pt.lng - refLng);
          if (!best || d < best.d) best = { d, pt };
        }
      }
      return best ? best.pt : null;
    }

    if (plusIdx === 6) {
      let best = null;
      const b20Lat = Math.floor((refLat + 90) / 20);
      const b20Lng = Math.floor((refLng + 180) / 20);
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLng = -1; dLng <= 1; dLng++) {
          const iLat = b20Lat + dLat;
          const iLng = b20Lng + dLng;
          if (iLat < 0 || iLat >= 20 || iLng < 0 || iLng >= 20) continue;
          const pt = decodeFullPlusCode(OLC_ALPHABET[iLat] + OLC_ALPHABET[iLng] + upper);
          if (!pt) continue;
          const d = (pt.lat - refLat) * (pt.lat - refLat) + (pt.lng - refLng) * (pt.lng - refLng);
          if (!best || d < best.d) best = { d, pt };
        }
      }
      return best ? best.pt : null;
    }

    return null;
  }

  function decodeUrlSegment(seg) {
    if (!seg || typeof seg !== 'string') return '';
    const spaced = seg.replace(/\+/g, ' ');
    try {
      return decodeURIComponent(spaced).trim();
    } catch (e) {
      return spaced.trim();
    }
  }

  function normalizeIndiaPlaceQuery(qStr) {
    if (!qStr || typeof qStr !== 'string') return '';
    return qStr
      .replace(PLUS_CODE_RE, '')
      .replace(/\bKeralam\b/gi, 'Kerala')
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/^[\s,+]+|[\s,]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  let lastGeoDiag = '';

  async function fetchJsonWithAppUA(url, timeoutMs = 6000, tag = 'Geo') {
    const capHttp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (capHttp && typeof capHttp.get === 'function') {
      try {
        const resp = await capHttp.get({
          url,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VoltWay2W/5.53 (https://banispp.github.io/voltway/)'
          }
        });
        if (resp && resp.status >= 200 && resp.status < 300) {
          return typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        }
        lastGeoDiag = `${tag}:${resp ? resp.status : 'empty'}`;
        return null;
      } catch (e) {
        lastGeoDiag = `${tag}:${e && e.message ? e.message.slice(0, 22) : 'err'}`;
        return null;
      }
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        return await resp.json();
      }
      lastGeoDiag = `${tag}:${resp.status}`;
    } catch (e) {
      lastGeoDiag = `${tag}:${e && e.name ? e.name : 'err'}`;
    }
    return null;
  }

  async function queryNominatimRaw(qStr, timeoutMs = 6000) {
    try {
      const cleanQ = qStr.trim();
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQ)}&countrycodes=in&limit=8&addressdetails=1&accept-language=en,ml`;
      const data = await fetchJsonWithAppUA(url, timeoutMs, 'Nom');
      if (Array.isArray(data)) {
        return data.map(item => ({
          name: item.display_name.split(',')[0],
          fullName: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon)
        })).filter(it => !isNaN(it.lat) && !isNaN(it.lng));
      }
    } catch (e) {}
    return [];
  }

  async function queryPhotonRaw(qStr, timeoutMs = 6000) {
    try {
      const encoded = encodeURIComponent(qStr.trim());
      // bbox biased to India; lat/lon bias to Kerala centre
      const url = `https://photon.komoot.io/api/?q=${encoded}&limit=8&lat=10.5&lon=76.2&bbox=68.0,8.0,97.0,37.0&lang=en`;
      const data = await fetchJsonWithAppUA(url, timeoutMs, 'Pho');
      if (data && data.features && data.features.length > 0) {
        return data.features.map(f => {
          const props = f.properties || {};
          const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
          const name = props.name || props.street || qStr.trim();
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
        }).filter(it => !isNaN(it.lat) && !isNaN(it.lng));
      }
    } catch (e) {}
    return [];
  }

  async function queryNativeAndroidGeocoder(qStr) {
    const vn = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoltWayNative;
    if (!vn || typeof vn.geocodePlace !== 'function') return [];
    try {
      const res = await vn.geocodePlace({ query: qStr });
      if (res && res.success && Array.isArray(res.results)) {
        return res.results
          .map(it => ({
            name: it.name || qStr,
            fullName: it.fullName || it.name || qStr,
            lat: parseFloat(it.lat),
            lng: parseFloat(it.lng)
          }))
          .filter(it => !isNaN(it.lat) && !isNaN(it.lng));
      }
    } catch (e) {}
    return [];
  }

  async function searchPlace(query) {
    if (!query || query.trim().length < 2) return [];
    const rawTrim = query.trim();
    const qTrim = normalizeIndiaPlaceQuery(rawTrim) || rawTrim;
    const qLower = qTrim.toLowerCase();
    lastGeoDiag = '';

    const localMatches = POPULAR_INDIAN_PLACES.filter(p =>
      p.name.toLowerCase().includes(qLower) || p.fullName.toLowerCase().includes(qLower)
    );

    // Offline-first guard: skip network geocoders when device is offline
    if (!navigator.onLine) {
      return localMatches.slice(0, 8);
    }

    // Run Photon and Nominatim in parallel with 6.5s mobile timeout
    const [photonSettled, osmSettled] = await Promise.allSettled([
      queryPhotonRaw(qTrim, 6500),
      queryNominatimRaw(qTrim, 6500)
    ]);

    let photonResults = photonSettled.status === 'fulfilled' ? photonSettled.value : [];
    let osmResults = osmSettled.status === 'fulfilled' ? osmSettled.value : [];
    let nativeGeoResults = [];

    // Try native Android Play Services Geocoder immediately if both online web geocoders missed
    if (photonResults.length === 0 && osmResults.length === 0) {
      nativeGeoResults = await queryNativeAndroidGeocoder(qTrim);
    }

    // Progressive fallback if noisy/multi-word/address query returned nothing from all engines
    const pinMatch = rawTrim.match(/\b([1-9]\d{5})\b/);
    const hasPlus = Boolean(extractPlusCode(rawTrim));
    if (photonResults.length === 0 && osmResults.length === 0 && nativeGeoResults.length === 0 && qTrim.length >= 4) {
      const fallbacks = [];
      const commaParts = qTrim.split(',').map(s => s.trim()).filter(Boolean);
      const stateMatch = qTrim.match(/\b(Kerala|Karnataka|Tamil Nadu|Maharashtra|Goa|Telangana|Andhra Pradesh|Delhi|Gujarat|Rajasthan|Punjab|Haryana|West Bengal|Uttar Pradesh|Madhya Pradesh|Bihar|Odisha|Jharkhand|Assam|Puducherry)\b/i);
      const isKeralaPin = pinMatch && /^6[789]\d{4}$/.test(pinMatch[1]);
      const fallbackState = stateMatch ? stateMatch[1] : (isKeralaPin ? 'Kerala' : 'India');

      // When no Plus Code, try Nominatim exact match on `<PlaceName>, <State>` first (e.g. "Adyanpara Waterfall, Kerala")
      if (!hasPlus && commaParts.length >= 2) {
        const p0Clean = commaParts[0].replace(/\b\d{6}\b/g, '').trim();
        if (p0Clean && p0Clean.length >= 3 && !/^\d+$/.test(p0Clean)) {
          const exactPoiOsm = await queryNominatimRaw(`${p0Clean}, ${fallbackState}`, 4500);
          if (exactPoiOsm.length > 0) {
            osmResults = exactPoiOsm;
          }
        }
      }

      if (osmResults.length === 0) {
        if (commaParts.length >= 2) {
          fallbacks.push(commaParts.slice(1).join(', '));
          if (commaParts.length >= 3) {
            const p1Clean = commaParts[1].replace(/\b\d{6}\b/g, '').trim();
            if (p1Clean) fallbacks.push(`${p1Clean}, ${fallbackState}`);
            if (commaParts.length >= 4) {
              const p2Clean = commaParts[2].replace(/\b\d{6}\b/g, '').trim();
              if (p2Clean && p2Clean.toLowerCase() !== fallbackState.toLowerCase()) {
                fallbacks.push(`${p2Clean}, ${fallbackState}`);
              }
            }
            fallbacks.push(commaParts.slice(-3).join(', '));
          } else {
            fallbacks.push(commaParts[commaParts.length - 1]);
          }
        }
        if (pinMatch) {
          fallbacks.push(`${pinMatch[1]}, India`);
        }
        const words = qTrim.replace(/[,]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
        if (commaParts.length < 2 && words.length >= 3) {
          fallbacks.push(words.slice(-2).join(' '));
          fallbacks.push(words[words.length - 1]);
        } else if (words.length >= 2 && localMatches.length === 0) {
          // Check local places against individual significant town words
          words.forEach(w => {
            const wl = w.toLowerCase();
            if (wl.length >= 4 && wl !== 'kerala' && wl !== 'india' && wl !== 'road') {
              POPULAR_INDIAN_PLACES.forEach(p => {
                if (p.name.toLowerCase().includes(wl) && !localMatches.includes(p)) {
                  localMatches.push(p);
                }
              });
            }
          });
        }

        for (const fb of fallbacks) {
          if (!fb || fb.length < 3 || fb === qTrim) continue;
          const [fbP, fbO] = await Promise.allSettled([
            queryPhotonRaw(fb, 4200),
            queryNominatimRaw(fb, 4200)
          ]);
          const pArr = fbP.status === 'fulfilled' ? fbP.value : [];
          const oArr = fbO.status === 'fulfilled' ? fbO.value : [];
          if (pArr.length > 0 || oArr.length > 0) {
            photonResults = pArr;
            osmResults = oArr;
            break;
          }
        }
      }
    }

    // Merge local + native + Photon + Nominatim (deduplicate by proximity ~3km)
    const combined = [...localMatches];
    const allRemote = [...nativeGeoResults, ...photonResults, ...osmResults];
    allRemote.forEach(item => {
      const exists = combined.some(c =>
        Math.abs(c.lat - item.lat) < 0.03 && Math.abs(c.lng - item.lng) < 0.03
      );
      if (!exists) {
        combined.push(item);
      }
    });

    // Disambiguate duplicate Indian village/town names using 6-digit PIN code when results span > 30km
    if (pinMatch && combined.length > 1) {
      let minLat = combined[0].lat, maxLat = combined[0].lat;
      let minLng = combined[0].lng, maxLng = combined[0].lng;
      for (const c of combined) {
        if (c.lat < minLat) minLat = c.lat;
        if (c.lat > maxLat) maxLat = c.lat;
        if (c.lng < minLng) minLng = c.lng;
        if (c.lng > maxLng) maxLng = c.lng;
      }
      if ((maxLat - minLat) > 0.3 || (maxLng - minLng) > 0.3) {
        const pinHits = await queryPhotonRaw(`${pinMatch[1]}, India`, 2200);
        if (pinHits && pinHits.length > 0) {
          const pr = pinHits[0];
          combined.sort((a, b) =>
            ((a.lat - pr.lat) ** 2 + (a.lng - pr.lng) ** 2) -
            ((b.lat - pr.lat) ** 2 + (b.lng - pr.lng) ** 2)
          );
        }
      }
    }

    return combined.slice(0, 10);
  }

  const shortUrlCache = new Map();
  let lastResolveDiag = null;

  function isMapsOrGeoInput(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    return /geo:|maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps|maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|share\.google/i.test(rawText) ||
      /-?\d{1,2}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+/.test(rawText) ||
      /\d+[°\s]+\d+['\s]+[\d.]+"?\s*[NS]/i.test(rawText) ||
      PLUS_CODE_RE.test(rawText.toUpperCase());
  }

  function hasMapLinkOrCoords(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    return /https?:\/\//i.test(rawText) || isMapsOrGeoInput(rawText);
  }

  function parseDmsPair(str) {
    if (!str || typeof str !== 'string') return null;
    const dmsMatch = str.match(/(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NS])\s*[,+\s]+\s*(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([EW])/i);
    if (!dmsMatch) return null;
    let lat = parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60 + parseFloat(dmsMatch[3]) / 3600;
    if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
    let lng = parseInt(dmsMatch[5], 10) + parseInt(dmsMatch[6], 10) / 60 + parseFloat(dmsMatch[7]) / 3600;
    if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {
        lat: Math.round(lat * 1000000) / 1000000,
        lng: Math.round(lng * 1000000) / 1000000
      };
    }
    return null;
  }

  function extractFromUrlString(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const geoMatch = urlStr.match(/geo:(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (geoMatch) return { lat: parseFloat(geoMatch[1]), lng: parseFloat(geoMatch[2]) };
    // Exact pin query params & place coordinates BEFORE viewport @lat,lng
    const qMatch = urlStr.match(/[?&](?:q|daddr|saddr|ll|query)=(?:loc:)?(-?\d+\.\d+)(?:,|%2C|\s|\+)+(-?\d+\.\d+)/i);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    const searchCoordMatch = urlStr.match(/\/maps\/(?:search|place)\/(-?\d+\.\d+)(?:,|%2C|\+)+\s*(-?\d+\.\d+)/i);
    if (searchCoordMatch) return { lat: parseFloat(searchCoordMatch[1]), lng: parseFloat(searchCoordMatch[2]) };
    // Protobuf !8m2!3d<lat>!4d<lng> or !3d<lat>!4d<lng> is the true placed pin (more accurate than @viewport)
    const protoMatch = urlStr.match(/(?:!|%21)3d(-?\d+\.\d+)(?:!|%21)4d(-?\d+\.\d+)/i);
    if (protoMatch) return { lat: parseFloat(protoMatch[1]), lng: parseFloat(protoMatch[2]) };
    // Google Maps place/preview embeds protobuf !2d<lng>!3d<lat> (both literal and %21-encoded)
    const proto2d3d = urlStr.match(/(?:!|%21)2d(-?\d+\.\d+)(?:!|%21)3d(-?\d+\.\d+)/i);
    if (proto2d3d) return { lat: parseFloat(proto2d3d[2]), lng: parseFloat(proto2d3d[1]) };
    const protoLngLat = urlStr.match(/!2d(-?\d+\.\d+)!1d(-?\d+\.\d+)/);
    if (protoLngLat) return { lat: parseFloat(protoLngLat[2]), lng: parseFloat(protoLngLat[1]) };
    // URL-encoded DMS coords inside /maps/place/10%C2%B058'33.6%22N+76%C2%B013'30.0%22E/...
    try {
      const decodedUrl = decodeURIComponent(urlStr);
      const dmsFromUrl = parseDmsPair(decodedUrl);
      if (dmsFromUrl) return dmsFromUrl;
    } catch (e) {}
    const atMatch = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
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
    const out = { url: resolvedUrl || '', title: '', coords: null, coordsFromUrl: false };
    if (resolvedUrl) {
      out.coords = extractFromUrlString(resolvedUrl);
      if (out.coords) out.coordsFromUrl = true;
      const urlPlaceM = resolvedUrl.match(/\/maps\/(?:place|search)\/([^/@?]+)/i) ||
        resolvedUrl.match(/[?&](?:q|query)=([^&]+)/i);
      if (urlPlaceM && urlPlaceM[1]) {
        const decoded = decodeUrlSegment(urlPlaceM[1]);
        if (decoded && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(decoded) && !parseDmsPair(decoded)) {
          out.title = decoded;
        }
      }
    }
    if (htmlBody && typeof htmlBody === 'string') {
      // ONLY trust explicit placed pin markers (!8m2!3d!4d, !3d!4d, or staticmap markers=) from HTML.
      // NEVER extract center=, !2d!3d, or APP_INITIALIZATION_STATE from HTML shell because Google embeds
      // the viewer's own IP-centroid (wrong common town near user!) when the URL had no pin coords.
      if (!out.coords) {
        const pin3d4d = htmlBody.match(/(?:!|%21)8m2(?:!|%21)3d(-?\d+\.\d+)(?:!|%21)4d(-?\d+\.\d+)/i) ||
          htmlBody.match(/(?:!|%21)3d(-?\d+\.\d+)(?:!|%21)4d(-?\d+\.\d+)/i);
        if (pin3d4d) {
          const lat = parseFloat(pin3d4d[1]);
          const lng = parseFloat(pin3d4d[2]);
          if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            out.coords = { lat, lng };
          }
        }
      }
      if (!out.coords) {
        const markerM = htmlBody.match(/staticmap\?[^"'<>]*markers=[^"'<>]*?(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i);
        if (markerM) {
          const lat = parseFloat(markerM[1]);
          const lng = parseFloat(markerM[2]);
          if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            out.coords = { lat, lng };
          }
        }
      }

      // Fallback embedded maps URL in HTML
      if (!out.url) {
        const mapsUrlMatch = htmlBody.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^\s"'<>\\]+/i);
        if (mapsUrlMatch) {
          out.url = mapsUrlMatch[0].replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&');
          if (!out.coords) {
            out.coords = extractFromUrlString(out.url);
            if (out.coords) out.coordsFromUrl = true;
          }
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
    lastResolveDiag = { stage: 'start', staleApk: false, detail: '' };
    if (!navigator.onLine) {
      lastResolveDiag = { stage: 'offline', staleApk: false, detail: 'Device offline' };
      return null;
    }

    // Strip ?g_st=ac Android app-link hint so servers favor web redirect -> @lat,lng
    const cleanedUrl = trimmed
      .replace(/([?&])g_st=[^&]*&?/i, '$1')
      .replace(/[?&]$/, '');

    // 1. Primary on Android APK: native Java resolver (handles Jio DNS timeouts via DoH + extracts HTML coords)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoltWayNative &&
        typeof window.Capacitor.Plugins.VoltWayNative.resolveMapUrl === 'function') {
      try {
        const res = await window.Capacitor.Plugins.VoltWayNative.resolveMapUrl({ url: cleanedUrl });
        const hasNewDohPlugin = Boolean(res && res.pluginBuild);
        if (!hasNewDohPlugin) {
          lastResolveDiag.staleApk = true;
        }
        if (res && res.success) {
          const urlCoords = res.url ? extractFromUrlString(res.url) : null;
          const htmlCoords = (typeof res.lat === 'number' && typeof res.lng === 'number' && !isNaN(res.lat) && !isNaN(res.lng))
            ? { lat: res.lat, lng: res.lng }
            : null;
          if (urlCoords || htmlCoords || (res.url && res.url.includes('google.'))) {
            const info = {
              url: res.url || cleanedUrl,
              title: res.title || '',
              coords: urlCoords || null,
              htmlFallbackCoords: urlCoords ? null : htmlCoords,
              coordsFromUrl: Boolean(urlCoords)
            };
            shortUrlCache.set(trimmed, info);
            return info;
          }
          lastResolveDiag.detail = res.error || 'Native returned without google maps URL';
        } else if (res && res.error) {
          lastResolveDiag.detail = `Native: ${res.error}`;
        }
      } catch (err) {
        lastResolveDiag.detail = `Native exception: ${err && err.message ? err.message : 'failed'}`;
      }
    }

    // 2. Secondary on Android APK: CapacitorHttp fast header-only redirect check (disableRedirects), then full GET
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
      const capHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      };
      try {
        const hopResp = await window.Capacitor.Plugins.CapacitorHttp.get({
          url: cleanedUrl,
          disableRedirects: true,
          connectTimeout: 4500,
          readTimeout: 4500,
          headers: capHeaders
        });
        const hopLoc = (hopResp && hopResp.headers && (hopResp.headers['location'] || hopResp.headers['Location'])) || '';
        const hopFinal = (hopLoc && hopLoc.includes('google'))
          ? hopLoc
          : ((hopResp && hopResp.url && hopResp.url !== cleanedUrl && hopResp.url !== trimmed && hopResp.url.includes('google.')) ? hopResp.url : '');
        if (hopFinal) {
          const hopInfo = extractBestMapInfoFromHtmlOrUrl(hopFinal, '');
          if (hopInfo.coords || hopInfo.title || hopInfo.url.includes('google.')) {
            shortUrlCache.set(trimmed, hopInfo);
            return hopInfo;
          }
        }
      } catch (e) {}

      try {
        const resp = await window.Capacitor.Plugins.CapacitorHttp.get({
          url: cleanedUrl,
          connectTimeout: 5500,
          readTimeout: 5500,
          headers: capHeaders
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
      } catch (err) {
        if (!lastResolveDiag.detail) {
          lastResolveDiag.detail = `HTTP: ${err && err.message ? err.message : 'timeout'}`;
        }
      }
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
        const origin = decodeUrlSegment(qMatch[1]);
        const destination = decodeUrlSegment(qMatch[2]);
        const wpMatch = url.match(/[?&]waypoints=([^&]+)/i);
        const waypoints = wpMatch ? decodeUrlSegment(wpMatch[1]).split('|') : [];
        return { origin, destination, waypoints };
      }

      const pathMatch = url.match(/\/maps\/dir\/(.*?)(?:\/@|\?|$)/i);
      if (pathMatch) {
        const rawParts = pathMatch[1]
          .split('/')
          .map(p => decodeUrlSegment(p))
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
        labelHint = decodeUrlSegment(parenMatch[1]);
      }
    }

    const directCoords = extractFromUrlString(text);
    if (directCoords) {
      const placeInDirectUrl = text.match(/\/maps\/place\/([^/@?]+)/i);
      const urlPlaceLabel = placeInDirectUrl ? decodeUrlSegment(placeInDirectUrl[1]) : '';
      const display = normalizeIndiaPlaceQuery(labelHint || urlPlaceLabel) || labelHint || urlPlaceLabel || `Map Pin (${directCoords.lat.toFixed(4)}, ${directCoords.lng.toFixed(4)})`;
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
      const decodedPlace = decodeUrlSegment(placeInUrlMatch[1]);
      const directUrlPlus = extractPlusCode(decodedPlace) || extractPlusCode(labelHint);
      const placeQuery = labelHint || decodedPlace;
      if (directUrlPlus && directUrlPlus.indexOf('+') >= 8) {
        const olcDirect = decodeFullPlusCode(directUrlPlus);
        if (olcDirect) {
          return {
            lat: olcDirect.lat,
            lng: olcDirect.lng,
            name: normalizeIndiaPlaceQuery(placeQuery) || `Plus Code ${directUrlPlus}`,
            fullName: `Plus Code ${directUrlPlus}: ${olcDirect.lat.toFixed(5)}, ${olcDirect.lng.toFixed(5)}`,
            isMapLink: true
          };
        }
      }
      if (placeQuery) {
        const results = await searchPlace(placeQuery);
        if (results && results.length > 0) {
          const geo = results[0];
          if (directUrlPlus) {
            const olcPt = recoverPlusCode(directUrlPlus, geo.lat, geo.lng);
            if (olcPt) {
              return {
                lat: olcPt.lat,
                lng: olcPt.lng,
                name: normalizeIndiaPlaceQuery(placeQuery) || geo.name,
                fullName: `Plus Code ${directUrlPlus}: ${olcPt.lat.toFixed(5)}, ${olcPt.lng.toFixed(5)}`,
                isMapLink: true
              };
            }
          }
          return { ...geo, name: normalizeIndiaPlaceQuery(placeQuery) || geo.name, isMapLink: true };
        }
      }
    }

    // 3. Resolve URL (short link like maps.app.goo.gl/...?g_st=ac) BEFORE falling back to label line text search
    if (/https?:\/\/|goo\.gl|maps\.app|share\.google/i.test(text)) {
      const bareShortMatch = text.match(/(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps|share\.google)\/[^\s]+/i);
      const urlMatch = text.match(/https?:\/\/[^\s]+/i);
      const url = urlMatch ? urlMatch[0] : (bareShortMatch ? `https://${bareShortMatch[0]}` : null);
      let htmlFallbackCoords = null;
      let expPlace = '';
      let expTitle = '';
      if (url) {
        const expandedRaw = (preExpanded === false) ? null : (preExpanded || await unshortenUrl(url));
        if (expandedRaw) {
          let expUrl = typeof expandedRaw === 'object' ? (expandedRaw.url || '') : String(expandedRaw);
          if (expUrl.includes('consent.google.')) {
            const contM = expUrl.match(/[?&]continue=([^&]+)/i);
            if (contM && contM[1]) expUrl = decodeUrlSegment(contM[1]);
          }
          expTitle = typeof expandedRaw === 'object' ? (expandedRaw.title || '') : '';
          const expCoords = (typeof expandedRaw === 'object' && expandedRaw.coords) || extractFromUrlString(expUrl);
          htmlFallbackCoords = (typeof expandedRaw === 'object' && expandedRaw.htmlFallbackCoords) || null;
          const expPlaceMatch = expUrl.match(/\/maps\/place\/([^/@?]+)/i) ||
            expUrl.match(/\/maps\/search\/([^/@?]+)/i) ||
            expUrl.match(/[?&](?:q|query)=([^&]+)/i);
          if (expPlaceMatch && expPlaceMatch[1]) {
            const cand = decodeUrlSegment(expPlaceMatch[1]);
            if (cand && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(cand) && !parseDmsPair(cand)) {
              expPlace = cand;
            }
          }
          // Also extract Plus Code directly from the expanded URL path if not already in expPlace
          if (!extractPlusCode(expPlace)) {
            const urlPathPlusMatch = expUrl.match(/\/maps\/(?:place|search)\/([A-Z0-9]{4,8}%2B[A-Z0-9]{2,4})/i);
            if (urlPathPlusMatch) {
              const decodedPlus = decodeUrlSegment(urlPathPlusMatch[1]);
              if (extractPlusCode(decodedPlus)) {
                expPlace = decodedPlus + (expPlace ? ' ' + expPlace : '');
              }
            }
          }

          if (expCoords) {
            const bestName = normalizeIndiaPlaceQuery(labelHint || expPlace || expTitle) || labelHint || expPlace || expTitle || `Map Pin (${expCoords.lat.toFixed(4)}, ${expCoords.lng.toFixed(4)})`;
            return {
              lat: expCoords.lat,
              lng: expCoords.lng,
              name: bestName,
              fullName: `Google Maps Pin: ${expCoords.lat.toFixed(5)}, ${expCoords.lng.toFixed(5)}`,
              isMapLink: true
            };
          }
        }
      }

      const geoQueries = Array.from(new Set([labelHint, expPlace, expTitle].map(s => (s || '').trim()).filter(s => s.length >= 2)));
      const plusCode = extractPlusCode(labelHint) || extractPlusCode(expPlace) || extractPlusCode(expTitle) || extractPlusCode(text);
      const preferredTitleRaw = labelHint || (extractPlusCode(expPlace) ? expPlace : (expTitle || expPlace));

      // Direct full 8+ char Plus Code needs no network lookup at all
      if (plusCode && plusCode.indexOf('+') >= 8) {
        const directOlc = decodeFullPlusCode(plusCode);
        if (directOlc) {
          const cleanName = normalizeIndiaPlaceQuery(preferredTitleRaw) || `Plus Code ${plusCode}`;
          return {
            lat: directOlc.lat,
            lng: directOlc.lng,
            name: cleanName,
            fullName: `Plus Code ${plusCode}: ${directOlc.lat.toFixed(5)}, ${directOlc.lng.toFixed(5)}`,
            isMapLink: true
          };
        }
      }

      for (const gq of geoQueries) {
        const results = await searchPlace(gq);
        if (results && results.length > 0) {
          const geo = results[0];
          // Recover short Plus Code (e.g. 8XW4+5J in Google Maps share URLs) around the geocoded locality!
          if (plusCode) {
            const olcPt = recoverPlusCode(plusCode, geo.lat, geo.lng);
            if (olcPt) {
              const cleanTitle = normalizeIndiaPlaceQuery(preferredTitleRaw) || geo.name;
              return {
                lat: olcPt.lat,
                lng: olcPt.lng,
                name: cleanTitle,
                fullName: `Plus Code ${plusCode}: ${olcPt.lat.toFixed(5)}, ${olcPt.lng.toFixed(5)}`,
                isMapLink: true
              };
            }
          }
          // If native plugin extracted an HTML coordinate inside the SAME town (< 6 km from geocoded match), keep that exact pin;
          // otherwise reject htmlFallbackCoords (Google's IP-centroid near user's own location!) and use the geocoded match.
          if (htmlFallbackCoords && haversine(geo.lat, geo.lng, htmlFallbackCoords.lat, htmlFallbackCoords.lng) <= 6.0) {
            return {
              lat: htmlFallbackCoords.lat,
              lng: htmlFallbackCoords.lng,
              name: normalizeIndiaPlaceQuery(preferredTitleRaw) || geo.name,
              fullName: `Google Maps Pin: ${htmlFallbackCoords.lat.toFixed(5)}, ${htmlFallbackCoords.lng.toFixed(5)}`,
              isMapLink: true
            };
          }
          return {
            ...geo,
            name: normalizeIndiaPlaceQuery(labelHint) || geo.name || normalizeIndiaPlaceQuery(expPlace || expTitle),
            isMapLink: true
          };
        }
      }
      if (geoQueries.length > 0 && lastResolveDiag && !lastResolveDiag.detail) {
        lastResolveDiag.detail = `Geocoder 0 (${lastGeoDiag || 'empty'}): ${geoQueries[0].slice(0, 38)}`;
      }
      return null;
    }

    // 3b. Direct Plus Code anywhere in text input (e.g. "8XW4+5J KMCT, Manassery, Kerala")
    const directPlus = extractPlusCode(text);
    if (directPlus) {
      if (directPlus.indexOf('+') >= 8) {
        const directOlc = decodeFullPlusCode(directPlus);
        if (directOlc) {
          const cleanName = normalizeIndiaPlaceQuery(text) || `Plus Code ${directPlus}`;
          return {
            lat: directOlc.lat,
            lng: directOlc.lng,
            name: cleanName,
            fullName: `Plus Code ${directPlus}: ${directOlc.lat.toFixed(5)}, ${directOlc.lng.toFixed(5)}`,
            isMapLink: true
          };
        }
      } else {
        const localityResults = await searchPlace(normalizeIndiaPlaceQuery(text));
        const ref = (localityResults && localityResults.length > 0)
          ? localityResults[0]
          : (window.MapEngine && window.MapEngine.getUserCoords ? window.MapEngine.getUserCoords() : null);
        if (ref && typeof ref.lat === 'number' && typeof ref.lng === 'number') {
          const olcPt = recoverPlusCode(directPlus, ref.lat, ref.lng);
          if (olcPt) {
            const cleanName = normalizeIndiaPlaceQuery(text) || `Plus Code ${directPlus}`;
            return {
              lat: olcPt.lat,
              lng: olcPt.lng,
              name: cleanName,
              fullName: `Plus Code ${directPlus}: ${olcPt.lat.toFixed(5)}, ${olcPt.lng.toFixed(5)}`,
              isMapLink: true
            };
          }
        }
      }
    }

    // 4. Inline coordinates inside freeform text (e.g. "Pin 10.9760, 76.2254" or "10.9760, 76.2254 (Shop)")
    const inlineCoordMatch = text.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);
    if (inlineCoordMatch) {
      const lat = parseFloat(inlineCoordMatch[1]);
      const lng = parseFloat(inlineCoordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        const cleanLabel = text.replace(inlineCoordMatch[0], '').replace(/[()\-–:|,\s]+/g, ' ').trim();
        return {
          lat,
          lng,
          name: cleanLabel || `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          fullName: `GPS Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          isMapLink: true
        };
      }
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
    isMapsOrGeoInput,
    hasMapLinkOrCoords,
    getLastResolveDiag: () => lastResolveDiag,
    parseGoogleMapsDirectionsUrl,
    resolveLocationInput,
    getLocalPlaces,
    renderAmenitiesHtml,
    copyToClipboard,
    POPULAR_INDIAN_PLACES
  };
})();

window.Utilities = Utilities;

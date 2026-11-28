/**
 * VoltWay 2W - Highway-Aware Route Engine & Persistent Trip State
 * Primary Router: Valhalla Main-Road Hierarchy Profile (avoids narrow lanes & backroads)
 * Fallback Router: Highway-Scored OSRM Motor Profile (no artificial off-road detours)
 * Includes Persistent Active Route Recovery Across App Kill Without Background GPS
 */

const RouteEngine = (function () {
  const SAVED_TRIP_KEY = 'voltway_saved_trip_v1';

  let allRoutes = [];
  let baseRouteOptions = [];
  let selectedRouteIndex = 0;
  let activeRoute = null;
  let currentOrigin = null;
  let currentDestination = null;
  let corridorChargers = [];
  let intermediateWaypoints = [];
  let returnWaypoints = [];
  let lastSnappedSegmentIndex = 0;
  let sentToGoogleMaps = false;

  const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
  const ROUTING_SERVERS = [
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    'https://router.project-osrm.org/route/v1/driving'
  ];

  const routeFilters = {
    atherFast: true,
    vidaFast: true,
    boltFast: true,
    boltSlow: true
  };

  let corridorBufferKm = 5;
  let currentTimelineMode = 'optimal';
  let isRoundTrip = false;
  const listeners = [];

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function notify() {
    const payload = {
      route: activeRoute,
      allRoutes,
      selectedRouteIndex,
      corridorChargers,
      waypoints: intermediateWaypoints,
      returnWaypoints,
      timelineMode: currentTimelineMode,
      isRoundTrip,
      corridorBufferKm,
      sentToGoogleMaps
    };
    listeners.forEach(fn => fn(payload));
  }

  function compactSteps(legs) {
    if (!Array.isArray(legs)) return [];
    return legs.map(leg => ({
      distance: leg.distance || 0,
      duration: leg.duration || 0,
      steps: Array.isArray(leg.steps)
        ? leg.steps.map(st => ({
            distance: st.distance || 0,
            duration: st.duration || 0,
            name: st.name || '',
            ref: st.ref || '',
            signBranch: st.signBranch || '',
            signToward: st.signToward || '',
            destinations: st.destinations || '',
            instruction: st.instruction || '',
            maneuver: st.maneuver
              ? {
                  type: st.maneuver.type || 'turn',
                  modifier: st.maneuver.modifier || '',
                  location: st.maneuver.location || null,
                  exit: st.maneuver.exit
                }
              : null
          }))
        : []
    }));
  }

  function compactRouteForStorage(rt) {
    if (!rt) return null;
    return {
      id: rt.id,
      name: rt.name,
      roadName: rt.roadName,
      origin: rt.origin,
      destination: rt.destination,
      waypoints: rt.waypoints || [],
      returnWaypoints: rt.returnWaypoints || [],
      returnRoute: rt.returnRoute
        ? {
            distanceKm: rt.returnRoute.distanceKm,
            durationMins: rt.returnRoute.durationMins,
            coordinates: rt.returnRoute.coordinates || [],
            legs: compactSteps(rt.returnRoute.legs || []),
            sourceEngine: rt.returnRoute.sourceEngine || 'Same-Route Return',
            retKey: rt.returnRoute.retKey || ''
          }
        : null,
      distanceKm: rt.distanceKm,
      durationMins: rt.durationMins,
      timeDiffMins: rt.timeDiffMins || 0,
      coordinates: rt.coordinates || [],
      legs: compactSteps(rt.legs || []),
      isPrimary: Boolean(rt.isPrimary),
      sourceEngine: rt.sourceEngine || 'Valhalla'
    };
  }

  function persistTripState() {
    try {
      if (!activeRoute || !allRoutes || allRoutes.length === 0) {
        localStorage.removeItem(SAVED_TRIP_KEY);
        return;
      }

      const compactAll = allRoutes.map(compactRouteForStorage).filter(Boolean);
      const compactBase = baseRouteOptions.map(compactRouteForStorage).filter(Boolean);
      const snapshot = {
        version: 1,
        savedAt: Date.now(),
        sentToGoogleMaps,
        selectedRouteIndex,
        origin: currentOrigin || activeRoute.origin,
        destination: currentDestination || activeRoute.destination,
        waypoints: intermediateWaypoints,
        returnWaypoints,
        timelineMode: currentTimelineMode,
        isRoundTrip,
        corridorBufferKm,
        routeFilters,
        allRoutes: compactAll,
        baseRouteOptions: compactBase
      };

      try {
        localStorage.setItem(SAVED_TRIP_KEY, JSON.stringify(snapshot));
      } catch (quotaErr) {
        // Fallback: keep active route only if storage quota is tight
        snapshot.allRoutes = [compactAll[selectedRouteIndex] || compactAll[0]];
        snapshot.baseRouteOptions = [];
        snapshot.selectedRouteIndex = 0;
        localStorage.setItem(SAVED_TRIP_KEY, JSON.stringify(snapshot));
      }
    } catch (e) {
      console.warn('[VoltWay Router] Could not persist active route:', e);
    }
  }

  function restoreSavedTrip() {
    try {
      const raw = localStorage.getItem(SAVED_TRIP_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.allRoutes) || parsed.allRoutes.length === 0) {
        return null;
      }

      allRoutes = parsed.allRoutes.filter(r => r && Array.isArray(r.coordinates) && r.coordinates.length >= 2);
      if (allRoutes.length === 0) return null;

      baseRouteOptions = (Array.isArray(parsed.baseRouteOptions) && parsed.baseRouteOptions.length > 0)
        ? parsed.baseRouteOptions.filter(r => r && Array.isArray(r.coordinates) && r.coordinates.length >= 2)
        : allRoutes.map(r => ({ ...r, waypoints: (r.waypoints || []).map(w => ({ ...w })) }));

      selectedRouteIndex = Math.max(0, Math.min(allRoutes.length - 1, Number(parsed.selectedRouteIndex) || 0));
      activeRoute = allRoutes[selectedRouteIndex];
      currentOrigin = parsed.origin || activeRoute.origin || null;
      currentDestination = parsed.destination || activeRoute.destination || null;
      intermediateWaypoints = Array.isArray(parsed.waypoints)
        ? parsed.waypoints.map(w => ({ ...w, leg: 'outbound', stopRole: 'outbound' }))
        : (activeRoute.waypoints || []).map(w => ({ ...w, leg: 'outbound', stopRole: 'outbound' }));
      returnWaypoints = Array.isArray(parsed.returnWaypoints)
        ? parsed.returnWaypoints.map(w => ({ ...w, leg: 'return', stopRole: 'return' }))
        : (activeRoute.returnWaypoints || []).map(w => ({ ...w, leg: 'return', stopRole: 'return' }));

      if (parsed.timelineMode === 'optimal' || parsed.timelineMode === 'target') {
        currentTimelineMode = parsed.timelineMode;
      }
      isRoundTrip = Boolean(parsed.isRoundTrip);
      if (parsed.corridorBufferKm != null) {
        corridorBufferKm = parsed.corridorBufferKm === 'all' ? 'all' : (Number(parsed.corridorBufferKm) || 5);
      }
      if (parsed.routeFilters && typeof parsed.routeFilters === 'object') {
        Object.assign(routeFilters, parsed.routeFilters);
      }
      sentToGoogleMaps = Boolean(parsed.sentToGoogleMaps);
      lastSnappedSegmentIndex = 0;

      findCorridorChargers(activeRoute.coordinates, corridorBufferKm);
      notify();
      return {
        route: activeRoute,
        origin: currentOrigin,
        destination: currentDestination,
        waypoints: intermediateWaypoints,
        returnWaypoints,
        isRoundTrip,
        sentToGoogleMaps,
        savedAt: parsed.savedAt || Date.now()
      };
    } catch (e) {
      console.warn('[VoltWay Router] Could not restore saved trip:', e);
      return null;
    }
  }

  function refreshCorridorForActiveRoute() {
    if (!activeRoute || !activeRoute.coordinates) return [];
    const list = findCorridorChargers(activeRoute.coordinates, corridorBufferKm);
    notify();
    return list;
  }

  function markSentToGoogleMaps() {
    sentToGoogleMaps = true;
    persistTripState();
  }

  function setCorridorBufferKm(km) {
    if (km === 'all' || km === 0 || km === null) {
      corridorBufferKm = 'all';
    } else {
      corridorBufferKm = Math.max(1, Math.min(100, Number(km) || 5));
    }
    if (activeRoute && activeRoute.coordinates) {
      findCorridorChargers(activeRoute.coordinates, corridorBufferKm);
      persistTripState();
      notify();
      if (window.MapEngine && window.MapEngine.renderChargers) {
        window.MapEngine.renderChargers();
      }
    }
  }

  function getCorridorBufferKm() {
    return corridorBufferKm;
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function distToSegment(p, v, w) {
    const meanLatRad = ((v[0] + w[0] + p[0]) / 3) * (Math.PI / 180);
    const cosLat = Math.cos(meanLatRad);

    const dvLat = (w[0] - v[0]);
    const dvLng = (w[1] - v[1]) * cosLat;
    const l2 = dvLat * dvLat + dvLng * dvLng;

    if (l2 === 0) return { distance: haversineDistance(p[0], p[1], v[0], v[1]), t: 0 };

    const dpLat = (p[0] - v[0]);
    const dpLng = (p[1] - v[1]) * cosLat;

    let t = (dpLat * dvLat + dpLng * dvLng) / l2;
    t = Math.max(0, Math.min(1, t));

    const projectionLat = v[0] + t * (w[0] - v[0]);
    const projectionLng = v[1] + t * (w[1] - v[1]);
    return { distance: haversineDistance(p[0], p[1], projectionLat, projectionLng), t };
  }

  function getDistanceToActiveRoute(lat, lng) {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) return null;

    const existing = corridorChargers.find(c => Math.abs(c.lat - lat) < 0.0001 && Math.abs(c.lng - lng) < 0.0001);
    if (existing && existing.corridorDistanceKm != null) {
      return existing.corridorDistanceKm;
    }

    const coords = activeRoute.coordinates;
    const p = [lat, lng];
    let minDistance = Infinity;
    for (let s = 0; s < coords.length - 1; s++) {
      const res = distToSegment(p, coords[s], coords[s + 1]);
      if (res.distance < minDistance) minDistance = res.distance;
      if (minDistance <= 0.05) break;
    }
    return minDistance === Infinity ? null : Math.round(minDistance * 10) / 10;
  }

  let lastSliceKey = '';
  let lastSliceResult = null;

  function fixNegZero(val) {
    return val === 0 ? 0 : val;
  }

  /**
   * Slices active route at rider's live GPS position and calculates remaining distance/duration metrics.
   */
  function sliceActiveRouteAtPosition(lat, lng) {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
      return null;
    }
    const cacheKey = `${activeRoute.id || 'r'}_${(activeRoute.waypoints || []).length}_${lat.toFixed(6)}_${lng.toFixed(6)}`;
    if (cacheKey === lastSliceKey && lastSliceResult) {
      return lastSliceResult;
    }
    const coords = activeRoute.coordinates;
    const p = [lat, lng];
    let minDistance = Infinity;
    let closestIndex = 0;
    let closestT = 0;

    const startIdx = Math.max(0, lastSnappedSegmentIndex - 2);
    for (let s = startIdx; s < coords.length - 1; s++) {
      const res = distToSegment(p, coords[s], coords[s + 1]);
      if (res.distance < minDistance) {
        minDistance = res.distance;
        closestIndex = s;
        closestT = res.t;
      }
    }

    if (minDistance > 0.055 && startIdx > 0) {
      for (let s = 0; s < startIdx; s++) {
        const res = distToSegment(p, coords[s], coords[s + 1]);
        if (res.distance < minDistance) {
          minDistance = res.distance;
          closestIndex = s;
          closestT = res.t;
        }
      }
    }

    lastSnappedSegmentIndex = closestIndex;

    const v = coords[closestIndex];
    const w = coords[closestIndex + 1];
    const snappedPoint = [
      v[0] + closestT * (w[0] - v[0]),
      v[1] + closestT * (w[1] - v[1])
    ];

    const dLng = (w[1] - v[1]) * Math.PI / 180;
    const lat1 = v[0] * Math.PI / 180;
    const lat2 = w[0] * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const segmentBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    const remainingCoords = [snappedPoint, ...coords.slice(closestIndex + 1)];
    const traversedCoords = [...coords.slice(0, closestIndex + 1), snappedPoint];

    let remPolyKm = 0;
    for (let i = 1; i < remainingCoords.length; i++) {
      remPolyKm += haversineDistance(
        remainingCoords[i - 1][0], remainingCoords[i - 1][1],
        remainingCoords[i][0], remainingCoords[i][1]
      );
    }
    let totalPolyKm = remPolyKm;
    for (let i = 1; i < traversedCoords.length; i++) {
      totalPolyKm += haversineDistance(
        traversedCoords[i - 1][0], traversedCoords[i - 1][1],
        traversedCoords[i][0], traversedCoords[i][1]
      );
    }

    const fracRemaining = totalPolyKm > 0 ? Math.min(1, Math.max(0, remPolyKm / totalPolyKm)) : 1;
    const remainingKm = Math.round(activeRoute.distanceKm * fracRemaining * 10) / 10;
    const remainingMins = Math.max(1, Math.round(activeRoute.durationMins * fracRemaining));

    const sliceOut = {
      remainingCoords,
      traversedCoords,
      snappedPoint,
      distanceFromRouteKm: minDistance,
      segmentBearing,
      closestSegmentIndex: closestIndex,
      remainingKm,
      remainingMins,
      progressPct: Math.round((1 - fracRemaining) * 100)
    };
    lastSliceKey = cacheKey;
    lastSliceResult = sliceOut;
    return sliceOut;
  }

  function setTimelineMode(mode) {
    if (mode === 'optimal' || mode === 'target') {
      currentTimelineMode = mode;
      persistTripState();
      notify();
    }
  }

  async function setRoundTrip(enabled) {
    const next = Boolean(enabled);
    if (isRoundTrip === next) return;
    isRoundTrip = next;
    if (!next) {
      returnWaypoints = returnWaypoints.filter(w => !w.isAutoSuggested);
      if (activeRoute) {
        activeRoute.returnWaypoints = returnWaypoints.map(w => ({ ...w }));
      }
      if (Array.isArray(allRoutes)) {
        allRoutes.forEach(r => {
          if (r && Array.isArray(r.returnWaypoints)) {
            r.returnWaypoints = r.returnWaypoints.filter(w => !w.isAutoSuggested);
          }
        });
      }
    }
    persistTripState();
    notify();
    if (activeRoute) {
      if (next) {
        const reconciled = await reconcileStopsForBattery(null, true);
        if (!reconciled && !activeRoute.returnRoute) {
          await ensureReturnRouteForRoute(activeRoute, returnWaypoints);
          persistTripState();
          notify();
        }
      } else if (navigator.onLine) {
        await reconcileStopsForBattery(null, true);
      }
    }
  }

  function getRoundTrip() {
    return isRoundTrip;
  }

  function getTimelineMode() {
    return currentTimelineMode;
  }

  function extractMainRoadName(legs) {
    if (!legs || legs.length === 0) return '';
    const roadLengths = {};
    legs.forEach(leg => {
      (leg.steps || []).forEach(step => {
        const name = step.name ? step.name.trim() : '';
        if (name && !name.toLowerCase().includes('unnamed') && name.length > 2) {
          roadLengths[name] = (roadLengths[name] || 0) + (step.distance || 0);
        }
      });
    });
    let bestRoad = '';
    let maxLen = 0;
    for (const [rName, rLen] of Object.entries(roadLengths)) {
      if (rLen > maxLen) {
        maxLen = rLen;
        bestRoad = rName;
      }
    }
    return bestRoad;
  }

  function computeChargingDuration(chargeNeededPct, currentArrivalSoC, isFast, chargerPowerKw = null, vehicleDetails = null) {
    if (window.Utilities && window.Utilities.computeChargingDuration) {
      return window.Utilities.computeChargingDuration(chargeNeededPct, currentArrivalSoC, isFast, chargerPowerKw, vehicleDetails);
    }
    if (chargeNeededPct <= 0) return 0;
    return isFast ? Math.max(1, Math.round(chargeNeededPct / 1.3)) : Math.max(1, Math.round(chargeNeededPct / 0.30));
  }

  // Decodes Valhalla Polyline6 encoded shapes into [[lat, lng], ...]
  function decodePolyline6(encoded) {
    const inv = 1.0 / 1e6;
    const coords = [];
    let lat = 0;
    let lng = 0;
    let index = 0;
    while (index < encoded.length) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);

      coords.push([lat * inv, lng * inv]);
    }
    return coords;
  }

  function mapValhallaManeuver(vType) {
    switch (Number(vType)) {
      case 1:
        return { type: 'depart', modifier: 'straight' };
      case 2:
        return { type: 'depart', modifier: 'right' };
      case 3:
        return { type: 'depart', modifier: 'left' };
      case 4:
      case 5:
      case 6:
        return { type: 'arrive', modifier: '' };
      case 7:
      case 8:
        return { type: 'continue', modifier: 'straight' };
      case 9:
        return { type: 'turn', modifier: 'slight right' };
      case 10:
        return { type: 'turn', modifier: 'right' };
      case 11:
        return { type: 'turn', modifier: 'sharp right' };
      case 12:
      case 13:
        return { type: 'turn', modifier: 'uturn' };
      case 14:
        return { type: 'turn', modifier: 'sharp left' };
      case 15:
        return { type: 'turn', modifier: 'left' };
      case 16:
        return { type: 'turn', modifier: 'slight left' };
      case 17:
      case 22:
        return { type: 'fork', modifier: 'straight' };
      case 18:
      case 20:
      case 23:
        return { type: 'fork', modifier: 'slight right' };
      case 19:
      case 21:
      case 24:
        return { type: 'fork', modifier: 'slight left' };
      case 25:
        return { type: 'merge', modifier: 'straight' };
      case 26:
      case 27:
        return { type: 'roundabout', modifier: '' };
      default:
        return { type: 'continue', modifier: 'straight' };
    }
  }

  function formatValhallaSignText(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.map(x => (x && x.text) ? String(x.text).trim() : '').filter(Boolean).slice(0, 2).join(' / ');
  }

  function convertValhallaTrip(trip) {
    if (!trip || !Array.isArray(trip.legs) || trip.legs.length === 0) return null;
    const combinedLatLngs = [];
    const osrmLegs = [];

    for (const leg of trip.legs) {
      if (!leg.shape) continue;
      const legCoords = decodePolyline6(leg.shape);
      legCoords.forEach((pt, i) => {
        if (i === 0 && combinedLatLngs.length > 0) {
          const prev = combinedLatLngs[combinedLatLngs.length - 1];
          if (Math.abs(prev[0] - pt[0]) < 1e-6 && Math.abs(prev[1] - pt[1]) < 1e-6) return;
        }
        combinedLatLngs.push(pt);
      });

      const steps = (leg.maneuvers || []).map(m => {
        const ptIdx = Math.min(Math.max(0, m.begin_shape_index || 0), Math.max(0, legCoords.length - 1));
        const pt = legCoords[ptIdx] || legCoords[0];
        const mapped = mapValhallaManeuver(m.type);
        const rawNames = (Array.isArray(m.street_names) && m.street_names.length > 0)
          ? m.street_names
          : (Array.isArray(m.begin_street_names) ? m.begin_street_names : []);
        const street = rawNames.map(s => String(s).trim()).filter(Boolean).join(' / ');
        const signObj = m.sign || {};
        const signBranch = formatValhallaSignText(signObj.exit_branch_elements);
        const signToward = formatValhallaSignText(signObj.exit_toward_elements) || formatValhallaSignText(signObj.exit_name_elements);
        return {
          distance: Math.round((m.length || 0) * 1000),
          duration: Math.round(m.time || 0),
          name: street,
          signBranch,
          signToward,
          instruction: m.instruction || '',
          maneuver: {
            type: mapped.type,
            modifier: mapped.modifier,
            exit: m.roundabout_exit_count || undefined,
            location: pt ? [pt[1], pt[0]] : [0, 0]
          }
        };
      });

      osrmLegs.push({
        distance: Math.round(((leg.summary && leg.summary.length) || 0) * 1000),
        duration: Math.round((leg.summary && leg.summary.time) || 0),
        steps
      });
    }

    if (combinedLatLngs.length < 2) return null;

    return {
      distance: Math.round(((trip.summary && trip.summary.length) || 0) * 1000),
      duration: Math.round((trip.summary && trip.summary.time) || 0),
      geometry: {
        type: 'LineString',
        coordinates: combinedLatLngs.map(pt => [pt[1], pt[0]])
      },
      legs: osrmLegs,
      sourceEngine: 'Valhalla Main-Road'
    };
  }

  /**
   * Primary Google-Maps-style Router using FOSSGIS Valhalla:
   * Optimizes fastest practical travel time with natural neighborhood access roads onto main highways,
   * avoiding artificial detours while still excluding unpaved tracks.
   */
  async function fetchValhallaRoutes(cleanPoints) {
    const body = {
      locations: cleanPoints.map(p => (
        p.isThroughAnchor
          ? { lat: p.lat, lon: p.lng, type: 'through', radius: 600 }
          : { lat: p.lat, lon: p.lng }
      )),
      costing: 'auto',
      costing_options: {
        auto: {
          use_highways: 0.65,
          use_tracks: 0.0,
          use_living_streets: 0.35,
          alley_factor: 1.5,
          service_penalty: 15,
          maneuver_penalty: 5,
          top_speed: 65,
          exclude_unpaved: true,
          use_ferry: 0.05
        }
      },
      alternates: cleanPoints.length === 2 ? 2 : 0,
      units: 'km'
    };

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 7500) : null;
    try {
      const resp = await fetch(VALHALLA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`Valhalla HTTP ${resp.status}`);

      const data = await resp.json();
      if (!data || !data.trip) throw new Error('Valhalla empty trip');

      const out = [];
      const primary = convertValhallaTrip(data.trip);
      if (primary) out.push(primary);

      if (Array.isArray(data.alternates)) {
        data.alternates.forEach(alt => {
          const parsedAlt = convertValhallaTrip(alt.trip || alt);
          if (parsedAlt) out.push(parsedAlt);
        });
      }

      if (out.length === 0) throw new Error('Valhalla decoded 0 routes');
      return scoreAndSortMainRoadRoutes(out);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    }
  }

  const ETA_NH_RE = /\b(NH|AH)\s*-?\s*\d+|national highway|expressway|ring road|bypass|salem\s*-\s*kochi|kochi\s*-\s*salem|bengaluru\s*-\s*mysuru/i;
  const ETA_SH_RE = /\bSH\s*-?\s*\d+|state highway|mc road|main central|main road|highway/i;

  /**
   * Calibrates step/leg durations to realistic Indian 2-wheeler / Google Maps travel times.
   * Valhalla often assigns ~31-35 km/h to untagged Indian highways, while OSRM car routing can be
   * slightly fast (~62 km/h); blending by road class keeps highway & city ETAs accurate.
   */
  function calibrate2WRouteDurations(route) {
    if (!route || !Array.isArray(route.legs) || route.legs.length === 0 || route._etaCalibrated) {
      return route;
    }

    let totalDur = 0;
    for (const leg of route.legs) {
      const steps = Array.isArray(leg.steps) ? leg.steps : [];
      const legDistM = Math.max(0, Number(leg.distance) || 0);
      let legDur = 0;
      let stepDistSum = 0;

      if (steps.length > 0) {
        for (const step of steps) {
          const dM = Math.max(0, Number(step.distance) || 0);
          const rawS = Math.max(0, Number(step.duration) || 0);
          if (dM <= 0) {
            step.duration = 0;
            continue;
          }
          stepDistSum += dM;

          const roadLabel = [step.ref, step.name].filter(Boolean).join(' / ');
          const isNh = ETA_NH_RE.test(roadLabel);
          const isSh = ETA_SH_RE.test(roadLabel);

          let targetKmh;
          if (isNh && dM >= 8000) targetKmh = 52;
          else if (isNh || dM >= 8000) targetKmh = 49;
          else if (isSh && dM >= 2500) targetKmh = 44;
          else if (isSh || dM >= 3000) targetKmh = 41;
          else if (dM >= 1200) targetKmh = 34;
          else if (dM >= 400) targetKmh = 28;
          else targetKmh = 22;

          const mType = (step.maneuver && step.maneuver.type) || '';
          const turnDelayS = (mType === 'depart' || mType === 'arrive') ? 0 : (dM < 1500 ? 6 : 3);
          const targetS = ((dM / 1000) / targetKmh) * 3600 + turnDelayS;

          let calS;
          if (rawS > 0) {
            const rawKmh = (dM / 1000) / (rawS / 3600);
            if (rawKmh < targetKmh * 0.78 || rawKmh > targetKmh * 1.18) {
              calS = 0.80 * targetS + 0.20 * rawS;
            } else {
              calS = 0.50 * targetS + 0.50 * rawS;
            }
          } else {
            calS = targetS;
          }

          const minS = ((dM / 1000) / 56) * 3600;
          step.duration = Math.round(Math.max(minS, calS));
          legDur += step.duration;
        }

        if (legDistM > 0 && stepDistSum > 0 && Math.abs(stepDistSum - legDistM) > Math.max(500, legDistM * 0.12)) {
          const distScale = legDistM / stepDistSum;
          legDur = 0;
          for (const step of steps) {
            step.duration = Math.round((step.duration || 0) * distScale);
            legDur += step.duration;
          }
        }
      } else {
        const rawLegS = Math.max(0, Number(leg.duration) || 0);
        if (legDistM > 0) {
          const targetKmh = legDistM >= 25000 ? 46 : 32;
          const targetS = ((legDistM / 1000) / targetKmh) * 3600;
          if (rawLegS > 0) {
            const rawKmh = (legDistM / 1000) / (rawLegS / 3600);
            const calS = (rawKmh < targetKmh * 0.78 || rawKmh > targetKmh * 1.18)
              ? (0.80 * targetS + 0.20 * rawLegS)
              : (0.50 * targetS + 0.50 * rawLegS);
            legDur = Math.round(Math.max(((legDistM / 1000) / 56) * 3600, calS));
          } else {
            legDur = Math.round(targetS);
          }
        }
      }

      leg.duration = Math.round(legDur);
      totalDur += leg.duration;
    }

    if (totalDur > 0) {
      route.duration = Math.round(totalDur);
    }
    route._etaCalibrated = true;
    return route;
  }

  /**
   * Google-Maps-style route ranking: prioritizes fastest practical travel time first,
   * breaking near-ties (<= 4% / 90s) in favor of main arterial highways and fewer zigzag turns.
   */
  function scoreAndSortMainRoadRoutes(routes) {
    if (!Array.isArray(routes) || routes.length === 0) return [];
    const calibrated = routes.map(calibrate2WRouteDurations);
    if (calibrated.length <= 1) return calibrated;
    const minDuration = Math.min(...calibrated.map(r => r.duration || Infinity));

    const scored = calibrated.map((r, origIdx) => {
      const totalDist = Math.max(1, r.distance || 1);
      const steps = (r.legs || []).flatMap(l => l.steps || []);
      let arterialDist = 0;
      let narrowLaneDist = 0;

      steps.forEach(st => {
        const d = st.distance || 0;
        const n = (st.name || '').trim();
        if (!n || /unnamed|\b(lane|cross|galli|by-?lane|alley)\b/i.test(n)) {
          if (d < 350) narrowLaneDist += d;
        } else if (/\b(NH|SH|AH)\s*\d+|highway|bypass|ring road|expressway|mc road|main road|state highway|national highway/i.test(n)) {
          arterialDist += d;
        }
      });

      const extraSecs = Math.max(0, (r.duration || 0) - minDuration);
      const withinFastWindow = extraSecs <= Math.min(240, Math.max(90, minDuration * 0.05));
      const highwayRatio = arterialDist / totalDist;
      const laneRatio = narrowLaneDist / totalDist;
      const qualityScore = (withinFastWindow ? 300 : -extraSecs * 0.25) + (highwayRatio * 45) - (laneRatio * 35) - (steps.length * 0.25) - origIdx;
      return { r, qualityScore };
    });

    scored.sort((a, b) => b.qualityScore - a.qualityScore);
    return scored.map(x => x.r);
  }

  async function fetchOsrmRaw(cleanPoints) {
    const routedPoints = cleanPoints.filter(p => !p.isThroughAnchor);
    const coordsStr = routedPoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

    async function queryMirror(serverUrl, allowAlternatives = true, timeoutMs = 10000) {
      let controller = null;
      let timeoutId = null;
      try {
        if (typeof AbortController !== 'undefined') {
          controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }

        const altParam = allowAlternatives ? '&alternatives=true' : '';
        const url = `${serverUrl}/${coordsStr}?overview=full&geometries=geojson&steps=true${altParam}`;
        const resp = await fetch(url, controller ? { signal: controller.signal } : {});
        if (timeoutId) clearTimeout(timeoutId);

        if (!resp.ok) {
          if (allowAlternatives && resp.status >= 400 && resp.status < 500) {
            return await queryMirror(serverUrl, false, 7000);
          }
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          return data.routes;
        }
        if (allowAlternatives) {
          return await queryMirror(serverUrl, false, 7000);
        }
        throw new Error(`OSRM code: ${data.code || 'NoRoute'}`);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      let activeCount = 0;
      const errors = [];

      function tryServer(index) {
        if (resolved || index >= ROUTING_SERVERS.length) return;
        activeCount++;
        const sUrl = ROUTING_SERVERS[index];

        queryMirror(sUrl, true, 10000)
          .then(routes => {
            if (!resolved && routes && routes.length > 0) {
              resolved = true;
              resolve(scoreAndSortMainRoadRoutes(routes));
            }
          })
          .catch(err => {
            errors.push(`${sUrl}: ${err.message}`);
            activeCount--;
            if (!resolved && index + 1 < ROUTING_SERVERS.length) {
              tryServer(index + 1);
            } else if (activeCount === 0 && !resolved) {
              reject(new Error(`All routing mirrors failed (${errors.join('; ')})`));
            }
          });
      }

      tryServer(0);
      setTimeout(() => { if (!resolved) tryServer(1); }, 1500);
    });
  }

  async function fetchBestMainRoadRoutes(points) {
    if (!points || points.length < 2) {
      throw new Error('At least 2 points are required for routing');
    }
    if (!navigator.onLine) {
      throw new Error('Device is offline. Road routing requires an internet connection.');
    }

    const cleanPoints = points.map((p, idx) => {
      const lat = parseFloat(p.lat);
      const lng = parseFloat(p.lng);
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(`Invalid route coordinate at index ${idx}`);
      }
      return p.isThroughAnchor ? { lat, lng, isThroughAnchor: true } : { lat, lng };
    });

    try {
      const valhallaRoutes = await fetchValhallaRoutes(cleanPoints);
      if (valhallaRoutes && valhallaRoutes.length > 0) {
        if (cleanPoints.length === 2 && valhallaRoutes.length === 1) {
          try {
            const osrmAlts = await Promise.race([
              fetchOsrmRaw(cleanPoints),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3200))
            ]);
            if (Array.isArray(osrmAlts) && osrmAlts.length > 0) {
              const primary = valhallaRoutes[0];
              const pRoad = extractMainRoadName(primary.legs);
              const distinct = osrmAlts.filter(alt => {
                const aRoad = extractMainRoadName(alt.legs);
                const distDiff = Math.abs((alt.distance || 0) - (primary.distance || 0));
                const durDiff = Math.abs((alt.duration || 0) - (primary.duration || 0));
                return (aRoad && pRoad && aRoad !== pRoad) || distDiff > ((primary.distance || 1) * 0.04) || durDiff > 240;
              });
              if (distinct.length > 0) {
                return [primary, ...distinct.slice(0, 2)];
              }
            }
          } catch (e) {}
        }
        return valhallaRoutes;
      }
    } catch (valErr) {
      // Fall back transparently to Highway-Scored OSRM
    }

    return await fetchOsrmRaw(cleanPoints);
  }

  function calculateKmAlongRoute(lat, lng, routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return 0;
    const cumDists = new Float64Array(routeCoords.length);
    cumDists[0] = 0;
    for (let i = 1; i < routeCoords.length; i++) {
      cumDists[i] = cumDists[i - 1] + haversineDistance(
        routeCoords[i - 1][0], routeCoords[i - 1][1],
        routeCoords[i][0], routeCoords[i][1]
      );
    }
    const p = [lat, lng];
    let minDistance = Infinity;
    let closestSegmentIndex = 0;
    let closestT = 0;

    for (let s = 0; s < routeCoords.length - 1; s++) {
      const res = distToSegment(p, routeCoords[s], routeCoords[s + 1]);
      if (res.distance < minDistance) {
        minDistance = res.distance;
        closestSegmentIndex = s;
        closestT = res.t;
      }
      if (minDistance <= 0.05) break;
    }

    return cumDists[closestSegmentIndex] + closestT * (cumDists[closestSegmentIndex + 1] - cumDists[closestSegmentIndex]);
  }

  /**
   * Orders waypoints along the active road polyline if available (preserves curved roads),
   * or by distance from origin when no baseline polyline exists yet.
   */
  function sortWaypointsSequentially(waypoints, origin, destination, routeCoords = null, reverseOrder = false) {
    if (!waypoints || waypoints.length === 0) return waypoints || [];
    if (waypoints.length === 1) {
      if (routeCoords && routeCoords.length >= 2) {
        const w = waypoints[0];
        const kOut = typeof w.kmFromOrigin === 'number' ? w.kmFromOrigin : calculateKmAlongRoute(w.lat, w.lng, routeCoords);
        return [{ ...w, kmFromOrigin: Math.round(kOut * 10) / 10 }];
      }
      return waypoints;
    }
    if (!origin) return waypoints;

    if (routeCoords && routeCoords.length >= 2) {
      return [...waypoints].sort((a, b) => {
        const kA = typeof a.kmFromOrigin === 'number' ? a.kmFromOrigin : calculateKmAlongRoute(a.lat, a.lng, routeCoords);
        const kB = typeof b.kmFromOrigin === 'number' ? b.kmFromOrigin : calculateKmAlongRoute(b.lat, b.lng, routeCoords);
        return reverseOrder ? (kB - kA) : (kA - kB);
      });
    }

    return [...waypoints].sort((a, b) => {
      const ref = reverseOrder && destination ? destination : origin;
      const dA = haversineDistance(ref.lat, ref.lng, a.lat, a.lng);
      const dB = haversineDistance(ref.lat, ref.lng, b.lat, b.lng);
      return dA - dB;
    });
  }

  function buildMirroredReturnFallback(route, retStops = []) {
    if (!route) return null;
    const oneWayDist = Math.max(0.1, Number(route.distanceKm) || 0.1);
    const oneWayMins = Math.max(1, Number(route.durationMins) || 1);
    const reversedCoords = Array.isArray(route.coordinates) ? [...route.coordinates].reverse() : [];

    const enrichedStops = (retStops || []).map(w => {
      let kDest = typeof w.kmFromDest === 'number' ? w.kmFromDest : null;
      if (kDest == null && reversedCoords.length >= 2) {
        kDest = calculateKmAlongRoute(w.lat, w.lng, reversedCoords);
      } else if (kDest == null && typeof w.kmFromOrigin === 'number') {
        kDest = Math.max(0.1, oneWayDist - w.kmFromOrigin);
      }
      const cleanDestKm = kDest != null ? Math.max(0.1, Math.min(oneWayDist, Math.round(kDest * 10) / 10)) : oneWayDist / 2;
      return {
        ...w,
        leg: 'return',
        stopRole: 'return',
        kmFromDest: cleanDestKm,
        kmFromOrigin: Math.max(0, Math.round((oneWayDist - cleanDestKm) * 10) / 10)
      };
    }).sort((a, b) => a.kmFromDest - b.kmFromDest);

    const boundaries = [0, ...enrichedStops.map(w => w.kmFromDest), oneWayDist];
    const legs = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const segKm = Math.max(0.1, Math.round((boundaries[i + 1] - boundaries[i]) * 10) / 10);
      const ratio = segKm / oneWayDist;
      legs.push({
        distance: Math.round(segKm * 1000),
        duration: Math.max(60, Math.round(oneWayMins * 60 * ratio)),
        steps: []
      });
    }

    const retKey = enrichedStops.map(w => String(w.originalId || w.id)).join('|') + '@' + oneWayDist;
    return {
      distanceKm: oneWayDist,
      durationMins: oneWayMins,
      coordinates: reversedCoords,
      legs,
      stops: enrichedStops,
      sourceEngine: 'Same-Route Mirror',
      retKey
    };
  }

  function buildSameRouteReturnThroughAnchors(route, retStops = []) {
    const coords = route && Array.isArray(route.coordinates) ? route.coordinates : [];
    if (coords.length < 3) return [];
    const fracs = coords.length < 6 ? [0.5] : [0.75, 0.50, 0.25];
    const oneWayDist = Number(route.distanceKm) || 1;
    const usedIdx = new Set();
    const anchors = [];
    for (const f of fracs) {
      const idx = Math.min(coords.length - 2, Math.max(1, Math.floor((coords.length - 1) * f)));
      if (usedIdx.has(idx)) continue;
      usedIdx.add(idx);
      const pt = coords[idx];
      if (!pt) continue;
      const nearEndpoint =
        haversineDistance(pt[0], pt[1], route.origin.lat, route.origin.lng) < 3.0 ||
        haversineDistance(pt[0], pt[1], route.destination.lat, route.destination.lng) < 3.0;
      const nearRetStop = (retStops || []).some(w => haversineDistance(pt[0], pt[1], w.lat, w.lng) < 3.5);
      if (nearEndpoint || nearRetStop) continue;
      anchors.push({
        lat: pt[0],
        lng: pt[1],
        isThroughAnchor: true,
        kmFromDest: Math.round(((1 - f) * oneWayDist) * 10) / 10
      });
    }
    return anchors;
  }

  async function ensureReturnRouteForRoute(route, retStops = returnWaypoints) {
    if (!route || !route.origin || !route.destination) return null;
    const cleanStops = Array.isArray(retStops) ? retStops : [];
    const oneWayDist = Math.max(0.1, Number(route.distanceKm) || 0.1);
    const orderedIds = cleanStops
      .map(w => {
        const kd = typeof w.kmFromDest === 'number'
          ? w.kmFromDest
          : (route.coordinates && route.coordinates.length >= 2
              ? Math.round((oneWayDist - calculateKmAlongRoute(w.lat, w.lng, route.coordinates)) * 10) / 10
              : oneWayDist / 2);
        return { ...w, _kd: kd };
      })
      .sort((a, b) => a._kd - b._kd);
    const retKey = orderedIds.map(w => String(w.originalId || w.id)).join('|') + '@' + oneWayDist;

    if (route.returnRoute && route.returnRoute.retKey === retKey && Array.isArray(route.returnRoute.coordinates) && route.returnRoute.coordinates.length >= 2) {
      return route.returnRoute;
    }

    const fallback = buildMirroredReturnFallback(route, orderedIds);
    if (!navigator.onLine) {
      route.returnRoute = fallback;
      return fallback;
    }

    try {
      const taggedStops = fallback.stops.map(s => ({ ...s, isThroughAnchor: false }));
      const anchors = buildSameRouteReturnThroughAnchors(route, taggedStops);
      const midSorted = [...taggedStops, ...anchors].sort((a, b) => (a.kmFromDest || 0) - (b.kmFromDest || 0));
      const pts = [route.destination, ...midSorted, route.origin];
      const candidates = await fetchBestMainRoadRoutes(pts);
      const best = candidates && candidates[0];
      if (!best || !best.geometry || !Array.isArray(best.geometry.coordinates) || best.geometry.coordinates.length < 2) {
        route.returnRoute = fallback;
        return fallback;
      }

      const retDistKm = Math.round(((best.distance || 0) / 1000) * 10) / 10 || fallback.distanceKm;
      const retDurMins = Math.round((best.duration || 0) / 60) || fallback.durationMins;
      const retLegs = best.legs || fallback.legs;

      let cumRetKm = 0;
      const updatedStops = fallback.stops.map((w, idx) => {
        if (retLegs[idx]) {
          cumRetKm += Math.round(((retLegs[idx].distance || 0) / 1000) * 10) / 10;
          return { ...w, kmFromDest: Math.round(cumRetKm * 10) / 10 };
        }
        return w;
      });

      route.returnWaypoints = updatedStops;
      if (route === activeRoute) {
        returnWaypoints = updatedStops.map(w => ({ ...w }));
      }
      route.returnRoute = {
        distanceKm: retDistKm,
        durationMins: retDurMins,
        coordinates: best.geometry.coordinates.map(c => [c[1], c[0]]),
        legs: retLegs,
        stops: updatedStops,
        sourceEngine: best.sourceEngine || 'Same-Route Return',
        retKey
      };
      return route.returnRoute;
    } catch (e) {
      route.returnRoute = fallback;
      return fallback;
    }
  }

  function refreshRouteTimeDiffs(pool) {
    if (!Array.isArray(pool) || pool.length === 0) return;
    const minDur = Math.min(...pool.map(r => (typeof r.durationMins === 'number' ? r.durationMins : Infinity)));
    pool.forEach(r => {
      r.timeDiffMins = Number.isFinite(minDur) ? Math.max(0, (r.durationMins || 0) - minDur) : 0;
      r.isPrimary = (r.durationMins === minDur);
    });
  }

  async function calculateRoute(origin, destination, manualWaypoints = null, preserveManualOrder = false, options = {}) {
    if (!origin || !destination) {
      throw new Error('Origin and destination are required');
    }

    const preserveOtherOptions = Boolean(options && options.preserveOtherOptions);
    const targetOptionIdx = (options && typeof options.optionIndex === 'number') ? options.optionIndex : selectedRouteIndex;

    currentOrigin = origin;
    currentDestination = destination;
    lastSnappedSegmentIndex = 0;

    if (manualWaypoints !== null) {
      const sanitized = manualWaypoints.map((w, i) => {
        const wid = w.id || w.originalId || `stop_${Date.now()}_${i}`;
        return { ...w, id: wid, originalId: w.originalId || wid, leg: 'outbound', stopRole: 'outbound' };
      });
      intermediateWaypoints = preserveManualOrder
        ? sanitized
        : sortWaypointsSequentially(sanitized, origin, destination, activeRoute?.coordinates);
    }

    if (options && Array.isArray(options.returnWaypoints)) {
      const sanitizedRet = options.returnWaypoints.map((w, i) => {
        const wid = w.id || w.originalId || `ret_${Date.now()}_${i}`;
        return { ...w, id: wid, originalId: w.originalId || wid, leg: 'return', stopRole: 'return' };
      });
      returnWaypoints = sanitizedRet;
    }

    const points = [origin, ...intermediateWaypoints, destination];

    try {
      const primaryRoutes = await fetchBestMainRoadRoutes(points);
      if (!primaryRoutes || primaryRoutes.length === 0) {
        throw new Error('No driving route found');
      }

      const buildRouteObj = (routeData, idx, isPrimaryFlag) => {
        const distKm = Math.round((routeData.distance / 1000) * 10) / 10;
        const durMins = Math.round(routeData.duration / 60);
        const prominentRoad = extractMainRoadName(routeData.legs);
        const roadLabel = prominentRoad ? `via ${prominentRoad}` : (idx === 0 ? 'Main Highway' : `Alternate Route ${idx + 1}`);
        const name = isPrimaryFlag ? `${roadLabel} (Main Road)` : `${roadLabel} (${distKm} km)`;
        const outCoords = routeData.geometry.coordinates.map(c => [c[1], c[0]]);

        const clonedWaypoints = intermediateWaypoints.map(w => ({ ...w, leg: 'outbound', stopRole: 'outbound' }));
        let cumKm = 0;
        for (let i = 0; i < clonedWaypoints.length; i++) {
          if (routeData.legs && routeData.legs[i]) {
            cumKm += Math.round((routeData.legs[i].distance / 1000) * 10) / 10;
            clonedWaypoints[i].kmFromOrigin = Math.round(cumKm * 10) / 10;
          }
        }

        const clonedRetWaypoints = returnWaypoints
          .map(w => {
            const kOut = calculateKmAlongRoute(w.lat, w.lng, outCoords);
            const kDest = Math.max(0.1, Math.round((distKm - kOut) * 10) / 10);
            return { ...w, leg: 'return', stopRole: 'return', kmFromOrigin: Math.round(kOut * 10) / 10, kmFromDest: kDest };
          })
          .sort((a, b) => a.kmFromDest - b.kmFromDest);

        return {
          id: `route-${idx}`,
          name,
          roadName: prominentRoad || (idx === 0 ? 'Main Highway' : `Route ${idx + 1}`),
          origin,
          destination,
          waypoints: clonedWaypoints,
          returnWaypoints: clonedRetWaypoints,
          returnRoute: null,
          distanceKm: distKm,
          durationMins: durMins,
          timeDiffMins: 0,
          geometry: routeData.geometry,
          coordinates: outCoords,
          legs: routeData.legs || [],
          isPrimary: isPrimaryFlag,
          sourceEngine: routeData.sourceEngine || 'OSRM Highway'
        };
      };

      const existingPool = preserveOtherOptions
        ? (allRoutes.length > 1 ? allRoutes : baseRouteOptions).map(r => ({ ...r }))
        : [];

      if (preserveOtherOptions && existingPool.length > 1 && targetOptionIdx >= 0 && targetOptionIdx < existingPool.length) {
        const updatedOption = buildRouteObj(primaryRoutes[0], targetOptionIdx, existingPool[targetOptionIdx].isPrimary);
        existingPool[targetOptionIdx] = updatedOption;
        refreshRouteTimeDiffs(existingPool);
        allRoutes = existingPool;
        selectedRouteIndex = targetOptionIdx;
      } else {
        allRoutes = primaryRoutes.slice(0, 3).map((rd, idx) => buildRouteObj(rd, idx, idx === 0));
        refreshRouteTimeDiffs(allRoutes);
        selectedRouteIndex = 0;
        if (!preserveOtherOptions && intermediateWaypoints.every(w => !w.isAutoSuggested)) {
          baseRouteOptions = allRoutes.map(r => ({
            ...r,
            waypoints: (r.waypoints || []).map(w => ({ ...w })),
            returnWaypoints: (r.returnWaypoints || []).map(w => ({ ...w }))
          }));
        }
      }

      activeRoute = allRoutes[selectedRouteIndex];
      intermediateWaypoints = (activeRoute.waypoints || []).map(w => ({ ...w }));
      returnWaypoints = (activeRoute.returnWaypoints || []).map(w => ({ ...w }));

      findCorridorChargers(activeRoute.coordinates);
      if (isRoundTrip && !(options && options.skipReturnRoute)) {
        await ensureReturnRouteForRoute(activeRoute, returnWaypoints);
      }
      persistTripState();
      notify();
      return activeRoute;
    } catch (err) {
      console.error('[VoltWay Router] Route calculation failed:', err);
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(
          !navigator.onLine
            ? '📡 Offline: Road routing requires an internet connection.'
            : '⚠️ Network Error: Could not reach routing servers.'
        );
      }
      throw new Error(err.message || 'Could not calculate road route.');
    }
  }

  async function selectRoute(index) {
    if (index < 0 || index >= allRoutes.length) return;
    selectedRouteIndex = index;
    lastSnappedSegmentIndex = 0;
    lastSliceKey = '';
    lastSliceResult = null;
    activeRoute = allRoutes[index];

    const routeWps = Array.isArray(activeRoute.waypoints) ? activeRoute.waypoints : [];
    const baseManual = (baseRouteOptions[index] && Array.isArray(baseRouteOptions[index].waypoints))
      ? baseRouteOptions[index].waypoints.filter(w => !w.isAutoSuggested)
      : [];
    if (routeWps.length > 0) {
      intermediateWaypoints = routeWps.map(w => ({ ...w, leg: 'outbound', stopRole: 'outbound' }));
    } else if (baseManual.length > 0) {
      intermediateWaypoints = baseManual.map(w => ({ ...w, leg: 'outbound', stopRole: 'outbound' }));
    } else {
      intermediateWaypoints = [];
    }

    const routeRetWps = Array.isArray(activeRoute.returnWaypoints) ? activeRoute.returnWaypoints : [];
    const baseRetManual = (baseRouteOptions[index] && Array.isArray(baseRouteOptions[index].returnWaypoints))
      ? baseRouteOptions[index].returnWaypoints.filter(w => !w.isAutoSuggested)
      : [];
    if (routeRetWps.length > 0) {
      returnWaypoints = routeRetWps.map(w => ({ ...w, leg: 'return', stopRole: 'return' }));
    } else if (baseRetManual.length > 0) {
      returnWaypoints = baseRetManual.map(w => ({ ...w, leg: 'return', stopRole: 'return' }));
    } else {
      returnWaypoints = [];
    }

    findCorridorChargers(activeRoute.coordinates);
    persistTripState();
    notify();

    // Ensure the newly selected alternate route checks battery & picks stops/return path along ITS OWN corridor
    const didReconcile = await reconcileStopsForBattery(null, true);
    if (isRoundTrip && !didReconcile && !activeRoute.returnRoute) {
      await ensureReturnRouteForRoute(activeRoute, returnWaypoints);
      persistTripState();
      notify();
    }
  }

  function matchesRouteFilters(c) {
    if (c.is_2w === false) return false;
    if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
    if (c.network === 'VIDA_GRID' && !routeFilters.vidaFast) return false;
    if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
    if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
    return true;
  }

  function findCorridorChargers(routeCoords, maxCorridorKm = null) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : [];
    const matching = [];

    if (!routeCoords || routeCoords.length < 2 || !allChargers || allChargers.length === 0) {
      corridorChargers = [];
      return [];
    }

    const requestedBuffer = (maxCorridorKm != null) ? maxCorridorKm : corridorBufferKm;
    const isAll = requestedBuffer === 'all' || requestedBuffer === 0;
    const effectiveMaxCorridorKm = isAll ? 50.0 : Number(requestedBuffer || 5);

    const cumDists = new Float64Array(routeCoords.length);
    cumDists[0] = 0;
    for (let i = 1; i < routeCoords.length; i++) {
      cumDists[i] = cumDists[i - 1] + haversineDistance(
        routeCoords[i - 1][0], routeCoords[i - 1][1],
        routeCoords[i][0], routeCoords[i][1]
      );
    }

    const totalPolyDist = cumDists[cumDists.length - 1] || 1;
    const routeDist = (activeRoute && activeRoute.distanceKm) ? activeRoute.distanceKm : totalPolyDist;
    const distScale = routeDist / totalPolyDist;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (let i = 0; i < routeCoords.length; i++) {
      const lat = routeCoords[i][0];
      const lng = routeCoords[i][1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    const degBuffer = effectiveMaxCorridorKm / 111.0 + 0.05;
    minLat -= degBuffer;
    maxLat += degBuffer;
    minLng -= degBuffer;
    maxLng += degBuffer;

    const candidates = allChargers.filter(c => {
      if (c.lat < minLat || c.lat > maxLat || c.lng < minLng || c.lng > maxLng) return false;
      return matchesRouteFilters(c);
    });

    for (let c = 0; c < candidates.length; c++) {
      const charger = candidates[c];
      const p = [charger.lat, charger.lng];
      let minDistance = Infinity;
      let closestSegmentIndex = 0;
      let closestT = 0;

      for (let s = 0; s < routeCoords.length - 1; s++) {
        const res = distToSegment(p, routeCoords[s], routeCoords[s + 1]);
        if (res.distance < minDistance) {
          minDistance = res.distance;
          closestSegmentIndex = s;
          closestT = res.t;
        }
        if (minDistance <= 0.05) break;
      }

      if (minDistance <= effectiveMaxCorridorKm) {
        const segDist = cumDists[closestSegmentIndex] + closestT * (cumDists[closestSegmentIndex + 1] - cumDists[closestSegmentIndex]);
        const approxKmFromOrigin = Math.round(segDist * distScale * 10) / 10;
        const approxKmFromDest = Math.max(0.1, Math.round((routeDist - approxKmFromOrigin) * 10) / 10);

        matching.push({
          ...charger,
          corridorDistanceKm: Math.round(minDistance * 10) / 10,
          kmFromOrigin: approxKmFromOrigin,
          kmFromDest: approxKmFromDest
        });
      }
    }

    matching.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
    corridorChargers = matching;
    return corridorChargers;
  }

  function planDirectionStops({ legDistKm, initialBatPct, manualStops, poolChargers, eff, minReserve, targetCharge, stopRole, maxAllowedPool = 25 }) {
    const isCompat = (c) => {
      if (window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function') {
        return window.BatteryEngine.isChargerCompatible(c).compatible;
      }
      return c.is_2w !== false;
    };
    const netBonus = (c) => {
      if (c.network === 'ATHER_GRID' || c.network === 'VIDA_GRID') return 28;
      if (c.network === 'BOLT_EARTH' && c.type === 'FAST') return 20;
      return 0;
    };

    const sortedManual = [...(manualStops || [])]
      .filter(w => typeof w._simKm === 'number' && w._simKm > 0.2 && w._simKm < legDistKm - 0.1)
      .sort((a, b) => a._simKm - b._simKm);

    const usedIds = new Set((manualStops || []).map(w => String(w.originalId || w.id)));
    const autoPicked = [];
    let curKm = 0;
    let curBat = initialBatPct;
    let unreachedStartGap = false;
    let attempts = 0;

    const pickBestBefore = (targetKm, stopAfterOne = false) => {
      while (curKm + Math.max(4, (curBat - minReserve) * eff) < targetKm && attempts < maxAllowedPool) {
        const safeReach = Math.max(4, (curBat - minReserve) * eff);
        const spanToTarget = Math.max(1, targetKm - curKm);
        const searchCap = Math.min(targetKm - 0.3, curKm + safeReach);
        const targetMin = curKm + Math.min(spanToTarget * 0.45, safeReach * 0.45);
        const targetMax = Math.min(targetKm - 0.3, curKm + safeReach * 0.92);

        const effectiveReachOk = (c) => {
          const detourKm = (c.corridorDistanceKm || 0) * 2.0;
          return (c._simKm - curKm + detourKm) <= safeReach;
        };

        let cands = poolChargers.filter(c =>
          matchesRouteFilters(c) &&
          isCompat(c) &&
          !usedIds.has(String(c.originalId || c.id)) &&
          c._simKm >= targetMin &&
          c._simKm <= targetMax &&
          effectiveReachOk(c)
        );
        if (cands.length === 0) {
          cands = poolChargers.filter(c =>
            matchesRouteFilters(c) &&
            isCompat(c) &&
            !usedIds.has(String(c.originalId || c.id)) &&
            c._simKm > curKm + 1.5 &&
            c._simKm <= searchCap &&
            effectiveReachOk(c)
          );
        }
        if (cands.length === 0) {
          const forward = poolChargers.filter(c =>
            matchesRouteFilters(c) &&
            isCompat(c) &&
            !usedIds.has(String(c.originalId || c.id)) &&
            c._simKm > curKm + 0.5 &&
            c._simKm < targetKm
          );
          if (forward.length === 0) {
            unreachedStartGap = true;
            return;
          }
          forward.sort((a, b) => a._simKm - b._simKm);
          cands = [forward[0]];
          const nearestArrival = curBat - ((forward[0]._simKm - curKm) / eff);
          if (nearestArrival < 0) unreachedStartGap = true;
        }

        attempts++;
        cands.sort((a, b) => {
          const sA = ((a._simKm - curKm) * 1.4) + netBonus(a) - (a.corridorDistanceKm * 4.5);
          const sB = ((b._simKm - curKm) * 1.4) + netBonus(b) - (b.corridorDistanceKm * 4.5);
          return sB - sA;
        });

        const selected = cands[0];
        const orig = corridorChargers.find(c => String(c.id) === String(selected.id)) || selected;
        const cleanStop = {
          ...orig,
          leg: stopRole,
          stopRole,
          isAutoSuggested: true
        };
        if (stopRole === 'return') {
          cleanStop.kmFromDest = Math.round(selected._simKm * 10) / 10;
        }
        delete cleanStop._simKm;
        autoPicked.push(cleanStop);
        usedIds.add(String(cleanStop.originalId || cleanStop.id));

        const arrBat = Math.max(0, curBat - ((selected._simKm - curKm) / eff));
        const isFast = orig.network === 'ATHER_GRID' || orig.network === 'VIDA_GRID' || orig.type === 'FAST';
        curBat = Math.max(arrBat, isFast ? targetCharge : 100);
        curKm = selected._simKm;
        if (stopAfterOne) break;
      }
    };

    for (const mw of sortedManual) {
      const neededAtStop = curBat - ((mw._simKm - curKm) / eff);
      if (neededAtStop < minReserve) {
        pickBestBefore(mw._simKm, false);
      }
      const arrBat = Math.max(0, curBat - ((mw._simKm - curKm) / eff));
      if (mw.network || mw.type) {
        const isFast = mw.network === 'ATHER_GRID' || mw.network === 'VIDA_GRID' || mw.type === 'FAST';
        curBat = Math.max(arrBat, isFast ? targetCharge : 100);
      } else {
        curBat = arrBat;
      }
      curKm = mw._simKm;
    }

    // Check remaining span to destination (targetKm = legDistKm)
    const needBatForRemaining = ((legDistKm - curKm) / eff) + minReserve;
    if (curBat < needBatForRemaining) {
      pickBestBefore(legDistKm, false);
    }

    const arrivalAtEndPct = Math.round((curBat - ((legDistKm - curKm) / eff)) * 10) / 10;
    return { autoPicked, arrivalAtEndPct, unreachedStartGap };
  }

  function pickAutoStopsForRoute(route, baseOutWaypoints = [], baseRetWaypoints = [], batState = {}, roundTripOverride = isRoundTrip) {
    if (!route || corridorChargers.length === 0) return { outbound: [], return: [] };

    const eff = (batState.efficiency && batState.efficiency > 0) ? batState.efficiency : 0.85;
    const minReserve = batState.safetyReservePct ?? 15;
    const startBat = batState.currentBatteryPct ?? 85;
    const targetCharge = batState.targetChargePct ?? 80;
    const legDistOneWay = Math.max(0.1, Number(route.distanceKm) || 0.1);

    const outManual = (baseOutWaypoints || []).map(w => ({
      ...w,
      _simKm: typeof w.kmFromOrigin === 'number'
        ? w.kmFromOrigin
        : (route.coordinates && route.coordinates.length >= 2 ? calculateKmAlongRoute(w.lat, w.lng, route.coordinates) : legDistOneWay / 2)
    }));
    const outPool = corridorChargers.map(c => ({ ...c, _simKm: c.kmFromOrigin }));

    const outPlan = planDirectionStops({
      legDistKm: legDistOneWay,
      initialBatPct: startBat,
      manualStops: outManual,
      poolChargers: outPool,
      eff,
      minReserve,
      targetCharge,
      stopRole: 'outbound'
    });

    if (!roundTripOverride) {
      return { outbound: outPlan.autoPicked, return: [] };
    }

    const retManual = (baseRetWaypoints || []).map(w => {
      const kd = typeof w.kmFromDest === 'number'
        ? w.kmFromDest
        : (typeof w.kmFromOrigin === 'number'
            ? Math.max(0.1, legDistOneWay - w.kmFromOrigin)
            : (route.coordinates && route.coordinates.length >= 2
                ? Math.max(0.1, legDistOneWay - calculateKmAlongRoute(w.lat, w.lng, route.coordinates))
                : legDistOneWay / 2));
      return { ...w, _simKm: kd };
    });
    const retPool = corridorChargers
      .map(c => ({
        ...c,
        _simKm: typeof c.kmFromDest === 'number' ? c.kmFromDest : Math.max(0.1, Math.round((legDistOneWay - c.kmFromOrigin) * 10) / 10)
      }))
      .filter(c => c._simKm > 0.2 && c._simKm < legDistOneWay - 0.2)
      .sort((a, b) => a._simKm - b._simKm);

    let finalAutoOut = [...outPlan.autoPicked];
    let retPlan = planDirectionStops({
      legDistKm: legDistOneWay,
      initialBatPct: outPlan.arrivalAtEndPct,
      manualStops: retManual,
      poolChargers: retPool,
      eff,
      minReserve,
      targetCharge,
      stopRole: 'return'
    });

    // If arriving at B left battery too low to even reach the first return charger safely,
    // add one late-outbound top-up stop (within outbound reach near B) so Return can reach home/first return charger safely.
    if (retPlan.unreachedStartGap || (retPlan.arrivalAtEndPct < 0 && retPool.length > 0)) {
      const combinedOutManual = [
        ...outManual,
        ...finalAutoOut.map(w => ({ ...w, _simKm: w.kmFromOrigin }))
      ].sort((a, b) => a._simKm - b._simKm);
      const usedOutIds = new Set(combinedOutManual.map(w => String(w.originalId || w.id)));
      const lastOutKm = combinedOutManual.length > 0 ? combinedOutManual[combinedOutManual.length - 1]._simKm : 0;
      let batBeforeLastLeg = startBat;
      if (combinedOutManual.length > 0) {
        const lastStop = combinedOutManual[combinedOutManual.length - 1];
        const isFast = lastStop.network === 'ATHER_GRID' || lastStop.network === 'VIDA_GRID' || lastStop.type === 'FAST';
        batBeforeLastLeg = Math.max(outPlan.arrivalAtEndPct + ((legDistOneWay - lastOutKm) / eff), isFast ? targetCharge : 100);
      }
      const safeOutFromLast = Math.max(4, (batBeforeLastLeg - minReserve) * eff);
      const lateOutCands = outPool
        .filter(c =>
          matchesRouteFilters(c) &&
          (!window.BatteryEngine || window.BatteryEngine.isChargerCompatible(c).compatible) &&
          !usedOutIds.has(String(c.originalId || c.id)) &&
          c._simKm > lastOutKm + 1.5 &&
          c._simKm < legDistOneWay - 0.2 &&
          (c._simKm - lastOutKm + (c.corridorDistanceKm || 0) * 2) <= safeOutFromLast
        )
        .sort((a, b) => b._simKm - a._simKm);

      if (lateOutCands.length > 0) {
        const topUp = lateOutCands[0];
        const origTopUp = corridorChargers.find(c => String(c.id) === String(topUp.id)) || topUp;
        const cleanTopUp = { ...origTopUp, leg: 'outbound', stopRole: 'outbound', isAutoSuggested: true };
        delete cleanTopUp._simKm;
        finalAutoOut.push(cleanTopUp);
        const isFastTop = cleanTopUp.network === 'ATHER_GRID' || cleanTopUp.network === 'VIDA_GRID' || cleanTopUp.type === 'FAST';
        const topUpTarget = isFastTop ? targetCharge : 100;
        const newSocAtB = Math.round((topUpTarget - ((legDistOneWay - topUp._simKm) / eff)) * 10) / 10;
        retPlan = planDirectionStops({
          legDistKm: legDistOneWay,
          initialBatPct: newSocAtB,
          manualStops: retManual,
          poolChargers: retPool,
          eff,
          minReserve,
          targetCharge,
          stopRole: 'return'
        });
      }
    }

    return { outbound: finalAutoOut, return: retPlan.autoPicked };
  }

  /**
   * Simulates leg-by-leg battery consumption with any existing user waypoints,
   * then inserts ONLY needed vehicle-compatible charging stops without discarding manual stops!
   */
  async function autoSuggestChargingStops(batteryEvaluation = null) {
    if (!activeRoute) return [];

    const batState = window.BatteryEngine ? window.BatteryEngine.getState() : {};
    const minReserve = batState.safetyReservePct ?? 15;

    const currentPlan = calculateTripTimeline(activeRoute, batState);
    if (currentPlan && currentPlan.timeline) {
      const hasUnsafeNode = currentPlan.timeline.some(s =>
        (s.type === 'CHARGER_STOP' || s.type === 'CUSTOM_STOP' || s.type === 'TURNAROUND' || s.type === 'DESTINATION') &&
        s.arrivalSoC < minReserve
      );
      if (!hasUnsafeNode) {
        return [];
      }
    }

    const existingOut = [...intermediateWaypoints];
    const existingRet = isRoundTrip ? [...returnWaypoints] : [];
    const suggested = pickAutoStopsForRoute(activeRoute, existingOut, existingRet, batState, isRoundTrip);
    const outAdd = suggested.outbound || [];
    const retAdd = suggested.return || [];

    if (outAdd.length > 0 || retAdd.length > 0) {
      const mergedOut = [...existingOut, ...outAdd];
      intermediateWaypoints = sortWaypointsSequentially(mergedOut, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      const mergedRet = isRoundTrip ? [...existingRet, ...retAdd] : existingRet;
      returnWaypoints = sortWaypointsSequentially(mergedRet, activeRoute.origin, activeRoute.destination, activeRoute.coordinates, true);
      await calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, true, {
        preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
        optionIndex: selectedRouteIndex,
        returnWaypoints
      });
    }

    return [...outAdd, ...retAdd];
  }

  let isReconcilingBatteryStops = false;

  /**
   * Dynamically updates auto-suggested charging stops on the map & active trip
   * whenever Current Battery %, Efficiency / Riding Mode, Reserve, or Fast Charge Limit changes.
   * Preserves alternate route options across all battery levels.
   */
  async function reconcileStopsForBattery(liveUserCoords = null, forceEvaluate = false) {
    if (!activeRoute || !navigator.onLine || isReconcilingBatteryStops) return false;
    isReconcilingBatteryStops = true;

    try {
      const batState = window.BatteryEngine ? window.BatteryEngine.getState() : {};
      const eff = (batState.efficiency && batState.efficiency > 0) ? batState.efficiency : 0.85;
      const minReserve = batState.safetyReservePct ?? 15;
      const startBat = batState.currentBatteryPct ?? 85;

      const currentPlan = calculateTripTimeline(activeRoute, batState);
      const hasUnsafeNode = Boolean(currentPlan && currentPlan.timeline && currentPlan.timeline.some(s =>
        (s.type === 'CHARGER_STOP' || s.type === 'CUSTOM_STOP' || s.type === 'TURNAROUND' || s.type === 'DESTINATION') &&
        s.arrivalSoC < minReserve
      ));

      const isDriving = Boolean(window.DriveEngine && window.DriveEngine.isActive() && liveUserCoords);
      const effectiveRt = !isDriving && isRoundTrip;
      let slice = null;
      if (isDriving) {
        slice = sliceActiveRouteAtPosition(liveUserCoords.lat, liveUserCoords.lng);
      }

      const routeOriginForReplan = (isDriving && slice && slice.distanceFromRouteKm < 0.25)
        ? { lat: liveUserCoords.lat, lng: liveUserCoords.lng, name: 'Current Location' }
        : activeRoute.origin;
      const traversedKm = (isDriving && slice && typeof slice.remainingKm === 'number')
        ? Math.max(0, activeRoute.distanceKm - slice.remainingKm)
        : 0;
      const remainingDistKm = (isDriving && slice && typeof slice.remainingKm === 'number')
        ? slice.remainingKm
        : activeRoute.distanceKm;

      const manualOutStops = intermediateWaypoints.filter(w =>
        !w.isAutoSuggested && (!isDriving || typeof w.kmFromOrigin !== 'number' || w.kmFromOrigin > traversedKm + 0.3)
      );
      const manualRetStops = effectiveRt ? returnWaypoints.filter(w => !w.isAutoSuggested) : [];
      const hasAutoOut = intermediateWaypoints.some(w => w.isAutoSuggested);
      const hasAutoRet = returnWaypoints.some(w => w.isAutoSuggested);
      const hasAutoStops = hasAutoOut || hasAutoRet;

      if (!hasUnsafeNode && !hasAutoStops && !forceEvaluate) {
        return false;
      }

      let desiredOut = [...manualOutStops];
      let desiredRet = [...manualRetStops];
      const directArrival = startBat - ((effectiveRt ? remainingDistKm * 2 : remainingDistKm) / eff);

      // Zero-cost instant restore when battery/efficiency covers full trip & no manual stops remain
      if (!isDriving && manualOutStops.length === 0 && manualRetStops.length === 0 && directArrival >= minReserve && hasAutoStops && baseRouteOptions[selectedRouteIndex]) {
        const cleanBase = baseRouteOptions[selectedRouteIndex];
        allRoutes[selectedRouteIndex] = { ...cleanBase, waypoints: [], returnWaypoints: [], returnRoute: null };
        refreshRouteTimeDiffs(allRoutes);
        activeRoute = allRoutes[selectedRouteIndex];
        intermediateWaypoints = [];
        returnWaypoints = [];
        findCorridorChargers(activeRoute.coordinates);
        if (effectiveRt) {
          await ensureReturnRouteForRoute(activeRoute, []);
        }
        persistTripState();
        notify();
        return true;
      }

      if (manualOutStops.length > 0 || manualRetStops.length > 0 || directArrival < minReserve || effectiveRt) {
        const simRoute = isDriving
          ? {
              ...activeRoute,
              distanceKm: remainingDistKm,
              origin: routeOriginForReplan
            }
          : activeRoute;

        const baseOutForSim = manualOutStops.map(w => ({
          ...w,
          kmFromOrigin: typeof w.kmFromOrigin === 'number' ? Math.max(0.5, w.kmFromOrigin - traversedKm) : w.kmFromOrigin
        }));
        const shiftedCorridor = isDriving
          ? corridorChargers.map(c => ({ ...c, kmFromOrigin: (c.kmFromOrigin || 0) - traversedKm })).filter(c => c.kmFromOrigin > 0.5)
          : null;

        const origCorridor = corridorChargers;
        if (shiftedCorridor) corridorChargers = shiftedCorridor;
        const neededAuto = pickAutoStopsForRoute(simRoute, baseOutForSim, manualRetStops, batState, effectiveRt);
        if (shiftedCorridor) corridorChargers = origCorridor;

        const autoOut = neededAuto.outbound || [];
        const autoRet = neededAuto.return || [];

        if (hasUnsafeNode || (hasAutoStops && (autoOut.length > 0 || autoRet.length > 0)) || forceEvaluate) {
          desiredOut = sortWaypointsSequentially(
            [...manualOutStops, ...autoOut],
            routeOriginForReplan,
            activeRoute.destination,
            activeRoute.coordinates
          );
          desiredRet = effectiveRt
            ? sortWaypointsSequentially(
                [...manualRetStops, ...autoRet],
                activeRoute.origin,
                activeRoute.destination,
                activeRoute.coordinates,
                true
              )
            : [...manualRetStops];
        } else {
          desiredOut = [...intermediateWaypoints];
          desiredRet = [...returnWaypoints];
        }
      }

      const normIds = (arr) => arr.map(w => String(w.originalId || w.id)).join('|');
      const outChanged = normIds(desiredOut) !== normIds(intermediateWaypoints);
      const retChanged = normIds(desiredRet) !== normIds(returnWaypoints);
      if (!outChanged && !retChanged) {
        if (effectiveRt && !activeRoute.returnRoute) {
          await ensureReturnRouteForRoute(activeRoute, returnWaypoints);
          persistTripState();
          notify();
          return true;
        }
        return false;
      }

      if (!outChanged && retChanged) {
        // Only return stops changed — keep outbound route untouched and rebuild only return route!
        returnWaypoints = desiredRet.map(w => ({ ...w, leg: 'return', stopRole: 'return' }));
        activeRoute.returnWaypoints = returnWaypoints.map(w => ({ ...w }));
        if (baseRouteOptions[selectedRouteIndex]) {
          baseRouteOptions[selectedRouteIndex].returnWaypoints = returnWaypoints.map(w => ({ ...w }));
        }
        if (effectiveRt) {
          await ensureReturnRouteForRoute(activeRoute, returnWaypoints);
        }
        persistTripState();
        notify();
        return true;
      }

      await calculateRoute(routeOriginForReplan, activeRoute.destination, desiredOut, true, {
        preserveOtherOptions: !isDriving && (allRoutes.length > 1 || baseRouteOptions.length > 1),
        optionIndex: selectedRouteIndex,
        returnWaypoints: desiredRet
      });
      return true;
    } catch (e) {
      return false;
    } finally {
      isReconcilingBatteryStops = false;
    }
  }

  function addWaypoint(charger, leg = 'outbound') {
    if (!charger) return false;
    const targetLeg = (leg === 'return') ? 'return' : 'outbound';
    if (targetLeg === 'return' && !isRoundTrip) {
      isRoundTrip = true;
    }

    const baseId = charger.originalId || charger.id || `stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const targetList = targetLeg === 'return' ? returnWaypoints : intermediateWaypoints;
    const alreadyExists = targetList.some(w => String(w.originalId || w.id) === String(baseId));

    if (alreadyExists) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        const legLbl = targetLeg === 'return' ? 'Return' : 'Going';
        window.SyncEngine.showAutoUpdateToast(`⚡ ${charger.name || 'Charger'} is already in ${legLbl} stops`);
      }
      return false;
    }

    if (window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function') {
      const compat = window.BatteryEngine.isChargerCompatible(charger);
      if (!compat.compatible && window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`⚠️ Note: ${compat.reason}`);
      }
    }

    const stopObj = { ...charger, originalId: baseId, id: baseId, leg: targetLeg, stopRole: targetLeg };
    delete stopObj.kmFromOrigin;
    delete stopObj.kmFromDest;

    if (targetLeg === 'return') {
      if (activeRoute && activeRoute.coordinates) {
        const kOut = calculateKmAlongRoute(stopObj.lat, stopObj.lng, activeRoute.coordinates);
        const legDist = Number(activeRoute.distanceKm) || 0;
        stopObj.kmFromOrigin = Math.round(kOut * 10) / 10;
        stopObj.kmFromDest = Math.max(0.1, Math.round((legDist - kOut) * 10) / 10);
      }
      returnWaypoints.push(stopObj);
      returnWaypoints = sortWaypointsSequentially(
        returnWaypoints,
        activeRoute && activeRoute.origin,
        activeRoute && activeRoute.destination,
        activeRoute && activeRoute.coordinates,
        true
      );
      if (Array.isArray(baseRouteOptions) && baseRouteOptions[selectedRouteIndex]) {
        baseRouteOptions[selectedRouteIndex].returnWaypoints = returnWaypoints.map(w => ({ ...w }));
      }
      if (activeRoute) {
        activeRoute.returnWaypoints = returnWaypoints.map(w => ({ ...w }));
        persistTripState();
        notify();
        ensureReturnRouteForRoute(activeRoute, returnWaypoints).then(() => {
          persistTripState();
          notify();
        }).catch(() => {});
      } else {
        persistTripState();
        notify();
      }
      return true;
    }

    if (Array.isArray(baseRouteOptions) && baseRouteOptions[selectedRouteIndex]) {
      if (!Array.isArray(baseRouteOptions[selectedRouteIndex].waypoints)) {
        baseRouteOptions[selectedRouteIndex].waypoints = [];
      }
      if (!baseRouteOptions[selectedRouteIndex].waypoints.some(w => String(w.originalId || w.id) === String(baseId))) {
        baseRouteOptions[selectedRouteIndex].waypoints.push({ ...stopObj });
      }
    }

    if (activeRoute && activeRoute.coordinates) {
      intermediateWaypoints.push(stopObj);
      intermediateWaypoints = sortWaypointsSequentially(intermediateWaypoints, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, false, {
        preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
        optionIndex: selectedRouteIndex,
        returnWaypoints
      });
    } else {
      intermediateWaypoints.push(stopObj);
      persistTripState();
      notify();
    }
    return true;
  }

  function removeWaypoint(target, leg = null) {
    if (target === undefined || target === null || target === '') return;

    const explicitLeg = leg || (typeof target === 'object' ? (target.leg || target.stopRole || null) : null);
    const matchFn = (w) => {
      if (!w) return false;
      if (typeof target === 'object') {
        const tId = target.id || target.originalId;
        if (tId && (String(w.id) === String(tId) || String(w.originalId || '') === String(tId))) {
          return true;
        }
        if (typeof target.lat === 'number' && typeof target.lng === 'number' && typeof w.lat === 'number' && typeof w.lng === 'number') {
          if (Math.abs(w.lat - target.lat) < 1e-4 && Math.abs(w.lng - target.lng) < 1e-4) {
            return true;
          }
        }
        if (target.name && w.name && target.name.trim() === w.name.trim()) {
          return true;
        }
        return false;
      }
      const sTarget = String(target);
      return String(w.id) === sTarget || String(w.originalId || '') === sTarget || String(w.name || '') === sTarget;
    };

    let removedOut = false;
    let removedRet = false;

    if (explicitLeg !== 'return') {
      const before = intermediateWaypoints.length;
      if (typeof target === 'number' && target >= 0 && target < intermediateWaypoints.length) {
        intermediateWaypoints.splice(target, 1);
      } else {
        intermediateWaypoints = intermediateWaypoints.filter(w => !matchFn(w));
      }
      if (intermediateWaypoints.length !== before) removedOut = true;
      intermediateWaypoints.forEach(w => { delete w.kmFromOrigin; });
    }

    if (explicitLeg === 'return' || (!explicitLeg && !removedOut)) {
      const beforeR = returnWaypoints.length;
      if (explicitLeg === 'return' && typeof target === 'number' && target >= 0 && target < returnWaypoints.length) {
        returnWaypoints.splice(target, 1);
      } else {
        returnWaypoints = returnWaypoints.filter(w => !matchFn(w));
      }
      if (returnWaypoints.length !== beforeR) removedRet = true;
    }

    if (Array.isArray(baseRouteOptions)) {
      baseRouteOptions.forEach(opt => {
        if (removedOut && Array.isArray(opt.waypoints)) {
          if (typeof target === 'number' && target >= 0 && target < opt.waypoints.length) {
            opt.waypoints.splice(target, 1);
          } else {
            opt.waypoints = opt.waypoints.filter(w => !matchFn(w));
          }
        }
        if (removedRet && Array.isArray(opt.returnWaypoints)) {
          if (explicitLeg === 'return' && typeof target === 'number' && target >= 0 && target < opt.returnWaypoints.length) {
            opt.returnWaypoints.splice(target, 1);
          } else {
            opt.returnWaypoints = opt.returnWaypoints.filter(w => !matchFn(w));
          }
        }
      });
    }

    if (activeRoute) {
      if (removedOut) {
        calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, false, {
          preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
          optionIndex: selectedRouteIndex,
          returnWaypoints
        }).catch(err => {
          console.warn('[VoltWay Router] Recalculate after remove waypoint note:', err);
        });
      } else if (removedRet) {
        activeRoute.returnWaypoints = returnWaypoints.map(w => ({ ...w }));
        persistTripState();
        notify();
        ensureReturnRouteForRoute(activeRoute, returnWaypoints).then(() => {
          persistTripState();
          notify();
        }).catch(() => {});
      }
    } else {
      persistTripState();
      notify();
    }
  }

  function setRouteFilters(newFilters) {
    Object.assign(routeFilters, newFilters);
    if (activeRoute) {
      findCorridorChargers(activeRoute.coordinates);
      persistTripState();
      notify();
    }
  }

  function getRouteFilters() {
    return { ...routeFilters };
  }

  function getNearbyBackupSummary(station, batState = null, radiusKm = 2.5) {
    if (!station || typeof station.lat !== 'number' || typeof station.lng !== 'number') {
      return { totalCompatible: 0, fastCount: 0, slowCount: 0, closest: null };
    }
    if (!window.SyncEngine || typeof window.SyncEngine.getChargersInBounds !== 'function') {
      return { totalCompatible: 0, fastCount: 0, slowCount: 0, closest: null };
    }

    const degPad = (radiusKm / 111.0) + 0.01;
    const candidates = window.SyncEngine.getChargersInBounds({
      south: station.lat - degPad,
      north: station.lat + degPad,
      west: station.lng - degPad,
      east: station.lng + degPad
    });

    const stId = String(station.originalId || station.id || '');
    const vKey = (batState && batState.selectedVehicle) || undefined;
    const isCompatFn = (c) => {
      if (window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function') {
        return window.BatteryEngine.isChargerCompatible(c, vKey).compatible;
      }
      return c.is_2w !== false;
    };

    const backups = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || c.is_2w === false) continue;
      const cid = String(c.originalId || c.id || '');
      if (cid === stId || String(c.id || '') === String(station.id || '')) continue;
      const dKm = haversineDistance(station.lat, station.lng, c.lat, c.lng);
      if (dKm > radiusKm) continue;
      if (!isCompatFn(c)) continue;
      const isFastBackup = c.network === 'ATHER_GRID' || c.network === 'VIDA_GRID' || c.type === 'FAST';
      backups.push({
        ...c,
        isFastBackup,
        distanceKm: Math.round(dKm * 10) / 10
      });
    }

    backups.sort((a, b) => {
      if (a.isFastBackup !== b.isFastBackup) return a.isFastBackup ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });

    const fastCount = backups.filter(b => b.isFastBackup).length;
    const slowCount = backups.length - fastCount;
    return {
      totalCompatible: backups.length,
      fastCount,
      slowCount,
      closest: backups[0] || null
    };
  }

  function calculateTripTimeline(route, batteryState, roundTripOverride = null) {
    if (!route) return null;
    const roundTrip = roundTripOverride != null ? Boolean(roundTripOverride) : isRoundTrip;
    const batState = batteryState || (window.BatteryEngine ? window.BatteryEngine.getState() : {
      currentBatteryPct: 85,
      efficiency: 0.85,
      safetyReservePct: 15,
      targetChargePct: 80
    });

    const eff = (batState.efficiency != null && batState.efficiency > 0) ? batState.efficiency : 0.85;
    const startBat = (typeof batState.currentBatteryPct === 'number' && !isNaN(batState.currentBatteryPct)) ? batState.currentBatteryPct : 85;
    const targetCharge = (typeof batState.targetChargePct === 'number' && !isNaN(batState.targetChargePct)) ? batState.targetChargePct : 80;
    const minReserve = (typeof batState.safetyReservePct === 'number' && !isNaN(batState.safetyReservePct)) ? batState.safetyReservePct : 15;

    const outWaypoints = route.waypoints || [];
    const retWaypoints = roundTrip ? (route.returnWaypoints || []) : [];
    const retRouteObj = roundTrip ? route.returnRoute : null;
    const legs = route.legs || [];
    const returnDistKm = (retRouteObj && typeof retRouteObj.distanceKm === 'number') ? retRouteObj.distanceKm : route.distanceKm;
    const returnMins = (retRouteObj && typeof retRouteObj.durationMins === 'number') ? retRouteObj.durationMins : route.durationMins;
    const timeline = [];
    const totalRouteDistKm = roundTrip ? Math.round((route.distanceKm + returnDistKm) * 10) / 10 : route.distanceKm;
    const totalDrivingMins = roundTrip ? ((route.durationMins || 0) + (returnMins || 0)) : route.durationMins;

    let currentSoC = startBat;
    let totalChargingTimeMins = 0;
    let totalEnergyChargedPct = 0;

    timeline.push({
      type: 'ORIGIN',
      name: route.origin?.name || 'Origin',
      lat: route.origin?.lat,
      lng: route.origin?.lng,
      batteryPct: currentSoC
    });

    if (outWaypoints.length === 0 && retWaypoints.length === 0) {
      const usedPct = fixNegZero(Math.round((route.distanceKm / eff) * 10) / 10);
      const arrivalSoC = fixNegZero(Math.round((currentSoC - usedPct) * 10) / 10);

      timeline.push({
        type: 'LEG',
        distanceKm: route.distanceKm,
        durationMins: route.durationMins,
        batteryUsedPct: usedPct,
        isReturnLeg: false
      });

      if (!roundTrip) {
        timeline.push({
          type: 'DESTINATION',
          name: route.destination?.name || 'Destination',
          lat: route.destination?.lat,
          lng: route.destination?.lng,
          arrivalSoC,
          isSafe: arrivalSoC >= minReserve,
          isCritical: arrivalSoC < 0
        });

        return {
          timeline,
          isRoundTrip: false,
          totalRouteDistKm: route.distanceKm,
          totalDrivingMins: route.durationMins,
          totalChargingMins: 0,
          totalTripDurationMins: route.durationMins,
          totalChargingStops: 0,
          totalEnergyChargedPct: 0,
          finalArrivalSoC: arrivalSoC,
          turnaroundArrivalSoC: arrivalSoC,
          targetChargePct: targetCharge
        };
      }

      const retUsedPct = fixNegZero(Math.round((returnDistKm / eff) * 10) / 10);
      const retArrivalSoC = fixNegZero(Math.round((arrivalSoC - retUsedPct) * 10) / 10);
      timeline.push({
        type: 'TURNAROUND',
        name: route.destination?.name || 'Destination',
        lat: route.destination?.lat,
        lng: route.destination?.lng,
        arrivalSoC,
        returnNeededPct: fixNegZero(Math.round((retUsedPct + minReserve) * 10) / 10),
        isSafe: arrivalSoC >= minReserve,
        isCritical: arrivalSoC < 0
      });

      timeline.push({
        type: 'LEG',
        distanceKm: returnDistKm,
        durationMins: returnMins,
        batteryUsedPct: retUsedPct,
        isReturnLeg: true
      });

      timeline.push({
        type: 'DESTINATION',
        name: `${route.origin?.name || 'Origin'} (Return)`,
        lat: route.origin?.lat,
        lng: route.origin?.lng,
        arrivalSoC: retArrivalSoC,
        isReturnOrigin: true,
        isSafe: retArrivalSoC >= minReserve,
        isCritical: retArrivalSoC < 0
      });

      return {
        timeline,
        isRoundTrip: true,
        totalRouteDistKm,
        totalDrivingMins,
        totalChargingMins: 0,
        totalTripDurationMins: totalDrivingMins,
        totalChargingStops: 0,
        totalEnergyChargedPct: 0,
        finalArrivalSoC: retArrivalSoC,
        turnaroundArrivalSoC: arrivalSoC,
        targetChargePct: targetCharge
      };
    }

    const getLegMetrics = (idx) => {
      const distKm = (legs[idx] && legs[idx].distance)
        ? Math.round((legs[idx].distance / 1000) * 10) / 10
        : Math.round((route.distanceKm / (outWaypoints.length + 1)) * 10) / 10;
      const durationMins = (legs[idx] && legs[idx].duration)
        ? Math.round(legs[idx].duration / 60)
        : Math.round(distKm * 1.8);
      return { distKm, durationMins };
    };

    const getRetBoundsKm = () => {
      const bounds = [0];
      let last = 0;
      for (const w of retWaypoints) {
        const kd = typeof w.kmFromDest === 'number'
          ? w.kmFromDest
          : (typeof w.kmFromOrigin === 'number' ? Math.max(0.1, returnDistKm - w.kmFromOrigin) : last + (returnDistKm / (retWaypoints.length + 1)));
        const clamped = Math.max(last + 0.1, Math.min(returnDistKm - 0.1, Math.round(kd * 10) / 10));
        bounds.push(clamped);
        last = clamped;
      }
      bounds.push(returnDistKm);
      return bounds;
    };
    const retBounds = roundTrip ? getRetBoundsKm() : [];
    const hasRealRetLegs = Boolean(retRouteObj && Array.isArray(retRouteObj.legs) && retRouteObj.legs.length === retWaypoints.length + 1);
    const getRetLegMetrics = (idx) => {
      if (hasRealRetLegs && retRouteObj.legs[idx]) {
        const l = retRouteObj.legs[idx];
        const distKm = Math.round(((l.distance || 0) / 1000) * 10) / 10;
        const durationMins = Math.max(1, Math.round((l.duration || 0) / 60));
        return { distKm, durationMins };
      }
      const distKm = Math.max(0.1, Math.round(((retBounds[idx + 1] ?? returnDistKm) - (retBounds[idx] ?? 0)) * 10) / 10);
      const ratio = returnDistKm > 0 ? (distKm / returnDistKm) : (1 / (retWaypoints.length + 1));
      const durationMins = Math.max(1, Math.round(returnMins * ratio));
      return { distKm, durationMins };
    };

    const sequence = [];
    for (let i = 0; i < outWaypoints.length; i++) {
      const lm = getLegMetrics(i);
      sequence.push({ kind: 'LEG', ...lm, isReturnLeg: false });
      const wp = outWaypoints[i];
      sequence.push({
        kind: (wp.network || wp.type) ? 'CHARGER_STOP' : 'CUSTOM_STOP',
        wp,
        stopIdx: i + 1,
        isReturnLeg: false
      });
    }
    const lastOutLeg = getLegMetrics(outWaypoints.length);
    sequence.push({ kind: 'LEG', ...lastOutLeg, isReturnLeg: false });

    if (roundTrip) {
      sequence.push({
        kind: 'TURNAROUND',
        name: route.destination?.name || 'Destination',
        lat: route.destination?.lat,
        lng: route.destination?.lng
      });
      for (let i = 0; i < retWaypoints.length; i++) {
        const rlm = getRetLegMetrics(i);
        sequence.push({ kind: 'LEG', ...rlm, isReturnLeg: true });
        const wp = retWaypoints[i];
        sequence.push({
          kind: (wp.network || wp.type) ? 'CHARGER_STOP' : 'CUSTOM_STOP',
          wp,
          stopIdx: i + 1,
          isReturnLeg: true
        });
      }
      const lastRetLeg = getRetLegMetrics(retWaypoints.length);
      sequence.push({ kind: 'LEG', ...lastRetLeg, isReturnLeg: true });
      sequence.push({
        kind: 'DESTINATION',
        name: `${route.origin?.name || 'Origin'} (Return)`,
        lat: route.origin?.lat,
        lng: route.origin?.lng,
        isReturnOrigin: true
      });
    } else {
      sequence.push({
        kind: 'DESTINATION',
        name: route.destination?.name || 'Destination',
        lat: route.destination?.lat,
        lng: route.destination?.lng,
        isReturnOrigin: false
      });
    }

    let turnaroundArrivalSoC = null;

    for (let s = 0; s < sequence.length; s++) {
      const item = sequence[s];
      if (item.kind === 'LEG') {
        const batUsed = fixNegZero(Math.round((item.distKm / eff) * 10) / 10);
        currentSoC = fixNegZero(Math.round((currentSoC - batUsed) * 10) / 10);
        timeline.push({
          type: 'LEG',
          distanceKm: item.distKm,
          durationMins: item.durationMins,
          batteryUsedPct: batUsed,
          isReturnLeg: item.isReturnLeg
        });
      } else if (item.kind === 'TURNAROUND') {
        turnaroundArrivalSoC = currentSoC;
        timeline.push({
          type: 'TURNAROUND',
          name: item.name,
          lat: item.lat,
          lng: item.lng,
          arrivalSoC: currentSoC,
          isSafe: currentSoC >= minReserve,
          isCritical: currentSoC < 0
        });
      } else if (item.kind === 'CUSTOM_STOP') {
        const isSafeArrival = currentSoC >= minReserve;
        const isCriticalArrival = currentSoC < 0;
        let nextLegDist = 0;
        let nextStopName = 'Destination';
        for (let k = s + 1; k < sequence.length; k++) {
          if (sequence[k].kind === 'LEG') nextLegDist += sequence[k].distKm;
          else {
            nextStopName = sequence[k].wp ? (sequence[k].wp.name || 'Next Stop') : sequence[k].name;
            break;
          }
        }
        nextLegDist = Math.round(nextLegDist * 10) / 10;
        timeline.push({
          type: 'CUSTOM_STOP',
          index: item.stopIdx,
          name: item.wp.name || `Intermediate Stop ${item.stopIdx}`,
          point: item.wp,
          arrivalSoC: currentSoC,
          isSafeArrival,
          isCriticalArrival,
          nextLegDist,
          nextStopName,
          departureSoC: currentSoC,
          isReturnLeg: item.isReturnLeg
        });
      } else if (item.kind === 'CHARGER_STOP') {
        const wp = item.wp;
        const arrivalSoC = currentSoC;
        const isSafeArrival = arrivalSoC >= minReserve;
        const isCriticalArrival = arrivalSoC < 0;

        let nextChargeDistKm = 0;
        let nextTargetName = 'Destination';
        for (let k = s + 1; k < sequence.length; k++) {
          if (sequence[k].kind === 'LEG') nextChargeDistKm += sequence[k].distKm;
          else if (sequence[k].kind === 'CHARGER_STOP' || sequence[k].kind === 'DESTINATION') {
            nextTargetName = sequence[k].wp ? (sequence[k].wp.name || 'Next Charger') : sequence[k].name;
            break;
          }
        }
        nextChargeDistKm = Math.round(nextChargeDistKm * 10) / 10;
        const nextLegBatUsed = Math.round((nextChargeDistKm / eff) * 10) / 10;
        const minDepartureNeeded = Math.ceil(nextLegBatUsed + minReserve);

        const isFast = wp.network === 'ATHER_GRID' || wp.network === 'VIDA_GRID' || wp.type === 'FAST';
        const maxChargerCeiling = isFast ? targetCharge : 100;
        const effectiveArrival = Math.max(0, arrivalSoC);

        const optimalTargetSoC = effectiveArrival >= minDepartureNeeded
          ? arrivalSoC
          : Math.min(maxChargerCeiling, minDepartureNeeded);
        const optimalChargeNeededPct = fixNegZero(Math.max(0, Math.round((optimalTargetSoC - effectiveArrival) * 10) / 10));
        const optimalChargeTimeMins = computeChargingDuration(optimalChargeNeededPct, effectiveArrival, isFast, wp.power_kw, batState.vehicleDetails);

        const fullTargetSoC = (effectiveArrival >= maxChargerCeiling
          ? arrivalSoC
          : Math.max(effectiveArrival, Math.min(maxChargerCeiling, Math.max(targetCharge, optimalTargetSoC))));
        const fullChargeNeededPct = fixNegZero(Math.max(0, Math.round((fullTargetSoC - effectiveArrival) * 10) / 10));
        const fullChargeTimeMins = computeChargingDuration(fullChargeNeededPct, effectiveArrival, isFast, wp.power_kw, batState.vehicleDetails);

        const timeSavedMins = Math.max(0, fullChargeTimeMins - optimalChargeTimeMins);
        const batCap = (batState.vehicleDetails && batState.vehicleDetails.batteryCapacity) || 3.7;
        const activeTargetSoC = currentTimelineMode === 'optimal' ? optimalTargetSoC : fullTargetSoC;
        const activeChargeNeeded = currentTimelineMode === 'optimal' ? optimalChargeNeededPct : fullChargeNeededPct;
        const activeChargeTime = currentTimelineMode === 'optimal' ? optimalChargeTimeMins : fullChargeTimeMins;
        const unitsActiveKWh = Math.round(((activeChargeNeeded / 100) * batCap) * 100) / 100;

        let smartAdvice = '';
        if (isFast && minDepartureNeeded > Math.max(maxChargerCeiling, effectiveArrival)) {
          const ceilingForNext = Math.max(maxChargerCeiling, effectiveArrival);
          const estArrival = fixNegZero(Math.round((ceilingForNext - nextLegBatUsed) * 10) / 10);
          if (estArrival >= 0) {
            smartAdvice = `Target ceiling ${maxChargerCeiling}%. Next span is ${nextChargeDistKm} km to ${nextTargetName}, arriving with est. ~${estArrival}% SoC.`;
          } else {
            const shortKm = Math.round(Math.abs(estArrival) * eff * 10) / 10;
            smartAdvice = `⚠️ Range Gap: Next span is ${nextChargeDistKm} km to ${nextTargetName}. Even at ${maxChargerCeiling}%, est. short by ~${shortKm} km — raise charge target to 95–100% or switch to ECO mode.`;
          }
        } else if (optimalTargetSoC < fullTargetSoC) {
          smartAdvice = `Next span is ${nextChargeDistKm} km to ${nextTargetName}. Fast-hop charge to ${optimalTargetSoC}% saves ~${timeSavedMins} min (keeps ${minReserve}% reserve).`;
        } else if (activeChargeNeeded === 0) {
          smartAdvice = `Battery already sufficient (${arrivalSoC}%) for ${nextChargeDistKm} km to ${nextTargetName}.`;
        } else {
          smartAdvice = `Next span is ${nextChargeDistKm} km to ${nextTargetName}. Charge to ${optimalTargetSoC}% for safe arrival.`;
        }

        totalChargingTimeMins += activeChargeTime;
        totalEnergyChargedPct += activeChargeNeeded;

        const backupSummary = getNearbyBackupSummary(wp, batState, 2.5);

        timeline.push({
          type: 'CHARGER_STOP',
          index: item.stopIdx,
          station: wp,
          isFast,
          isReturnLeg: item.isReturnLeg,
          arrivalSoC,
          isSafeArrival,
          isCriticalArrival,
          nextLegDist: nextChargeDistKm,
          nextStopName: nextTargetName,
          optimalTargetSoC,
          optimalChargeNeededPct,
          optimalChargeTimeMins,
          fullTargetSoC,
          fullChargeNeededPct,
          fullChargeTimeMins,
          timeSavedMins,
          unitsKWh: unitsActiveKWh,
          smartAdvice,
          backupSummary,
          targetChargeSoC: targetCharge,
          chargeNeededPct: activeChargeNeeded,
          chargeTimeMins: activeChargeTime,
          departureSoC: activeTargetSoC
        });

        currentSoC = activeTargetSoC;
      } else if (item.kind === 'DESTINATION') {
        timeline.push({
          type: 'DESTINATION',
          name: item.name,
          lat: item.lat,
          lng: item.lng,
          arrivalSoC: currentSoC,
          isReturnOrigin: Boolean(item.isReturnOrigin),
          isSafe: currentSoC >= minReserve,
          isCritical: currentSoC < 0
        });
      }
    }

    const totalPhysicalChargerStops = outWaypoints.filter(w => w.network || w.type).length
      + retWaypoints.filter(w => w.network || w.type).length;
    return {
      timeline,
      isRoundTrip: roundTrip,
      totalRouteDistKm,
      totalDrivingMins,
      totalChargingMins: totalChargingTimeMins,
      totalTripDurationMins: totalDrivingMins + totalChargingTimeMins,
      totalChargingStops: timeline.filter(n => n.type === 'CHARGER_STOP' && n.chargeNeededPct > 0).length || totalPhysicalChargerStops,
      totalEnergyChargedPct: Math.round(totalEnergyChargedPct * 10) / 10,
      finalArrivalSoC: currentSoC,
      turnaroundArrivalSoC: turnaroundArrivalSoC != null ? turnaroundArrivalSoC : currentSoC,
      targetChargePct: targetCharge
    };
  }

  function clearRoute() {
    activeRoute = null;
    allRoutes = [];
    baseRouteOptions = [];
    selectedRouteIndex = 0;
    corridorChargers = [];
    intermediateWaypoints = [];
    returnWaypoints = [];
    lastSnappedSegmentIndex = 0;
    lastSliceKey = '';
    lastSliceResult = null;
    isRoundTrip = false;
    sentToGoogleMaps = false;
    try { localStorage.removeItem(SAVED_TRIP_KEY); } catch (e) {}
    notify();
  }

  return {
    calculateRoute,
    selectRoute,
    findCorridorChargers,
    autoSuggestChargingStops,
    reconcileStopsForBattery,
    calculateTripTimeline,
    getNearbyBackupSummary,
    setTimelineMode,
    getTimelineMode,
    setRoundTrip,
    getRoundTrip,
    addWaypoint,
    removeWaypoint,
    clearRoute,
    setRouteFilters,
    getRouteFilters,
    setCorridorBufferKm,
    getCorridorBufferKm,
    getDistanceToActiveRoute,
    sliceActiveRouteAtPosition,
    restoreSavedTrip,
    refreshCorridorForActiveRoute,
    markSentToGoogleMaps,
    isSentToGoogleMaps: () => sentToGoogleMaps,
    subscribe,
    getActiveRoute: () => activeRoute,
    getAllRoutes: () => allRoutes,
    getSelectedRouteIndex: () => selectedRouteIndex,
    getCorridorChargers: () => corridorChargers,
    getWaypoints: () => intermediateWaypoints,
    getReturnWaypoints: () => returnWaypoints,
    getOrigin: () => currentOrigin || (activeRoute && activeRoute.origin),
    getDestination: () => currentDestination || (activeRoute && activeRoute.destination)
  };
})();

window.RouteEngine = RouteEngine;

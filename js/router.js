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
      timelineMode: currentTimelineMode,
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
        timelineMode: currentTimelineMode,
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
        ? parsed.waypoints.map(w => ({ ...w }))
        : (activeRoute.waypoints || []).map(w => ({ ...w }));

      if (parsed.timelineMode === 'optimal' || parsed.timelineMode === 'target') {
        currentTimelineMode = parsed.timelineMode;
      }
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

  /**
   * Slices active route at rider's live GPS position and calculates remaining distance/duration metrics.
   */
  function sliceActiveRouteAtPosition(lat, lng) {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
      return null;
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

    return {
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
  }

  function setTimelineMode(mode) {
    if (mode === 'optimal' || mode === 'target') {
      currentTimelineMode = mode;
      persistTripState();
      notify();
    }
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

      coords.push([Math.round(lat * inv * 1e6) / 1e6, Math.round(lng * inv * 1e6) / 1e6]);
    }
    return coords;
  }

  function mapValhallaManeuver(vType) {
    switch (Number(vType)) {
      case 1:
      case 2:
      case 3:
        return { type: 'depart', modifier: 'straight' };
      case 4:
      case 5:
      case 6:
        return { type: 'arrive', modifier: '' };
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
      case 26:
      case 27:
        return { type: 'roundabout', modifier: '' };
      default:
        return { type: 'continue', modifier: 'straight' };
    }
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
        const street = (Array.isArray(m.street_names) && m.street_names.length > 0)
          ? m.street_names.join(' / ')
          : ((Array.isArray(m.begin_street_names) && m.begin_street_names[0]) || '');
        return {
          distance: Math.round((m.length || 0) * 1000),
          duration: Math.round(m.time || 0),
          name: street,
          instruction: m.instruction || '',
          maneuver: {
            type: mapped.type,
            modifier: mapped.modifier,
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
      locations: cleanPoints.map(p => ({ lat: p.lat, lon: p.lng })),
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
    const coordsStr = cleanPoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

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
      return { lat, lng };
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
  function sortWaypointsSequentially(waypoints, origin, destination, routeCoords = null) {
    if (!waypoints || waypoints.length <= 1) return waypoints || [];
    if (!origin) return waypoints;

    if (routeCoords && routeCoords.length >= 2) {
      return [...waypoints].sort((a, b) => {
        const kA = typeof a.kmFromOrigin === 'number' ? a.kmFromOrigin : calculateKmAlongRoute(a.lat, a.lng, routeCoords);
        const kB = typeof b.kmFromOrigin === 'number' ? b.kmFromOrigin : calculateKmAlongRoute(b.lat, b.lng, routeCoords);
        return kA - kB;
      });
    }

    return [...waypoints].sort((a, b) => {
      const dA = haversineDistance(origin.lat, origin.lng, a.lat, a.lng);
      const dB = haversineDistance(origin.lat, origin.lng, b.lat, b.lng);
      return dA - dB;
    });
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
        return { ...w, id: wid, originalId: w.originalId || wid };
      });
      intermediateWaypoints = preserveManualOrder
        ? sanitized
        : sortWaypointsSequentially(sanitized, origin, destination, activeRoute?.coordinates);
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

        const clonedWaypoints = intermediateWaypoints.map(w => ({ ...w }));
        let cumKm = 0;
        for (let i = 0; i < clonedWaypoints.length; i++) {
          if (routeData.legs && routeData.legs[i]) {
            cumKm += Math.round((routeData.legs[i].distance / 1000) * 10) / 10;
            clonedWaypoints[i].kmFromOrigin = Math.round(cumKm * 10) / 10;
          }
        }

        return {
          id: `route-${idx}`,
          name,
          roadName: prominentRoad || (idx === 0 ? 'Main Highway' : `Route ${idx + 1}`),
          origin,
          destination,
          waypoints: clonedWaypoints,
          distanceKm: distKm,
          durationMins: durMins,
          timeDiffMins: 0,
          geometry: routeData.geometry,
          coordinates: routeData.geometry.coordinates.map(c => [c[1], c[0]]),
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
          baseRouteOptions = allRoutes.map(r => ({ ...r, waypoints: (r.waypoints || []).map(w => ({ ...w })) }));
        }
      }

      activeRoute = allRoutes[selectedRouteIndex];
      intermediateWaypoints = activeRoute.waypoints.map(w => ({ ...w }));

      findCorridorChargers(activeRoute.coordinates);
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
    activeRoute = allRoutes[index];

    const hasOwnAutoStops = Array.isArray(activeRoute.waypoints) && activeRoute.waypoints.some(w => w.isAutoSuggested);
    if (!hasOwnAutoStops && baseRouteOptions[index]) {
      const baseManual = (baseRouteOptions[index].waypoints || []).filter(w => !w.isAutoSuggested);
      intermediateWaypoints = baseManual.map(w => ({ ...w }));
    } else {
      intermediateWaypoints = (activeRoute.waypoints || []).map(w => ({ ...w }));
    }

    findCorridorChargers(activeRoute.coordinates);
    persistTripState();
    notify();

    // Ensure the newly selected alternate route checks battery & picks a fast charger along ITS OWN corridor if needed
    await reconcileStopsForBattery(null, true);
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

        matching.push({
          ...charger,
          corridorDistanceKm: Math.round(minDistance * 10) / 10,
          kmFromOrigin: approxKmFromOrigin
        });
      }
    }

    matching.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
    corridorChargers = matching;
    return corridorChargers;
  }

  function pickAutoStopsForRoute(route, baseWaypoints = [], batState = {}) {
    if (!route || corridorChargers.length === 0) return [];

    const eff = (batState.efficiency && batState.efficiency > 0) ? batState.efficiency : 0.85;
    const minReserve = batState.safetyReservePct ?? 15;
    const startBat = batState.currentBatteryPct ?? 85;
    const targetCharge = batState.targetChargePct ?? 80;

    const firstLegSafeRange = Math.max(8, Math.round((startBat - minReserve) * eff * 10) / 10);
    const intermediateSafeRange = Math.max(12, Math.round((targetCharge - minReserve) * eff * 10) / 10);
    const totalDist = route.distanceKm;

    const existingWaypoints = [...baseWaypoints];
    const existingIds = new Set(existingWaypoints.map(w => String(w.originalId || w.id)));

    const isCompat = (c) => {
      if (window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function') {
        return window.BatteryEngine.isChargerCompatible(c).compatible;
      }
      return c.is_2w !== false;
    };

    const newlySuggested = [];
    let currentCoveredKm = 0;
    let attempts = 0;
    const maxAttempts = 25;

    while (currentCoveredKm + (attempts === 0 ? firstLegSafeRange : intermediateSafeRange) < totalDist && attempts < maxAttempts) {
      const safeRange = (attempts === 0) ? firstLegSafeRange : intermediateSafeRange;
      attempts++;

      const nextManualStop = existingWaypoints.find(w =>
        (w.network || w.type) &&
        typeof w.kmFromOrigin === 'number' &&
        w.kmFromOrigin > currentCoveredKm + 1 &&
        w.kmFromOrigin <= currentCoveredKm + safeRange
      );
      if (nextManualStop) {
        currentCoveredKm = nextManualStop.kmFromOrigin;
        continue;
      }

      const targetMinKm = currentCoveredKm + (safeRange * 0.45);
      const targetMaxKm = currentCoveredKm + (safeRange * 0.92);

      const effectiveReachOk = (c) => {
        const detourKm = (c.corridorDistanceKm || 0) * 2.0;
        return (c.kmFromOrigin - currentCoveredKm + detourKm) <= safeRange;
      };

      let candidates = corridorChargers.filter(c =>
        matchesRouteFilters(c) &&
        isCompat(c) &&
        !existingIds.has(String(c.id)) &&
        !newlySuggested.some(w => w.id === c.id) &&
        c.kmFromOrigin >= targetMinKm &&
        c.kmFromOrigin <= targetMaxKm &&
        effectiveReachOk(c)
      );

      if (candidates.length === 0) {
        candidates = corridorChargers.filter(c =>
          matchesRouteFilters(c) &&
          isCompat(c) &&
          !existingIds.has(String(c.id)) &&
          !newlySuggested.some(w => w.id === c.id) &&
          c.kmFromOrigin > currentCoveredKm + 4 &&
          effectiveReachOk(c)
        );
      }

      if (candidates.length === 0) {
        const forward = corridorChargers.filter(c =>
          matchesRouteFilters(c) &&
          isCompat(c) &&
          !existingIds.has(String(c.id)) &&
          !newlySuggested.some(w => w.id === c.id) &&
          c.kmFromOrigin > currentCoveredKm
        );
        if (forward.length === 0) break;
        forward.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
        candidates = [forward[0]];
      }

      candidates.sort((a, b) => {
        const netBonus = (c) => {
          if (c.network === 'ATHER_GRID' || c.network === 'VIDA_GRID') return 28;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST') return 20;
          return 0;
        };
        const scoreA = ((a.kmFromOrigin - currentCoveredKm) * 1.4) + netBonus(a) - (a.corridorDistanceKm * 4.5);
        const scoreB = ((b.kmFromOrigin - currentCoveredKm) * 1.4) + netBonus(b) - (b.corridorDistanceKm * 4.5);
        return scoreB - scoreA;
      });

      const selected = candidates[0];
      newlySuggested.push({ ...selected, isAutoSuggested: true });
      currentCoveredKm = selected.kmFromOrigin;
    }

    return newlySuggested;
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
        (s.type === 'CHARGER_STOP' || s.type === 'CUSTOM_STOP' || s.type === 'DESTINATION') &&
        s.arrivalSoC < minReserve
      );
      if (!hasUnsafeNode) {
        return [];
      }
    }

    const existingWaypoints = [...intermediateWaypoints];
    const newlySuggested = pickAutoStopsForRoute(activeRoute, existingWaypoints, batState);

    if (newlySuggested.length > 0) {
      const merged = [...existingWaypoints, ...newlySuggested];
      intermediateWaypoints = sortWaypointsSequentially(merged, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      await calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, true, {
        preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
        optionIndex: selectedRouteIndex
      });
    }

    return newlySuggested;
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
        (s.type === 'CHARGER_STOP' || s.type === 'CUSTOM_STOP' || s.type === 'DESTINATION') &&
        s.arrivalSoC < minReserve
      ));

      const isDriving = Boolean(window.DriveEngine && window.DriveEngine.isActive() && liveUserCoords);
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

      const manualStops = intermediateWaypoints.filter(w =>
        !w.isAutoSuggested && (!isDriving || typeof w.kmFromOrigin !== 'number' || w.kmFromOrigin > traversedKm + 0.3)
      );
      const hasAutoStops = intermediateWaypoints.some(w => w.isAutoSuggested);

      if (!hasUnsafeNode && !hasAutoStops && !forceEvaluate) {
        return false;
      }

      let desired = [...manualStops];
      const directArrival = startBat - (remainingDistKm / eff);

      // Zero-cost instant restore of uncharged base route option when battery/efficiency now covers the trip
      if (!isDriving && manualStops.length === 0 && directArrival >= minReserve && hasAutoStops && baseRouteOptions[selectedRouteIndex]) {
        const cleanBase = baseRouteOptions[selectedRouteIndex];
        allRoutes[selectedRouteIndex] = { ...cleanBase, waypoints: [] };
        refreshRouteTimeDiffs(allRoutes);
        activeRoute = allRoutes[selectedRouteIndex];
        intermediateWaypoints = [];
        findCorridorChargers(activeRoute.coordinates);
        persistTripState();
        notify();
        return true;
      }

      if (manualStops.length > 0 || directArrival < minReserve) {
        const simRoute = isDriving
          ? {
              ...activeRoute,
              distanceKm: remainingDistKm,
              origin: routeOriginForReplan
            }
          : activeRoute;

        const baseForSim = manualStops.map(w => ({
          ...w,
          kmFromOrigin: typeof w.kmFromOrigin === 'number' ? Math.max(0.5, w.kmFromOrigin - traversedKm) : w.kmFromOrigin
        }));
        const shiftedCorridor = isDriving
          ? corridorChargers.map(c => ({ ...c, kmFromOrigin: (c.kmFromOrigin || 0) - traversedKm })).filter(c => c.kmFromOrigin > 0.5)
          : null;

        const origCorridor = corridorChargers;
        if (shiftedCorridor) corridorChargers = shiftedCorridor;
        const neededAuto = pickAutoStopsForRoute(simRoute, baseForSim, batState);
        if (shiftedCorridor) corridorChargers = origCorridor;

        if (hasUnsafeNode || (hasAutoStops && neededAuto.length > 0)) {
          desired = sortWaypointsSequentially(
            [...manualStops, ...neededAuto],
            routeOriginForReplan,
            activeRoute.destination,
            activeRoute.coordinates
          );
        } else if (hasAutoStops && neededAuto.length === 0 && !hasUnsafeNode) {
          desired = [...manualStops];
        } else {
          desired = [...intermediateWaypoints];
        }
      }

      const normIds = (arr) => arr.map(w => String(w.originalId || w.id)).join('|');
      if (normIds(desired) === normIds(intermediateWaypoints)) {
        return false;
      }

      await calculateRoute(routeOriginForReplan, activeRoute.destination, desired, true, {
        preserveOtherOptions: !isDriving && (allRoutes.length > 1 || baseRouteOptions.length > 1),
        optionIndex: selectedRouteIndex
      });
      return true;
    } catch (e) {
      return false;
    } finally {
      isReconcilingBatteryStops = false;
    }
  }

  function addWaypoint(charger) {
    if (!charger) return false;
    const baseId = charger.originalId || charger.id || `stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const alreadyExists = intermediateWaypoints.some(w => String(w.originalId || w.id) === String(baseId));

    if (alreadyExists) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`⚡ ${charger.name || 'Charger'} is already added as a stop`);
      }
      return false;
    }

    if (window.BatteryEngine && typeof window.BatteryEngine.isChargerCompatible === 'function') {
      const compat = window.BatteryEngine.isChargerCompatible(charger);
      if (!compat.compatible && window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`⚠️ Note: ${compat.reason}`);
      }
    }

    const stopObj = { ...charger, originalId: baseId, id: baseId };
    delete stopObj.kmFromOrigin;

    if (activeRoute && activeRoute.coordinates) {
      intermediateWaypoints.push(stopObj);
      intermediateWaypoints = sortWaypointsSequentially(intermediateWaypoints, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, false, {
        preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
        optionIndex: selectedRouteIndex
      });
    } else {
      intermediateWaypoints.push(stopObj);
      persistTripState();
      notify();
    }
    return true;
  }

  function removeWaypoint(target) {
    if (target === undefined || target === null || target === '') return;

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

    if (typeof target === 'number' && target >= 0 && target < intermediateWaypoints.length) {
      intermediateWaypoints.splice(target, 1);
    } else {
      intermediateWaypoints = intermediateWaypoints.filter(w => !matchFn(w));
    }
    intermediateWaypoints.forEach(w => { delete w.kmFromOrigin; });

    if (Array.isArray(baseRouteOptions)) {
      baseRouteOptions.forEach(opt => {
        if (Array.isArray(opt.waypoints)) {
          if (typeof target === 'number' && target >= 0 && target < opt.waypoints.length) {
            opt.waypoints.splice(target, 1);
          } else {
            opt.waypoints = opt.waypoints.filter(w => !matchFn(w));
          }
        }
      });
    }

    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints, false, {
        preserveOtherOptions: allRoutes.length > 1 || baseRouteOptions.length > 1,
        optionIndex: selectedRouteIndex
      }).catch(err => {
        console.warn('[VoltWay Router] Recalculate after remove waypoint note:', err);
      });
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

  function calculateTripTimeline(route, batteryState) {
    if (!route) return null;
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

    const waypoints = route.waypoints || [];
    const legs = route.legs || [];
    const timeline = [];

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

    if (waypoints.length === 0) {
      const usedPct = Math.round((route.distanceKm / eff) * 10) / 10;
      const arrivalSoC = Math.round((currentSoC - usedPct) * 10) / 10;

      timeline.push({
        type: 'LEG',
        distanceKm: route.distanceKm,
        durationMins: route.durationMins,
        batteryUsedPct: usedPct
      });

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
        totalDrivingMins: route.durationMins,
        totalChargingMins: 0,
        totalTripDurationMins: route.durationMins,
        totalChargingStops: 0,
        totalEnergyChargedPct: 0,
        finalArrivalSoC: arrivalSoC,
        targetChargePct: targetCharge
      };
    }

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const legDist = (legs[i] && legs[i].distance) ? Math.round((legs[i].distance / 1000) * 10) / 10 : Math.round((route.distanceKm / (waypoints.length + 1)) * 10) / 10;
      const legDur = (legs[i] && legs[i].duration) ? Math.round(legs[i].duration / 60) : Math.round(legDist * 1.8);
      const batUsed = Math.round((legDist / eff) * 10) / 10;
      const arrivalSoC = Math.round((currentSoC - batUsed) * 10) / 10;
      const isSafeArrival = arrivalSoC >= minReserve;
      const isCriticalArrival = arrivalSoC < 0;

      let nextLegDist = 0;
      let nextStopName = 'Destination';
      if (i + 1 < waypoints.length) {
        nextLegDist = (legs[i + 1] && legs[i + 1].distance) ? Math.round((legs[i + 1].distance / 1000) * 10) / 10 : Math.round((route.distanceKm / (waypoints.length + 1)) * 10) / 10;
        nextStopName = waypoints[i + 1].name || `Stop ${String.fromCharCode(66 + i + 1)}`;
      } else {
        const lastIdx = waypoints.length;
        nextLegDist = (legs[lastIdx] && legs[lastIdx].distance) ? Math.round((legs[lastIdx].distance / 1000) * 10) / 10 : Math.round((route.distanceKm / (waypoints.length + 1)) * 10) / 10;
        nextStopName = route.destination?.name || 'Destination';
      }

      const nextLegBatUsed = Math.round((nextLegDist / eff) * 10) / 10;
      const minDepartureNeeded = Math.ceil(nextLegBatUsed + minReserve);

      timeline.push({
        type: 'LEG',
        distanceKm: legDist,
        durationMins: legDur,
        batteryUsedPct: batUsed
      });

      const isCharger = !!(wp.network || wp.type);

      if (isCharger) {
        const isFast = wp.network === 'ATHER_GRID' || wp.network === 'VIDA_GRID' || wp.type === 'FAST';
        const maxChargerCeiling = isFast ? targetCharge : 100;
        const effectiveArrival = Math.max(0, arrivalSoC);

        const optimalTargetSoC = Math.min(maxChargerCeiling, Math.max(Math.ceil(effectiveArrival), minDepartureNeeded));
        const optimalChargeNeededPct = Math.max(0, Math.round((optimalTargetSoC - effectiveArrival) * 10) / 10);
        const optimalChargeTimeMins = computeChargingDuration(optimalChargeNeededPct, effectiveArrival, isFast, wp.power_kw, batState.vehicleDetails);

        const fullTargetSoC = Math.min(maxChargerCeiling, Math.max(targetCharge, optimalTargetSoC));
        const fullChargeNeededPct = Math.max(0, Math.round((fullTargetSoC - effectiveArrival) * 10) / 10);
        const fullChargeTimeMins = computeChargingDuration(fullChargeNeededPct, effectiveArrival, isFast, wp.power_kw, batState.vehicleDetails);

        const timeSavedMins = Math.max(0, fullChargeTimeMins - optimalChargeTimeMins);

        const batCap = (batState.vehicleDetails && batState.vehicleDetails.batteryCapacity) || 3.7;
        const activeTargetSoC = currentTimelineMode === 'optimal' ? optimalTargetSoC : fullTargetSoC;
        const activeChargeNeeded = currentTimelineMode === 'optimal' ? optimalChargeNeededPct : fullChargeNeededPct;
        const activeChargeTime = currentTimelineMode === 'optimal' ? optimalChargeTimeMins : fullChargeTimeMins;
        const unitsActiveKWh = Math.round(((activeChargeNeeded / 100) * batCap) * 100) / 100;

        let smartAdvice = '';
        if (isFast && minDepartureNeeded > maxChargerCeiling) {
          const estArrival = Math.round((maxChargerCeiling - nextLegBatUsed) * 10) / 10;
          if (estArrival >= 0) {
            smartAdvice = `Target ceiling ${maxChargerCeiling}%. Next leg is ${nextLegDist} km to ${nextStopName}, arriving with est. ~${estArrival}% SoC.`;
          } else {
            const shortKm = Math.round(Math.abs(estArrival) * eff * 10) / 10;
            smartAdvice = `⚠️ Range Gap: Next leg is ${nextLegDist} km to ${nextStopName}. Even at ${maxChargerCeiling}%, est. short by ~${shortKm} km — raise charge target to 95–100% or switch to ECO mode.`;
          }
        } else if (optimalTargetSoC < fullTargetSoC) {
          smartAdvice = `Next leg is ${nextLegDist} km to ${nextStopName}. Fast-hop charge to ${optimalTargetSoC}% saves ~${timeSavedMins} min (keeps ${minReserve}% reserve).`;
        } else {
          smartAdvice = `Next leg is ${nextLegDist} km to ${nextStopName}. Charge to ${optimalTargetSoC}% for safe arrival.`;
        }

        totalChargingTimeMins += activeChargeTime;
        totalEnergyChargedPct += activeChargeNeeded;

        timeline.push({
          type: 'CHARGER_STOP',
          index: i + 1,
          station: wp,
          isFast,
          arrivalSoC,
          isSafeArrival,
          isCriticalArrival,
          nextLegDist,
          nextStopName,
          optimalTargetSoC,
          optimalChargeNeededPct,
          optimalChargeTimeMins,
          fullTargetSoC,
          fullChargeNeededPct,
          fullChargeTimeMins,
          timeSavedMins,
          unitsKWh: unitsActiveKWh,
          smartAdvice,
          targetChargeSoC: targetCharge,
          chargeNeededPct: activeChargeNeeded,
          chargeTimeMins: activeChargeTime,
          departureSoC: activeTargetSoC
        });

        currentSoC = activeTargetSoC;
      } else {
        timeline.push({
          type: 'CUSTOM_STOP',
          index: i + 1,
          name: wp.name || `Intermediate Stop ${i + 1}`,
          point: wp,
          arrivalSoC,
          isSafeArrival,
          isCriticalArrival,
          nextLegDist,
          nextStopName,
          departureSoC: arrivalSoC
        });
        currentSoC = arrivalSoC;
      }
    }

    const lastLegIdx = waypoints.length;
    const finalLegDist = (legs[lastLegIdx] && legs[lastLegIdx].distance) ? Math.round((legs[lastLegIdx].distance / 1000) * 10) / 10 : Math.round((route.distanceKm / (waypoints.length + 1)) * 10) / 10;
    const finalLegDur = (legs[lastLegIdx] && legs[lastLegIdx].duration) ? Math.round(legs[lastLegIdx].duration / 60) : Math.round(finalLegDist * 1.8);
    const finalBatUsed = Math.round((finalLegDist / eff) * 10) / 10;
    const destArrivalSoC = Math.round((currentSoC - finalBatUsed) * 10) / 10;

    timeline.push({
      type: 'LEG',
      distanceKm: finalLegDist,
      durationMins: finalLegDur,
      batteryUsedPct: finalBatUsed
    });

    timeline.push({
      type: 'DESTINATION',
      name: route.destination?.name || 'Destination',
      lat: route.destination?.lat,
      lng: route.destination?.lng,
      arrivalSoC: destArrivalSoC,
      isSafe: destArrivalSoC >= minReserve,
      isCritical: destArrivalSoC < 0
    });

    return {
      timeline,
      totalDrivingMins: route.durationMins,
      totalChargingMins: totalChargingTimeMins,
      totalTripDurationMins: route.durationMins + totalChargingTimeMins,
      totalChargingStops: waypoints.filter(w => w.network || w.type).length,
      totalEnergyChargedPct: Math.round(totalEnergyChargedPct * 10) / 10,
      finalArrivalSoC: destArrivalSoC,
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
    lastSnappedSegmentIndex = 0;
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
    setTimelineMode,
    getTimelineMode,
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
    getOrigin: () => currentOrigin || (activeRoute && activeRoute.origin),
    getDestination: () => currentDestination || (activeRoute && activeRoute.destination)
  };
})();

window.RouteEngine = RouteEngine;

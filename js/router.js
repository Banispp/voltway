/**
 * VoltWay 2W - OSRM Route Engine & Multi-Route Selection
 * 100% Free Open-Source Routing Machine with Google Maps Style Alternative Routes Selection
 * and Interactive Charger Waypoint Trip Planning
 */

const RouteEngine = (function () {
  let allRoutes = []; // Array of { id, name, distanceKm, durationMins, coordinates, geometry, legs }
  let selectedRouteIndex = 0;
  let activeRoute = null;
  let currentOrigin = null;
  let currentDestination = null;
  let corridorChargers = [];
  let intermediateWaypoints = []; // [charger1, charger2, ...]

  const OSRM_PUBLIC_API = 'https://router.project-osrm.org/route/v1/driving';

  // Route Planner Charger Filter State (Controls corridor search & auto charging stops)
  const routeFilters = {
    atherFast: true,
    vidaFast: true,
    boltFast: true,
    boltSlow: true
  };

  // Route Corridor Buffer Distance in km (User configurable: 2, 5, 10, 15, 25, or 'all')
  let corridorBufferKm = 5;

  // Timeline charging calculation mode: 'optimal' (Fast Travel) vs 'target' (Full Limit)
  let currentTimelineMode = 'optimal';

  // Listeners
  const listeners = [];

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function notify() {
    listeners.forEach(fn => fn({
      route: activeRoute,
      allRoutes,
      selectedRouteIndex,
      corridorChargers,
      waypoints: intermediateWaypoints,
      timelineMode: currentTimelineMode,
      corridorBufferKm
    }));
  }

  function setCorridorBufferKm(km) {
    if (km === 'all' || km === 0 || km === null) {
      corridorBufferKm = 'all';
    } else {
      corridorBufferKm = Number(km) || 5;
    }
    if (activeRoute && activeRoute.coordinates) {
      findCorridorChargers(activeRoute.coordinates, corridorBufferKm);
      notify();
      if (window.MapEngine && window.MapEngine.renderChargers) {
        window.MapEngine.renderChargers();
      }
    }
  }

  function getCorridorBufferKm() {
    return corridorBufferKm;
  }

  /**
   * Calculates perpendicular distance from a given [lat, lng] to the active route polyline (in km).
   */
  function getDistanceToActiveRoute(lat, lng) {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) return null;

    // Check if charger is already in precomputed corridorChargers
    const existing = corridorChargers.find(c => Math.abs(c.lat - lat) < 0.0001 && Math.abs(c.lng - lng) < 0.0001);
    if (existing && existing.corridorDistanceKm != null) {
      return existing.corridorDistanceKm;
    }

    const coords = activeRoute.coordinates;
    const p = [lat, lng];
    let minDistance = Infinity;
    for (let s = 0; s < coords.length - 1; s++) {
      const res = distToSegment(p, coords[s], coords[s + 1]);
      if (res.distance < minDistance) {
        minDistance = res.distance;
      }
      if (minDistance <= 0.05) break;
    }
    return minDistance === Infinity ? null : Math.round(minDistance * 10) / 10;
  }

  let lastSnappedSegmentIndex = 0;

  /**
   * Slices active route at rider's current position for real-time traversed route trimming & road matching.
   * Returns:
   * - remainingCoords: array of [lat, lng] from snapped position forward to destination.
   * - traversedCoords: array of [lat, lng] from start up to snapped position.
   * - snappedPoint: [lat, lng] projected onto centerline of closest road segment.
   * - distanceFromRouteKm: perpendicular distance to road segment (km).
   * - segmentBearing: forward heading of current road segment (0-360 deg).
   * - closestSegmentIndex: index of current segment.
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

    // Search forward from near the last known segment index to prevent jumping back
    const startIdx = Math.max(0, lastSnappedSegmentIndex - 2);
    for (let s = startIdx; s < coords.length - 1; s++) {
      const res = distToSegment(p, coords[s], coords[s + 1]);
      if (res.distance < minDistance) {
        minDistance = res.distance;
        closestIndex = s;
        closestT = res.t;
      }
    }

    // Fallback if off-route (> 55m), search the earlier segments
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
    const snappedLat = v[0] + closestT * (w[0] - v[0]);
    const snappedLng = v[1] + closestT * (w[1] - v[1]);
    const snappedPoint = [snappedLat, snappedLng];

    // Calculate segment forward bearing (direction of travel along the street)
    const dLat = (w[0] - v[0]) * Math.PI / 180;
    const dLng = (w[1] - v[1]) * Math.PI / 180;
    const lat1 = v[0] * Math.PI / 180;
    const lat2 = w[0] * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const segmentBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    // Remaining coordinates forward to destination (starting from snapped rider position)
    const remainingCoords = [snappedPoint, ...coords.slice(closestIndex + 1)];

    // Traversed coordinates behind rider (starting from origin up to snapped rider position)
    const traversedCoords = [...coords.slice(0, closestIndex + 1), snappedPoint];

    return {
      remainingCoords,
      traversedCoords,
      snappedPoint,
      distanceFromRouteKm: minDistance,
      segmentBearing,
      closestSegmentIndex: closestIndex
    };
  }

  function setTimelineMode(mode) {
    if (mode === 'optimal' || mode === 'target') {
      currentTimelineMode = mode;
      notify();
    }
  }

  function getTimelineMode() {
    return currentTimelineMode;
  }

  /**
   * Distance between two lat/lng points using Haversine formula (km)
   */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculates perpendicular distance from a point to a line segment (km)
   * with latitude-dependent longitude scaling for 100% metric geometric accuracy.
   * Returns { distance, t } where t in [0, 1] is the projection fraction.
   */
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

  /**
   * Helper to extract prominent highway or street name from OSRM steps
   */
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

  /**
   * Accurately calculate charging duration for a given percentage and station type
   * Unified with Utilities physics model
   */
  function computeChargingDuration(chargeNeededPct, currentArrivalSoC, isFast) {
    if (window.Utilities && window.Utilities.computeChargingDuration) {
      return window.Utilities.computeChargingDuration(chargeNeededPct, currentArrivalSoC, isFast);
    }
    if (chargeNeededPct <= 0) return 0;
    if (isFast) {
      const startSoC = Math.max(0, currentArrivalSoC);
      const endSoC = Math.min(100, startSoC + chargeNeededPct);
      const upTo80 = Math.max(0, Math.min(80, endSoC) - Math.min(80, startSoC));
      const above80 = Math.max(0, endSoC - Math.max(80, startSoC));
      return Math.round((upTo80 / 1.5) + (above80 / 0.55));
    } else {
      return Math.round(chargeNeededPct / 0.33);
    }
  }

  /**
   * Helper to fetch an OSRM route for an array of points
   */
  async function fetchOsrmRaw(points) {
    const coordsStr = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `${OSRM_PUBLIC_API}/${coordsStr}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`OSRM HTTP ${resp.status}`);
    const data = await resp.json();
    return data.routes || [];
  }

  /**
   * Fetch driving route with Multiple Alternative Routes (Google Maps Style)
   */
  async function calculateRoute(origin, destination, manualWaypoints = null) {
    if (!origin || !destination) {
      throw new Error('Origin and destination are required');
    }

    currentOrigin = origin;
    currentDestination = destination;
    lastSnappedSegmentIndex = 0;

    if (manualWaypoints !== null) {
      intermediateWaypoints = sortWaypointsSequentially(manualWaypoints, origin, destination, activeRoute?.coordinates);
    }

    const points = [origin, ...intermediateWaypoints, destination];
    allRoutes = [];
    selectedRouteIndex = 0;

    try {
      const primaryRoutes = await fetchOsrmRaw(points);
      if (!primaryRoutes || primaryRoutes.length === 0) {
        throw new Error('No driving route found');
      }

      // 1. Process routes returned by OSRM
      primaryRoutes.forEach((routeData, idx) => {
        const distKm = Math.round((routeData.distance / 1000) * 10) / 10;
        const durMins = Math.round(routeData.duration / 60);
        const prominentRoad = extractMainRoadName(routeData.legs);
        const roadLabel = prominentRoad ? `via ${prominentRoad}` : (idx === 0 ? 'Main Highway' : `Route ${idx + 1}`);
        const name = idx === 0 ? `${roadLabel} (Fastest)` : `${roadLabel} (${distKm} km)`;

        allRoutes.push({
          id: `route-${idx}`,
          name,
          roadName: prominentRoad || (idx === 0 ? 'Fastest Highway' : `Route ${idx + 1}`),
          origin,
          destination,
          waypoints: [...intermediateWaypoints],
          distanceKm: distKm,
          durationMins: durMins,
          timeDiffMins: 0,
          geometry: routeData.geometry,
          coordinates: routeData.geometry.coordinates.map(c => [c[1], c[0]]),
          legs: routeData.legs || [],
          isPrimary: idx === 0
        });
      });

      // 2. Generate Google Maps Style Alternative Corridors for any trip >= 1.5 km
      const directDist = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
      if (allRoutes.length < 3 && directDist >= 1.5 && intermediateWaypoints.length === 0) {
        try {
          const midLat = (origin.lat + destination.lat) / 2;
          const midLng = (origin.lng + destination.lng) / 2;
          const dLat = destination.lat - origin.lat;
          const dLng = destination.lng - origin.lng;
          const degDist = Math.sqrt(dLat * dLat + dLng * dLng);

          // Perpendicular offset vector
          const perpLat = -dLng / degDist;
          const perpLng = dLat / degDist;

          // Adaptive offsets: for urban trips use 0.08, for longer highway trips use 0.11
          const factorA = directDist > 25 ? 0.11 : 0.08;
          const factorB = directDist > 25 ? -0.11 : -0.08;

          const altMid1 = { lat: Math.round((midLat + perpLat * degDist * factorA) * 1000000) / 1000000, lng: Math.round((midLng + perpLng * degDist * factorA) * 1000000) / 1000000 };
          const altMid2 = { lat: Math.round((midLat + perpLat * degDist * factorB) * 1000000) / 1000000, lng: Math.round((midLng + perpLng * degDist * factorB) * 1000000) / 1000000 };

          const candidates = [altMid1, altMid2];
          const results = await Promise.allSettled(candidates.map(m => fetchOsrmRaw([origin, m, destination])));

          results.forEach((res, rIdx) => {
            if (res.status === 'fulfilled' && res.value && res.value.length > 0) {
              const rData = res.value[0];
              const distKm = Math.round((rData.distance / 1000) * 10) / 10;
              const durMins = Math.round(rData.duration / 60);

              // Avoid duplicates (allow distinct routes with >= 0.2 km or >= 1 min difference)
              const isDuplicate = allRoutes.some(existing => 
                Math.abs(existing.distanceKm - distKm) < 0.25 && Math.abs(existing.durationMins - durMins) < 1
              );

              if (!isDuplicate && allRoutes.length < 3) {
                const prominentRoad = extractMainRoadName(rData.legs);
                const roadLabel = prominentRoad ? `via ${prominentRoad}` : (rIdx === 0 ? 'via Arterial Bypass' : 'via Alternate Highway');
                const diffMins = durMins - allRoutes[0].durationMins;
                const timeDiffStr = diffMins > 0 ? `+${diffMins} min` : `${durMins} min`;

                allRoutes.push({
                  id: `route-alt-${rIdx + 1}`,
                  name: `${roadLabel} (${timeDiffStr})`,
                  roadName: prominentRoad || (rIdx === 0 ? 'Arterial Bypass' : 'Alternate Highway'),
                  origin,
                  destination,
                  waypoints: [...intermediateWaypoints],
                  distanceKm: distKm,
                  durationMins: durMins,
                  timeDiffMins: diffMins,
                  geometry: rData.geometry,
                  coordinates: rData.geometry.coordinates.map(c => [c[1], c[0]]),
                  legs: rData.legs || [],
                  isPrimary: false
                });
              }
            }
          });
        } catch (altErr) {
          console.warn('Could not generate synthetic alternative route:', altErr);
        }
      }

      selectedRouteIndex = 0;
      activeRoute = allRoutes[0];

      // Discover chargers along the selected route corridor
      findCorridorChargers(activeRoute.coordinates);

      // Precompute exact kmFromOrigin for all intermediate waypoints along the route polyline
      if (intermediateWaypoints.length > 0 && activeRoute.coordinates) {
        intermediateWaypoints.forEach(wp => {
          wp.kmFromOrigin = calculateKmAlongRoute(wp.lat, wp.lng, activeRoute.coordinates);
        });
        intermediateWaypoints.sort((a, b) => (a.kmFromOrigin || 0) - (b.kmFromOrigin || 0));
      }

      notify();
      return activeRoute;
    } catch (err) {
      console.error('OSRM route calculation error:', err);
      // Fallback: create straight-line route estimate if offline
      const directDist = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
      const estRoadDist = Math.round(directDist * 1.25 * 10) / 10;
      activeRoute = {
        id: 'route-fallback',
        name: 'Estimated Direct Route',
        roadName: 'Direct Road',
        origin,
        destination,
        waypoints: [...intermediateWaypoints],
        distanceKm: estRoadDist,
        durationMins: Math.round(estRoadDist * 2),
        timeDiffMins: 0,
        geometry: {
          type: 'LineString',
          coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]]
        },
        coordinates: [[origin.lat, origin.lng], [destination.lat, destination.lng]],
        isFallback: true
      };

      allRoutes = [activeRoute];
      selectedRouteIndex = 0;

      findCorridorChargers(activeRoute.coordinates);
      notify();
      return activeRoute;
    }
  }

  /**
   * User selects one of the alternative routes (Google Maps Style)
   */
  async function selectRoute(index) {
    if (index < 0 || index >= allRoutes.length) return;
    selectedRouteIndex = index;
    activeRoute = allRoutes[index];
    findCorridorChargers(activeRoute.coordinates);
    notify();

    // If selected route exceeds safe range and has no manual waypoints, auto-suggest charging stops along it
    const batState = window.BatteryEngine ? window.BatteryEngine.getState() : null;
    if (batState && intermediateWaypoints.length === 0) {
      const evalMetrics = window.BatteryEngine.evaluateTrip(activeRoute.distanceKm);
      if (evalMetrics && evalMetrics.status !== 'SAFE') {
        await autoSuggestChargingStops(evalMetrics);
      }
    }
  }

  /**
   * Identifies all compatible 2W chargers within corridorDistanceKm of the route polyline.
   * Uses adaptive corridor width: 4.5 km for intercity highway routes (>40 km) to capture
   * chargers near bypasses/town entries, and 3.0 km for urban trips.
   */
  function findCorridorChargers(routeCoords, maxCorridorKm = null) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const matching = [];

    if (!routeCoords || routeCoords.length < 2 || !allChargers || allChargers.length === 0) {
      corridorChargers = [];
      return [];
    }

    const requestedBuffer = (maxCorridorKm != null) ? maxCorridorKm : corridorBufferKm;
    const isAll = requestedBuffer === 'all' || requestedBuffer === 0;
    const effectiveMaxCorridorKm = isAll ? 50.0 : Number(requestedBuffer || 5);

    // Precompute cumulative Haversine distance along route coordinates
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

    // Bounding box filter for quick rejection
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (let i = 0; i < routeCoords.length; i++) {
      const lat = routeCoords[i][0];
      const lng = routeCoords[i][1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    const degBuffer = effectiveMaxCorridorKm > 15 ? 0.35 : (effectiveMaxCorridorKm > 8 ? 0.2 : (effectiveMaxCorridorKm > 3 ? 0.08 : 0.04));
    minLat -= degBuffer;
    maxLat += degBuffer;
    minLng -= degBuffer;
    maxLng += degBuffer;

    const candidates = allChargers.filter(c => {
      if (c.lat < minLat || c.lat > maxLat || c.lng < minLng || c.lng > maxLng) return false;
      // Filter according to Route Planner Preferences
      if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
      if (c.network === 'VIDA_GRID' && !routeFilters.vidaFast) return false;
      if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
      if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
      return true;
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

  /**
   * Automatically suggests optimal charging stops along the route if distance > safe battery range.
   * Handles multi-hundred-kilometer intercity journeys with intelligent gap recovery,
   * adaptive corridor search, and forward-progress candidate ranking.
   */
  async function autoSuggestChargingStops(batteryEvaluation) {
    if (!activeRoute || !batteryEvaluation) return [];

    const batState = window.BatteryEngine ? window.BatteryEngine.getState() : {};
    const eff = batState.efficiency || 0.85;
    const minReserve = batState.safetyReservePct || 15;
    const startBat = batState.currentBatteryPct || 85;
    const targetCharge = batState.targetChargePct || 80;

    // First leg safe range based on current starting battery SoC
    const firstLegSafeRange = Math.max(15, Math.round((startBat - minReserve) * eff * 10) / 10);
    // Intermediate legs safe range based on charging to target limit (e.g. 80%)
    const intermediateSafeRange = Math.max(20, Math.round((targetCharge - minReserve) * eff * 10) / 10);

    const totalDist = activeRoute.distanceKm;

    if (totalDist <= firstLegSafeRange || corridorChargers.length === 0) {
      return [];
    }

    // Preserve any existing custom stops added by user
    const existingCustomStops = intermediateWaypoints.filter(w => !w.network && !w.type);

    const suggestedWaypoints = [];
    let currentCoveredKm = 0;
    let attempts = 0;
    const maxAttempts = 35; // Supports up to 1,000+ km cross-state journeys

    while (currentCoveredKm + (attempts === 0 ? firstLegSafeRange : intermediateSafeRange) < totalDist && attempts < maxAttempts) {
      const safeRange = (attempts === 0) ? firstLegSafeRange : intermediateSafeRange;
      attempts++;

      // Ideal target zone: between 45% and 95% of safe range ahead of current covered km
      const targetMinKm = currentCoveredKm + (safeRange * 0.45);
      const targetMaxKm = currentCoveredKm + (safeRange * 0.95);

      // 1. Ideal zone candidates (45% - 95% of safe range)
      let candidates = corridorChargers.filter(c => {
        if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
        if (c.network === 'VIDA_GRID' && !routeFilters.vidaFast) return false;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
        return c.kmFromOrigin >= targetMinKm &&
               c.kmFromOrigin <= targetMaxKm &&
               !suggestedWaypoints.some(w => w.id === c.id);
      });

      // 2. Fallback zone: any charger between currentCoveredKm + 8km and currentCoveredKm + safeRange
      if (candidates.length === 0) {
        candidates = corridorChargers.filter(c => {
          if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
          if (c.network === 'VIDA_GRID' && !routeFilters.vidaFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
          return c.kmFromOrigin > currentCoveredKm + 8 &&
                 c.kmFromOrigin <= currentCoveredKm + safeRange &&
                 !suggestedWaypoints.some(w => w.id === c.id);
        });
      }

      // 3. Gap Recovery: If there is a charging desert / ghat stretch where no charger exists in ideal zone:
      if (candidates.length === 0) {
        const forwardChargers = corridorChargers.filter(c => {
          if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
          if (c.network === 'VIDA_GRID' && !routeFilters.vidaFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
          return c.kmFromOrigin > currentCoveredKm &&
                 !suggestedWaypoints.some(w => w.id === c.id);
        });

        if (forwardChargers.length === 0) {
          // No more chargers exist between here and the destination
          break;
        }

        // Check if any charger exists within safe range (e.g. final top-up station before mountain pass)
        const reachableForward = forwardChargers.filter(c => c.kmFromOrigin <= currentCoveredKm + safeRange);
        if (reachableForward.length > 0) {
          // Pick the furthest reachable charger to make maximum forward progress
          reachableForward.sort((a, b) => b.kmFromOrigin - a.kmFromOrigin);
          candidates = [reachableForward[0]];
        } else {
          // True gap: all forward chargers are beyond safeRange. Pick the first one just beyond the gap.
          forwardChargers.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
          candidates = [forwardChargers[0]];
        }
      }

      // Rank candidates: prioritize furthest forward progress along the route, balanced with network priority and low detour
      candidates.sort((a, b) => {
        const getNetScore = (c) => {
          if (c.network === 'ATHER_GRID') return 30;
          if (c.network === 'VIDA_GRID') return 30;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST') return 20;
          return 0; // 15A socket
        };

        const scoreA = ((a.kmFromOrigin - currentCoveredKm) * 1.5) + getNetScore(a) - (a.corridorDistanceKm * 3.5);
        const scoreB = ((b.kmFromOrigin - currentCoveredKm) * 1.5) + getNetScore(b) - (b.corridorDistanceKm * 3.5);
        return scoreB - scoreA;
      });

      const selected = candidates[0];
      suggestedWaypoints.push(selected);
      currentCoveredKm = selected.kmFromOrigin;
    }

    if (suggestedWaypoints.length > 0) {
      // Merge custom stops and suggested chargers in order along the route
      const merged = [...existingCustomStops, ...suggestedWaypoints];
      intermediateWaypoints = sortWaypointsSequentially(merged, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      await calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    }

    return suggestedWaypoints;
  }

  /**
   * Sorts intermediate waypoints in forward geometric sequence from origin to destination.
   * If route polyline is available, uses precise road distance; otherwise projects onto direct vector.
   */
  function sortWaypointsSequentially(waypoints, origin, destination, routeCoords = null) {
    if (!waypoints || waypoints.length <= 1) return waypoints || [];

    if (routeCoords && routeCoords.length >= 2) {
      return [...waypoints].sort((a, b) => {
        const kmA = (a.kmFromOrigin != null) ? a.kmFromOrigin : calculateKmAlongRoute(a.lat, a.lng, routeCoords);
        const kmB = (b.kmFromOrigin != null) ? b.kmFromOrigin : calculateKmAlongRoute(b.lat, b.lng, routeCoords);
        a.kmFromOrigin = kmA;
        b.kmFromOrigin = kmB;
        return kmA - kmB;
      });
    }

    if (!origin || !destination) return waypoints;

    // Direct vector projection sorting
    const dLat = destination.lat - origin.lat;
    const dLng = destination.lng - origin.lng;
    const lenSq = dLat * dLat + dLng * dLng || 1;

    return [...waypoints].sort((a, b) => {
      const projA = ((a.lat - origin.lat) * dLat + (a.lng - origin.lng) * dLng) / lenSq;
      const projB = ((b.lat - origin.lat) * dLat + (b.lng - origin.lng) * dLng) / lenSq;
      return projA - projB;
    });
  }

  /**
   * Calculates the exact road kilometer distance along the active route polyline
   */
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
    const totalPolyDist = cumDists[cumDists.length - 1] || 1;
    const routeDist = (activeRoute && activeRoute.distanceKm) ? activeRoute.distanceKm : totalPolyDist;
    const distScale = routeDist / totalPolyDist;

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

    const segDist = cumDists[closestSegmentIndex] + closestT * (cumDists[closestSegmentIndex + 1] - cumDists[closestSegmentIndex]);
    return Math.round(segDist * distScale * 10) / 10;
  }

  /**
   * Add a charger or custom point to intermediate waypoints (Trip Planner)
   * Automatically sorts waypoints in geometric route order so no doubling back or zig-zag occurs
   */
  function addWaypoint(charger) {
    if (!charger) return;
    if (intermediateWaypoints.some(w => w.id === charger.id)) return;

    if (activeRoute && activeRoute.coordinates) {
      if (charger.kmFromOrigin == null) {
        charger.kmFromOrigin = calculateKmAlongRoute(charger.lat, charger.lng, activeRoute.coordinates);
      }
      intermediateWaypoints.push(charger);
      intermediateWaypoints = sortWaypointsSequentially(intermediateWaypoints, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    } else {
      intermediateWaypoints.push(charger);
      notify();
    }
  }

  /**
   * Remove a charger from waypoints
   */
  function removeWaypoint(chargerId) {
    intermediateWaypoints = intermediateWaypoints.filter(w => w.id !== chargerId);
    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    } else {
      notify();
    }
  }

  function setRouteFilters(newFilters) {
    Object.assign(routeFilters, newFilters);
    if (activeRoute) {
      findCorridorChargers(activeRoute.coordinates);
      notify();
    }
  }

  function getRouteFilters() {
    return { ...routeFilters };
  }

  /**
   * Calculates comprehensive stop-by-stop charging, arrival SoC, required charge %,
   * and charging durations for every waypoint along the active route.
   */
  function calculateTripTimeline(route, batteryState) {
    if (!route) return null;
    const batState = batteryState || (window.BatteryEngine ? window.BatteryEngine.getState() : {
      currentBatteryPct: 85,
      efficiency: 0.85,
      safetyReservePct: 15,
      targetChargePct: 80
    });

    const eff = batState.efficiency || 0.85;
    const startBat = batState.currentBatteryPct || 85;
    const targetCharge = batState.targetChargePct || 80;
    const minReserve = batState.safetyReservePct || 15;

    const waypoints = route.waypoints || [];
    const legs = route.legs || [];

    let currentSoC = startBat;
    const timeline = [];
    let totalChargingTimeMins = 0;
    let totalEnergyChargedPct = 0;

    // Node 0: Starting Origin
    timeline.push({
      type: 'ORIGIN',
      name: route.origin?.name || 'Starting Point',
      lat: route.origin?.lat,
      lng: route.origin?.lng,
      departureSoC: currentSoC
    });

    // If no waypoints, single direct leg to destination
    if (waypoints.length === 0) {
      const distKm = route.distanceKm;
      const batUsed = Math.round((distKm / eff) * 10) / 10;
      const arrivalSoC = Math.round((currentSoC - batUsed) * 10) / 10;
      const isSafe = arrivalSoC >= minReserve;

      timeline.push({
        type: 'LEG',
        distanceKm: distKm,
        durationMins: route.durationMins,
        batteryUsedPct: batUsed
      });

      timeline.push({
        type: 'DESTINATION',
        name: route.destination?.name || 'Destination',
        lat: route.destination?.lat,
        lng: route.destination?.lng,
        arrivalSoC: arrivalSoC,
        isSafe: isSafe,
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

    // Process each intermediate stop
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const legDist = (legs[i] && legs[i].distance) ? Math.round((legs[i].distance / 1000) * 10) / 10 : Math.round((route.distanceKm / (waypoints.length + 1)) * 10) / 10;
      const legDur = (legs[i] && legs[i].duration) ? Math.round(legs[i].duration / 60) : Math.round(legDist * 1.8);
      const batUsed = Math.round((legDist / eff) * 10) / 10;
      const arrivalSoC = Math.round((currentSoC - batUsed) * 10) / 10;
      const isSafeArrival = arrivalSoC >= minReserve;
      const isCriticalArrival = arrivalSoC < 0;

      // Distance and consumption of NEXT leg (either next waypoint or final destination)
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
        const isFast = wp.network === 'ATHER_GRID' || wp.type === 'FAST';
        // DC Fast Chargers cut off at targetCharge (typically 80%) to protect lithium cells
        // Slow 15A AC sockets can charge up to 100%
        const maxChargerCeiling = isFast ? targetCharge : 100;

        // 1. Optimal Fast Travel Recommendation (Charge only what is needed to reach next stop with buffer)
        // Strictly capped at maxChargerCeiling (e.g. 80% for Fast Chargers)
        const optimalTargetSoC = Math.min(maxChargerCeiling, Math.max(Math.ceil(arrivalSoC), minDepartureNeeded));
        const optimalChargeNeededPct = Math.max(0, Math.round((optimalTargetSoC - Math.max(0, arrivalSoC)) * 10) / 10);
        const optimalChargeTimeMins = computeChargingDuration(optimalChargeNeededPct, arrivalSoC, isFast);

        // 2. Full Target Limit Charge (Configured target, e.g. 80%)
        // Strictly capped at maxChargerCeiling (e.g. 80% for Fast Chargers)
        const fullTargetSoC = Math.min(maxChargerCeiling, Math.max(targetCharge, optimalTargetSoC));
        const fullChargeNeededPct = Math.max(0, Math.round((fullTargetSoC - Math.max(0, arrivalSoC)) * 10) / 10);
        const fullChargeTimeMins = computeChargingDuration(fullChargeNeededPct, arrivalSoC, isFast);

        const timeSavedMins = Math.max(0, fullChargeTimeMins - optimalChargeTimeMins);

        // 3. Units (kWh) and Estimated Cost
        const batCap = (batState.vehicleDetails && batState.vehicleDetails.batteryCapacity) || 3.7;
        const unitsOptimalKWh = Math.round(((optimalChargeNeededPct / 100) * batCap) * 10) / 10;
        const unitsTargetKWh = Math.round(((fullChargeNeededPct / 100) * batCap) * 10) / 10;

        let estCost = 0;
        if (wp.network === 'ATHER_GRID') {
          estCost = 0; // Ather Grid Free Fast Charging
        } else if (wp.network === 'VIDA_GRID') {
          estCost = Math.round(unitsOptimalKWh * 15);
        } else if (wp.network === 'BOLT_EARTH' && wp.type === 'FAST') {
          estCost = Math.round(unitsOptimalKWh * 16);
        } else {
          estCost = Math.round(unitsOptimalKWh * 14);
        }

        // 4. Smart Recommendation Advice Text
        let smartAdvice = '';
        if (isFast && minDepartureNeeded > maxChargerCeiling) {
          const estArrival = Math.round((maxChargerCeiling - nextLegBatUsed) * 10) / 10;
          if (estArrival >= 0) {
            smartAdvice = `Fast charger cuts off at ${maxChargerCeiling}%. Next stretch is ${nextLegDist} km to ${nextStopName}. Reaches next stop with ~${estArrival}% battery reserve.`;
          } else {
            const shortKm = Math.round(Math.abs(estArrival) * eff * 10) / 10;
            smartAdvice = `⚠️ Range Gap: Next stretch is ${nextLegDist} km to ${nextStopName}. Fast charger cuts off at ${maxChargerCeiling}%, which is short by ~${shortKm} km. Consider a 15A socket or ride in ECO mode.`;
          }
        } else if (optimalTargetSoC < fullTargetSoC) {
          smartAdvice = `Next stretch is ${nextLegDist} km to ${nextStopName}. Charging to ${optimalTargetSoC}% gets you there safely with ${minReserve}% buffer — saving ${timeSavedMins} mins! Or charge to ${fullTargetSoC}% for max cushion.`;
        } else {
          smartAdvice = `Next stretch is ${nextLegDist} km to ${nextStopName}. Charge to ${optimalTargetSoC}% to guarantee safe arrival with ${minReserve}% safety buffer.`;
        }

        // Active values depending on current timeline mode ('optimal' vs 'target')
        const activeDepartureSoC = currentTimelineMode === 'optimal' ? optimalTargetSoC : fullTargetSoC;
        const activeChargeNeeded = currentTimelineMode === 'optimal' ? optimalChargeNeededPct : fullChargeNeededPct;
        const activeChargeTime = currentTimelineMode === 'optimal' ? optimalChargeTimeMins : fullChargeTimeMins;

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
          unitsKWh: unitsOptimalKWh,
          estCost,
          smartAdvice,
          targetChargeSoC: targetCharge,
          chargeNeededPct: activeChargeNeeded,
          chargeTimeMins: activeChargeTime,
          departureSoC: activeDepartureSoC
        });

        currentSoC = activeDepartureSoC;
      } else {
        // Intermediate Custom Waypoint / City / Stop
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

    // Final Leg to Destination
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
    selectedRouteIndex = 0;
    corridorChargers = [];
    intermediateWaypoints = [];
    lastSnappedSegmentIndex = 0;
    notify();
  }

  return {
    calculateRoute,
    selectRoute,
    findCorridorChargers,
    autoSuggestChargingStops,
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

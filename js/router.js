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
  let lastOutwardRoute = null; // Caches latest outward route { origin, destination, coordinates, distanceKm, durationMins, roadName }

  function saveOutwardRoute(data) {
    lastOutwardRoute = data;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('voltway_last_outward_route', JSON.stringify(data));
      }
    } catch (e) {}
  }

  function loadOutwardRoute() {
    if (lastOutwardRoute) return lastOutwardRoute;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem('voltway_last_outward_route');
        if (raw) {
          lastOutwardRoute = JSON.parse(raw);
        }
      }
    } catch (e) {}
    return lastOutwardRoute;
  }

  function getCorridorAnchors(coords, count = 3) {
    if (!coords || coords.length < 25) return [];
    const anchors = [];
    const step = Math.floor(coords.length / (count + 1));
    for (let i = coords.length - step; i >= step; i -= step) {
      anchors.push({
        lat: coords[i][0],
        lng: coords[i][1],
        _isCorridorGuide: true
      });
    }
    return anchors;
  }

  const ROUTING_SERVERS = [
    'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    'https://router.project-osrm.org/route/v1/driving',
    'https://routing.openstreetmap.de/routed-bike/route/v1/driving'
  ];

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
   * Helper to fetch a route from redundant multi-server cluster
   * Uses Hedged Parallel Racing (staggered mirror queries) and 9-second mobile timeout
   * Guarantees real road geometry with turns/curves and completely eliminates straight-line failures.
   */
  async function fetchOsrmRaw(points) {
    if (!points || points.length < 2) {
      throw new Error('At least 2 points are required for routing');
    }

    // 1. Sanitize & parse coordinates into valid high-precision floats
    const cleanPoints = points.map((p, idx) => {
      const lat = parseFloat(p.lat);
      const lng = parseFloat(p.lng);
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(`Invalid route coordinate at index ${idx}: lat=${p.lat}, lng=${p.lng}`);
      }
      return { lat, lng };
    });

    const coordsStr = cleanPoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

    // Helper to query a single mirror server
    async function queryMirror(serverUrl, allowAlternatives = true, timeoutMs = 9000) {
      let controller = null;
      let timeoutId = null;
      try {
        if (typeof AbortController !== 'undefined') {
          controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }

        const altParam = allowAlternatives ? '&alternatives=true' : '';
        const url = `${serverUrl}/${coordsStr}?overview=full&geometries=geojson&steps=true${altParam}`;
        const fetchOpts = controller ? { signal: controller.signal } : {};
        const resp = await fetch(url, fetchOpts);
        if (timeoutId) clearTimeout(timeoutId);

        if (!resp.ok) {
          // If alternatives=true caused 400 (common on some servers with multiple waypoints), retry without alternatives
          if (allowAlternatives && resp.status >= 400 && resp.status < 500) {
            return await queryMirror(serverUrl, false, 6000);
          }
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          return data.routes;
        }

        if (allowAlternatives) {
          return await queryMirror(serverUrl, false, 6000);
        }
        throw new Error(`OSRM code: ${data.code || 'NoRoute'}`);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    }

    // 2. Hedged Parallel Racing across mirrors:
    // Launch server 0 immediately; if not resolved within 1200ms, launch server 1; then server 2.
    // The first mirror to successfully return driving road geometry wins!
    return new Promise((resolve, reject) => {
      let resolved = false;
      let activeCount = 0;
      let errors = [];

      function tryServer(index) {
        if (resolved || index >= ROUTING_SERVERS.length) return;
        activeCount++;
        const sUrl = ROUTING_SERVERS[index];

        queryMirror(sUrl, true, 9000)
          .then(routes => {
            if (!resolved && routes && routes.length > 0) {
              resolved = true;
              resolve(routes);
            }
          })
          .catch(err => {
            errors.push(`${sUrl}: ${err.message}`);
            activeCount--;
            // If another mirror is waiting, trigger it immediately
            if (!resolved && index + 1 < ROUTING_SERVERS.length) {
              tryServer(index + 1);
            } else if (activeCount === 0 && !resolved) {
              reject(new Error(`All routing mirrors failed (${errors.join('; ')})`));
            }
          });
      }

      // Start primary mirror immediately
      tryServer(0);

      // If primary doesn't resolve within 1200ms, start second mirror in parallel
      setTimeout(() => {
        if (!resolved) tryServer(1);
      }, 1200);

      // If still not resolved within 2500ms, start third mirror in parallel
      setTimeout(() => {
        if (!resolved) tryServer(2);
      }, 2500);
    });
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

    const isRoundTrip = origin && destination && haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng) < 0.4;
    const outwardCached = loadOutwardRoute();
    const isReturnJourney = !isRoundTrip && outwardCached && outwardCached.origin && outwardCached.destination &&
      haversineDistance(origin.lat, origin.lng, outwardCached.destination.lat, outwardCached.destination.lng) < 1.0 &&
      haversineDistance(destination.lat, destination.lng, outwardCached.origin.lat, outwardCached.origin.lng) < 1.0;

    allRoutes = [];
    selectedRouteIndex = 0;

    // =========================================================================
    // CASE 1: Complete Round Trip (Origin ➔ Turnaround ➔ Origin)
    // Symmetrical Highway Lock: The return leg follows the EXACT same highway coordinates in reverse!
    // =========================================================================
    if (isRoundTrip) {
      let turnaroundWp = intermediateWaypoints.find(w => w.id && String(w.id).startsWith('turnaround_'));
      if (!turnaroundWp) {
        let maxDist = -1;
        for (const w of intermediateWaypoints) {
          if (w.isReturnStop || (w.id && String(w.id).includes('_return_'))) continue;
          const d = haversineDistance(origin.lat, origin.lng, w.lat, w.lng);
          if (d > maxDist) {
            maxDist = d;
            turnaroundWp = w;
          }
        }
      }

      if (turnaroundWp) {
        const outwardStops = intermediateWaypoints.filter(w => w !== turnaroundWp && !w.isReturnStop && !String(w.id).includes('_return_'));
        const returnStops = intermediateWaypoints.filter(w => w !== turnaroundWp && (w.isReturnStop || String(w.id).includes('_return_')));

        outwardStops.sort((a, b) => haversineDistance(origin.lat, origin.lng, a.lat, a.lng) - haversineDistance(origin.lat, origin.lng, b.lat, b.lng));
        returnStops.sort((a, b) => haversineDistance(origin.lat, origin.lng, b.lat, b.lng) - haversineDistance(origin.lat, origin.lng, a.lat, a.lng));

        const forwardPoints = [origin, ...outwardStops, turnaroundWp];
        const fwdRoutes = await fetchOsrmRaw(forwardPoints);
        if (!fwdRoutes || fwdRoutes.length === 0) {
          throw new Error('No driving route found to turnaround destination');
        }

        const fwdData = fwdRoutes[0];
        const fwdCoords = fwdData.geometry.coordinates.map(c => [c[1], c[0]]);
        const fwdDistKm = Math.round((fwdData.distance / 1000) * 10) / 10;
        const fwdDurMins = Math.round(fwdData.duration / 60);

        // Outward leg distances
        let cumKm = 0;
        for (let i = 0; i < outwardStops.length; i++) {
          if (fwdData.legs && fwdData.legs[i]) {
            cumKm += Math.round((fwdData.legs[i].distance / 1000) * 10) / 10;
            outwardStops[i].kmFromOrigin = Math.round(cumKm * 10) / 10;
          }
        }
        turnaroundWp.kmFromOrigin = fwdDistKm;

        // Mathematical Highway Symmetry: return leg is EXACT reverse of forward highway!
        const retCoords = fwdCoords.slice().reverse();
        const roundTripCoords = [...fwdCoords, ...retCoords];
        const totalDistKm = Math.round(fwdDistKm * 2 * 10) / 10;
        const totalDurMins = fwdDurMins * 2;

        // Return stop distances along the full round-trip route
        for (let i = 0; i < returnStops.length; i++) {
          const rs = returnStops[i];
          const matchOut = outwardStops.find(o => (o.originalId || o.id) === (rs.originalId || rs.id));
          if (matchOut && matchOut.kmFromOrigin) {
            rs.kmFromOrigin = Math.round((fwdDistKm + (fwdDistKm - matchOut.kmFromOrigin)) * 10) / 10;
          } else {
            const dTurn = haversineDistance(turnaroundWp.lat, turnaroundWp.lng, rs.lat, rs.lng);
            const dOrig = haversineDistance(origin.lat, origin.lng, rs.lat, rs.lng);
            const ratio = dTurn / (dTurn + dOrig || 1);
            rs.kmFromOrigin = Math.round((fwdDistKm + ratio * fwdDistKm) * 10) / 10;
          }
        }

        intermediateWaypoints = [...outwardStops, turnaroundWp, ...returnStops];

        // Synthesize route legs
        const synthesizedLegs = [];
        let prevKm = 0;
        for (let i = 0; i < intermediateWaypoints.length; i++) {
          const wpKm = intermediateWaypoints[i].kmFromOrigin || prevKm;
          const legDist = Math.max(0.1, Math.round((wpKm - prevKm) * 10) / 10);
          synthesizedLegs.push({
            distance: legDist * 1000,
            duration: Math.round((legDist / (totalDistKm || 1)) * (totalDurMins * 60)),
            summary: intermediateWaypoints[i].name || 'Waysegment'
          });
          prevKm = wpKm;
        }
        const finalLegDist = Math.max(0.1, Math.round((totalDistKm - prevKm) * 10) / 10);
        synthesizedLegs.push({
          distance: finalLegDist * 1000,
          duration: Math.round((finalLegDist / (totalDistKm || 1)) * (totalDurMins * 60)),
          summary: origin.name || 'Arrival at Origin'
        });

        const prominentRoad = extractMainRoadName(fwdData.legs) || 'Main Highway';
        const name = `${prominentRoad} (Round Trip - ${totalDistKm} km)`;

        allRoutes = [{
          id: 'route-0',
          name,
          roadName: prominentRoad,
          origin,
          destination,
          waypoints: [...intermediateWaypoints],
          distanceKm: totalDistKm,
          durationMins: totalDurMins,
          timeDiffMins: 0,
          geometry: { type: 'LineString', coordinates: roundTripCoords.map(c => [c[1], c[0]]) },
          coordinates: roundTripCoords,
          legs: synthesizedLegs,
          isPrimary: true
        }];

        saveOutwardRoute({
          origin: { ...origin },
          destination: { lat: turnaroundWp.lat, lng: turnaroundWp.lng, name: turnaroundWp.name },
          coordinates: fwdCoords.slice(),
          distanceKm: fwdDistKm,
          durationMins: fwdDurMins,
          roadName: prominentRoad
        });

        selectedRouteIndex = 0;
        activeRoute = allRoutes[0];
        findCorridorChargers(activeRoute.coordinates);
        notify();
        return activeRoute;
      }
    }

    // =========================================================================
    // CASE 2: Return Journey (B ➔ A) after Outward Journey (A ➔ B)
    // Symmetrical Highway Lock: Retrace the outward journey highway in reverse!
    // =========================================================================
    if (isReturnJourney && outwardCached && outwardCached.coordinates && outwardCached.coordinates.length > 10) {
      const retCoords = outwardCached.coordinates.slice().reverse();
      const totalDistKm = outwardCached.distanceKm;
      const totalDurMins = outwardCached.durationMins;
      const prominentRoad = outwardCached.roadName || 'Main Highway';

      const cleanWaypoints = intermediateWaypoints.filter(w => !w._isCorridorGuide);
      cleanWaypoints.forEach(wp => {
        const dOrig = haversineDistance(origin.lat, origin.lng, wp.lat, wp.lng);
        const dDest = haversineDistance(destination.lat, destination.lng, wp.lat, wp.lng);
        const ratio = dOrig / (dOrig + dDest || 1);
        wp.kmFromOrigin = Math.round((ratio * totalDistKm) * 10) / 10;
      });
      cleanWaypoints.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
      intermediateWaypoints = cleanWaypoints;

      const synthesizedLegs = [];
      let prevKm = 0;
      for (let i = 0; i < intermediateWaypoints.length; i++) {
        const wpKm = intermediateWaypoints[i].kmFromOrigin || prevKm;
        const legDist = Math.max(0.1, Math.round((wpKm - prevKm) * 10) / 10);
        synthesizedLegs.push({
          distance: legDist * 1000,
          duration: Math.round((legDist / (totalDistKm || 1)) * (totalDurMins * 60)),
          summary: intermediateWaypoints[i].name || 'Waysegment'
        });
        prevKm = wpKm;
      }
      const finalLegDist = Math.max(0.1, Math.round((totalDistKm - prevKm) * 10) / 10);
      synthesizedLegs.push({
        distance: finalLegDist * 1000,
        duration: Math.round((finalLegDist / (totalDistKm || 1)) * (totalDurMins * 60)),
        summary: destination.name || 'Arrival at Destination'
      });

      const name = `${prominentRoad} (Return Trip - ${totalDistKm} km)`;

      allRoutes = [{
        id: 'route-0',
        name,
        roadName: prominentRoad,
        origin,
        destination,
        waypoints: [...intermediateWaypoints],
        distanceKm: totalDistKm,
        durationMins: totalDurMins,
        timeDiffMins: 0,
        geometry: { type: 'LineString', coordinates: retCoords.map(c => [c[1], c[0]]) },
        coordinates: retCoords,
        legs: synthesizedLegs,
        isPrimary: true
      }];

      selectedRouteIndex = 0;
      activeRoute = allRoutes[0];
      findCorridorChargers(activeRoute.coordinates);
      notify();
      return activeRoute;
    }

    // =========================================================================
    // CASE 3: Standard One-Way Route (A ➔ B) via OSRM
    // =========================================================================
    let points = [origin, ...intermediateWaypoints, destination];

    allRoutes = [];
    selectedRouteIndex = 0;

    try {
      const primaryRoutes = await fetchOsrmRaw(points);
      if (!primaryRoutes || primaryRoutes.length === 0) {
        throw new Error('No driving route found');
      }

      const cleanWaypoints = intermediateWaypoints.filter(w => !w._isCorridorGuide);

      // 1. Process routes returned by OSRM
      primaryRoutes.forEach((routeData, idx) => {
        const distKm = Math.round((routeData.distance / 1000) * 10) / 10;
        const durMins = Math.round(routeData.duration / 60);
        const prominentRoad = extractMainRoadName(routeData.legs);
        const roadLabel = prominentRoad ? `via ${prominentRoad}` : (idx === 0 ? 'Main Highway' : `Route ${idx + 1}`);
        const name = idx === 0 ? `${roadLabel} (Fastest)` : `${roadLabel} (${distKm} km)`;

        // Calculate accurate road km distance for each intermediate waypoint from OSRM's actual driving legs
        let cumKm = 0;
        for (let i = 0; i < cleanWaypoints.length; i++) {
          if (routeData.legs && routeData.legs[i]) {
            cumKm += Math.round((routeData.legs[i].distance / 1000) * 10) / 10;
            cleanWaypoints[i].kmFromOrigin = Math.round(cumKm * 10) / 10;
          }
        }

        allRoutes.push({
          id: `route-${idx}`,
          name,
          roadName: prominentRoad || (idx === 0 ? 'Fastest Highway' : `Route ${idx + 1}`),
          origin,
          destination,
          waypoints: [...cleanWaypoints],
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
                  waypoints: [...cleanWaypoints],
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

      // Cache outward route geometry for locking return corridor (do NOT overwrite on return journeys!)
      if (!isRoundTrip && !isReturnJourney && activeRoute && activeRoute.coordinates && activeRoute.coordinates.length > 10) {
        saveOutwardRoute({
          origin: { ...origin },
          destination: { ...destination },
          coordinates: activeRoute.coordinates.slice(),
          distanceKm: activeRoute.distanceKm,
          durationMins: activeRoute.durationMins,
          roadName: activeRoute.roadName || (extractMainRoadName(activeRoute.legs) || 'Main Highway')
        });
      }

      // Discover chargers along the selected route corridor
      findCorridorChargers(activeRoute.coordinates);

      // Precompute exact kmFromOrigin for all intermediate waypoints along the route polyline
      if (intermediateWaypoints.length > 0 && activeRoute.coordinates) {
        intermediateWaypoints = sortWaypointsSequentially(intermediateWaypoints, origin, destination, activeRoute.coordinates);
      }

      notify();
      return activeRoute;
    } catch (err) {
      console.error('All routing cluster mirrors failed:', err);
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast('⚠️ Network Error: Could not reach routing servers. Please check your data connection.');
      }
      throw new Error('Could not calculate road route. Please verify your internet connection and try again.');
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
   * Accurately sequences outward stops and return stops on round-trip / return journeys.
   */
  function sortWaypointsSequentially(waypoints, origin, destination, routeCoords = null) {
    if (!waypoints || waypoints.length <= 1) return waypoints || [];

    const isRoundTrip = origin && destination && haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng) < 0.4;

    if (isRoundTrip) {
      // 1. Identify the turnaround waypoint
      let turnaroundWp = waypoints.find(w => w.id && String(w.id).startsWith('turnaround_'));

      if (!turnaroundWp) {
        let maxD = -1;
        for (const w of waypoints) {
          if (w.isReturnStop) continue; // Return stops are never the turnaround
          const d = haversineDistance(origin.lat, origin.lng, w.lat, w.lng);
          if (d > maxD) {
            maxD = d;
            turnaroundWp = w;
          }
        }
      }

      const outwardStops = [];
      const returnStops = [];

      for (const w of waypoints) {
        if (w === turnaroundWp) continue;
        if (w.isReturnStop || (w.id && String(w.id).includes('_return_'))) {
          returnStops.push(w);
        } else {
          outwardStops.push(w);
        }
      }

      // Outward stops: sort by distance from origin ASCENDING (0 km -> turnaround)
      outwardStops.sort((a, b) => {
        const dA = haversineDistance(origin.lat, origin.lng, a.lat, a.lng);
        const dB = haversineDistance(origin.lat, origin.lng, b.lat, b.lng);
        return dA - dB;
      });

      // Return stops: sort by distance from turnaround ASCENDING (turnaround -> destination)
      // which is distance from origin DESCENDING (furthest from origin to closest to origin)
      returnStops.sort((a, b) => {
        const dA = haversineDistance(origin.lat, origin.lng, a.lat, a.lng);
        const dB = haversineDistance(origin.lat, origin.lng, b.lat, b.lng);
        return dB - dA;
      });

      const result = [];
      if (outwardStops.length > 0) result.push(...outwardStops);
      if (turnaroundWp) result.push(turnaroundWp);
      if (returnStops.length > 0) result.push(...returnStops);
      return result;
    }

    if (!origin || !destination) return waypoints;

    // Normal one-way route: sort by distance from origin ascending
    return [...waypoints].sort((a, b) => {
      const dA = haversineDistance(origin.lat, origin.lng, a.lat, a.lng);
      const dB = haversineDistance(origin.lat, origin.lng, b.lat, b.lng);
      return dA - dB;
    });
  }

  /**
   * Calculates the exact road kilometer distance along the active route polyline
   */
  function calculateKmAlongRoute(lat, lng, routeCoords, startSeg = 0, endSeg = null) {
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
    const maxSeg = (endSeg !== null && endSeg < routeCoords.length - 1) ? endSeg : routeCoords.length - 1;
    const minSeg = Math.max(0, Math.min(startSeg, maxSeg));
    let closestSegmentIndex = minSeg;
    let closestT = 0;

    for (let s = minSeg; s < maxSeg; s++) {
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
   * Supports visiting the same charger on both outward and return legs
   */
  function addWaypoint(charger, isReturn = false) {
    if (!charger) return;
    const baseId = charger.originalId || charger.id;
    const existingStops = intermediateWaypoints.filter(w => (w.originalId || w.id) === baseId);

    if (existingStops.length >= 2) {
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`⚡ ${charger.name} is already added as Stop #${intermediateWaypoints.indexOf(existingStops[0]) + 1} and #${intermediateWaypoints.indexOf(existingStops[1]) + 1}`);
      }
      return;
    }

    const isSecondVisit = existingStops.length === 1;
    const shouldBeReturn = isReturn === true || isSecondVisit;
    const uniqueId = shouldBeReturn ? `${baseId}_return_${Date.now()}` : baseId;

    const stopObj = {
      ...charger,
      originalId: baseId,
      id: uniqueId,
      isReturnStop: shouldBeReturn
    };
    delete stopObj.kmFromOrigin; // ALWAYS calculate freshly!

    if (activeRoute && activeRoute.coordinates) {
      intermediateWaypoints.push(stopObj);
      intermediateWaypoints = sortWaypointsSequentially(intermediateWaypoints, activeRoute.origin, activeRoute.destination, activeRoute.coordinates);
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    } else {
      intermediateWaypoints.push(stopObj);
      notify();
    }
  }

  /**
   * Remove a charger or stop from waypoints and cleanly recalculate full route
   * Does NOT auto-suggest chargers on user removal so user can manually add their own stops.
   */
  function removeWaypoint(chargerId) {
    if (!chargerId) return;

    const exactIdx = intermediateWaypoints.findIndex(w => String(w.id) === String(chargerId));
    if (exactIdx !== -1) {
      intermediateWaypoints.splice(exactIdx, 1);
    } else {
      const matches = intermediateWaypoints.filter(w => String(w.originalId || w.id) === String(chargerId));
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        intermediateWaypoints = intermediateWaypoints.filter(w => w !== lastMatch);
      }
    }

    // Clear stale distance along route cache so waypoints re-sequence cleanly without cut-off
    intermediateWaypoints.forEach(w => {
      delete w.kmFromOrigin;
    });

    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints).catch(err => {
        console.warn('[VoltWay Router] Recalculate after remove waypoint note:', err);
      });
      // NOTE: Deliberately no autoSuggestChargingStops here to respect user's manual choice!
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

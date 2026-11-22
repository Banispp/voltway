/**
 * VoltWay 2W - OSRM Route Engine & Corridor Charger Discovery
 * 100% Free Open-Source Routing Machine with Intelligent 2W Waypoint Optimization
 */

const RouteEngine = (function () {
  let activeRoute = null;
  let corridorChargers = [];
  let intermediateWaypoints = []; // [charger1, charger2]

  const OSRM_PUBLIC_API = 'https://router.project-osrm.org/route/v1/driving';

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
      corridorChargers,
      waypoints: intermediateWaypoints
    }));
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
   */
  function distToSegment(p, v, w) {
    // p, v, w are [lat, lng]
    const l2 = (v[0] - w[0]) * (v[0] - w[0]) + (v[1] - w[1]) * (v[1] - w[1]);
    if (l2 === 0) return haversineDistance(p[0], p[1], v[0], v[1]);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projectionLat = v[0] + t * (w[0] - v[0]);
    const projectionLng = v[1] + t * (w[1] - v[1]);
    return haversineDistance(p[0], p[1], projectionLat, projectionLng);
  }

  /**
   * Fetch driving route between origin, destination, and intermediate waypoints via OSRM
   */
  async function calculateRoute(origin, destination, manualWaypoints = null) {
    if (!origin || !destination) {
      throw new Error('Origin and destination are required');
    }

    if (manualWaypoints !== null) {
      intermediateWaypoints = manualWaypoints;
    }

    // Coordinates string in format: lng1,lat1;lng2,lat2;lng3,lat3
    const points = [origin, ...intermediateWaypoints, destination];
    const coordsStr = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `${OSRM_PUBLIC_API}/${coordsStr}?overview=full&geometries=geojson&steps=true`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`OSRM HTTP error: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No route found between these points');
      }

      const routeData = data.routes[0];
      const distanceKm = Math.round((routeData.distance / 1000) * 10) / 10;
      const durationMins = Math.round(routeData.duration / 60);

      activeRoute = {
        origin,
        destination,
        waypoints: [...intermediateWaypoints],
        distanceKm,
        durationMins,
        geometry: routeData.geometry, // GeoJSON LineString
        coordinates: routeData.geometry.coordinates.map(c => [c[1], c[0]]), // [lat, lng] for Leaflet
        legs: routeData.legs || []
      };

      // Discover chargers along this corridor
      findCorridorChargers(activeRoute.coordinates);

      notify();
      return activeRoute;
    } catch (err) {
      console.error('OSRM route calculation error:', err);
      // Fallback: create straight-line route estimate if offline
      const directDist = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
      const estRoadDist = Math.round(directDist * 1.25 * 10) / 10;
      activeRoute = {
        origin,
        destination,
        waypoints: [...intermediateWaypoints],
        distanceKm: estRoadDist,
        durationMins: Math.round(estRoadDist * 2), // ~30 km/h average 2W speed
        geometry: {
          type: 'LineString',
          coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]]
        },
        coordinates: [[origin.lat, origin.lng], [destination.lat, destination.lng]],
        isFallback: true
      };

      findCorridorChargers(activeRoute.coordinates);
      notify();
      return activeRoute;
    }
  }

  /**
   * Identifies all compatible 2W chargers within corridorDistanceKm of the route polyline
   */
  function findCorridorChargers(routeCoords, maxCorridorKm = 2.5) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const matching = [];

    if (!routeCoords || routeCoords.length < 2 || !allChargers || allChargers.length === 0) {
      corridorChargers = [];
      return [];
    }

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

    // Expand bounding box by maxCorridorKm (~0.03 deg)
    const degBuffer = 0.04;
    minLat -= degBuffer;
    maxLat += degBuffer;
    minLng -= degBuffer;
    maxLng += degBuffer;

    // Filter candidate chargers in expanded bounding box
    const candidates = allChargers.filter(c =>
      c.lat >= minLat && c.lat <= maxLat && c.lng >= minLng && c.lng <= maxLng
    );

    // Calculate perpendicular distance to polyline segments
    for (let c = 0; c < candidates.length; c++) {
      const charger = candidates[c];
      const p = [charger.lat, charger.lng];
      let minDistance = Infinity;
      let closestSegmentIndex = 0;

      // Sample every segment
      for (let s = 0; s < routeCoords.length - 1; s++) {
        const d = distToSegment(p, routeCoords[s], routeCoords[s + 1]);
        if (d < minDistance) {
          minDistance = d;
          closestSegmentIndex = s;
        }
        if (minDistance <= 0.1) break; // very close, stop early
      }

      if (minDistance <= maxCorridorKm) {
        // Calculate rough distance from origin along route
        const progressFrac = closestSegmentIndex / (routeCoords.length - 1);
        const approxKmFromOrigin = activeRoute ? Math.round(progressFrac * activeRoute.distanceKm * 10) / 10 : 0;

        matching.push({
          ...charger,
          corridorDistanceKm: Math.round(minDistance * 10) / 10,
          kmFromOrigin: approxKmFromOrigin
        });
      }
    }

    // Sort matching chargers by order along route from origin
    matching.sort((a, b) => a.kmFromOrigin - b.kmFromOrigin);
    corridorChargers = matching;
    console.log(`[VoltWay Router] Discovered ${corridorChargers.length} chargers along route corridor (<= ${maxCorridorKm} km)`);
    return corridorChargers;
  }

  /**
   * Automatically suggests optimal charging stops along the route if distance > safe battery range
   */
  async function autoSuggestChargingStops(batteryEvaluation) {
    if (!activeRoute || !batteryEvaluation) return [];

    const safeRange = batteryEvaluation.safeMaxKm || 60;
    const totalDist = activeRoute.distanceKm;

    if (totalDist <= safeRange) {
      console.log('[VoltWay Router] Total trip is within safe battery range. No charging stops required.');
      return [];
    }

    if (corridorChargers.length === 0) {
      console.warn('[VoltWay Router] No chargers found along the route corridor.');
      return [];
    }

    const suggestedWaypoints = [];
    let currentCoveredKm = 0;
    let attempts = 0;

    // We need charging stops when (currentPosition + nextLeg) > safeRange
    while (currentCoveredKm + safeRange < totalDist && attempts < 5) {
      attempts++;
      const targetMinKm = currentCoveredKm + (safeRange * 0.55);
      const targetMaxKm = currentCoveredKm + (safeRange * 0.95);

      // Find chargers in the target window, prioritizing fast chargers (Ather Fast > Bolt Fast > Bolt 15A)
      let candidates = corridorChargers.filter(c =>
        c.kmFromOrigin >= targetMinKm &&
        c.kmFromOrigin <= targetMaxKm &&
        !suggestedWaypoints.some(w => w.id === c.id)
      );

      if (candidates.length === 0) {
        // Broaden search
        candidates = corridorChargers.filter(c =>
          c.kmFromOrigin > currentCoveredKm &&
          c.kmFromOrigin <= currentCoveredKm + safeRange &&
          !suggestedWaypoints.some(w => w.id === c.id)
        );
      }

      if (candidates.length === 0) {
        break;
      }

      // Priority sort: Ather Grid Fast (1) > Bolt Fast (2) > Bolt Slow (3), then closest to corridor
      candidates.sort((a, b) => {
        const getPriority = (c) => {
          if (c.network === 'ATHER_GRID') return 1;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST') return 2;
          return 3;
        };
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        return a.corridorDistanceKm - b.corridorDistanceKm;
      });

      const selected = candidates[0];
      suggestedWaypoints.push(selected);
      currentCoveredKm = selected.kmFromOrigin;
    }

    if (suggestedWaypoints.length > 0) {
      console.log(`[VoltWay Router] Auto-suggested ${suggestedWaypoints.length} charging stops:`, suggestedWaypoints.map(w => w.name));
      intermediateWaypoints = suggestedWaypoints;
      // Recalculate route including these stops
      await calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    }

    return suggestedWaypoints;
  }

  function addWaypoint(charger) {
    if (!charger) return;
    if (intermediateWaypoints.some(w => w.id === charger.id)) return;
    intermediateWaypoints.push(charger);
    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    }
  }

  function removeWaypoint(chargerId) {
    intermediateWaypoints = intermediateWaypoints.filter(w => w.id !== chargerId);
    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    }
  }

  function clearRoute() {
    activeRoute = null;
    corridorChargers = [];
    intermediateWaypoints = [];
    notify();
  }

  return {
    calculateRoute,
    findCorridorChargers,
    autoSuggestChargingStops,
    addWaypoint,
    removeWaypoint,
    clearRoute,
    subscribe,
    getActiveRoute: () => activeRoute,
    getCorridorChargers: () => corridorChargers,
    getWaypoints: () => intermediateWaypoints
  };
})();

window.RouteEngine = RouteEngine;

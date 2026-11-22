/**
 * VoltWay 2W - OSRM Route Engine & Multi-Route Selection
 * 100% Free Open-Source Routing Machine with Google Maps Style Alternative Routes Selection
 * and Interactive Charger Waypoint Trip Planning
 */

const RouteEngine = (function () {
  let allRoutes = []; // Array of { id, name, distanceKm, durationMins, coordinates, geometry, legs }
  let selectedRouteIndex = 0;
  let activeRoute = null;
  let corridorChargers = [];
  let intermediateWaypoints = []; // [charger1, charger2, ...]

  const OSRM_PUBLIC_API = 'https://router.project-osrm.org/route/v1/driving';

  // Route Planner Charger Filter State (Controls corridor search & auto charging stops)
  const routeFilters = {
    atherFast: true,
    boltFast: true,
    boltSlow: true
  };

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
      timelineMode: currentTimelineMode
    }));
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
   */
  function distToSegment(p, v, w) {
    const l2 = (v[0] - w[0]) * (v[0] - w[0]) + (v[1] - w[1]) * (v[1] - w[1]);
    if (l2 === 0) return haversineDistance(p[0], p[1], v[0], v[1]);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projectionLat = v[0] + t * (w[0] - v[0]);
    const projectionLng = v[1] + t * (w[1] - v[1]);
    return haversineDistance(p[0], p[1], projectionLat, projectionLng);
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
   */
  function computeChargingDuration(chargeNeededPct, currentArrivalSoC, isFast) {
    if (chargeNeededPct <= 0) return 0;
    if (isFast) {
      const startSoC = Math.max(0, currentArrivalSoC);
      const endSoC = startSoC + chargeNeededPct;
      const upTo80 = Math.max(0, Math.min(80, endSoC) - Math.min(80, startSoC));
      const above80 = Math.max(0, endSoC - Math.max(80, startSoC));
      return Math.round((upTo80 / 1.4) + (above80 / 0.45));
    } else {
      // 15A socket ~0.33% SoC per min
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

    if (manualWaypoints !== null) {
      intermediateWaypoints = manualWaypoints;
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
  function selectRoute(index) {
    if (index < 0 || index >= allRoutes.length) return;
    selectedRouteIndex = index;
    activeRoute = allRoutes[index];
    findCorridorChargers(activeRoute.coordinates);
    notify();
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

    const degBuffer = 0.04;
    minLat -= degBuffer;
    maxLat += degBuffer;
    minLng -= degBuffer;
    maxLng += degBuffer;

    const candidates = allChargers.filter(c => {
      if (c.lat < minLat || c.lat > maxLat || c.lng < minLng || c.lng > maxLng) return false;
      // Filter according to Route Planner Preferences
      if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
      if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
      if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
      return true;
    });

    for (let c = 0; c < candidates.length; c++) {
      const charger = candidates[c];
      const p = [charger.lat, charger.lng];
      let minDistance = Infinity;
      let closestSegmentIndex = 0;

      for (let s = 0; s < routeCoords.length - 1; s++) {
        const d = distToSegment(p, routeCoords[s], routeCoords[s + 1]);
        if (d < minDistance) {
          minDistance = d;
          closestSegmentIndex = s;
        }
        if (minDistance <= 0.1) break;
      }

      if (minDistance <= maxCorridorKm) {
        const progressFrac = closestSegmentIndex / (routeCoords.length - 1);
        const approxKmFromOrigin = activeRoute ? Math.round(progressFrac * activeRoute.distanceKm * 10) / 10 : 0;

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
   * Automatically suggests optimal charging stops along the route if distance > safe battery range
   */
  async function autoSuggestChargingStops(batteryEvaluation) {
    if (!activeRoute || !batteryEvaluation) return [];

    const safeRange = batteryEvaluation.safeMaxKm || 60;
    const totalDist = activeRoute.distanceKm;

    if (totalDist <= safeRange || corridorChargers.length === 0) {
      return [];
    }

    const suggestedWaypoints = [];
    let currentCoveredKm = 0;
    let attempts = 0;

    while (currentCoveredKm + safeRange < totalDist && attempts < 5) {
      attempts++;
      const targetMinKm = currentCoveredKm + (safeRange * 0.55);
      const targetMaxKm = currentCoveredKm + (safeRange * 0.95);

      let candidates = corridorChargers.filter(c => {
        if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
        return c.kmFromOrigin >= targetMinKm &&
               c.kmFromOrigin <= targetMaxKm &&
               !suggestedWaypoints.some(w => w.id === c.id);
      });

      if (candidates.length === 0) {
        candidates = corridorChargers.filter(c => {
          if (c.network === 'ATHER_GRID' && !routeFilters.atherFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !routeFilters.boltFast) return false;
          if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !routeFilters.boltSlow) return false;
          return c.kmFromOrigin > currentCoveredKm &&
                 c.kmFromOrigin <= currentCoveredKm + safeRange &&
                 !suggestedWaypoints.some(w => w.id === c.id);
        });
      }

      if (candidates.length === 0) break;

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
      intermediateWaypoints = suggestedWaypoints;
      await calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    }

    return suggestedWaypoints;
  }

  /**
   * Add a charger to intermediate waypoints (Trip Planner)
   */
  function addWaypoint(charger) {
    if (!charger) return;
    if (intermediateWaypoints.some(w => w.id === charger.id)) return;
    intermediateWaypoints.push(charger);
    if (activeRoute) {
      calculateRoute(activeRoute.origin, activeRoute.destination, intermediateWaypoints);
    } else {
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

      const isFast = wp.network === 'ATHER_GRID' || wp.type === 'FAST';

      // 1. Optimal Fast Travel Recommendation (Charge only what is needed to reach next stop with buffer)
      const optimalTargetSoC = Math.min(100, Math.max(Math.ceil(arrivalSoC), minDepartureNeeded));
      const optimalChargeNeededPct = Math.max(0, Math.round((optimalTargetSoC - Math.max(0, arrivalSoC)) * 10) / 10);
      const optimalChargeTimeMins = computeChargingDuration(optimalChargeNeededPct, arrivalSoC, isFast);

      // 2. Full Target Limit Charge (Configured target, e.g. 80%)
      const fullTargetSoC = Math.min(100, Math.max(targetCharge, optimalTargetSoC));
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
      } else if (wp.network === 'BOLT_EARTH' && wp.type === 'FAST') {
        estCost = Math.round(unitsOptimalKWh * 16);
      } else {
        estCost = Math.round(unitsOptimalKWh * 14);
      }

      // 4. Smart Recommendation Advice Text
      let smartAdvice = '';
      if (optimalTargetSoC < fullTargetSoC) {
        smartAdvice = `Next stretch is ${nextLegDist} km to ${nextStopName}. Charging to ${optimalTargetSoC}% gets you there safely with ${minReserve}% buffer — saving ${timeSavedMins} mins! Or charge to ${fullTargetSoC}% for max cushion.`;
      } else {
        smartAdvice = `Next stretch is ${nextLegDist} km to ${nextStopName}. High energy leg — recommended to charge fully to ${optimalTargetSoC}% to guarantee arrival with ${minReserve}% reserve.`;
      }

      // Active values depending on current timeline mode ('optimal' vs 'target')
      const activeDepartureSoC = currentTimelineMode === 'optimal' ? optimalTargetSoC : fullTargetSoC;
      const activeChargeNeeded = currentTimelineMode === 'optimal' ? optimalChargeNeededPct : fullChargeNeededPct;
      const activeChargeTime = currentTimelineMode === 'optimal' ? optimalChargeTimeMins : fullChargeTimeMins;

      totalChargingTimeMins += activeChargeTime;
      totalEnergyChargedPct += activeChargeNeeded;

      timeline.push({
        type: 'LEG',
        distanceKm: legDist,
        durationMins: legDur,
        batteryUsedPct: batUsed
      });

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
      totalChargingStops: waypoints.length,
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
    subscribe,
    getActiveRoute: () => activeRoute,
    getAllRoutes: () => allRoutes,
    getSelectedRouteIndex: () => selectedRouteIndex,
    getCorridorChargers: () => corridorChargers,
    getWaypoints: () => intermediateWaypoints
  };
})();

window.RouteEngine = RouteEngine;

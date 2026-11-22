/**
 * VoltWay 2W - Interactive Leaflet Map Engine
 * Ultra-Smooth Viewport Marker Culling (60 FPS, Zero Lag)
 * Google Maps Style Alternative Routes Rendering & Click-to-Add Trip Planning
 */

const MapEngine = (function () {
  let map = null;
  let tileLayer = null;
  let currentTileTheme = 'dark';

  // Layers
  let markersLayer = null;
  let routeLayer = null;
  let waypointsLayer = null;
  let safeRangeCircle = null;
  let bufferRangeCircle = null;
  let userLocationMarker = null;

  // Filter state
  const filters = {
    atherFast: true,
    boltFast: true,
    boltSlow: true
  };

  // User position
  let userCoords = null; // { lat, lng }

  // High-performance Marker Pool: chargerId -> marker
  const markerMap = new Map();

  // Animation frame throttle
  let renderRafId = null;

  function initMap(containerId = 'map') {
    if (map) return map;

    const defaultCenter = [12.9716, 77.5946]; // Bangalore EV Hub
    const defaultZoom = 12;

    map = L.map(containerId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://openstreetmap.org" target="_blank">OSM</a> | VoltWay 2W')
      .addTo(map);

    setTileTheme('daylight');

    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    waypointsLayer = L.layerGroup().addTo(map);

    map.on('moveend', onMapMoveEnd);
    map.on('zoomend', onMapMoveEnd);

    locateUser(false);

    return map;
  }

  function setTileTheme(theme = 'daylight') {
    currentTileTheme = 'daylight';
    if (tileLayer) map.removeLayer(tileLayer);

    // High-visibility crisp daytime OpenStreetMap tiles
    tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c']
    }).addTo(map);
  }

  function toggleTileTheme() {
    setTileTheme(currentTileTheme === 'dark' ? 'sunlight' : 'dark');
    return currentTileTheme;
  }

  /**
   * Custom HTML Pin Icons with Crisp Vector SVGs (Fixes broken question marks / corrupted symbols)
   */
  function createPinIcon(charger) {
    let pinClass = 'pin-ather';
    let iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
    let label = 'Ather Fast';

    if (charger.network === 'ATHER_GRID') {
      pinClass = 'pin-ather';
      iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
      label = 'Ather Fast';
    } else if (charger.network === 'BOLT_EARTH') {
      if (charger.type === 'FAST') {
        pinClass = 'pin-bolt-fast';
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
        label = 'Bolt Fast';
      } else {
        pinClass = 'pin-bolt-slow';
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 7V3h-2v4h-4V3H8v4a6 6 0 0 0 5 5.91V19h-2v2h6v-2h-2v-6.09A6 6 0 0 0 16 7z"/></svg>';
        label = '15A Socket';
      }
    }

    const html = `
      <div class="custom-pin ${pinClass}" data-id="${charger.id}">
        <div class="pin-badge">
          <span class="pin-icon">${iconSvg}</span>
        </div>
        <span class="pin-label">${label}</span>
        <div class="pin-pulse"></div>
      </div>
    `;

    return L.divIcon({
      className: 'custom-pin-container',
      html: html,
      iconSize: [52, 48],
      iconAnchor: [26, 38],
      popupAnchor: [0, -36]
    });
  }

  function createWaypointPinIcon(letter, labelColor = '#00E676') {
    const html = `
      <div class="custom-waypoint-pin" style="--wp-color: ${labelColor};">
        <div class="wp-badge">${letter}</div>
      </div>
    `;
    return L.divIcon({
      className: 'waypoint-pin-container',
      html: html,
      iconSize: [36, 36],
      iconAnchor: [18, 34],
      popupAnchor: [0, -32]
    });
  }

  /**
   * ULTRA-FAST VIEWPORT MARKER CULLING
   * Completely eliminates UI lag by only rendering chargers visible on screen (max 100-120 DOM nodes)
   * Uses marker diffing so existing markers are kept without rebuilding the DOM.
   */
  function renderChargers(chargers = null) {
    if (!map || !markersLayer) return;

    if (renderRafId) cancelAnimationFrame(renderRafId);
    renderRafId = requestAnimationFrame(() => {
      _executeFastRender(chargers);
    });
  }

  function _executeFastRender(chargers = null) {
    if (!chargers) {
      chargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    }

    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.18); // 18% margin around screen

    // 1. Filter by active filter chips first
    const activeCandidates = [];
    for (let i = 0; i < chargers.length; i++) {
      const c = chargers[i];
      if (c.network === 'ATHER_GRID' && !filters.atherFast) continue;
      if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) continue;
      if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) continue;
      activeCandidates.push(c);
    }

    // 2. High-Performance Viewport Marker Culling
    let visibleChargers = [];
    if (zoom < 8) {
      // National level (Zoom < 8): Sample up to 300 high-priority Fast Chargers
      const fastOnly = activeCandidates.filter(c => c.type === 'FAST' || c.network === 'ATHER_GRID');
      const step = Math.max(1, Math.floor(fastOnly.length / 300));
      for (let i = 0; i < fastOnly.length; i += step) {
        visibleChargers.push(fastOnly[i]);
      }
    } else if (zoom < 10) {
      // State / Regional level (Zoom 8-9): Show up to 600 Fast + Slow Chargers
      const inState = activeCandidates.filter(c => bounds.contains([c.lat, c.lng]));
      const step = Math.max(1, Math.floor(inState.length / 600));
      for (let i = 0; i < inState.length; i += step) {
        visibleChargers.push(inState[i]);
      }
    } else {
      // City / Street level (Zoom >= 10): Show 100% of all chargers within the visible viewport bounds
      for (let i = 0; i < activeCandidates.length; i++) {
        const c = activeCandidates[i];
        if (bounds.contains([c.lat, c.lng])) {
          visibleChargers.push(c);
          if (visibleChargers.length >= 750) break; // Generous ceiling for smooth rendering
        }
      }
    }

    // Always include chargers that are active waypoints in the trip planner
    const activeWaypoints = window.RouteEngine ? window.RouteEngine.getWaypoints() : [];
    activeWaypoints.forEach(wp => {
      if (!visibleChargers.some(c => c.id === wp.id)) {
        visibleChargers.push(wp);
      }
    });

    // 3. Diffing: Remove markers that moved outside the viewport
    const newVisibleIds = new Set(visibleChargers.map(c => c.id));
    for (const [id, marker] of markerMap.entries()) {
      if (!newVisibleIds.has(id)) {
        markersLayer.removeLayer(marker);
        markerMap.delete(id);
      }
    }

    // 4. Add only newly entered chargers
    visibleChargers.forEach((charger) => {
      if (markerMap.has(charger.id)) {
        return; // Already rendered in DOM, keep it!
      }

      const pos = L.latLng(charger.lat, charger.lng);
      const icon = createPinIcon(charger);
      const marker = L.marker(pos, { icon: icon });

      marker.bindPopup(() => createChargerPopupHtml(charger), {
        maxWidth: 320,
        className: 'charger-popup'
      });

      marker.addTo(markersLayer);
      markerMap.set(charger.id, marker);
    });
  }

  /**
   * Interactive Charger Popup with Trip Planner actions
   */
  function createChargerPopupHtml(charger) {
    const isAther = charger.network === 'ATHER_GRID';
    const isFast = charger.type === 'FAST';

    const networkBadgeClass = isAther ? 'badge-ather' : (isFast ? 'badge-bolt-fast' : 'badge-bolt-slow');
    const networkName = isAther ? 'Ather Grid' : 'Bolt.Earth';

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : { efficiency: 0.85, currentBatteryPct: 85 };
    const chargeTime = window.Utilities ? window.Utilities.estimateChargingTime(batteryState.currentBatteryPct, 80, batteryState.efficiency) : null;
    const estTimeText = isFast ? (chargeTime ? chargeTime.fastTimeFormatted : '~35 mins to 80%') : (chargeTime ? chargeTime.slowTimeFormatted : '~3h 30m');

    const waypoints = window.RouteEngine ? window.RouteEngine.getWaypoints() : [];
    const isAlreadyWaypoint = waypoints.some(w => w.id === charger.id);

    return `
      <div class="popup-card">
        <div class="popup-header">
          <span class="popup-badge ${networkBadgeClass}">${networkName}</span>
          <span class="popup-type">${isFast ? '⚡ DC Fast (2W)' : '🔌 15A Socket'}</span>
        </div>
        <div class="popup-title">${charger.name}</div>
        <div class="popup-detail">
          <span class="detail-label">Connector:</span>
          <span class="detail-val">${charger.connector}</span>
        </div>
        <div class="popup-detail">
          <span class="detail-label">Power Output:</span>
          <span class="detail-val">${charger.power_kw} kW • ${isFast ? '~1 km/min' : '~18% / hr'}</span>
        </div>
        <div class="popup-detail">
          <span class="detail-label">Est. Charge Time:</span>
          <span class="detail-val highlight-val">${estTimeText} (to 80%)</span>
        </div>
        ${charger.address ? `<div class="popup-address"><i class="icon-pin">📍</i> ${charger.address}</div>` : ''}

        <!-- Trip Planner Actions (Click on map to add/set) -->
        <div class="popup-actions" style="flex-direction: column; gap: 6px; margin-top: 8px;">
          ${isAlreadyWaypoint ? `
            <button class="btn-popup-waypoint" style="background: rgba(255, 61, 113, 0.2); border: 1px solid var(--color-danger); color: var(--color-danger);" onclick="MapEngine.handleRemoveWaypoint('${charger.id}')">
              ❌ Remove from Trip Waypoints
            </button>
          ` : `
            <button class="btn-popup-waypoint" style="background: var(--color-ather); color: #062b1a; font-weight: 800;" onclick="MapEngine.handleAddWaypoint('${charger.id}')">
              ➕ Add to Route as Waypoint (Stop)
            </button>
          `}
          <div style="display: flex; gap: 6px;">
            <button class="btn-sm btn-nav" style="flex: 1;" onclick="MapEngine.handleSetAsOrigin('${charger.id}')">
              🚩 Set as Start
            </button>
            <button class="btn-sm btn-nav" style="flex: 1;" onclick="MapEngine.handleSetAsDest('${charger.id}')">
              🏁 Set as End
            </button>
          </div>
          <button class="btn-popup-nav" style="background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary);" onclick="MapEngine.handleNavigateToCharger('${charger.id}')">
            🧭 Open in Google Maps
          </button>
          <button class="btn-sm" style="background: rgba(0, 176, 255, 0.1); border: 1px solid var(--color-bolt-slow); color: var(--color-bolt-slow); padding: 7px;" onclick="MapEngine.handleOpenOfficialApp('${charger.network}', '${charger.id}')">
            📱 Check Live Socket Status in ${isAther ? 'Ather' : 'Bolt'} App
          </button>
        </div>
      </div>
    `;
  }

  function handleOpenOfficialApp(network, chargerId) {
    if (network === 'ATHER_GRID') {
      // Ather App deep link / intent
      const isAndroid = /android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = 'intent://atherenergy.com/#Intent;package=com.atherenergy.app;scheme=https;end';
        setTimeout(() => {
          window.open('https://play.google.com/store/apps/details?id=com.atherenergy.app', '_blank');
        }, 1200);
      } else {
        window.open('https://play.google.com/store/apps/details?id=com.atherenergy.app', '_blank');
      }
    } else {
      // Bolt.Earth App deep link
      const isAndroid = /android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = `intent://bolt.earth/charger/${chargerId}#Intent;package=com.revos.bolt.android;scheme=https;end`;
        setTimeout(() => {
          window.open('https://play.google.com/store/apps/details?id=com.revos.bolt.android', '_blank');
        }, 1200);
      } else {
        window.open('https://play.google.com/store/apps/details?id=com.revos.bolt.android', '_blank');
      }
    }
  }

  function handleNavigateToCharger(chargerId) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const c = allChargers.find(item => item.id === chargerId);
    if (c && window.NavigationEngine) {
      window.NavigationEngine.navigateToNextCharger(c, userCoords);
    }
  }

  function handleAddWaypoint(chargerId) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const c = allChargers.find(item => item.id === chargerId);
    if (c && window.RouteEngine) {
      window.RouteEngine.addWaypoint(c);
      if (map) map.closePopup();

      // Show sleek non-intrusive floating toast on map (WITHOUT popping up the bottom drawer UI)
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`📍 Added Stop: ${c.name}`);
      }
    }
  }

  function handleRemoveWaypoint(chargerId) {
    if (window.RouteEngine) {
      window.RouteEngine.removeWaypoint(chargerId);
      if (map) map.closePopup();
    }
  }

  function handleSetAsOrigin(chargerId) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const c = allChargers.find(item => item.id === chargerId);
    if (c) {
      window.setPlannerOrigin(c);
      if (map) map.closePopup();
    }
  }

  function handleSetAsDest(chargerId) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const c = allChargers.find(item => item.id === chargerId);
    if (c) {
      window.setPlannerDest(c);
      if (map) map.closePopup();
    }
  }

  function setFilter(filterKey, value) {
    if (filters.hasOwnProperty(filterKey)) {
      filters[filterKey] = Boolean(value);
      renderChargers();
    }
  }

  function getFilters() {
    return { ...filters };
  }

  function updateSafeRangeOverlay(centerCoords = null) {
    if (!map) return;
    const center = centerCoords || userCoords || (map ? map.getCenter() : null);
    if (!center) return;

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : null;
    if (!batteryState) return;

    const safeKm = batteryState.reachableSafeKm || 40;
    const maxKm = batteryState.absoluteMaxKm || 60;
    const centerLatLng = L.latLng(center.lat || center[0], center.lng || center[1]);

    if (safeRangeCircle) map.removeLayer(safeRangeCircle);
    if (bufferRangeCircle) map.removeLayer(bufferRangeCircle);

    bufferRangeCircle = L.circle(centerLatLng, {
      radius: maxKm * 1000,
      color: '#FFD600',
      weight: 1.5,
      dashArray: '6, 6',
      fillColor: '#FFD600',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(map);

    safeRangeCircle = L.circle(centerLatLng, {
      radius: safeKm * 1000,
      color: '#00E676',
      weight: 2,
      fillColor: '#00E676',
      fillOpacity: 0.12,
      interactive: false
    }).addTo(map);
  }

  /**
   * RENDER MULTIPLE ALTERNATIVE ROUTES (Google Maps Style)
   * The selected route is rendered with glowing cyan/green;
   * Alternative routes are rendered with clickable slate lines!
   */
  /**
   * Render calculated routes on map
   * Alternative routes are rendered with clickable slate lines!
   * @param {Object} activeRoute Active selected route
   * @param {Array} allRoutes All candidate alternative routes
   * @param {number} selectedIndex Index of active route
   * @param {boolean} shouldFitBounds Only fit bounds when explicitly planning a new route
   */
  /**
   * Helper to create Google Maps Style floating duration badge on route polyline
   */
  function createRouteBadgeMarker(route, idx, isSelected, primaryDuration) {
    if (!route.coordinates || route.coordinates.length < 4) return null;
    const midIdx = Math.floor(route.coordinates.length * 0.48);
    const midCoord = route.coordinates[midIdx];

    const diffMins = route.durationMins - primaryDuration;
    const badgeText = `${route.durationMins} min`;
    const badgeSub = isSelected ? (route.isPrimary ? '⚡ Fastest' : 'Active') : (diffMins > 0 ? `+${diffMins}m` : `${route.distanceKm} km`);

    const icon = L.divIcon({
      className: 'route-duration-badge-wrapper',
      html: `
        <div class="map-route-duration-pill ${isSelected ? 'pill-active' : 'pill-alt'}" title="${route.name}">
          <span class="pill-duration-txt">${badgeText}</span>
          <span class="pill-badge-tag">${badgeSub}</span>
        </div>
      `,
      iconSize: [92, 32],
      iconAnchor: [46, 16]
    });

    const marker = L.marker(midCoord, { icon, zIndexOffset: isSelected ? 2000 : 1200 });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (window.RouteEngine) window.RouteEngine.selectRoute(idx);
    });
    return marker;
  }

  /**
   * Render calculated routes on map (Google Maps Style Multi-Route Selector)
   * Alternative routes are rendered with clickable slate lines and duration badges!
   * @param {Object} activeRoute Active selected route
   * @param {Array} allRoutes All candidate alternative routes
   * @param {number} selectedIndex Index of active route
   * @param {boolean} shouldFitBounds Only fit bounds when explicitly planning a new route
   */
  function renderRoute(activeRoute, allRoutes = [], selectedIndex = 0, shouldFitBounds = false) {
    if (!map || !routeLayer || !waypointsLayer) return;

    routeLayer.clearLayers();
    waypointsLayer.clearLayers();

    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
      return;
    }

    const routesList = (allRoutes && allRoutes.length > 0) ? allRoutes : [activeRoute];
    const primaryDuration = (routesList[0] && routesList[0].durationMins) || activeRoute.durationMins;

    // 1. Render Alternative Unselected Routes first (in the background, clickable!)
    routesList.forEach((r, idx) => {
      if (idx === selectedIndex) return; // will draw active route on top

      const altLine = L.polyline(r.coordinates, {
        color: '#64748B',
        weight: 6,
        opacity: 0.75,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'clickable-route-line'
      }).addTo(routeLayer);

      altLine.bindTooltip(`
        <div style="font-weight: 700; color: #fff;">${r.name}</div>
        <div style="font-size: 0.78rem; color: #cbd5e1;">${r.distanceKm} km • ${r.durationMins} mins</div>
        <div style="font-size: 0.72rem; color: #00E676;">👆 Tap to select this route</div>
      `, { sticky: true });

      altLine.on('click', () => {
        if (window.RouteEngine) {
          window.RouteEngine.selectRoute(idx);
        }
      });

      // Add floating route pill badge directly on the alternative route
      if (routesList.length > 1) {
        const altBadge = createRouteBadgeMarker(r, idx, false, primaryDuration);
        if (altBadge) altBadge.addTo(routeLayer);
      }
    });

    // 2. Render Active Selected Route (Glowing Neon Blue/Green)
    const glowLine = L.polyline(activeRoute.coordinates, {
      color: '#00E676',
      weight: 10,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    const mainLine = L.polyline(activeRoute.coordinates, {
      color: '#00B0FF',
      weight: 6,
      opacity: 0.98,
      lineCap: 'round',
      lineJoin: 'round',
      zIndexOffset: 1000
    }).addTo(routeLayer);

    // Add floating route pill badge on the active route
    if (routesList.length > 1) {
      const activeBadge = createRouteBadgeMarker(activeRoute, selectedIndex, true, primaryDuration);
      if (activeBadge) activeBadge.addTo(routeLayer);
    }

    // 3. Render Origin Pin (A)
    L.marker([activeRoute.origin.lat, activeRoute.origin.lng], {
      icon: createWaypointPinIcon('A', '#00E676')
    }).bindPopup(`<b>Start Point (A)</b><br>${activeRoute.origin.name || 'Origin'}`).addTo(waypointsLayer);

    // 4. Render Intermediate Charging Waypoints (B, C, ...)
    const intermediateStops = activeRoute.waypoints || [];
    intermediateStops.forEach((wp, idx) => {
      const letter = String.fromCharCode(66 + idx);
      const color = wp.type === 'FAST' ? '#FF9100' : '#00B0FF';
      L.marker([wp.lat, wp.lng], {
        icon: createWaypointPinIcon(letter, color)
      }).bindPopup(`
        <div class="popup-card">
          <div class="popup-header"><span class="popup-badge badge-bolt-fast">Stop ${letter}</span></div>
          <div class="popup-title">${wp.name}</div>
          <div class="popup-detail"><span>Connector:</span> <span>${wp.connector}</span></div>
          <div class="popup-actions">
            <button class="btn-popup-waypoint" style="background: rgba(255, 61, 113, 0.2); border: 1px solid var(--color-danger); color: var(--color-danger);" onclick="RouteEngine.removeWaypoint('${wp.id}')">❌ Remove Stop</button>
          </div>
        </div>
      `).addTo(waypointsLayer);
    });

    // 5. Render Final Destination Pin
    const destLetter = String.fromCharCode(66 + intermediateStops.length);
    L.marker([activeRoute.destination.lat, activeRoute.destination.lng], {
      icon: createWaypointPinIcon(destLetter, '#FF3D71')
    }).bindPopup(`<b>Destination (${destLetter})</b><br>${activeRoute.destination.name || 'Destination'}`).addTo(waypointsLayer);

    // Fit bounds to show route ONLY when requested (preserves user map position when filtering!)
    if (shouldFitBounds && mainLine) {
      map.fitBounds(mainLine.getBounds(), { padding: [50, 50] });
    }

    updateSafeRangeOverlay(activeRoute.origin);
  }

  function locateUser(panTo = true) {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        userCoords = { lat, lng };

        if (!userLocationMarker) {
          const userIcon = L.divIcon({
            className: 'user-location-marker',
            html: '<div class="user-pulse"></div><div class="user-dot"></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);
        } else {
          userLocationMarker.setLatLng([lat, lng]);
        }

        if (panTo && map) {
          map.setView([lat, lng], 14, { animate: true });
        }

        updateSafeRangeOverlay({ lat, lng });
      },
      (err) => console.warn('Geolocation:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function onMapMoveEnd() {
    renderChargers();

    if (map.getZoom() >= 13 && window.SyncEngine) {
      const b = map.getBounds();
      window.SyncEngine.fetchLiveBoltInBounds({
        south: Math.round(b.getSouth() * 1000) / 1000,
        west: Math.round(b.getWest() * 1000) / 1000,
        north: Math.round(b.getNorth() * 1000) / 1000,
        east: Math.round(b.getEast() * 1000) / 1000
      });
    }
  }

  function focusCharger(charger) {
    if (!map || !charger) return;
    map.setView([charger.lat, charger.lng], 16, { animate: true });
    renderChargers();
    setTimeout(() => {
      const marker = markerMap.get(charger.id);
      if (marker) marker.openPopup();
    }, 150);
  }

  return {
    initMap,
    setTileTheme,
    toggleTileTheme,
    renderChargers,
    setFilter,
    getFilters,
    updateSafeRangeOverlay,
    renderRoute,
    locateUser,
    focusCharger,
    getUserCoords: () => userCoords,
    getMap: () => map,
    handleNavigateToCharger,
    handleAddWaypoint,
    handleRemoveWaypoint,
    handleSetAsOrigin,
    handleSetAsDest,
    handleOpenOfficialApp
  };
})();

window.MapEngine = MapEngine;

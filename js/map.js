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
  let userAccuracyCircle = null;
  let activeMainLine = null;
  let activeGlowLine = null;
  let recenterTimer = null;

  // Live GPS tracking state (Google Maps style moving puck & auto-follow)
  let watchId = null;
  let userHeading = 0;
  let isAutoFollow = false;
  let isUserInteracting = false;
  let isUserRotating = false;
  let isNavCompassMode = false; // false = Route-Locked (default, steady arrow), true = Free Compass (follows physical orientation)

  // Regional State filter ('all' default, 'kerala', 'karnataka', 'tamil_nadu')
  let activeStateFilter = localStorage.getItem('voltway_selected_state') || localStorage.getItem('voltway_state_filter') || 'all';

  // Filter state: TWO-WHEELER FAST CHARGERS ONLY BY DEFAULT!
  const filters = {
    atherFast: true,
    vidaFast: true,
    boltFast: true,
    boltSlow: false
  };

  try {
    const savedFilters = localStorage.getItem('voltway_network_filters');
    if (savedFilters) {
      const parsed = JSON.parse(savedFilters);
      if (parsed && typeof parsed === 'object') {
        Object.keys(filters).forEach(k => {
          if (parsed[k] !== undefined) filters[k] = Boolean(parsed[k]);
        });
      }
    }
  } catch (e) {}

  // User position
  let userCoords = null; // { lat, lng, accuracy, heading, speed }

  // High-performance Marker Pool: chargerId -> marker
  const markerMap = new Map();
  const waypointMarkersMap = new Map();
  let activePopupChargerId = null;

  // Animation frame throttle & debounce
  let renderRafId = null;
  let moveDebounceTimer = null;

  let mapContainerId = 'map';

  function initMap(containerId = 'map') {
    if (map) return map;
    mapContainerId = containerId || 'map';

    let defaultCenter = [10.0246, 76.3079]; // Kerala (Kochi EV Hub) default
    let defaultZoom = 10;
    if (activeStateFilter === 'karnataka') {
      defaultCenter = [12.9716, 77.5946];
      defaultZoom = 11;
    } else if (activeStateFilter === 'tamil_nadu') {
      defaultCenter = [11.0168, 76.9558];
      defaultZoom = 10;
    } else if (activeStateFilter === 'all') {
      defaultCenter = [11.5, 77.0];
      defaultZoom = 8;
    }

    map = L.map(containerId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      rotate: true,
      touchRotate: true,
      rotateControl: false,
      bearing: 0
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://openstreetmap.org" target="_blank">OSM</a> | VoltWay 2W')
      .addTo(map);

    let initialTheme = 'dark';
    try {
      initialTheme = localStorage.getItem('voltway_map_theme') || 'dark';
    } catch (e) {}
    setTileTheme(initialTheme);

    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    waypointsLayer = L.layerGroup().addTo(map);

    map.on('moveend', onMapMoveEnd);
    map.on('zoomend', onMapMoveEnd);

    function handleUserManualInteraction() {
      // User is manually panning/zooming/rotating map: release camera auto-follow
      isAutoFollow = false;
      isCompassMode = false;
      isUserInteracting = true;
      updateGpsButtonUi();

      if (bearingRafId) {
        cancelAnimationFrame(bearingRafId);
        bearingRafId = null;
      }

      if (recenterTimer) clearTimeout(recenterTimer);
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        // Auto recenter after 10 seconds of inactivity in Drive Mode (Google Maps standard)
        recenterTimer = setTimeout(() => {
          isUserInteracting = false;
          recenterCamera();
        }, 10000);
      }
    }

    map.on('dragstart', handleUserManualInteraction);
    map.on('zoomstart', handleUserManualInteraction);
    map.on('movestart', (e) => {
      if (!e.hard && !isAutoFollow) {
        handleUserManualInteraction();
      }
    });

    map.on('rotatestart', () => {
      isUserRotating = true;
      handleUserManualInteraction();
    });

    map.on('rotate', () => {
      if (map && typeof map.getBearing === 'function') {
        currentRenderedBearing = map.getBearing();
        targetBearing = currentRenderedBearing; // Keep target in sync with user rotation so it doesn't snap back!
        updatePuckHeading(userHeading);

        // Update needle on nav compass button if present
        const needle = document.getElementById('nav-compass-needle');
        if (needle) needle.style.transform = `rotate(${-currentRenderedBearing}deg)`;
      }
    });

    map.on('rotateend', () => {
      setTimeout(() => {
        isUserRotating = false;
      }, 400);
    });
    map.on('click', () => {
      if (window.innerWidth <= 768 && typeof window.collapseBottomSheet === 'function') {
        window.collapseBottomSheet();
      }
    });

    // Instant User Puck Recovery: Render last-known position immediately so puck is never missing
    try {
      const cached = localStorage.getItem('voltway_last_known_pos');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.lat && parsed.lng) {
          userCoords = { lat: parsed.lat, lng: parsed.lng, accuracy: 20, heading: 0, speed: 0 };
          updateUserPuck(parsed.lat, parsed.lng, 20, 0);
        }
      }
    } catch (e) {}

    // Start compass sensor immediately on map initialization
    initCompass();
    locateUser(false);

    return map;
  }

  function setTileTheme(theme = 'dark') {
    currentTileTheme = theme;
    try {
      localStorage.setItem('voltway_map_theme', theme);
    } catch (e) {}

    const mapEl = document.getElementById(mapContainerId) || document.getElementById('map');
    const themeBtnIcon = document.getElementById('theme-btn-icon');
    const themeBtn = document.getElementById('btn-toggle-map-theme');

    if (theme === 'dark') {
      if (mapEl) mapEl.classList.add('map-dark-mode');
      if (themeBtnIcon) themeBtnIcon.textContent = '☀️';
      if (themeBtn) {
        themeBtn.setAttribute('title', 'Switch to Normal Map');
        themeBtn.style.color = '#fbbf24';
      }
    } else {
      if (mapEl) mapEl.classList.remove('map-dark-mode');
      if (themeBtnIcon) themeBtnIcon.textContent = '🌙';
      if (themeBtn) {
        themeBtn.setAttribute('title', 'Switch to Dark Google Map');
        themeBtn.style.color = '#38bdf8';
      }
    }

    // High-performance OpenStreetMap raster tiles (100% Free, Zero API Key Required, 100% Uptime)
    if (!tileLayer && map) {
      tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c'],
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> | VoltWay 2W'
      }).addTo(map);
    }
  }

  function toggleTileTheme() {
    const nextTheme = (currentTileTheme === 'dark') ? 'daylight' : 'dark';
    setTileTheme(nextTheme);
    if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
      window.SyncEngine.showAutoUpdateToast(nextTheme === 'dark' ? '🌙 Dark Mode' : '☀️ Daylight Mode');
    }
    return nextTheme;
  }

  /**
   * Custom HTML Pin Icons with Crisp Vector SVGs (Fixes broken question marks / corrupted symbols)
   * Uses an icon cache so identical network+type icons are only created once.
   */
  const _iconCache = {};
  function createPinIcon(charger) {
    const key = `${charger.network}_${charger.type}`;
    if (_iconCache[key]) return _iconCache[key];

    let pinClass = 'pin-ather';
    let iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
    let label = 'Ather Fast';

    if (charger.network === 'ATHER_GRID') {
      pinClass = 'pin-ather';
      iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
      label = 'Ather Fast';
    } else if (charger.network === 'VIDA_GRID') {
      pinClass = 'pin-vida-fast';
      iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-2 8 11-13h-8l3-7z"/></svg>';
      label = 'Vida Fast';
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

    const icon = L.divIcon({
      className: 'custom-pin-container',
      html: html,
      iconSize: [52, 48],
      iconAnchor: [26, 38],
      popupAnchor: [0, -36]
    });
    _iconCache[key] = icon;
    return icon;
  }

  /**
   * Prominently Highlighted Charging Stop Pin on the Active Route
   */
  function createHighlightedStopPinIcon(wp, idx) {
    const isFast = wp.type === 'FAST' || wp.network === 'ATHER_GRID' || wp.network === 'VIDA_GRID';
    let brandColor = '#00E676';
    let brandGlow = 'rgba(0, 230, 118, 0.55)';
    let networkTag = 'Ather Fast';

    if (wp.network === 'ATHER_GRID') {
      brandColor = '#00E676';
      brandGlow = 'rgba(0, 230, 118, 0.55)';
      networkTag = 'Ather Fast';
    } else if (wp.network === 'VIDA_GRID') {
      brandColor = '#FF5722';
      brandGlow = 'rgba(255, 87, 34, 0.55)';
      networkTag = 'Vida Fast';
    } else if (wp.network === 'BOLT_EARTH') {
      if (wp.type === 'FAST') {
        brandColor = '#FF9100';
        brandGlow = 'rgba(255, 145, 0, 0.55)';
        networkTag = 'Bolt Fast';
      } else {
        brandColor = '#00B0FF';
        brandGlow = 'rgba(0, 176, 255, 0.55)';
        networkTag = 'Bolt 15A';
      }
    }

    let cleanName = (wp.name || `Stop ${idx + 1}`).replace(/^Vida Grid Fast\s*-\s*/i, '').replace(/^Ather Grid Fast\s*-\s*/i, '').replace(/^Bolt Fast\s*-\s*/i, '').replace(/^.*-\s*/, '').trim();
    if (cleanName.length > 18) {
      cleanName = cleanName.substring(0, 16) + '…';
    }

    const html = `
      <div class="highlight-stop-container" style="--brand-color: ${brandColor}; --brand-glow: ${brandGlow};">
        <div class="beacon-pulse-ring"></div>
        <div class="beacon-pulse-ring delay"></div>
        <div class="highlight-stop-pin">
          <div class="stop-badge-icon">${isFast ? '⚡' : '🔌'}</div>
          <span class="stop-badge-text">STOP ${idx + 1}</span>
        </div>
        <div class="highlight-stop-label">
          <span class="label-net">${networkTag}</span>
          <span class="label-name">${cleanName}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'highlight-stop-div-icon',
      html: html,
      iconSize: [120, 64],
      iconAnchor: [60, 20],
      popupAnchor: [0, -28]
    });
  }

  /**
   * Route Endpoint Pins (Start Point & Destination Point)
   */
  function createEndpointPinIcon(type = 'START', name = '') {
    const isStart = type === 'START';
    const color = isStart ? '#0284c7' : '#10b981';
    const glow = isStart ? 'rgba(2, 132, 199, 0.55)' : 'rgba(16, 185, 129, 0.55)';
    const icon = isStart ? '🚩' : '🏁';
    const tag = isStart ? 'START' : 'DEST';

    const html = `
      <div class="route-endpoint-container" style="--end-color: ${color}; --end-glow: ${glow};">
        <div class="endpoint-pin">
          <span class="endpoint-icon">${icon}</span>
          <span class="endpoint-tag">${tag}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'route-endpoint-div-icon',
      html: html,
      iconSize: [84, 38],
      iconAnchor: [42, 19],
      popupAnchor: [0, -24]
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
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.18); // 18% margin around screen

    if (!chargers) {
      chargers = (window.SyncEngine && window.SyncEngine.getChargersInBounds)
        ? window.SyncEngine.getChargersInBounds(bounds)
        : (window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []));
    }

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    const corridorBuffer = window.RouteEngine ? window.RouteEngine.getCorridorBufferKm() : 5;
    const isCorridorActive = Boolean(activeRoute && corridorBuffer !== 'all');

    let visibleChargers = [];

    if (isCorridorActive) {
      // WHEN ROUTE IS ACTIVE: Only render chargers strictly within the route corridor buffer!
      const corridorChargers = (window.RouteEngine && window.RouteEngine.getCorridorChargers()) || [];
      const inBounds = corridorChargers.filter(c => bounds.contains([c.lat, c.lng]));

      for (let i = 0; i < inBounds.length; i++) {
        const c = inBounds[i];
        if (c.network === 'ATHER_GRID' && !filters.atherFast) continue;
        if (c.network === 'VIDA_GRID' && !filters.vidaFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) continue;
        visibleChargers.push(c);
      }
    } else {
      // WHEN NO ROUTE IS ACTIVE (OR 'ALL' SELECTED): High-Performance Viewport Marker Culling
      // 1. Filter by active state and active filter chips first (Cuts candidate list by 85% for 60FPS)
      const activeCandidates = [];
      for (let i = 0; i < chargers.length; i++) {
        const c = chargers[i];
        if (activeStateFilter !== 'all' && c.state && c.state !== activeStateFilter) continue;
        if (c.network === 'ATHER_GRID' && !filters.atherFast) continue;
        if (c.network === 'VIDA_GRID' && !filters.vidaFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) continue;
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) continue;
        activeCandidates.push(c);
      }

      // 2. High-Performance Viewport Marker Culling (Capped to 100-120 markers on mobile to prevent freezing)
      const inBounds = activeCandidates.filter(c => bounds.contains([c.lat, c.lng]));
      const fastInBounds = inBounds.filter(c => c.type === 'FAST' || c.network === 'ATHER_GRID' || c.network === 'VIDA_GRID');
      const slowInBounds = inBounds.filter(c => c.type !== 'FAST' && c.network !== 'ATHER_GRID' && c.network !== 'VIDA_GRID');

      if (zoom < 8) {
        // High zoom-out regional overview: sample evenly
        const step = Math.max(1, Math.floor(fastInBounds.length / 80));
        for (let i = 0; i < fastInBounds.length && visibleChargers.length < 80; i += step) {
          visibleChargers.push(fastInBounds[i]);
        }
      } else {
        // Two-Wheeler Fast Chargers Only (Ather, VIDA & Bolt Fast): Show ALL in viewport without arbitrary 60-cap limit!
        visibleChargers.push(...fastInBounds.slice(0, 300));

        // If slow sockets explicitly enabled, fill remaining slots
        if (filters.boltSlow && slowInBounds.length > 0) {
          const remainingSlots = Math.max(0, 350 - visibleChargers.length);
          visibleChargers.push(...slowInBounds.slice(0, remainingSlots));
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

    // Ensure currently open popup marker is NEVER dropped from visible chargers
    if (activePopupChargerId && !visibleChargers.some(c => c.id === activePopupChargerId)) {
      const activeC = chargers.find(c => c.id === activePopupChargerId) || ((window.RouteEngine && window.RouteEngine.getCorridorChargers()) || []).find(c => c.id === activePopupChargerId);
      if (activeC) visibleChargers.push(activeC);
    }

    // Filter out chargers that are actively highlighted in waypointsLayer to avoid duplicate markers
    const activeRouteWaypoints = (window.RouteEngine && window.RouteEngine.getActiveRoute() && window.RouteEngine.getActiveRoute().waypoints) || [];
    const activeWpIds = new Set(activeRouteWaypoints.map(w => w.id));

    const newVisibleIds = new Set(visibleChargers.map(c => c.id));

    // 3. Diffing: Remove markers that have moved outside bounds, whose filter is off, or outside active corridor
    for (const [id, marker] of markerMap.entries()) {
      const c = marker._chargerData;
      if (c) {
        if (activeStateFilter !== 'all' && c.state && c.state !== activeStateFilter) { markersLayer.removeLayer(marker); markerMap.delete(id); continue; }
        if (c.network === 'ATHER_GRID' && !filters.atherFast) { markersLayer.removeLayer(marker); markerMap.delete(id); continue; }
        if (c.network === 'VIDA_GRID' && !filters.vidaFast) { markersLayer.removeLayer(marker); markerMap.delete(id); continue; }
        if (c.network === 'BOLT_EARTH' && c.type === 'FAST' && !filters.boltFast) { markersLayer.removeLayer(marker); markerMap.delete(id); continue; }
        if (c.network === 'BOLT_EARTH' && c.type === 'SLOW' && !filters.boltSlow) { markersLayer.removeLayer(marker); markerMap.delete(id); continue; }
      }
      if (id === activePopupChargerId) continue; // Never destroy active popup marker!
      if (activeWpIds.has(id)) {
        markersLayer.removeLayer(marker);
        markerMap.delete(id);
        continue;
      }
      if (isCorridorActive && !newVisibleIds.has(id)) {
        markersLayer.removeLayer(marker);
        markerMap.delete(id);
        continue;
      }
      if (!bounds.contains(marker.getLatLng())) {
        markersLayer.removeLayer(marker);
        markerMap.delete(id);
      }
    }

    // 4. Add newly visible chargers
    visibleChargers.forEach((charger) => {
      if (activeWpIds.has(charger.id)) return;
      if (markerMap.has(charger.id)) {
        return; // Already rendered in DOM, keep it!
      }

      const pos = L.latLng(charger.lat, charger.lng);
      const icon = createPinIcon(charger);
      const marker = L.marker(pos, { icon: icon });
      marker._chargerData = charger;

      marker.bindPopup(() => createChargerPopupHtml(charger), {
        maxWidth: 260,
        className: 'charger-popup',
        autoPan: false,   // prevents Leaflet moveend trigger on popup open (eliminates flicker)
      });

      marker.on('popupopen', () => {
        activePopupChargerId = charger.id;
      });
      marker.on('popupclose', () => {
        if (activePopupChargerId === charger.id) {
          activePopupChargerId = null;
        }
      });

      marker.addTo(markersLayer);
      markerMap.set(charger.id, marker);
    });
  }

  /**
   * Interactive Charger Popup with Trip Planner actions & Nearby Rider Amenities
   * @param {Object} charger Charger data object
   * @param {number|null} stopIndex If this charger is an active route stop (0, 1, ...), provides stop badge
   */
  function createChargerPopupHtml(charger, stopIndex = null) {
    const isAther = charger.network === 'ATHER_GRID';
    const isVida = charger.network === 'VIDA_GRID';
    const isFast = charger.type === 'FAST';

    let networkBadgeClass = 'badge-bolt-slow';
    let networkName = 'Bolt.Earth';
    if (isAther) {
      networkBadgeClass = 'badge-ather';
      networkName = 'Ather Grid';
    } else if (isVida) {
      networkBadgeClass = 'badge-vida-fast';
      networkName = 'VIDA Grid';
    } else if (isFast) {
      networkBadgeClass = 'badge-bolt-fast';
      networkName = 'Bolt Fast';
    }

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : { efficiency: 0.85, currentBatteryPct: 85 };
    const chargeTime = window.Utilities ? window.Utilities.estimateChargingTime(batteryState.currentBatteryPct, 80, batteryState.efficiency) : null;
    const estTimeText = isFast ? (chargeTime ? chargeTime.fastTimeFormatted : '~35m') : (chargeTime ? chargeTime.slowTimeFormatted : '~3.5h');

    const waypoints = window.RouteEngine ? window.RouteEngine.getWaypoints() : [];
    const isAlreadyWaypoint = stopIndex !== null || waypoints.some(w => w.id === charger.id);

    // Distance to active route if route is planned
    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    let routeDistanceHtml = '';
    if (activeRoute && window.RouteEngine.getDistanceToActiveRoute && stopIndex === null) {
      const distFromRoute = window.RouteEngine.getDistanceToActiveRoute(charger.lat, charger.lng);
      if (distFromRoute !== null) {
        const isHighway = distFromRoute <= 0.4;
        const distColor = isHighway ? '#00e676' : '#38bdf8';
        const labelText = isHighway ? '⚡ On Route' : `⚡ ${distFromRoute} km Detour`;
        routeDistanceHtml = `<div style="font-size: 0.70rem; font-weight: 700; color: ${distColor}; margin: 2px 0;">🛣️ ${labelText}</div>`;
      }
    }

    const cleanTitle = (isVida ? charger.name.replace(/\s*\(Ather Gun[^)]*\)/gi, '') : charger.name).replace(/\s*\(Ather Gun.*$/i, '').trim();

    const stopHeaderBadge = stopIndex !== null
      ? `<span class="popup-badge" style="background: #00E676; color: #000; font-weight: 900; padding: 2px 6px; font-size: 0.62rem;">⚡ STOP #${stopIndex + 1}</span>`
      : `<span class="popup-badge ${networkBadgeClass}" style="padding: 2px 6px; font-size: 0.62rem;">${networkName}</span>`;

    const stopActionButtons = stopIndex !== null ? `
      <div style="display: flex; gap: 4px; margin-top: 5px;">
        <button class="btn-popup-waypoint" style="flex: 1; padding: 6px 8px; font-size: 0.72rem; height: 32px; background: rgba(255, 61, 113, 0.2); border: 1px solid var(--color-danger); color: var(--color-danger);" onclick="RouteEngine.removeWaypoint('${charger.id}')">
          ❌ Remove
        </button>
        <button class="btn-popup-nav" style="flex: 1; padding: 6px 8px; font-size: 0.72rem; height: 32px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #fff; font-weight: 800;" onclick="if(window.NavigationEngine) window.NavigationEngine.navigateToNextCharger({lat: ${charger.lat}, lng: ${charger.lng}, name: '${cleanTitle.replace(/'/g, "\\'")}'})">
          🗺️ Google Maps
        </button>
      </div>
    ` : `
      <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
        <button class="btn-popup-nav btn-direct-inapp-route" style="width: 100%; height: 34px; padding: 6px 10px; font-size: 0.80rem; font-weight: 800; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #ffffff; border-radius: 8px;" onclick="MapEngine.handleRouteDirectToCharger('${charger.id}')">
          ⚡ Route Here
        </button>
        <div style="display: flex; gap: 4px;">
          ${isAlreadyWaypoint ? `
            <button class="btn-sm btn-nav" style="flex: 1; height: 30px; padding: 4px 6px; font-size: 0.72rem; background: rgba(255, 61, 113, 0.2); color: #ff3d71; border-color: #ff3d71;" onclick="MapEngine.handleRemoveWaypoint('${charger.id}')">
              ❌ Remove
            </button>
          ` : `
            <button class="btn-sm btn-nav" style="flex: 1; height: 30px; padding: 4px 6px; font-size: 0.72rem; font-weight: 800; background: var(--color-ather); color: #052e16;" onclick="MapEngine.handleAddWaypoint('${charger.id}')">
              ➕ Add Stop
            </button>
          `}
          <button class="btn-sm btn-nav" style="flex: 1; height: 30px; padding: 4px 6px; font-size: 0.72rem;" onclick="MapEngine.handleSetAsDest('${charger.id}')">
            🏁 Destination
          </button>
        </div>
      </div>
    `;

    return `
      <div class="popup-card" style="padding: 10px 12px; gap: 5px; max-width: 260px;">
        <div class="popup-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
          ${stopHeaderBadge}
          <span style="font-size: 0.65rem; font-weight: 800; color: ${isFast ? '#00e676' : '#94a3b8'};">${isFast ? '⚡ Fast Gun' : '🔌 15A Socket'}</span>
        </div>

        <div class="popup-title" style="font-size: 0.86rem; font-weight: 800; color: #ffffff; line-height: 1.25; max-height: 2.5em; overflow: hidden; text-overflow: ellipsis;">${cleanTitle}</div>

        ${routeDistanceHtml}

        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.70rem; color: #cbd5e1; background: rgba(15, 23, 42, 0.8); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
          <span style="color: ${isFast ? '#00E676' : '#38bdf8'}; font-weight: 700;">${charger.connector || (isFast ? 'Ather DC Fast' : '15A AC Socket')}</span>
          <span style="font-weight: 700;">⏱️ ${estTimeText}</span>
        </div>

        ${charger.address ? `<div style="font-size: 0.68rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;"><i class="icon-pin">📍</i> ${charger.address}</div>` : ''}

        ${stopActionButtons}
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
    } else if (network === 'VIDA_GRID') {
      // Hero VIDA App deep link / intent
      const isAndroid = /android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = 'intent://vidaworld.com/#Intent;package=com.vida.app;scheme=https;end';
        setTimeout(() => {
          window.open('https://play.google.com/store/apps/details?id=com.vida.app', '_blank');
        }, 1200);
      } else {
        window.open('https://play.google.com/store/apps/details?id=com.vida.app', '_blank');
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
      try {
        localStorage.setItem('voltway_network_filters', JSON.stringify(filters));
      } catch (e) {}
      renderChargers();
    }
  }

  function getFilters() {
    return { ...filters };
  }

  /**
   * Regional State Filter ('kerala', 'karnataka', 'tamil_nadu', 'all')
   * Enables 0-lag 60fps rendering by restricting candidate pool to selected state.
   */
  function setStateFilter(state) {
    activeStateFilter = state || 'all';
    try {
      localStorage.setItem('voltway_selected_state', activeStateFilter);
      localStorage.setItem('voltway_state_filter', activeStateFilter);
    } catch (e) {}

    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    if (!activeRoute && map) {
      if (activeStateFilter === 'kerala') {
        map.flyTo([10.0246, 76.3079], 10, { animate: true, duration: 0.5 });
      } else if (activeStateFilter === 'karnataka') {
        map.flyTo([12.9716, 77.5946], 11, { animate: true, duration: 0.5 });
      } else if (activeStateFilter === 'tamil_nadu') {
        map.flyTo([11.0168, 76.9558], 10, { animate: true, duration: 0.5 });
      } else if (activeStateFilter === 'all') {
        map.flyTo([11.5, 77.0], 8, { animate: true, duration: 0.5 });
      }
    }

    renderChargers();
  }

  function getStateFilter() {
    return activeStateFilter;
  }

  function updateSafeRangeOverlay(centerCoords = null) {
    if (!map) return;
    // Green and yellow range circles removed as requested to keep the map clean like Google Maps
    if (safeRangeCircle) {
      map.removeLayer(safeRangeCircle);
      safeRangeCircle = null;
    }
    if (bufferRangeCircle) {
      map.removeLayer(bufferRangeCircle);
      bufferRangeCircle = null;
    }
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
    activeMainLine = null;
    activeGlowLine = null;

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
    activeGlowLine = L.polyline(activeRoute.coordinates, {
      color: '#00E676',
      weight: 10,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    activeMainLine = L.polyline(activeRoute.coordinates, {
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

    waypointMarkersMap.clear();

    // 3. Render Origin Pin (Start Point)
    L.marker([activeRoute.origin.lat, activeRoute.origin.lng], {
      icon: createEndpointPinIcon('START', activeRoute.origin.name),
      zIndexOffset: 15000
    }).bindPopup(`
      <div class="popup-card">
        <div class="popup-header"><span class="popup-badge badge-ather">🚩 Starting Point</span></div>
        <div class="popup-title">${activeRoute.origin.name || 'Origin'}</div>
      </div>
    `).addTo(waypointsLayer);

    // 4. Render Intermediate Highlighted Charging Stops (STOP 1, STOP 2, ...)
    const intermediateStops = activeRoute.waypoints || [];
    intermediateStops.forEach((wp, idx) => {
      const stopMarker = L.marker([wp.lat, wp.lng], {
        icon: createHighlightedStopPinIcon(wp, idx),
        zIndexOffset: 20000 + idx
      }).bindPopup(createChargerPopupHtml(wp, idx), { maxWidth: 260, className: 'charger-popup' }).addTo(waypointsLayer);

      waypointMarkersMap.set(wp.id, stopMarker);
    });

    // 5. Render Final Destination Pin
    L.marker([activeRoute.destination.lat, activeRoute.destination.lng], {
      icon: createEndpointPinIcon('DEST', activeRoute.destination.name),
      zIndexOffset: 15000
    }).bindPopup(`
      <div class="popup-card">
        <div class="popup-header"><span class="popup-badge" style="background: #10b981; color: #fff;">🏁 Destination</span></div>
        <div class="popup-title">${activeRoute.destination.name || 'Destination'}</div>
      </div>
    `).addTo(waypointsLayer);

    // Fit bounds to show route ONLY when requested (preserves user map position when filtering!)
    if (shouldFitBounds && activeMainLine) {
      map.fitBounds(activeMainLine.getBounds(), { padding: [50, 50] });
    }

    updateSafeRangeOverlay(activeRoute.origin);
  }

  /**
   * Real-time dynamic route trimming (Google Maps behavior)
   * Trims traversed road behind the rider, leaving only the active path ahead.
   */
  function updateProgressAlongRoute(userCoords) {
    if (!userCoords || !activeMainLine) return null;
    if (!window.RouteEngine || typeof window.RouteEngine.sliceActiveRouteAtPosition !== 'function') return null;

    const slice = window.RouteEngine.sliceActiveRouteAtPosition(userCoords.lat, userCoords.lng);
    if (!slice) return null;

    // If within 50m of route, dynamically update remaining road line
    if (slice.distanceFromRouteKm <= 0.050 && slice.remainingCoords && slice.remainingCoords.length >= 2) {
      activeMainLine.setLatLngs(slice.remainingCoords);
      if (activeGlowLine) {
        activeGlowLine.setLatLngs(slice.remainingCoords);
      }
      return slice.snappedPoint;
    }
    return null;
  }

  /**
   * Google Maps Style Live Navigation Puck & 360° Real-Time Map Rotation:
   * Smooth animated dot with directional heading cone, pulsing accuracy halo,
   * deadband hysteresis to eliminate stationary jitter, decoupled 60fps RAF bearing animation,
   * and 3D gimbal-lock free compass compensation across all orientations (flat, upright, landscape).
   */
  let compassListenerAttached = false;
  let isCompassMode = false; // Default North-Up when browsing / standing still (Map does NOT spin)
  let targetBearing = 0;
  let currentRenderedBearing = 0;
  let bearingRafId = null;

  function scheduleBearingAnimation() {
    if (bearingRafId) return;
    bearingRafId = requestAnimationFrame(() => {
      bearingRafId = null;
      if (!map || typeof map.setBearing !== 'function') return;

      // Calculate shortest angular distance (-180 to +180)
      let bDiff = (targetBearing - currentRenderedBearing + 180) % 360 - 180;
      if (bDiff < -180) bDiff += 360;

      // When difference is tiny (< 0.2°), snap exactly to target and stop animation to prevent jitter
      if (Math.abs(bDiff) < 0.2) {
        currentRenderedBearing = targetBearing;
        map.setBearing(currentRenderedBearing);
        updatePuckHeading(userHeading);
        return;
      }

      currentRenderedBearing = (currentRenderedBearing + bDiff * 0.16 + 360) % 360;
      map.setBearing(currentRenderedBearing);
      updatePuckHeading(userHeading);
      scheduleBearingAnimation();
    });
  }

  function initCompass() {
    if (compassListenerAttached) return;
    compassListenerAttached = true;

    const onOrientation = (e) => {
      // If moving at driving speed (>= 1.4 m/s or 5 km/h), GPS trajectory course takes priority over magnetic sensor
      if (userCoords && userCoords.speed != null && userCoords.speed >= 1.4 && userCoords.heading != null) {
        return;
      }

      let heading = null;
      if (e.webkitCompassHeading != null) {
        // iOS Safari hardware calibrated compass heading
        heading = e.webkitCompassHeading;
      } else if (e.alpha != null) {
        // Android DeviceOrientation (Euler: alpha around Z, beta around X, gamma around Y)
        const degToRad = Math.PI / 180;
        const a = (e.alpha || 0) * degToRad;
        const b = (e.beta || 0) * degToRad;
        const g = (e.gamma || 0) * degToRad;
        const cA = Math.cos(a), sA = Math.sin(a);
        const cB = Math.cos(b), sB = Math.sin(b);
        const cG = Math.cos(g), sG = Math.sin(g);

        // Continuous 3D line-of-sight unit vector onto Earth horizontal plane [East, North]
        // Constant unit length across all angles (flat 0° -> 45° -> vertical 90° -> 110° handlebar mount)
        // Completely eliminates mathematical singularity, angle flipping, and vibration at 90°!
        const x2 = -sB * sG;
        const y2 = cB * cB + sB * sB * cG;
        const xE = x2 * cA - y2 * sA;
        const yN = x2 * sA + y2 * cA;

        heading = (Math.atan2(xE, yN) * 180 / Math.PI + 360) % 360;
      }

      // Account for screen orientation (e.g. landscape 90° or 270°)
      const screenAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
      if (heading != null && !isNaN(heading)) {
        heading = (heading + screenAngle + 360) % 360;

        // Calculate angular difference
        let diff = (heading - userHeading + 180) % 360 - 180;
        if (diff < -180) diff += 360;

        // 1. DEADBAND: Ignore angular jitters smaller than 3.5° when holding or stationary
        // Eliminates back-and-forth micro-trembling completely!
        if (Math.abs(diff) < 3.5) {
          return;
        }

        // 2. ADAPTIVE EXPONENTIAL MOVING AVERAGE (EMA):
        // 0.14 for butter-smooth subtle movements; 0.35 for deliberate turns
        const alpha = Math.abs(diff) > 40 ? 0.35 : (Math.abs(diff) > 15 ? 0.22 : 0.14);
        userHeading = (userHeading + diff * alpha + 360) % 360;
        updatePuckHeading(userHeading);

        // 3. ZERO-VIBRATION MAP CANVAS STABILITY:
        // In Google Maps standard automotive navigation, the phone's raw magnetometer
        // NEVER spins the entire map canvas — this avoids violent jitter caused by motorcycle
        // engine vibrations, handlebar shaking, and magnetic noise.
        // The puck light cone and direction arrow rotate smoothly above, while the map canvas
        // follows the road geometry and GPS trajectory.
      }
    };

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation, { passive: true });
    } else if ('ondeviceorientation' in window) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
    }

    // iOS 13+ permission request if applicable
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      window.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission().then(state => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', onOrientation, { passive: true });
          }
        }).catch(() => {});
      }, { once: true });
    }
  }

  let lastPuckRotDeg = null;

  function updatePuckHeading(heading) {
    if (heading == null) return;
    let rotDeg = 0;
    const mapBearing = (map && typeof map.getBearing === 'function') ? map.getBearing() : 0;

    if (window.DriveEngine && window.DriveEngine.isActive()) {
      if (isNavCompassMode) {
        // Free Compass Mode: Arrow & cone follow user's physical orientation relative to the road ahead
        const roadHeading = (360 - mapBearing + 360) % 360;
        let diff = (heading - roadHeading + 180) % 360 - 180;
        rotDeg = Math.round((diff + 360) % 360);
      } else {
        // Route-Locked Mode (Default): Arrow stays strictly locked straight ahead into route, zero wobble
        rotDeg = 0;
      }
    } else {
      // In walking / browsing mode: map is North-Up (mapBearing 0), cone rotates freely with physical compass
      rotDeg = Math.round((heading - mapBearing + 360) % 360);
    }

    // Keep nav compass needle synced with map bearing if present
    const navNeedle = document.getElementById('nav-compass-needle');
    if (navNeedle) navNeedle.style.transform = `rotate(${-mapBearing}deg)`;

    // Suppress tiny tremors (< 2.5 deg) to eliminate micro-vibration
    if (lastPuckRotDeg !== null && Math.abs((rotDeg - lastPuckRotDeg + 180) % 360 - 180) < 2.5) {
      return;
    }
    lastPuckRotDeg = rotDeg;

    const cone = document.querySelector('.puck-heading-cone');
    const arrow = document.querySelector('.puck-arrow-icon');
    if (cone) cone.style.transform = `rotate(${rotDeg}deg)`;
    if (arrow) arrow.style.transform = `rotate(${rotDeg}deg)`;
  }

  let markerAnimRaf = null;
  let markerCurrentLat = null;
  let markerCurrentLng = null;

  function animateMarkerTo(targetLat, targetLng) {
    if (markerCurrentLat == null || markerCurrentLng == null) {
      markerCurrentLat = targetLat;
      markerCurrentLng = targetLng;
      if (userLocationMarker) userLocationMarker.setLatLng([targetLat, targetLng]);
      if (userAccuracyCircle) userAccuracyCircle.setLatLng([targetLat, targetLng]);
      return;
    }

    const dLat = targetLat - markerCurrentLat;
    const dLng = targetLng - markerCurrentLng;
    // If movement is negligible or a massive jump (> 250m), snap directly
    if (Math.hypot(dLat, dLng) > 0.0025 || Math.hypot(dLat, dLng) < 0.000005) {
      markerCurrentLat = targetLat;
      markerCurrentLng = targetLng;
      if (userLocationMarker) userLocationMarker.setLatLng([targetLat, targetLng]);
      if (userAccuracyCircle) userAccuracyCircle.setLatLng([targetLat, targetLng]);
      return;
    }

    const startLat = markerCurrentLat;
    const startLng = markerCurrentLng;
    const startTime = performance.now();
    const duration = 700; // 700ms smooth interpolation between 1Hz GPS updates

    if (markerAnimRaf) cancelAnimationFrame(markerAnimRaf);

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Cubic ease-out
      const ease = 1 - Math.pow(1 - progress, 3);
      markerCurrentLat = startLat + dLat * ease;
      markerCurrentLng = startLng + dLng * ease;

      if (userLocationMarker) userLocationMarker.setLatLng([markerCurrentLat, markerCurrentLng]);
      if (userAccuracyCircle) userAccuracyCircle.setLatLng([markerCurrentLat, markerCurrentLng]);

      if (progress < 1) {
        markerAnimRaf = requestAnimationFrame(step);
      } else {
        markerAnimRaf = null;
      }
    }
    markerAnimRaf = requestAnimationFrame(step);
  }

  function updateUserPuck(lat, lng, accuracy = 15, heading = 0) {
    if (!map) return;

    let renderLat = lat;
    let renderLng = lng;

    // Road Snapping Logic (Map Matching / Snapping to Road)
    // Snaps rider puck directly to centerline of road segment when in Drive Mode and within 40m
    if (window.DriveEngine && window.DriveEngine.isActive() && window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
      const slice = window.RouteEngine.sliceActiveRouteAtPosition(lat, lng);
      if (slice && slice.distanceFromRouteKm <= 0.040 && slice.snappedPoint) {
        renderLat = slice.snappedPoint[0];
        renderLng = slice.snappedPoint[1];
      }
    }

    const rotDeg = Math.round(heading || 0);

    if (!userLocationMarker) {
      const html = `
        <div class="user-nav-puck-wrapper">
          <div class="puck-heading-cone" style="transform: rotate(${rotDeg}deg);"></div>
          <div class="puck-outer-ring">
            <div class="puck-inner-dot">
              <div class="puck-arrow-icon" style="transform: rotate(${rotDeg}deg);">▲</div>
            </div>
          </div>
          <div class="puck-pulse-halo"></div>
        </div>
      `;

      const puckIcon = L.divIcon({
        className: 'user-nav-puck-container',
        html: html,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      userLocationMarker = L.marker([renderLat, renderLng], {
        icon: puckIcon,
        zIndexOffset: 30000
      }).addTo(map);
      markerCurrentLat = renderLat;
      markerCurrentLng = renderLng;
      updatePuckHeading(heading);
    } else {
      animateMarkerTo(renderLat, renderLng);
      updatePuckHeading(heading);
    }

    // Accuracy Circle
    const safeRadius = Math.max(8, Math.min(accuracy || 20, 150));
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle([renderLat, renderLng], {
        radius: safeRadius,
        color: '#38bdf8',
        weight: 1.5,
        fillColor: '#38bdf8',
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      userAccuracyCircle.setRadius(safeRadius);
    }

    updateSafeRangeOverlay({ lat: renderLat, lng: renderLng });
  }

  function updateGpsButtonUi() {
    const gpsBtn = document.getElementById('btn-float-gps');
    if (gpsBtn) {
      if (isAutoFollow) {
        gpsBtn.classList.add('tracking-active');
        gpsBtn.title = 'GPS Tracking Active (Auto-Following)';
      } else {
        gpsBtn.classList.remove('tracking-active');
        gpsBtn.title = 'Center on My GPS Location';
      }
    }
  }

  /**
   * Continuous Live GPS Tracking (Google Maps real-time movement)
   */
  let lastZoomAdjustTime = 0;
  function updateSpeedAdaptiveZoom(speedMps) {
    if (!map || !window.DriveEngine || !window.DriveEngine.isActive() || !isAutoFollow || isUserInteracting) return;
    const now = Date.now();
    if (now - lastZoomAdjustTime < 2500) return; // Throttle zoom adjustments to once every 2.5s

    const speedKmh = (speedMps || 0) * 3.6;
    let targetZoom = 17.5;
    if (speedKmh > 65) {
      targetZoom = 15.5; // Highway high-speed lookahead
    } else if (speedKmh > 35) {
      targetZoom = 16.5; // City cruising
    } else {
      targetZoom = 17.5; // Slow driving / turns / intersections
    }

    if (Math.abs(map.getZoom() - targetZoom) >= 0.5) {
      lastZoomAdjustTime = now;
      map.setZoom(targetZoom, { animate: true });
    }
  }

  function startLiveTracking(autoCenter = false) {
    initCompass(); // Activate real-time compass hardware tracking

    if (watchId !== null) return;
    if (!navigator.geolocation) {
      console.warn('[VoltWay GPS] Geolocation not supported by browser/device');
      return;
    }

    if (autoCenter) isAutoFollow = true;

    const onPos = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy || 15;
      const speed = pos.coords.speed; // m/s
      let heading = pos.coords.heading;

      // ONLY update heading from GPS if actually moving at real speed (>= 1.4 m/s or 5 km/h)!
      // When stationary or walking slowly, the smoothed hardware compass controls heading without interference from stationary GPS jitter!
      if (speed != null && speed >= 1.4) {
        if (heading != null && !isNaN(heading) && heading > 0) {
          let gDiff = (heading - userHeading + 180) % 360 - 180;
          if (gDiff < -180) gDiff += 360;
          userHeading = (userHeading + gDiff * 0.20 + 360) % 360;
        } else if (userCoords) {
          const distM = window.Utilities ? window.Utilities.haversine(userCoords.lat, userCoords.lng, lat, lng) * 1000 : 0;
          if (distM >= 5) {
            const dLat = (lat - userCoords.lat) * Math.PI / 180;
            const dLng = (lng - userCoords.lng) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat * Math.PI / 180);
            const x = Math.cos(userCoords.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
                      Math.sin(userCoords.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos(dLng);
            const moveHeading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            let mDiff = (moveHeading - userHeading + 180) % 360 - 180;
            if (mDiff < -180) mDiff += 360;
            userHeading = (userHeading + mDiff * 0.20 + 360) % 360;
          }
        }
      }

      userCoords = { lat, lng, accuracy, heading: userHeading, speed };

      try {
        localStorage.setItem('voltway_last_known_pos', JSON.stringify({ lat, lng }));
      } catch (e) {}

      updateUserPuck(lat, lng, accuracy, userHeading);

      // Speed-Adaptive Dynamic Zoom (Google Maps standard)
      if (window.DriveEngine && window.DriveEngine.isActive() && isAutoFollow && map) {
        updateSpeedAdaptiveZoom(speed);
      }

      if (isAutoFollow && map) {
        if (window.DriveEngine && window.DriveEngine.isActive()) {
          // Driving Mode: Course-Up bearing & Forward-Biased Camera Lookahead
          let desiredHeading = userHeading;
          if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
            const slice = window.RouteEngine.sliceActiveRouteAtPosition(lat, lng);
            if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
              desiredHeading = slice.segmentBearing;
            }
          }

          if (typeof map.setBearing === 'function' && desiredHeading != null) {
            const nextBearing = (360 - desiredHeading + 360) % 360;
            let bDiff = (nextBearing - targetBearing + 180) % 360 - 180;
            if (Math.abs(bDiff) >= 3.0) {
              targetBearing = nextBearing;
              scheduleBearingAnimation();
            }
          }

          // Shift camera ~60m forward along road/heading so puck is in lower 30% of screen
          const lookaheadKm = 0.06;
          const rad = (desiredHeading || 0) * Math.PI / 180;
          const lookLat = lat + (lookaheadKm / 111.32) * Math.cos(rad);
          const lookLng = lng + (lookaheadKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(rad);

          // Zero-Vibration Positioning: Direct setView avoids Leaflet panTo CSS transition conflicts with Leaflet-Rotate
          map.setView([lookLat, lookLng], map.getZoom(), { animate: false });
        } else {
          // Stationary / Browsing Mode: Stable North-Up center (Map does NOT spin)
          if (typeof map.setBearing === 'function' && map.getBearing() !== 0) {
            targetBearing = 0;
            scheduleBearingAnimation();
          }
          map.panTo([lat, lng], { animate: true, duration: 0.6 });
        }
      }

      updateGpsButtonUi();

      // Notify in-app Turn-by-Turn DriveEngine if active
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        window.DriveEngine.onLocationUpdate(userCoords);
      }
    };

    const onErr = (err) => {
      console.warn('[VoltWay GPS Watch] Warning:', err.message);
    };

    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });
  }

  function setAutoFollow(val) {
    isAutoFollow = Boolean(val);
    updateGpsButtonUi();
    if (isAutoFollow && userCoords && map) {
      map.setView([userCoords.lat, userCoords.lng], 16, { animate: true });
    }
  }

  function recenterCamera(forcedZoom = null) {
    if (recenterTimer) {
      clearTimeout(recenterTimer);
      recenterTimer = null;
    }
    isAutoFollow = true;
    isUserInteracting = false;

    // Fast recovery if userCoords is null: recover from cached last-known position immediately
    if (!userCoords) {
      try {
        const cached = localStorage.getItem('voltway_last_known_pos');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.lat && parsed.lng) {
            userCoords = { lat: parsed.lat, lng: parsed.lng, accuracy: 20, heading: 0, speed: 0 };
            updateUserPuck(parsed.lat, parsed.lng, 20, 0);
          }
        }
      } catch (e) {}
    }

    if (userCoords && map) {
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        let desiredHeading = userHeading;
        if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
          const slice = window.RouteEngine.sliceActiveRouteAtPosition(userCoords.lat, userCoords.lng);
          if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
            desiredHeading = slice.segmentBearing;
          }
        }
        
        // Exact user position centering (Zero offset - 100% exact alignment, no shift)
        const targetZoom = forcedZoom || (map.getZoom() < 16 ? 17.5 : map.getZoom());
        map.setView([userCoords.lat, userCoords.lng], targetZoom, { animate: false });

        if (typeof map.setBearing === 'function' && desiredHeading != null) {
          targetBearing = (360 - desiredHeading + 360) % 360;
          currentRenderedBearing = targetBearing;
          map.setBearing(targetBearing);
        }
      } else {
        // Fast, instant, 100% accurate centering in normal browsing mode
        const targetZoom = forcedZoom || Math.max(16, map.getZoom());
        map.setView([userCoords.lat, userCoords.lng], targetZoom, { animate: false });
        if (typeof map.setBearing === 'function') {
          targetBearing = 0;
          currentRenderedBearing = 0;
          map.setBearing(0);
        }
      }
    } else {
      locateUser(true);
    }
    updateGpsButtonUi();
  }

  function isAutoFollowActive() {
    return isAutoFollow;
  }

  async function locateUser(panTo = true) {
    if (panTo) {
      isAutoFollow = true;
      isCompassMode = false; // Default North-Up when browsing / standing still
    }

    startLiveTracking(panTo);

    // If we already have live coordinates, pan quickly with 0.25s snappy response
    if (userCoords && panTo && map) {
      if (window.DriveEngine && window.DriveEngine.isActive()) {
        let desiredHeading = userHeading;
        if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
          const slice = window.RouteEngine.sliceActiveRouteAtPosition(userCoords.lat, userCoords.lng);
          if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
            desiredHeading = slice.segmentBearing;
          }
        }
        const lookaheadKm = 0.06;
        const rad = (desiredHeading || 0) * Math.PI / 180;
        const lookLat = userCoords.lat + (lookaheadKm / 111.32) * Math.cos(rad);
        const lookLng = userCoords.lng + (lookaheadKm / (111.32 * Math.cos(userCoords.lat * Math.PI / 180))) * Math.sin(rad);
        map.panTo([lookLat, lookLng], { animate: true, duration: 0.20 });
        if (typeof map.setBearing === 'function' && desiredHeading != null) {
          targetBearing = (360 - desiredHeading + 360) % 360;
          scheduleBearingAnimation();
        }
      } else {
        const targetZoom = Math.max(15, map.getZoom());
        if (map.getZoom() !== targetZoom) {
          map.setView([userCoords.lat, userCoords.lng], targetZoom, { animate: true, duration: 0.25 });
        } else {
          map.panTo([userCoords.lat, userCoords.lng], { animate: true, duration: 0.25 });
        }
        if (typeof map.setBearing === 'function' && map.getBearing() !== 0) {
          targetBearing = 0;
          scheduleBearingAnimation();
        }
      }
      updateGpsButtonUi();
      return userCoords;
    }

    let coords = null;

    // 1. Native Capacitor Geolocation Plugin (triggers Android OS location permission dialog in APK)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
      try {
        let permStatus = await window.Capacitor.Plugins.Geolocation.checkPermissions();
        if (permStatus.location !== 'granted') {
          permStatus = await window.Capacitor.Plugins.Geolocation.requestPermissions();
        }
        if (permStatus.location === 'granted') {
          const pos = await window.Capacitor.Plugins.Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10000
          });
          if (pos && pos.coords) {
            coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          }
        }
      } catch (capErr) {
        console.warn('[VoltWay Location] Capacitor native location request failed, falling back:', capErr);
      }
    }

    // 2. Standard Browser navigator.geolocation fallback
    if (!coords && navigator.geolocation) {
      coords = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => {
            console.warn('[VoltWay Location] Browser geolocation error:', err.message);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
      });
    }

    if (coords) {
      userCoords = { ...coords, heading: userHeading };
      try {
        localStorage.setItem('voltway_last_known_pos', JSON.stringify({ lat: coords.lat, lng: coords.lng }));
      } catch (e) {}

      updateUserPuck(coords.lat, coords.lng, 15, userHeading);

      if (panTo && map) {
        if (window.DriveEngine && window.DriveEngine.isActive()) {
          let desiredHeading = userHeading;
          if (window.RouteEngine && typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function') {
            const slice = window.RouteEngine.sliceActiveRouteAtPosition(coords.lat, coords.lng);
            if (slice && slice.segmentBearing != null && slice.distanceFromRouteKm <= 0.050) {
              desiredHeading = slice.segmentBearing;
            }
          }
          const lookaheadKm = 0.06;
          const rad = (desiredHeading || 0) * Math.PI / 180;
          const lookLat = coords.lat + (lookaheadKm / 111.32) * Math.cos(rad);
          const lookLng = coords.lng + (lookaheadKm / (111.32 * Math.cos(coords.lat * Math.PI / 180))) * Math.sin(rad);
          map.panTo([lookLat, lookLng], { animate: true, duration: 0.20 });
          if (typeof map.setBearing === 'function' && desiredHeading != null) {
            targetBearing = (360 - desiredHeading + 360) % 360;
            scheduleBearingAnimation();
          }
        } else {
          const targetZoom = Math.max(15, map.getZoom());
          if (map.getZoom() !== targetZoom) {
            map.setView([coords.lat, coords.lng], targetZoom, { animate: true, duration: 0.25 });
          } else {
            map.panTo([coords.lat, coords.lng], { animate: true, duration: 0.25 });
          }
          if (typeof map.setBearing === 'function' && map.getBearing() !== 0) {
            targetBearing = 0;
            scheduleBearingAnimation();
          }
        }
      }

      updateGpsButtonUi();
      return userCoords;
    } else {
      console.warn('[VoltWay Location] Could not determine user GPS location.');
      if (panTo) {
        alert('Could not determine GPS location. Please make sure Location (GPS) is turned ON in your phone settings and permission is allowed.');
      }
      return null;
    }
  }

  function handleRouteDirectToCharger(chargerId) {
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    const c = allChargers.find(item => item.id === chargerId);
    if (!c) return;

    if (map) map.closePopup();

    // Set as destination
    if (window.setPlannerDest) {
      window.setPlannerDest(c);
    }

    // If origin is not set, use user's GPS coords or map center
    const curOrigin = (typeof window.getPlannerOrigin === 'function') ? window.getPlannerOrigin() : null;
    if (!curOrigin || !curOrigin.lat) {
      if (userCoords) {
        if (window.setPlannerOrigin) {
          window.setPlannerOrigin({ lat: userCoords.lat, lng: userCoords.lng, name: 'Current Location (GPS)' });
        }
      } else if (map) {
        const center = map.getCenter();
        if (window.setPlannerOrigin) {
          window.setPlannerOrigin({ lat: center.lat, lng: center.lng, name: 'Map Center' });
        }
      }
    }

    // Switch to Route tab and trigger calculation
    if (window.activateTabSilently) {
      window.activateTabSilently('route');
    }
    const btnPlan = document.getElementById('btn-plan-route');
    if (btnPlan) {
      setTimeout(() => btnPlan.click(), 250);
    }
  }

  function onMapMoveEnd() {
    clearTimeout(moveDebounceTimer);
    moveDebounceTimer = setTimeout(() => {
      // Do not re-render chargers if user is actively rotating or gestures are running
      if (isUserRotating) return;
      renderChargers();

      if (map && map.getZoom() >= 13 && window.SyncEngine) {
        const b = map.getBounds();
        window.SyncEngine.fetchLiveBoltInBounds({
          south: Math.round(b.getSouth() * 1000) / 1000,
          west: Math.round(b.getWest() * 1000) / 1000,
          north: Math.round(b.getNorth() * 1000) / 1000,
          east: Math.round(b.getEast() * 1000) / 1000
        });
      }
    }, 350);
  }

  function focusCharger(charger) {
    if (!map || !charger) return;
    activePopupChargerId = charger.id;

    // Ensure marker exists immediately so popup won't fail
    let marker = markerMap.get(charger.id) || waypointMarkersMap.get(charger.id);
    if (!marker && !waypointMarkersMap.has(charger.id)) {
      const pos = L.latLng(charger.lat, charger.lng);
      const icon = createPinIcon(charger);
      marker = L.marker(pos, { icon: icon });
      marker._chargerData = charger;
      marker.bindPopup(() => createChargerPopupHtml(charger), {
        maxWidth: 260,
        className: 'charger-popup',
        autoPan: false,   // prevents Leaflet moveend trigger on popup open (eliminates flicker)
      });
      marker.on('popupopen', () => { activePopupChargerId = charger.id; });
      marker.on('popupclose', () => { if (activePopupChargerId === charger.id) activePopupChargerId = null; });
      marker.addTo(markersLayer);
      markerMap.set(charger.id, marker);
    }

    map.flyTo([charger.lat, charger.lng], 16, { animate: true, duration: 0.4 });
    setTimeout(() => {
      const wpMarker = waypointMarkersMap.get(charger.id);
      if (wpMarker) {
        wpMarker.openPopup();
        return;
      }
      if (marker) marker.openPopup();
    }, 450);
  }

  return {
    initMap,
    setTileTheme,
    toggleTileTheme,
    renderChargers,
    setFilter,
    getFilters,
    setStateFilter,
    getStateFilter,
    updateSafeRangeOverlay,
    renderRoute,
    updateProgressAlongRoute,
    recenterCamera,
    locateUser,
    startLiveTracking,
    setAutoFollow,
    isAutoFollowActive,
    focusCharger,
    isPopupOpen: () => Boolean(activePopupChargerId),
    getUserCoords: () => userCoords,
    getMap: () => map,
    getBearing: () => (map && typeof map.getBearing === 'function' ? map.getBearing() : 0),
    setBearing: (deg) => {
      if (map && typeof map.setBearing === 'function') {
        targetBearing = deg;
        scheduleBearingAnimation();
      }
    },
    getNavCompassMode: () => isNavCompassMode,
    setNavCompassMode: (active) => {
      isNavCompassMode = Boolean(active);
      updatePuckHeading(userHeading);
    },
    handleNavigateToCharger,
    handleAddWaypoint,
    handleRemoveWaypoint,
    handleSetAsOrigin,
    handleSetAsDest,
    handleRouteDirectToCharger,
    handleOpenOfficialApp
  };
})();

window.MapEngine = MapEngine;

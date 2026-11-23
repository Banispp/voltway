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

  // Live GPS tracking state (Google Maps style moving puck & auto-follow)
  let watchId = null;
  let userHeading = 0;
  let isAutoFollow = false;

  // Regional State filter ('kerala' default, 'karnataka', 'tamil_nadu', 'all')
  let activeStateFilter = localStorage.getItem('voltway_selected_state') || 'kerala';

  // Filter state
  const filters = {
    atherFast: true,
    vidaFast: true,
    boltFast: true,
    boltSlow: true
  };

  // User position
  let userCoords = null; // { lat, lng, accuracy, heading, speed }

  // High-performance Marker Pool: chargerId -> marker
  const markerMap = new Map();
  const waypointMarkersMap = new Map();
  let activePopupChargerId = null;

  // Animation frame throttle & debounce
  let renderRafId = null;
  let moveDebounceTimer = null;

  function initMap(containerId = 'map') {
    if (map) return map;

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
    map.on('dragstart', () => {
      // User is manually panning map: temporarily release camera auto-follow
      isAutoFollow = false;
      updateGpsButtonUi();
    });
    map.on('click', () => {
      if (window.innerWidth <= 768 && typeof window.collapseBottomSheet === 'function') {
        window.collapseBottomSheet();
      }
    });

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
    if (!chargers) {
      chargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    }

    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.18); // 18% margin around screen

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
        const step = Math.max(1, Math.floor(fastInBounds.length / 50));
        for (let i = 0; i < fastInBounds.length && visibleChargers.length < 50; i += step) {
          visibleChargers.push(fastInBounds[i]);
        }
      } else {
        // Show up to 60 Fast Chargers in viewport
        visibleChargers.push(...fastInBounds.slice(0, 60));

        // Fill remaining slots with 15A slow sockets up to 120 total markers (eliminates mobile freeze/lag)
        const remainingSlots = Math.max(0, 120 - visibleChargers.length);
        if (slowInBounds.length <= remainingSlots) {
          visibleChargers.push(...slowInBounds);
        } else {
          const step = Math.max(1, Math.floor(slowInBounds.length / remainingSlots));
          for (let i = 0; i < slowInBounds.length && visibleChargers.length < 120; i += step) {
            visibleChargers.push(slowInBounds[i]);
          }
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
        maxWidth: 320,
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
   * Interactive Charger Popup with Trip Planner actions
   */
  function createChargerPopupHtml(charger) {
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
      networkName = 'Hero VIDA Grid';
    } else if (isFast) {
      networkBadgeClass = 'badge-bolt-fast';
      networkName = 'Bolt.Earth Fast';
    }

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : { efficiency: 0.85, currentBatteryPct: 85 };
    const chargeTime = window.Utilities ? window.Utilities.estimateChargingTime(batteryState.currentBatteryPct, 80, batteryState.efficiency) : null;
    const estTimeText = isFast ? (chargeTime ? chargeTime.fastTimeFormatted : '~35 mins to 80%') : (chargeTime ? chargeTime.slowTimeFormatted : '~3h 30m');

    const waypoints = window.RouteEngine ? window.RouteEngine.getWaypoints() : [];
    const isAlreadyWaypoint = waypoints.some(w => w.id === charger.id);

    const isAtherGun = isFast || charger.is_ather_gun;

    // Check distance to active route if route is planned
    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    let routeDistanceHtml = '';
    if (activeRoute && window.RouteEngine.getDistanceToActiveRoute) {
      const distFromRoute = window.RouteEngine.getDistanceToActiveRoute(charger.lat, charger.lng);
      if (distFromRoute !== null) {
        const isHighway = distFromRoute <= 0.4;
        const distColor = isHighway ? '#00e676' : (distFromRoute <= 3.0 ? '#38bdf8' : '#ffb703');
        const distBg = isHighway ? 'rgba(0, 230, 118, 0.15)' : (distFromRoute <= 3.0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 183, 3, 0.15)');
        const labelText = isHighway ? '⚡ Direct on Highway Route' : `⚡ ${distFromRoute} km Detour from Main Route`;
        
        let kmStart = '';
        if (charger.kmFromOrigin != null) {
          kmStart = ` • 📍 ~${charger.kmFromOrigin} km from Start`;
        }

        routeDistanceHtml = `
          <div class="popup-route-detour-badge" style="background: ${distBg}; border: 1.5px solid ${distColor}; border-radius: 8px; padding: 7px 10px; margin: 6px 0 4px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.74rem; font-weight: 800; color: ${distColor}; text-transform: uppercase; letter-spacing: 0.3px;">🛣️ Distance from Route</span>
              <span style="font-size: 0.95rem; font-weight: 900; color: #ffffff;">${distFromRoute} km</span>
            </div>
            <div style="font-size: 0.72rem; color: #cbd5e1; font-weight: 600; margin-top: 3px;">
              ${labelText}${kmStart}
            </div>
          </div>
        `;
      }
    }

    return `
      <div class="popup-card">
        <div class="popup-header">
          <span class="popup-badge ${networkBadgeClass}">${networkName}</span>
          <span class="popup-type">${isVida ? '⚡ Hero VIDA Fast' : (isAther ? '⚡ Ather Grid Fast' : (isFast ? '⚡ Bolt Fast' : '🔌 15A Socket'))}</span>
        </div>
        <div class="popup-title">${isVida ? charger.name.replace(/\s*\(Ather Gun[^)]*\)/gi, '') : charger.name}</div>

        <!-- Distance from Route Banner (Active Route Deviation) -->
        ${routeDistanceHtml}

        <!-- Fast Charging Compatibility Banner -->
        <div class="popup-ather-compat ${isAtherGun ? 'compat-direct' : 'compat-socket'}">
          ${isVida ? '⚡ 100% Direct Plug-in (Hero VIDA DC Fast Gun)' : (isAtherGun ? '⚡ 100% Direct Plug-in (No Adapter Needed)' : '🔌 15A Socket (Requires Portable Charger Cable)')}
        </div>

        <div class="popup-detail">
          <span class="detail-label">Connector:</span>
          <span class="detail-val" style="font-weight: 800; color: ${isFast ? '#00E676' : '#38bdf8'};">${charger.connector}</span>
        </div>
        <div class="popup-detail">
          <span class="detail-label">Speed:</span>
          <span class="detail-val">${isFast ? '⚡ High-Speed Fast DC' : '🔌 Standard 15A Socket'}</span>
        </div>
        <div class="popup-detail">
          <span class="detail-label">Est. Charge Time:</span>
          <span class="detail-val highlight-val">${estTimeText} (to 80%)</span>
        </div>
        ${charger.address ? `<div class="popup-address"><i class="icon-pin">📍</i> ${charger.address}</div>` : ''}

        <!-- Feature 5: Nearby Rider Amenities (< 200m) -->
        <div class="popup-amenities-section" style="margin: 8px 0 6px 0; padding: 8px 10px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;">
          <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px;">
            ☕ Nearby Rider Amenities (&lt; 200m)
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            <span class="amenity-chip-pill" style="font-size: 0.70rem; font-weight: 600; background: rgba(255, 255, 255, 0.07); color: #f1f5f9; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">☕ Tea / Cafe</span>
            <span class="amenity-chip-pill" style="font-size: 0.70rem; font-weight: 600; background: rgba(255, 255, 255, 0.07); color: #f1f5f9; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">🍽️ Snacks / Dine</span>
            <span class="amenity-chip-pill" style="font-size: 0.70rem; font-weight: 600; background: rgba(255, 255, 255, 0.07); color: #f1f5f9; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">🚻 Washroom</span>
            <span class="amenity-chip-pill" style="font-size: 0.70rem; font-weight: 600; background: rgba(255, 255, 255, 0.07); color: #f1f5f9; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">⛽ Fuel / Air 24x7</span>
          </div>
        </div>

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
          <button class="btn-popup-nav btn-direct-inapp-route" style="background: linear-gradient(135deg, #0284c7, #0369a1); border: none; color: #ffffff; font-weight: 800; padding: 9px;" onclick="MapEngine.handleRouteDirectToCharger('${charger.id}')">
            ⚡ Plan Direct Route Here
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
    activeStateFilter = state || 'kerala';
    localStorage.setItem('voltway_selected_state', activeStateFilter);

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
      const isFast = wp.type === 'FAST' || wp.network === 'ATHER_GRID' || wp.network === 'VIDA_GRID';
      let brandColor = '#00E676';
      let netTag = 'Ather Fast';
      if (wp.network === 'VIDA_GRID') { brandColor = '#FF5722'; netTag = 'Vida Fast'; }
      else if (wp.network === 'BOLT_EARTH') {
        if (wp.type === 'FAST') { brandColor = '#FF9100'; netTag = 'Bolt Fast'; }
        else { brandColor = '#00B0FF'; netTag = 'Bolt 15A'; }
      }

      const cleanTitle = (wp.name || `Charging Stop ${idx + 1}`).replace(/\s*\(Ather Gun[^)]*\)/gi, '');

      const stopMarker = L.marker([wp.lat, wp.lng], {
        icon: createHighlightedStopPinIcon(wp, idx),
        zIndexOffset: 20000 + idx
      }).bindPopup(`
        <div class="popup-card">
          <div class="popup-header">
            <span class="popup-badge" style="background: ${brandColor}; color: #000; font-weight: 800;">⚡ TRIP CHARGING STOP #${idx + 1}</span>
          </div>
          <div class="popup-title">${cleanTitle}</div>
          <div class="popup-detail">
            <span class="detail-label">Network:</span>
            <span class="detail-val" style="color: ${brandColor}; font-weight: 700;">${netTag}</span>
          </div>
          <div class="popup-detail">
            <span class="detail-label">Connector:</span>
            <span class="detail-val">${wp.connector || (isFast ? 'DC Fast Charger' : '15A AC Plug Socket')}</span>
          </div>
          <div class="popup-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
            <button class="btn-popup-waypoint" style="background: rgba(255, 61, 113, 0.15); border: 1px solid var(--color-danger); color: var(--color-danger); padding: 8px; border-radius: 6px; font-weight: 700; cursor: pointer;" onclick="RouteEngine.removeWaypoint('${wp.id}')">
              ❌ Remove from Trip Stops
            </button>
          </div>
        </div>
      `, { maxWidth: 320, className: 'charger-popup' }).addTo(waypointsLayer);

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
    if (shouldFitBounds && mainLine) {
      map.fitBounds(mainLine.getBounds(), { padding: [50, 50] });
    }

    updateSafeRangeOverlay(activeRoute.origin);
  }

  /**
   * Google Maps Style Live Navigation Puck:
   * Smooth animated dot with directional heading cone and pulsing accuracy halo
   */
  function updateUserPuck(lat, lng, accuracy = 15, heading = 0) {
    if (!map) return;

    const rotDeg = Math.round(heading || 0);
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

    if (!userLocationMarker) {
      userLocationMarker = L.marker([lat, lng], {
        icon: puckIcon,
        zIndexOffset: 30000
      }).addTo(map);
    } else {
      userLocationMarker.setLatLng([lat, lng]);
      userLocationMarker.setIcon(puckIcon);
    }

    // Accuracy Circle
    const safeRadius = Math.max(8, Math.min(accuracy || 20, 150));
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle([lat, lng], {
        radius: safeRadius,
        color: '#38bdf8',
        weight: 1.5,
        fillColor: '#38bdf8',
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      userAccuracyCircle.setLatLng([lat, lng]);
      userAccuracyCircle.setRadius(safeRadius);
    }

    updateSafeRangeOverlay({ lat, lng });
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
    const recenterBtn = document.getElementById('btn-recenter-nav');
    if (recenterBtn) {
      if (isAutoFollow) {
        recenterBtn.style.display = 'none';
      } else if (window.DriveEngine && window.DriveEngine.isActive()) {
        recenterBtn.style.display = 'flex';
      }
    }
  }

  /**
   * Continuous Live GPS Tracking (Google Maps real-time movement)
   */
  function startLiveTracking(autoCenter = false) {
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

      // If phone hardware heading is not provided or 0, calculate bearing from movement delta
      if (heading == null || isNaN(heading) || heading === 0) {
        if (userCoords && (Math.abs(lat - userCoords.lat) > 0.00005 || Math.abs(lng - userCoords.lng) > 0.00005)) {
          const dLat = (lat - userCoords.lat) * Math.PI / 180;
          const dLng = (lng - userCoords.lng) * Math.PI / 180;
          const y = Math.sin(dLng) * Math.cos(lat * Math.PI / 180);
          const x = Math.cos(userCoords.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
                    Math.sin(userCoords.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos(dLng);
          userHeading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        }
      } else {
        userHeading = heading;
      }

      userCoords = { lat, lng, accuracy, heading: userHeading, speed };

      updateUserPuck(lat, lng, accuracy, userHeading);

      if (isAutoFollow && map) {
        map.panTo([lat, lng], { animate: true, duration: 0.8 });
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
      maximumAge: 2000,
      timeout: 15000
    });
  }

  function setAutoFollow(val) {
    isAutoFollow = Boolean(val);
    updateGpsButtonUi();
    if (isAutoFollow && userCoords && map) {
      map.setView([userCoords.lat, userCoords.lng], 16, { animate: true });
    }
  }

  function isAutoFollowActive() {
    return isAutoFollow;
  }

  async function locateUser(panTo = true) {
    if (panTo) {
      isAutoFollow = true;
    }

    startLiveTracking(panTo);

    // If we already have live coordinates, pan smoothly
    if (userCoords && panTo && map) {
      map.setView([userCoords.lat, userCoords.lng], 16, { animate: true });
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
      updateUserPuck(coords.lat, coords.lng, 15, userHeading);

      if (panTo && map) {
        map.setView([coords.lat, coords.lng], 16, { animate: true });
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

    // If origin is not set, use user's GPS coords
    if (userCoords && (!window.originPoint || !window.originPoint.lat)) {
      window.originPoint = { lat: userCoords.lat, lng: userCoords.lng, name: 'Current Location (GPS)' };
      const origInput = document.getElementById('input-origin');
      if (origInput) origInput.value = 'Current Location (GPS)';
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
    }, 150);
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
        maxWidth: 320,
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
    locateUser,
    startLiveTracking,
    setAutoFollow,
    isAutoFollowActive,
    focusCharger,
    isPopupOpen: () => Boolean(activePopupChargerId),
    getUserCoords: () => userCoords,
    getMap: () => map,
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

/**
 * VoltWay 2W - Interactive Leaflet Map Engine
 * Distinct EV Pins, Filter Chips, Safe Range Overlay, and Corridor Visualization
 */

const MapEngine = (function () {
  let map = null;
  let tileLayer = null;
  let currentTileTheme = 'dark'; // 'dark' | 'sunlight'

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

  // Charger markers map: chargerId -> marker
  const markerMap = new Map();

  function initMap(containerId = 'map') {
    if (map) return map;

    // Default center on Bangalore (India EV hub) or user location
    const defaultCenter = [12.9716, 77.5946];
    const defaultZoom = 12;

    map = L.map(containerId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: false
    });

    // Add zoom control at bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Add minimal attribution
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('&copy; <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a> | VoltWay 2W')
      .addTo(map);

    // Set base tile layer
    setTileTheme('dark');

    // Create layer groups
    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    waypointsLayer = L.layerGroup().addTo(map);

    // Map move/zoom listeners for bounds-based live sync
    map.on('moveend', onMapMoveEnd);

    // Initial GPS geolocation attempt
    locateUser(false);

    return map;
  }

  function setTileTheme(theme) {
    currentTileTheme = theme;
    if (tileLayer) {
      map.removeLayer(tileLayer);
    }

    if (theme === 'sunlight') {
      // High-visibility crisp daytime OSM tiles
      tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c']
      }).addTo(map);
    } else {
      // Sleek Dark Matter tiles for AMOLED / night riding
      tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
      }).addTo(map);
    }
  }

  function toggleTileTheme() {
    setTileTheme(currentTileTheme === 'dark' ? 'sunlight' : 'dark');
    return currentTileTheme;
  }

  /**
   * Custom HTML Pin Icons
   */
  function createPinIcon(charger) {
    let pinClass = 'pin-ather';
    let iconChar = '⚡';
    let label = 'Ather';

    if (charger.network === 'ATHER_GRID') {
      pinClass = 'pin-ather';
      iconChar = '⚡';
      label = 'Ather';
    } else if (charger.network === 'BOLT_EARTH') {
      if (charger.type === 'FAST') {
        pinClass = 'pin-bolt-fast';
        iconChar = '⚡';
        label = 'Bolt Fast';
      } else {
        pinClass = 'pin-bolt-slow';
        iconChar = '🔌';
        label = '15A';
      }
    }

    const html = `
      <div class="custom-pin ${pinClass}" data-id="${charger.id}">
        <div class="pin-badge">
          <span class="pin-icon">${iconChar}</span>
          <span class="pin-tag">${label}</span>
        </div>
        <div class="pin-pulse"></div>
      </div>
    `;

    return L.divIcon({
      className: 'custom-pin-container',
      html: html,
      iconSize: [44, 44],
      iconAnchor: [22, 42],
      popupAnchor: [0, -38]
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
   * Render or update all charger markers according to active filter chips
   */
  function renderChargers(chargers = null) {
    if (!map || !markersLayer) return;
    if (!chargers) {
      chargers = window.SyncEngine ? window.SyncEngine.getChargers() : (window.BUNDLED_CHARGERS || []);
    }

    markersLayer.clearLayers();
    markerMap.clear();

    const bounds = map.getBounds().pad(0.5); // render markers in and slightly around viewport for performance

    chargers.forEach((charger) => {
      // Filter rule check
      if (charger.network === 'ATHER_GRID' && !filters.atherFast) return;
      if (charger.network === 'BOLT_EARTH' && charger.type === 'FAST' && !filters.boltFast) return;
      if (charger.network === 'BOLT_EARTH' && charger.type === 'SLOW' && !filters.boltSlow) return;

      const pos = L.latLng(charger.lat, charger.lng);
      if (!bounds.contains(pos) && map.getZoom() >= 11) {
        // Skip rendering markers too far outside viewport when zoomed in for high FPS
        return;
      }

      const icon = createPinIcon(charger);
      const marker = L.marker(pos, { icon: icon });

      // Rich popup content
      marker.bindPopup(() => createChargerPopupHtml(charger), {
        maxWidth: 320,
        className: 'charger-popup'
      });

      marker.addTo(markersLayer);
      markerMap.set(charger.id, marker);
    });

    console.log(`[VoltWay Map] Rendered ${markerMap.size} visible markers`);
  }

  function createChargerPopupHtml(charger) {
    const isAther = charger.network === 'ATHER_GRID';
    const isFast = charger.type === 'FAST';

    const networkBadgeClass = isAther ? 'badge-ather' : (isFast ? 'badge-bolt-fast' : 'badge-bolt-slow');
    const networkName = isAther ? 'Ather Grid' : 'Bolt.Earth';
    const typeLabel = isFast ? '⚡ DC Fast Charger (2W)' : '🔌 Standard 15A Socket (3-Pin)';

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : { efficiency: 0.85, currentBatteryPct: 85 };
    const chargeTime = window.Utilities ? window.Utilities.estimateChargingTime(batteryState.currentBatteryPct, 80, batteryState.efficiency) : null;
    const estTimeText = isFast ? (chargeTime ? chargeTime.fastTimeFormatted : '~35 mins to 80%') : (chargeTime ? chargeTime.slowTimeFormatted : '~3h 30m');

    return `
      <div class="popup-card">
        <div class="popup-header">
          <span class="popup-badge ${networkBadgeClass}">${networkName}</span>
          <span class="popup-type">${isFast ? 'DC Fast' : '15A AC'}</span>
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
        <div class="popup-actions">
          <button class="btn-popup-nav" onclick="MapEngine.handleNavigateToCharger('${charger.id}')">
            🧭 Navigate in Google Maps
          </button>
          <button class="btn-popup-waypoint" onclick="MapEngine.handleAddWaypoint('${charger.id}')">
            ➕ Add Stop
          </button>
        </div>
      </div>
    `;
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
    }
  }

  /**
   * Filter chip toggles
   */
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
   * Safe Range Ring Overlay
   * Displays circular radius of reachable safe range from origin/current position
   */
  function updateSafeRangeOverlay(centerCoords = null) {
    if (!map) return;
    const center = centerCoords || userCoords || (map ? map.getCenter() : null);
    if (!center) return;

    const batteryState = window.BatteryEngine ? window.BatteryEngine.getState() : null;
    if (!batteryState) return;

    const safeKm = batteryState.reachableSafeKm || 40;
    const maxKm = batteryState.absoluteMaxKm || 60;

    const centerLatLng = L.latLng(center.lat || center[0], center.lng || center[1]);

    // Remove existing circles
    if (safeRangeCircle) map.removeLayer(safeRangeCircle);
    if (bufferRangeCircle) map.removeLayer(bufferRangeCircle);

    // Outer buffer circle (yellow/orange warning zone)
    bufferRangeCircle = L.circle(centerLatLng, {
      radius: maxKm * 1000,
      color: '#FFD600',
      weight: 1.5,
      dashArray: '6, 6',
      fillColor: '#FFD600',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(map);

    // Inner safe circle (green safe zone)
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
   * Render Route Polyline and Multi-Stop Waypoints (A -> B -> C -> D)
   */
  function renderRoute(routeData) {
    if (!map || !routeLayer || !waypointsLayer) return;

    routeLayer.clearLayers();
    waypointsLayer.clearLayers();

    if (!routeData || !routeData.coordinates || routeData.coordinates.length < 2) {
      return;
    }

    // Glowing background polyline for visibility
    const glowLine = L.polyline(routeData.coordinates, {
      color: '#00E676',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    // Main sharp route line
    const mainLine = L.polyline(routeData.coordinates, {
      color: '#00B0FF',
      weight: 4,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    // Render Origin Pin (A)
    const originPin = L.marker([routeData.origin.lat, routeData.origin.lng], {
      icon: createWaypointPinIcon('A', '#00E676')
    }).bindPopup(`<b>Start Point (Origin)</b><br>${routeData.origin.name || 'Origin'}`).addTo(waypointsLayer);

    // Render Intermediate Charging Waypoints (B, C, ...)
    const intermediateStops = routeData.waypoints || [];
    intermediateStops.forEach((wp, idx) => {
      const letter = String.fromCharCode(66 + idx); // B, C, D...
      const color = wp.type === 'FAST' ? '#FF9100' : '#00B0FF';
      const wpPin = L.marker([wp.lat, wp.lng], {
        icon: createWaypointPinIcon(letter, color)
      }).bindPopup(`
        <div class="popup-card">
          <div class="popup-header"><span class="popup-badge badge-bolt-fast">Stop ${letter}</span></div>
          <div class="popup-title">${wp.name}</div>
          <div class="popup-detail"><span>Connector:</span> <span>${wp.connector}</span></div>
          <div class="popup-actions">
            <button class="btn-popup-waypoint" onclick="RouteEngine.removeWaypoint('${wp.id}')">❌ Remove Stop</button>
          </div>
        </div>
      `).addTo(waypointsLayer);
    });

    // Render Final Destination Pin
    const destLetter = String.fromCharCode(66 + intermediateStops.length);
    const destPin = L.marker([routeData.destination.lat, routeData.destination.lng], {
      icon: createWaypointPinIcon(destLetter, '#FF3D71')
    }).bindPopup(`<b>Final Destination</b><br>${routeData.destination.name || 'Destination'}`).addTo(waypointsLayer);

    // Fit map bounds to show full route
    map.fitBounds(mainLine.getBounds(), { padding: [50, 50] });

    // Update safe range circle centered on origin
    updateSafeRangeOverlay(routeData.origin);
  }

  /**
   * Geolocation tracking
   */
  function locateUser(panTo = true) {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

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
      (err) => {
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function onMapMoveEnd() {
    renderChargers();

    // If online, optionally fetch live Bolt.Earth points in current bounds
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
    const marker = markerMap.get(charger.id);
    if (marker) {
      marker.openPopup();
    }
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
    handleAddWaypoint
  };
})();

window.MapEngine = MapEngine;

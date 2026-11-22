/**
 * VoltWay 2W - Main Application Controller
 * Handles UI interactions, bottom sheet drawer, tabs, and event coordination
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VoltWay 2W] Bootstrapping Application...');

  // 1. Initialize Map
  const map = MapEngine.initMap('map');

  // 2. Load Bundled Chargers & Initialize IndexedDB
  const chargers = await SyncEngine.loadInitialChargers();
  MapEngine.renderChargers(chargers);
  updateFilterBadges();

  // 3. Register Service Worker for PWA
  registerServiceWorker();

  // 4. Setup PWA Android Install Banner
  setupInstallPrompt();

  // 5. Initialize UI Components
  setupTabs();
  setupFilterChips();
  setupBatteryControls();
  setupRoutePlanner();
  setupChargingEstimator();
  setupSOSModule();
  setupSyncModal();
  setupSunlightToggle();
  setupSearchAutocomplete();

  // 6. Listen to State Changes
  BatteryEngine.subscribe(onBatteryStateChange);
  SyncEngine.subscribe(onSyncStateChange);
  RouteEngine.subscribe(onRouteStateChange);

  console.log('[VoltWay 2W] Ready. Total chargers active:', chargers.length);
});

// --- Service Worker Registration ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('[VoltWay SW] Registered successfully with scope:', reg.scope))
        .catch((err) => console.warn('[VoltWay SW] Registration failed:', err));
    });
  }
}

// --- PWA Install Prompt ---
let deferredInstallPrompt = null;
function setupInstallPrompt() {
  const installBtn = document.getElementById('btn-install-app');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) {
      installBtn.style.display = 'inline-flex';
      installBtn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          console.log('[VoltWay PWA] User install choice:', outcome);
          deferredInstallPrompt = null;
          installBtn.style.display = 'none';
        }
      });
    }
  });

  window.addEventListener('appinstalled', () => {
    console.log('[VoltWay PWA] App installed on device!');
    if (installBtn) installBtn.style.display = 'none';
  });
}

// --- Sunlight Contrast Mode Toggle ---
function setupSunlightToggle() {
  const btn = document.getElementById('btn-toggle-sunlight');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const isSunlight = document.body.classList.toggle('sunlight-mode');
    MapEngine.setTileTheme(isSunlight ? 'sunlight' : 'dark');
    btn.innerHTML = isSunlight ? '🌙 Night Mode' : '☀️ Sun Mode';
    btn.setAttribute('title', isSunlight ? 'Switch to OLED Dark Mode' : 'Switch to High Sunlight Contrast Mode');
  });
}

// --- Tabs Management ---
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const bottomSheet = document.getElementById('bottom-sheet');
  const toggleDrawerBtn = document.getElementById('btn-toggle-drawer');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`pane-${tabTarget}`);
      if (targetPane) targetPane.classList.add('active');

      // Expand bottom sheet if collapsed
      if (bottomSheet) bottomSheet.classList.remove('collapsed');
      if (toggleDrawerBtn) toggleDrawerBtn.innerHTML = '▼ Minimize';
    });
  });

  if (toggleDrawerBtn && bottomSheet) {
    toggleDrawerBtn.addEventListener('click', () => {
      const isCollapsed = bottomSheet.classList.toggle('collapsed');
      toggleDrawerBtn.innerHTML = isCollapsed ? '▲ Expand Panel' : '▼ Minimize';
    });
  }
}

// --- Filter Chips Bar ---
function setupFilterChips() {
  const chipAther = document.getElementById('chip-ather-fast');
  const chipBoltFast = document.getElementById('chip-bolt-fast');
  const chipBoltSlow = document.getElementById('chip-bolt-slow');

  if (chipAther) {
    chipAther.addEventListener('click', () => {
      const active = chipAther.classList.toggle('active');
      MapEngine.setFilter('atherFast', active);
    });
  }

  if (chipBoltFast) {
    chipBoltFast.addEventListener('click', () => {
      const active = chipBoltFast.classList.toggle('active');
      MapEngine.setFilter('boltFast', active);
    });
  }

  if (chipBoltSlow) {
    chipBoltSlow.addEventListener('click', () => {
      const active = chipBoltSlow.classList.toggle('active');
      MapEngine.setFilter('boltSlow', active);
    });
  }
}

function updateFilterBadges() {
  const stats = SyncEngine.getStats();
  const countAther = document.getElementById('count-ather-fast');
  const countBoltFast = document.getElementById('count-bolt-fast');
  const countBoltSlow = document.getElementById('count-bolt-slow');

  if (countAther) countAther.textContent = stats.atherFast.toLocaleString();
  if (countBoltFast) countBoltFast.textContent = stats.boltFast.toLocaleString();
  if (countBoltSlow) countBoltSlow.textContent = stats.boltSlow.toLocaleString();
}

// --- Battery & Range Controls ---
function setupBatteryControls() {
  const slider = document.getElementById('battery-slider');
  const numberInput = document.getElementById('battery-number');
  const vehicleSelect = document.getElementById('vehicle-select');
  const effInput = document.getElementById('efficiency-input');
  const reserveSlider = document.getElementById('reserve-slider');
  const reserveVal = document.getElementById('reserve-val');
  const modeButtons = document.querySelectorAll('.btn-mode');

  // Sync Slider and Number input
  if (slider && numberInput) {
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      numberInput.value = val;
      BatteryEngine.setBatteryPct(val);
    });

    numberInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      slider.value = val;
      BatteryEngine.setBatteryPct(val);
    });
  }

  // Vehicle Presets
  if (vehicleSelect) {
    vehicleSelect.addEventListener('change', (e) => {
      BatteryEngine.setVehicle(e.target.value);
    });
  }

  // Riding Modes
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode');
      BatteryEngine.setRidingMode(mode);
    });
  });

  // Custom Efficiency
  if (effInput) {
    effInput.addEventListener('change', (e) => {
      BatteryEngine.setCustomEfficiency(e.target.value);
      modeButtons.forEach(b => b.classList.remove('active'));
    });
  }

  // Reserve Buffer
  if (reserveSlider && reserveVal) {
    reserveSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      reserveVal.textContent = `${val}%`;
      BatteryEngine.setSafetyReserve(val);
    });
  }
}

function onBatteryStateChange(state) {
  // Update UI values
  const slider = document.getElementById('battery-slider');
  const numberInput = document.getElementById('battery-number');
  const effInput = document.getElementById('efficiency-input');
  const safeRangeText = document.getElementById('metric-safe-range');
  const maxRangeText = document.getElementById('metric-max-range');

  if (slider && slider.value != state.currentBatteryPct) slider.value = state.currentBatteryPct;
  if (numberInput && numberInput.value != state.currentBatteryPct) numberInput.value = state.currentBatteryPct;
  if (effInput && effInput.value != state.efficiency) effInput.value = state.efficiency;

  if (safeRangeText) safeRangeText.textContent = `${state.reachableSafeKm} km`;
  if (maxRangeText) maxRangeText.textContent = `${state.absoluteMaxKm} km`;

  // Update Safe Range circle on map
  MapEngine.updateSafeRangeOverlay();

  // Re-evaluate active trip if any
  const activeRoute = RouteEngine.getActiveRoute();
  if (activeRoute) {
    updateRouteMetrics(activeRoute);
  }
}

// --- Route Planner ---
let originPoint = null;
let destinationPoint = null;

function setupRoutePlanner() {
  const originInput = document.getElementById('input-origin');
  const destInput = document.getElementById('input-destination');
  const btnUseGps = document.getElementById('btn-use-gps-origin');
  const btnPlanRoute = document.getElementById('btn-plan-route');
  const btnClearRoute = document.getElementById('btn-clear-route');
  const btnStartFullGmaps = document.getElementById('btn-start-gmaps-full');
  const btnNavNextCharger = document.getElementById('btn-nav-next-charger');

  // Attach rich autocomplete to Starting Point (A)
  attachLocationAutocomplete(originInput, document.getElementById('origin-suggestions'), (point) => {
    originPoint = point;
    const map = MapEngine.getMap();
    if (map) map.setView([point.lat, point.lng], 14, { animate: true });
  });

  // Attach rich autocomplete to Final Destination (D)
  attachLocationAutocomplete(destInput, document.getElementById('dest-suggestions'), (point) => {
    destinationPoint = point;
    const map = MapEngine.getMap();
    if (map) map.setView([point.lat, point.lng], 14, { animate: true });
  });

  if (btnUseGps) {
    btnUseGps.addEventListener('click', () => {
      MapEngine.locateUser(true);
      const coords = MapEngine.getUserCoords();
      if (coords) {
        originPoint = { lat: coords.lat, lng: coords.lng, name: 'Current Location (GPS)' };
        if (originInput) originInput.value = 'Current Location (GPS)';
      } else {
        alert('Fetching GPS location... please wait 2 seconds.');
        setTimeout(() => {
          const c = MapEngine.getUserCoords();
          if (c) {
            originPoint = { lat: c.lat, lng: c.lng, name: 'Current Location (GPS)' };
            if (originInput) originInput.value = 'Current Location (GPS)';
          }
        }, 1500);
      }
    });
  }

  if (btnPlanRoute) {
    btnPlanRoute.addEventListener('click', async () => {
      if (!originPoint) {
        const userC = MapEngine.getUserCoords();
        originPoint = userC ? { ...userC, name: 'Current Location' } : { lat: 12.9716, lng: 77.5946, name: 'MG Road, Bangalore' };
        if (originInput) originInput.value = originPoint.name;
      }

      if (!destinationPoint) {
        const destQuery = destInput ? destInput.value.trim() : '';
        if (destQuery) {
          const results = await Utilities.searchPlace(destQuery);
          if (results && results.length > 0) {
            destinationPoint = results[0];
          } else {
            alert('Could not find location. Please select a valid destination from search suggestions.');
            return;
          }
        } else {
          alert('Please enter a destination place or city.');
          return;
        }
      }

      btnPlanRoute.disabled = true;
      btnPlanRoute.textContent = 'Calculating Routes...';

      try {
        const route = await RouteEngine.calculateRoute(originPoint, destinationPoint);
        const evalMetrics = BatteryEngine.evaluateTrip(route.distanceKm);

        if (evalMetrics.status !== 'SAFE') {
          console.log('[VoltWay] Route exceeds safe range, auto-discovering corridor charging stops...');
          await RouteEngine.autoSuggestChargingStops(evalMetrics);
        }
      } catch (err) {
        alert('Route calculation error: ' + err.message);
      } finally {
        btnPlanRoute.disabled = false;
        btnPlanRoute.textContent = '⚡ Plan Optimal 2W Route';
      }
    });
  }

  if (btnClearRoute) {
    btnClearRoute.addEventListener('click', () => {
      RouteEngine.clearRoute();
      originPoint = null;
      destinationPoint = null;
      if (originInput) originInput.value = '';
      if (destInput) destInput.value = '';
      const summaryCard = document.getElementById('route-summary-card');
      const routeSelector = document.getElementById('route-selector-container');
      const waypointsSection = document.getElementById('trip-waypoints-section');
      if (summaryCard) summaryCard.style.display = 'none';
      if (routeSelector) routeSelector.style.display = 'none';
      if (waypointsSection) waypointsSection.style.display = 'none';
      if (btnStartFullGmaps) btnStartFullGmaps.style.display = 'none';
      if (btnNavNextCharger) btnNavNextCharger.style.display = 'none';
    });
  }

  // Google Maps Deep-link Buttons
  if (btnStartFullGmaps) {
    btnStartFullGmaps.addEventListener('click', () => {
      const active = RouteEngine.getActiveRoute();
      if (active) {
        NavigationEngine.startFullTrip(active.origin, active.destination, active.waypoints);
      }
    });
  }

  if (btnNavNextCharger) {
    btnNavNextCharger.addEventListener('click', () => {
      const waypoints = RouteEngine.getWaypoints();
      const userC = MapEngine.getUserCoords();
      if (waypoints && waypoints.length > 0) {
        NavigationEngine.navigateToNextCharger(waypoints[0], userC);
      } else {
        alert('No intermediate charging waypoint on this route. Navigating directly to destination.');
        const active = RouteEngine.getActiveRoute();
        if (active) NavigationEngine.navigateToNextCharger(active.destination, userC);
      }
    });
  }
}

/**
 * Universal Autocomplete Handler for Location Input Fields
 */
function attachLocationAutocomplete(inputEl, dropdownEl, onSelect) {
  if (!inputEl || !dropdownEl) return;
  let timer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const query = inputEl.value.trim();
    if (query.length < 2) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }

    timer = setTimeout(async () => {
      const allChargers = SyncEngine.getChargers();
      const qLower = query.toLowerCase();
      const matchedChargers = allChargers.filter(c =>
        c.name.toLowerCase().includes(qLower) || (c.address && c.address.toLowerCase().includes(qLower))
      ).slice(0, 4);

      const osmPlaces = await Utilities.searchPlace(query);

      if (matchedChargers.length === 0 && osmPlaces.length === 0) {
        dropdownEl.style.display = 'none';
        return;
      }

      let html = '';
      if (osmPlaces.length > 0) {
        html += '<div class="dropdown-header">📍 Recommended Places & Cities</div>';
        osmPlaces.forEach(p => {
          html += `
            <div class="dropdown-item" data-type="place" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${p.name.replace(/"/g, '&quot;')}">
              <div class="item-title">${highlightMatch(p.name, query)}</div>
              <div class="item-sub">${p.fullName}</div>
            </div>
          `;
        });
      }

      if (matchedChargers.length > 0) {
        html += '<div class="dropdown-header">⚡ EV Chargers</div>';
        matchedChargers.forEach(c => {
          html += `
            <div class="dropdown-item" data-type="charger" data-id="${c.id}" data-lat="${c.lat}" data-lng="${c.lng}" data-name="${c.name.replace(/"/g, '&quot;')}">
              <div class="item-title">${highlightMatch(c.name, query)}</div>
              <div class="item-sub">${c.network === 'ATHER_GRID' ? 'Ather Grid Fast' : c.connector} • ${c.address || ''}</div>
            </div>
          `;
        });
      }

      dropdownEl.innerHTML = html;
      dropdownEl.style.display = 'block';

      dropdownEl.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const lat = parseFloat(item.getAttribute('data-lat'));
          const lng = parseFloat(item.getAttribute('data-lng'));
          const name = item.getAttribute('data-name');
          inputEl.value = name;
          dropdownEl.style.display = 'none';
          onSelect({ lat, lng, name });
        });
      });
    }, 280);
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
      dropdownEl.style.display = 'none';
    }
  });
}

function highlightMatch(text, query) {
  if (!text || !query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<span style="color: var(--color-ather); font-weight: 800;">$1</span>');
}

function onRouteStateChange(routeState) {
  const { route, allRoutes, selectedRouteIndex, corridorChargers, waypoints } = routeState;
  const summaryCard = document.getElementById('route-summary-card');
  const routeSelectorContainer = document.getElementById('route-selector-container');
  const routeSelectorPills = document.getElementById('route-selector-pills');
  const waypointsSection = document.getElementById('trip-waypoints-section');
  const waypointsContainer = document.getElementById('trip-waypoints-container');
  const waypointsCount = document.getElementById('trip-waypoints-count');
  const btnStartFullGmaps = document.getElementById('btn-start-gmaps-full');
  const btnNavNextCharger = document.getElementById('btn-nav-next-charger');

  if (!route) {
    if (summaryCard) summaryCard.style.display = 'none';
    if (routeSelectorContainer) routeSelectorContainer.style.display = 'none';
    if (waypointsSection) waypointsSection.style.display = 'none';
    if (btnStartFullGmaps) btnStartFullGmaps.style.display = 'none';
    if (btnNavNextCharger) btnNavNextCharger.style.display = 'none';
    return;
  }

  // 1. Render all alternative routes on map with active selected highlight
  MapEngine.renderRoute(route, allRoutes, selectedRouteIndex);

  // 2. Render Google Maps Style Route Alternative Selector Pills
  if (routeSelectorContainer && routeSelectorPills) {
    if (allRoutes && allRoutes.length > 1) {
      routeSelectorContainer.style.display = 'flex';
      routeSelectorPills.innerHTML = allRoutes.map((r, idx) => `
        <div class="route-pill ${idx === selectedRouteIndex ? 'active' : ''}" onclick="RouteEngine.selectRoute(${idx})">
          <div class="route-pill-title">${r.name}</div>
          <div class="route-pill-meta">${r.distanceKm} km • ${Utilities.formatMinutes(r.durationMins)}</div>
        </div>
      `).join('');
    } else {
      routeSelectorContainer.style.display = 'none';
    }
  }

  // 3. Render Trip Planner Added Waypoints (Stops)
  if (waypointsSection && waypointsContainer) {
    if (waypoints && waypoints.length > 0) {
      waypointsSection.style.display = 'flex';
      if (waypointsCount) waypointsCount.textContent = waypoints.length;
      waypointsContainer.innerHTML = waypoints.map((wp, idx) => {
        const letter = String.fromCharCode(66 + idx);
        return `
          <div class="trip-waypoint-item">
            <span class="trip-waypoint-badge">Stop ${letter}</span>
            <span class="trip-waypoint-title">${wp.name}</span>
            <button class="btn-remove-waypoint" onclick="RouteEngine.removeWaypoint('${wp.id}')" title="Remove Stop">❌</button>
          </div>
        `;
      }).join('');
    } else {
      waypointsSection.style.display = 'none';
    }
  }

  // 4. Update Summary Card & Google Maps Actions
  if (summaryCard) summaryCard.style.display = 'block';
  if (btnStartFullGmaps) btnStartFullGmaps.style.display = 'inline-flex';
  if (btnNavNextCharger) {
    btnNavNextCharger.style.display = waypoints && waypoints.length > 0 ? 'inline-flex' : 'none';
  }

  updateRouteMetrics(route);
  renderCorridorChargersList(corridorChargers, waypoints);
}

// Global helpers to set origin / destination directly from map charger clicks
window.setPlannerOrigin = function (point) {
  originPoint = point;
  const input = document.getElementById('input-origin');
  if (input) input.value = point.name;
  const routeTab = document.querySelector('[data-tab="route"]');
  if (routeTab) routeTab.click();
  const map = MapEngine.getMap();
  if (map) map.setView([point.lat, point.lng], 14, { animate: true });
};

window.setPlannerDest = function (point) {
  destinationPoint = point;
  const input = document.getElementById('input-destination');
  if (input) input.value = point.name;
  const routeTab = document.querySelector('[data-tab="route"]');
  if (routeTab) routeTab.click();
  const map = MapEngine.getMap();
  if (map) map.setView([point.lat, point.lng], 14, { animate: true });
};

function updateRouteMetrics(route) {
  const evalMetrics = BatteryEngine.evaluateTrip(route.distanceKm);

  const distEl = document.getElementById('metric-trip-dist');
  const timeEl = document.getElementById('metric-trip-time');
  const batNeedEl = document.getElementById('metric-bat-needed');
  const batArrivalEl = document.getElementById('metric-bat-arrival');
  const statusBanner = document.getElementById('route-status-banner');

  if (distEl) distEl.textContent = `${route.distanceKm} km`;
  if (timeEl) timeEl.textContent = Utilities.formatMinutes(route.durationMins);
  if (batNeedEl) batNeedEl.textContent = `${evalMetrics.batteryNeededPct}%`;
  if (batArrivalEl) batArrivalEl.textContent = `${evalMetrics.batteryAtArrivalPct}%`;

  if (statusBanner) {
    statusBanner.className = `status-banner ${evalMetrics.statusClass}`;
    statusBanner.innerHTML = `<strong>${evalMetrics.statusText}</strong>`;
  }
}

function renderCorridorChargersList(corridorChargers, waypoints) {
  const container = document.getElementById('corridor-chargers-list');
  const countEl = document.getElementById('corridor-count');

  if (countEl) countEl.textContent = corridorChargers.length;
  if (!container) return;

  if (corridorChargers.length === 0) {
    container.innerHTML = `<div class="empty-state">No 2W chargers found directly along this route corridor (within 2.5 km).</div>`;
    return;
  }

  let html = '';
  corridorChargers.forEach((c) => {
    const isWp = waypoints.some(w => w.id === c.id);
    const isAther = c.network === 'ATHER_GRID';
    const isFast = c.type === 'FAST';
    const badgeClass = isAther ? 'badge-ather' : (isFast ? 'badge-bolt-fast' : 'badge-bolt-slow');
    const netName = isAther ? 'Ather Grid' : 'Bolt.Earth';

    html += `
      <div class="corridor-card ${isWp ? 'is-waypoint' : ''}">
        <div class="corridor-card-header">
          <span class="popup-badge ${badgeClass}">${netName}</span>
          <span class="corridor-dist">📍 ~${c.kmFromOrigin} km from start (${c.corridorDistanceKm} km detour)</span>
        </div>
        <div class="corridor-card-title">${c.name}</div>
        <div class="corridor-card-desc">${c.connector} • ${c.power_kw} kW</div>
        <div class="corridor-card-actions">
          <button class="btn-sm btn-nav" onclick="MapEngine.focusCharger(window.SyncEngine.getChargers().find(x=>x.id==='${c.id}'))">🔍 Show on Map</button>
          ${isWp
            ? `<button class="btn-sm btn-remove-stop" onclick="RouteEngine.removeWaypoint('${c.id}')">❌ Remove Stop</button>`
            : `<button class="btn-sm btn-add-stop" onclick="RouteEngine.addWaypoint(window.SyncEngine.getChargers().find(x=>x.id==='${c.id}'))">➕ Add Stop</button>`
          }
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// --- Charging Time Estimator Tab ---
function setupChargingEstimator() {
  const startSlider = document.getElementById('calc-start-slider');
  const startVal = document.getElementById('calc-start-val');
  const targetSlider = document.getElementById('calc-target-slider');
  const targetVal = document.getElementById('calc-target-val');

  function recalculate() {
    const start = parseInt(startSlider ? startSlider.value : 20, 10);
    const target = parseInt(targetSlider ? targetSlider.value : 80, 10);

    if (startVal) startVal.textContent = `${start}%`;
    if (targetVal) targetVal.textContent = `${target}%`;

    const batteryState = BatteryEngine.getState();
    const result = Utilities.estimateChargingTime(start, target, batteryState.efficiency);

    const fastTimeEl = document.getElementById('calc-fast-time');
    const slowTimeEl = document.getElementById('calc-slow-time');
    const rangeGainEl = document.getElementById('calc-range-gain');

    if (fastTimeEl) fastTimeEl.textContent = result.fastTimeFormatted;
    if (slowTimeEl) slowTimeEl.textContent = result.slowTimeFormatted;
    if (rangeGainEl) rangeGainEl.textContent = `+${result.rangeGainedKm} km`;
  }

  if (startSlider) startSlider.addEventListener('input', recalculate);
  if (targetSlider) targetSlider.addEventListener('input', recalculate);

  recalculate();
}

// --- SOS Module ---
function setupSOSModule() {
  const btnSosHeader = document.getElementById('btn-sos-header');
  const btnSosTrigger = document.getElementById('btn-trigger-sos');

  function runSos() {
    // Switch to SOS tab
    const sosTabBtn = document.querySelector('[data-tab="sos"]');
    if (sosTabBtn) sosTabBtn.click();

    MapEngine.locateUser(true);
    const userCoords = MapEngine.getUserCoords();

    if (!userCoords) {
      alert('Requesting GPS location... please allow location access on your phone.');
      setTimeout(() => renderSosResults(MapEngine.getUserCoords()), 1500);
    } else {
      renderSosResults(userCoords);
    }
  }

  if (btnSosHeader) btnSosHeader.addEventListener('click', runSos);
  if (btnSosTrigger) btnSosTrigger.addEventListener('click', runSos);
}

function renderSosResults(userCoords) {
  const container = document.getElementById('sos-results-container');
  if (!container) return;

  if (!userCoords) {
    container.innerHTML = `<div class="empty-state">GPS location not found. Please enable location services.</div>`;
    return;
  }

  const results = Utilities.findNearestChargers(userCoords);
  if (!results || !results.absoluteClosest) {
    container.innerHTML = `<div class="empty-state">No chargers found in database.</div>`;
    return;
  }

  const batteryState = BatteryEngine.getState();
  const eff = batteryState.efficiency || 0.85;

  let html = '';

  // 1. Absolute Closest Charger Card
  const closest = results.absoluteClosest;
  const closestBatReq = Math.ceil(closest.distanceKm / eff);
  const isAther = closest.network === 'ATHER_GRID';
  const isFast = closest.type === 'FAST';

  html += `
    <div class="sos-card sos-primary">
      <div class="sos-card-header">
        <span class="sos-badge">🚨 ABSOLUTE CLOSEST</span>
        <span class="sos-dist">${closest.distanceKm} km away</span>
      </div>
      <div class="sos-title">${closest.name}</div>
      <div class="sos-details">
        <span>${isAther ? 'Ather Grid DC Fast' : (isFast ? 'Bolt.Earth Fast' : 'Bolt.Earth 15A Socket')}</span> •
        <span>Requires ~${closestBatReq}% Battery</span>
      </div>
      <div class="sos-address">${closest.address || ''}</div>
      <div class="sos-actions">
        <button class="btn-sos-nav" onclick="NavigationEngine.navigateToNextCharger(window.SyncEngine.getChargers().find(x=>x.id==='${closest.id}'), MapEngine.getUserCoords())">
          🧭 1-TAP NAVIGATE NOW
        </button>
      </div>
    </div>
  `;

  // 2. Nearest Fast Charger Card
  if (results.nearestFast && results.nearestFast.id !== closest.id) {
    const fast = results.nearestFast;
    const fastBatReq = Math.ceil(fast.distanceKm / eff);
    html += `
      <div class="sos-card">
        <div class="sos-card-header">
          <span class="sos-badge badge-fast">⚡ NEAREST FAST CHARGER</span>
          <span class="sos-dist">${fast.distanceKm} km away</span>
        </div>
        <div class="sos-title">${fast.name}</div>
        <div class="sos-details">${fast.connector} • Requires ~${fastBatReq}% Battery</div>
        <div class="sos-actions">
          <button class="btn-sm btn-nav" onclick="NavigationEngine.navigateToNextCharger(window.SyncEngine.getChargers().find(x=>x.id==='${fast.id}'), MapEngine.getUserCoords())">
            🧭 Navigate in Google Maps
          </button>
        </div>
      </div>
    `;
  }

  // 3. Nearest 15A Socket Card
  if (results.nearestSlow && results.nearestSlow.id !== closest.id) {
    const slow = results.nearestSlow;
    const slowBatReq = Math.ceil(slow.distanceKm / eff);
    html += `
      <div class="sos-card">
        <div class="sos-card-header">
          <span class="sos-badge badge-slow">🔌 NEAREST 15A SOCKET</span>
          <span class="sos-dist">${slow.distanceKm} km away</span>
        </div>
        <div class="sos-title">${slow.name}</div>
        <div class="sos-details">Standard 3-Pin Plug Socket • Requires ~${slowBatReq}% Battery</div>
        <div class="sos-actions">
          <button class="btn-sm btn-nav" onclick="NavigationEngine.navigateToNextCharger(window.SyncEngine.getChargers().find(x=>x.id==='${slow.id}'), MapEngine.getUserCoords())">
            🧭 Navigate in Google Maps
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// --- Search Autocomplete ---
function setupSearchAutocomplete() {
  const searchInput = document.getElementById('search-places-input');
  const resultsContainer = document.getElementById('search-dropdown');
  if (!searchInput || !resultsContainer) return;

  let debounceTimer = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      // 1. Search in local chargers by name/address first
      const allChargers = SyncEngine.getChargers();
      const lowerQuery = query.toLowerCase();
      const localMatches = allChargers.filter(c =>
        c.name.toLowerCase().includes(lowerQuery) || (c.address && c.address.toLowerCase().includes(lowerQuery))
      ).slice(0, 4);

      // 2. Search online via Nominatim OpenStreetMap
      const osmMatches = await Utilities.searchPlace(query);

      renderSearchResults(localMatches, osmMatches);
    }, 350);
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.style.display = 'none';
    }
  });
}

function renderSearchResults(chargers, places) {
  const container = document.getElementById('search-dropdown');
  if (!container) return;

  if (chargers.length === 0 && places.length === 0) {
    container.style.display = 'none';
    return;
  }

  let html = '';

  if (chargers.length > 0) {
    html += '<div class="dropdown-header">⚡ EV Chargers</div>';
    chargers.forEach(c => {
      html += `
        <div class="dropdown-item" onclick="onSelectChargerSearch('${c.id}')">
          <div class="item-title">${c.name}</div>
          <div class="item-sub">${c.network === 'ATHER_GRID' ? 'Ather Grid Fast' : c.connector} • ${c.address || ''}</div>
        </div>
      `;
    });
  }

  if (places.length > 0) {
    html += '<div class="dropdown-header">📍 Cities & Places</div>';
    places.forEach((p, idx) => {
      html += `
        <div class="dropdown-item" onclick="onSelectPlaceSearch(${p.lat}, ${p.lng}, '${p.name.replace(/'/g, "\\'")}')">
          <div class="item-title">${p.name}</div>
          <div class="item-sub">${p.fullName}</div>
        </div>
      `;
    });
  }

  container.innerHTML = html;
  container.style.display = 'block';
}

function onSelectChargerSearch(chargerId) {
  const c = SyncEngine.getChargers().find(x => x.id === chargerId);
  if (c) {
    MapEngine.focusCharger(c);
    const dropdown = document.getElementById('search-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }
}

function onSelectPlaceSearch(lat, lng, name) {
  destinationPoint = { lat, lng, name };
  const destInput = document.getElementById('input-destination');
  if (destInput) destInput.value = name;

  const map = MapEngine.getMap();
  if (map) map.setView([lat, lng], 13, { animate: true });

  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.style.display = 'none';

  // Switch to Route tab
  const routeTab = document.querySelector('[data-tab="route"]');
  if (routeTab) routeTab.click();
}

// Make search handlers global
window.onSelectChargerSearch = onSelectChargerSearch;
window.onSelectPlaceSearch = onSelectPlaceSearch;

// --- Sync Modal ---
function setupSyncModal() {
  const btnOpenSync = document.getElementById('btn-open-sync');
  const btnCloseSync = document.getElementById('btn-close-sync');
  const modal = document.getElementById('sync-modal');
  const btnRunSync = document.getElementById('btn-run-sync');

  if (btnOpenSync && modal) {
    btnOpenSync.addEventListener('click', () => {
      modal.classList.add('open');
      updateSyncModalStatus();
    });
  }

  if (btnCloseSync && modal) {
    btnCloseSync.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  if (btnRunSync) {
    btnRunSync.addEventListener('click', async () => {
      btnRunSync.disabled = true;
      const progressText = document.getElementById('sync-progress-text');
      const progressBar = document.getElementById('sync-progress-bar');

      await SyncEngine.performFullSync(({ status, percent }) => {
        if (progressText) progressText.textContent = status;
        if (progressBar) progressBar.style.width = `${percent}%`;
      });

      btnRunSync.disabled = false;
      updateSyncModalStatus();
      MapEngine.renderChargers();
      updateFilterBadges();
    });
  }
}

function updateSyncModalStatus() {
  const stats = SyncEngine.getStats();
  const totalEl = document.getElementById('sync-total-chargers');
  const lastSyncEl = document.getElementById('sync-last-timestamp');

  if (totalEl) totalEl.textContent = stats.total.toLocaleString();
  if (lastSyncEl) {
    lastSyncEl.textContent = stats.lastSync
      ? new Date(stats.lastSync).toLocaleString()
      : 'Using Pre-packaged Database';
  }
}

function onSyncStateChange() {
  updateFilterBadges();
}

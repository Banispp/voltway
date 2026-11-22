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
  setupGoogleMapsImporter();
  checkSharedRouteParams();

  // 6. Listen to State Changes
  BatteryEngine.subscribe(onBatteryStateChange);
  SyncEngine.subscribe(onSyncStateChange);
  RouteEngine.subscribe(onRouteStateChange);

  console.log('[VoltWay 2W] Ready. Total chargers active:', chargers.length);
});

// --- Service Worker & Auto-Refresh Management ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[VoltWay SW] New controller active - auto-reloading page for user!');
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=4.8')
        .then((reg) => {
          console.log('[VoltWay SW] Registered successfully with scope:', reg.scope);
          reg.update();
        })
        .catch((err) => console.warn('[VoltWay SW] Registration failed:', err));
    });
  }

  // Hook up manual fresh reload button
  const btnRefresh = document.getElementById('btn-force-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.textContent = '🔄 Updating...';
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      localStorage.clear();
      window.location.reload(true);
    });
  }
}

// --- PWA Install Prompt ---
let deferredInstallPrompt = null;
function setupInstallPrompt() {
  const installBtn = document.getElementById('btn-install-app');

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        try {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          console.log('[VoltWay PWA] User install choice:', outcome);
          if (outcome === 'accepted') {
            installBtn.style.display = 'none';
          }
          deferredInstallPrompt = null;
        } catch (err) {
          console.warn('[VoltWay PWA] Prompt error:', err);
          alert('To install on your phone:\nTap Chrome menu (⋮) at the top right and choose "Add to Home screen".');
        }
      } else {
        alert('To install on your phone:\nTap Chrome menu (⋮) at the top right and select "Add to Home screen" (or "Install app").');
      }
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) {
      installBtn.style.display = 'inline-flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    console.log('[VoltWay PWA] App successfully installed on device!');
    if (installBtn) installBtn.style.display = 'none';
    deferredInstallPrompt = null;
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

// Global Bottom Sheet Control Helpers
window.expandBottomSheet = function() {
  const bs = document.getElementById('bottom-sheet');
  const tb = document.getElementById('btn-toggle-drawer');
  if (bs) bs.classList.remove('collapsed');
  if (tb) tb.innerHTML = '▼ Minimize';
};

window.collapseBottomSheet = function() {
  const bs = document.getElementById('bottom-sheet');
  const tb = document.getElementById('btn-toggle-drawer');
  if (bs) bs.classList.add('collapsed');
  if (tb) tb.innerHTML = '▲ Expand Panel';
};

// --- Tabs Management ---
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const bottomSheet = document.getElementById('bottom-sheet');
  const toggleDrawerBtn = document.getElementById('btn-toggle-drawer');
  const handleBar = document.getElementById('sheet-handle-bar');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`pane-${tabTarget}`);
      if (targetPane) targetPane.classList.add('active');

      // Expand bottom sheet if collapsed
      window.expandBottomSheet();
    });
  });

  if (toggleDrawerBtn && bottomSheet) {
    toggleDrawerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = bottomSheet.classList.toggle('collapsed');
      toggleDrawerBtn.innerHTML = isCollapsed ? '▲ Expand Panel' : '▼ Minimize';
    });
  }

  // Mobile Handle Bar Touch & Tap Interactions
  if (handleBar && bottomSheet) {
    handleBar.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'btn-toggle-drawer') return;
      const isCollapsed = bottomSheet.classList.toggle('collapsed');
      if (toggleDrawerBtn) {
        toggleDrawerBtn.innerHTML = isCollapsed ? '▲ Expand Panel' : '▼ Minimize';
      }
    });

    let touchStartY = 0;
    let touchEndY = 0;
    handleBar.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
        touchEndY = touchStartY;
      }
    }, { passive: true });

    handleBar.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 0) {
        touchEndY = e.touches[0].clientY;
      }
    }, { passive: true });

    handleBar.addEventListener('touchend', () => {
      const deltaY = touchEndY - touchStartY;
      if (Math.abs(deltaY) > 30) {
        if (deltaY < 0) {
          // Swiped up -> expand
          window.expandBottomSheet();
        } else {
          // Swiped down -> collapse
          window.collapseBottomSheet();
        }
      }
      touchStartY = 0;
      touchEndY = 0;
    });
  }
}

// --- Filter Chips Bar ---
function setupFilterChips() {
  const chipFastOnly = document.getElementById('chip-fast-only');
  const chipAther = document.getElementById('chip-ather-fast');
  const chipVidaFast = document.getElementById('chip-vida-fast');
  const chipBoltFast = document.getElementById('chip-bolt-fast');
  const chipBoltSlow = document.getElementById('chip-bolt-slow');

  function checkFastOnlySync() {
    if (!chipFastOnly) return;
    const isFastOnly = chipAther?.classList.contains('active') &&
                       chipVidaFast?.classList.contains('active') &&
                       chipBoltFast?.classList.contains('active') &&
                       !chipBoltSlow?.classList.contains('active');
    chipFastOnly.classList.toggle('active', isFastOnly);
  }

  if (chipFastOnly) {
    chipFastOnly.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const willBeActive = !chipFastOnly.classList.contains('active');
      chipFastOnly.classList.toggle('active', willBeActive);

      if (willBeActive) {
        // Fast Only mode: Turn on Ather, Vida, Bolt Fast; Turn off Bolt Slow 15A
        if (chipAther) chipAther.classList.add('active');
        if (chipVidaFast) chipVidaFast.classList.add('active');
        if (chipBoltFast) chipBoltFast.classList.add('active');
        if (chipBoltSlow) chipBoltSlow.classList.remove('active');

        MapEngine.setFilter('atherFast', true);
        MapEngine.setFilter('vidaFast', true);
        MapEngine.setFilter('boltFast', true);
        MapEngine.setFilter('boltSlow', false);

        syncRouteFilterBtn('atherFast', true);
        syncRouteFilterBtn('vidaFast', true);
        syncRouteFilterBtn('boltFast', true);
        syncRouteFilterBtn('boltSlow', false);
      } else {
        // Restore all chargers
        if (chipBoltSlow) chipBoltSlow.classList.add('active');
        MapEngine.setFilter('boltSlow', true);
        syncRouteFilterBtn('boltSlow', true);
      }
    });
  }

  if (chipAther) {
    chipAther.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const active = chipAther.classList.toggle('active');
      MapEngine.setFilter('atherFast', active);
      syncRouteFilterBtn('atherFast', active);
      checkFastOnlySync();
    });
  }

  if (chipVidaFast) {
    chipVidaFast.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const active = chipVidaFast.classList.toggle('active');
      MapEngine.setFilter('vidaFast', active);
      syncRouteFilterBtn('vidaFast', active);
      checkFastOnlySync();
    });
  }

  if (chipBoltFast) {
    chipBoltFast.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const active = chipBoltFast.classList.toggle('active');
      MapEngine.setFilter('boltFast', active);
      syncRouteFilterBtn('boltFast', active);
      checkFastOnlySync();
    });
  }

  if (chipBoltSlow) {
    chipBoltSlow.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const active = chipBoltSlow.classList.toggle('active');
      MapEngine.setFilter('boltSlow', active);
      syncRouteFilterBtn('boltSlow', active);
      checkFastOnlySync();
    });
  }
}

function syncRouteFilterBtn(filterKey, active) {
  const btn = document.querySelector(`.route-filter-btn[data-filter="${filterKey}"]`);
  if (btn) {
    if (active) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  const currentFilters = RouteEngine.getRouteFilters();
  currentFilters[filterKey] = active;
  RouteEngine.setRouteFilters(currentFilters);
}

function updateFilterBadges() {
  const stats = SyncEngine.getStats();
  const countFastOnly = document.getElementById('count-fast-only');
  const countAther = document.getElementById('count-ather-fast');
  const countVida = document.getElementById('count-vida-fast');
  const countBoltFast = document.getElementById('count-bolt-fast');
  const countBoltSlow = document.getElementById('count-bolt-slow');
  const btnNetworkPill = document.getElementById('btn-open-sync');
  const headerCountEl = document.getElementById('header-station-count');

  const totalFast = (stats.atherFast || 0) + (stats.vidaFast || 0) + (stats.boltFast || 0);
  if (countFastOnly) countFastOnly.textContent = totalFast.toLocaleString();
  if (countAther) countAther.textContent = stats.atherFast.toLocaleString();
  if (countVida) countVida.textContent = (stats.vidaFast || 0).toLocaleString();
  if (countBoltFast) countBoltFast.textContent = stats.boltFast.toLocaleString();
  if (countBoltSlow) countBoltSlow.textContent = stats.boltSlow.toLocaleString();
  if (headerCountEl) {
    headerCountEl.textContent = stats.total.toLocaleString();
  } else if (btnNetworkPill) {
    btnNetworkPill.innerHTML = `<span class="live-status-dot"></span> 🔄 Sync (<span id="header-station-count">${stats.total.toLocaleString()}</span>)`;
  }
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
      const route = RouteEngine.getActiveRoute();
      if (route) {
        onRouteStateChange({ activeRoute: route, corridorChargers: RouteEngine.getCorridorChargers(), waypoints: RouteEngine.getWaypoints() });
      }
    });
  }

  // Fast Charge Target SoC Limit (User Configurable)
  const targetChargeSlider = document.getElementById('target-charge-slider');
  const targetChargeVal = document.getElementById('target-charge-val');
  const targetPresets = document.querySelectorAll('.btn-target-preset');

  if (targetChargeSlider && targetChargeVal) {
    targetChargeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      targetChargeVal.textContent = `${val}%`;
      targetPresets.forEach(b => b.classList.toggle('active', parseInt(b.getAttribute('data-pct'), 10) === val));
      BatteryEngine.setTargetChargePct(val);
      const route = RouteEngine.getActiveRoute();
      if (route) {
        onRouteStateChange({ activeRoute: route, corridorChargers: RouteEngine.getCorridorChargers(), waypoints: RouteEngine.getWaypoints() });
      }
    });
  }

  targetPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      targetPresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseInt(btn.getAttribute('data-pct'), 10);
      if (targetChargeSlider) targetChargeSlider.value = val;
      if (targetChargeVal) targetChargeVal.textContent = `${val}%`;
      BatteryEngine.setTargetChargePct(val);
      const route = RouteEngine.getActiveRoute();
      if (route) {
        onRouteStateChange({ activeRoute: route, corridorChargers: RouteEngine.getCorridorChargers(), waypoints: RouteEngine.getWaypoints() });
      }
    });
  });
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

  // Sync Riding mode pills in battery dashboard
  document.querySelectorAll('.btn-mode').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === state.ridingMode);
  });

  // Update Safe Range circle on map
  MapEngine.updateSafeRangeOverlay();

  // Re-evaluate active trip if any
  const activeRoute = RouteEngine.getActiveRoute();
  if (activeRoute) {
    updateRouteMetrics(activeRoute);
    renderTripBatteryTimeline(activeRoute);
  }
}

// --- Route Planner ---
let originPoint = null;
let destinationPoint = null;
let intermediateCustomStops = []; // Array of { id, name, lat, lng, isCustomStop: true }

function renderIntermediateStops() {
  const container = document.getElementById('intermediate-stops-list');
  if (!container) return;
  container.innerHTML = '';

  intermediateCustomStops.forEach((stop, index) => {
    const charCode = String.fromCharCode(66 + index); // Stop B, Stop C, etc.
    const row = document.createElement('div');
    row.className = 'intermediate-stop-row';
    row.innerHTML = `
      <div class="stop-row-top">
        <span class="stop-badge">📍 Stop ${charCode}</span>
        <div class="stop-row-actions">
          ${index > 0 ? `<button type="button" class="btn-stop-ctrl btn-stop-up" title="Move Up">↑</button>` : ''}
          ${index < intermediateCustomStops.length - 1 ? `<button type="button" class="btn-stop-ctrl btn-stop-down" title="Move Down">↓</button>` : ''}
          <button type="button" class="btn-stop-ctrl btn-stop-delete" title="Remove Stop">&times;</button>
        </div>
      </div>
      <div class="autocomplete-wrapper">
        <input type="text" class="input-text input-stop-text" placeholder="Intermediate stop or city..." value="${stop.name || ''}" autocomplete="off">
        <div class="autocomplete-dropdown"></div>
      </div>
    `;

    const inputEl = row.querySelector('.input-stop-text');
    const dropdownEl = row.querySelector('.autocomplete-dropdown');

    // Attach autocomplete
    attachLocationAutocomplete(inputEl, dropdownEl, (point) => {
      stop.lat = point.lat;
      stop.lng = point.lng;
      stop.name = point.name;
      inputEl.value = point.name;
      const map = MapEngine.getMap();
      if (map) map.setView([point.lat, point.lng], 13, { animate: true });
    });

    inputEl.addEventListener('input', (e) => {
      stop.name = e.target.value;
      stop.lat = null;
      stop.lng = null;
    });

    // Move Up
    const btnUp = row.querySelector('.btn-stop-up');
    if (btnUp) {
      btnUp.addEventListener('click', () => {
        const temp = intermediateCustomStops[index - 1];
        intermediateCustomStops[index - 1] = intermediateCustomStops[index];
        intermediateCustomStops[index] = temp;
        renderIntermediateStops();
      });
    }

    // Move Down
    const btnDown = row.querySelector('.btn-stop-down');
    if (btnDown) {
      btnDown.addEventListener('click', () => {
        const temp = intermediateCustomStops[index + 1];
        intermediateCustomStops[index + 1] = intermediateCustomStops[index];
        intermediateCustomStops[index] = temp;
        renderIntermediateStops();
      });
    }

    // Delete
    const btnDel = row.querySelector('.btn-stop-delete');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        intermediateCustomStops.splice(index, 1);
        renderIntermediateStops();
      });
    }

    container.appendChild(row);
  });
}

window.removeWaypointSync = function (id) {
  intermediateCustomStops = intermediateCustomStops.filter(s => s.id !== id);
  renderIntermediateStops();
  if (window.RouteEngine) {
    window.RouteEngine.removeWaypoint(id);
  }
};

function setupRoutePlanner() {
  const originInput = document.getElementById('input-origin');
  const destInput = document.getElementById('input-destination');
  const btnUseGps = document.getElementById('btn-use-gps-origin');
  const btnPlanRoute = document.getElementById('btn-plan-route');
  const btnClearRoute = document.getElementById('btn-clear-route');
  const btnStartFullGmaps = document.getElementById('btn-start-gmaps-full');
  const btnNavNextCharger = document.getElementById('btn-nav-next-charger');
  const btnAddIntermediateStop = document.getElementById('btn-add-intermediate-stop');

  // Add intermediate stop button handler
  if (btnAddIntermediateStop) {
    btnAddIntermediateStop.addEventListener('click', () => {
      intermediateCustomStops.push({
        id: 'stop_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: '',
        lat: null,
        lng: null,
        isCustomStop: true
      });
      renderIntermediateStops();
      // Focus on the newly added input
      const inputs = document.querySelectorAll('.input-stop-text');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    });
  }

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

  // Setup Route Planner Charger Filter Pills (Ather Fast, VIDA Fast, Bolt Fast, Bolt Slow)
  const routeFilterBtns = document.querySelectorAll('.route-filter-btn');
  routeFilterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const filterKey = btn.getAttribute('data-filter');
      const isActive = btn.classList.toggle('active');

      const currentFilters = RouteEngine.getRouteFilters();
      const currentlyActive = Object.values(currentFilters).filter(Boolean).length;
      if (!isActive && currentlyActive <= 1) {
        // Prevent disabling all filters
        btn.classList.add('active');
        return;
      }

      currentFilters[filterKey] = isActive;
      RouteEngine.setRouteFilters(currentFilters);

      // Sync corresponding map filter chip
      const chipIdMap = {
        atherFast: 'chip-ather-fast',
        vidaFast: 'chip-vida-fast',
        boltFast: 'chip-bolt-fast',
        boltSlow: 'chip-bolt-slow'
      };
      const chipEl = document.getElementById(chipIdMap[filterKey]);
      if (chipEl) {
        if (isActive) chipEl.classList.add('active');
        else chipEl.classList.remove('active');
        MapEngine.setFilter(filterKey, isActive);
      }

      // If active route exists and battery range needs charging, re-evaluate with updated filter!
      const active = RouteEngine.getActiveRoute();
      if (active) {
        const evalMetrics = BatteryEngine.evaluateTrip(active.distanceKm);
        if (evalMetrics.status !== 'SAFE') {
          console.log('[VoltWay Router] Re-evaluating auto charging stops with filter:', currentFilters);
          await RouteEngine.autoSuggestChargingStops(evalMetrics);
        }
      }
    });
  });

  if (originInput) {
    originInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnPlanRoute) btnPlanRoute.click();
      }
    });
  }

  if (destInput) {
    destInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnPlanRoute) btnPlanRoute.click();
      }
    });
  }

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
      const origQuery = originInput ? originInput.value.trim() : '';
      if (!originPoint || (origQuery && origQuery !== 'Current Location (GPS)' && originPoint.name !== origQuery)) {
        if (origQuery && origQuery !== 'Current Location (GPS)') {
          const results = await Utilities.searchPlace(origQuery);
          if (results && results.length > 0) {
            originPoint = results[0];
          }
        }
        if (!originPoint) {
          const userC = MapEngine.getUserCoords();
          originPoint = userC ? { ...userC, name: 'Current Location' } : { lat: 12.9716, lng: 77.5946, name: 'MG Road, Bangalore' };
          if (originInput) originInput.value = originPoint.name;
        }
      }

      const destQuery = destInput ? destInput.value.trim() : '';
      if (!destinationPoint || (destQuery && destinationPoint.name !== destQuery)) {
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

      // Geocode any custom intermediate stops if needed
      for (let i = 0; i < intermediateCustomStops.length; i++) {
        const s = intermediateCustomStops[i];
        if (s.name && (s.lat == null || s.lng == null)) {
          const res = await Utilities.searchPlace(s.name);
          if (res && res.length > 0) {
            s.lat = res[0].lat;
            s.lng = res[0].lng;
            s.name = res[0].name;
          }
        }
      }

      const validCustomStops = intermediateCustomStops.filter(s => s.lat != null && s.lng != null);

      // Merge with any added chargers
      const existingChargers = (RouteEngine.getWaypoints() || []).filter(w => w.network || w.type);
      const combinedWaypoints = [...validCustomStops, ...existingChargers];

      btnPlanRoute.disabled = true;
      btnPlanRoute.textContent = 'Calculating Routes...';

      try {
        window.__isNewRouteCalculation = true;
        const route = await RouteEngine.calculateRoute(originPoint, destinationPoint, combinedWaypoints);
        const evalMetrics = BatteryEngine.evaluateTrip(route.distanceKm);

        if (evalMetrics.status !== 'SAFE') {
          console.log('[VoltWay] Route exceeds safe range, auto-discovering corridor charging stops...');
          await RouteEngine.autoSuggestChargingStops(evalMetrics);
        }
        window.expandBottomSheet();
      } catch (err) {
        alert('Route calculation error: ' + err.message);
      } finally {
        btnPlanRoute.disabled = false;
        btnPlanRoute.textContent = '⚡ Plan 2W Route';
      }
    });
  }

  if (btnClearRoute) {
    btnClearRoute.addEventListener('click', () => {
      RouteEngine.clearRoute();
      originPoint = null;
      destinationPoint = null;
      intermediateCustomStops = [];
      renderIntermediateStops();
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
 * Universal Autocomplete Handler for Location Input Fields (Instant 0ms Local + OSM)
 */
function attachLocationAutocomplete(inputEl, dropdownEl, onSelect) {
  if (!inputEl || !dropdownEl) return;
  let timer = null;

  const renderDropdown = (query, places, chargers) => {
    if (places.length === 0 && chargers.length === 0) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }

    let html = '';
    if (places.length > 0) {
      html += '<div class="dropdown-header">📍 Recommended Places & Cities</div>';
      places.forEach(p => {
        html += `
          <div class="dropdown-item" data-type="place" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${p.name.replace(/"/g, '&quot;')}">
            <div class="item-title">${highlightMatch(p.name, query)}</div>
            <div class="item-sub">${p.fullName}</div>
          </div>
        `;
      });
    }

    if (chargers.length > 0) {
      html += '<div class="dropdown-header">⚡ EV Chargers</div>';
      chargers.forEach(c => {
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
      const handleSelect = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const lat = parseFloat(item.getAttribute('data-lat'));
        const lng = parseFloat(item.getAttribute('data-lng'));
        const name = item.getAttribute('data-name');
        inputEl.value = name;
        dropdownEl.style.display = 'none';
        onSelect({ lat, lng, name });
      };
      item.addEventListener('click', handleSelect);
      item.addEventListener('touchend', handleSelect);
    });
  };

  const executeSearch = (query) => {
    if (query.length < 1) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }

    const qLower = query.toLowerCase();

    // 1. Instant local results (0ms)
    const localPlaces = Utilities.getLocalPlaces ? Utilities.getLocalPlaces(query) : [];
    const allChargers = SyncEngine.getChargers();
    const matchedChargers = allChargers.filter(c =>
      c.name.toLowerCase().includes(qLower) || (c.address && c.address.toLowerCase().includes(qLower))
    ).slice(0, 5);

    renderDropdown(query, localPlaces, matchedChargers);

    // 2. Query OSM geocoder in background if query is >= 2 letters
    if (query.length >= 2) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const fullPlaces = await Utilities.searchPlace(query);
        renderDropdown(query, fullPlaces, matchedChargers);
      }, 200);
    }
  };

  inputEl.addEventListener('input', () => {
    executeSearch(inputEl.value.trim());
  });

  inputEl.addEventListener('focus', () => {
    const val = inputEl.value.trim();
    if (val.length >= 1 && val !== 'Current Location (GPS)') {
      executeSearch(val);
    }
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
    const timelineSection = document.getElementById('trip-battery-timeline-section');
    if (timelineSection) timelineSection.style.display = 'none';
    const corridorContainer = document.getElementById('corridor-chargers-list');
    if (corridorContainer) corridorContainer.innerHTML = '';
    const corridorCount = document.getElementById('corridor-count');
    if (corridorCount) corridorCount.textContent = '0';
    if (window.MapEngine && window.MapEngine.renderRoute) {
      window.MapEngine.renderRoute(null);
    }
    return;
  }

  // 1. Render all alternative routes on map with active selected highlight
  const shouldFit = window.__isNewRouteCalculation === true;
  window.__isNewRouteCalculation = false;
  MapEngine.renderRoute(route, allRoutes, selectedRouteIndex, shouldFit);

  // 2. Render Google Maps Style Route Alternative Selector Cards
  if (routeSelectorContainer && routeSelectorPills) {
    if (allRoutes && allRoutes.length > 1) {
      routeSelectorContainer.style.display = 'flex';
      const countEl = document.getElementById('route-selector-count');
      if (countEl) countEl.textContent = `${allRoutes.length} Available`;

      const primaryDur = (allRoutes[0] && allRoutes[0].durationMins) || route.durationMins;

      routeSelectorPills.innerHTML = allRoutes.map((r, idx) => {
        const isSelected = idx === selectedRouteIndex;
        const diffMins = r.durationMins - primaryDur;
        const badgeLabel = idx === 0 ? '⚡ FASTEST' : (diffMins > 0 ? `+${diffMins} min` : `${r.durationMins} min`);
        const badgeClass = idx === 0 ? 'pill-badge-fastest' : 'pill-badge-diff';
        const roadLabel = r.roadName || r.name;

        return `
          <div class="route-card-pill ${isSelected ? 'active' : ''}" onclick="RouteEngine.selectRoute(${idx})" role="button" tabindex="0">
            <div class="pill-top-row">
              <span class="pill-badge ${badgeClass}">${badgeLabel}</span>
              <span class="pill-dist-txt">${r.distanceKm} km</span>
            </div>
            <div class="pill-duration-val">${Utilities.formatMinutes(r.durationMins)}</div>
            <div class="pill-road-txt" title="${roadLabel}">${roadLabel}</div>
          </div>
        `;
      }).join('');
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
            <button class="btn-remove-waypoint" onclick="removeWaypointSync('${wp.id}')" title="Remove Stop">❌</button>
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
  renderTripBatteryTimeline(route);
  renderCorridorChargersList(corridorChargers, waypoints);
}

function renderTripBatteryTimeline(route) {
  const timelineSection = document.getElementById('trip-battery-timeline-section');
  const timelineContainer = document.getElementById('trip-battery-timeline-container');
  if (!timelineSection || !timelineContainer || !route) return;

  const batteryState = BatteryEngine.getState();
  const tripPlan = RouteEngine.calculateTripTimeline(route, batteryState);
  if (!tripPlan || !tripPlan.timeline) {
    timelineSection.style.display = 'none';
    return;
  }

  timelineSection.style.display = 'block';

  // Wire up Timeline Mode Toggle (Fast Travel vs Full Target)
  const currentMode = RouteEngine.getTimelineMode ? RouteEngine.getTimelineMode() : 'optimal';
  const btnOptimal = document.getElementById('btn-mode-optimal');
  const btnTarget = document.getElementById('btn-mode-target');
  if (btnOptimal && btnTarget) {
    btnOptimal.classList.toggle('active', currentMode === 'optimal');
    btnTarget.classList.toggle('active', currentMode === 'target');
    btnOptimal.onclick = () => {
      if (RouteEngine.setTimelineMode) RouteEngine.setTimelineMode('optimal');
    };
    btnTarget.onclick = () => {
      if (RouteEngine.setTimelineMode) RouteEngine.setTimelineMode('target');
    };
  }

  let html = `
    <div class="trip-plan-header-summary">
      <div class="trip-plan-stat">
        <span class="stat-label">Driving Time</span>
        <span class="stat-val">${Utilities.formatMinutes(tripPlan.totalDrivingMins)}</span>
      </div>
      <div class="trip-plan-stat">
        <span class="stat-label">Charging Time</span>
        <span class="stat-val stat-charge">${tripPlan.totalChargingMins > 0 ? `+${Utilities.formatMinutes(tripPlan.totalChargingMins)}` : '0 min'}</span>
      </div>
      <div class="trip-plan-stat">
        <span class="stat-label">Total Duration</span>
        <span class="stat-val stat-total">${Utilities.formatMinutes(tripPlan.totalTripDurationMins)}</span>
      </div>
      <div class="trip-plan-stat">
        <span class="stat-label">Dest. Arrival</span>
        <span class="stat-val ${tripPlan.finalArrivalSoC >= batteryState.safetyReservePct ? 'stat-safe' : 'stat-warn'}">${tripPlan.finalArrivalSoC < 0 ? '0% (Empty)' : `${tripPlan.finalArrivalSoC}%`}</span>
      </div>
    </div>
    <div class="timeline-nodes-list">
  `;

  tripPlan.timeline.forEach((step, idx) => {
    if (step.type === 'ORIGIN') {
      html += `
        <div class="timeline-step timeline-step-origin">
          <div class="step-icon-col">
            <div class="step-dot dot-origin">🚩</div>
            <div class="step-stem"></div>
          </div>
          <div class="step-content">
            <div class="step-title-row">
              <span class="step-title">${step.name}</span>
              <span class="badge-soc badge-soc-start">Start: ${step.departureSoC}% SoC</span>
            </div>
            <div class="step-sub">Initial Departure Battery Charge</div>
          </div>
        </div>
      `;
    } else if (step.type === 'LEG') {
      html += `
        <div class="timeline-step timeline-step-leg">
          <div class="step-icon-col">
            <div class="step-stem"></div>
          </div>
          <div class="step-content leg-content">
            <div class="leg-pill">
              <span>🛣️ ${step.distanceKm} km</span>
              <span>•</span>
              <span>⏱️ ${Utilities.formatMinutes(step.durationMins)}</span>
              <span>•</span>
              <span class="leg-bat-used">⚡ -${step.batteryUsedPct}% battery</span>
            </div>
          </div>
        </div>
      `;
    } else if (step.type === 'CHARGER_STOP') {
      const isFast = step.isFast;
      let netName = 'Bolt.Earth 15A 🔌';
      let badgeClass = 'badge-bolt-slow';

      if (step.station?.network === 'ATHER_GRID') {
        netName = 'Ather Grid Fast ⚡';
        badgeClass = 'badge-ather';
      } else if (step.station?.network === 'VIDA_GRID') {
        netName = 'Hero VIDA Fast ⚡';
        badgeClass = 'badge-vida-fast';
      } else if (isFast) {
        netName = 'Bolt.Earth Fast ⚡';
        badgeClass = 'badge-bolt-fast';
      }

      const stationNameClean = (step.station?.name || `Stop ${step.index}`).replace(step.station?.network === 'VIDA_GRID' ? /\s*\(Ather Gun[^)]*\)/gi : '', '');

      html += `
        <div class="timeline-step timeline-step-stop">
          <div class="step-icon-col">
            <div class="step-dot dot-stop ${isFast ? 'dot-fast' : 'dot-slow'}">
              ${isFast ? '⚡' : '🔌'}
            </div>
            <div class="step-stem"></div>
          </div>
          <div class="step-content stop-card">
            <div class="step-title-row">
              <span class="step-title">${stationNameClean}</span>
              <span class="badge-net ${badgeClass}">${netName}</span>
            </div>

            <!-- Smart Stop Charging Recommendation Box -->
            <div class="stop-rec-grid">
              <div class="stop-rec-card ${currentMode === 'optimal' ? 'active' : ''}">
                <div class="stop-rec-hdr">
                  <span class="stop-rec-tag tag-rec">⚡ RECOMMENDED (FAST HOP)</span>
                  <span class="stop-rec-time">⏱️ ~${step.optimalChargeTimeMins} min</span>
                </div>
                <div class="stop-rec-main">
                  Charge to <span class="rec-highlight">${step.optimalTargetSoC}%</span> (+${step.optimalChargeNeededPct}%)
                </div>
                <div class="stop-rec-sub">
                  ${step.optimalTargetSoC >= step.targetChargeSoC && step.isFast ? `Fast Charger limit (${step.targetChargeSoC}%) to reach next stop (${step.nextLegDist} km)` : `Safe buffer to reach next stop (${step.nextLegDist} km)`}
                </div>
              </div>

              <div class="stop-rec-card ${currentMode === 'target' ? 'active' : ''}">
                <div class="stop-rec-hdr">
                  <span class="stop-rec-tag tag-target">🔋 FULL TARGET LIMIT</span>
                  <span class="stop-rec-time">⏱️ ~${step.fullChargeTimeMins} min</span>
                </div>
                <div class="stop-rec-main">
                  Charge to <span class="rec-highlight">${step.fullTargetSoC}%</span> (+${step.fullChargeNeededPct}%)
                </div>
                <div class="stop-rec-sub">
                  ${step.isFast ? `Fast Charger hard limit (${step.targetChargeSoC}% cutoff)` : `Standard socket target (${step.targetChargeSoC}% limit)`}
                </div>
              </div>
            </div>

            <!-- Smart Rider Advice Callout -->
            <div class="stop-smart-callout">
              💡 ${step.smartAdvice}
            </div>

            <!-- Active Metrics Grid -->
            <div class="stop-metrics-grid">
              <div class="stop-metric-box">
                <span class="stop-metric-lbl">Arrival SoC</span>
                <span class="stop-metric-val ${step.isSafeArrival ? 'val-safe' : 'val-warn'}">${step.arrivalSoC < 0 ? '0% (Empty)' : `${step.arrivalSoC}%`}</span>
              </div>
              <div class="stop-metric-box">
                <span class="stop-metric-lbl">Charge Needed</span>
                <span class="stop-metric-val val-charge">+${step.chargeNeededPct}%</span>
              </div>
              <div class="stop-metric-box">
                <span class="stop-metric-lbl">Charge Time</span>
                <span class="stop-metric-val val-time">${step.chargeTimeMins > 0 ? `~${step.chargeTimeMins} min` : '0 min'}</span>
              </div>
              <div class="stop-metric-box">
                <span class="stop-metric-lbl">Depart SoC</span>
                <span class="stop-metric-val val-depart">${step.departureSoC}%</span>
              </div>
            </div>
            ${step.arrivalSoC < 0 ? `
              <div class="stop-warning-pill" style="background: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #fca5a5;">
                🚨 Battery Depleted: Battery runs out before reaching this charger (short by ~${Math.round(Math.abs(step.arrivalSoC) * (batteryState.efficiency || 0.85))} km). Add an earlier charging stop!
              </div>
            ` : (!step.isSafeArrival ? `
              <div class="stop-warning-pill">
                ⚠️ Low Battery Arrival Warning: Arriving at ${step.arrivalSoC}% (below ${batteryState.safetyReservePct}% safety buffer).
              </div>
            ` : '')}
          </div>
        </div>
      `;
    } else if (step.type === 'CUSTOM_STOP') {
      const isShortfall = step.arrivalSoC < 0;
      const shortfallKm = isShortfall ? Math.round(Math.abs(step.arrivalSoC) * (batteryState.efficiency || 0.85) * 10) / 10 : 0;
      const arrivalDisplay = isShortfall ? `0% (Empty • Short by ~${shortfallKm} km)` : `${step.arrivalSoC}% SoC`;

      html += `
        <div class="timeline-step timeline-step-custom-stop">
          <div class="step-icon-col">
            <div class="step-dot dot-custom-stop">📍</div>
          </div>
          <div class="step-content">
            <div class="step-title-row">
              <span class="step-title">${step.name || 'Intermediate Waypoint'}</span>
              <span class="badge-soc ${step.isSafeArrival ? 'badge-soc-dest-safe' : 'badge-soc-dest-warn'}">
                Arrival: ${arrivalDisplay}
              </span>
            </div>
            <div class="step-sub">
              <span>📍 Intermediate Waypoint • Estimated Remaining Battery: ${step.arrivalSoC < 0 ? '0% (Empty)' : `${step.arrivalSoC}%`}</span>
              ${!step.isSafeArrival ? `<div style="color: #ef4444; font-weight: 700; margin-top: 3px;">⚠️ Battery falls below safety reserve before reaching this stop. Please add an intermediate charging stop!</div>` : ''}
            </div>
          </div>
        </div>
      `;
    } else if (step.type === 'DESTINATION') {
      const isShortfall = step.arrivalSoC < 0;
      const shortfallKm = isShortfall ? Math.round(Math.abs(step.arrivalSoC) * (batteryState.efficiency || 0.85) * 10) / 10 : 0;
      const arrivalDisplay = isShortfall ? `0% (Empty • Short by ~${shortfallKm} km)` : `${step.arrivalSoC}% SoC`;

      html += `
        <div class="timeline-step timeline-step-dest">
          <div class="step-icon-col">
            <div class="step-dot dot-dest">🏁</div>
          </div>
          <div class="step-content">
            <div class="step-title-row">
              <span class="step-title">${step.name}</span>
              <span class="badge-soc ${step.isSafe ? 'badge-soc-dest-safe' : 'badge-soc-dest-warn'}">
                Final Arrival: ${arrivalDisplay}
              </span>
            </div>
            <div class="step-sub">
              ${step.isSafe
                ? `✅ Safe Arrival! ${step.arrivalSoC}% battery reserve remaining at destination.`
                : (isShortfall
                    ? `🚨 Range Shortfall: Battery will run out completely ~${shortfallKm} km before destination (short by ${Math.abs(step.arrivalSoC)}% battery). Please add an intermediate charging stop!`
                    : `⚠️ Reserve Alert: Battery reaches ${step.arrivalSoC}%, which is below your ${batteryState.safetyReservePct}% safety reserve buffer.`
                  )
              }
            </div>
          </div>
        </div>
      `;
    }
  });

  html += '</div>';
  timelineContainer.innerHTML = html;
}

function activateTabSilently(tabTarget) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabTarget));
  tabPanes.forEach(p => p.classList.toggle('active', p.id === `pane-${tabTarget}`));
}

// Global helpers to set origin / destination directly from map charger clicks (WITHOUT popping up the bottom drawer)
window.setPlannerOrigin = function (point) {
  originPoint = point;
  const input = document.getElementById('input-origin');
  if (input) input.value = point.name;
  activateTabSilently('route');
  if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
    window.SyncEngine.showAutoUpdateToast(`🚩 Starting Point: ${point.name}`);
  }
};

window.setPlannerDest = function (point) {
  destinationPoint = point;
  const input = document.getElementById('input-destination');
  if (input) input.value = point.name;
  activateTabSilently('route');
  if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
    window.SyncEngine.showAutoUpdateToast(`🏁 Destination: ${point.name}`);
  }
};

function updateRouteMetrics(route) {
  const distEl = document.getElementById('metric-trip-dist');
  const timeEl = document.getElementById('metric-trip-time');
  const batNeedEl = document.getElementById('metric-bat-needed');
  const batArrivalEl = document.getElementById('metric-bat-arrival');
  const statusBanner = document.getElementById('route-status-banner');

  if (!route) return;

  const batState = BatteryEngine.getState();
  const eff = batState.efficiency || 0.85;
  const hasStops = route.waypoints && route.waypoints.length > 0;

  if (hasStops) {
    const tripPlan = RouteEngine.calculateTripTimeline(route, batState);
    const chargerStopsCount = route.waypoints.filter(w => w.network || w.type).length;

    if (distEl) distEl.textContent = `${route.distanceKm} km`;
    if (timeEl) {
      if (tripPlan.totalChargingMins > 0) {
        timeEl.textContent = Utilities.formatMinutes(tripPlan.totalTripDurationMins);
        timeEl.title = `Driving: ${Utilities.formatMinutes(tripPlan.totalDrivingMins)} + Charging: ${tripPlan.totalChargingMins} mins`;
      } else {
        timeEl.textContent = Utilities.formatMinutes(route.durationMins);
      }
    }

    const totalBatNeeded = Math.ceil(route.distanceKm / eff);
    if (batNeedEl) batNeedEl.textContent = `${totalBatNeeded}%`;

    if (batArrivalEl) {
      if (tripPlan.finalArrivalSoC < 0) {
        batArrivalEl.textContent = '0% (Empty)';
        batArrivalEl.style.color = '#ef4444';
      } else {
        batArrivalEl.textContent = `${tripPlan.finalArrivalSoC}%`;
        batArrivalEl.style.color = '';
      }
    }

    if (statusBanner) {
      let criticalStep = null;
      let warningStep = null;

      for (let s of tripPlan.timeline) {
        if (s.type === 'CHARGER_STOP' || s.type === 'CUSTOM_STOP' || s.type === 'DESTINATION') {
          if (s.arrivalSoC < 0) {
            criticalStep = s;
            break;
          } else if (s.arrivalSoC < batState.safetyReservePct && !warningStep) {
            warningStep = s;
          }
        }
      }

      if (criticalStep) {
        const stepName = criticalStep.station?.name || criticalStep.name || 'Next Stop';
        const shortfall = Math.abs(criticalStep.arrivalSoC);
        const shortfallKm = Math.round(shortfall * eff * 10) / 10;
        statusBanner.className = 'status-banner status-critical';
        statusBanner.innerHTML = `<strong>🚨 Range Exceeded: Leg to ${stepName} is short by ~${shortfallKm} km (${shortfall}% SoC). Please add an intermediate charging stop!</strong>`;
      } else if (warningStep) {
        const stepName = warningStep.station?.name || warningStep.name || 'Next Stop';
        statusBanner.className = 'status-banner status-warning';
        statusBanner.innerHTML = `<strong>⚠️ Reserve Warning: Reaches ${stepName} with ${warningStep.arrivalSoC}% SoC (below ${batState.safetyReservePct}% safety reserve buffer).</strong>`;
      } else {
        statusBanner.className = 'status-banner status-safe';
        const chargeNote = tripPlan.totalChargingMins > 0
          ? ` (${chargerStopsCount} charging stop${chargerStopsCount > 1 ? 's' : ''}, ~${tripPlan.totalChargingMins} min charging)`
          : '';
        statusBanner.innerHTML = `<strong>🟢 Safe Multi-Stop Trip Planned! Reaches destination with ${tripPlan.finalArrivalSoC}% battery${chargeNote}.</strong>`;
      }
    }
  } else {
    // Direct Trip without intermediate stops
    const evalMetrics = BatteryEngine.evaluateTrip(route.distanceKm);

    if (distEl) distEl.textContent = `${route.distanceKm} km`;
    if (timeEl) timeEl.textContent = Utilities.formatMinutes(route.durationMins);
    if (batNeedEl) batNeedEl.textContent = `${evalMetrics.batteryNeededPct}%`;
    if (batArrivalEl) {
      if (evalMetrics.batteryAtArrivalPct < 0) {
        batArrivalEl.textContent = '0% (Empty)';
        batArrivalEl.style.color = '#ef4444';
      } else {
        batArrivalEl.textContent = `${evalMetrics.batteryAtArrivalPct}%`;
        batArrivalEl.style.color = '';
      }
    }

    if (statusBanner) {
      statusBanner.className = `status-banner ${evalMetrics.statusClass}`;
      statusBanner.innerHTML = `<strong>${evalMetrics.statusText}</strong>`;
    }
  }
}

function renderCorridorChargersList(corridorChargers, waypoints) {
  const container = document.getElementById('corridor-chargers-list');
  const countEl = document.getElementById('corridor-count');

  if (countEl) countEl.textContent = corridorChargers.length;
  if (!container) return;

  if (corridorChargers.length === 0) {
    container.innerHTML = `<div class="empty-state">No 2W chargers found along this route corridor.</div>`;
    return;
  }

  let html = '';
  corridorChargers.forEach((c) => {
    const isWp = waypoints.some(w => w.id === c.id);
    let badgeClass = 'badge-bolt-slow';
    let netName = 'Bolt 15A 🔌';

    if (c.network === 'ATHER_GRID') {
      badgeClass = 'badge-ather';
      netName = 'Ather Grid ⚡';
    } else if (c.network === 'VIDA_GRID') {
      badgeClass = 'badge-vida-fast';
      netName = 'Hero VIDA ⚡';
    } else if (c.network === 'BOLT_EARTH' && c.type === 'FAST') {
      badgeClass = 'badge-bolt-fast';
      netName = 'Bolt Fast ⚡';
    }

    const cleanName = c.network === 'VIDA_GRID' ? c.name.replace(/\s*\(Ather Gun[^)]*\)/gi, '') : c.name;

    html += `
      <div class="corridor-card ${isWp ? 'is-waypoint' : ''}">
        <div class="corridor-card-header">
          <span class="popup-badge ${badgeClass}">${netName}</span>
          <span class="corridor-dist">📍 ~${c.kmFromOrigin} km from start (${c.corridorDistanceKm} km detour)</span>
        </div>
        <div class="corridor-card-title">${cleanName}</div>
        <div class="corridor-card-desc">${c.connector || (c.type === 'FAST' ? '⚡ High-Speed DC Fast Charger' : '🔌 Standard 15A AC Socket')}</div>
        <div class="corridor-card-actions">
          <button class="btn-sm btn-nav" onclick="MapEngine.focusCharger(window.SyncEngine.getChargers().find(x=>x.id==='${c.id}'))">🔍 Show on Map</button>
          ${isWp
            ? `<button class="btn-sm btn-remove-stop" onclick="removeWaypointSync('${c.id}')">❌ Remove Stop</button>`
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

  // Switch to Route tab silently without popping up bottom drawer
  activateTabSilently('route');
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
  const atherEl = document.getElementById('modal-ather-count');
  const vidaEl = document.getElementById('modal-vida-count');
  const boltFastEl = document.getElementById('modal-bolt-fast-count');
  const boltSlowEl = document.getElementById('modal-bolt-slow-count');
  const lastSyncEl = document.getElementById('sync-last-timestamp');

  if (totalEl) totalEl.textContent = stats.total.toLocaleString();
  if (atherEl) atherEl.textContent = stats.atherFast.toLocaleString();
  if (vidaEl) vidaEl.textContent = (stats.vidaFast || 0).toLocaleString();
  if (boltFastEl) boltFastEl.textContent = stats.boltFast.toLocaleString();
  if (boltSlowEl) boltSlowEl.textContent = stats.boltSlow.toLocaleString();
  if (lastSyncEl) {
    lastSyncEl.textContent = stats.lastSync
      ? `🟢 Synced (${new Date(stats.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
      : '🟢 Connected & Live';
  }
}

function onSyncStateChange() {
  updateFilterBadges();
}

// --- Google Maps Route Importer & Android Share Target ---
function setupGoogleMapsImporter() {
  const triggerBtn = document.getElementById('btn-import-gmaps-trigger');
  const modal = document.getElementById('modal-import-gmaps');
  const closeBtn = document.getElementById('btn-close-import-gmaps');
  const pasteBtn = document.getElementById('btn-paste-clipboard');
  const textarea = document.getElementById('input-gmaps-paste');
  const executeBtn = document.getElementById('btn-execute-import-gmaps');
  const statusMsg = document.getElementById('import-status-msg');

  if (!modal) return;

  if (triggerBtn) {
    triggerBtn.addEventListener('click', () => {
      modal.classList.add('open');
      if (statusMsg) statusMsg.style.display = 'none';
      if (textarea) {
        textarea.value = '';
        setTimeout(() => textarea.focus(), 150);
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  if (pasteBtn && textarea) {
    pasteBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const clipText = await navigator.clipboard.readText();
          if (clipText) {
            textarea.value = clipText;
            if (statusMsg) {
              statusMsg.style.display = 'block';
              statusMsg.style.background = 'rgba(0, 230, 118, 0.12)';
              statusMsg.style.color = '#00E676';
              statusMsg.style.border = '1px solid rgba(0, 230, 118, 0.35)';
              statusMsg.textContent = '📋 Link pasted from clipboard!';
            }
          }
        } else {
          alert('Clipboard permission not granted. Please paste directly into the box.');
        }
      } catch (err) {
        alert('Please press Ctrl+V or long-press to paste into the box.');
      }
    });
  }

  if (executeBtn) {
    executeBtn.addEventListener('click', async () => {
      const raw = textarea ? textarea.value.trim() : '';
      if (!raw) {
        if (statusMsg) {
          statusMsg.style.display = 'block';
          statusMsg.style.background = 'rgba(239, 68, 68, 0.12)';
          statusMsg.style.color = '#f87171';
          statusMsg.style.border = '1px solid rgba(239, 68, 68, 0.35)';
          statusMsg.textContent = 'Please paste a Google Maps link or shared text.';
        }
        return;
      }

      executeBtn.disabled = true;
      executeBtn.textContent = 'Extracting Route Points...';

      try {
        const parsed = await NavigationEngine.parseGoogleMapsInput(raw);
        if (!parsed.success) {
          throw new Error(parsed.error || 'Could not parse route from link.');
        }

        // Set Origin
        if (parsed.origin) {
          if (parsed.origin.lat != null && parsed.origin.lng != null) {
            originPoint = parsed.origin;
          } else if (parsed.origin.name) {
            const res = await Utilities.searchPlace(parsed.origin.name);
            originPoint = res && res.length > 0 ? res[0] : { name: parsed.origin.name };
          }
          const origInput = document.getElementById('input-origin');
          if (origInput && originPoint) origInput.value = originPoint.name || 'Start Point';
        }

        // Set Destination
        if (parsed.destination) {
          if (parsed.destination.lat != null && parsed.destination.lng != null) {
            destinationPoint = parsed.destination;
          } else if (parsed.destination.name) {
            const res = await Utilities.searchPlace(parsed.destination.name);
            destinationPoint = res && res.length > 0 ? res[0] : { name: parsed.destination.name };
          }
          const destInput = document.getElementById('input-destination');
          if (destInput && destinationPoint) destInput.value = destinationPoint.name || 'Destination';
        }

        // Set Intermediate Stops
        intermediateCustomStops = [];
        if (parsed.intermediateStops && parsed.intermediateStops.length > 0) {
          for (let i = 0; i < parsed.intermediateStops.length; i++) {
            const s = parsed.intermediateStops[i];
            let stopPoint = s;
            if (s.name && (s.lat == null || s.lng == null)) {
              const res = await Utilities.searchPlace(s.name);
              if (res && res.length > 0) stopPoint = res[0];
            }
            intermediateCustomStops.push({
              id: 'stop_import_' + i + '_' + Date.now(),
              name: stopPoint.name || `Stop ${String.fromCharCode(66 + i)}`,
              lat: stopPoint.lat,
              lng: stopPoint.lng,
              isCustomStop: true
            });
          }
        }
        renderIntermediateStops();

        modal.classList.remove('open');
        activateTabSilently('route');

        // Automatically trigger route calculation
        const btnPlan = document.getElementById('btn-plan-route');
        if (btnPlan) {
          setTimeout(() => btnPlan.click(), 300);
        }
      } catch (err) {
        if (statusMsg) {
          statusMsg.style.display = 'block';
          statusMsg.style.background = 'rgba(239, 68, 68, 0.12)';
          statusMsg.style.color = '#f87171';
          statusMsg.style.border = '1px solid rgba(239, 68, 68, 0.35)';
          statusMsg.textContent = '❌ ' + err.message;
        }
      } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = '⚡ Import Route & Plan EV Charging';
      }
    });
  }
}

// Android Web Share Target auto-detection
function checkSharedRouteParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedText = urlParams.get('text') || urlParams.get('url') || urlParams.get('title');
  if (sharedText) {
    console.log('[VoltWay] Detected shared route params from Android Share Target:', sharedText);
    const modal = document.getElementById('modal-import-gmaps');
    const textarea = document.getElementById('input-gmaps-paste');
    if (modal && textarea) {
      textarea.value = sharedText;
      const executeBtn = document.getElementById('btn-execute-import-gmaps');
      if (executeBtn) {
        setTimeout(() => executeBtn.click(), 500);
      }
    }
  }
}

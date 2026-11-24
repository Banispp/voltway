/**
 * VoltWay 2W - Main Application Controller
 * Handles UI interactions, bottom sheet drawer, tabs, and event coordination
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VoltWay 2W] Bootstrapping Application...');

  // Pre-cache all frequently used DOM elements (eliminates 100+ repeated getElementById calls)
  const EL = {
    map: document.getElementById('map'),
    bottomSheet: document.getElementById('bottom-sheet'),
    sheetHandleBar: document.getElementById('sheet-handle-bar'),
    btnToggleDrawer: document.getElementById('btn-toggle-drawer'),
    searchInput: document.getElementById('search-places-input'),
    searchDropdown: document.getElementById('search-dropdown'),
    btnInstall: document.getElementById('btn-install-app'),
    btnForceRefresh: document.getElementById('btn-force-refresh'),
  };

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
  setupStateFilter();
  setupFilterChips();
  setupBatteryControls();
  setupRoutePlanner();
  setupChargingEstimator();
  setupSOSModule();
  setupSyncModal();
  setupSunlightToggle();
  setupSearchAutocomplete();
  setupGoogleMapsImporter();
  setupCorridorDistanceSelector();
  setupDriveModeControls();
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
      navigator.serviceWorker.register('./sw.js?v=5.13')
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
  document.body.classList.add('drawer-open');
};

window.collapseBottomSheet = function() {
  const bs = document.getElementById('bottom-sheet');
  const tb = document.getElementById('btn-toggle-drawer');
  if (bs) bs.classList.add('collapsed');
  if (tb) tb.innerHTML = '▲ Expand Panel';
  document.body.classList.remove('drawer-open');
};

// --- Tabs Management ---
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const bottomSheet = document.getElementById('bottom-sheet');
  const toggleDrawerBtn = document.getElementById('btn-toggle-drawer');
  const handleBar = document.getElementById('sheet-handle-bar');

  // Sync initial body drawer state
  if (bottomSheet && !bottomSheet.classList.contains('collapsed')) {
    document.body.classList.add('drawer-open');
  }

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
      document.body.classList.toggle('drawer-open', !isCollapsed);
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
      document.body.classList.toggle('drawer-open', !isCollapsed);
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
  checkFastOnlySync();
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

function setupStateFilter() {
  const chips = document.querySelectorAll('.state-chip');
  if (!chips || chips.length === 0) return;

  const savedState = localStorage.getItem('voltway_selected_state') || localStorage.getItem('voltway_state_filter') || 'all';
  if (window.MapEngine && window.MapEngine.setStateFilter) {
    window.MapEngine.setStateFilter(savedState);
  }

  chips.forEach(chip => {
    const st = chip.getAttribute('data-state');
    if (st === savedState) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }

    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const chosenState = chip.getAttribute('data-state');
      localStorage.setItem('voltway_selected_state', chosenState);
      localStorage.setItem('voltway_state_filter', chosenState);
      if (window.MapEngine && window.MapEngine.setStateFilter) {
        window.MapEngine.setStateFilter(chosenState);
      }
      updateFilterBadges();

      const stateLabels = {
        all: '🌐 All (Fast 2W Stations)',
        kerala: '🌴 Kerala (Fastest 0-Lag)',
        karnataka: '🌲 Karnataka & Bengaluru',
        tamil_nadu: '🛕 Tamil Nadu'
      };
      if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
        window.SyncEngine.showAutoUpdateToast(`Showing ${stateLabels[chosenState] || chosenState} chargers`);
      }
    });
  });
}

function updateFilterBadges() {
  const activeState = (window.MapEngine && window.MapEngine.getStateFilter) ? window.MapEngine.getStateFilter() : 'all';
  const allChargers = (window.SyncEngine && window.SyncEngine.getChargers) ? window.SyncEngine.getChargers() : [];

  let total = 0;
  let atherFast = 0;
  let vidaFast = 0;
  let boltFast = 0;
  let boltSlow = 0;

  for (let i = 0; i < allChargers.length; i++) {
    const c = allChargers[i];
    if (activeState !== 'all' && c.state !== activeState) continue;
    total++;
    if (c.network === 'ATHER_GRID') {
      atherFast++;
    } else if (c.network === 'VIDA_GRID') {
      vidaFast++;
    } else if (c.network === 'BOLT_EARTH') {
      if (c.type === 'FAST') boltFast++;
      else boltSlow++;
    }
  }

  const countFastOnly = document.getElementById('count-fast-only');
  const countAther = document.getElementById('count-ather-fast');
  const countVida = document.getElementById('count-vida-fast');
  const countBoltFast = document.getElementById('count-bolt-fast');
  const countBoltSlow = document.getElementById('count-bolt-slow');
  const btnNetworkPill = document.getElementById('btn-open-sync');
  const headerCountEl = document.getElementById('header-station-count');

  const totalFast = atherFast + vidaFast + boltFast;
  if (countFastOnly) countFastOnly.textContent = totalFast.toLocaleString();
  if (countAther) countAther.textContent = atherFast.toLocaleString();
  if (countVida) countVida.textContent = vidaFast.toLocaleString();
  if (countBoltFast) countBoltFast.textContent = boltFast.toLocaleString();
  if (countBoltSlow) countBoltSlow.textContent = boltSlow.toLocaleString();
  if (headerCountEl) {
    headerCountEl.textContent = total.toLocaleString();
  } else if (btnNetworkPill) {
    btnNetworkPill.innerHTML = `<span class="live-status-dot"></span> 🔄 Sync (<span id="header-station-count">${total.toLocaleString()}</span>)`;
  }
}

// --- Battery & Range Controls ---
function setupBatteryControls() {
  const slider = document.getElementById('battery-slider');
  const numberInput = document.getElementById('battery-number');
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

  // Fast Charge Target SoC Limit (User Configurable Slider)
  const targetChargeSlider = document.getElementById('target-charge-slider');
  const targetChargeVal = document.getElementById('target-charge-val');

  if (targetChargeSlider && targetChargeVal) {
    targetChargeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      targetChargeVal.textContent = `${val}%`;
      BatteryEngine.setTargetChargePct(val);
      const route = RouteEngine.getActiveRoute();
      if (route) {
        onRouteStateChange({ activeRoute: route, corridorChargers: RouteEngine.getCorridorChargers(), waypoints: RouteEngine.getWaypoints() });
      }
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

// --- Mobile Clipboard Helper ---
async function handleClipboardPaste(targetInput, onPasted) {
  if (!targetInput) return;
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        targetInput.value = text.trim();
        if (onPasted) await onPasted(text.trim());
        return;
      }
    } catch (e) {
      console.warn('[VoltWay] Clipboard access note:', e);
    }
  }
  targetInput.focus();
  targetInput.select();
  if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
    window.SyncEngine.showAutoUpdateToast('📋 Long-press inside the box to paste');
  }
}

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
        <div class="input-row">
          <input type="text" class="input-text input-stop-text" placeholder="Intermediate stop, town, or address..." value="${stop.name || ''}" autocomplete="off">
        </div>
        <div class="autocomplete-dropdown"></div>
      </div>
    `;

    const inputEl = row.querySelector('.input-stop-text');
    const dropdownEl = row.querySelector('.autocomplete-dropdown');

    // Attach autocomplete and link resolver
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
  const btnStartInAppNav = document.getElementById('btn-start-inapp-nav');
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

  // Attach rich autocomplete and link resolver to Starting Point (A)
  attachLocationAutocomplete(originInput, document.getElementById('origin-suggestions'), (point) => {
    originPoint = point;
    const map = MapEngine.getMap();
    if (map) map.setView([point.lat, point.lng], 14, { animate: true });
  });

  // Attach rich autocomplete and link resolver to Final Destination (D)
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
    btnUseGps.addEventListener('click', async () => {
      const origText = btnUseGps.innerHTML;
      btnUseGps.innerHTML = '⏳ GPS...';
      const coords = await MapEngine.locateUser(true);
      btnUseGps.innerHTML = origText;
      if (coords) {
        originPoint = { lat: coords.lat, lng: coords.lng, name: 'Current Location (GPS)' };
        if (originInput) originInput.value = 'Current Location (GPS)';
      } else {
        alert('Could not fetch GPS. Please make sure Location permission is enabled in device settings.');
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
          if (userC && userC.lat) {
            originPoint = { ...userC, name: 'Current Location (GPS)' };
          } else {
            const m = MapEngine.getMap();
            const c = m ? m.getCenter() : { lat: 10.5276, lng: 76.2144 };
            originPoint = { lat: c.lat, lng: c.lng, name: 'Current Map Location' };
          }
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
      if (btnStartInAppNav) btnStartInAppNav.style.display = 'none';
    });
  }

  // In-App Turn-by-Turn Drive Mode Launcher Button
  if (btnStartInAppNav) {
    btnStartInAppNav.addEventListener('click', () => {
      if (window.DriveEngine) {
        window.DriveEngine.startDriveMode();
      }
    });
  }
}

/**
 * VoltWay In-App Turn-by-Turn DriveEngine (v5.19 Google Maps Style Human Voice Navigation):
 * Standalone automotive HUD, human-voice turn maneuvers ('Turn right', 'Turn left', 'In 100 meters'),
 * high-definition audio alert chimes, automatic voice selection (Google TTS / Natural human voices),
 * audio context pre-warming, and upcoming charger notifications.
 */
const DriveEngine = (function () {
  let active = false;
  let steps = [];
  let currentStepIdx = 0;
  let soundEnabled = true;
  let voiceEnabled = true;
  let announced500 = false;
  let announced100 = false;
  let announcedTurn = false;
  let announcedCharger = false;
  let lastStepIdx = -1;
  let lastChimeStepIdx = -1;
  let offRouteCount = 0;
  let isRecalculating = false;
  let lastUturnAnnouncedTime = 0;
  let lastRerouteAnnouncedTime = 0;
  let voices = [];
  let audioCtx = null;

  function getAudioContext() {
    try {
      if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioCtx = new AudioCtx();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function primeAudioEngine() {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.resume();
        const primer = new SpeechSynthesisUtterance(' ');
        primer.volume = 0.01;
        window.speechSynthesis.speak(primer);
      }
    } catch (e) {}
  }

  function loadVoices() {
    if ('speechSynthesis' in window) {
      voices = window.speechSynthesis.getVoices() || [];
    }
  }

  function initVoices() {
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoices();
      };
      setTimeout(loadVoices, 150);
      setTimeout(loadVoices, 600);
      setTimeout(loadVoices, 1500);
    }
  }
  initVoices();

  function selectBestHumanVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (!voices || voices.length === 0) {
      voices = window.speechSynthesis.getVoices() || [];
    }
    if (!voices || voices.length === 0) return null;

    const enVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    const pool = enVoices.length > 0 ? enVoices : voices;

    let best = null;
    let maxScore = -999;

    pool.forEach(v => {
      let score = 0;
      const name = (v.name || '').toLowerCase();
      const lang = (v.lang || '').toLowerCase();

      // Premium & Google TTS priority (Google Maps standard)
      if (name.includes('google')) score += 55;
      if (name.includes('natural') || name.includes('neural')) score += 50;
      if (name.includes('premium') || name.includes('online')) score += 35;

      // Female voices (Google Maps standard navigation persona)
      if (name.includes('female') || name.includes('samantha') || name.includes('zira') || name.includes('jenny') || name.includes('aria')) {
        score += 30;
      }

      // Dialect preferences: Indian English, UK English, US English
      if (lang === 'en-in' || lang.startsWith('en_in')) score += 25;
      else if (lang === 'en-gb' || lang.startsWith('en_gb')) score += 20;
      else if (lang === 'en-us' || lang.startsWith('en_us')) score += 18;

      // Penalize robotic synth engines
      if (name.includes('espeak') || name.includes('compact') || name.includes('generic')) score -= 45;
      if (v.localService === false) score += 10;

      if (score > maxScore) {
        maxScore = score;
        best = v;
      }
    });

    return best || pool[0];
  }

  function playChime(type = 'turn') {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'arrive') {
        // Cheerful 3-tone arrival chime (C5 -> E5 -> G5)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        osc.frequency.setValueAtTime(783.99, now + 0.24);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.55);
      } else {
        // Crisp Google Maps 2-tone alert chime (G5 784Hz -> C6 1046.5Hz)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(783.99, now);
        osc.frequency.setValueAtTime(1046.5, now + 0.08);
        gain.gain.setValueAtTime(0.24, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.start(now);
        osc.stop(now + 0.32);
      }
    } catch (e) {}
  }

  function speakVoice(text, priority = false) {
    if (!soundEnabled || !voiceEnabled || !('speechSynthesis' in window) || !text) return;
    try {
      if (priority || window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.94; // Google Maps natural human cadence
      utter.pitch = 1.02; // Articulate, warm, clear human tone
      utter.volume = 1.0;

      const voice = selectBestHumanVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang || 'en-IN';
      } else {
        utter.lang = 'en-IN';
      }

      utter.onerror = (e) => {
        console.warn('[VoltWay Voice] TTS playback warning:', e);
      };

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('[VoltWay Voice] TTS error:', e);
    }
  }

  function cleanRoadForSpeech(name) {
    if (!name) return '';
    let n = name.trim();
    if (/^(unnamed|service\s*road|ramp|link|path|track|road)$/i.test(n)) return '';
    n = n.replace(/\bNH\s*(\d+)/gi, 'National Highway $1');
    n = n.replace(/\bSH\s*(\d+)/gi, 'State Highway $1');
    n = n.replace(/\bRd\b/gi, 'Road');
    n = n.replace(/\bSt\b/gi, 'Street');
    n = n.replace(/\bAve\b/gi, 'Avenue');
    n = n.replace(/\bHwy\b/gi, 'Highway');
    n = n.replace(/\bJn\b|\bJct\b/gi, 'Junction');
    n = n.replace(/\bByp\b/gi, 'Bypass');
    if (n.includes('/')) n = n.split('/')[0].trim();
    return n;
  }

  function getManeuverSpeech(type, modifier, roadName) {
    const t = (type || 'continue').toLowerCase();
    const mod = (modifier || '').replace('_', ' ').toLowerCase();
    const road = cleanRoadForSpeech(roadName);

    let action = '';
    if (t === 'arrive' || t.includes('dest')) {
      return { isDest: true, action: 'arrive', road };
    }
    if (mod.includes('uturn')) action = 'make a U-turn';
    else if (mod.includes('slight left')) action = 'keep slight left';
    else if (mod.includes('slight right')) action = 'keep slight right';
    else if (mod.includes('sharp left')) action = 'take sharp left';
    else if (mod.includes('sharp right')) action = 'take sharp right';
    else if (mod.includes('left')) action = 'turn left';
    else if (mod.includes('right')) action = 'turn right';
    else if (t.includes('roundabout') || t.includes('rotary')) action = 'enter the roundabout';
    else if (t.includes('fork')) action = mod ? `take the fork on the ${mod}` : 'keep to the fork';
    else if (t.includes('ramp')) action = 'take the ramp';
    else action = 'continue straight';

    return { isDest: false, action, road };
  }

  function getTurnSymbol(type, modifier) {
    const mod = (modifier || '').toLowerCase();
    const t = (type || '').toLowerCase();
    if (mod.includes('left')) return '↰';
    if (mod.includes('right')) return '↱';
    if (mod.includes('uturn')) return '↶';
    if (t.includes('arrive') || t.includes('destination')) return '🏁';
    if (t.includes('roundabout') || t.includes('rotary')) return '🔄';
    return '⬆';
  }

  function formatManeuverText(step) {
    if (!step) return 'Continue straight on route';
    const mod = (step.modifier || '').replace('_', ' ');
    const t = (step.type || 'continue').replace('_', ' ');
    const road = step.name && !step.name.toLowerCase().includes('unnamed') ? step.name : '';

    if (t === 'arrive') return road ? `Arriving at ${road}` : 'Arriving at Destination';
    if (mod && road) return `Turn ${mod} onto ${road}`;
    if (mod) return `Turn ${mod}`;
    if (road) return `Continue onto ${road}`;
    return 'Continue straight on route';
  }

  function startDriveMode() {
    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) {
      alert('Please calculate a valid route before starting drive guidance.');
      return;
    }

    primeAudioEngine();

    active = true;
    lastStepIdx = -1;
    lastChimeStepIdx = -1;
    announced500 = false;
    announced100 = false;
    announcedTurn = false;
    announcedCharger = false;

    // Flatten steps across all route legs
    steps = [];
    (activeRoute.legs || []).forEach(leg => {
      (leg.steps || []).forEach(s => {
        steps.push({
          type: s.maneuver ? s.maneuver.type : 'continue',
          modifier: s.maneuver ? s.maneuver.modifier : '',
          name: s.name || '',
          distance: s.distance || 0,
          duration: s.duration || 0,
          lat: s.maneuver && s.maneuver.location ? s.maneuver.location[1] : null,
          lng: s.maneuver && s.maneuver.location ? s.maneuver.location[0] : null
        });
      });
    });

    if (steps.length === 0) {
      steps.push({
        type: 'continue',
        modifier: 'straight',
        name: activeRoute.roadName || 'Main Highway Route',
        distance: activeRoute.distanceKm * 1000,
        duration: activeRoute.durationMins * 60,
        lat: activeRoute.destination.lat,
        lng: activeRoute.destination.lng
      });
    }

    // If step 0 is depart and there is a next step, start pointing at the upcoming maneuver
    if (steps.length > 1 && steps[0].type === 'depart') {
      currentStepIdx = 1;
    } else {
      currentStepIdx = 0;
    }

    // Collapse bottom drawer
    if (typeof window.collapseBottomSheet === 'function') {
      window.collapseBottomSheet();
    }

    // Enable Google Maps True Fullscreen Navigation Mode
    document.body.classList.add('nav-active');

    // Show Google Maps HUD wrapper, bottom bar, speedometer, and road pill
    const hudWrapper = document.getElementById('nav-driving-hud-wrapper');
    const bottomBar = document.getElementById('nav-bottom-bar');
    const speedometer = document.getElementById('nav-speedometer');
    const roadPill = document.getElementById('nav-road-pill');
    if (hudWrapper) hudWrapper.style.display = 'flex';
    if (bottomBar) bottomBar.style.display = 'flex';
    if (speedometer) speedometer.style.display = 'flex';
    if (roadPill) roadPill.style.display = 'flex';

    // Start live auto-follow on map
    if (window.MapEngine) {
      window.MapEngine.setAutoFollow(true);
      window.MapEngine.locateUser(true);
      setTimeout(() => {
        const m = window.MapEngine.getMap();
        if (m) m.invalidateSize();
      }, 100);
    }

    // Reset navigation compass mode to Route-Locked (Default)
    if (window.MapEngine && window.MapEngine.setNavCompassMode) {
      window.MapEngine.setNavCompassMode(false);
    }
    const btnNavCompassInit = document.getElementById('btn-nav-compass');
    if (btnNavCompassInit) {
      btnNavCompassInit.classList.remove('compass-active');
      btnNavCompassInit.title = 'Route Locked Mode (Click to follow phone heading)';
    }

    // Play startup chime and speak welcome guidance with first maneuver
    playChime('turn');
    const destName = (activeRoute.destination && activeRoute.destination.name) || 'destination';
    const cleanDest = cleanRoadForSpeech(destName) || destName.split(',')[0].trim();

    const targetStep = steps[currentStepIdx] || steps[0];
    const speech = getManeuverSpeech(targetStep.type, targetStep.modifier, targetStep.name);
    const distMeters = Math.round(targetStep.distance || 250);
    const distStr = distMeters < 1000 ? `${Math.max(50, Math.round(distMeters / 10) * 10)} meters` : `${(distMeters / 1000).toFixed(1)} kilometers`;
    const actionPhrase = speech.road ? `${speech.action} onto ${speech.road}` : speech.action;

    speakVoice(`Starting navigation to ${cleanDest}. In ${distStr}, ${actionPhrase}. Drive safely!`, true);

    // Render initial guidance display
    updateHudDisplay(null);
  }

  function exitDriveMode() {
    active = false;
    document.body.classList.remove('nav-active');

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    const hudWrapper = document.getElementById('nav-driving-hud-wrapper');
    const bottomBar = document.getElementById('nav-bottom-bar');
    const speedometer = document.getElementById('nav-speedometer');
    const roadPill = document.getElementById('nav-road-pill');
    if (hudWrapper) hudWrapper.style.display = 'none';
    if (bottomBar) bottomBar.style.display = 'none';
    if (speedometer) speedometer.style.display = 'none';
    if (roadPill) roadPill.style.display = 'none';

    const btnRoutes = document.getElementById('btn-nav-routes-toggle');
    if (btnRoutes) {
      btnRoutes.classList.remove('active-overview');
      btnRoutes.title = 'Route Overview & Alternatives';
    }

    if (window.MapEngine && window.MapEngine.setNavCompassMode) {
      window.MapEngine.setNavCompassMode(false);
    }
    const btnNavCompassExit = document.getElementById('btn-nav-compass');
    if (btnNavCompassExit) {
      btnNavCompassExit.classList.remove('compass-active');
    }

    if (window.MapEngine) {
      window.MapEngine.setAutoFollow(false);
      const m = window.MapEngine.getMap();
      if (m) {
        if (typeof m.setBearing === 'function') {
          m.setBearing(0);
        }
        setTimeout(() => m.invalidateSize(), 100);
      }
      const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
      if (activeRoute && window.MapEngine.renderRoute) {
        window.MapEngine.renderRoute(activeRoute, window.RouteEngine.getAllRoutes(), 0, true);
      }
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    primeAudioEngine();
    const btn = document.getElementById('btn-hud-sound-toggle');
    if (btn) {
      btn.innerHTML = soundEnabled ? '🔊' : '🔇';
      btn.title = soundEnabled ? 'Voice & Audio guidance active' : 'Voice guidance muted';
    }
    if (soundEnabled) {
      playChime('turn');
      speakVoice('Voice guidance active', true);
    } else {
      speakVoice('Voice guidance muted', true);
      setTimeout(() => {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      }, 1000);
    }
    if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
      window.SyncEngine.showAutoUpdateToast(soundEnabled ? '🔊 Voice navigation active' : '🔇 Voice navigation muted');
    }
  }

  async function checkOffRouteAndRecalculate(userCoords, activeRoute) {
    if (isRecalculating || !userCoords || !activeRoute || !window.RouteEngine) return;

    const slice = (typeof window.RouteEngine.sliceActiveRouteAtPosition === 'function')
      ? window.RouteEngine.sliceActiveRouteAtPosition(userCoords.lat, userCoords.lng)
      : null;

    const distFromRouteKm = slice ? slice.distanceFromRouteKm :
      (window.RouteEngine.getDistanceToActiveRoute ? window.RouteEngine.getDistanceToActiveRoute(userCoords.lat, userCoords.lng) : null);

    if (distFromRouteKm == null) return;

    const now = Date.now();

    // 1. Heading check for U-Turn:
    // If rider is traveling in reverse / opposite direction on route segment (difference > 135°)
    if (slice && userCoords.heading != null && userCoords.speed != null && userCoords.speed > 1.2) {
      let hDiff = Math.abs((userCoords.heading - slice.segmentBearing + 180) % 360 - 180);
      if (hDiff > 135) {
        if (now - lastUturnAnnouncedTime > 15000) { // 15-second throttle
          lastUturnAnnouncedTime = now;
          playChime('turn');
          speakVoice('Make a U-turn when possible', true);
        }
      }
    }

    // 2. Off-Route Deviation Check (> 45 meters / 0.045 km)
    if (distFromRouteKm > 0.045) {
      offRouteCount++;
      if (offRouteCount >= 2) {
        offRouteCount = 0;
        isRecalculating = true;
        if (now - lastRerouteAnnouncedTime > 12000) {
          lastRerouteAnnouncedTime = now;
          speakVoice('Rerouting...', true);
          playChime('turn');
        }
        try {
          // Preserve remaining intermediate charging stops
          const currentWaypoints = window.RouteEngine.getWaypoints ? window.RouteEngine.getWaypoints() : (activeRoute.waypoints || []);
          const originPoint = { lat: userCoords.lat, lng: userCoords.lng, name: 'Current Position' };
          const newRoute = await window.RouteEngine.calculateRoute(originPoint, activeRoute.destination, currentWaypoints);
          steps = [];
          (newRoute.legs || []).forEach(leg => {
            (leg.steps || []).forEach(s => {
              steps.push({
                type: s.maneuver ? s.maneuver.type : 'continue',
                modifier: s.maneuver ? s.maneuver.modifier : '',
                name: s.name || '',
                distance: s.distance || 0,
                duration: s.duration || 0,
                lat: s.maneuver && s.maneuver.location ? s.maneuver.location[1] : null,
                lng: s.maneuver && s.maneuver.location ? s.maneuver.location[0] : null
              });
            });
          });
          currentStepIdx = steps.length > 1 && steps[0].type === 'depart' ? 1 : 0;
          lastStepIdx = -1;
          speakVoice('New route found', true);
        } catch (err) {
          console.warn('[VoltWay Nav] Auto recalculation note:', err);
        } finally {
          isRecalculating = false;
        }
      }
    } else {
      offRouteCount = 0;
    }
  }

  function updateHudDisplay(userCoords) {
    if (!active) return;
    const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    if (!activeRoute) return;

    if (userCoords) {
      checkOffRouteAndRecalculate(userCoords, activeRoute);
    }

    const curStep = steps[currentStepIdx] || steps[steps.length - 1];

    if (currentStepIdx !== lastStepIdx) {
      lastStepIdx = currentStepIdx;
      announced500 = false;
      announced100 = false;
      announcedTurn = false;
      announcedCharger = false;
    }

    const speech = getManeuverSpeech(curStep.type, curStep.modifier, curStep.name);
    let distText = 'In 200 m';

    if (userCoords && curStep && curStep.lat != null && curStep.lng != null && window.Utilities) {
      const dKm = window.Utilities.haversine(userCoords.lat, userCoords.lng, curStep.lat, curStep.lng);
      const dMeters = Math.round(dKm * 1000);

      // Voice announcements based on distance to maneuver (Google Maps style)
      if (dMeters <= 500 && dMeters > 130 && !announced500) {
        announced500 = true;
        if (speech.isDest) {
          speakVoice('In 500 meters, your destination is on the right');
        } else {
          speakVoice(speech.road ? `In 500 meters, ${speech.action} onto ${speech.road}` : `In 500 meters, ${speech.action}`);
        }
      } else if (dMeters <= 130 && dMeters > 35 && !announced100) {
        announced100 = true;
        playChime('turn');
        if (speech.isDest) {
          speakVoice('In 100 meters, destination is on the right', true);
        } else {
          speakVoice(speech.road ? `In 100 meters, ${speech.action} onto ${speech.road}` : `In 100 meters, ${speech.action}`, true);
        }
      } else if (dMeters <= 35 && !announcedTurn) {
        announcedTurn = true;
        playChime(speech.isDest ? 'arrive' : 'turn');
        if (speech.isDest) {
          speakVoice('You have arrived at your destination, on the right', true);
        } else {
          speakVoice(speech.road ? `${speech.action} onto ${speech.road}` : `${speech.action} now`, true);
        }
      }

      // Check upcoming charger alert
      const waypoints = activeRoute.waypoints || [];
      if (waypoints.length > 0 && !announcedCharger) {
        const firstWp = waypoints[0];
        if (firstWp && firstWp.lat != null && firstWp.lng != null) {
          const wpDistM = window.Utilities.haversine(userCoords.lat, userCoords.lng, firstWp.lat, firstWp.lng) * 1000;
          if (wpDistM <= 500 && wpDistM > 100) {
            announcedCharger = true;
            const net = (firstWp.network || 'EV Fast').toUpperCase();
            speakVoice(`Approaching ${net} fast charging stop in 500 meters`);
          }
        }
      }

      // Advance to next maneuver if within 30 meters or passing intersection
      if (currentStepIdx < steps.length - 1) {
        const nextStep = steps[currentStepIdx + 1];
        let shouldAdvance = dMeters <= 30;
        if (!shouldAdvance && nextStep && nextStep.lat != null && nextStep.lng != null) {
          const nextDistMeters = window.Utilities.haversine(userCoords.lat, userCoords.lng, nextStep.lat, nextStep.lng) * 1000;
          if (nextDistMeters < dMeters && dMeters < 65) {
            shouldAdvance = true;
          }
        }
        if (shouldAdvance) {
          currentStepIdx++;
          if (currentStepIdx !== lastChimeStepIdx) {
            lastChimeStepIdx = currentStepIdx;
            playChime('turn');
          }
        }
      }

      if (dMeters < 1000) {
        distText = `In ${Math.max(20, Math.round(dMeters / 10) * 10)} m`;
      } else {
        distText = `In ${(dMeters / 1000).toFixed(1)} km`;
      }
    } else if (curStep) {
      distText = curStep.distance < 1000 ? `In ${Math.round(curStep.distance)} m` : `In ${(curStep.distance / 1000).toFixed(1)} km`;
    }

    // Update Turn Icon & Street (Google Maps Material 3 Design)
    const turnIconEl = document.getElementById('hud-turn-icon');
    const distEl = document.getElementById('hud-distance-val');
    const streetEl = document.getElementById('hud-street-name');
    if (turnIconEl) turnIconEl.textContent = getTurnSymbol(curStep.type, curStep.modifier);
    if (distEl) distEl.textContent = distText;
    if (streetEl) streetEl.textContent = formatManeuverText(curStep);

    // Google Maps Subsequent Step Guidance ("Then ↱")
    const subCard = document.getElementById('hud-subsequent-step');
    const subIcon = document.getElementById('hud-sub-turn-icon');
    if (steps && currentStepIdx < steps.length - 1) {
      const nextStep = steps[currentStepIdx + 1];
      if (nextStep && subCard && subIcon) {
        subIcon.textContent = getTurnSymbol(nextStep.type, nextStep.modifier);
        subCard.style.display = 'inline-flex';
      }
    } else if (subCard) {
      subCard.style.display = 'none';
    }

    // Road Name Callout Pill on Map (pinned to road ahead of rider)
    const roadPillText = document.getElementById('nav-road-pill-text');
    if (roadPillText) {
      const curRoad = curStep.name && !curStep.name.toLowerCase().includes('unnamed')
        ? curStep.name
        : (activeRoute.roadName || 'Main Road');
      roadPillText.textContent = curRoad;
    }

    // Upcoming Charger Station Badge
    const nextChargerBadge = document.getElementById('hud-next-charger-badge');
    const nextChargerName = document.getElementById('hud-next-charger-name');
    const nextChargerDist = document.getElementById('hud-next-charger-dist');
    const waypoints = activeRoute.waypoints || [];
    if (waypoints.length > 0 && nextChargerBadge && nextChargerName && nextChargerDist) {
      const firstWp = waypoints[0];
      const cleanWpName = (firstWp.name || 'Charging Station').replace(/\s*\(Ather Gun[^)]*\)/gi, '').substring(0, 22);
      let wpDistStr = '~';
      if (userCoords && window.Utilities) {
        const wpKm = Math.round(window.Utilities.haversine(userCoords.lat, userCoords.lng, firstWp.lat, firstWp.lng) * 10) / 10;
        wpDistStr = `${wpKm} km`;
      } else if (firstWp.distanceKm) {
        wpDistStr = `${firstWp.distanceKm} km`;
      }
      nextChargerName.textContent = cleanWpName;
      nextChargerDist.textContent = wpDistStr;
      nextChargerBadge.style.display = 'inline-block';
    } else if (nextChargerBadge) {
      nextChargerBadge.style.display = 'none';
    }

    // Google Maps Bottom Stats Bar (ETA Duration, Distance, Clock Arrival Time)
    const etaEl = document.getElementById('nav-stat-eta');
    const distStatEl = document.getElementById('nav-stat-dist');
    const timeStatEl = document.getElementById('nav-stat-time');

    const totalDurationMins = Math.max(1, Math.round(activeRoute.durationMins || 0));
    let timeFormatted = '';
    if (totalDurationMins >= 60) {
      const hrs = Math.floor(totalDurationMins / 60);
      const mins = totalDurationMins % 60;
      timeFormatted = mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
    } else {
      timeFormatted = `${totalDurationMins} min`;
    }

    const now = new Date();
    const etaDate = new Date(now.getTime() + totalDurationMins * 60000);
    const etaStr = etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();

    if (timeStatEl) {
      timeStatEl.textContent = timeFormatted;
      // Google Maps traffic accent coloring: amber for moderate, emerald green for light
      timeStatEl.style.color = totalDurationMins > 45 ? '#ea580c' : '#00e676';
    }
    if (distStatEl) distStatEl.textContent = `${activeRoute.distanceKm} km`;
    if (etaEl) etaEl.textContent = etaStr;
  }

  function onLocationUpdate(userCoords) {
    if (!active) return;
    if (window.MapEngine && typeof window.MapEngine.updateProgressAlongRoute === 'function') {
      window.MapEngine.updateProgressAlongRoute(userCoords);
    }

    // Update Live Speedometer
    if (userCoords && userCoords.speed != null) {
      const speedKmH = Math.max(0, Math.round(userCoords.speed * 3.6));
      const speedValEl = document.getElementById('nav-speed-val');
      if (speedValEl) speedValEl.textContent = speedKmH;
    }

    updateHudDisplay(userCoords);
  }

  return {
    startDriveMode,
    exitDriveMode,
    toggleSound,
    onLocationUpdate,
    isActive: () => active
  };
})();

window.DriveEngine = DriveEngine;

/**
 * Universal Autocomplete Handler for Location Inputs
 * Works seamlessly across:
 * - Starting Origin (A)
 * - Final Destination (D)
 * - All Intermediate Stops (B, C, ...)
 * Supports typing any town/village (via Photon 150ms geocoder)
 * and raw GPS coordinates (e.g. 10.52, 76.21).
 */
function attachLocationAutocomplete(inputEl, dropdownEl, onSelect) {
  if (!inputEl || !dropdownEl) return;
  let timer = null;

  // Resolve raw coordinates directly if entered (e.g. "10.52, 76.21")
  const handleCoordsInput = (rawText) => {
    if (!rawText) return false;
    const match = rawText.trim().match(/^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        const point = { lat, lng, name: `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
        inputEl.value = point.name;
        dropdownEl.style.display = 'none';
        dropdownEl.innerHTML = '';
        onSelect(point);
        return true;
      }
    }
    return false;
  };

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

  const executeSearch = async (query) => {
    if (query.length < 1) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }

    // If query has raw coordinate structure (e.g. 10.52, 76.21), resolve immediately
    if (/^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/.test(query.trim())) {
      const handled = handleCoordsInput(query.trim());
      if (handled) return;
    }

    const qLower = query.toLowerCase();

    // 1. Instant local places & chargers matching (0ms)
    const localPlaces = window.Utilities && window.Utilities.getLocalPlaces ? window.Utilities.getLocalPlaces(query) : [];
    const allChargers = window.SyncEngine ? window.SyncEngine.getChargers() : [];
    const matchedChargers = allChargers.filter(c =>
      (c.name && c.name.toLowerCase().includes(qLower)) || (c.address && c.address.toLowerCase().includes(qLower))
    ).slice(0, 5);

    renderDropdown(query, localPlaces, matchedChargers);

    // 2. Query Photon Komoot Geocoder in background (handles all Kerala towns and Indian cities within 150ms)
    if (query.length >= 2) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const fullPlaces = (window.Utilities && window.Utilities.searchPlace) ? await window.Utilities.searchPlace(query) : [];
        renderDropdown(query, fullPlaces, matchedChargers);
      }, 150);
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
  const btnStartInAppNav = document.getElementById('btn-start-inapp-nav');
  const btnFloatingStartNav = document.getElementById('btn-floating-start-nav');
  const navSecondaryActions = document.getElementById('nav-secondary-actions');
  const corridorControl = document.getElementById('corridor-buffer-control');
  const mapCorridorPill = document.getElementById('map-route-corridor-pill');
  const corridorBufferBadge = document.getElementById('corridor-buffer-badge');

  if (!route) {
    if (summaryCard) summaryCard.style.display = 'none';
    if (routeSelectorContainer) routeSelectorContainer.style.display = 'none';
    if (waypointsSection) waypointsSection.style.display = 'none';
    if (btnStartInAppNav) btnStartInAppNav.style.display = 'none';
    if (btnFloatingStartNav) btnFloatingStartNav.style.display = 'none';
    if (navSecondaryActions) navSecondaryActions.style.display = 'none';
    if (corridorControl) corridorControl.style.display = 'none';
    if (mapCorridorPill) mapCorridorPill.style.display = 'none';
    const timelineSection = document.getElementById('trip-battery-timeline-section');
    if (timelineSection) timelineSection.style.display = 'none';
    const corridorContainer = document.getElementById('corridor-chargers-list');
    if (corridorContainer) corridorContainer.innerHTML = '';
    const corridorCount = document.getElementById('corridor-count');
    if (corridorCount) corridorCount.textContent = '0';
    if (window.MapEngine && window.MapEngine.renderRoute) {
      window.MapEngine.renderRoute(null);
    }
    if (window.MapEngine && window.MapEngine.renderChargers) {
      window.MapEngine.renderChargers();
    }
    return;
  }

  // Update corridor buffer badges and dropdowns
  const curBuffer = (routeState && routeState.corridorBufferKm) || (window.RouteEngine ? window.RouteEngine.getCorridorBufferKm() : 5);
  const bufferValStr = String(curBuffer);
  const bufferText = curBuffer === 'all' ? 'All in View' : `Within ${curBuffer} km`;
  if (corridorControl) corridorControl.style.display = 'block';
  if (mapCorridorPill) mapCorridorPill.style.display = 'inline-flex';
  if (corridorBufferBadge) corridorBufferBadge.textContent = bufferText;
  const mapInput = document.getElementById('input-map-corridor') || document.getElementById('select-map-corridor');
  const drawerInput = document.getElementById('input-drawer-corridor') || document.getElementById('select-drawer-corridor');
  if (mapInput) mapInput.value = bufferValStr;
  if (drawerInput) drawerInput.value = bufferValStr;

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

  // 4. Update Summary Card & Drive Mode Action
  if (summaryCard) summaryCard.style.display = 'block';
  if (btnStartInAppNav) btnStartInAppNav.style.display = 'flex';
  if (btnFloatingStartNav) btnFloatingStartNav.style.display = 'flex';
  if (navSecondaryActions) navSecondaryActions.style.display = 'flex';

  updateRouteMetrics(route);
  renderTripBatteryTimeline(route);
  renderCorridorChargersList(corridorChargers, waypoints);
  if (window.MapEngine && window.MapEngine.renderChargers) {
    window.MapEngine.renderChargers();
  }
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
              <span class="step-title" style="cursor: pointer; display: flex; align-items: center; gap: 4px;" onclick="MapEngine.focusCharger({id: '${step.station?.id}', lat: ${step.station?.lat}, lng: ${step.station?.lng}}); if (window.innerWidth <= 768) window.collapseBottomSheet();" title="Click to view highlighted stop on map">🎯 ${stationNameClean}</span>
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

            <!-- Nearby Rider Amenities at this Charging Stop (< 200m) -->
            ${window.Utilities && window.Utilities.renderAmenitiesHtml ? window.Utilities.renderAmenitiesHtml(step.station?.lat, step.station?.lng, step.station?.name, step.station?.address) : ''}
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
window.getPlannerOrigin = function () {
  return originPoint;
};

window.getPlannerDest = function () {
  return destinationPoint;
};

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
          <span class="corridor-detour-pill ${c.corridorDistanceKm <= 0.4 ? 'direct-pill' : 'detour-pill'}">
            🛣️ ${c.corridorDistanceKm <= 0.4 ? 'Direct on Route' : `${c.corridorDistanceKm} km detour`}
          </span>
        </div>
        <div class="corridor-card-title">${cleanName}</div>
        <div class="corridor-route-meta" style="font-size: 0.74rem; color: #94a3b8; margin: 2px 0 4px 0;">
          📍 ~${c.kmFromOrigin} km along route from origin
        </div>
        <div class="corridor-card-desc">${c.connector || (c.type === 'FAST' ? '⚡ High-Speed DC Fast Charger' : '🔌 Standard 15A AC Socket')}</div>
        ${window.Utilities && window.Utilities.renderAmenitiesHtml ? window.Utilities.renderAmenitiesHtml(c.lat, c.lng, c.name, c.address) : ''}
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

  async function runSos() {
    // Switch to SOS tab
    const sosTabBtn = document.querySelector('[data-tab="sos"]');
    if (sosTabBtn) sosTabBtn.click();

    const userCoords = await MapEngine.locateUser(true) || MapEngine.getUserCoords();

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
        <button class="btn-sos-nav" onclick="MapEngine.handleRouteDirectToCharger('${closest.id}')">
          ⚡ 1-TAP IN-APP ROUTE
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
          <button class="btn-sm btn-nav" onclick="MapEngine.handleRouteDirectToCharger('${fast.id}')">
            ⚡ Route to Station
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
          <button class="btn-sm btn-nav" onclick="MapEngine.handleRouteDirectToCharger('${slow.id}')">
            ⚡ Route to Station
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

  let searchDebounceTimer = null;

  const handleSearchQuery = async (query) => {
    if (!query) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      return;
    }

    // If query has raw coordinate structure (e.g. 10.52, 76.21), fly directly to it
    const coordMatch = query.match(/^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        searchInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        resultsContainer.style.display = 'none';
        const map = MapEngine.getMap();
        if (map) map.flyTo([lat, lng], 15, { animate: true });
        return;
      }
    }

    if (query.length < 2) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      return;
    }

    // 1. Search in local chargers by name/address first
    const allChargers = SyncEngine.getChargers();
    const lowerQuery = query.toLowerCase();
    const localMatches = allChargers.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) || (c.address && c.address.toLowerCase().includes(lowerQuery))
    ).slice(0, 4);

    // 2. Search online via Photon (South India proximity bias) + Nominatim fallback
    const osmMatches = await Utilities.searchPlace(query);

    renderSearchResults(localMatches, osmMatches);
  };

  searchInput.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (pasted && pasted.trim()) {
      setTimeout(() => handleSearchQuery(pasted.trim()), 20);
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      handleSearchQuery(searchInput.value.trim());
    }, 180);
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

// --- Universal Google Maps Multi-Stop Directions Importer ---
window.importDirectionsRoute = async function(directions) {
  if (!directions) return;
  const originInput = document.getElementById('input-origin');
  const destInput = document.getElementById('input-destination');
  if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
    window.SyncEngine.showAutoUpdateToast('🗺️ Importing multi-stop route from Google Maps...');
  }

  // 1. Resolve Origin
  if (directions.origin) {
    const origRes = await Utilities.resolveLocationInput(directions.origin);
    if (origRes) {
      originPoint = origRes;
      if (originInput) originInput.value = origRes.name;
    }
  }

  // 2. Resolve Destination
  if (directions.destination) {
    const destRes = await Utilities.resolveLocationInput(directions.destination);
    if (destRes) {
      destinationPoint = destRes;
      if (destInput) destInput.value = destRes.name;
    }
  }

  // 3. Resolve Intermediate Stops
  intermediateCustomStops = [];
  if (directions.waypoints && directions.waypoints.length > 0) {
    for (let i = 0; i < directions.waypoints.length; i++) {
      const wp = directions.waypoints[i];
      const wpRes = await Utilities.resolveLocationInput(wp);
      if (wpRes) {
        intermediateCustomStops.push({
          id: 'stop_import_' + i + '_' + Date.now(),
          name: wpRes.name || `Stop ${String.fromCharCode(66 + i)}`,
          lat: wpRes.lat,
          lng: wpRes.lng,
          isCustomStop: true
        });
      }
    }
    renderIntermediateStops();
  }

  // Switch to Route tab silently & auto-plan
  activateTabSilently('route');
  const btnPlan = document.getElementById('btn-plan-route');
  if (btnPlan) {
    setTimeout(() => btnPlan.click(), 400);
  }
};

function setupGoogleMapsImporter() {}

// Android Web Share Target auto-detection
async function checkSharedRouteParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedText = urlParams.get('text') || urlParams.get('url') || urlParams.get('title');
  if (sharedText) {
    console.log('[VoltWay] Detected shared route params from Android Share Target:', sharedText);
    const directions = Utilities.parseGoogleMapsDirectionsUrl(sharedText);
    if (directions && window.importDirectionsRoute) {
      await window.importDirectionsRoute(directions);
    } else {
      const resolved = await Utilities.resolveLocationInput(sharedText);
      if (resolved) {
        const destInput = document.getElementById('input-destination');
        if (destInput) destInput.value = resolved.name;
        destinationPoint = resolved;
        const btnPlan = document.getElementById('btn-plan-route');
        if (btnPlan) btnPlan.click();
      }
    }
  }
}

// --- Route Corridor Buffer Distance Filter (User-typeable manual number input in km) ---
function setupCorridorDistanceSelector() {
  const mapInput = document.getElementById('input-map-corridor') || document.getElementById('select-map-corridor');
  const drawerInput = document.getElementById('input-drawer-corridor') || document.getElementById('select-drawer-corridor');
  const badgeEl = document.getElementById('corridor-buffer-badge');

  let debounceTimer = null;

  function applyBuffer(val, sourceEl) {
    if (val === '' || val === null) return;
    let bufferVal = val === 'all' ? 'all' : parseFloat(val);
    if (typeof bufferVal === 'number') {
      if (isNaN(bufferVal) || bufferVal <= 0) bufferVal = 5;
      if (bufferVal > 100) bufferVal = 100;
    }

    if (window.RouteEngine) {
      window.RouteEngine.setCorridorBufferKm(bufferVal);
    }
    const valStr = String(bufferVal);
    if (mapInput && mapInput !== sourceEl) mapInput.value = valStr;
    if (drawerInput && drawerInput !== sourceEl) drawerInput.value = valStr;
    const label = bufferVal === 'all' ? 'All in View' : `Within ${bufferVal} km`;
    if (badgeEl) badgeEl.textContent = label;
  }

  function handleInputDebounced(val, sourceEl) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applyBuffer(val, sourceEl), 250);
  }

  if (mapInput) {
    mapInput.addEventListener('input', (e) => handleInputDebounced(e.target.value, mapInput));
    mapInput.addEventListener('change', (e) => applyBuffer(e.target.value, mapInput));
  }
  if (drawerInput) {
    drawerInput.addEventListener('input', (e) => handleInputDebounced(e.target.value, drawerInput));
    drawerInput.addEventListener('change', (e) => applyBuffer(e.target.value, drawerInput));
  }
}

function setupDriveModeControls() {
  const btnExit = document.getElementById('btn-exit-drive-mode');
  if (btnExit) {
    btnExit.addEventListener('click', () => {
      if (window.DriveEngine) window.DriveEngine.exitDriveMode();
    });
  }

  const btnSound = document.getElementById('btn-hud-sound-toggle');
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      if (window.DriveEngine) window.DriveEngine.toggleSound();
    });
  }

  const btnRoutesToggle = document.getElementById('btn-nav-routes-toggle');
  if (btnRoutesToggle) {
    let isOverviewMode = false;
    btnRoutesToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!window.MapEngine) return;
      const m = window.MapEngine.getMap();
      const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
      if (!m || !activeRoute) return;

      isOverviewMode = !isOverviewMode;
      if (isOverviewMode) {
        // Toggle Route Overview: Show full route & fit bounds
        window.MapEngine.setAutoFollow(false);
        if (typeof m.setBearing === 'function') {
          m.setBearing(0);
        }
        if (activeRoute.coordinates && activeRoute.coordinates.length > 0) {
          m.fitBounds(L.latLngBounds(activeRoute.coordinates), {
            padding: [70, 50],
            animate: true
          });
        }
        btnRoutesToggle.classList.add('active-overview');
        btnRoutesToggle.title = 'Re-center on Vehicle';
        if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
          window.SyncEngine.showAutoUpdateToast('🗺️ Route Overview Mode');
        }
      } else {
        // Toggle Re-center: Resume turn-by-turn follow
        window.MapEngine.recenterCamera();
        btnRoutesToggle.classList.remove('active-overview');
        btnRoutesToggle.title = 'Route Overview & Alternatives';
        if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
          window.SyncEngine.showAutoUpdateToast('📍 Resuming Navigation Follow');
        }
      }
    });
  }

  // Floating Theme Switcher Button (Dark / Daylight Tile Toggle)
  const btnThemeToggle = document.getElementById('btn-toggle-map-theme');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (window.MapEngine && window.MapEngine.toggleTileTheme) {
        window.MapEngine.toggleTileTheme();
      }
    });
  }

  // Floating Navigation Compass Button (Google Maps Style: Free Orientation vs Route-Locked Mode)
  const btnNavCompass = document.getElementById('btn-nav-compass');
  if (btnNavCompass) {
    btnNavCompass.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!window.MapEngine) return;
      const currentMode = window.MapEngine.getNavCompassMode ? window.MapEngine.getNavCompassMode() : false;
      const nextMode = !currentMode;
      if (window.MapEngine.setNavCompassMode) {
        window.MapEngine.setNavCompassMode(nextMode);
      }
      if (nextMode) {
        btnNavCompass.classList.add('compass-active');
        btnNavCompass.title = 'Compass Active (Following Phone Direction)';
        if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
          window.SyncEngine.showAutoUpdateToast('🧭 ഫ്രീ കോമ്പസ് മോഡ്: ഫോൺ തിരിയുന്നതിനനുസരിച്ച് ആരോ തിരിയും');
        }
      } else {
        btnNavCompass.classList.remove('compass-active');
        btnNavCompass.title = 'Route Locked (Arrow Fixed to Route)';
        if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
          window.SyncEngine.showAutoUpdateToast('🛣️ റൂട്ട് ലോക്ക്ഡ് മോഡ്: ആരോ റൂട്ടിലേക്ക് സ്ഥിരമായി നിൽക്കും');
        }
      }
    });
  }

  const btnFloatingStart = document.getElementById('btn-floating-start-nav');
  if (btnFloatingStart) {
    btnFloatingStart.addEventListener('click', () => {
      if (window.DriveEngine) window.DriveEngine.startDriveMode();
    });
  }

  // Google Maps Direction Actions
  const btnOpenGmaps = document.getElementById('btn-open-google-maps');
  if (btnOpenGmaps) {
    btnOpenGmaps.addEventListener('click', () => {
      const activeRoute = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
      if (!activeRoute) {
        if (window.SyncEngine && window.SyncEngine.showAutoUpdateToast) {
          window.SyncEngine.showAutoUpdateToast('⚠️ Please plan a route first!');
        } else {
          alert('Please plan a route first.');
        }
        return;
      }
      const origin = (window.RouteEngine && typeof window.RouteEngine.getOrigin === 'function' && window.RouteEngine.getOrigin())
        || originPoint
        || (activeRoute && activeRoute.origin);
      const destination = (window.RouteEngine && typeof window.RouteEngine.getDestination === 'function' && window.RouteEngine.getDestination())
        || destinationPoint
        || (activeRoute && activeRoute.destination);
      const chargingWaypoints = (window.RouteEngine && typeof window.RouteEngine.getWaypoints === 'function')
        ? window.RouteEngine.getWaypoints()
        : (activeRoute.waypoints || []);
      const allStops = [...intermediateCustomStops, ...chargingWaypoints];

      if (window.NavigationEngine) {
        window.NavigationEngine.startFullTrip(origin, destination, allStops);
      }
    });
  }

  const btnFullscreen = document.getElementById('btn-toggle-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const isFull = document.body.classList.toggle('manual-fullscreen');
      btnFullscreen.innerHTML = isFull ? '✕' : '⛶';
      btnFullscreen.title = isFull ? 'Exit Fullscreen' : 'Toggle Fullscreen Map';
      setTimeout(() => {
        const map = window.MapEngine ? window.MapEngine.getMap() : null;
        if (map) map.invalidateSize();
      }, 150);
    });
  }
}

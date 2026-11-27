/**
 * VoltWay 2W v5.50 - Main Application Controller
 * Ties together BatteryEngine, SyncEngine, RouteEngine, MapEngine, Utilities & DriveEngine.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const esc = (s) => (window.Utilities && window.Utilities.escapeHtml)
    ? window.Utilities.escapeHtml(s)
    : String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

  // ---------- 1. Service Worker & Safe Asset Refresh ----------
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=5.50')
        .then(reg => {
          reg.onupdatefound = () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.onstatechange = () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller && window.SyncEngine) {
                window.SyncEngine.showAutoUpdateToast('✨ App updated to v5.50. Tap v5.50 pill anytime to reload.');
              }
            };
          };
        })
        .catch(() => {});
    });
  }

  const btnForceRefresh = document.getElementById('btn-force-refresh');
  if (btnForceRefresh) {
    btnForceRefresh.addEventListener('click', async () => {
      try {
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🔄 Refreshing app cache (keeping your EV settings)...');
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (e) {}
      setTimeout(() => window.location.reload(), 400);
    });
  }

  // ---------- 2. Offline / Online Awareness ----------
  const offlineBanner = document.getElementById('offline-status-banner');
  const modalNetworkStatus = document.getElementById('modal-network-status');

  function updateConnectivityUi() {
    const online = navigator.onLine;
    if (offlineBanner) {
      offlineBanner.style.display = online ? 'none' : 'flex';
    }
    if (modalNetworkStatus) {
      modalNetworkStatus.textContent = online ? 'Online • Ready' : 'Offline Ready';
      modalNetworkStatus.style.color = online ? '#00e676' : '#fbbf24';
    }
  }
  window.addEventListener('online', updateConnectivityUi);
  window.addEventListener('offline', updateConnectivityUi);
  updateConnectivityUi();

  // ---------- 3. Map Engine Initialization & Initial Charger Load ----------
  if (window.MapEngine) {
    window.MapEngine.initMap('map');
  }

  function updateStationCountsUI(statsObj = null) {
    if (!window.SyncEngine) return;
    const activeState = window.MapEngine ? window.MapEngine.getStateFilter() : 'all';
    const regionStats = (statsObj && statsObj.stateFilter === activeState)
      ? statsObj
      : window.SyncEngine.getStats(activeState);
    const globalStats = (statsObj && (statsObj.stateFilter === 'all' || !statsObj.stateFilter))
      ? statsObj
      : window.SyncEngine.getStats('all');

    const fastTotal = (regionStats.atherFast || 0) + (regionStats.vidaFast || 0) + (regionStats.boltFast || 0);
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = Number(val || 0).toLocaleString();
    };

    setTxt('header-station-count', regionStats.total);
    setTxt('count-fast-only', fastTotal);
    setTxt('count-ather-fast', regionStats.atherFast);
    setTxt('count-vida-fast', regionStats.vidaFast);
    setTxt('count-bolt-fast', regionStats.boltFast);
    setTxt('count-bolt-slow', regionStats.boltSlow);

    setTxt('sync-total-chargers', globalStats.total);
    setTxt('modal-ather-count', globalStats.atherFast);
    setTxt('modal-vida-count', globalStats.vidaFast);
    setTxt('modal-bolt-fast-count', globalStats.boltFast);
    setTxt('modal-bolt-slow-count', globalStats.boltSlow);

    const lastTsEl = document.getElementById('sync-last-timestamp');
    if (lastTsEl && globalStats.lastSync) {
      try {
        const d = new Date(globalStats.lastSync);
        lastTsEl.textContent = isNaN(d.getTime()) ? globalStats.lastSync : d.toLocaleString();
      } catch (e) {
        lastTsEl.textContent = String(globalStats.lastSync);
      }
    }
  }

  if (window.SyncEngine) {
    window.SyncEngine.subscribe(({ stats }) => {
      updateStationCountsUI(stats);
    });
    window.SyncEngine.loadInitialChargers().then(() => {
      updateStationCountsUI();
      if (window.RouteEngine && typeof window.RouteEngine.refreshCorridorForActiveRoute === 'function') {
        window.RouteEngine.refreshCorridorForActiveRoute();
      }
      if (window.MapEngine) window.MapEngine.renderChargers();
    });
  }

  // ---------- 4. Drawer, Tabs & Map Filter Controls ----------
  const bottomSheet = document.getElementById('bottom-sheet');
  const sheetHandleBar = document.getElementById('sheet-handle-bar');
  const btnToggleDrawer = document.getElementById('btn-toggle-drawer');

  function setDrawerCollapsed(collapsed) {
    if (!bottomSheet) return;
    bottomSheet.classList.toggle('collapsed', collapsed);
    if (btnToggleDrawer) {
      btnToggleDrawer.textContent = collapsed ? '▲ Expand' : '▼ Minimize';
    }
    setTimeout(() => {
      if (window.MapEngine && window.MapEngine.getMap()) {
        window.MapEngine.getMap().invalidateSize();
      }
    }, 280);
  }
  window.collapseBottomSheet = () => setDrawerCollapsed(true);

  if (btnToggleDrawer) {
    btnToggleDrawer.addEventListener('click', (e) => {
      e.stopPropagation();
      setDrawerCollapsed(!bottomSheet.classList.contains('collapsed'));
    });
  }

  if (sheetHandleBar) {
    let touchStartY = null;
    sheetHandleBar.addEventListener('click', () => {
      setDrawerCollapsed(!bottomSheet.classList.contains('collapsed'));
    });
    sheetHandleBar.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) touchStartY = e.touches[0].clientY;
    }, { passive: true });
    sheetHandleBar.addEventListener('touchend', (e) => {
      if (touchStartY == null || !e.changedTouches || !e.changedTouches.length) return;
      const dy = e.changedTouches[0].clientY - touchStartY;
      touchStartY = null;
      if (Math.abs(dy) > 32) {
        setDrawerCollapsed(dy > 0);
      }
    }, { passive: true });
  }

  const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));

  function activateTab(tabName, expandSheet = true) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === `pane-${tabName}`));
    if (expandSheet && bottomSheet && bottomSheet.classList.contains('collapsed')) {
      setDrawerCollapsed(false);
    }
  }

  window.activateTabSilently = (tabName) => activateTab(tabName, true);

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab, true);
    });
  });

  // Top Map Filter Chips
  const chipFastOnly = document.getElementById('chip-fast-only');
  const chipAtherFast = document.getElementById('chip-ather-fast');
  const chipVidaFast = document.getElementById('chip-vida-fast');
  const chipBoltFast = document.getElementById('chip-bolt-fast');
  const chipBoltSlow = document.getElementById('chip-bolt-slow');

  function syncTopFilterChips() {
    if (!window.MapEngine) return;
    const f = window.MapEngine.getFilters();
    const isAllFastOnly = f.atherFast && f.vidaFast && f.boltFast && !f.boltSlow;
    if (chipFastOnly) chipFastOnly.classList.toggle('active', isAllFastOnly);
    if (chipAtherFast) chipAtherFast.classList.toggle('active', f.atherFast);
    if (chipVidaFast) chipVidaFast.classList.toggle('active', f.vidaFast);
    if (chipBoltFast) chipBoltFast.classList.toggle('active', f.boltFast);
    if (chipBoltSlow) chipBoltSlow.classList.toggle('active', f.boltSlow);
  }

  if (chipFastOnly) {
    chipFastOnly.addEventListener('click', () => {
      if (!window.MapEngine) return;
      const cur = window.MapEngine.getFilters();
      const alreadyFastOnly = cur.atherFast && cur.vidaFast && cur.boltFast && !cur.boltSlow;
      if (alreadyFastOnly) {
        window.MapEngine.setFilter('boltSlow', true);
      } else {
        window.MapEngine.setFilter('atherFast', true);
        window.MapEngine.setFilter('vidaFast', true);
        window.MapEngine.setFilter('boltFast', true);
        window.MapEngine.setFilter('boltSlow', false);
      }
      syncTopFilterChips();
    });
  }

  [
    [chipAtherFast, 'atherFast'],
    [chipVidaFast, 'vidaFast'],
    [chipBoltFast, 'boltFast'],
    [chipBoltSlow, 'boltSlow']
  ].forEach(([el, key]) => {
    if (!el) return;
    el.addEventListener('click', () => {
      if (!window.MapEngine) return;
      const f = window.MapEngine.getFilters();
      window.MapEngine.setFilter(key, !f[key]);
      syncTopFilterChips();
    });
  });

  syncTopFilterChips();

  // State Chips
  const stateChips = Array.from(document.querySelectorAll('.state-chip'));
  const savedState = window.MapEngine ? window.MapEngine.getStateFilter() : 'all';
  stateChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.state === savedState);
    chip.addEventListener('click', () => {
      const st = chip.dataset.state || 'all';
      stateChips.forEach(c => c.classList.toggle('active', c.dataset.state === st));
      if (window.MapEngine) window.MapEngine.setStateFilter(st);
      updateStationCountsUI();
    });
  });

  // Floating GPS, Theme & Fullscreen Buttons
  const btnFloatGps = document.getElementById('btn-float-gps');
  if (btnFloatGps) {
    btnFloatGps.addEventListener('click', () => {
      if (window.MapEngine) window.MapEngine.recenterCamera();
    });
  }

  const btnToggleTheme = document.getElementById('btn-toggle-map-theme');
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      if (window.MapEngine) window.MapEngine.toggleTileTheme();
    });
  }

  const btnFullscreen = document.getElementById('btn-toggle-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const activeFs = document.body.classList.toggle('manual-fullscreen');
      btnFullscreen.textContent = activeFs ? '🗗' : '⛶';
      try {
        if (activeFs && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else if (!activeFs && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (e) {}
      setTimeout(() => {
        if (window.MapEngine && window.MapEngine.getMap()) {
          window.MapEngine.getMap().invalidateSize();
        }
      }, 150);
    });
  }

  // ---------- 5. Battery Dashboard & Charge Time Estimator ----------
  const vehicleSelect = document.getElementById('vehicle-preset-select');
  const vehicleConnInfo = document.getElementById('vehicle-connector-info');
  const batteryNumber = document.getElementById('battery-number');
  const batterySlider = document.getElementById('battery-slider');
  const efficiencyInput = document.getElementById('efficiency-input');
  const reserveSlider = document.getElementById('reserve-slider');
  const reserveVal = document.getElementById('reserve-val');
  const targetChargeSlider = document.getElementById('target-charge-slider');
  const targetChargeVal = document.getElementById('target-charge-val');
  const metricSafeRange = document.getElementById('metric-safe-range');
  const metricRealRange = document.getElementById('metric-real-range');
  const metricMaxRange = document.getElementById('metric-max-range');

  const calcStartSlider = document.getElementById('calc-start-slider');
  const calcStartVal = document.getElementById('calc-start-val');
  const calcTargetSlider = document.getElementById('calc-target-slider');
  const calcTargetVal = document.getElementById('calc-target-val');
  const calcFastTime = document.getElementById('calc-fast-time');
  const calcSlowTime = document.getElementById('calc-slow-time');
  const calcRangeGain = document.getElementById('calc-range-gain');
  const calcVehicleNote = document.getElementById('calc-vehicle-note');
  const calcSlowRateHint = document.getElementById('calc-slow-rate-hint');

  function getConnectorDescription(connType) {
    if (connType === 'TYPE7') return '🔌 Port: Type 7 LECCS Fast DC (Ather / Hero VIDA) + 15A Portable AC';
    if (connType === 'TYPE6') return '🔌 Port: Type 6 LEVDC Fast DC (Ola Hypercharger) + 15A Portable AC';
    if (connType === 'AC_PORTABLE') return '🔌 Port: 15A Portable AC Only (DC Fast Guns Incompatible)';
    return '🔌 Port: Universal 2W Profile (Type 6 / Type 7 / 15A AC)';
  }

  function updateChargingEstimator(batState) {
    if (!batState || !window.Utilities) return;
    let startPct = parseInt(calcStartSlider ? calcStartSlider.value : 20, 10) || 20;
    let targetPct = parseInt(calcTargetSlider ? calcTargetSlider.value : 80, 10) || 80;
    if (targetPct < startPct) {
      targetPct = startPct;
      if (calcTargetSlider) calcTargetSlider.value = String(targetPct);
    }

    if (calcStartVal) calcStartVal.textContent = `${startPct}%`;
    if (calcTargetVal) calcTargetVal.textContent = `${targetPct}%`;

    const est = window.Utilities.estimateChargingTime(
      startPct,
      targetPct,
      batState.efficiency,
      batState.vehicleDetails
    );
    if (calcFastTime) calcFastTime.textContent = est.fastTimeFormatted;
    if (calcSlowTime) calcSlowTime.textContent = est.slowTimeFormatted;
    if (calcRangeGain) calcRangeGain.textContent = `+${est.rangeGainedKm} km`;

    const v = batState.vehicleDetails || {};
    if (calcVehicleNote) {
      calcVehicleNote.textContent = `Calculated for ${v.name || '2W EV'} (${v.batteryCapacity || 3.7} kWh) • Includes >80% CC-CV taper`;
    }
    if (calcSlowRateHint) {
      calcSlowRateHint.textContent = `Portable Charger (~${v.acChargerKw || 0.75} kW AC)`;
    }
  }

  let latestRoutePayload = null;
  let lastBatterySig = null;
  let batteryReconcileTimer = null;

  function renderBatteryUI(batState) {
    if (!batState) return;
    if (vehicleSelect && vehicleSelect.value !== batState.selectedVehicle) {
      vehicleSelect.value = batState.selectedVehicle;
    }
    if (vehicleConnInfo && batState.vehicleDetails) {
      vehicleConnInfo.textContent = getConnectorDescription(batState.vehicleDetails.connectorType);
    }

    if (batterySlider) batterySlider.value = String(batState.currentBatteryPct);
    if (batteryNumber && document.activeElement !== batteryNumber) {
      batteryNumber.value = String(batState.currentBatteryPct);
    }
    if (efficiencyInput && document.activeElement !== efficiencyInput) {
      efficiencyInput.value = String(batState.efficiency);
    }
    if (reserveSlider) reserveSlider.value = String(batState.safetyReservePct);
    if (reserveVal) reserveVal.textContent = `${batState.safetyReservePct}%`;
    if (targetChargeSlider) targetChargeSlider.value = String(batState.targetChargePct);
    if (targetChargeVal) targetChargeVal.textContent = `${batState.targetChargePct}%`;

    if (metricSafeRange) metricSafeRange.textContent = `${batState.reachableSafeKm} km`;
    if (metricRealRange) metricRealRange.textContent = `${batState.conservativeSafeKm} km`;
    if (metricMaxRange) metricMaxRange.textContent = `${batState.absoluteMaxKm} km`;

    updateChargingEstimator(batState);

    const newSig = `${batState.selectedVehicle}|${batState.currentBatteryPct}|${batState.efficiency}|${batState.safetyReservePct}|${batState.targetChargePct}`;
    const batteryChanged = (lastBatterySig !== null && lastBatterySig !== newSig);
    lastBatterySig = newSig;

    // Refresh route metrics, timeline, map range & active stops live
    if (latestRoutePayload && latestRoutePayload.route) {
      renderRouteSummaryAndTimeline(latestRoutePayload);
    }
    if (window.MapEngine && typeof window.MapEngine.refreshBatteryVisuals === 'function') {
      window.MapEngine.refreshBatteryVisuals();
    }
    if (window.DriveEngine && window.DriveEngine.isActive()) {
      window.DriveEngine.refreshHudBattery();
    }

    if (batteryChanged && window.RouteEngine && window.RouteEngine.getActiveRoute()) {
      clearTimeout(batteryReconcileTimer);
      batteryReconcileTimer = setTimeout(() => {
        if (!window.RouteEngine || !window.RouteEngine.getActiveRoute()) return;
        const coords = window.MapEngine ? window.MapEngine.getUserCoords() : null;
        window.RouteEngine.reconcileStopsForBattery(coords).then((updated) => {
          if (updated && window.SyncEngine) {
            window.SyncEngine.showAutoUpdateToast('⚡ Map stops & plan updated for new battery settings');
          }
        }).catch(() => {});
      }, 450);
    }
  }

  if (window.BatteryEngine) {
    window.BatteryEngine.subscribe(renderBatteryUI);
  }

  if (vehicleSelect) {
    vehicleSelect.addEventListener('change', (e) => {
      if (window.BatteryEngine) window.BatteryEngine.setVehicle(e.target.value);
      if (window.MapEngine) window.MapEngine.renderChargers();
    });
  }

  if (batterySlider) {
    batterySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && batteryNumber) batteryNumber.value = String(val);
      if (window.BatteryEngine) window.BatteryEngine.setBatteryPct(val);
    });
  }

  if (batteryNumber) {
    batteryNumber.addEventListener('input', (e) => {
      const raw = e.target.value.trim();
      if (raw === '') return;
      const val = Number(raw);
      if (!isNaN(val) && val >= 0 && val <= 100 && window.BatteryEngine) {
        window.BatteryEngine.setBatteryPct(val);
      }
    });
    batteryNumber.addEventListener('blur', () => {
      if (!window.BatteryEngine) return;
      const raw = batteryNumber.value.trim();
      const val = Number(raw);
      if (raw === '' || isNaN(val)) {
        batteryNumber.value = String(window.BatteryEngine.getState().currentBatteryPct);
      } else {
        window.BatteryEngine.setBatteryPct(Math.max(0, Math.min(100, val)));
        batteryNumber.value = String(window.BatteryEngine.getState().currentBatteryPct);
      }
    });
  }

  if (efficiencyInput) {
    efficiencyInput.addEventListener('input', (e) => {
      const raw = e.target.value.trim();
      if (!raw || raw.endsWith('.')) return;
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 0.1 && val <= 3.0 && window.BatteryEngine) {
        window.BatteryEngine.setCustomEfficiency(val);
      }
    });
    efficiencyInput.addEventListener('blur', () => {
      if (!window.BatteryEngine) return;
      const val = parseFloat(efficiencyInput.value);
      if (isNaN(val) || val < 0.1) {
        efficiencyInput.value = String(window.BatteryEngine.getState().efficiency);
      } else {
        window.BatteryEngine.setCustomEfficiency(val);
        efficiencyInput.value = String(window.BatteryEngine.getState().efficiency);
      }
    });
  }

  if (reserveSlider) {
    reserveSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (reserveVal) reserveVal.textContent = `${val}%`;
      if (window.BatteryEngine) window.BatteryEngine.setSafetyReserve(val);
    });
  }

  if (targetChargeSlider) {
    targetChargeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (targetChargeVal) targetChargeVal.textContent = `${val}%`;
      if (window.BatteryEngine) window.BatteryEngine.setTargetChargePct(val);
    });
  }

  if (calcStartSlider) {
    calcStartSlider.addEventListener('input', () => {
      if (window.BatteryEngine) updateChargingEstimator(window.BatteryEngine.getState());
    });
  }
  if (calcTargetSlider) {
    calcTargetSlider.addEventListener('input', () => {
      if (window.BatteryEngine) updateChargingEstimator(window.BatteryEngine.getState());
    });
  }

  // ---------- 6. Autocomplete, Place & Link Resolver ----------
  const searchInput = document.getElementById('search-places-input');
  const searchDropdown = document.getElementById('search-dropdown');
  const originInput = document.getElementById('input-origin');
  const originDropdown = document.getElementById('origin-suggestions');
  const destInput = document.getElementById('input-destination');
  const destDropdown = document.getElementById('dest-suggestions');
  const btnUseGpsOrigin = document.getElementById('btn-use-gps-origin');

  let originCoords = null; // null => live GPS
  let destCoords = null;
  let openDropdownEl = null;

  function closeOpenDropdown() {
    if (openDropdownEl) {
      openDropdownEl.classList.remove('visible');
      openDropdownEl = null;
    }
  }

  // Single global click outside listener — never leaks on dynamic stop creation
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      closeOpenDropdown();
    }
  });

  const intermediateStopsList = document.getElementById('intermediate-stops-list');
  const btnAddIntermediateStop = document.getElementById('btn-add-intermediate-stop');

  async function tryImportGoogleDirectionsUrl(rawText, expandedHint = null) {
    if (!rawText || !window.Utilities) return { imported: false, expanded: expandedHint };
    let expanded = expandedHint;
    const rawTrimmed = rawText.trim();
    const shortMatch = rawTrimmed.match(/(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps)\/[^\s]*/i);
    if (!expanded && shortMatch) {
      const normalizedShort = /^https?:\/\//i.test(shortMatch[0]) ? shortMatch[0] : `https://${shortMatch[0]}`;
      expanded = await window.Utilities.unshortenUrl(normalizedShort);
    }
    const dir = window.Utilities.parseGoogleMapsDirectionsUrl(expanded || rawTrimmed);
    if (!dir) return { imported: false, expanded };

    if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🔗 Importing Google Maps directions...');
    const oRes = await window.Utilities.resolveLocationInput(dir.origin);
    const dRes = await window.Utilities.resolveLocationInput(dir.destination);
    if (oRes && originInput) {
      originCoords = { lat: oRes.lat, lng: oRes.lng, name: oRes.name || dir.origin };
      originInput.value = originCoords.name;
    }
    if (dRes && destInput) {
      destCoords = { lat: dRes.lat, lng: dRes.lng, name: dRes.name || dir.destination };
      destInput.value = destCoords.name;
    }
    if (dir.waypoints && dir.waypoints.length > 0 && intermediateStopsList) {
      intermediateStopsList.innerHTML = '';
      for (const wpText of dir.waypoints) {
        const wpRes = await window.Utilities.resolveLocationInput(wpText);
        if (wpRes) addIntermediateStopRow({ lat: wpRes.lat, lng: wpRes.lng, name: wpRes.name || wpText });
      }
    }
    return { imported: true, expanded };
  }

  function attachLocationAutocomplete(inputEl, dropdownEl, options = {}) {
    if (!inputEl || !dropdownEl) return;
    let debounceTimer = null;

    const showItems = (items) => {
      dropdownEl.innerHTML = '';
      if (!items || items.length === 0) {
        dropdownEl.classList.remove('visible');
        if (openDropdownEl === dropdownEl) openDropdownEl = null;
        return;
      }

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';

        if (item.isStatusNotice) {
          div.innerHTML = `
            <div class="item-title">${esc(item.name)}</div>
            <div class="item-sub">${esc(item.fullName || '')}</div>
          `;
        } else if (item.isCharger) {
          const icon = item.type === 'FAST' ? '⚡' : '🔌';
          div.innerHTML = `
            <div class="item-title">${icon} ${esc(item.name)}</div>
            <div class="item-sub">${esc(item.address || item.connector || 'Verified 2W Charger')}</div>
          `;
        } else {
          div.innerHTML = `
            <div class="item-title">📍 ${esc(item.name)}</div>
            <div class="item-sub">${esc(item.fullName || `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`)}</div>
          `;
        }

        div.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.isStatusNotice) return;
          inputEl.value = item.name;
          dropdownEl.classList.remove('visible');
          if (openDropdownEl === dropdownEl) openDropdownEl = null;
          if (options.onSelect) options.onSelect(item);
        });
        dropdownEl.appendChild(div);
      });

      closeOpenDropdown();
      dropdownEl.classList.add('visible');
      openDropdownEl = dropdownEl;
    };

    const runLookup = () => {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);

      if (q.length < 2 || q.toLowerCase().includes('current location')) {
        dropdownEl.classList.remove('visible');
        return;
      }

      const isLinkOrCoords = window.Utilities && typeof window.Utilities.hasMapLinkOrCoords === 'function'
        ? window.Utilities.hasMapLinkOrCoords(q)
        : (/https?:\/\/|geo:|goo\.gl|maps\.app/i.test(q) || /-?\d{1,2}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+/.test(q));

      if (isLinkOrCoords) {
        if (/https?:\/\/|goo\.gl|maps\.app/i.test(q)) {
          showItems([{ isStatusNotice: true, name: '🔗 Reading Google Maps link...', fullName: 'Extracting location pin' }]);
        }
        debounceTimer = setTimeout(async () => {
          let expandedHint = null;
          if (q.includes('/maps/dir/') || /goo\.gl|maps\.app|g\.co\/maps/i.test(q)) {
            const dirRes = await tryImportGoogleDirectionsUrl(q);
            expandedHint = dirRes.expanded;
            if (dirRes.imported) {
              dropdownEl.classList.remove('visible');
              return;
            }
          }
          if (window.Utilities) {
            const resolved = await window.Utilities.resolveLocationInput(q, expandedHint);
            if (inputEl.value.trim() !== q) return;
            if (resolved) {
              showItems([{ ...resolved, isCharger: false, isMapLink: true }]);
            } else {
              showItems([{
                isStatusNotice: true,
                name: '⚠️ Could not extract coordinates from this short link',
                fullName: navigator.onLine
                  ? 'Use VoltWay Android APK or paste Google Maps Coordinates (e.g. 10.5276, 76.2144)'
                  : 'Connect to internet to open short Google Maps links'
              }]);
            }
          }
        }, 120);
        return;
      }

      const qLower = q.toLowerCase();
      const immediatePlaces = window.Utilities
        ? window.Utilities.getLocalPlaces(q).map(p => ({ ...p, isCharger: false }))
        : [];
      const immediateChargers = [];

      if (options.includeChargers && window.SyncEngine) {
        const allChargers = window.SyncEngine.getChargers() || [];
        let matchedCount = 0;
        for (let i = 0; i < allChargers.length && matchedCount < 5; i++) {
          const c = allChargers[i];
          if ((c.name && c.name.toLowerCase().includes(qLower)) || (c.address && c.address.toLowerCase().includes(qLower))) {
            immediateChargers.push({ ...c, isCharger: true });
            matchedCount++;
          }
        }
      }

      // Show matching cities/towns first, followed by matching chargers
      const immediateResults = [...immediatePlaces, ...immediateChargers];
      if (immediateResults.length > 0) {
        showItems(immediateResults.slice(0, 8));
      }

      if (navigator.onLine && window.Utilities) {
        debounceTimer = setTimeout(async () => {
          const onlinePlaces = await window.Utilities.searchPlace(q);
          if (inputEl.value.trim() !== q) return;
          const merged = [];
          (onlinePlaces || []).forEach(p => {
            if (!merged.some(m => !m.isCharger && Math.abs(m.lat - p.lat) < 0.02 && Math.abs(m.lng - p.lng) < 0.02)) {
              merged.push({ ...p, isCharger: false });
            }
          });
          immediateChargers.forEach(c => {
            if (merged.length < 8) merged.push(c);
          });
          if (merged.length > 0) {
            showItems(merged.slice(0, 8));
          }
        }, 220);
      }
    };

    inputEl.addEventListener('input', () => {
      if (options.onClearSelection) options.onClearSelection();
      runLookup();
    });

    inputEl.addEventListener('paste', () => {
      if (options.onClearSelection) options.onClearSelection();
      setTimeout(runLookup, 10);
    });

    inputEl.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const firstReal = Array.from(dropdownEl.querySelectorAll('.dropdown-item')).find(el => {
          const t = el.querySelector('.item-title');
          return t && !t.textContent.startsWith('🔗') && !t.textContent.startsWith('⚠️');
        });
        if (firstReal) {
          e.preventDefault();
          firstReal.click();
          return;
        }
        const q = inputEl.value.trim();
        if (q.length >= 2 && !q.toLowerCase().includes('current location') && window.Utilities) {
          e.preventDefault();
          clearTimeout(debounceTimer);
          showItems([{ isStatusNotice: true, name: '🔗 Finding location...', fullName: 'Resolving input' }]);
          try {
            let expandedHint = null;
            if (q.includes('/maps/dir/') || /goo\.gl|maps\.app|g\.co\/maps/i.test(q)) {
              const dirRes = await tryImportGoogleDirectionsUrl(q);
              expandedHint = dirRes.expanded;
              if (dirRes.imported) {
                dropdownEl.classList.remove('visible');
                return;
              }
            }
            const resolved = await window.Utilities.resolveLocationInput(q, expandedHint);
            if (inputEl.value.trim() !== q) return;
            if (resolved) {
              inputEl.value = resolved.name;
              dropdownEl.classList.remove('visible');
              if (openDropdownEl === dropdownEl) openDropdownEl = null;
              if (options.onSelect) options.onSelect({ ...resolved, isCharger: false, isMapLink: true });
            } else {
              showItems([{ isStatusNotice: true, name: '⚠️ Location not found', fullName: 'Check spelling or paste coordinates' }]);
            }
          } catch (err) {}
        }
      }
    });

    inputEl.addEventListener('focus', () => {
      const q = inputEl.value.trim();
      if (q.length >= 2 && !q.toLowerCase().includes('current location') && dropdownEl.children.length === 0) {
        runLookup();
      } else if (dropdownEl.children.length > 0 && q.length >= 2 && !q.toLowerCase().includes('current location')) {
        closeOpenDropdown();
        dropdownEl.classList.add('visible');
        openDropdownEl = dropdownEl;
      }
    });
  }

  attachLocationAutocomplete(searchInput, searchDropdown, {
    includeChargers: true,
    onClearSelection: () => {
      if (window.MapEngine && typeof window.MapEngine.clearSearchPin === 'function') {
        window.MapEngine.clearSearchPin();
      }
    },
    onSelect: (item) => {
      if (item.isCharger && window.MapEngine) {
        window.MapEngine.focusCharger(item);
      } else if (window.MapEngine && window.MapEngine.getMap()) {
        const z = item.isMapLink ? 15 : 13;
        window.MapEngine.getMap().flyTo([item.lat, item.lng], z, { animate: true, duration: 0.5 });
        if (typeof window.MapEngine.showSearchPin === 'function') {
          window.MapEngine.showSearchPin(item);
        }
      }
    }
  });

  attachLocationAutocomplete(originInput, originDropdown, {
    includeChargers: true,
    onClearSelection: () => { originCoords = null; },
    onSelect: (item) => {
      originCoords = { lat: item.lat, lng: item.lng, name: item.name };
    }
  });

  attachLocationAutocomplete(destInput, destDropdown, {
    includeChargers: true,
    onClearSelection: () => { destCoords = null; },
    onSelect: (item) => {
      destCoords = { lat: item.lat, lng: item.lng, name: item.name };
    }
  });

  if (btnUseGpsOrigin && originInput) {
    btnUseGpsOrigin.addEventListener('click', async () => {
      originCoords = null;
      originInput.value = 'Current Location (GPS)';
      if (window.MapEngine) {
        await window.MapEngine.locateUser(true);
      }
    });
  }

  window.setPlannerDest = (charger) => {
    if (!charger) return;
    destCoords = { lat: charger.lat, lng: charger.lng, name: charger.name || 'Charging Station' };
    if (destInput) destInput.value = destCoords.name;
    activateTab('route', true);
    if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast(`🏁 Destination set: ${destCoords.name}`);
  };

  // ---------- 7. Dynamic Intermediate Custom Stops ----------
  function refreshStopBadges() {
    if (!intermediateStopsList) return;
    const rows = intermediateStopsList.querySelectorAll('.intermediate-stop-row');
    rows.forEach((row, idx) => {
      const badge = row.querySelector('.stop-badge-letter');
      if (badge) badge.textContent = String.fromCharCode(66 + idx);
    });
    if (originInput && originInput.previousElementSibling) {
      // Keep origin label clean
    }
  }

  function addIntermediateStopRow(initialStop = null) {
    if (!intermediateStopsList) return;
    const row = document.createElement('div');
    row.className = 'input-group intermediate-stop-row';
    const stopId = (initialStop && (initialStop.id || initialStop.originalId)) || `manual_stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    row._stopId = stopId;
    row._stopData = initialStop ? { ...initialStop, id: stopId, originalId: stopId } : { id: stopId, originalId: stopId };

    const idx = intermediateStopsList.querySelectorAll('.intermediate-stop-row').length;
    const letter = String.fromCharCode(66 + idx);

    row.innerHTML = `
      <span class="input-label">Intermediate Stop (<span class="stop-badge-letter">${letter}</span>)</span>
      <div class="autocomplete-wrapper">
        <div class="input-row">
          <input type="text" class="input-text intermediate-stop-input" placeholder="Town, charger, or Maps link..." autocomplete="off">
          <button type="button" class="btn-stop-ctrl remove" title="Remove Stop">❌</button>
        </div>
        <div class="autocomplete-dropdown"></div>
      </div>
    `;

    const inputEl = row.querySelector('.intermediate-stop-input');
    const dropdownEl = row.querySelector('.autocomplete-dropdown');
    const btnRemove = row.querySelector('.btn-remove-stop, .btn-stop-ctrl.remove');

    if (initialStop && initialStop.name) {
      inputEl.value = initialStop.name;
    }

    attachLocationAutocomplete(inputEl, dropdownEl, {
      includeChargers: true,
      onClearSelection: () => {
        row._stopData = null;
      },
      onSelect: (item) => {
        row._stopData = {
          id: row._stopId,
          originalId: item.originalId || item.id || row._stopId,
          lat: item.lat,
          lng: item.lng,
          name: item.name,
          ...(item.isCharger ? item : {})
        };
      }
    });

    if (btnRemove) {
      btnRemove.addEventListener('click', () => {
        const toRemove = row._stopData || row._stopId;
        row.remove();
        refreshStopBadges();
        if (toRemove && window.RouteEngine) {
          const active = window.RouteEngine.getActiveRoute();
          if (active) {
            window.RouteEngine.removeWaypoint(toRemove);
          }
        }
      });
    }

    intermediateStopsList.appendChild(row);
    refreshStopBadges();
  }

  if (btnAddIntermediateStop) {
    btnAddIntermediateStop.addEventListener('click', () => addIntermediateStopRow(null));
  }

  // ---------- 8. Route Planning, Auto-Stop & Summary Controls ----------
  const btnPlanRoute = document.getElementById('btn-plan-route');
  const btnClearRoute = document.getElementById('btn-clear-route');
  const routeFilterBtns = Array.from(document.querySelectorAll('.route-filter-btn'));
  const routeSelectorContainer = document.getElementById('route-selector-container');
  const routeSelectorPills = document.getElementById('route-selector-pills');
  const routeSelectorCount = document.getElementById('route-selector-count');
  const routeSummaryCard = document.getElementById('route-summary-card');
  const tripWaypointsSection = document.getElementById('trip-waypoints-section');
  const tripWaypointsContainer = document.getElementById('trip-waypoints-container');
  const tripWaypointsCount = document.getElementById('trip-waypoints-count');
  const tripTimelineSection = document.getElementById('trip-battery-timeline-section');
  const tripTimelineContainer = document.getElementById('trip-battery-timeline-container');
  const btnModeOptimal = document.getElementById('btn-mode-optimal');
  const btnModeTarget = document.getElementById('btn-mode-target');
  const corridorChargersList = document.getElementById('corridor-chargers-list');
  const corridorCountEl = document.getElementById('corridor-count');
  const corridorBufferBadge = document.getElementById('corridor-buffer-badge');
  const inputMapCorridor = document.getElementById('input-map-corridor');
  const inputDrawerCorridor = document.getElementById('input-drawer-corridor');
  const mapRouteCorridorPill = document.getElementById('map-route-corridor-pill');
  const btnFloatingStartNav = document.getElementById('btn-floating-start-nav');
  const btnStartInAppNav = document.getElementById('btn-start-inapp-nav');
  const navSecondaryActions = document.getElementById('nav-secondary-actions');
  const btnOpenGoogleMaps = document.getElementById('btn-open-google-maps');

  routeFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!window.RouteEngine) return;
      const key = btn.dataset.filter;
      const current = window.RouteEngine.getRouteFilters();
      const nextVal = !current[key];
      btn.classList.toggle('active', nextVal);
      window.RouteEngine.setRouteFilters({ [key]: nextVal });
    });
  });

  let corridorInputTimer = null;
  function bindCorridorInput(inputEl, mirrorEl) {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
      const val = Math.max(1, Math.min(100, parseInt(inputEl.value, 10) || 5));
      if (mirrorEl && document.activeElement !== mirrorEl) mirrorEl.value = String(val);
      clearTimeout(corridorInputTimer);
      corridorInputTimer = setTimeout(() => {
        if (window.RouteEngine) window.RouteEngine.setCorridorBufferKm(val);
      }, 220);
    });
  }
  bindCorridorInput(inputMapCorridor, inputDrawerCorridor);
  bindCorridorInput(inputDrawerCorridor, inputMapCorridor);

  if (btnModeOptimal) {
    btnModeOptimal.addEventListener('click', () => {
      if (window.RouteEngine) window.RouteEngine.setTimelineMode('optimal');
    });
  }
  if (btnModeTarget) {
    btnModeTarget.addEventListener('click', () => {
      if (window.RouteEngine) window.RouteEngine.setTimelineMode('target');
    });
  }

  if (btnOpenGoogleMaps) {
    btnOpenGoogleMaps.addEventListener('click', () => {
      if (!window.RouteEngine || !window.NavigationEngine) return;
      const active = window.RouteEngine.getActiveRoute();
      if (!active) return;

      let exportOrigin = active.origin;
      let exportWaypoints = active.waypoints || [];

      // If rider is currently along the active route (>3% progressed, within 1km), resume Google Maps from live GPS & drop already-passed stops
      const curCoords = window.MapEngine ? window.MapEngine.getUserCoords() : null;
      if (curCoords && window.RouteEngine.sliceActiveRouteAtPosition) {
        const slice = window.RouteEngine.sliceActiveRouteAtPosition(curCoords.lat, curCoords.lng);
        if (slice && slice.distanceFromRouteKm <= 1.0 && slice.progressPct >= 3 && slice.progressPct < 98) {
          const traversedKm = Math.max(0, active.distanceKm - slice.remainingKm);
          exportOrigin = { lat: curCoords.lat, lng: curCoords.lng, name: 'Current Location' };
          exportWaypoints = exportWaypoints.filter(w =>
            typeof w.kmFromOrigin !== 'number' || w.kmFromOrigin > traversedKm + 0.5
          );
        }
      }

      window.NavigationEngine.startFullTrip(exportOrigin, active.destination, exportWaypoints);
    });
  }

  async function resolvePlannerOrigin() {
    const raw = originInput ? originInput.value.trim() : '';
    if (!raw || raw.toLowerCase().includes('current location')) {
      let coords = window.MapEngine ? window.MapEngine.getUserCoords() : null;
      if (!coords && window.MapEngine) {
        coords = await window.MapEngine.locateUser(false);
      }
      if (!coords) {
        try {
          const cached = localStorage.getItem('voltway_last_known_pos');
          if (cached) {
            const p = JSON.parse(cached);
            if (p && typeof p.lat === 'number' && typeof p.lng === 'number') coords = p;
          }
        } catch (e) {}
      }
      if (!coords && window.MapEngine && window.MapEngine.getMap()) {
        const c = window.MapEngine.getMap().getCenter();
        coords = { lat: c.lat, lng: c.lng };
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('⚠️ GPS unavailable — using map center as origin.');
      }
      return coords ? { lat: coords.lat, lng: coords.lng, name: 'Current Location' } : null;
    }

    if (originCoords) return originCoords;
    if (window.Utilities) {
      const resolved = await window.Utilities.resolveLocationInput(raw);
      if (resolved) {
        originCoords = { lat: resolved.lat, lng: resolved.lng, name: resolved.name || raw };
        if (originInput && resolved.name) originInput.value = resolved.name;
        return originCoords;
      }
    }
    return null;
  }

  async function resolvePlannerDest() {
    const raw = destInput ? destInput.value.trim() : '';
    if (!raw) return null;
    if (destCoords) return destCoords;
    if (window.Utilities) {
      const resolved = await window.Utilities.resolveLocationInput(raw);
      if (resolved) {
        destCoords = { lat: resolved.lat, lng: resolved.lng, name: resolved.name || raw };
        if (destInput && resolved.name) destInput.value = resolved.name;
        return destCoords;
      }
    }
    return null;
  }

  if (btnPlanRoute) {
    btnPlanRoute.addEventListener('click', async () => {
      if (!window.RouteEngine) return;
      if (!navigator.onLine) {
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('📡 Offline: New road route calculation requires internet connection.');
        return;
      }

      const prevText = btnPlanRoute.innerHTML;
      btnPlanRoute.disabled = true;
      btnPlanRoute.innerHTML = '⏳ Planning...';

      try {
        const origin = await resolvePlannerOrigin();
        const dest = await resolvePlannerDest();
        if (!origin) {
          if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('⚠️ Could not resolve starting location.');
          return;
        }
        if (!dest) {
          if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('⚠️ Please enter or select a valid destination.');
          return;
        }

        // Gather manual intermediate stops from rows
        const manualRows = intermediateStopsList
          ? Array.from(intermediateStopsList.querySelectorAll('.intermediate-stop-row'))
          : [];
        const resolvedManualStops = [];
        for (const row of manualRows) {
          if (row._stopData && typeof row._stopData.lat === 'number') {
            const sid = row._stopData.id || row._stopId || `manual_stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            row._stopData.id = sid;
            row._stopData.originalId = row._stopData.originalId || sid;
            resolvedManualStops.push({ ...row._stopData });
          } else {
            const inp = row.querySelector('.intermediate-stop-input');
            const val = inp ? inp.value.trim() : '';
            if (val && window.Utilities) {
              const r = await window.Utilities.resolveLocationInput(val);
              if (r) {
                const sid = row._stopId || `manual_stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                row._stopData = { id: sid, originalId: sid, lat: r.lat, lng: r.lng, name: r.name || val };
                resolvedManualStops.push({ ...row._stopData });
              }
            }
          }
        }

        // Preserve any already-added charger stops if route origin/dest stayed similar; otherwise use fresh manual stops
        const preserveOrder = resolvedManualStops.length > 0;
        await window.RouteEngine.calculateRoute(origin, dest, resolvedManualStops, preserveOrder);

        const active = window.RouteEngine.getActiveRoute();
        if (active && window.BatteryEngine) {
          const timeline = window.RouteEngine.calculateTripTimeline(active, window.BatteryEngine.getState());
          const minReserve = window.BatteryEngine.getState().safetyReservePct ?? 15;
          if (timeline && timeline.finalArrivalSoC < minReserve) {
            const added = await window.RouteEngine.autoSuggestChargingStops();
            if (added && added.length > 0 && window.SyncEngine) {
              window.SyncEngine.showAutoUpdateToast(`⚡ Auto-added ${added.length} compatible charging stop${added.length > 1 ? 's' : ''} along route`);
            }
          }
        }
      } catch (err) {
        if (window.SyncEngine) {
          window.SyncEngine.showAutoUpdateToast(`⚠️ Route error: ${err.message || 'Could not compute route'}`);
        }
      } finally {
        btnPlanRoute.disabled = false;
        btnPlanRoute.innerHTML = prevText;
      }
    });
  }

  function resetActiveTrip() {
    if (window.DriveEngine && window.DriveEngine.isActive()) {
      window.DriveEngine.stop();
    }
    if (window.RouteEngine) window.RouteEngine.clearRoute();
    destCoords = null;
    if (destInput) destInput.value = '';
    if (intermediateStopsList) intermediateStopsList.innerHTML = '';
    if (window.MapEngine) {
      if (typeof window.MapEngine.clearSearchPin === 'function') window.MapEngine.clearSearchPin();
      window.MapEngine.renderChargers();
    }
  }

  if (btnClearRoute) {
    btnClearRoute.addEventListener('click', resetActiveTrip);
  }

  function renderWaypointsList(waypoints) {
    if (!tripWaypointsSection || !tripWaypointsContainer || !tripWaypointsCount) return;
    if (!waypoints || waypoints.length === 0) {
      tripWaypointsSection.style.display = 'none';
      tripWaypointsContainer.innerHTML = '';
      tripWaypointsCount.textContent = '0';
      return;
    }

    tripWaypointsSection.style.display = 'block';
    tripWaypointsCount.textContent = String(waypoints.length);
    tripWaypointsContainer.innerHTML = '';

    waypoints.forEach((wp, idx) => {
      const item = document.createElement('div');
      item.className = 'trip-waypoint-item';

      const isCharger = !!(wp.network || wp.type);
      const badgeLabel = isCharger ? `⚡ STOP ${idx + 1}` : `📍 STOP ${idx + 1}`;
      const detailSuffix = isCharger
        ? ` (${wp.power_kw || (wp.type === 'FAST' ? 3 : 1.5)} kW • ${typeof wp.kmFromOrigin === 'number' ? wp.kmFromOrigin + ' km' : 'On route'})`
        : (typeof wp.kmFromOrigin === 'number' ? ` (${wp.kmFromOrigin} km)` : '');

      item.innerHTML = `
        <span class="trip-waypoint-badge">${esc(badgeLabel)}</span>
        <span class="trip-waypoint-title">${esc(wp.name || 'Stop')}${esc(detailSuffix)}</span>
        <button type="button" class="btn-remove-waypoint" title="Remove Stop">❌</button>
      `;

      const rmBtn = item.querySelector('.btn-remove-waypoint');
      if (rmBtn) {
        rmBtn.addEventListener('click', () => {
          if (window.RouteEngine) {
            window.RouteEngine.removeWaypoint(wp);
          }
          if (intermediateStopsList) {
            const rows = Array.from(intermediateStopsList.querySelectorAll('.intermediate-stop-row'));
            for (const r of rows) {
              const rd = r._stopData;
              if (rd && (
                (rd.id && wp.id && String(rd.id) === String(wp.id)) ||
                (typeof rd.lat === 'number' && typeof wp.lat === 'number' && Math.abs(rd.lat - wp.lat) < 1e-4 && Math.abs(rd.lng - wp.lng) < 1e-4) ||
                (rd.name && wp.name && rd.name.trim() === wp.name.trim())
              )) {
                r.remove();
                refreshStopBadges();
                break;
              }
            }
          }
        });
      }

      tripWaypointsContainer.appendChild(item);
    });
  }

  function renderRouteSummaryAndTimeline(payload) {
    const route = payload ? payload.route : null;
    const allRoutes = payload ? payload.allRoutes : [];
    const selectedIdx = payload ? payload.selectedRouteIndex : 0;
    const corridor = payload ? payload.corridorChargers : [];
    const waypoints = payload ? payload.waypoints : [];
    const timelineMode = payload ? payload.timelineMode : 'optimal';
    const bufKm = payload ? payload.corridorBufferKm : 5;

    if (!route) {
      if (routeSelectorContainer) routeSelectorContainer.style.display = 'none';
      if (routeSummaryCard) routeSummaryCard.style.display = 'none';
      if (tripWaypointsSection) tripWaypointsSection.style.display = 'none';
      if (mapRouteCorridorPill) mapRouteCorridorPill.style.display = 'none';
      if (btnFloatingStartNav) btnFloatingStartNav.style.display = 'none';
      if (btnStartInAppNav) btnStartInAppNav.style.display = 'none';
      if (navSecondaryActions) navSecondaryActions.style.display = 'none';
      return;
    }

    if (mapRouteCorridorPill) mapRouteCorridorPill.style.display = 'flex';
    if (btnStartInAppNav) btnStartInAppNav.style.display = 'flex';
    if (navSecondaryActions) navSecondaryActions.style.display = 'flex';
    if (btnFloatingStartNav && !(window.DriveEngine && window.DriveEngine.isActive())) {
      btnFloatingStartNav.style.display = 'flex';
    }

    // Multi-route options selector
    if (routeSelectorContainer && routeSelectorPills) {
      if (allRoutes && allRoutes.length > 1) {
        routeSelectorContainer.style.display = 'block';
        if (routeSelectorCount) routeSelectorCount.textContent = `${allRoutes.length} Available`;
        routeSelectorPills.innerHTML = '';
        const minPillDur = Math.min(...allRoutes.map(x => (typeof x.durationMins === 'number' ? x.durationMins : Infinity)));
        allRoutes.forEach((r, idx) => {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = `route-card-pill${idx === selectedIdx ? ' active' : ''}`;
          const diffMins = Number.isFinite(minPillDur) ? Math.max(0, (r.durationMins || 0) - minPillDur) : (r.timeDiffMins || 0);
          const badgeClass = diffMins === 0 ? 'pill-badge-fastest' : 'pill-badge-diff';
          const badgeTxt = diffMins === 0 ? 'FASTEST' : `+${diffMins}m`;
          const durTxt = window.Utilities ? window.Utilities.formatMinutes(r.durationMins) : `${r.durationMins} min`;
          const stopCount = Array.isArray(r.waypoints) ? r.waypoints.filter(w => w.network || w.type).length : 0;
          const roadDisplay = stopCount > 0
            ? `${r.roadName || `Route ${idx + 1}`} • ⚡${stopCount} stop`
            : (r.roadName || `Route ${idx + 1}`);
          pill.innerHTML = `
            <div class="pill-top-row">
              <span class="pill-badge ${badgeClass}">${esc(badgeTxt)}</span>
              <span class="pill-dist-txt">${r.distanceKm} km</span>
            </div>
            <div class="pill-duration-val">${esc(durTxt)}</div>
            <div class="pill-road-txt">${esc(roadDisplay)}</div>
          `;
          pill.addEventListener('click', () => {
            if (window.RouteEngine) window.RouteEngine.selectRoute(idx);
          });
          routeSelectorPills.appendChild(pill);
        });
      } else {
        routeSelectorContainer.style.display = 'none';
      }
    }

    renderWaypointsList(waypoints);

    if (routeSummaryCard) routeSummaryCard.style.display = 'flex';

    const batState = window.BatteryEngine ? window.BatteryEngine.getState() : {
      efficiency: 0.85,
      safetyReservePct: 15,
      currentBatteryPct: 85,
      targetChargePct: 80
    };

    const timelineResult = window.RouteEngine
      ? window.RouteEngine.calculateTripTimeline(route, batState)
      : null;

    const eff = batState.efficiency > 0 ? batState.efficiency : 0.85;
    const totalUsedPct = Math.round((route.distanceKm / eff) * 10) / 10;
    const finalArrivalSoC = timelineResult
      ? timelineResult.finalArrivalSoC
      : Math.round((batState.currentBatteryPct - totalUsedPct) * 10) / 10;

    const distEl = document.getElementById('metric-trip-dist');
    const timeEl = document.getElementById('metric-trip-time');
    const neededEl = document.getElementById('metric-bat-needed');
    const arrivalEl = document.getElementById('metric-bat-arrival');
    const statusBanner = document.getElementById('route-status-banner');

    if (distEl) distEl.textContent = `${route.distanceKm} km`;
    if (timeEl) {
      const fmtMin = m => (window.Utilities ? window.Utilities.formatMinutes(m) : `${m} min`);
      const rideMins = (timelineResult && typeof timelineResult.totalDrivingMins === 'number')
        ? timelineResult.totalDrivingMins
        : route.durationMins;
      const totalMins = (timelineResult && typeof timelineResult.totalTripDurationMins === 'number')
        ? timelineResult.totalTripDurationMins
        : rideMins;
      const chargeMins = Math.max(0, totalMins - rideMins);
      timeEl.textContent = fmtMin(rideMins);
      const timeLabelEl = document.getElementById('metric-trip-time-label');
      if (timeLabelEl) {
        timeLabelEl.textContent = chargeMins > 0
          ? `Ride (+${fmtMin(chargeMins)}⚡ = ${fmtMin(totalMins)})`
          : 'Ride Time';
      }
    }
    if (neededEl) neededEl.textContent = `~${totalUsedPct}%`;
    if (arrivalEl) {
      arrivalEl.textContent = `${finalArrivalSoC}%`;
      arrivalEl.style.color = finalArrivalSoC < 0
        ? '#ff4d6d'
        : (finalArrivalSoC < batState.safetyReservePct ? '#fbbf24' : '#00e676');
    }

    if (statusBanner) {
      const stopsCount = timelineResult ? timelineResult.totalChargingStops : 0;
      const unsafeNode = timelineResult && timelineResult.timeline
        ? timelineResult.timeline.find(n => (n.type === 'CHARGER_STOP' || n.type === 'CUSTOM_STOP' || n.type === 'DESTINATION') && n.arrivalSoC < 0)
        : null;
      const warnNode = timelineResult && timelineResult.timeline
        ? timelineResult.timeline.find(n => (n.type === 'CHARGER_STOP' || n.type === 'CUSTOM_STOP' || n.type === 'DESTINATION') && n.arrivalSoC < batState.safetyReservePct)
        : null;

      if (unsafeNode) {
        statusBanner.className = 'status-banner status-critical';
        statusBanner.textContent = `Range Alert: Leg arrival at ~${unsafeNode.arrivalSoC}% SoC. Add a charging stop or adjust efficiency.`;
      } else if (warnNode) {
        statusBanner.className = 'status-banner status-warning';
        statusBanner.textContent = `Reserve Notice: Leg arrives at ~${warnNode.arrivalSoC}% (below ${batState.safetyReservePct}% buffer).`;
      } else if (stopsCount > 0) {
        statusBanner.className = 'status-banner status-safe';
        statusBanner.textContent = `Safe Multi-Stop Trip (${stopsCount} charging stop${stopsCount > 1 ? 's' : ''}): Arrive at destination with ~${finalArrivalSoC}% SoC.`;
      } else {
        const evalRes = window.BatteryEngine ? window.BatteryEngine.evaluateTrip(route.distanceKm) : null;
        statusBanner.className = `status-banner ${(evalRes && evalRes.statusClass) || 'status-safe'}`;
        statusBanner.textContent = (evalRes && evalRes.statusText) || `Est. Safe Ride: Arrive with ~${finalArrivalSoC}% battery`;
      }
    }

    // Battery & Charging Plan Section (Clean Scannable Cards)
    if (btnModeOptimal) btnModeOptimal.classList.toggle('active', timelineMode === 'optimal');
    if (btnModeTarget) {
      btnModeTarget.classList.toggle('active', timelineMode === 'target');
      btnModeTarget.textContent = `🔋 To ${batState.targetChargePct || 80}%`;
    }

    if (tripTimelineSection && tripTimelineContainer && timelineResult && timelineResult.timeline) {
      tripTimelineSection.style.display = 'block';
      tripTimelineContainer.className = 'battery-timeline-container timeline-nodes-list';
      tripTimelineContainer.innerHTML = '';

      if (timelineResult.totalChargingStops > 0) {
        const sumStrip = document.createElement('div');
        sumStrip.className = 'plan-summary-strip';
        const totChargeTxt = window.Utilities
          ? window.Utilities.formatMinutes(timelineResult.totalChargingMins)
          : `${timelineResult.totalChargingMins}m`;
        sumStrip.innerHTML = `
          <span>⚡ ${timelineResult.totalChargingStops} Charging Stop${timelineResult.totalChargingStops > 1 ? 's' : ''}</span>
          <span style="color:#38bdf8;">Charge Time: ~${esc(totChargeTxt)}</span>
          <span style="color:${finalArrivalSoC < batState.safetyReservePct ? '#fbbf24' : '#00e676'};">Finish: ${finalArrivalSoC}%</span>
        `;
        tripTimelineContainer.appendChild(sumStrip);
      }

      timelineResult.timeline.forEach(node => {
        const el = document.createElement('div');
        if (node.type === 'ORIGIN') {
          el.className = 'timeline-step';
          el.innerHTML = `
            <div class="step-icon-col">
              <div class="step-dot dot-origin">🚩</div>
              <div class="step-stem"></div>
            </div>
            <div class="step-content">
              <div class="step-title-row">
                <span class="step-title">${esc(node.name)}</span>
                <span class="stop-pill-spec" style="color:#38bdf8;">Start: ${node.batteryPct}%</span>
              </div>
            </div>
          `;
        } else if (node.type === 'LEG') {
          const rideDur = window.Utilities ? window.Utilities.formatMinutes(node.durationMins) : `${node.durationMins}m`;
          el.className = 'timeline-step timeline-step-leg';
          el.innerHTML = `
            <div class="step-icon-col"><div class="step-stem"></div></div>
            <div class="step-content" style="padding-top:2px; padding-bottom:10px;">
              <div class="leg-pill">
                <span>🛵 ${node.distanceKm} km • ${esc(rideDur)}</span>
                <span class="leg-bat-used">-${node.batteryUsedPct}% battery</span>
              </div>
            </div>
          `;
        } else if (node.type === 'CHARGER_STOP') {
          const st = node.station || {};
          const compat = (window.BatteryEngine && window.BatteryEngine.isChargerCompatible)
            ? window.BatteryEngine.isChargerCompatible(st)
            : { compatible: true, reason: '' };
          const fmtTime = window.Utilities ? window.Utilities.formatMinutes(node.chargeTimeMins) : `${node.chargeTimeMins}m`;
          const arrColor = node.arrivalSoC < 0 ? '#ff4d6d' : (node.arrivalSoC < batState.safetyReservePct ? '#fbbf24' : '#38bdf8');
          const cardStateClass = node.arrivalSoC < 0 ? 'critical' : (!node.isSafeArrival ? 'warn' : '');
          const fillPct = Math.max(4, Math.min(100, node.departureSoC));

          let warningHtml = '';
          if (node.arrivalSoC < 0) {
            warningHtml = `<div class="plan-alert-pill critical">⚠️ Out of battery before reaching this stop (${node.arrivalSoC}%). Add an earlier stop.</div>`;
          } else if (node.arrivalSoC < batState.safetyReservePct) {
            warningHtml = `<div class="plan-alert-pill">⚠️ Low arrival battery (${node.arrivalSoC}%, below ${batState.safetyReservePct}% reserve).</div>`;
          }
          if (!compat.compatible) {
            warningHtml += `<div class="plan-alert-pill">🔌 ${esc(compat.reason)}</div>`;
          }

          el.className = 'timeline-step';
          el.innerHTML = `
            <div class="step-icon-col">
              <div class="step-dot dot-stop">⚡</div>
              <div class="step-stem"></div>
            </div>
            <div class="step-content">
              <div class="plan-stop-card ${cardStateClass}">
                <div class="plan-stop-top">
                  <div class="plan-stop-name">Stop ${node.index} • ${esc(st.name || 'Charger')}</div>
                  <span class="plan-stop-badge">${node.isFast ? `⚡ ${st.power_kw || 3} kW` : '🔌 15A'}</span>
                </div>
                <div class="plan-charge-flow">
                  <div class="plan-flow-col">
                    <span class="plan-flow-lbl">Arrive</span>
                    <span class="plan-flow-val" style="color:${arrColor};">${node.arrivalSoC}%</span>
                  </div>
                  <div class="plan-flow-mid">+${node.chargeNeededPct}% • ${esc(fmtTime)}</div>
                  <div class="plan-flow-col">
                    <span class="plan-flow-lbl">Leave</span>
                    <span class="plan-flow-val" style="color:#00e676;">${node.departureSoC}%</span>
                  </div>
                </div>
                <div class="plan-bat-bar-track">
                  <div class="plan-bat-bar-fill" style="width:${fillPct}%;"></div>
                </div>
                ${warningHtml}
              </div>
            </div>
          `;
        } else if (node.type === 'CUSTOM_STOP') {
          const arrCol = node.isCriticalArrival ? '#ff4d6d' : (node.isSafeArrival ? '#00e676' : '#fbbf24');
          el.className = 'timeline-step';
          el.innerHTML = `
            <div class="step-icon-col">
              <div class="step-dot" style="background:#fbbf24; color:#451a03;">📍</div>
              <div class="step-stem"></div>
            </div>
            <div class="step-content">
              <div class="step-title-row">
                <span class="step-title">Stop ${node.index} • ${esc(node.name)}</span>
                <span class="stop-pill-spec" style="color:${arrCol};">Arrive: ${node.arrivalSoC}%</span>
              </div>
            </div>
          `;
        } else if (node.type === 'DESTINATION') {
          const endCol = node.isCritical ? '#ff4d6d' : (node.isSafe ? '#00e676' : '#fbbf24');
          el.className = 'timeline-step';
          el.innerHTML = `
            <div class="step-icon-col">
              <div class="step-dot dot-dest" style="background:${endCol};">🏁</div>
            </div>
            <div class="step-content" style="padding-bottom: 2px;">
              <div class="step-title-row">
                <span class="step-title">${esc(node.name)}</span>
                <span class="stop-pill-spec" style="color:${endCol};">Finish: ${node.arrivalSoC}%</span>
              </div>
            </div>
          `;
        }
        tripTimelineContainer.appendChild(el);
      });
    }

    // Corridor Buffer UI & Chargers List
    const displayBuf = bufKm === 'all' ? 'All (50 km)' : `Within ${bufKm} km`;
    if (corridorBufferBadge) corridorBufferBadge.textContent = displayBuf;
    if (inputMapCorridor && document.activeElement !== inputMapCorridor && typeof bufKm === 'number') {
      inputMapCorridor.value = String(bufKm);
    }
    if (inputDrawerCorridor && document.activeElement !== inputDrawerCorridor && typeof bufKm === 'number') {
      inputDrawerCorridor.value = String(bufKm);
    }

    if (corridorCountEl) corridorCountEl.textContent = String((corridor || []).length);
    if (corridorChargersList) {
      corridorChargersList.innerHTML = '';
      if (!corridor || corridor.length === 0) {
        corridorChargersList.innerHTML = `<div class="empty-state">No compatible 2W chargers found within ${esc(bufKm)} km corridor. Increase buffer or toggle filters.</div>`;
      } else {
        const addedSet = new Set((waypoints || []).map(w => String(w.originalId || w.id)));
        corridor.slice(0, 60).forEach(c => {
          const isAdded = addedSet.has(String(c.originalId || c.id));
          const compat = (window.BatteryEngine && window.BatteryEngine.isChargerCompatible)
            ? window.BatteryEngine.isChargerCompatible(c)
            : { compatible: true, reason: '2W Compatible' };

          const card = document.createElement('div');
          card.className = `corridor-card${isAdded ? ' is-waypoint' : ''}`;
          const detourClass = (c.corridorDistanceKm || 0) <= 0.8 ? 'direct-pill' : 'detour-pill';
          card.innerHTML = `
            <div class="corridor-card-header">
              <div class="corridor-card-title">${c.type === 'FAST' ? '⚡' : '🔌'} ${esc(c.name)}</div>
              <span class="corridor-detour-pill ${detourClass}">${c.corridorDistanceKm} km off</span>
            </div>
            <div class="corridor-card-desc">${c.kmFromOrigin} km ahead • ${c.power_kw || (c.type === 'FAST' ? 3 : 1.5)} kW • ${compat.compatible ? '✅' : '⚠️'} ${esc(compat.reason)}</div>
            <div class="corridor-card-actions">
              <button type="button" class="btn-sm ${isAdded ? 'btn-remove-stop' : 'btn-add-stop'} btn-corridor-toggle ${isAdded ? 'is-added' : ''}">
                ${isAdded ? '❌ Remove Stop' : '➕ Add Stop'}
              </button>
              <button type="button" class="btn-sm btn-focus-corridor">📍 View on Map</button>
            </div>
          `;

          const stopBtn = card.querySelector(isAdded ? '.btn-remove-stop' : '.btn-add-stop');
          if (stopBtn) {
            stopBtn.addEventListener('click', () => {
              if (!window.RouteEngine) return;
              if (isAdded) window.RouteEngine.removeWaypoint(c.id);
              else window.RouteEngine.addWaypoint(c);
            });
          }

          const focusBtn = card.querySelector('.btn-focus-corridor');
          if (focusBtn) {
            focusBtn.addEventListener('click', () => {
              if (window.MapEngine) window.MapEngine.focusCharger(c);
            });
          }

          corridorChargersList.appendChild(card);
        });
      }
    }
  }

  const liveProgressBanner = document.getElementById('route-live-progress-banner');

  function updateForegroundLiveProgress(coords = null) {
    if (!liveProgressBanner) return;
    const active = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
    if (!active) {
      liveProgressBanner.style.display = 'none';
      liveProgressBanner.textContent = '';
      return;
    }

    const pt = coords || (window.MapEngine ? window.MapEngine.getUserCoords() : null);
    if (!pt || !window.MapEngine || !window.RouteEngine) {
      liveProgressBanner.style.display = 'block';
      liveProgressBanner.textContent = '📍 Active Route Kept Ready • Acquiring current GPS position...';
      return;
    }

    const slice = window.MapEngine.updateProgressAlongRoute(pt, 0.75);
    if (slice && slice.distanceFromRouteKm <= 0.75) {
      const coveredKm = Math.max(0, Math.round((active.distanceKm - slice.remainingKm) * 10) / 10);
      const durTxt = window.Utilities ? window.Utilities.formatMinutes(slice.remainingMins) : `${slice.remainingMins} min`;
      const etaTxt = new Date(Date.now() + slice.remainingMins * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      liveProgressBanner.style.display = 'block';
      liveProgressBanner.textContent = `📍 Live Position (${slice.progressPct}% done): ${coveredKm} km covered • ${slice.remainingKm} km left (${durTxt}, ETA ${etaTxt})`;
    } else if (window.RouteEngine.isSentToGoogleMaps && window.RouteEngine.isSentToGoogleMaps()) {
      liveProgressBanner.style.display = 'block';
      liveProgressBanner.textContent = `🗺️ Active Trip Restored (last sent to Google Maps) • ${Math.round((slice ? slice.distanceFromRouteKm : 0) * 10) / 10} km from route`;
    } else {
      liveProgressBanner.style.display = 'none';
    }
  }

  window.onForegroundGpsUpdate = (coords) => {
    updateForegroundLiveProgress(coords);
  };

  window.setPlannerOrigin = (pt) => {
    if (!pt) return;
    if (pt.name === 'Current Location (GPS)') {
      originCoords = null;
      if (originInput) originInput.value = 'Current Location (GPS)';
    } else {
      originCoords = { lat: pt.lat, lng: pt.lng, name: pt.name || 'Origin' };
      if (originInput) originInput.value = originCoords.name;
    }
  };

  let prevRenderedRouteId = null;
  if (window.RouteEngine) {
    window.RouteEngine.subscribe((payload) => {
      latestRoutePayload = payload;
      const route = payload.route;
      const routeKey = route ? `${route.id}_${route.distanceKm}_${(route.waypoints || []).length}` : null;
      const shouldFitBounds = Boolean(route && routeKey !== prevRenderedRouteId && !(window.DriveEngine && window.DriveEngine.isActive()));
      prevRenderedRouteId = routeKey;

      if (window.MapEngine) {
        window.MapEngine.renderRoute(route, payload.allRoutes, payload.selectedRouteIndex, shouldFitBounds);
        window.MapEngine.renderChargers();
      }
      renderRouteSummaryAndTimeline(payload);
      updateForegroundLiveProgress();
      if (window.DriveEngine && window.DriveEngine.isActive() && typeof window.DriveEngine.refreshActiveRoute === 'function') {
        window.DriveEngine.refreshActiveRoute(route);
      }
    });

    // Restore saved active trip across app close / removal from Recents
    const restored = window.RouteEngine.restoreSavedTrip();
    if (restored && restored.route) {
      if (restored.origin && originInput) {
        if (!restored.origin.name || restored.origin.name === 'Current Location' || restored.origin.name === 'Current Location (GPS)') {
          originCoords = null;
          originInput.value = 'Current Location (GPS)';
        } else {
          originCoords = { ...restored.origin };
          originInput.value = originCoords.name;
        }
      }
      if (restored.destination && destInput) {
        destCoords = { ...restored.destination };
        destInput.value = destCoords.name || '';
      }
      if (intermediateStopsList) {
        intermediateStopsList.innerHTML = '';
        (restored.waypoints || []).forEach(wp => {
          if (!wp.network && !wp.type) {
            addIntermediateStopRow(wp);
          }
        });
      }
      const rf = window.RouteEngine.getRouteFilters();
      routeFilterBtns.forEach(btn => {
        const k = btn.dataset.filter;
        if (k && Object.prototype.hasOwnProperty.call(rf, k)) {
          btn.classList.toggle('active', Boolean(rf[k]));
        }
      });
      const buf = window.RouteEngine.getCorridorBufferKm();
      if (typeof buf === 'number') {
        if (inputMapCorridor) inputMapCorridor.value = String(buf);
        if (inputDrawerCorridor) inputDrawerCorridor.value = String(buf);
      }
      if (window.MapEngine) {
        window.MapEngine.locateUser(false, true);
      }
    }
  }

  // ---------- 9. Emergency SOS Nearest Charger ----------
  const btnSosHeader = document.getElementById('btn-sos-header');
  const btnTriggerSos = document.getElementById('btn-trigger-sos');
  const sosResultsContainer = document.getElementById('sos-results-container');

  async function runSosScan() {
    if (!sosResultsContainer || !window.Utilities) return;
    sosResultsContainer.innerHTML = '<div class="empty-state">📡 Pinpointing closest verified 2W chargers...</div>';

    let coords = window.MapEngine ? window.MapEngine.getUserCoords() : null;
    if (!coords && window.MapEngine) {
      coords = await Promise.race([
        window.MapEngine.locateUser(false),
        new Promise(res => setTimeout(() => res(null), 2500))
      ]);
    }
    if (!coords && window.MapEngine && window.MapEngine.getMap()) {
      const center = window.MapEngine.getMap().getCenter();
      coords = { lat: center.lat, lng: center.lng };
      if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('⚠️ GPS unavailable — showing nearest chargers to map view.');
    }
    if (!coords) {
      sosResultsContainer.innerHTML = '<div class="empty-state">⚠️ Enable location permissions to locate nearest chargers.</div>';
      return;
    }

    const res = window.Utilities.findNearestChargers(coords);
    sosResultsContainer.innerHTML = '';

    const entries = [];
    if (res.absoluteClosest) entries.push({ label: '🚨 CLOSEST 2W CHARGER', charger: res.absoluteClosest });
    if (res.nearestFast && (!res.absoluteClosest || res.nearestFast.id !== res.absoluteClosest.id)) {
      entries.push({ label: '⚡ CLOSEST 2W FAST CHARGER', charger: res.nearestFast });
    }
    if (res.nearestSlow && (!res.absoluteClosest || res.nearestSlow.id !== res.absoluteClosest.id)) {
      entries.push({ label: '🔌 CLOSEST 15A PORTABLE SOCKET', charger: res.nearestSlow });
    }

    if (entries.length === 0) {
      sosResultsContainer.innerHTML = '<div class="empty-state">No verified 2W chargers found in loaded database.</div>';
      return;
    }

    entries.forEach(({ label, charger }, idx) => {
      const card = document.createElement('div');
      card.className = `sos-card${idx === 0 ? ' sos-primary' : ''}`;
      const compat = (window.BatteryEngine && window.BatteryEngine.isChargerCompatible)
        ? window.BatteryEngine.isChargerCompatible(charger)
        : { compatible: true, reason: 'Compatible' };

      card.innerHTML = `
        <div class="sos-card-header">
          <span class="sos-badge">${esc(label)}</span>
          <span class="sos-dist">${charger.distanceKm} km</span>
        </div>
        <div class="sos-title">${esc(charger.name)}</div>
        <div class="sos-details">${charger.power_kw || (charger.type === 'FAST' ? 3 : 1.5)} kW • ${compat.compatible ? '✅' : '⚠️'} ${esc(compat.reason)}</div>
        <div class="sos-address">${esc(charger.address || `${charger.lat.toFixed(4)}, ${charger.lng.toFixed(4)}`)}</div>
        <div class="sos-actions">
          <button type="button" class="btn-sos-nav btn-sos-inapp">⚡ Route Here</button>
          <button type="button" class="btn-sos-nav btn-sos-focus">📍 Focus</button>
          <button type="button" class="btn-sos-nav btn-sos-gmaps">🗺️ Maps</button>
        </div>
      `;

      card.querySelector('.btn-sos-inapp').addEventListener('click', () => {
        if (window.MapEngine) window.MapEngine.handleRouteDirectToCharger(charger.id);
      });
      card.querySelector('.btn-sos-focus').addEventListener('click', () => {
        if (window.MapEngine) window.MapEngine.focusCharger(charger);
      });
      card.querySelector('.btn-sos-gmaps').addEventListener('click', () => {
        if (window.NavigationEngine) window.NavigationEngine.navigateToNextCharger(charger, coords);
      });

      sosResultsContainer.appendChild(card);
    });
  }

  if (btnSosHeader) {
    btnSosHeader.addEventListener('click', () => {
      activateTab('sos', true);
      runSosScan();
    });
  }
  if (btnTriggerSos) {
    btnTriggerSos.addEventListener('click', runSosScan);
  }

  // ---------- 10. Sync Modal & PWA Install ----------
  const syncModal = document.getElementById('sync-modal');
  const btnOpenSync = document.getElementById('btn-open-sync');
  const btnCloseSync = document.getElementById('btn-close-sync');
  const btnRunSync = document.getElementById('btn-run-sync');
  const syncProgressBar = document.getElementById('sync-progress-bar');
  const syncProgressText = document.getElementById('sync-progress-text');

  if (btnOpenSync && syncModal) {
    btnOpenSync.addEventListener('click', () => {
      updateStationCountsUI();
      updateConnectivityUi();
      syncModal.classList.add('open');
    });
  }
  if (btnCloseSync && syncModal) {
    btnCloseSync.addEventListener('click', () => syncModal.classList.remove('open'));
  }
  if (syncModal) {
    syncModal.addEventListener('click', (e) => {
      if (e.target === syncModal) syncModal.classList.remove('open');
    });
  }
  if (btnRunSync) {
    btnRunSync.addEventListener('click', async () => {
      if (!window.SyncEngine) return;
      const origLabel = btnRunSync.innerHTML;
      btnRunSync.disabled = true;
      btnRunSync.textContent = '⏳ Syncing 2W Networks...';
      try {
        await window.SyncEngine.performFullSync(({ status, percent }) => {
          if (syncProgressBar) syncProgressBar.style.width = `${percent || 0}%`;
          if (syncProgressText) syncProgressText.textContent = status || '';
        });
      } finally {
        btnRunSync.disabled = false;
        btnRunSync.innerHTML = origLabel;
        updateStationCountsUI();
      }
    });
  }

  let deferredInstallPrompt = null;
  const btnInstallApp = document.getElementById('btn-install-app');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallApp) btnInstallApp.style.display = 'inline-flex';
  });
  if (btnInstallApp) {
    btnInstallApp.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch (e) {}
      deferredInstallPrompt = null;
      btnInstallApp.style.display = 'none';
    });
  }

  // ---------- 11. In-App Turn-by-Turn DriveEngine ----------
  const hudWrapper = document.getElementById('nav-driving-hud-wrapper');
  const hudTurnIcon = document.getElementById('hud-turn-icon');
  const hudDistVal = document.getElementById('hud-distance-val');
  const hudBatPill = document.getElementById('hud-battery-pill');
  const hudStreetName = document.getElementById('hud-street-name');
  const hudTowardDest = document.getElementById('hud-toward-dest');
  const hudSubStep = document.getElementById('hud-subsequent-step');
  const hudSubTurnIcon = document.getElementById('hud-sub-turn-icon');
  const hudSubText = document.getElementById('hud-sub-text');
  const hudNextChargerBadge = document.getElementById('hud-next-charger-badge');
  const hudNextChargerName = document.getElementById('hud-next-charger-name');
  const hudNextChargerDist = document.getElementById('hud-next-charger-dist');
  const navSpeedometer = document.getElementById('nav-speedometer');
  const navSpeedVal = document.getElementById('nav-speed-val');
  const navRoadPill = document.getElementById('nav-road-pill');
  const navRoadPillText = document.getElementById('nav-road-pill-text');
  const navBottomBar = document.getElementById('nav-bottom-bar');
  const navStatTime = document.getElementById('nav-stat-time');
  const navStatDist = document.getElementById('nav-stat-dist');
  const navStatEta = document.getElementById('nav-stat-eta');
  const btnExitDrive = document.getElementById('btn-exit-drive-mode');
  const btnNavCompass = document.getElementById('btn-nav-compass');
  const btnNavOverview = document.getElementById('btn-nav-routes-toggle');

  const DriveEngine = (function () {
    let active = false;
    let steps = [];
    let currentStepIdx = 0;
    let arrivedAnnounced = false;
    let offRouteCount = 0;
    let lastRerouteTime = 0;
    let isRerouting = false;
    let wakeLockSentinel = null;
    let gpsWatchdogTimer = null;
    let overviewMode = false;

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && !wakeLockSentinel) {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    }

    function releaseWakeLock() {
      try {
        if (wakeLockSentinel) {
          wakeLockSentinel.release().catch(() => {});
          wakeLockSentinel = null;
        }
      } catch (e) {}
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && active) {
        requestWakeLock();
      }
    });

    function shortPlaceName(raw, fallback = 'Destination') {
      if (!raw || typeof raw !== 'string') return fallback;
      const clean = raw.replace(/\s+/g, ' ').trim();
      if (!clean) return fallback;
      const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return fallback;
      let head = (/^\d+[A-Za-z-]*$/.test(parts[0]) && parts[1]) ? `${parts[0]}, ${parts[1]}` : parts[0];
      const stripped = head.replace(/\s+(?:EV\s+)?(?:Fast\s+)?Charging\s+Station$/i, '').trim();
      if (stripped.length >= 3) head = stripped;
      return head;
    }

    function cleanRoadLabel(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const trimmed = raw.replace(/\s+/g, ' ').trim();
      if (!trimmed || /^unnamed/i.test(trimmed) || /^(road|ramp|street)$/i.test(trimmed)) return '';
      return trimmed.replace(/\b(NH|SH|AH)(\d+)/gi, (_, pfx, num) => `${pfx.toUpperCase()} ${num}`);
    }

    function extractTowardHint(instruction) {
      if (!instruction || typeof instruction !== 'string') return '';
      const m = instruction.match(/\btoward\s+([^.;]+)/i);
      return m && m[1] ? cleanRoadLabel(m[1]) || m[1].trim() : '';
    }

    function getManeuverArrowSvg(iconKey, size = 44) {
      const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
      switch (iconKey) {
        case 'left':
          return `<svg ${common}><path d="M16 20V11a3 3 0 0 0-3-3H5"/><polyline points="9 4 5 8 9 12"/></svg>`;
        case 'right':
          return `<svg ${common}><path d="M8 20V11a3 3 0 0 1 3-3h8"/><polyline points="15 4 19 8 15 12"/></svg>`;
        case 'slight_left':
          return `<svg ${common}><path d="M15 20v-5.5a3 3 0 0 0-.88-2.12L6.5 4.8"/><polyline points="6 11 6 4.5 12.5 4.5"/></svg>`;
        case 'slight_right':
          return `<svg ${common}><path d="M9 20v-5.5a3 3 0 0 1 .88-2.12L17.5 4.8"/><polyline points="11.5 4.5 18 4.5 18 11"/></svg>`;
        case 'sharp_left':
          return `<svg ${common}><path d="M17 20V7.5L6.5 17"/><polyline points="6 11 6 17.5 12.5 17.5"/></svg>`;
        case 'sharp_right':
          return `<svg ${common}><path d="M7 20V7.5L17.5 17"/><polyline points="11.5 17.5 18 17.5 18 11"/></svg>`;
        case 'uturn':
          return `<svg ${common}><path d="M17 20V10a5 5 0 0 0-10 0v9"/><polyline points="3.5 15.5 7 19.5 10.5 15.5"/></svg>`;
        case 'roundabout':
          return `<svg ${common}><circle cx="12" cy="11" r="4"/><path d="M12 15v5"/><path d="M12 7V3"/><polyline points="9 5.5 12 2.5 15 5.5"/></svg>`;
        case 'arrive':
          return `<svg ${common}><path d="M5 21V4"/><path d="M5 4h11l-2.5 4L16 12H5" fill="currentColor" fill-opacity="0.22"/></svg>`;
        case 'straight':
        default:
          return `<svg ${common}><line x1="12" y1="20" x2="12" y2="4"/><polyline points="6.5 9.5 12 4 17.5 9.5"/></svg>`;
      }
    }

    function mapManeuver(step, nextNamedRoad = '', legTarget = '', isStopLeg = false) {
      const m = step.maneuver || {};
      const type = (m.type || 'continue').toLowerCase();
      const mod = (m.modifier || '').toLowerCase();
      const directRoad = cleanRoadLabel(step.name) || cleanRoadLabel(step.ref) || cleanRoadLabel(step.signBranch);
      const signToward = cleanRoadLabel(step.signToward) || cleanRoadLabel(step.destinations) || extractTowardHint(step.instruction);
      const aheadRoad = cleanRoadLabel(nextNamedRoad);

      let routeHeadline = directRoad;
      if (!routeHeadline && signToward) {
        routeHeadline = `Towards ${signToward}`;
      } else if (!routeHeadline && aheadRoad) {
        routeHeadline = `Towards ${aheadRoad}`;
      }

      const towardTarget = (signToward && (!routeHeadline || !routeHeadline.toLowerCase().includes(signToward.toLowerCase())))
        ? signToward
        : (legTarget || '');

      if (type === 'arrive') {
        const place = legTarget || 'Destination';
        return {
          iconKey: 'arrive',
          icon: '🏁',
          headline: place,
          action: isStopLeg ? `Arrive at ${place}` : `Towards ${place} • Arrive`,
          text: `Arrive at ${place}`,
          shortSub: `Arrive at ${place}`,
          speech: `You have arrived at ${place}.`
        };
      }

      if (type === 'roundabout' || type === 'rotary') {
        const ex = m.exit ? `Take ${m.exit}${Number(m.exit) === 1 ? 'st' : (Number(m.exit) === 2 ? 'nd' : (Number(m.exit) === 3 ? 'rd' : 'th'))} exit` : 'Exit roundabout';
        const roadOut = routeHeadline || (isStopLeg ? 'Charging stop road' : 'Roundabout exit');
        const roundToward = towardTarget && !roadOut.toLowerCase().includes(towardTarget.toLowerCase()) ? ` • Towards ${towardTarget}` : '';
        return {
          iconKey: 'roundabout',
          icon: '⟲',
          headline: roadOut,
          action: `${ex}${roundToward}`,
          text: `${ex}${directRoad ? ` onto ${directRoad}` : ''}`,
          shortSub: directRoad ? `${ex} → ${directRoad}` : ex,
          speech: `At the roundabout, ${ex}${directRoad ? ` onto ${directRoad}` : ''}`
        };
      }

      let iconKey = 'straight';
      let icon = '⬆';
      let actionLabel = 'Continue';
      if (type === 'depart') {
        iconKey = mod.includes('left') ? 'slight_left' : (mod.includes('right') ? 'slight_right' : 'straight');
        icon = '⬆';
        actionLabel = 'Head straight';
      } else if (mod.includes('sharp left')) {
        iconKey = 'sharp_left'; icon = '↙'; actionLabel = 'Sharp left';
      } else if (mod.includes('slight left')) {
        iconKey = 'slight_left'; icon = '↖'; actionLabel = type === 'fork' ? 'Keep left' : 'Slight left';
      } else if (mod.includes('left')) {
        iconKey = 'left'; icon = '↰'; actionLabel = 'Turn left';
      } else if (mod.includes('sharp right')) {
        iconKey = 'sharp_right'; icon = '↘'; actionLabel = 'Sharp right';
      } else if (mod.includes('slight right')) {
        iconKey = 'slight_right'; icon = '↗'; actionLabel = type === 'fork' ? 'Keep right' : 'Slight right';
      } else if (mod.includes('right')) {
        iconKey = 'right'; icon = '↱'; actionLabel = 'Turn right';
      } else if (mod.includes('uturn')) {
        iconKey = 'uturn'; icon = '↺'; actionLabel = 'Make U-turn';
      } else if (type === 'merge') {
        iconKey = 'straight'; icon = '⬆'; actionLabel = 'Merge onto';
      } else if (type === 'fork') {
        iconKey = 'straight'; icon = '⬆'; actionLabel = 'Stay on route';
      }

      const headline = routeHeadline || (type === 'depart' ? 'Starting road' : actionLabel);
      const showTowardSuffix = towardTarget && !headline.toLowerCase().includes(`towards ${towardTarget.toLowerCase()}`);
      const actionDisplay = showTowardSuffix
        ? `${actionLabel} • Towards ${towardTarget}`
        : (routeHeadline ? actionLabel : 'Follow route');
      const shortSub = directRoad
        ? `${actionLabel} • ${directRoad}`
        : (aheadRoad ? `${actionLabel} → ${aheadRoad}` : actionLabel);

      return {
        iconKey,
        icon,
        headline,
        action: actionDisplay,
        text: directRoad ? `${actionLabel} onto ${directRoad}` : shortSub,
        shortSub,
        speech: directRoad ? `${actionLabel} onto ${directRoad}` : actionLabel
      };
    }

    function extractSteps(route) {
      const out = [];
      if (!route || !route.legs) return out;
      const destName = shortPlaceName(route.destination && route.destination.name, 'Destination');
      const waypoints = Array.isArray(route.waypoints) ? route.waypoints : [];

      route.legs.forEach((leg, legIdx) => {
        const isStopLeg = legIdx < waypoints.length;
        const legTarget = isStopLeg
          ? shortPlaceName(waypoints[legIdx].name, 'Charging Stop')
          : destName;
        const legSteps = Array.isArray(leg.steps) ? leg.steps : [];

        legSteps.forEach((st, stIdx) => {
          const loc = st.maneuver && st.maneuver.location;
          if (!loc || loc.length < 2) return;
          let nextNamedRoad = '';
          let lookDist = 0;
          for (let k = stIdx + 1; k < legSteps.length && k <= stIdx + 3; k++) {
            const cand = cleanRoadLabel(legSteps[k].name) || cleanRoadLabel(legSteps[k].ref) || cleanRoadLabel(legSteps[k].signBranch);
            if (cand) {
              nextNamedRoad = cand;
              break;
            }
            lookDist += legSteps[k].distance || 0;
            if (lookDist > 1800) break;
          }
          const mapped = mapManeuver(st, nextNamedRoad, legTarget, isStopLeg);
          out.push({
            lat: loc[1],
            lng: loc[0],
            name: cleanRoadLabel(st.name) || mapped.headline || 'Route',
            distanceM: st.distance || 0,
            legTarget,
            destName,
            isStopLeg,
            iconKey: mapped.iconKey,
            icon: mapped.icon,
            headline: mapped.headline,
            action: mapped.action,
            text: mapped.text,
            shortSub: mapped.shortSub,
            speech: mapped.speech,
            isArrive: Boolean(st.maneuver && st.maneuver.type === 'arrive')
          });
        });
      });
      return out;
    }

    function refreshHudBattery(remainingKm = null, nextChargerKm = null) {
      if (!hudBatPill || !window.BatteryEngine) return;
      const bs = window.BatteryEngine.getState();
      const route = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
      const eff = bs.efficiency > 0 ? bs.efficiency : 0.85;

      let estArr;
      let suffix = '';
      if (nextChargerKm != null) {
        estArr = Math.round((bs.currentBatteryPct - nextChargerKm / eff) * 10) / 10;
        suffix = ' stop';
      } else if (route && route.waypoints && route.waypoints.some(w => w.network || w.type) && window.RouteEngine) {
        const tl = window.RouteEngine.calculateTripTimeline(route, bs);
        estArr = tl ? tl.finalArrivalSoC : Math.round((bs.currentBatteryPct - (remainingKm ?? route.distanceKm) / eff) * 10) / 10;
        suffix = ' final';
      } else {
        const distKm = remainingKm != null ? remainingKm : (route ? route.distanceKm : 0);
        estArr = Math.round((bs.currentBatteryPct - distKm / eff) * 10) / 10;
      }

      hudBatPill.textContent = `🔋 ~${estArr}%${suffix}`;
      hudBatPill.style.color = estArr < 0 ? '#fca5a5' : (estArr < bs.safetyReservePct ? '#fde047' : '#86efac');
    }

    function formatHudDist(meters) {
      if (meters < 1000) {
        const rounded = meters >= 100 ? Math.round(meters / 10) * 10 : Math.round(meters);
        return `${rounded} m`;
      }
      return `${(meters / 1000).toFixed(1)} km`;
    }

    function formatEtaClock(mins) {
      const arr = new Date(Date.now() + Math.max(1, mins) * 60000);
      return arr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function renderStepHud(targetStep, nextAfter, distToStepM) {
      if (!targetStep) return;
      if (hudDistVal) {
        hudDistVal.textContent = (typeof distToStepM === 'number' && Number.isFinite(distToStepM))
          ? formatHudDist(distToStepM)
          : 'Now';
      }
      if (hudTurnIcon) {
        hudTurnIcon.innerHTML = getManeuverArrowSvg(targetStep.iconKey || 'straight', 44);
      }
      if (hudStreetName) {
        const headlineTxt = targetStep.headline || targetStep.text || 'Follow route';
        hudStreetName.textContent = headlineTxt;
        hudStreetName.style.fontSize = headlineTxt.length > 28 ? '0.86rem' : '';
      }
      if (hudTowardDest) {
        const towardTxt = targetStep.action || targetStep.shortSub || 'Follow route';
        hudTowardDest.textContent = towardTxt;
        hudTowardDest.style.fontSize = towardTxt.length > 34 ? '0.64rem' : '';
      }
      if (navRoadPillText && targetStep.name) navRoadPillText.textContent = targetStep.name;

      if (hudSubStep && hudSubTurnIcon) {
        if (nextAfter) {
          hudSubStep.style.display = 'inline-flex';
          hudSubTurnIcon.innerHTML = getManeuverArrowSvg(nextAfter.iconKey || 'straight', 16);
          if (hudSubText) {
            hudSubText.textContent = nextAfter.shortSub || nextAfter.headline || 'Next turn';
          }
        } else {
          hudSubStep.style.display = 'none';
          if (hudSubText) hudSubText.textContent = '';
        }
      }
    }

    function updateStepBanner(routeOverride = null) {
      if (steps.length === 0) return null;
      const route = routeOverride || (window.RouteEngine ? window.RouteEngine.getActiveRoute() : null);
      const lookIdx = steps.length > 1 ? Math.min(currentStepIdx + 1, steps.length - 1) : 0;
      const targetStep = steps[lookIdx];
      const nextAfter = steps[lookIdx + 1] || null;

      let refPos = route && route.origin ? route.origin : steps[0];
      const gps = window.MapEngine ? window.MapEngine.getUserCoords() : null;
      if (gps && window.Utilities) {
        const dFromOriginKm = refPos ? window.Utilities.haversine(gps.lat, gps.lng, refPos.lat, refPos.lng) : 0;
        if (!refPos || dFromOriginKm <= 1.5) refPos = gps;
      }

      const distToStepM = (refPos && window.Utilities)
        ? window.Utilities.haversine(refPos.lat, refPos.lng, targetStep.lat, targetStep.lng) * 1000
        : (steps[0].distanceM || 0);

      renderStepHud(targetStep, nextAfter, distToStepM);
      return { lookIdx, targetStep, nextAfter, distToStepM };
    }

    async function handleOffRoute(coords, route, slice) {
      if (isRerouting || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastRerouteTime < 12000) return;

      isRerouting = true;
      lastRerouteTime = now;
      if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🔄 Rerouting...');

      try {
        // Compute current traversed km along active route so we drop already-passed stops
        const traversedKm = slice && typeof slice.remainingKm === 'number'
          ? Math.max(0, route.distanceKm - slice.remainingKm)
          : 0;
        const upcomingWaypoints = (route.waypoints || []).filter(w =>
          typeof w.kmFromOrigin !== 'number' || w.kmFromOrigin > traversedKm + 0.25
        );

        await window.RouteEngine.calculateRoute(
          { lat: coords.lat, lng: coords.lng, name: 'Current Location' },
          route.destination,
          upcomingWaypoints,
          true
        );

        const refreshed = window.RouteEngine.getActiveRoute();
        if (refreshed) {
          steps = extractSteps(refreshed);
          currentStepIdx = 0;
          arrivedAnnounced = false;
          updateStepBanner(refreshed);
        }
      } catch (e) {} finally {
        isRerouting = false;
      }
    }

    function start() {
      const route = window.RouteEngine ? window.RouteEngine.getActiveRoute() : null;
      if (!route || !route.coordinates || route.coordinates.length < 2) {
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('⚠️ Plan a route first before starting navigation.');
        return;
      }

      active = true;
      overviewMode = false;
      offRouteCount = 0;
      steps = extractSteps(route);
      currentStepIdx = 0;
      arrivedAnnounced = false;

      document.body.classList.remove('manual-fullscreen');
      document.body.classList.add('nav-active');
      setDrawerCollapsed(true);

      if (btnFloatingStartNav) btnFloatingStartNav.style.display = 'none';
      if (hudWrapper) hudWrapper.style.display = 'flex';
      if (navSpeedometer) navSpeedometer.style.display = 'flex';
      if (navRoadPill) navRoadPill.style.display = 'none';
      if (navBottomBar) navBottomBar.style.display = 'flex';
      if (btnNavCompass) btnNavCompass.style.display = 'flex';

      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (e) {}

      updateStepBanner(route);
      refreshHudBattery(route.distanceKm);

      if (navStatDist) navStatDist.textContent = `${route.distanceKm} km`;
      if (navStatTime) navStatTime.textContent = window.Utilities ? window.Utilities.formatMinutes(route.durationMins) : `${route.durationMins} min`;
      if (navStatEta) navStatEta.textContent = formatEtaClock(route.durationMins);

      requestWakeLock();

      if (gpsWatchdogTimer) clearInterval(gpsWatchdogTimer);
      gpsWatchdogTimer = setInterval(() => {
        if (!active || !window.MapEngine) return;
        const ageMs = window.MapEngine.getLastGpsFixAgeMs();
        if (ageMs > 15000 && hudStreetName) {
          hudStreetName.textContent = '📡 Searching GPS signal...';
        }
      }, 3000);

      if (window.MapEngine) {
        if (window.MapEngine.getMap()) {
          setTimeout(() => window.MapEngine.getMap().invalidateSize(), 120);
        }
        window.MapEngine.startLiveTracking(true);
        window.MapEngine.recenterCamera(17.5);
      }
    }

    function stop() {
      if (!active) return;
      active = false;
      overviewMode = false;

      if (gpsWatchdogTimer) {
        clearInterval(gpsWatchdogTimer);
        gpsWatchdogTimer = null;
      }
      releaseWakeLock();

      document.body.classList.remove('nav-active', 'manual-fullscreen');
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (e) {}

      if (hudWrapper) hudWrapper.style.display = 'none';
      if (navSpeedometer) navSpeedometer.style.display = 'none';
      if (navRoadPill) navRoadPill.style.display = 'none';
      if (navBottomBar) navBottomBar.style.display = 'none';
      if (btnNavCompass) btnNavCompass.style.display = 'none';
      if (btnFloatingStartNav && window.RouteEngine && window.RouteEngine.getActiveRoute()) {
        btnFloatingStartNav.style.display = 'flex';
      }

      if (window.MapEngine) {
        if (window.MapEngine.getMap()) {
          setTimeout(() => window.MapEngine.getMap().invalidateSize(), 120);
        }
        window.MapEngine.setBearing(0);
        window.MapEngine.recenterCamera(15);
      }
      setDrawerCollapsed(false);
    }

    function onLocationUpdate(coords) {
      if (!active || !coords || !window.RouteEngine || !window.Utilities) return;
      const route = window.RouteEngine.getActiveRoute();
      if (!route) return;

      const slice = window.MapEngine ? window.MapEngine.updateProgressAlongRoute(coords) : null;
      const speedKmh = coords.speed != null && coords.speed >= 0 ? Math.round(coords.speed * 3.6) : 0;
      if (navSpeedVal) navSpeedVal.textContent = String(speedKmh);

      if (slice) {
        if (navStatDist) navStatDist.textContent = `${slice.remainingKm} km`;
        if (navStatTime) navStatTime.textContent = window.Utilities.formatMinutes(slice.remainingMins);
        if (navStatEta) navStatEta.textContent = formatEtaClock(slice.remainingMins);
        refreshHudBattery(slice.remainingKm);

        if (slice.distanceFromRouteKm > 0.080) {
          offRouteCount++;
          if (offRouteCount >= 2) {
            offRouteCount = 0;
            handleOffRoute(coords, route, slice);
            return;
          }
        } else {
          offRouteCount = 0;
        }
      }

      // Upcoming charging stop distance badge & HUD battery prediction
      const chargerStops = (route.waypoints || []).filter(w => w.network || w.type);
      let nextChargerDistKm = null;
      if (hudNextChargerBadge && hudNextChargerName && hudNextChargerDist && chargerStops.length > 0) {
        let nearestUpcoming = null;
        let minD = Infinity;
        chargerStops.forEach(wp => {
          const d = window.Utilities.haversine(coords.lat, coords.lng, wp.lat, wp.lng);
          if (d < minD) {
            minD = d;
            nearestUpcoming = wp;
          }
        });
        if (nearestUpcoming) {
          nextChargerDistKm = Math.round(minD * 10) / 10;
          const stopTitle = shortPlaceName(nearestUpcoming.name, 'Charging Stop');
          hudNextChargerBadge.style.display = 'inline-block';
          hudNextChargerBadge.title = `Next Stop: ${stopTitle} (${nextChargerDistKm} km)`;
          hudNextChargerName.textContent = stopTitle;
          hudNextChargerDist.textContent = `${nextChargerDistKm} km`;
        }
      } else if (hudNextChargerBadge) {
        hudNextChargerBadge.style.display = 'none';
      }

      if (slice) {
        refreshHudBattery(slice.remainingKm, nextChargerDistKm);
      }

      // Direct arrival check at final destination regardless of intermediate skipped step
      const destDistM = route.destination
        ? window.Utilities.haversine(coords.lat, coords.lng, route.destination.lat, route.destination.lng) * 1000
        : Infinity;

      if (destDistM <= 50 && !arrivedAnnounced) {
        arrivedAnnounced = true;
        currentStepIdx = Math.max(0, steps.length - 1);
        const finalPlace = (steps[currentStepIdx] && steps[currentStepIdx].destName) || shortPlaceName(route.destination && route.destination.name, 'destination');
        if (hudDistVal) hudDistVal.textContent = '0 m';
        if (hudTurnIcon) hudTurnIcon.innerHTML = getManeuverArrowSvg('arrive', 44);
        if (hudStreetName) hudStreetName.textContent = finalPlace;
        if (hudTowardDest) hudTowardDest.textContent = 'Arrived at destination';
        if (hudSubStep) hudSubStep.style.display = 'none';
        if (hudSubText) hudSubText.textContent = '';
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🏁 You have arrived!');
        return;
      }

      // Maneuver progression (resilient to skipped intermediate steps)
      if (steps.length > 0) {
        for (let j = steps.length - 1; j > currentStepIdx; j--) {
          const jd = window.Utilities.haversine(coords.lat, coords.lng, steps[j].lat, steps[j].lng) * 1000;
          if (jd <= 45) {
            currentStepIdx = j;
            break;
          }
        }

        const lookIdx = Math.min(currentStepIdx + 1, steps.length - 1);
        const targetStep = steps[lookIdx];
        const nextAfter = steps[lookIdx + 1] || null;
        const distToStepM = window.Utilities.haversine(coords.lat, coords.lng, targetStep.lat, targetStep.lng) * 1000;

        renderStepHud(targetStep, nextAfter, distToStepM);

        if (targetStep.isArrive && distToStepM <= 50 && !arrivedAnnounced) {
          arrivedAnnounced = true;
          if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🏁 You have arrived!');
        } else if (distToStepM <= 35 && currentStepIdx < steps.length - 1) {
          currentStepIdx = lookIdx;
        }
      }
    }

    function refreshActiveRoute(routeOverride = null) {
      if (!active) return;
      const rt = routeOverride || (window.RouteEngine ? window.RouteEngine.getActiveRoute() : null);
      if (!rt) return;
      steps = extractSteps(rt);
      currentStepIdx = 0;
      arrivedAnnounced = false;
      updateStepBanner(rt);
      refreshHudBattery(rt.distanceKm);
      if (navStatDist) navStatDist.textContent = `${rt.distanceKm} km`;
      if (navStatTime) navStatTime.textContent = window.Utilities ? window.Utilities.formatMinutes(rt.durationMins) : `${rt.durationMins} min`;
      if (navStatEta) navStatEta.textContent = formatEtaClock(rt.durationMins);
    }

    return {
      isActive: () => active,
      start,
      stop,
      onLocationUpdate,
      refreshHudBattery,
      refreshActiveRoute,
      toggleOverview: () => {
        if (!window.MapEngine || !window.RouteEngine) return;
        const route = window.RouteEngine.getActiveRoute();
        const map = window.MapEngine.getMap();
        if (!route || !map) return;
        overviewMode = !overviewMode;
        if (overviewMode) {
          window.MapEngine.setAutoFollow(false);
          window.MapEngine.setBearing(0);
          map.fitBounds(route.coordinates, { padding: [70, 70] });
        } else {
          window.MapEngine.recenterCamera(17.5);
        }
      },
      resetOverviewMode: () => {
        overviewMode = false;
      }
    };
  })();

  window.DriveEngine = DriveEngine;
  window._voltwayResetOverviewMode = () => DriveEngine.resetOverviewMode();

  if (btnFloatingStartNav) btnFloatingStartNav.addEventListener('click', () => DriveEngine.start());
  if (btnStartInAppNav) btnStartInAppNav.addEventListener('click', () => DriveEngine.start());
  if (btnExitDrive) btnExitDrive.addEventListener('click', () => DriveEngine.stop());
  if (btnNavCompass) {
    btnNavCompass.addEventListener('click', () => {
      if (window.MapEngine) {
        window.MapEngine.setNavCompassMode(!window.MapEngine.getNavCompassMode());
      }
    });
  }
  if (btnNavOverview) {
    btnNavOverview.addEventListener('click', () => DriveEngine.toggleOverview());
  }

  // ---------- 12. Android Hardware Back Button Support ----------
  function handleHardwareBack(e, canGoBack = false) {
    if (DriveEngine.isActive()) {
      if (e && e.preventDefault) e.preventDefault();
      DriveEngine.stop();
      return;
    }
    if (syncModal && syncModal.classList.contains('open')) {
      if (e && e.preventDefault) e.preventDefault();
      syncModal.classList.remove('open');
      return;
    }
    if (window.MapEngine && window.MapEngine.isPopupOpen && window.MapEngine.isPopupOpen()) {
      if (e && e.preventDefault) e.preventDefault();
      const map = window.MapEngine.getMap();
      if (map) map.closePopup();
      return;
    }
    if (bottomSheet && !bottomSheet.classList.contains('collapsed')) {
      if (e && e.preventDefault) e.preventDefault();
      setDrawerCollapsed(true);
      return;
    }
    if (canGoBack) {
      window.history.back();
    } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && typeof window.Capacitor.Plugins.App.exitApp === 'function') {
      window.Capacitor.Plugins.App.exitApp();
    }
  }

  // ---------- 13. Google Maps Share-Target & Native Android Intent Handler ----------
  let _lastSharePayload = '';
  let _lastShareTs = 0;

  async function handleVoltwayIncomingShare(rawShareText) {
    const cleaned = String(rawShareText || '').trim();
    if (!cleaned || !window.Utilities) return false;
    const now = Date.now();
    if (cleaned === _lastSharePayload && now - _lastShareTs < 2000) {
      return true;
    }
    _lastSharePayload = cleaned;
    _lastShareTs = now;

    activateTab('route', true);
    if (destInput) {
      destInput.value = cleaned;
      destCoords = null;
      try { destInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }
    if (window.SyncEngine) {
      window.SyncEngine.showAutoUpdateToast('📍 Reading shared Google Maps location...');
    }

    let expandedHint = null;
    if (cleaned.includes('/maps/dir/') || /goo\.gl|maps\.app|g\.co\/maps/i.test(cleaned)) {
      const dirRes = await tryImportGoogleDirectionsUrl(cleaned);
      expandedHint = dirRes.expanded;
      if (dirRes.imported) {
        if (window.SyncEngine) window.SyncEngine.showAutoUpdateToast('🗺️ Imported shared Google Maps route!');
        return true;
      }
    }

    const resolved = await window.Utilities.resolveLocationInput(cleaned, expandedHint);
    if (resolved && typeof resolved.lat === 'number' && typeof resolved.lng === 'number') {
      destCoords = { lat: resolved.lat, lng: resolved.lng, name: resolved.name || 'Shared Location' };
      if (destInput) destInput.value = destCoords.name;
      if (window.MapEngine && window.MapEngine.getMap()) {
        const m = window.MapEngine.getMap();
        m.flyTo([destCoords.lat, destCoords.lng], 15, { animate: true, duration: 0.6 });
      }
      if (window.SyncEngine) {
        window.SyncEngine.showAutoUpdateToast(`🏁 Destination set: ${destCoords.name} (Tap Plan 2W Route)`);
      }
      return true;
    }

    if (window.SyncEngine) {
      window.SyncEngine.showAutoUpdateToast('⚠️ Could not read shared pin — check internet or paste coordinates');
    }
    return false;
  }

  window.handleVoltwayIncomingShare = handleVoltwayIncomingShare;
  window.checkIncomingNativeShare = async function () {
    try {
      const nativePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoltWayNative;
      if (nativePlugin && typeof nativePlugin.consumePendingShare === 'function') {
        const res = await nativePlugin.consumePendingShare();
        if (res && res.text && res.text.trim()) {
          handleVoltwayIncomingShare(res.text.trim());
          return true;
        }
      }
    } catch (e) {}
    return false;
  };

  // Web PWA share_target (?text=...&url=...&title=...) & shortcut (?tab=..., ?action=sos)
  (function handleUrlLaunchParams() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const sharedParts = [params.get('title'), params.get('text'), params.get('url')]
        .map(v => (v ? String(v).trim() : ''))
        .filter(Boolean);
      const uniqueParts = Array.from(new Set(sharedParts));
      const action = params.get('action');
      const tab = params.get('tab');

      if (uniqueParts.length > 0 || action || tab) {
        try {
          window.history.replaceState({}, document.title, window.location.pathname || './');
        } catch (e) {}
      }

      if (uniqueParts.length > 0) {
        const payload = uniqueParts.join('\n');
        setTimeout(() => handleVoltwayIncomingShare(payload), 150);
      } else if (action === 'sos') {
        setTimeout(() => {
          activateTab('sos', true);
          runSosScan();
        }, 150);
      } else if (tab && ['route', 'battery', 'calculator', 'sos'].includes(tab)) {
        setTimeout(() => activateTab(tab, true), 120);
      }
    } catch (e) {}
  })();

  window.checkIncomingNativeShare();

  const voltwayNative = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoltWayNative;
  if (voltwayNative && typeof voltwayNative.addListener === 'function') {
    voltwayNative.addListener('shareReceived', (data) => {
      if (data && data.text && data.text.trim()) {
        // Consume pending buffer too so a resume check doesn't re-read the same intent
        if (typeof voltwayNative.consumePendingShare === 'function') {
          voltwayNative.consumePendingShare().catch(() => {});
        }
        handleVoltwayIncomingShare(data.text.trim());
      }
    });
  }

  document.addEventListener('backbutton', (e) => handleHardwareBack(e, false), false);
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && typeof window.Capacitor.Plugins.App.addListener === 'function') {
    window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
      handleHardwareBack(null, canGoBack);
    });
    window.Capacitor.Plugins.App.addListener('appUrlOpen', ({ url }) => {
      if (url && /^geo:|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url)) {
        handleVoltwayIncomingShare(url);
      }
    });
    window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        window.checkIncomingNativeShare();
        if (window.MapEngine) window.MapEngine.locateUser(false, true);
      }
    });
  }
});

/**
 * VoltWay 2W - Battery Consumption, Compatibility & Range Engine
 * Tailored specifically for 2-wheeler EVs (Ather, Hero VIDA, Ola, TVS, Bajaj)
 */

const BatteryEngine = (function () {
  const VEHICLE_PRESETS = {
    'ather-450x-37': {
      name: 'Ather 450X (3.7 kWh)',
      brand: 'Ather',
      connectorType: 'TYPE7',
      modes: { ECO: 1.10, RIDE: 0.85, SPORT: 0.70, WARP: 0.60 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.7,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    },
    'ather-450x-29': {
      name: 'Ather 450X (2.9 kWh)',
      brand: 'Ather',
      connectorType: 'TYPE7',
      modes: { ECO: 0.90, RIDE: 0.75, SPORT: 0.60, WARP: 0.50 },
      defaultMode: 'RIDE',
      batteryCapacity: 2.9,
      acChargerKw: 0.70,
      dcFastMaxKw: 3.0
    },
    'ather-rizta-37': {
      name: 'Ather Rizta (3.7 kWh)',
      brand: 'Ather',
      connectorType: 'TYPE7',
      modes: { ECO: 1.25, RIDE: 1.00, SPORT: 0.80 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.7,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    },
    'ather-450-apex': {
      name: 'Ather 450 Apex (Warp+)',
      brand: 'Ather',
      connectorType: 'TYPE7',
      modes: { ECO: 1.10, RIDE: 0.85, WARP: 0.65, 'WARP+': 0.55 },
      defaultMode: 'WARP',
      batteryCapacity: 3.7,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    },
    'hero-vida-v1': {
      name: 'Hero Vida V1 Pro (3.94 kWh)',
      brand: 'Vida',
      connectorType: 'TYPE7',
      modes: { ECO: 1.10, RIDE: 0.90, SPORT: 0.70 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.94,
      acChargerKw: 0.58,
      dcFastMaxKw: 3.0
    },
    'ola-s1-pro': {
      name: 'Ola S1 Pro Gen 2 (4.0 kWh)',
      brand: 'Ola',
      connectorType: 'TYPE6',
      modes: { ECO: 1.35, NORMAL: 1.10, SPORT: 0.85, HYPER: 0.65 },
      defaultMode: 'NORMAL',
      batteryCapacity: 4.0,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    },
    'tvs-iqube': {
      name: 'TVS iQube (3.4 kWh)',
      brand: 'TVS',
      connectorType: 'AC_PORTABLE',
      modes: { ECO: 1.00, POWER: 0.75 },
      defaultMode: 'ECO',
      batteryCapacity: 3.4,
      acChargerKw: 0.95,
      dcFastMaxKw: 0.95
    },
    'bajaj-chetak': {
      name: 'Bajaj Chetak (3.2 kWh)',
      brand: 'Bajaj',
      connectorType: 'AC_PORTABLE',
      modes: { ECO: 1.05, SPORTS: 0.80 },
      defaultMode: 'ECO',
      batteryCapacity: 3.2,
      acChargerKw: 0.80,
      dcFastMaxKw: 0.80
    },
    'custom-2w': {
      name: 'Custom 2W Electric Scooter',
      brand: 'Generic',
      connectorType: 'ANY',
      modes: { ECO: 1.00, RIDE: 0.80, SPORT: 0.60 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.0,
      acChargerKw: 0.75,
      dcFastMaxKw: 3.0
    }
  };

  let state = {
    selectedVehicle: 'ather-450x-37',
    currentBatteryPct: 85,
    ridingMode: 'RIDE',
    efficiency: 0.85, // km per 1%
    safetyReservePct: 15, // safety buffer %
    targetChargePct: 80, // Target Fast Charge limit %
    isCustomEfficiency: false
  };

  const listeners = [];

  function init() {
    try {
      const saved = localStorage.getItem('voltway_battery_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (parsed.selectedVehicle && VEHICLE_PRESETS[parsed.selectedVehicle]) {
            state.selectedVehicle = parsed.selectedVehicle;
          }
          if (typeof parsed.currentBatteryPct === 'number' && !isNaN(parsed.currentBatteryPct)) {
            state.currentBatteryPct = Math.max(0, Math.min(100, parsed.currentBatteryPct));
          }
          if (parsed.ridingMode) {
            state.ridingMode = parsed.ridingMode;
          }
          if (typeof parsed.efficiency === 'number' && parsed.efficiency > 0) {
            state.efficiency = Math.max(0.1, Math.min(3.0, parsed.efficiency));
          }
          if (typeof parsed.safetyReservePct === 'number' && !isNaN(parsed.safetyReservePct)) {
            state.safetyReservePct = Math.max(5, Math.min(35, parsed.safetyReservePct));
          }
          if (typeof parsed.targetChargePct === 'number' && !isNaN(parsed.targetChargePct)) {
            state.targetChargePct = Math.max(50, Math.min(100, parsed.targetChargePct));
          }
          if (typeof parsed.isCustomEfficiency === 'boolean') {
            state.isCustomEfficiency = parsed.isCustomEfficiency;
          }

          // Reconcile mode against selected preset unless explicitly custom
          const v = VEHICLE_PRESETS[state.selectedVehicle] || VEHICLE_PRESETS['ather-450x-37'];
          if (!state.isCustomEfficiency && !v.modes[state.ridingMode]) {
            state.ridingMode = v.defaultMode || Object.keys(v.modes)[0];
            state.efficiency = v.modes[state.ridingMode] || 0.85;
          }
        }
      }
    } catch (e) {
      console.warn('[VoltWay Battery] Could not load saved state:', e);
    }
  }

  function save() {
    try {
      localStorage.setItem('voltway_battery_state', JSON.stringify(state));
    } catch (e) {}
    notify();
  }

  function notify() {
    const snap = getState();
    listeners.forEach((fn) => fn(snap));
  }

  function subscribe(fn) {
    listeners.push(fn);
    fn(getState());
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function getState() {
    const vehicleDetails = VEHICLE_PRESETS[state.selectedVehicle] || VEHICLE_PRESETS['ather-450x-37'];
    const reachableSafeKm = calculateReachableSafeKm();
    const conservativeSafeKm = Math.round(reachableSafeKm * 0.9 * 10) / 10;
    const absoluteMaxKm = calculateAbsoluteMaxKm();
    return {
      ...state,
      reachableSafeKm,
      conservativeSafeKm,
      absoluteMaxKm,
      vehicleDetails
    };
  }

  function setBatteryPct(pct) {
    const parsed = Number(pct);
    if (isNaN(parsed)) return;
    state.currentBatteryPct = Math.max(0, Math.min(100, parsed));
    save();
  }

  function setVehicle(vehicleKey) {
    if (!VEHICLE_PRESETS[vehicleKey]) vehicleKey = 'ather-450x-37';
    state.selectedVehicle = vehicleKey;
    const v = VEHICLE_PRESETS[vehicleKey];
    if (!v.modes[state.ridingMode]) {
      state.ridingMode = v.defaultMode || Object.keys(v.modes)[0];
    }
    state.efficiency = v.modes[state.ridingMode] || 0.85;
    state.isCustomEfficiency = false;
    save();
  }

  function setRidingMode(modeKey) {
    const v = VEHICLE_PRESETS[state.selectedVehicle] || VEHICLE_PRESETS['ather-450x-37'];
    if (v.modes[modeKey]) {
      state.ridingMode = modeKey;
      state.efficiency = v.modes[modeKey];
      state.isCustomEfficiency = false;
    } else if (modeKey) {
      state.ridingMode = v.defaultMode || Object.keys(v.modes)[0];
      state.efficiency = v.modes[state.ridingMode] || 0.85;
      state.isCustomEfficiency = false;
    }
    save();
  }

  function setCustomEfficiency(eff) {
    const parsed = parseFloat(eff);
    if (isNaN(parsed) || parsed <= 0) return;
    state.efficiency = Math.round(Math.max(0.1, Math.min(3.0, parsed)) * 100) / 100;
    state.isCustomEfficiency = true;
    state.ridingMode = 'CUSTOM';
    save();
  }

  function setSafetyReserve(reservePct) {
    const parsed = parseInt(reservePct, 10);
    if (isNaN(parsed)) return;
    state.safetyReservePct = Math.max(5, Math.min(35, parsed));
    save();
  }

  function setTargetChargePct(targetPct) {
    const parsed = parseInt(targetPct, 10);
    if (isNaN(parsed)) return;
    state.targetChargePct = Math.max(50, Math.min(100, parsed));
    save();
  }

  /**
   * Est. Safe Range (km) = max(0, Current Battery % - Reserve %) * Efficiency (km / 1%)
   */
  function calculateReachableSafeKm(battery = state.currentBatteryPct) {
    const bat = typeof battery === 'number' && !isNaN(battery) ? battery : state.currentBatteryPct;
    const usableBattery = Math.max(0, bat - state.safetyReservePct);
    return Math.round(usableBattery * state.efficiency * 10) / 10;
  }

  function calculateAbsoluteMaxKm(battery = state.currentBatteryPct) {
    const bat = typeof battery === 'number' && !isNaN(battery) ? battery : state.currentBatteryPct;
    return Math.round(Math.max(0, bat) * state.efficiency * 10) / 10;
  }

  /**
   * Evaluates 2W connector compatibility for a charger station against the active vehicle profile.
   * Ensures Type 6 (Ola) vs Type 7 LECCS (Ather/VIDA) vs 15A Portable AC sockets are strictly respected.
   */
  function isChargerCompatible(charger, vehicleKey = state.selectedVehicle) {
    if (!charger) return { compatible: false, direct: false, reason: 'Invalid charger' };
    if (charger.is_2w === false) {
      return { compatible: false, direct: false, reason: '4W car / incompatible connector' };
    }

    const v = VEHICLE_PRESETS[vehicleKey] || VEHICLE_PRESETS['ather-450x-37'];
    const vConn = v.connectorType || 'TYPE7';

    // Determine charger standard cleanly even on legacy cached records
    // Bolt.Earth 2W Fast chargers ship Dual Type 6 + Type 7 on the same unit even if backend model_id only says TYPE6
    let cStd = charger.connector_std || '';
    if (charger.network === 'BOLT_EARTH' && (charger.type === 'FAST' || cStd === 'TYPE6_LEVDC' || cStd === 'TYPE6_TYPE7')) {
      cStd = 'TYPE6_TYPE7';
    } else if (!cStd) {
      const mid = String(charger.model_id || '').toUpperCase();
      if (charger.network === 'ATHER_GRID' || charger.network === 'VIDA_GRID') {
        cStd = 'TYPE7_LECCS';
      } else if (charger.type === 'SLOW') {
        cStd = 'AC_15A';
      } else if (mid.includes('TYPE6') && mid.includes('TYPE7')) {
        cStd = 'TYPE6_TYPE7';
      } else if (mid.includes('TYPE7')) {
        cStd = 'TYPE7_LECCS';
      } else if (mid.includes('TYPE6')) {
        cStd = 'TYPE6_LEVDC';
      } else {
        cStd = 'TYPE7_LECCS';
      }
    }

    if (cStd === 'AC_15A' || charger.type === 'SLOW') {
      return { compatible: true, direct: vConn === 'AC_PORTABLE', reason: '15A Socket (Portable charger)' };
    }

    if (vConn === 'ANY') {
      return { compatible: true, direct: true, reason: `2W Fast (${cStd.replace(/_/g, ' ')})` };
    }

    if (vConn === 'TYPE7') {
      if (cStd === 'TYPE7_LECCS' || cStd === 'TYPE6_TYPE7') {
        return { compatible: true, direct: true, reason: 'Direct Type 7 LECCS Plug-in' };
      }
      return { compatible: false, direct: false, reason: 'Type 6 Gun (Ola) — Adapter req. for Type 7' };
    }

    if (vConn === 'TYPE6') {
      if (cStd === 'TYPE6_LEVDC' || cStd === 'TYPE6_TYPE7') {
        return { compatible: true, direct: true, reason: 'Direct Type 6 LEVDC Plug-in' };
      }
      return { compatible: false, direct: false, reason: 'Type 7 Gun (Ather/VIDA) — Adapter req. for Type 6' };
    }

    if (vConn === 'AC_PORTABLE') {
      return { compatible: false, direct: false, reason: 'DC Fast Gun incompatible (Use 15A Socket)' };
    }

    return { compatible: true, direct: true, reason: '2W Compatible' };
  }

  /**
   * Evaluate a direct single-leg trip's feasibility
   * Consistent 1-decimal percentage calculation across UI & Timeline.
   */
  function evaluateTrip(distanceKm) {
    if (!distanceKm || distanceKm <= 0) {
      return {
        distanceKm: 0,
        batteryNeededPct: 0,
        batteryAtArrivalPct: state.currentBatteryPct,
        status: 'SAFE',
        statusText: 'Trip ready to evaluate',
        statusClass: 'status-safe',
        shortfallKm: 0,
        stopsNeeded: 0,
        safeMaxKm: calculateReachableSafeKm(),
        absoluteMaxKm: calculateAbsoluteMaxKm()
      };
    }

    const cleanRound1 = (val) => {
      const r = Math.round(val * 10) / 10;
      return r === 0 ? 0 : r;
    };

    const eff = state.efficiency > 0 ? state.efficiency : 0.85;
    const batteryNeededPctExact = distanceKm / eff;
    const batteryNeededPct = cleanRound1(batteryNeededPctExact);
    const batteryAtArrivalPct = cleanRound1(state.currentBatteryPct - batteryNeededPctExact);
    const usableSpanPct = Math.max(10, state.targetChargePct - state.safetyReservePct);

    let status = 'SAFE';
    let statusText = `Est. Safe Ride: Arrive with ~${batteryAtArrivalPct}% battery`;
    let statusClass = 'status-safe';
    let shortfallKm = 0;
    let stopsNeeded = 0;

    if (batteryAtArrivalPct < 0) {
      status = 'CRITICAL';
      shortfallKm = cleanRound1(Math.abs(batteryAtArrivalPct) * eff);
      stopsNeeded = Math.max(1, Math.ceil((distanceKm - calculateReachableSafeKm()) / (usableSpanPct * eff)));
      statusText = `Range Exceeded! Est. short by ~${shortfallKm} km. Charging stop required.`;
      statusClass = 'status-critical';
    } else if (batteryAtArrivalPct < state.safetyReservePct) {
      status = 'WARNING';
      stopsNeeded = 1;
      statusText = `Reserve Alert: Est. arrival at ${batteryAtArrivalPct}% (below ${state.safetyReservePct}% buffer).`;
      statusClass = 'status-warning';
    }

    return {
      distanceKm: cleanRound1(distanceKm),
      batteryNeededPct,
      batteryAtArrivalPct,
      status,
      statusText,
      statusClass,
      shortfallKm,
      stopsNeeded,
      safeMaxKm: calculateReachableSafeKm(),
      absoluteMaxKm: calculateAbsoluteMaxKm()
    };
  }

  init();

  return {
    getState,
    setBatteryPct,
    setVehicle,
    setRidingMode,
    setCustomEfficiency,
    setSafetyReserve,
    setTargetChargePct,
    calculateReachableSafeKm,
    calculateAbsoluteMaxKm,
    isChargerCompatible,
    evaluateTrip,
    subscribe,
    VEHICLE_PRESETS
  };
})();

window.BatteryEngine = BatteryEngine;

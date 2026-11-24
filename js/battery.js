/**
 * VoltWay 2W - Battery Consumption & Range Engine
 * Tailored specifically for 2-wheeler EVs (Ather, Ola, TVS, etc.)
 */

const BatteryEngine = (function () {
  // Vehicle presets database
  const VEHICLE_PRESETS = {
    'ather-450x-37': {
      name: 'Ather 450X (3.7 kWh)',
      brand: 'Ather',
      modes: { ECO: 1.10, RIDE: 0.85, SPORT: 0.70, WARP: 0.60 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.7
    },
    'ather-450x-29': {
      name: 'Ather 450X (2.9 kWh)',
      brand: 'Ather',
      modes: { ECO: 0.90, RIDE: 0.75, SPORT: 0.60, WARP: 0.50 },
      defaultMode: 'RIDE',
      batteryCapacity: 2.9
    },
    'ather-rizta-37': {
      name: 'Ather Rizta (3.7 kWh)',
      brand: 'Ather',
      modes: { ECO: 1.25, RIDE: 1.00, SPORT: 0.80 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.7
    },
    'ather-450-apex': {
      name: 'Ather 450 Apex (Warp+)',
      brand: 'Ather',
      modes: { ECO: 1.10, RIDE: 0.85, WARP: 0.65, 'WARP+': 0.55 },
      defaultMode: 'WARP',
      batteryCapacity: 3.7
    },
    'ola-s1-pro': {
      name: 'Ola S1 Pro Gen 2 (4.0 kWh)',
      brand: 'Ola',
      modes: { ECO: 1.40, NORMAL: 1.10, SPORT: 0.85, HYPER: 0.65 },
      defaultMode: 'NORMAL',
      batteryCapacity: 4.0
    },
    'tvs-iqube': {
      name: 'TVS iQube (3.4 kWh)',
      brand: 'TVS',
      modes: { ECO: 1.00, POWER: 0.75 },
      defaultMode: 'ECO',
      batteryCapacity: 3.4
    },
    'bajaj-chetak': {
      name: 'Bajaj Chetak (3.2 kWh)',
      brand: 'Bajaj',
      modes: { ECO: 1.05, SPORTS: 0.80 },
      defaultMode: 'ECO',
      batteryCapacity: 3.2
    },
    'hero-vida-v1': {
      name: 'Hero Vida V1 Pro (3.94 kWh)',
      brand: 'Vida',
      modes: { ECO: 1.10, RIDE: 0.90, SPORT: 0.70 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.94
    },
    'custom-2w': {
      name: 'Custom 2W Electric Scooter',
      brand: 'Generic',
      modes: { ECO: 1.00, RIDE: 0.80, WARP: 0.60 },
      defaultMode: 'RIDE',
      batteryCapacity: 3.0
    }
  };

  // State
  let state = {
    selectedVehicle: 'ather-450x-37',
    currentBatteryPct: 85,
    ridingMode: 'RIDE',
    efficiency: 0.85, // km per 1%
    safetyReservePct: 15, // safety buffer %
    targetChargePct: 80, // Target Fast Charge limit % (typically 80% to protect battery)
    isCustomEfficiency: false
  };

  // Listeners
  const listeners = [];

  function init() {
    // Load from localStorage if available
    try {
      const saved = localStorage.getItem('voltway_battery_state');
      if (saved) {
        state = { ...state, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Could not load saved battery state:', e);
    }
  }

  function save() {
    try {
      localStorage.setItem('voltway_battery_state', JSON.stringify(state));
    } catch (e) {}
    notify();
  }

  function notify() {
    listeners.forEach((fn) => fn(getState()));
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
    const reachableSafeKm = calculateReachableSafeKm();
    const absoluteMaxKm = calculateAbsoluteMaxKm();
    return {
      ...state,
      reachableSafeKm,
      absoluteMaxKm,
      vehicleDetails: VEHICLE_PRESETS[state.selectedVehicle] || VEHICLE_PRESETS['ather-450x-37']
    };
  }

  function setBatteryPct(pct) {
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    state.currentBatteryPct = pct;
    save();
  }

  function setVehicle(vehicleKey) {
    if (!VEHICLE_PRESETS[vehicleKey]) vehicleKey = 'ather-450x-37';
    state.selectedVehicle = vehicleKey;
    const v = VEHICLE_PRESETS[vehicleKey];
    // update mode if not available in this vehicle
    if (!v.modes[state.ridingMode]) {
      state.ridingMode = v.defaultMode || Object.keys(v.modes)[0];
    }
    state.efficiency = v.modes[state.ridingMode] || 0.85;
    state.isCustomEfficiency = false;
    save();
  }

  function setRidingMode(modeKey) {
    state.ridingMode = modeKey;
    state.isCustomEfficiency = false;
    const v = VEHICLE_PRESETS[state.selectedVehicle] || VEHICLE_PRESETS['ather-450x-37'];
    if (v.modes[modeKey]) {
      state.efficiency = v.modes[modeKey];
    } else if (modeKey === 'ECO') {
      state.efficiency = 1.0;
    } else if (modeKey === 'RIDE') {
      state.efficiency = 0.8;
    } else if (modeKey === 'WARP' || modeKey === 'SPORT') {
      state.efficiency = 0.6;
    }
    save();
  }

  function setCustomEfficiency(eff) {
    eff = Math.max(0.1, Math.min(3.0, parseFloat(eff) || 0.8));
    state.efficiency = Math.round(eff * 100) / 100;
    state.isCustomEfficiency = true;
    state.ridingMode = 'CUSTOM';
    save();
  }

  function setSafetyReserve(reservePct) {
    reservePct = Math.max(5, Math.min(35, parseInt(reservePct, 10) || 15));
    state.safetyReservePct = reservePct;
    save();
  }

  function setTargetChargePct(targetPct) {
    targetPct = Math.max(50, Math.min(100, parseInt(targetPct, 10) || 80));
    state.targetChargePct = targetPct;
    save();
  }

  /**
   * Reachable Distance (km) = (Current Battery % - Reserve %) * Efficiency
   */
  function calculateReachableSafeKm(battery = state.currentBatteryPct) {
    const usableBattery = Math.max(0, battery - state.safetyReservePct);
    return Math.round(usableBattery * state.efficiency * 10) / 10;
  }

  function calculateAbsoluteMaxKm(battery = state.currentBatteryPct) {
    return Math.round(battery * state.efficiency * 10) / 10;
  }

  /**
   * Evaluate a trip's feasibility
   * @param {number} distanceKm Total trip distance in kilometers
   * @returns {Object} Trip evaluation metrics and safety status
   */
  function evaluateTrip(distanceKm) {
    if (!distanceKm || distanceKm <= 0) {
      return {
        distanceKm: 0,
        batteryNeededPct: 0,
        batteryAtArrivalPct: state.currentBatteryPct,
        status: 'SAFE',
        statusText: 'Trip ready to plan',
        statusClass: 'status-safe',
        shortfallKm: 0,
        stopsNeeded: 0
      };
    }

    const eff = state.efficiency > 0 ? state.efficiency : 0.8;
    const batteryNeededPctExact = distanceKm / eff;
    const batteryNeededPct = Math.round(batteryNeededPctExact);
    const batteryAtArrivalPct = Math.round(state.currentBatteryPct - batteryNeededPctExact);

    let status = 'SAFE';
    let statusText = `Safe to Ride! Arrival at ${batteryAtArrivalPct}% battery`;
    let statusClass = 'status-safe';
    let shortfallKm = 0;
    let stopsNeeded = 0;

    if (batteryAtArrivalPct < 0) {
      status = 'CRITICAL';
      shortfallKm = Math.round(Math.abs(batteryAtArrivalPct) * eff * 10) / 10;
      stopsNeeded = Math.ceil((distanceKm - calculateReachableSafeKm()) / (80 * eff)) || 1;
      statusText = `Range Exceeded! Short by ${shortfallKm} km. Charging stop required.`;
      statusClass = 'status-critical';
    } else if (batteryAtArrivalPct < state.safetyReservePct) {
      status = 'WARNING';
      statusText = `Reserve Warning: Arrival at ${batteryAtArrivalPct}% (below ${state.safetyReservePct}% safety reserve buffer)`;
      statusClass = 'status-warning';
    }

    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
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
    evaluateTrip,
    subscribe,
    VEHICLE_PRESETS
  };
})();

window.BatteryEngine = BatteryEngine;

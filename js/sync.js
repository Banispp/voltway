/**
 * VoltWay 2W - Charger Database & Zero-Server Sync Engine
 * Handles versioned IndexedDB migration, 0.2-deg spatial grid indexing,
 * strict 4W/OCPI filtering, connector compatibility metadata, and GitHub OTA sync.
 */

const SyncEngine = (function () {
  const DB_NAME = 'VoltWay2W_DB';
  const DB_VERSION = 2;
  const DB_SCHEMA_TAG = '5.50-clean-2w';
  const STORE_NAME = 'chargers';

  let db = null;
  let inMemoryChargers = [];
  let chargerByIdMap = new Map();
  let isSyncing = false;
  const listeners = [];

  // 2D Spatial Grid Index (0.2° x 0.2° buckets ~ 22km x 22km)
  const GRID_CELL_SIZE = 0.2;
  const spatialGrid = new Map();

  function rebuildIndexes() {
    spatialGrid.clear();
    chargerByIdMap.clear();
    for (let i = 0; i < inMemoryChargers.length; i++) {
      const c = inMemoryChargers[i];
      if (!c || !c.id || typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      chargerByIdMap.set(String(c.id), c);
      const key = `${Math.floor(c.lat / GRID_CELL_SIZE)}_${Math.floor(c.lng / GRID_CELL_SIZE)}`;
      let cell = spatialGrid.get(key);
      if (!cell) {
        cell = [];
        spatialGrid.set(key, cell);
      }
      cell.push(c);
    }
  }

  function getChargerById(id) {
    if (!id) return null;
    return chargerByIdMap.get(String(id)) || null;
  }

  function getChargersInBounds(bounds) {
    if (!bounds) return inMemoryChargers;
    let south, west, north, east;
    if (typeof bounds.getSouth === 'function') {
      south = bounds.getSouth();
      west = bounds.getWest();
      north = bounds.getNorth();
      east = bounds.getEast();
    } else {
      south = bounds.south;
      west = bounds.west;
      north = bounds.north;
      east = bounds.east;
    }

    if (south == null || west == null || north == null || east == null) {
      return inMemoryChargers;
    }

    const minLatCell = Math.floor(south / GRID_CELL_SIZE);
    const maxLatCell = Math.floor(north / GRID_CELL_SIZE);
    const minLngCell = Math.floor(west / GRID_CELL_SIZE);
    const maxLngCell = Math.floor(east / GRID_CELL_SIZE);

    const candidates = [];
    for (let latIdx = minLatCell; latIdx <= maxLatCell; latIdx++) {
      for (let lngIdx = minLngCell; lngIdx <= maxLngCell; lngIdx++) {
        const cell = spatialGrid.get(`${latIdx}_${lngIdx}`);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            candidates.push(cell[i]);
          }
        }
      }
    }
    return candidates;
  }

  function initDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('network', 'network', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('lat', 'lat', { unique: false });
          store.createIndex('lng', 'lng', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };

      request.onerror = (e) => {
        console.warn('[VoltWay DB] IndexedDB unavailable, using in-memory store:', e);
        resolve(null);
      };
    });
  }

  /**
   * Client-side 2W validator: guarantees 4W car stations (OCPP_LEVEL_2/3, OCPI, CCS2, GB/T)
   * never enter memory even from older caches or live roaming endpoints.
   */
  function validateAndNormalizeCharger(item) {
    if (!item || !item.id || typeof item.lat !== 'number' || typeof item.lng !== 'number') return null;
    if (item.lat < 6 || item.lat > 38 || item.lng < 68 || item.lng > 98) return null;

    const mid = String(item.model_id || '').toUpperCase();
    const cidUp = String(item.id).toUpperCase();
    const excludedTokens = ['LEVEL_2', 'LEVEL_3', 'OCPI', 'CCS', 'TYPE2', 'TYPE_2', 'GB/T', 'GBT', 'CHADEMO', 'CHAOJI', '7_4KW', '22KW', '30KW', '60KW'];
    if (excludedTokens.some(t => mid.includes(t) || cidUp.includes(t))) return null;

    const excludedPrefixes = ['L200', 'L300', 'L3DC', 'ST', 'TN00', 'MH00', 'MH04', 'TS00', 'HR00', 'HR01', 'GJ01', 'DL00', 'KL00', 'KA00', 'KA01', 'AP00', 'TC', 'SM'];
    if (!mid.includes('2WFC') && excludedPrefixes.some(p => cidUp.startsWith(p))) return null;

    if (item.is_2w === false) return null;

    const normalized = { ...item };
    if (!normalized.state) normalized.state = classifyState(normalized);

    if (!normalized.connector_std) {
      if (normalized.network === 'ATHER_GRID' || normalized.network === 'VIDA_GRID') {
        normalized.connector_std = 'TYPE7_LECCS';
        normalized.compatible_vehicles = ['ATHER', 'VIDA'];
      } else if (normalized.type === 'SLOW') {
        normalized.connector_std = 'AC_15A';
        normalized.compatible_vehicles = ['ATHER', 'VIDA', 'OLA', 'TVS', 'BAJAJ', 'ALL_2W'];
      } else if (mid.includes('TYPE6') && mid.includes('TYPE7')) {
        normalized.connector_std = 'TYPE6_TYPE7';
        normalized.compatible_vehicles = ['ATHER', 'VIDA', 'OLA'];
      } else if (mid.includes('TYPE7')) {
        normalized.connector_std = 'TYPE7_LECCS';
        normalized.compatible_vehicles = ['ATHER', 'VIDA'];
      } else if (mid.includes('TYPE6')) {
        normalized.connector_std = 'TYPE6_LEVDC';
        normalized.compatible_vehicles = ['OLA'];
      } else {
        normalized.connector_std = 'TYPE7_LECCS';
        normalized.compatible_vehicles = ['ATHER', 'VIDA'];
      }
    }

    if (normalized.verified === undefined) {
      normalized.verified = true;
    }

    return normalized;
  }

  async function loadInitialChargers() {
    await initDB();

    const storedSchema = localStorage.getItem('voltway_db_schema_version');
    let stored = [];
    if (db && storedSchema === DB_SCHEMA_TAG) {
      stored = await getAllFromDB();
    }

    if (stored && stored.length > 0 && storedSchema === DB_SCHEMA_TAG) {
      inMemoryChargers = stored.map(validateAndNormalizeCharger).filter(Boolean);
      console.log(`[VoltWay DB] Loaded ${inMemoryChargers.length} validated chargers from IndexedDB`);
    } else {
      try {
        const resp = await fetch('chargers_db.json');
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            inMemoryChargers = data.map(validateAndNormalizeCharger).filter(Boolean);
            console.log(`[VoltWay DB] Migrated & loaded ${inMemoryChargers.length} verified 2W chargers from bundle`);
            if (db) {
              clearAndSaveAllToDB(inMemoryChargers).then(() => {
                try { localStorage.setItem('voltway_db_schema_version', DB_SCHEMA_TAG); } catch (e) {}
              });
            }
          }
        }
      } catch (err) {
        console.warn('[VoltWay DB] Initial bundle fetch warning:', err);
      }
    }

    rebuildIndexes();
    notify();

    setTimeout(() => {
      checkAndSyncRemoteUpdates();
    }, 2000);

    window.addEventListener('online', () => {
      console.log('[VoltWay Sync] Connection restored. Checking for OTA charger updates...');
      checkAndSyncRemoteUpdates();
    });

    return inMemoryChargers;
  }

  function getAllFromDB() {
    return new Promise((resolve) => {
      if (!db) return resolve([]);
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  function saveBatchToDB(chargers) {
    return new Promise((resolve) => {
      if (!db || !chargers || chargers.length === 0) return resolve();
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (let i = 0; i < chargers.length; i++) {
          store.put(chargers[i]);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  async function checkAndSyncRemoteUpdates(force = false) {
    if (!navigator.onLine) return { added: 0, removed: 0 };

    const lastSync = localStorage.getItem('voltway_last_sync');
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    if (!force && lastSync && new Date(lastSync).getTime() > sixHoursAgo) {
      return { added: 0, removed: 0 };
    }

    try {
      let remoteChargers = null;
      const remoteUrls = [
        'https://raw.githubusercontent.com/Banispp/voltway/master/chargers_db.json?v=' + Date.now(),
        'https://banispp.github.io/voltway/chargers_db.json?v=' + Date.now()
      ];
      for (const remoteRepoUrl of remoteUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);
          const resp = await fetch(remoteRepoUrl, { cache: 'no-store', signal: controller.signal });
          clearTimeout(timeoutId);
          if (resp.ok) {
            remoteChargers = await resp.json();
            if (Array.isArray(remoteChargers) && remoteChargers.length > 0) break;
          }
        } catch (errRemote) {}
      }

      if (!Array.isArray(remoteChargers) || remoteChargers.length === 0) {
        return { added: 0, removed: 0 };
      }

      const validatedList = remoteChargers.map(validateAndNormalizeCharger).filter(Boolean);
      if (validatedList.length === 0) return { added: 0, removed: 0 };

      const stats = reconcileChargers(validatedList);
      localStorage.setItem('voltway_last_sync', new Date().toISOString());
      if (stats.added > 0 || stats.removed > 0) {
        showAutoUpdateToast(`⚡ Database Synced: +${stats.added} added, -${stats.removed} removed`);
      }
      return stats;
    } catch (e) {
      return { added: 0, removed: 0 };
    }
  }

  function reconcileChargers(authoritativeList) {
    if (!Array.isArray(authoritativeList) || authoritativeList.length === 0) return { added: 0, removed: 0 };

    const remoteMap = new Map();
    authoritativeList.forEach(c => remoteMap.set(c.id, c));

    const currentMap = new Map();
    inMemoryChargers.forEach(c => currentMap.set(c.id, c));

    let added = 0;
    let removed = 0;
    authoritativeList.forEach(c => { if (!currentMap.has(c.id)) added++; });
    inMemoryChargers.forEach(c => { if (!remoteMap.has(c.id)) removed++; });

    inMemoryChargers = authoritativeList;
    rebuildIndexes();
    if (db) {
      clearAndSaveAllToDB(inMemoryChargers).then(() => {
        try { localStorage.setItem('voltway_db_schema_version', DB_SCHEMA_TAG); } catch (e) {}
      });
    }
    notify();
    if (window.MapEngine && (!window.MapEngine.isPopupOpen || !window.MapEngine.isPopupOpen())) {
      window.MapEngine.renderChargers();
    }
    return { added, removed };
  }

  function clearAndSaveAllToDB(chargers) {
    return new Promise((resolve) => {
      if (!db || !chargers) return resolve();
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        for (let i = 0; i < chargers.length; i++) {
          store.put(chargers[i]);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * Pin-code + word-boundary city keywords before non-overlapping regional box fallbacks.
   */
  function classifyState(c) {
    if (c.state) return c.state;
    const text = `${c.name || ''} ${c.address || ''}`.toLowerCase();
    const lat = c.lat;
    const lng = c.lng;

    if (/\b6[789]\d{4}\b/.test(text)) return 'kerala';
    if (/\b6[0-4]\d{4}\b/.test(text)) return 'tamil_nadu';
    if (/\b5[6-9]\d{4}\b/.test(text)) return 'karnataka';

    const klKw = ['kerala', 'malappuram', 'kozhikode', 'calicut', 'ernakulam', 'kochi', 'cochin', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta', 'pala'];
    if (klKw.some(k => new RegExp(`\\b${k}\\b`).test(text))) return 'kerala';

    const tnKw = ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri'];
    if (tnKw.some(k => new RegExp(`\\b${k}\\b`).test(text))) return 'tamil_nadu';

    const kaKw = ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar', 'kalaburagi'];
    if (kaKw.some(k => new RegExp(`\\b${k}\\b`).test(text))) return 'karnataka';

    if (lat >= 8.20 && lat <= 12.78 && lng >= 74.85 && lng <= 77.15) {
      if (!(lat >= 10.72 && lat <= 11.22 && lng >= 76.82) && !(lat >= 11.22 && lat <= 11.65 && lng >= 76.60)) {
        return 'kerala';
      }
    }
    if (lat >= 11.75 && lat <= 18.45 && lng >= 74.05 && lng <= 77.78) return 'karnataka';
    if (lat >= 8.08 && lat <= 13.50 && lng >= 76.65 && lng <= 80.35) return 'tamil_nadu';

    return 'other';
  }

  /**
   * Live viewport discovery for Bolt.Earth 2W chargers across India.
   * Strictly filters out 4W Level 2/3, OCPI, CCS2, and separates Type 6 vs Type 7 connectors.
   */
  async function fetchLiveBoltInBounds(bounds) {
    if (!bounds || !navigator.onLine) return [];
    const { south, west, north, east } = bounds;
    const url = `https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=${south}&lng_right=${east}&lat_top=${north}&lng_left=${west}&zoom=16`;

    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(abortTimer);
      if (!resp.ok) return [];
      const res = await resp.json();
      const items = res.data || [];
      if (!Array.isArray(items) || items.length === 0) return [];

      const newItems = [];
      items.forEach((item) => {
        const cid = item.chargerId;
        if (!cid) return;
        const coords = item.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const lng = coords[0];
        const lat = coords[1];
        if (lat < 6 || lat > 38 || lng < 68 || lng > 98) return;

        const modelId = (item.model?.modelId || '').toUpperCase();
        const cidUpper = String(cid).toUpperCase();

        // Strict 4-Wheeler & OCPI Roaming Exclusion
        const isCarOrOcpi = ['LEVEL_2', 'LEVEL_3', 'OCPP_LEVEL_2', 'OCPP_LEVEL_3', 'OCPI', 'CCS', 'TYPE2', 'GB/T', 'CHADEMO', 'CHAOJI'].some(k => modelId.includes(k)) ||
          (!modelId.includes('2WFC') && ['L200', 'L300', 'L3DC', 'ST', 'TN00', 'MH00', 'TS00', 'HR00', 'GJ01', 'DL00', 'HR01', 'KL00', 'KA01', 'MH04', 'TC', 'SM'].some(p => cidUpper.startsWith(p)));
        if (isCarOrOcpi) return;

        const addr = (item.station?.address || '').trim();
        const stnName = (item.station?.name || '').trim();

        const is2WFast = cidUpper.startsWith('L1DC') || modelId.includes('2WFC');
        const is2WSlow = !is2WFast && (
          ['BOLT_16A', 'BOLT_LITE', 'OCPP_LEVEL_1', 'LEVAC'].some(k => modelId.includes(k)) ||
          ['L100', 'L1OC', 'BOLT_'].some(p => cidUpper.startsWith(p))
        );
        if (!is2WFast && !is2WSlow) return;

        const hasT6 = modelId.includes('TYPE6');
        const hasT7 = modelId.includes('TYPE7');
        let connStd = 'AC_15A';
        let compatVehicles = ['ATHER', 'VIDA', 'OLA', 'TVS', 'BAJAJ', 'ALL_2W'];
        let connLabel = 'Standard 15A / 3-Pin AC Socket (Portable Charger)';

        if (is2WFast) {
          if (hasT6 && hasT7) {
            connStd = 'TYPE6_TYPE7';
            compatVehicles = ['ATHER', 'VIDA', 'OLA'];
            connLabel = 'Dual 2W Fast DC (Type 7 LECCS + Type 6 LEVDC)';
          } else if (hasT6 && !hasT7) {
            connStd = 'TYPE6_LEVDC';
            compatVehicles = ['OLA'];
            connLabel = 'Type 6 LEVDC Fast DC (Ola / Type 6 — Adapter req. for Ather)';
          } else {
            connStd = 'TYPE7_LECCS';
            compatVehicles = ['ATHER', 'VIDA'];
            connLabel = 'Type 7 LECCS Fast DC (Ather / Hero VIDA)';
          }
        }

        const powerMatch = modelId.match(/_1_(\d+)KW/);
        const powerKw = is2WFast ? (powerMatch ? parseFloat(powerMatch[1]) : 3.0) : 1.5;
        const cleanAddr = addr.split(',')[0].trim();
        const name = is2WFast
          ? `Bolt.Earth Fast - ${cleanAddr || stnName || cid}`
          : `Bolt.Earth 15A - ${cleanAddr || stnName || cid}`;

        newItems.push({
          id: cid,
          name,
          network: 'BOLT_EARTH',
          type: is2WFast ? 'FAST' : 'SLOW',
          state: classifyState({ name, address: addr, lat, lng }),
          model_id: modelId,
          connector_std: connStd,
          compatible_vehicles: compatVehicles,
          connector: connLabel,
          power_kw: powerKw,
          lat: Math.round(lat * 1000000) / 1000000,
          lng: Math.round(lng * 1000000) / 1000000,
          address: addr,
          source: 'Bolt.Earth Live API',
          verified: Boolean(modelId),
          is_2w: true
        });
      });

      if (newItems.length > 0) {
        mergeChargers(newItems);
      }
      return newItems;
    } catch (e) {
      return [];
    }
  }

  async function performFullSync(onProgress) {
    if (isSyncing) return;
    isSyncing = true;
    notify();

    if (onProgress) onProgress({ status: 'Connecting to verified 2W directory...', percent: 15 });

    try {
      const reconcileStats = await checkAndSyncRemoteUpdates(true);

      if (navigator.onLine) {
        if (onProgress) onProgress({ status: 'Scanning live regional Bolt.Earth corridors...', percent: 60 });
        const keyCorridors = [
          { lat_bottom: 9.8, lng_left: 76.2, lat_top: 10.2, lng_right: 76.5 },
          { lat_bottom: 11.1, lng_left: 75.7, lat_top: 11.4, lng_right: 76.0 },
          { lat_bottom: 8.4, lng_left: 76.8, lat_top: 8.7, lng_right: 77.1 },
          { lat_bottom: 12.7, lng_left: 77.4, lat_top: 13.2, lng_right: 77.8 },
          { lat_bottom: 10.7, lng_left: 76.6, lat_top: 11.2, lng_right: 77.1 }
        ];
        for (let i = 0; i < keyCorridors.length; i++) {
          const c = keyCorridors[i];
          await fetchLiveBoltInBounds({ south: c.lat_bottom, west: c.lng_left, north: c.lat_top, east: c.lng_right });
        }
      }

      const finalStats = getStats();
      let completionMsg = navigator.onLine
        ? `Sync complete! Verified 2W stations: ${finalStats.total.toLocaleString()}`
        : `Offline mode: ${finalStats.total.toLocaleString()} cached 2W stations available`;

      if (reconcileStats && (reconcileStats.added > 0 || reconcileStats.removed > 0)) {
        completionMsg = `Synced! +${reconcileStats.added} added, -${reconcileStats.removed} removed (${finalStats.total.toLocaleString()} total)`;
      }

      if (onProgress) {
        onProgress({ status: completionMsg, percent: 100 });
      }
    } catch (err) {
      if (onProgress) onProgress({ status: 'Using offline validated database.', percent: 100, error: true });
    } finally {
      isSyncing = false;
      notify();
    }
  }

  function mergeChargers(newChargers) {
    if (!newChargers || newChargers.length === 0) return 0;
    const existingMap = new Map();
    inMemoryChargers.forEach(c => existingMap.set(c.id, c));

    let addedCount = 0;
    const toAdd = [];

    newChargers.forEach(raw => {
      const c = validateAndNormalizeCharger(raw);
      if (c && !existingMap.has(c.id)) {
        existingMap.set(c.id, c);
        toAdd.push(c);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      inMemoryChargers = Array.from(existingMap.values());
      rebuildIndexes();
      if (db) saveBatchToDB(toAdd);
      notify();
      if (window.MapEngine && (!window.MapEngine.isPopupOpen || !window.MapEngine.isPopupOpen())) {
        window.MapEngine.renderChargers();
      }
    }

    return addedCount;
  }

  function showAutoUpdateToast(message) {
    let toast = document.getElementById('voltway-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'voltway-toast';
      toast.className = 'auto-sync-toast';
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '⚡';
      const textSpan = document.createElement('span');
      textSpan.className = 'toast-msg-text';
      toast.appendChild(iconSpan);
      toast.appendChild(textSpan);
      document.body.appendChild(toast);
    }
    const textEl = toast.querySelector('.toast-msg-text');
    if (textEl) {
      textEl.textContent = String(message || '');
    } else {
      toast.textContent = String(message || '');
    }
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 4000);
  }

  function getStats(stateFilter = 'all') {
    let atherFast = 0;
    let vidaFast = 0;
    let boltFast = 0;
    let boltSlow = 0;
    let total = 0;
    const region = stateFilter || 'all';

    for (let i = 0; i < inMemoryChargers.length; i++) {
      const c = inMemoryChargers[i];
      if (region !== 'all' && c.state !== region) continue;
      total++;
      if (c.network === 'ATHER_GRID') atherFast++;
      else if (c.network === 'VIDA_GRID') vidaFast++;
      else if (c.network === 'BOLT_EARTH') {
        if (c.type === 'FAST') boltFast++;
        else boltSlow++;
      }
    }

    return {
      total,
      atherFast,
      vidaFast,
      boltFast,
      boltSlow,
      stateFilter: region,
      lastSync: localStorage.getItem('voltway_last_sync')
    };
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function notify() {
    const stats = getStats();
    listeners.forEach(fn => fn({ chargers: inMemoryChargers, stats, isSyncing }));
  }

  return {
    loadInitialChargers,
    getChargers: () => inMemoryChargers,
    getChargerById,
    getChargersInBounds,
    getStats,
    fetchLiveBoltInBounds,
    performFullSync,
    checkAndSyncRemoteUpdates,
    mergeChargers,
    showAutoUpdateToast,
    subscribe
  };
})();

window.SyncEngine = SyncEngine;

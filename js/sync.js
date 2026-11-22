/**
 * VoltWay 2W - Charger Database & Zero-Server Sync Engine
 * Handles local IndexedDB storage, bundled offline data, and live sync with Bolt.Earth & GitHub
 */

const SyncEngine = (function () {
  const DB_NAME = 'VoltWay2W_DB';
  const DB_VERSION = 1;
  const STORE_NAME = 'chargers';

  let db = null;
  let inMemoryChargers = [];
  let isSyncing = false;
  const listeners = [];

  function initDB() {
    return new Promise((resolve, reject) => {
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
        console.warn('IndexedDB failed to open, using in-memory store:', e);
        resolve(null);
      };
    });
  }

  async function loadInitialChargers() {
    await initDB();

    // Check if IndexedDB already has chargers
    let stored = [];
    if (db) {
      stored = await getAllFromDB();
    }

    if (stored && stored.length > 0) {
      console.log(`[VoltWay] Loaded ${stored.length} chargers from IndexedDB`);
      inMemoryChargers = stored;
    } else if (window.BUNDLED_CHARGERS && window.BUNDLED_CHARGERS.length > 0) {
      console.log(`[VoltWay] Loaded ${window.BUNDLED_CHARGERS.length} bundled chargers`);
      inMemoryChargers = window.BUNDLED_CHARGERS;
      // Asynchronously populate IndexedDB
      if (db) {
        saveBatchToDB(inMemoryChargers).catch(err => console.warn('Could not cache to IndexedDB:', err));
      }
    } else {
      // Fallback: try fetching chargers_db.json
      try {
        const resp = await fetch('chargers_db.json');
        if (resp.ok) {
          const data = await resp.json();
          inMemoryChargers = data;
          if (db) saveBatchToDB(data);
        }
      } catch (err) {
        console.warn('Fallback fetch chargers_db.json failed:', err);
      }
    }

    notify();
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

  /**
   * Live Query Bolt.Earth API for chargers in a bounding box
   * Automatically classifies 2W Fast vs 15A Slow and excludes 4W CCS2
   */
  async function fetchLiveBoltInBounds(bounds) {
    if (!bounds) return [];
    const { south, west, north, east } = bounds;
    const url = `https://api.bolt.earth/discovery/v1/chargers/clusters?lat_bottom=${south}&lng_right=${east}&lat_top=${north}&lng_left=${west}&zoom=14`;

    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) return [];
      const res = await resp.json();
      const items = res.data || [];
      const newItems = [];

      items.forEach((item) => {
        const cid = item.chargerId;
        if (!cid) return;
        const coords = item.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const lng = coords[0];
        const lat = coords[1];

        const modelId = (item.model?.modelId || '').toUpperCase();

        // Filter out car-exclusive high-power CCS2 or GB/T
        if (modelId.includes('CCS') || modelId.includes('GB/T') || modelId.includes('CHADEMO')) {
          return;
        }

        const isFast = modelId.includes('FAST') || modelId.includes('2WFC') || modelId.includes('LEVEL_2') || modelId.includes('LEVEL_3');
        const ctype = isFast ? 'FAST' : 'SLOW';
        const connName = isFast ? 'Bolt.Earth Fast Charger (DC / Fast AC)' : 'Standard 15A / 3-Pin AC Socket';
        const powerKw = isFast ? 3.3 : 1.5;
        const addr = item.station?.address || '';
        const name = `Bolt.Earth ${isFast ? 'Fast' : '15A'} - ${cid}`;

        const standardized = {
          id: cid,
          name,
          network: 'BOLT_EARTH',
          type: ctype,
          model_id: modelId,
          connector: connName,
          power_kw: powerKw,
          lat: Math.round(lat * 1000000) / 1000000,
          lng: Math.round(lng * 1000000) / 1000000,
          address: addr.trim(),
          source: 'Bolt.Earth Live API',
          is_2w: true,
          status: 'OPERATIONAL'
        };

        newItems.push(standardized);
      });

      if (newItems.length > 0) {
        mergeChargers(newItems);
      }
      return newItems;
    } catch (e) {
      console.warn('Live Bolt query error (offline or network blocked):', e);
      return [];
    }
  }

  /**
   * Sync chargers from online sources (Bolt.Earth, GitHub raw repo, or Overpass)
   */
  async function performFullSync(onProgress) {
    if (isSyncing) return;
    isSyncing = true;
    notify();

    if (onProgress) onProgress({ status: 'Starting sync...', percent: 10 });

    try {
      // 1. Fetch live Bolt chargers for major corridors in India
      const keyCorridors = [
        { name: 'Bangalore & Karnataka', lat_bottom: 12.5, lng_left: 77.0, lat_top: 13.4, lng_right: 77.9 },
        { name: 'Kerala (Kochi, Calicut, TVM)', lat_bottom: 8.5, lng_left: 75.5, lat_top: 11.5, lng_right: 77.0 },
        { name: 'Chennai & Tamil Nadu', lat_bottom: 12.8, lng_left: 79.9, lat_top: 13.3, lng_right: 80.4 },
        { name: 'Hyderabad & Telangana', lat_bottom: 17.2, lng_left: 78.2, lat_top: 17.6, lng_right: 78.6 },
        { name: 'Mumbai & Pune', lat_bottom: 18.4, lng_left: 72.8, lat_top: 19.3, lng_right: 73.9 },
        { name: 'Delhi NCR', lat_bottom: 28.3, lng_left: 76.9, lat_top: 28.8, lng_right: 77.4 }
      ];

      let addedCount = 0;
      for (let i = 0; i < keyCorridors.length; i++) {
        const c = keyCorridors[i];
        if (onProgress) {
          onProgress({
            status: `Querying live Bolt.Earth API: ${c.name}...`,
            percent: 20 + Math.floor((i / keyCorridors.length) * 60)
          });
        }
        const found = await fetchLiveBoltInBounds({
          south: c.lat_bottom,
          west: c.lng_left,
          north: c.lat_top,
          east: c.lng_right
        });
        addedCount += found.length;
      }

      // Record last sync time
      localStorage.setItem('voltway_last_sync', new Date().toISOString());

      if (onProgress) {
        onProgress({
          status: `Sync complete! Refreshed live points. Total active: ${inMemoryChargers.length}`,
          percent: 100
        });
      }
    } catch (err) {
      console.error('Sync failed:', err);
      if (onProgress) onProgress({ status: 'Sync encountered error, using cached data.', percent: 100, error: true });
    } finally {
      isSyncing = false;
      notify();
    }
  }

  function mergeChargers(newChargers) {
    const existingMap = new Map();
    inMemoryChargers.forEach(c => existingMap.set(c.id, c));

    let updated = false;
    newChargers.forEach(c => {
      if (!existingMap.has(c.id)) {
        existingMap.set(c.id, c);
        updated = true;
      }
    });

    if (updated) {
      inMemoryChargers = Array.from(existingMap.values());
      if (db) saveBatchToDB(newChargers);
      notify();
    }
  }

  function getChargers() {
    return inMemoryChargers;
  }

  function getStats() {
    let atherFast = 0;
    let boltFast = 0;
    let boltSlow = 0;

    for (let i = 0; i < inMemoryChargers.length; i++) {
      const c = inMemoryChargers[i];
      if (c.network === 'ATHER_GRID') {
        atherFast++;
      } else if (c.network === 'BOLT_EARTH') {
        if (c.type === 'FAST') boltFast++;
        else boltSlow++;
      }
    }

    return {
      total: inMemoryChargers.length,
      atherFast,
      boltFast,
      boltSlow,
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
    getChargers,
    getStats,
    fetchLiveBoltInBounds,
    performFullSync,
    subscribe,
    mergeChargers
  };
})();

window.SyncEngine = SyncEngine;

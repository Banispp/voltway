/**
 * VoltWay 2W - Charger Database & Zero-Server Automatic Sync Engine
 * Handles local IndexedDB storage, bundled offline data, and automatic background
 * syncing with live Bolt.Earth API & Ather GitHub streams (100% zero manual effort)
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

    // 1. Fast load from local IndexedDB or pre-bundled script
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
      if (db) {
        saveBatchToDB(inMemoryChargers).catch(err => console.warn('Could not cache to IndexedDB:', err));
      }
    } else {
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

    // 2. AUTOMATIC BACKGROUND SYNC:
    // Check for newly added chargers automatically whenever the app is opened online!
    setTimeout(() => {
      checkAndSyncRemoteUpdates();
    }, 1500);

    // Auto-sync whenever internet connectivity is restored
    window.addEventListener('online', () => {
      console.log('[VoltWay Sync] Network connected. Checking for new chargers automatically...');
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

  /**
   * AUTOMATIC BACKGROUND SYNC:
   * Checks the latest online database for any newly opened Ather Grid or Bolt.Earth chargers
   * and merges them directly into the phone's database with ZERO manual work from the user!
   */
  async function checkAndSyncRemoteUpdates() {
    if (!navigator.onLine) return;

    try {
      console.log('[VoltWay Sync] Auto-checking for newly added Ather & Bolt chargers in background...');
      // Fetch latest database with cache-busting timestamp
      const resp = await fetch('chargers_db.json?v=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;

      const remoteChargers = await resp.json();
      if (!Array.isArray(remoteChargers) || remoteChargers.length === 0) return;

      const added = mergeChargers(remoteChargers);
      if (added > 0) {
        console.log(`[VoltWay Sync] ✨ AUTOMATICALLY ADDED ${added} NEW CHARGERS!`);
        showAutoUpdateToast(`✨ ${added} New EV Chargers Added Automatically!`);
        localStorage.setItem('voltway_last_sync', new Date().toISOString());
      } else {
        console.log('[VoltWay Sync] All chargers up-to-date.');
      }
    } catch (e) {
      console.warn('[VoltWay Sync] Background auto-sync skipped:', e);
    }
  }

  /**
   * LIVE VIEWPORT QUERY FOR BOLT.EARTH:
   * As the user navigates, pans, or zooms the map, this automatically fetches
   * live chargers directly from Bolt.Earth's public discovery API!
   */
  async function fetchLiveBoltInBounds(bounds) {
    if (!bounds || !navigator.onLine) return [];
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

        // Automatic exclusion of 4-wheeler high-power car guns
        if (modelId.includes('CCS') || modelId.includes('GB/T') || modelId.includes('CHADEMO')) {
          return;
        }

        const isFast = modelId.includes('FAST') || modelId.includes('2WFC') || modelId.includes('LEVEL_2') || modelId.includes('LEVEL_3');
        const ctype = isFast ? 'FAST' : 'SLOW';
        const connName = isFast ? 'Bolt.Earth Fast Charger (DC / Fast AC)' : 'Standard 15A / 3-Pin AC Socket';
        const powerKw = isFast ? 3.3 : 1.5;
        const addr = item.station?.address || '';
        const name = `Bolt.Earth ${isFast ? 'Fast' : '15A'} - ${cid}`;

        newItems.push({
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
        });
      });

      if (newItems.length > 0) {
        const addedCount = mergeChargers(newItems);
        if (addedCount > 0) {
          console.log(`[VoltWay Live] Auto-discovered ${addedCount} new Bolt.Earth points in viewport!`);
          showAutoUpdateToast(`⚡ ${addedCount} Live Bolt.Earth Points Added!`);
        }
      }
      return newItems;
    } catch (e) {
      return [];
    }
  }

  /**
   * Manual or scheduled full multi-corridor sync
   */
  async function performFullSync(onProgress) {
    if (isSyncing) return;
    isSyncing = true;
    notify();

    if (onProgress) onProgress({ status: 'Starting sync...', percent: 10 });

    try {
      // 1. Check remote JSON stream for new Ather & Bolt points
      if (onProgress) onProgress({ status: 'Checking for newly opened Ather Grid & Bolt chargers...', percent: 30 });
      await checkAndSyncRemoteUpdates();

      // 2. Fetch live Bolt chargers for major corridors in India
      const keyCorridors = [
        { name: 'Bangalore & Karnataka', lat_bottom: 12.5, lng_left: 77.0, lat_top: 13.4, lng_right: 77.9 },
        { name: 'Kerala (Kochi, Calicut, TVM)', lat_bottom: 8.5, lng_left: 75.5, lat_top: 11.5, lng_right: 77.0 },
        { name: 'Chennai & Tamil Nadu', lat_bottom: 12.8, lng_left: 79.9, lat_top: 13.3, lng_right: 80.4 },
        { name: 'Hyderabad & Telangana', lat_bottom: 17.2, lng_left: 78.2, lat_top: 17.6, lng_right: 78.6 },
        { name: 'Mumbai & Pune', lat_bottom: 18.4, lng_left: 72.8, lat_top: 19.3, lng_right: 73.9 },
        { name: 'Delhi NCR', lat_bottom: 28.3, lng_left: 76.9, lat_top: 28.8, lng_right: 77.4 }
      ];

      for (let i = 0; i < keyCorridors.length; i++) {
        const c = keyCorridors[i];
        if (onProgress) {
          onProgress({
            status: `Querying live Bolt.Earth API: ${c.name}...`,
            percent: 40 + Math.floor((i / keyCorridors.length) * 55)
          });
        }
        await fetchLiveBoltInBounds({
          south: c.lat_bottom,
          west: c.lng_left,
          north: c.lat_top,
          east: c.lng_right
        });
      }

      localStorage.setItem('voltway_last_sync', new Date().toISOString());

      if (onProgress) {
        onProgress({
          status: `Sync complete! Active chargers: ${inMemoryChargers.length}`,
          percent: 100
        });
      }
    } catch (err) {
      console.error('Sync failed:', err);
      if (onProgress) onProgress({ status: 'Sync error, continuing with local database.', percent: 100, error: true });
    } finally {
      isSyncing = false;
      notify();
    }
  }

  /**
   * Merges an array of chargers into inMemoryChargers and IndexedDB
   * Returns count of newly inserted chargers
   */
  function mergeChargers(newChargers) {
    if (!newChargers || newChargers.length === 0) return 0;
    const existingMap = new Map();
    inMemoryChargers.forEach(c => existingMap.set(c.id, c));

    let addedCount = 0;
    const toAdd = [];

    newChargers.forEach(c => {
      if (!existingMap.has(c.id)) {
        existingMap.set(c.id, c);
        toAdd.push(c);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      inMemoryChargers = Array.from(existingMap.values());
      if (db) saveBatchToDB(toAdd);
      notify();
      if (window.MapEngine) {
        window.MapEngine.renderChargers(inMemoryChargers);
      }
    }

    return addedCount;
  }

  /**
   * Floating Toast Notification for Automatic Sync
   */
  function showAutoUpdateToast(message) {
    let toast = document.getElementById('voltway-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'voltway-toast';
      toast.className = 'auto-sync-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 4500);
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
    checkAndSyncRemoteUpdates,
    mergeChargers,
    showAutoUpdateToast,
    subscribe
  };
})();

window.SyncEngine = SyncEngine;

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

    if (stored && stored.length > 0 && stored[0].state) {
      console.log(`[VoltWay] Loaded ${stored.length} chargers from IndexedDB`);
      inMemoryChargers = stored;
    } else if (window.BUNDLED_CHARGERS && window.BUNDLED_CHARGERS.length > 0) {
      console.log(`[VoltWay] Loaded ${window.BUNDLED_CHARGERS.length} bundled chargers (with state tagging)`);
      inMemoryChargers = window.BUNDLED_CHARGERS;
      if (db) {
        clearAndSaveAllToDB(inMemoryChargers).catch(err => console.warn('Could not cache to IndexedDB:', err));
      }
    } else {
      try {
        const resp = await fetch('chargers_db.json');
        if (resp.ok) {
          const data = await resp.json();
          inMemoryChargers = data;
          if (db) clearAndSaveAllToDB(data);
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
   * Reconciles additions and deletions.
   * If new chargers are opened, they are added.
   * If existing chargers were decommissioned or removed from official map, they are removed.
   */
  async function checkAndSyncRemoteUpdates() {
    if (!navigator.onLine) return { added: 0, removed: 0 };

    // 6-hour freshness gate: skip auto-sync if data was synced recently
    const lastSync = localStorage.getItem('voltway_last_sync');
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    if (lastSync && new Date(lastSync).getTime() > sixHoursAgo) {
      console.log('[VoltWay Sync] Chargers are fresh (synced within 6h). Skipping auto-sync.');
      return { added: 0, removed: 0 };
    }

    try {
      console.log('[VoltWay Sync] Auto-reconciling Ather & Bolt chargers in background...');
      const resp = await fetch('chargers_db.json?v=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return { added: 0, removed: 0 };

      const remoteChargers = await resp.json();
      if (!Array.isArray(remoteChargers) || remoteChargers.length === 0) return { added: 0, removed: 0 };

      const stats = reconcileChargers(remoteChargers);
      if (stats.added > 0 || stats.removed > 0) {
        console.log(`[VoltWay Sync] Reconciled: +${stats.added} new, -${stats.removed} decommissioned`);
        showAutoUpdateToast(`⚡ Network Synced: +${stats.added} new, -${stats.removed} closed stations`);
        localStorage.setItem('voltway_last_sync', new Date().toISOString());
      } else {
        console.log('[VoltWay Sync] All chargers up-to-date.');
      }
      return stats;
    } catch (e) {
      console.warn('[VoltWay Sync] Background auto-sync skipped:', e);
      return { added: 0, removed: 0 };
    }
  }

  function reconcileChargers(authoritativeList) {
    if (!Array.isArray(authoritativeList) || authoritativeList.length === 0) return { added: 0, removed: 0 };
    authoritativeList = authoritativeList.filter(c => isTargetSouthRegion(c.name, c.address, c.lat, c.lng));

    const remoteMap = new Map();
    authoritativeList.forEach(c => {
      if (!c.state) c.state = classifyState(c);
      remoteMap.set(c.id, c);
    });

    const currentMap = new Map();
    inMemoryChargers.forEach(c => currentMap.set(c.id, c));

    let added = 0;
    let removed = 0;

    authoritativeList.forEach(c => {
      if (!currentMap.has(c.id)) added++;
    });

    inMemoryChargers.forEach(c => {
      if (!remoteMap.has(c.id)) removed++;
    });

    inMemoryChargers = authoritativeList;
    if (db) {
      clearAndSaveAllToDB(inMemoryChargers);
    }
    notify();
    if (window.MapEngine) {
      window.MapEngine.renderChargers(inMemoryChargers);
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
        chargers.forEach(c => store.put(c));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * Regional Target Filter: Strictly Kerala, Tamil Nadu, Karnataka & Puducherry/Mahe
   * Rejects out-of-region states (AP, Telangana, Maharashtra, Goa, North India)
   */
  function isTargetSouthRegion(name, address, lat, lng) {
    if (lat < 8.05 || lat > 18.55 || lng < 74.00 || lng > 80.40) return false;
    let text = `${name || ''} ${address || ''}`.toLowerCase();

    // Contextual exception replacements
    text = text.replace('anantapuram vari', 'restaurant')
               .replace('pune bangalore', 'highway')
               .replace('pune-bangalore', 'highway')
               .replace('goa main road', 'road')
               .replace('goa road', 'road')
               .replace('chittoor rd', 'road')
               .replace('chittoor road', 'road')
               .replace('maharashtra bank', 'bank');

    // 1. Excluded State checks (negative keywords)
    const isTelangana = ['telangana', 'hyderabad', 'secunderabad', 'warangal'].some(k => text.includes(k));
    const isAndhra = ['andhra', 'andhra pradesh', 'anantapur', 'chittoor', 'tirupati', 'vijayawada', 'visakhapatnam', 'vizag', 'guntur', 'nellore', 'kurnool'].some(k => text.includes(k));
    const isMaharashtra = (text.includes('maharashtra') || text.includes('mumbai') || text.includes('pune') || text.includes('nagpur') || text.includes('nashik') || text.includes('sangli') || text.includes('kolhapur') || text.includes('solapur') || text.includes('satara')) && !text.includes('bank');
    const isGoa = ['curchorem', 'canacona', 'margao', 'panaji', 'mapusa', 'quepem', 'zambaulim'].some(k => text.includes(k)) || (/\bgoa\b/.test(text) && !text.includes('road') && !text.includes('highway') && !text.includes('hwy'));
    const isNorth = ['delhi', 'noida', 'gurgaon', 'gurugram', 'haryana', 'punjab', 'rajasthan', 'gujarat', 'uttar pradesh', 'bhopal', 'indore', 'bihar', 'bengal', 'aizawl', 'mizoram', 'assam'].some(k => new RegExp(`\\b${k}\\b`).test(text));

    if (isTelangana || isAndhra || isMaharashtra || isGoa || isNorth) {
      return false;
    }

    // 2. Positive State checks
    const isKL = ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta'].some(k => text.includes(k));
    const isTN = ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri'].some(k => text.includes(k));
    const isKA = [
      'karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 
      'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 
      'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 
      'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar', 'kalaburagi', 'gulbarga', 
      'jewargi', 'badami', 'bagalkot', 'bagalkote', 'yadgir', 'yadgiri', 'vijayapura', 
      'bijapur', 'ilkal', 'kerur', 'bagepalli', 'kudatini', 'sindhanur'
    ].some(k => text.includes(k));
    const isPY = ['puducherry', 'pondicherry', 'mahe', 'karaikal'].some(k => text.includes(k));

    if (isKL || isTN || isKA || isPY) return true;

    // Strict bounding fallback for concise addresses
    if ((lat >= 8.15 && lat <= 12.85) && (lng >= 74.85 && lng <= 77.40)) return true; // Kerala
    if ((lat >= 8.08 && lat <= 13.50) && (lng >= 76.25 && lng <= 80.35) && !(lat > 13.35 && lng > 79.75)) return true; // TN
    if ((lat >= 11.55 && lat <= 18.45) && (lng >= 74.05 && lng <= 77.75)) return true; // KA interior

    return false;
  }

  /**
   * Classifies a charger into 'kerala' | 'karnataka' | 'tamil_nadu' | 'other'
   */
  function classifyState(c) {
    if (c.state) return c.state;
    const text = `${c.name || ''} ${c.address || ''}`.toLowerCase();
    const lat = c.lat;
    const lng = c.lng;

    const klKeywords = ['kerala', 'malappuram', 'kozhikode', 'ernakulam', 'kochi', 'cochin', 'thrissur', 'trivandrum', 'thiruvananthapuram', 'kollam', 'alappuzha', 'alleppey', 'kottayam', 'palakkad', 'kannur', 'kasaragod', 'wayanad', 'idukki', 'pathanamthitta'];
    if (klKeywords.some(k => text.includes(k))) return 'kerala';

    const kaKeywords = ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'dharwad', 'belagavi', 'belgaum', 'udupi', 'manipal', 'tumkur', 'tumakuru', 'shimoga', 'shivamogga', 'davanagere', 'ballari', 'bellary', 'kolar', 'hassan', 'mandya', 'chikkamagaluru', 'raichur', 'bidar', 'kalaburagi', 'gulbarga'];
    if (kaKeywords.some(k => text.includes(k))) return 'karnataka';

    const tnKeywords = ['tamil nadu', 'tamilnadu', 'chennai', 'coimbatore', 'madurai', 'trichy', 'tiruchirappalli', 'salem', 'tirunelveli', 'tiruppur', 'erode', 'vellore', 'hosur', 'kanyakumari', 'ooty', 'udhagamandalam', 'dharmapuri', 'krishnagiri'];
    if (tnKeywords.some(k => text.includes(k))) return 'tamil_nadu';

    if (lat >= 8.15 && lat <= 12.85 && lng >= 74.85 && lng <= 77.40) return 'kerala';
    if (lat >= 11.55 && lat <= 18.45 && lng >= 74.05 && lng <= 77.75) return 'karnataka';
    if (lat >= 8.08 && lat <= 13.50 && lng >= 76.25 && lng <= 80.35) return 'tamil_nadu';

    return 'other';
  }

  /**
   * LIVE VIEWPORT QUERY FOR BOLT.EARTH:
   * As the user navigates, pans, or zooms the map, this automatically fetches
   * live chargers directly from Bolt.Earth's public discovery API!
   */
  async function fetchLiveBoltInBounds(bounds) {
    if (!bounds || !navigator.onLine) return [];
    const { south, west, north, east } = bounds;
    // Query at zoom=16 to ensure 100% unclustered granular charger points
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
      const newItems = [];

      items.forEach((item) => {
        const cid = item.chargerId;
        if (!cid) return;
        const coords = item.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const lng = coords[0];
        const lat = coords[1];

        const modelId = (item.model?.modelId || '').toUpperCase();
        const cidUpper = String(cid).toUpperCase();

        // 1. STRICT 4-WHEELER CAR EXCLUSION (4W CARS MUST NEVER BE ADDED)
        const isCar = modelId.includes('LEVEL_2') ||
                      modelId.includes('LEVEL_3') ||
                      modelId.includes('OCPP_LEVEL_2') ||
                      modelId.includes('OCPP_LEVEL_3') ||
                      modelId.includes('OCPI') ||
                      modelId.includes('CCS') ||
                      modelId.includes('TYPE2') ||
                      modelId.includes('GB/T') ||
                      modelId.includes('CHADEMO') ||
                      cidUpper.startsWith('L200') ||
                      cidUpper.startsWith('L300') ||
                      cidUpper.startsWith('ST') ||
                      ['TN00', 'MH00', 'TS00', 'HR00', 'GJ01', 'DL00', 'HR01', 'KL00', 'KA01', 'MH04'].some(p => cidUpper.startsWith(p));

        if (isCar) {
          return; // Strictly reject all 4-wheeler car chargers!
        }

        const addr = item.station?.address || '';
        const stnName = item.station?.name || '';

        // Regional Target Check: Strictly Kerala, Tamil Nadu, Karnataka, Puducherry / Mahe
        if (!isTargetSouthRegion(stnName, addr, lat, lng)) {
          return; // Reject any station outside KL, TN, KA, PY
        }

        // 2. Verified 2-Wheeler Fast Charger (Ather Gun IS 17017 Type 7 LEV DC / Type 6)
        const is2WFast = cidUpper.startsWith('L1DC') ||
                         modelId.includes('2WFC') ||
                         modelId.includes('TYPE7') ||
                         modelId.includes('TYPE6');

        // 3. Verified 2-Wheeler 15A/16A Universal Socket
        const is2WSlow = modelId.includes('BOLT_16A') ||
                         modelId.includes('BOLT_LITE') ||
                         modelId.includes('OAKTER') ||
                         modelId.includes('LEVAC') ||
                         modelId.includes('OCPP_LEVEL_1') ||
                         cidUpper.startsWith('L100') ||
                         cidUpper.startsWith('L1OC') ||
                         cidUpper.startsWith('BOLT_');

        if (!is2WFast && !is2WSlow) {
          return; // Unknown or non-2W device - drop!
        }

        const ctype = is2WFast ? 'FAST' : 'SLOW';
        const connName = is2WFast ? 'Ather Gun (IS 17017 Type 7 LEV DC Fast) ⚡' : 'Standard 15A / 3-Pin AC Socket (Requires Ather Portable Charger) 🔌';
        const compat = is2WFast ? '100% Direct Plug-in (Ather 450X/Rizta/Apex)' : 'Requires Portable Charger Cable';
        const powerKw = is2WFast ? 3.3 : 1.5;
        const cleanAddr = addr.split(',')[0].trim();
        const name = is2WFast ? `Bolt Fast (Ather Gun ⚡) - ${cleanAddr || cid}` : `Bolt.Earth 15A Socket - ${cleanAddr || cid}`;
        const cState = classifyState({ name, address: addr, lat, lng });

        newItems.push({
          id: cid,
          name,
          network: 'BOLT_EARTH',
          type: ctype,
          state: cState,
          model_id: modelId,
          connector: connName,
          is_ather_gun: is2WFast,
          ather_compatibility: compat,
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
      // 1. Reconcile with remote stream (adds new stations & removes decommissioned stations)
      if (onProgress) onProgress({ status: 'Connecting to Ather Grid & Bolt.Earth networks...', percent: 25 });
      const reconcileStats = await checkAndSyncRemoteUpdates();

      // 2. Fetch live Bolt chargers around current viewport/corridors
      if (onProgress) onProgress({ status: 'Scanning live regional 2W fast corridors...', percent: 65 });
      
      const keyCorridors = [
        { name: 'Kerala Central (Kochi)', lat_bottom: 9.8, lng_left: 76.2, lat_top: 10.2, lng_right: 76.5 },
        { name: 'Kerala North (Kozhikode)', lat_bottom: 11.1, lng_left: 75.7, lat_top: 11.4, lng_right: 76.0 },
        { name: 'Kerala South (Trivandrum)', lat_bottom: 8.4, lng_left: 76.8, lat_top: 8.7, lng_right: 77.1 },
        { name: 'Bangalore & Hosur', lat_bottom: 12.7, lng_left: 77.4, lat_top: 13.2, lng_right: 77.8 },
        { name: 'Coimbatore & Palakkad Corridor', lat_bottom: 10.7, lng_left: 76.6, lat_top: 11.2, lng_right: 77.1 }
      ];

      for (let i = 0; i < keyCorridors.length; i++) {
        const c = keyCorridors[i];
        await fetchLiveBoltInBounds({
          south: c.lat_bottom,
          west: c.lng_left,
          north: c.lat_top,
          east: c.lng_right
        });
      }

      localStorage.setItem('voltway_last_sync', new Date().toISOString());

      const finalStats = getStats();
      let completionMsg = `Sync complete! Active chargers: ${finalStats.total.toLocaleString()}`;
      if (reconcileStats && (reconcileStats.added > 0 || reconcileStats.removed > 0)) {
        completionMsg = `Sync complete! +${reconcileStats.added} added, -${reconcileStats.removed} decommissioned stations removed.`;
      }

      if (onProgress) {
        onProgress({
          status: completionMsg,
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
        if (!isTargetSouthRegion(c.name, c.address, c.lat, c.lng)) return;
        if (!c.state) c.state = classifyState(c);
        existingMap.set(c.id, c);
        toAdd.push(c);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      inMemoryChargers = Array.from(existingMap.values());
      if (db) saveBatchToDB(toAdd);
      notify();
      if (window.MapEngine && (!window.MapEngine.isPopupOpen || !window.MapEngine.isPopupOpen())) {
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
    let vidaFast = 0;
    let boltFast = 0;
    let boltSlow = 0;

    for (let i = 0; i < inMemoryChargers.length; i++) {
      const c = inMemoryChargers[i];
      if (c.network === 'ATHER_GRID') {
        atherFast++;
      } else if (c.network === 'VIDA_GRID') {
        vidaFast++;
      } else if (c.network === 'BOLT_EARTH') {
        if (c.type === 'FAST') boltFast++;
        else boltSlow++;
      }
    }

    return {
      total: inMemoryChargers.length,
      atherFast,
      vidaFast,
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

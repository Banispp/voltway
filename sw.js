// VoltWay 2W Service Worker - Version 5.50 (Aligned Cache Shell & Bounded Tile Cache)
const CACHE_NAME = 'voltway-2w-v5-72';
const TILE_CACHE_NAME = 'voltway-2w-tiles-v1';
const MAX_CACHED_TILES = 350;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './chargers_db.json',
  './css/MarkerCluster.css?v=5.50',
  './css/app.css?v=5.50',
  './js/leaflet-rotate.js?v=5.50',
  './js/leaflet.markercluster.js?v=5.50',
  './js/app.js?v=5.50',
  './js/map.js?v=5.50',
  './js/router.js?v=5.50',
  './js/battery.js?v=5.50',
  './js/navigator.js?v=5.50',
  './js/sync.js?v=5.50',
  './js/utilities.js?v=5.50',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[VoltWay SW] Pre-cache partial warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

async function trimTileCache() {
  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length > MAX_CACHED_TILES) {
      const toDelete = keys.length - MAX_CACHED_TILES;
      for (let i = 0; i < toDelete; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (e) {}
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Dynamic routing/geocoding/live charger APIs: Network-only with honest offline JSON error
  if (
    url.includes('valhalla1.openstreetmap.de') ||
    url.includes('project-osrm.org') ||
    url.includes('routing.openstreetmap.de') ||
    url.includes('api.bolt.earth') ||
    url.includes('raw.githubusercontent.com') ||
    url.includes('nominatim.openstreetmap.org') ||
    url.includes('photon.komoot.io')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ code: 'Offline', data: [], error: 'Network offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Map tiles: Cache-first / stale-while-revalidate up to bounded LRU cap (keeps viewed corridors available briefly offline)
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            cache.put(event.request, networkResp.clone());
            trimTileCache();
          }
          return networkResp;
        }).catch(() => cached || new Response('', { status: 504 }));
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Local App Shell & Chargers DB: Network-First with Offline Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request, { ignoreSearch: false }).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          // Secondary fallback ignoring query strings if offline version parameter differs
          return caches.match(event.request, { ignoreSearch: true }).then((cleanMatch) => {
            if (cleanMatch) return cleanMatch;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        });
      })
  );
});

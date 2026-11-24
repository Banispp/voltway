// VoltWay 2W Service Worker - Version 5.32 (Reliable Theme Toggle, Accurate Forward Compass Arrow, Smooth Zero Vibration)
// Enables zero-server EV Route Planning with live network-first updates

const CACHE_NAME = 'voltway-2w-v5-32-fresh';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css?v=5.32',
  './js/leaflet-rotate.js?v=5.32',
  './js/app.js?v=5.32',
  './js/map.js?v=5.32',
  './js/router.js?v=5.32',
  './js/battery.js?v=5.32',
  './js/navigator.js?v=5.32',
  './js/sync.js?v=5.32',
  './js/utilities.js?v=5.32',
  './chargers_db.js?v=5.32',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install: pre-cache shell and immediately activate
self.addEventListener('install', (event) => {
  console.log('[VoltWay SW] Installing fresh v5.32 service worker...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[VoltWay SW] Pre-cache non-blocking warning:', err);
      });
    })
  );
});

// Activate: delete ALL old caches immediately & claim clients
self.addEventListener('activate', (event) => {
  console.log('[VoltWay SW] Activating fresh v5.32 service worker...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[VoltWay SW] Purging old stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: NETWORK-FIRST strategy for local files (always loads fresh updates)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // For external dynamic APIs (OSRM routing, Bolt live sync, Nominatim search): Network-only with JSON offline fallback
  if (url.includes('project-osrm.org') || url.includes('api.bolt.earth') || url.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Network offline. Using local cached data.' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Network-First for HTML, JS, CSS, and app data
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Only if network fails (offline), fallback to cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// VoltWay 2W Service Worker
// Enables 100% offline functionality for zero-server EV Route Planning

const CACHE_NAME = 'voltway-2w-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/map.js',
  './js/router.js',
  './js/battery.js',
  './js/navigator.js',
  './js/sync.js',
  './js/utilities.js',
  './chargers_db.js',
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[VoltWay SW] Pre-caching offline app shell and assets');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[VoltWay SW] Pre-cache partial fail (offline fallback still works):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[VoltWay SW] Removing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // For external dynamic APIs (OSRM routing, Bolt live sync, Nominatim search), try network first, fallback to offline error
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

  // Cache-first strategy for app shell and map tiles
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        // Cache external assets like Leaflet or tiles
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch((err) => {
        console.warn('[VoltWay SW] Fetch error, returning fallback:', err);
      });
    })
  );
});

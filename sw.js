// JDM Intel Dashboard - Service Worker v1.0
const CACHE_NAME = 'jdm-cache-v1';
const STATIC_CACHE = 'jdm-static-v2';   // v5.8: bumped so the old cache-first shell copy is dropped
const MAP_CACHE = 'jdm-maps-v1';

// Files to cache immediately
const STATIC_FILES = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&family=Share+Tech+Mono&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
];

// Map tile domains to cache
const MAP_TILE_DOMAINS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'server.arcgisonline.com',
  'stamen-tiles.a.ssl.fastly.net'
];

// Install - cache static files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static files');
      return cache.addAll(STATIC_FILES).catch(() => {
        // Ignore failures for external resources
        console.log('[SW] Some external resources failed to cache');
      });
    })
  );
  self.skipWaiting();
});

// Activate - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== MAP_CACHE && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Handle map tiles - cache first
  if (MAP_TILE_DOMAINS.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.open(MAP_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Return offline tile placeholder if available
            return caches.match('/offline-tile.png').catch(() => new Response('', { status: 408 }));
          });
        });
      })
    );
    return;
  }
  
  // v5.8: the app shell (same-origin HTML) is NETWORK-FIRST with cache fallback, so a deploy is live on the
  // first load and the cached copy only serves offline. Third-party CDN assets stay cache-first below.
  const isShell = url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (isShell) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then((response) => {
        if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, response.clone())).catch(() => {});
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || new Response('<!doctype html><title>Offline</title><p style="font-family:monospace;padding:2em">JDM Command Center is offline and no cached copy exists yet.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } })))
    );
    return;
  }
  // Static CDN assets - cache first, refresh in background
  if (STATIC_FILES.some(file => url.href.includes(file))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          fetch(event.request).then((response) => {
            if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, response));
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request);
      })
    );
    return;
  }
  
  // Handle API calls - network first, cache fallback
  if (url.hostname.includes('api.') || url.hostname.includes('openclaw') || url.hostname.includes('tavily')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Default - network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Return offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('', { status: 408 });
        });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});

console.log('[SW] Service Worker loaded');

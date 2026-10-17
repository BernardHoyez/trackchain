const CACHE_NAME = 'trackchain-cache-v1';
const APP = ['./', './index.html', './style.css', './app.js', './manifest.json'];
const VENDOR = ['./vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png', './vendor/leaflet/images/layers-2x.png',
  './vendor/jszip.min.js', './icons/icon-192.png', './icons/icon-512.png'];
const path = (f) => new URL(f, self.registration.scope).pathname;
const APP_PATHS = new Set(APP.map(path));

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll([...APP, ...VENDOR])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    clients.claim(),
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  ]));
});

self.addEventListener('fetch', (event) => {
  const req = event.request, url = new URL(req.url);
  // Tuiles, API IGN de routage, etc. : on laisse passer, sans cache.
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Fichiers de l'app : network-first (jamais de page obsolète avec du réseau)
  if (req.mode === 'navigate' || APP_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match(new URL('./index.html', self.registration.scope))))
    );
    return;
  }
  // Bibliothèques vendorisées, icônes : cache-first
  event.respondWith(caches.match(req).then((m) => m || fetch(req)));
});

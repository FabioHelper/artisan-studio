// App-shell cache for offline use. Network first (so a new deploy shows up on the next open), cache as fallback.
// web/selftest.mjs checks that SHELL lists every file of the app, so add new files here.
const CACHE = 'macrofy-app-v6';
const SHELL = [
  './', 'index.html', 'app.css', 'app.mjs', 'lib.mjs', 'db.mjs', 'manifest.webmanifest',
  'estimate.mjs', 'accuracy.mjs', 'vendor/calibration.mjs', 'vendor/metrics.mjs', 'vendor/schema-core.mjs', 'vendor/lookup-core.mjs', 'vendor/estimate-core.mjs', 'vendor/models.mjs', 'vendor/autoseg.mjs',
  'data/vocab.json', 'data/priors.json', 'data/calibration.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

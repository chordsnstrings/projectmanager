// Cadence service worker — gives the PWA an offline app-shell and satisfies the
// installability criteria. Deliberately simple: it never caches API/auth
// responses (always live data), serves hashed build assets cache-first, and
// falls back to the cached shell for navigations when offline.
const VERSION = 'cadence-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Path prefixes owned by the API — never cache these.
const API_PREFIXES = [
  '/healthz', '/me', '/api', '/auth', '/webhooks', '/tasks', '/sessions',
  '/dashboard', '/flags', '/questions', '/nudges', '/completions',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/app-icon.svg'])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return API_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // live data — straight to network

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put('/', res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(request))),
    );
    return;
  }

  // Hashed build assets / icons: cache-first with background refresh.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|css|js|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

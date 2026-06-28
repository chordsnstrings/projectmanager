// Cadence service worker — gives the PWA an offline app-shell and satisfies the
// installability criteria. Deliberately simple: it never caches API/auth
// responses (always live data), serves hashed build assets cache-first, and
// falls back to the cached shell for navigations when offline.
const VERSION = 'cadence-v3';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Path prefixes owned by the API — never cache these.
const API_PREFIXES = [
  '/healthz', '/me', '/api', '/auth', '/webhooks', '/tasks', '/sessions',
  '/dashboard', '/flags', '/questions', '/nudges', '/completions', '/push',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/app-icon.svg'])).catch(() => {}),
  );
  self.skipWaiting();
});

// The page asks the waiting worker to activate immediately (on user "Reload").
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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

// ── Web Push ────────────────────────────────────────────────────────────────
// Render an incoming push as a notification. Payload is JSON from the server:
// { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Cadence', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Cadence';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab (navigating it to the target) or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

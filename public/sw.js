// Atlas Universe service worker — deliberately minimal.
//
// This app shows live, per-user financial data (portfolio value, drift, governance
// checks). Caching page HTML or API responses risks silently showing stale numbers
// as if they were current, which is worse than no offline support at all. So this
// worker only ever caches static, version-stamped assets (icons, manifest) and a
// dedicated offline fallback page — never a dashboard route or an /api/ response.
//
// Bump CACHE_NAME whenever the precached asset list changes, so old caches are
// cleared on activate rather than accumulating.
const CACHE_NAME = "atlas-universe-v1";
const PRECACHE = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: always go to the network (never serve stale portfolio pages).
  // Only fall back to the offline page when there's truly no connection.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // Precached static assets only: cache-first, refreshed in the background.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
          return res;
        }).catch(() => cached);
        return cached ?? network;
      })
    );
  }
  // Everything else (API routes, _next assets, etc.) — no interception, straight to network.
});

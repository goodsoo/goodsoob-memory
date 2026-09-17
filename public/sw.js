// 짱수메모리 — PWA App Shell Service Worker
// Strategy: network-first for the app shell; /api/* untouched (vault/outbox owns that).
// Bump VERSION on each deploy to invalidate the old cache.
const VERSION = "v1";
const CACHE_NAME = `jjangsoo-shell-${VERSION}`;

// Static assets that form the installable shell.
// Vite's hashed filenames change each build — we cache everything from these
// origins rather than a fixed list, and network-first means users always get
// fresh content when online.
const SHELL_ORIGINS = [self.location.origin];

// ── Install: pre-cache only the bare minimum ──────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/", "/index.html"]))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old shell caches ────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k.startsWith("jjangsoo-shell-") && k !== CACHE_NAME
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, cache fallback ─────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Leave API calls, chrome-extension, and cross-origin requests alone.
  if (!SHELL_ORIGINS.includes(url.origin)) return;
  if (url.pathname.startsWith("/api/")) return;
  // Only cache GET requests.
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Clone before consuming — streams can only be read once.
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return networkResponse;
      })
      .catch(() =>
        // Offline: serve from cache. For navigation requests fall back to /
        // so the SPA hash-router can still boot.
        caches.match(request).then(
          (cached) =>
            cached ||
            (request.mode === "navigate"
              ? caches.match("/index.html")
              : new Response("Offline", { status: 503 }))
        )
      )
  );
});

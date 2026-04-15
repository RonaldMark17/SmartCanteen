/**
 * sw.js  –  SmartCanteen AI Service Worker
 * ─────────────────────────────────────────
 * Strategy: Cache-First for static assets, Network-First for API calls.
 * Offline transactions are stored in IndexedDB by the app and synced here.
 */

const CACHE_NAME   = "smartcanteen-v2";
const API_BASE     = "/api";

// Static assets to pre-cache on install
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/js/app.js",
  "/js/idb.js",
  "/js/sync.js",
  "/js/api.js",
  // CDN resources cached at runtime
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        STATIC_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(asset, { cache: "no-cache" });
            if (response.ok) {
              await cache.put(asset, response);
            }
          } catch (_) {
            // Ignore individual pre-cache failures so the service worker still installs.
          }
        })
      );
    })
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET & cross-origin requests
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // API calls → Network-First with cache fallback
  if (url.pathname.startsWith(API_BASE)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets → Cache-First
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response(
      JSON.stringify({ error: "You are offline and no cached data is available." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache    = await caches.open(CACHE_NAME);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Offline and not cached → return the app shell
    return caches.match("/");
  }
}

// ── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-offline-transactions") {
    event.waitUntil(syncOfflineTransactions());
  }
});

async function syncOfflineTransactions() {
  // Notify all clients to run their sync routine
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage({ type: "TRIGGER_SYNC" }));
}

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const opts = {
    body:    data.body    || "New notification from SmartCanteen",
    icon:    data.icon    || "/icon-192.png",
    badge:   data.badge   || "/icon-192.png",
    vibrate: [100, 50, 100],
    data:    { url: data.url || "/" },
    actions: data.actions || [],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || "SmartCanteen AI", opts)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || "/")
  );
});
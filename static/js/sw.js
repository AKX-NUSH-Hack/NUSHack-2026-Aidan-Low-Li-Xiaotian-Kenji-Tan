/* =====================================================================
   sw.js
   ===================================================================== */
const CACHE = "listly-v1.3";
const ASSETS = [
  "/", "/login", "/checklist", "/create", "/settings", "/manage",
  "/static/css/style.css",
  "/static/js/crypto.js", "/static/js/app.js", "/static/js/wizard.js", "/static/js/qr-modal.js", "/static/js/login.js", "/static/js/home.js",
  "/static/js/checklist.js", "/static/js/create.js", "/static/js/settings.js", "/static/js/manage.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API calls and QR images are never served from cache.
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/qr.svg") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/")))
  );
});

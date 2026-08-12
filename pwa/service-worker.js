const SHELL_CACHE = "izzy-shell-v1";
const DATA_CACHE = "izzy-data-v1";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icons/app-icon-192.png", "./icons/app-icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", event => event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![SHELL_CACHE, DATA_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/data/calendar.json") || url.pathname.endsWith("/data/status.json")) {
    event.respondWith(fetch(event.request).then(response => { if (response.ok) caches.open(DATA_CACHE).then(cache => cache.put(event.request, response.clone())); return response; }).catch(() => caches.match(event.request)));
    return;
  }
  if (url.origin === self.location.origin) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(event.request, response.clone())); return response; })));
});

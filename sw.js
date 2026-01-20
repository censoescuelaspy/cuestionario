/* Service Worker básico para cache de recursos estáticos (soporte offline).
   Nota: este SW no cachea respuestas dinámicas de Apps Script.
*/
const CACHE_NAME = "sidie-cache-v5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/js/app.js",
  "./assets/js/config.js",
  "./assets/js/api.js",
  "./assets/js/offline_queue.js",
  "./assets/js/ui.js",
  "./assets/js/forms.js",
  "./schemas/areas_recreacion.json",
  "./schemas/aulas.json",
  "./schemas/bloques_niveles.json",
  "./schemas/dependencias.json",
  "./schemas/exteriores.json",
  "./schemas/general.json",
  "./schemas/laboratorios.json",
  "./schemas/sanitarios.json",
  "./schemas/servicios.json",
  "./schemas/talleres.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k===CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cache-first para recursos de GitHub Pages (mismo origen)
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return resp;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Network-first para API (Apps Script)
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
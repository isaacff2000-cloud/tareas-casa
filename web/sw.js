// Guarda la app en el móvil para que abra al instante y funcione sin cobertura.
// Los datos no pasan por aquí: los guarda la propia app (localStorage) y la API nunca se guarda.
const CACHE = 'tareas-v1';
const BASE = ['/', '/app.css', '/app.js', '/almacen.js', '/nucleo.js', '/vendor/preact.js', '/vendor/hooks.js', '/vendor/htm.js',
  '/manifest.webmanifest', '/iconos/icono-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Primero la red (siempre la última versión); sin red, lo guardado
  ev.respondWith(fetch(ev.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(ev.request, copia)); }
    return r;
  }).catch(() => caches.match(ev.request).then((r) => r || caches.match('/'))));
});

// Guarda la app en el móvil para que abra al instante y funcione sin cobertura, y muestra los avisos push.
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

// Avisos push: llegan cifrados desde el portátil a través del servicio de avisos del móvil
self.addEventListener('push', (ev) => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = { cuerpo: ev.data ? ev.data.text() : '' }; }
  const tareas = [self.registration.showNotification(d.titulo || 'Tareas de casa', {
    body: d.cuerpo || '', tag: d.tag || undefined, icon: '/iconos/icono-192.png', badge: '/iconos/icono-192.png', data: { url: '/?hoy' },
  })];
  // Número de tareas que te quedan hoy en el icono (si el móvil lo permite)
  if (typeof d.pendientes === 'number' && self.navigator.setAppBadge) {
    tareas.push((d.pendientes ? self.navigator.setAppBadge(d.pendientes) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  ev.waitUntil(Promise.all(tareas));
});
// Al tocar el aviso se abre la app en «Hoy»
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (new URL(w.url).origin === self.location.origin) { w.postMessage({ ir: 'hoy' }); return w.focus(); }
    return self.clients.openWindow('/?hoy');
  }));
});

// sw.js — Service Worker mínimo para que Finzia sea instalable como app.
// No hace caché agresivo todavía (para no complicar actualizaciones futuras),
// solo cumple el requisito técnico de tener un service worker activo.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Por ahora dejamos pasar todo directo a la red (sin cachear),
  // así siempre ves la última versión que subiste a GitHub.
  event.respondWith(fetch(event.request));
});

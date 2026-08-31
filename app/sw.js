// sw.js — Service Worker de Finzia.
// Guarda una copia de la app (HTML, íconos, manifest) para que abra igual
// aunque no haya internet. Los datos siguen viviendo en Supabase — cuando no
// hay señal, los gastos/ingresos nuevos se guardan localmente y se sincronizan
// solos apenas vuelve la conexión (eso lo maneja index.html, no este archivo).

const CACHE_NAME = 'ressetia-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
      console.warn('No se pudo precachear todo el shell (no es grave):', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo aplicamos esta estrategia a pedidos de navegación (abrir la página) y
  // a los archivos del "shell" — todo lo demás (Supabase, Mercado Pago, IA)
  // sigue yendo directo a la red, sin cachear, para no mostrar datos viejos.
  const isShellRequest = APP_SHELL.some((path) => event.request.url.endsWith(path)) ||
    event.request.mode === 'navigate';

  if (!isShellRequest) {
    return; // deja que el navegador maneje el pedido normal (red directa)
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Si hay internet, actualizamos la copia guardada con la versión fresca
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return networkResponse;
      })
      .catch(() => {
        // Sin internet: devolvemos la copia guardada, para que la app abra igual
        return caches.match(event.request).then((cached) => cached || caches.match('/index.html'));
      })
  );
});

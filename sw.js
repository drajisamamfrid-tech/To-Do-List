// Service worker: caches the app shell so the app opens instantly and works offline.
// Bump CACHE_VERSION whenever you deploy changes to force phones to pick them up.
const CACHE_VERSION = 'v2';
const CACHE = `todo-${CACHE_VERSION}`;
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/config.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('todo-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Never cache Supabase API / auth / realtime traffic
  if (request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return;
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return;

  // Network first (fresh code when online), fall back to cache when offline
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(hit => hit || (request.mode === 'navigate' ? caches.match('/index.html') : undefined))
      )
  );
});

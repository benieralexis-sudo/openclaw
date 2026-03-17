/* ===== SERVICE WORKER — Mission Control PWA ===== */

const CACHE_NAME = 'mc-v9-cache';
const STATIC_ASSETS = [
  '/public/css/style.css',
  '/public/css/animations.css',
  '/public/js/utils.js',
  '/public/js/api.js',
  '/public/js/charts.js',
  '/public/js/app.js',
  '/public/js/keyboard.js',
  '/public/js/command-palette.js',
  '/public/js/prospect-drawer.js',
  '/public/js/notifications.js',
  '/public/js/chat-widget.js',
  '/public/assets/icons.svg'
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Cache-First for static, Network-First for API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls — Network-First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets — Cache-First
  if (url.pathname.startsWith('/public/')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Other requests — Network-First
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

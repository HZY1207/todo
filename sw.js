var CACHE = 'todo-v1';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/theme.js',
  './js/calendar.js',
  './js/app.js',
  './manifest.json',
  './images/icon-192.png',
  './images/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return (
        cached || fetch(e.request).then(function (res) {
          if (res.ok && e.request.url.indexOf(location.origin) === 0) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
          return res;
        })
      );
    })
  );
});
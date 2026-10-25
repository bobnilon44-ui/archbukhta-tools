/* Офлайн-кэш: после первого открытия приложение работает без сети и даже без локального сервера.
 * При изменении файлов увеличьте VERSION. */
var VERSION = 'ab-tools-v4';
var FILES = [
  './', 'index.html', 'admin.html', 'labels.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'css/admin.css', 'css/labels.css',
  'js/db.js', 'js/logic.js', 'js/ui.js', 'js/feedback.js', 'js/scanner.js',
  'js/kiosk.js', 'js/admin.js', 'js/labels.js',
  'vendor/jsQR.js', 'vendor/qrcode.js', 'css/ice.svg', 'fonts/fonts.css',
  'fonts/dela-gothic-one-cyrillic-400-normal.woff2',
  'fonts/dela-gothic-one-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-cyrillic-400-normal.woff2',
  'fonts/ibm-plex-mono-cyrillic-500-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'fonts/manrope-cyrillic-400-normal.woff2',
  'fonts/manrope-cyrillic-500-normal.woff2',
  'fonts/manrope-cyrillic-700-normal.woff2',
  'fonts/manrope-latin-400-normal.woff2',
  'fonts/manrope-latin-500-normal.woff2',
  'fonts/manrope-latin-700-normal.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Сначала сеть (локальный сервер — свежие файлы), при недоступности — кэш.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});

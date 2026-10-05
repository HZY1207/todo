/* 待办清单 Service Worker
 *
 * 改动记录（改 App 代码时请连同 CACHE 一起改，否则老用户会一直吃到旧版）：
 *   todo-v1 -> todo-v2  2026-08  完成勾、月历未排期、编辑交互、离线策略
 */
var CACHE = 'todo-v2';

// 逐个缓存，而不是 caches.addAll：addAll 是全有或全无，
// 任何一个资源 404（比如图标被删掉）都会让 install 整体失败、离线能力彻底失效。
var PRECACHE = [
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

// 导航请求优先走网络：这样 HTML 始终是最新的，不会再"更新了却一直看到旧页面"
var NETWORK_FIRST = ['/index.html', '/manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          // 单个资源失败不影响整体安装
          return null;
        });
      }));
    }).then(function () {
      // 只有在确实启动了 SW 之后才注册控制器变更时的自动刷新，避免首次安装就刷新
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function inScope(url) {
  return url.indexOf(self.registration.scope) === 0;
}

function networkFirst(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || caches.match('./index.html');
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (res) {
      if (res && res.ok && inScope(res.url || request.url)) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(request, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 跨域请求交回浏览器
  if (!inScope(req.url)) return;                     // 只处理本应用目录下的资源

  var scopePath = new URL(self.registration.scope).pathname;
  var isDocument = req.mode === 'navigate' ||
    url.pathname === scopePath ||
    NETWORK_FIRST.some(function (p) { return url.pathname.indexOf(p) !== -1; });

  e.respondWith(isDocument ? networkFirst(req) : cacheFirst(req));
});

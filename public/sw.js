// 智学小鹿 Service Worker
// 提供 PWA 离线运行能力与多媒体后台流式传输保障

const CACHE_NAME = 'kids-study-v1';
const STATIC_ASSETS = [
  '/',
  '/kids',
  '/kids/index.html',
  '/kids/kids.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 对于音视频流与API接口，走网络优先策略，保证实时直链
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 静态页面资源优先从缓存取，网络更新
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (e.request.method === 'GET') {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        });
      });
    }).catch(() => {
      // 离线降级
      return caches.match('/kids');
    })
  );
});

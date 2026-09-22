/* オフライン対応（https で配信したときだけ登録される）
   - assets/ の画像・音: キャッシュ優先
   - HTML/JS/CSS: ネット優先、失敗したらキャッシュ */
const CACHE = 'maou-202609231200';
const CORE = ['./', './index.html', './style.css', './data.js', './game.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const isAsset = (url) => /\/assets\/.*\.(png|mp3|jpg|webp)$/.test(url.pathname);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (isAsset(url)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
  } else {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
  }
});

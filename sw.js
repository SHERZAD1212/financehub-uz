// FinanceHub UZ — Service Worker v8
// O'z fayllarimizni HAR DOIM tarmoqdan yangi oladi (eski keshni ushlab qolmaydi).
// Faqat internet yo'q bo'lganda keshdan beradi (offline uchun).
const CACHE_NAME = 'financehub-v8';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let sameOrigin = false;
  try { sameOrigin = new URL(e.request.url).origin === self.location.origin; } catch (_) {}
  // O'z fayllarimiz uchun brauzer keshini ham chetlab o'tamiz (no-store)
  const opts = sameOrigin ? { cache: 'no-store' } : {};
  e.respondWith(
    fetch(e.request, opts).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

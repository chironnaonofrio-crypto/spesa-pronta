// Spesa Pronta V27.9 hard reset - service worker disattivato
const CACHE='spesa-pronta-v27-9-hard-reset-disabled';
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))); });
self.addEventListener('activate', event => { event.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); await self.clients.claim(); await self.registration.unregister(); const clients=await self.clients.matchAll({type:'window'}); clients.forEach(c=>c.navigate(c.url)); })()); });
self.addEventListener('fetch', event => { event.respondWith(fetch(event.request, { cache:'no-store' }).catch(() => fetch(event.request))); });

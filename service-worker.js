const CACHE_NAME='spesa-pronta-v27-37-no-cache';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); await self.clients.claim(); })()); });
self.addEventListener('fetch', event => { event.respondWith(fetch(event.request, {cache:'no-store'}).catch(()=>fetch(event.request))); });

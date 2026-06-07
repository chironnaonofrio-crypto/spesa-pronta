const CACHE_NAME='spesa-pronta-v27-34-no-cache';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{});

// Spesa Pronta V27.10 - service worker disattivato senza auto-refresh
const CACHE='spesa-pronta-v27-10-stable-no-loop';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(()=>{}));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
    }catch(e){}
  })());
});
self.addEventListener('fetch', event => {
  // Network only. No cache and no client navigation.
  event.respondWith(fetch(event.request, {cache:'no-store'}).catch(()=>fetch(event.request)));
});

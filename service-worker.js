const CACHE_NAME='spesa-pronta-v31-8-real3d-strict';
const ASSETS=['./','./index.html','./assets/styles.css?v=3170','./assets/app.v27-48-premium-mega-vision.js?v=3170','./assets/app.js?v=3170','./assets/vision-seed-memory.json','./clear-cache.html','./debug.html','./server-brain.html?v=3170'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.pathname.includes('/api/'))return;event.respondWith(fetch(req).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));});

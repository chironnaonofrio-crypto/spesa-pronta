const CACHE_NAME='spesa-pronta-v27-75-unified-photo-flow';
const ASSETS=['./','./index.html','./assets/styles.css?v=2775','./assets/app.v27-48-premium-mega-vision.js?v=2775','./assets/vision-seed-memory.json','./assets/vision-seed-memory.js?v=2775','./assets/vision-mega-index.js?v=2775','./assets/vision-mega-index.json','./assets/vision-neural-grocery.svg','./clear-cache.html'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET') return;event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));});

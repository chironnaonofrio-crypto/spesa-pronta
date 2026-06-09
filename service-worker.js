const CACHE_NAME='spesa-pronta-v28-11-vision-card-fix';
const ASSETS=['./','./index.html','./assets/styles.css?v=2811','./assets/app.v27-48-premium-mega-vision.js?v=2811','./assets/vision-seed-memory.json','./assets/vision-seed-memory.js?v=2811','./assets/vision-mega-index.js?v=2811','./assets/vision-mega-index.json','./assets/vision-neural-grocery.svg','./assets/illustrations/vision-ready-white-v2811.png','./clear-cache.html','./debug.html'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET') return;event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));});

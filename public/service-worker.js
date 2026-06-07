const CACHE_NAME='spesa-pronta-v27-46-seed-real-ui';
const ASSETS=['./','./index.html','./assets/styles.v27-46-seed-real-ui.css?v=2746','./assets/app.v27-46-seed-real-ui.js?v=2746','./assets/vision-seed-memory.json'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS).catch(()=>undefined)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET') return;event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));});

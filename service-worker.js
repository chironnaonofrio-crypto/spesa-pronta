const CACHE_NAME='spesa-pronta-v27-47-blank-page-fixed';
const ASSETS=['./','./index.html','./assets/styles.v27-47-blank-page-fixed.css?v=2747','./assets/app.v27-47-blank-page-fixed.js?v=2747','./assets/vision-seed-memory.json'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET') return;const url=new URL(req.url);if(url.pathname.includes('/api/')) return;event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));});

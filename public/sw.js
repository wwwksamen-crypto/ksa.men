/* PWA caches only public, immutable application assets, never account/API responses. */
const VERSION='ksa-static-launch-20261028';
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.add('/offline.html'))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{
 if(event.data==='SKIP_WAITING')self.skipWaiting();
 if(event.data==='CLEAR_PRIVATE')event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).then(()=>caches.open(VERSION).then(cache=>cache.add('/offline.html'))));
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET'||event.request.headers.has('Range'))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(async()=>await caches.match('/offline.html')||new Response('أنت غير متصل. أعد الاتصال للمتابعة.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
  return;
 }
 if(!url.pathname.startsWith('/assets/')||url.pathname.includes('company-')||url.pathname.includes('/media/'))return;
 const immutable=/[-.][A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname);
 event.respondWith(caches.open(VERSION).then(async cache=>{
  if(immutable){const saved=await cache.match(event.request);if(saved)return saved;}
  try{const response=await fetch(event.request,{cache:immutable?'no-cache':'default'});if(response.status===200&&response.headers.get('Cache-Control')?.includes('public'))await cache.put(event.request,response.clone());return response;}
  catch(error){const saved=await cache.match(event.request);if(saved)return saved;throw error;}
 }));
});

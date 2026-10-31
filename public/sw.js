/* Cache public application assets and an already-opened public badge shell only. Never cache API, media, drafts or account output. */
const VERSION='ksa-static-public-badge-20261031-2';
const sensitivePublicDocument=pathname=>/(?:^|[-_/])(company|bank|iban|registration|commercial|certificate|document)(?:[-_./]|$)/i.test(pathname);
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.add('/offline.html'))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ksa-static-')&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{
 if(event.data==='SKIP_WAITING')self.skipWaiting();
 if(event.data==='CLEAR_PRIVATE')event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ksa-static-')).map(key=>caches.delete(key)))).then(()=>caches.open(VERSION).then(cache=>cache.add('/offline.html'))));
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET'||event.request.headers.has('Range'))return;
 if(event.request.mode==='navigate'){
  const publicBadge=url.pathname==='/export/badge'&&url.searchParams.has('public')&&!url.searchParams.has('site');
  event.respondWith((async()=>{
   const cache=await caches.open(VERSION).catch(()=>null);
   try{
    const response=await fetch(event.request,{cache:'no-store'});
    if(publicBadge&&cache&&response.status===200)await cache.put(event.request,response.clone()).catch(()=>{});
    return response;
   }catch(error){
    if(publicBadge&&cache){const saved=await cache.match(event.request).catch(()=>null);if(saved)return saved;}
    return await caches.match('/offline.html')||new Response('أنت غير متصل. أعد الاتصال للمتابعة.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
   }
  })());
  return;
 }
 if(!url.pathname.startsWith('/assets/')||sensitivePublicDocument(url.pathname)||url.pathname.includes('/media/'))return;
 const immutable=/[-.][A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname);
 event.respondWith((async()=>{
  const cache=await caches.open(VERSION).catch(()=>null);
  const saved=cache?await cache.match(event.request).catch(()=>null):null;
  if(immutable&&saved)return saved;
  let response;
  try{response=await fetch(event.request,{cache:['reload','no-store'].includes(event.request.cache)?event.request.cache:'no-cache'});}
  catch(error){if(saved)return saved;throw error;}
  if(cache&&response.status===200&&response.headers.get('Cache-Control')?.includes('public')){
   await cache.put(event.request,response.clone()).catch(()=>{});
  }
  return response;
 })());
});

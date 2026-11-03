/* Public assets only. API, media, drafts and account output never enter this cache. */
const VERSION='ksa-static-performance-20261103-1';
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
    // Only the data-free badge shell is saved. Its approved payload has separate live privacy checks.
    if(publicBadge&&cache&&response.status===200&&response.headers.get('X-KSA-Public-Shell')==='1')await cache.put(event.request,response.clone()).catch(()=>{});
    return response;
   }catch{
    if(publicBadge&&cache){const saved=await cache.match(event.request).catch(()=>null);if(saved)return saved;}
    return await caches.match('/offline.html')||new Response('أنت غير متصل. أعد الاتصال للمتابعة.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
   }
  })());return;
 }
 if(!url.pathname.startsWith('/assets/')||sensitivePublicDocument(url.pathname)||url.pathname.includes('/media/'))return;
 const immutable=/[-.][A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname);
 const bypass=['reload','no-store','no-cache'].includes(event.request.cache);
 event.respondWith((async()=>{
  const cache=await caches.open(VERSION).catch(()=>null);
  const saved=cache?await cache.match(event.request).catch(()=>null):null;
  if(saved&&!bypass){
   const stored=Number(saved.headers.get('X-KSA-Cached-At')||0);
   const maxAge=Number(saved.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1]||0);
   if((immutable&&saved.headers.get('Cache-Control')?.includes('immutable'))||(stored>0&&Date.now()-stored<Math.min(maxAge,3600)*1000))return saved;
  }
  let response;
  try{response=await fetch(event.request,{cache:bypass?event.request.cache:'default'});}
  catch(error){if(saved&&!bypass)return saved;throw error;}
  const control=response.headers.get('Cache-Control')||'';
  if(cache&&response.status===200&&event.request.cache!=='no-store'&&control.includes('public')&&!/private|no-store|no-cache/.test(control)&&!response.headers.has('Set-Cookie')&&!response.headers.get('Content-Type')?.includes('text/html')){
   const headers=new Headers(response.headers);headers.set('X-KSA-Cached-At',String(Date.now()));
   await cache.put(event.request,new Response(response.clone().body,{status:response.status,headers})).catch(()=>{});
   const keys=await cache.keys().catch(()=>[]);
   if(keys.length>160)await Promise.all(keys.slice(0,keys.length-160).filter(request=>new URL(request.url).pathname!=='/offline.html').map(key=>cache.delete(key))).catch(()=>{});
  }
  return response;
 })());
});

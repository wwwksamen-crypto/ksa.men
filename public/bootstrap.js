/* Independent recovery for initial module loading; never auto-reloads an editable view. */
(()=>{
 const root=document.getElementById('root');
 if(!root||!('serviceWorker' in navigator)||location.hostname!=='ksa.men')return;
 const key='ksa:boot-recovery';let recovering=false,notice=null,failedModule='';
 const mounted=()=>root.childElementCount>0;
 const safeInitialView=()=>!mounted()||(!document.querySelector('input,textarea,select,[contenteditable="true"]')&&!!document.querySelector('.loading-state,.loader'));
 function showFailure(){
  if(notice||mounted())return;
  notice=document.createElement('section');notice.className='boot-recovery';notice.dir='rtl';notice.setAttribute('role','status');
  const title=document.createElement('h1');title.textContent='لنستعد اتصالنا';
  const text=document.createElement('p');text.textContent='تعذر تحميل نسخة التطبيق. حسابك وبياناتك محفوظة.';
  const button=document.createElement('button');button.type='button';button.textContent='إعادة تحميل النسخة';button.className='button primary';button.onclick=()=>{sessionStorage.removeItem(key);recovering=false;recover(true);};
  notice.append(title,text,button);document.body.append(notice);
 }
 async function recover(manual=false,initialFailure=false){
  if(recovering||(!manual&&!initialFailure&&!safeInitialView()))return;recovering=true;
  if(!manual&&sessionStorage.getItem(key)){showFailure();return;}
  sessionStorage.setItem(key,'1');
  try{
   const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await registration.update();
   const waiting=registration.waiting;
   if(waiting){navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});waiting.postMessage('SKIP_WAITING');}
   const sources=[...document.querySelectorAll('script[type="module"][src],link[rel="modulepreload"][href]')].map(element=>element.src||element.href);
   if(failedModule)sources.push(failedModule);
   await Promise.all(sources.map(url=>fetch(url,{cache:'reload',credentials:'same-origin'}).catch(()=>null)));
   if(!waiting)location.reload();
   setTimeout(showFailure,4500);
  }catch{showFailure();}
 }
 document.querySelector('script[type="module"]')?.addEventListener('error',()=>recover());
 window.addEventListener('vite:preloadError',event=>{
  const initial=safeInitialView();
  const candidate=String(event.payload?.message||'').match(/https:\/\/[^\s)'"]+/)?.[0];
  if(candidate){try{const url=new URL(candidate);if(url.origin===location.origin&&url.pathname.startsWith('/assets/'))failedModule=url.href;}catch{}}
  if(initial){event.preventDefault();recover(false,true);return;}
  if(document.querySelector('[data-chunk-update]'))return;
  const note=document.createElement('div');note.className='update-bar';note.dataset.chunkUpdate='true';note.setAttribute('role','alert');
  const message=document.createElement('span');message.textContent='نسخة أحدث متاحة. احفظ عملك ثم حدّث الصفحة.';
  const button=document.createElement('button');button.className='button';button.textContent='تحديث الصفحة';button.onclick=()=>{sessionStorage.removeItem(key);recovering=false;recover(true);};
  note.append(message,button);document.body.prepend(note);
 });
 new MutationObserver(()=>{if(mounted()){notice?.remove();notice=null;}}).observe(root,{childList:true});
 setTimeout(()=>{if(!mounted())recover();else if(!document.querySelector('.connection-state'))sessionStorage.removeItem(key);},5000);
})();

/* Independent boot recovery: works even when the application's module cannot execute. */
(()=>{
  const root=document.getElementById('root');
  if(!root||!('serviceWorker' in navigator)||location.hostname!=='ksa.men')return;
  const attemptKey='ksa:boot-recovery';let recovering=false,notice=null;
  const mounted=()=>root.childElementCount>0;
  const removeNotice=()=>{notice?.remove();notice=null;};
  new MutationObserver(()=>{if(mounted())removeNotice();}).observe(root,{childList:true});
  function showFailure(){
    if(notice||mounted())return;
    notice=document.createElement('section');notice.className='boot-recovery';notice.dir='rtl';notice.setAttribute('role','status');
    const title=document.createElement('h1');title.textContent='لنستعد اتصالنا';
    const text=document.createElement('p');text.textContent='تعذر تحميل نسخة التطبيق. حسابك وبياناتك محفوظة.';
    const button=document.createElement('button');button.type='button';button.textContent='إعادة تحميل النسخة';button.className='button primary';button.onclick=()=>{sessionStorage.removeItem(attemptKey);recovering=false;recover(true);};
    notice.append(title,text,button);document.body.append(notice);
  }
  async function recover(manual=false){
    if(recovering||mounted())return;recovering=true;
    if(!manual&&sessionStorage.getItem(attemptKey)){showFailure();return;}
    sessionStorage.setItem(attemptKey,'1');
    try{
      const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});await registration.update();
      const waiting=registration.waiting;
      if(waiting){
        navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!mounted())location.reload();},{once:true});
        waiting.postMessage('SKIP_WAITING');
      }
      const sources=[...document.querySelectorAll('script[type="module"][src],link[rel="modulepreload"][href]')].map(e=>e.src||e.href);
      await Promise.all(sources.map(url=>fetch(url,{cache:'reload',credentials:'same-origin'}).catch(()=>null)));
      if(!waiting&&!mounted())location.reload();
      setTimeout(showFailure,4500);
    }catch{showFailure();}
  }
  document.querySelector('script[type="module"]')?.addEventListener('error',()=>recover());
  window.addEventListener('vite:preloadError',event=>{
    if(!mounted()){event.preventDefault();recover();}
    else{
      const note=document.createElement('div');note.className='update-bar';note.setAttribute('role','alert');
      const message=document.createElement('span');message.textContent='نسخة أحدث متاحة. احفظ عملك ثم حدّث الصفحة.';
      const button=document.createElement('button');button.className='button';button.textContent='تحديث الصفحة';button.onclick=()=>location.reload();
      note.append(message,button);document.body.prepend(note);
    }
  });
  setTimeout(()=>{if(!mounted())recover();else sessionStorage.removeItem(attemptKey);},5000);
})();

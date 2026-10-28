from pathlib import Path
p=Path('client/src/main.tsx')
s=p.read_text()
s=s.replace("import React,{useEffect,useState,lazy,Suspense} from 'react';", "import React,{useEffect,useState,lazy,Suspense} from 'react';")
s=s.replace("import './style.css';", "import './style.css';\nimport Sanad from './Sanad';")
a=s.index('function App(){');b=s.index('\nfunction activeSeason',a)
s=s[:a]+'''function App(){
 const [lang,setLang]=useState<'ar'|'en'>((localStorage.getItem('ksa-lang') as 'ar'|'en')||'ar');
 const [theme,setTheme]=useState(localStorage.getItem('ksa-theme')||'dark');
 const [user,setUser]=useState<User|null>(null),[platform,setPlatform]=useState<any>(null);
 const [toast,setToast]=useState(''),[menu,setMenu]=useState(false),[loading,setLoading]=useState(true);
 const [install,setInstall]=useState<any>(null),[update,setUpdate]=useState<ServiceWorker|null>(null),[error,setError]=useState('');
 const t=(ar:string,en:string)=>lang==='ar'?ar:en;
 const path=location.pathname,sub=location.hostname.endsWith('.ksa.men')&&location.hostname!=='www.ksa.men';
 const workspace=path==='/dashboard'||path==='/admin'||path.startsWith('/export/');
 const season=activeSeason(platform?.season);
 const refresh=async()=>{if(sub)return;const d:any=await api('/api/auth/me');setUser(d.user);setCSRF(d.csrf||'');};
 useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';localStorage.setItem('ksa-lang',lang);},[lang]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('ksa-theme',theme);},[theme]);
 useEffect(()=>{if(season)document.documentElement.dataset.season=season;else delete document.documentElement.dataset.season;},[season]);
 useEffect(()=>{
  Promise.all([api('/api/platform').then(setPlatform),refresh()]).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  if(!sub&&'serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').then(r=>{if(r.waiting)setUpdate(r.waiting);r.addEventListener('updatefound',()=>{const w=r.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)setUpdate(w);});});}).catch(()=>{});}
  const handler=(e:any)=>{e.preventDefault();setInstall(e);};window.addEventListener('beforeinstallprompt',handler);
  return()=>window.removeEventListener('beforeinstallprompt',handler);
 },[]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
 const logout=async()=>{try{await api('/api/auth/logout',{method:'POST'});navigator.serviceWorker?.controller?.postMessage('CLEAR_PRIVATE');sessionStorage.clear();await refresh();location.href='/';}catch(e:any){setToast(e.message);}};
 const ctx={user,lang,t,refresh,notify:setToast};
 let page:React.ReactNode;
 if(sub)page=<Personal/>;
 else if(loading)page=<div className="loader"><img src="/assets/logo-emblem.webp" alt="KSA.MEN"/><span className="load-line"/><p>{t('نجهّز مساحتك','Preparing your space')}</p></div>;
 else if(error)page=<div className="page"><div className="card connection-state"><ShieldCheck size={32}/><h1>{t('لنكمل اتصالنا','Let’s reconnect')}</h1><p>{error}</p><Button className="primary" onClick={()=>location.reload()}>{t('إعادة المحاولة','Try again')}</Button></div></div>;
 else if(platform&&!platform.access&&!(platform.lock.mode==='home'&&path!=='/')&&!['/auth','/privacy','/terms'].includes(path))page=<Gate platform={platform} onSuccess={()=>location.reload()}/>;
 else if(path==='/auth')page=<Auth/>;
 else if(path==='/dashboard')page=user?<Dashboard/>:<Auth/>;
 else if(path==='/admin')page=user&&user.role!=='user'?<Admin/>:<Auth/>;
 else if(path.startsWith('/export/'))page=user?<Exports/>:<Auth/>;
 else if(path==='/search')page=<SearchPage/>;
 else if(path==='/qr')page=<div className="page"><PageTitle title={t('شارك حضورك بلمسة','One scan. Your whole story.')} subtitle={t('QR وبطاقة اتصال. هدية من المنصة، دون تسجيل.','QR and contact cards. A gift from us. No account needed.')}/><QRTools/></div>;
 else if(path==='/radar')page=user?<Radar/>:<Auth/>;
 else if(path==='/about')page=<About/>;
 else if(path==='/features')page=<Features/>;
 else if(path.startsWith('/quick/'))page=<Quick/>;
 else if(path==='/contact')page=<Contact/>;
 else if(['/privacy','/terms','/blog'].includes(path))page=<Content slug={path.slice(1)}/>;
 else if(path==='/')page=<Home/>;
 else page=<div className="page empty-state"><h1>{t('هذه الصفحة غير موجودة','This page isn’t here')}</h1><a href="/" className="button primary">{t('إلى الرئيسية','Back home')}</a></div>;
 const prefix=sub?'https://ksa.men':'';
 return <AppContext.Provider value={ctx}><div className={'app-shell '+(workspace?'workspace-shell':'')+(sub?' identity-shell':'')}>
  <a href="#main-content" className="skip-link">{t('تخطّ إلى المحتوى','Skip to content')}</a>
  <header className="header"><div className="header-inner">
   <a className="brand" href={prefix+'/'} aria-label="KSA.MEN"><img src="/assets/icon-192.png" alt=""/><span>KSA<span className="brand-dot">.</span>MEN</span></a>
   <nav id="main-nav" aria-label={t('التنقل الرئيسي','Main navigation')} className={menu?'nav open':'nav'}>
    <a href={prefix+'/search'}>{t('اكتشف الهويات','Discover')}</a><a href={prefix+'/features'}>{t('المزايا','Features')}</a><a href={prefix+'/about'}>{t('قصتنا','Our story')}</a>
    {user&&user.role!=='user'&&<a href={prefix+'/admin'}>{t('الإدارة','Admin')}</a>}
    <a href={prefix+(user?'/dashboard':'/auth')} className="nav-main">{user?t('مساحتي','My space'):t('الدخول','Sign in')}<UserRound size={16}/></a>
   </nav>
   <div className="header-tools"><button className="icon-button language-tool" onClick={()=>setLang(lang==='ar'?'en':'ar')} aria-label={t('English','العربية')}><Globe size={17}/><span>{lang==='ar'?'EN':'ع'}</span></button><button className="icon-button" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={t('تبديل المظهر','Switch theme')}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button>{user&&<button className="icon-button logout" onClick={logout}>{t('خروج','Exit')}</button>}<button className="icon-button menu-button" onClick={()=>setMenu(!menu)} aria-label={t('القائمة','Menu')} aria-expanded={menu} aria-controls="main-nav">{menu?<X size={22}/>:<Menu size={22}/>}</button></div>
  </div></header>
  <main id="main-content"><Suspense fallback={<div className="loader"><span className="load-line"/><p>{t('جارٍ التحميل','Loading')}</p></div>}>{page}</Suspense></main>
  {!sub&&<Sanad/>}
  <div className="platform-controls">
   {install&&<button className="install-action" onClick={async()=>{await install.prompt();setInstall(null);}}><Download size={17}/>{t('ثبّت التطبيق','Install app')}</button>}
   {!sub&&/iPad|iPhone|iPod/.test(navigator.userAgent)&&!matchMedia('(display-mode: standalone)').matches&&<details className="ios-install"><summary>{t('ثبّت KSA.MEN على iPhone','Install KSA.MEN on iPhone')}</summary><p>{t('من Safari: مشاركة، ثم «إضافة إلى الشاشة الرئيسية».','In Safari: Share, then Add to Home Screen.')}</p></details>}
  </div>
  <Footer sub={sub} platform={platform}/>
  {update&&<div className="update-bar" role="status"><span>{t('تجربة أحدث جاهزة. احفظ عملك ثم حدّث.','A fresh experience is ready. Save your work before updating.')}</span><Button onClick={()=>{update.postMessage('SKIP_WAITING');navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});}}>{t('تحديث','Update')}</Button></div>}
  {toast&&<div className="toast" role="status"><Check size={18}/><span>{toast}</span></div>}
 </div></AppContext.Provider>;
}''' +s[b:]
a=s.index('function Footer(');b=s.index('\nfunction useManagedContent',a)
s=s[:a]+'''function Footer({sub,platform}:{sub:boolean,platform:any}){
 const {t,lang}=useApp();const [content,setContent]=useState<any>(null);
 useEffect(()=>{let current=true;if(sub)return;api('/api/content/footer').then(d=>{if(current)setContent(d);}).catch(()=>{});return()=>{current=false;};},[sub]);
 const prefix=sub?'https://ksa.men':'',contact=platform?.contact||{},email=typeof contact.email==='string'?contact.email:'',whatsapp=typeof contact.whatsapp==='string'?contact.whatsapp.replace(/\\D/g,''):'';
 const note=typeof content?.['body_'+lang]==='string'?content['body_'+lang].trim():'';
 return <footer className="footer"><div className="footer-inner"><div className="footer-signature"><a className="brand" href={prefix+'/'}><img src="/assets/icon-192.png" alt=""/>KSA.MEN</a><p>{note||t('ظهور رقمي يليق بك.','A presence worthy of you.')}</p></div><nav className="footer-links" aria-label={t('روابط المنصة','Platform links')}><a href={prefix+'/features'}>{t('المزايا','Features')}</a><a href={prefix+'/about'}>{t('من نحن','About')}</a><a href={prefix+'/contact'}>{t('تواصل معنا','Contact')}</a><a href={prefix+'/blog'}>{t('المدونة','Journal')}</a><a href={prefix+'/privacy'}>{t('الخصوصية','Privacy')}</a><a href={prefix+'/terms'}>{t('الاستخدام','Terms')}</a><a href={prefix+'/admin'}>{t('الإدارة والإشراف','Administration')}</a></nav><div className="footer-contact">{email&&<a href={'mailto:'+email}><Mail size={14}/><bdi dir="ltr">{email}</bdi></a>}{whatsapp&&<a href={'https://wa.me/'+whatsapp} target="_blank" rel="noreferrer"><Phone size={14}/>{t('تواصل عبر واتساب','WhatsApp')}</a>}</div></div><div className="footer-bottom"><p>© {new Date().getFullYear()} KSA.MEN</p><span>{t('هويتك. قصتك. أثرك.','Your identity. Your story. Your impact.')}</span></div></footer>;
}''' +s[b:]
a=s.index('function Home(){');b=s.index('\nfunction FeatureCards',a)
s=s[:a]+'''function Home(){
 const {t,lang,user}=useApp();const [q,setQ]=useState('');const homeCopy=useManagedContent('home');
 return <div className="home-page"><section className="hero" aria-labelledby="home-title">
  <div className="hero-emblem" aria-hidden="true"><span className="emblem-orbit orbit-one"/><span className="emblem-orbit orbit-two"/><span className="emblem-light"/><img src="/assets/logo-emblem.webp" alt="" fetchPriority="high"/><span className="orbit-jewel jewel-one"/><span className="orbit-jewel jewel-two"/></div>
  <div className="hero-content"><span className="eyebrow hero-eyebrow">KSA.MEN <span/> {t('مساحة للجدارة السعودية','A PLACE FOR SAUDI CAPABILITY')}</span><h1 id="home-title">{t('ظهور رقمي','A digital presence')} <span>{t('يليق بك.','worthy of you.')}</span></h1><p className="hero-description">{homeCopy?.['body_'+lang]||t('اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.','Your name is your address. Your expertise deserves to be seen.')}</p>
   <form className="hero-search" action="/search" role="search"><Search size={21}/><label className="sr-only" htmlFor="home-search">{t('ابحث عن هوية','Find an identity')}</label><input id="home-search" type="search" name="q" value={q} onChange={e=>setQ(e.target.value)} placeholder={t('اسم، تخصص، مدينة أو معرّف','Name, expertise, city or ID')}/><button className="hero-search-submit" aria-label={t('بحث','Search')}><ArrowUpLeft size={23}/></button></form>
   <div className="search-caption"><span>{t('الهويات المنشورة بموافقة أصحابها فقط.','Only profiles their owners choose to publish.')}</span><a className="text-link" href="/search?advanced=1">{t('بحث متقدم','Advanced search')}<ChevronDown size={14}/></a></div>
   <div className="hero-actions"><a className="button primary" href={user?'/dashboard':'/auth?register=1'}><UserRound size={18}/>{user?t('إلى مساحتي','My space'):t('أنشئ موقعك الخاص','Create your own site')}<ArrowUpLeft size={19}/></a><a className="button metallic" href="/features"><Sparkles size={18}/>{t('مزايا المنصة','Explore features')}</a><a className="button secondary" href="/qr"><ScanLine size={19}/>{t('QR هدية لك','Your free QR')}</a></div>
   <div className="hero-assurances"><span><ShieldCheck size={15}/>{t('خصوصيتك بيدك','Privacy in your hands')}</span><span><Check size={15}/>{t('٣ أيام لجميع المزايا','3 days. Every feature.')}</span></div>
  </div>
 </section><div className="home-landscape"><picture><source media="(max-width:640px)" srcSet="/assets/cover-720.webp"/><img src="/assets/cover-1600.webp" alt={t('معالم المملكة العربية السعودية','Saudi Arabian landmarks')} loading="lazy"/></picture><div className="landscape-caption"><span>{t('من هنا، يمتد أثرك.','From here, your impact grows.')}</span><a href="/about">{t('قصتنا','Our story')}<ArrowUpLeft size={16}/></a></div></div></div>;
}''' +s[b:]
a=s.index('function Sanad(){');b=s.index("createRoot(",a);s=s[:a]+s[b:]
s=s.replace('<div className="page-title"><div className="eyebrow">KSA.MEN</div>', '<div className="page-title"><div className="eyebrow"><span className="section-mark"/>KSA.MEN</div>')
# Existing email/PIN contract stays unchanged; improve only the form presentation.
s=s.replace("const{t,refresh,notify}=useApp();", "const{t,refresh,notify}=useApp();",1)
s=s.replace(" const changeMethod=(nextMode:string,nextQuick=false)=>", " useEffect(()=>{window.dispatchEvent(new CustomEvent('ksa:sanad-context',{detail:{section:'auth',step:quick?'pin':challenge?'verify':mode}}));},[mode,quick,challenge]);\n const changeMethod=(nextMode:string,nextQuick=false)=>",1)
s=s.replace('<span className="eyebrow">{t(\'الخطوة الأولى إلى حضورك\',\'YOUR NEXT CHAPTER\')}</span>', '<div className="auth-mark"><img src="/assets/logo-emblem.webp" alt=""/></div><span className="eyebrow">{t(\'الخطوة الأولى إلى حضورك\',\'YOUR NEXT CHAPTER\')}</span>')
s=s.replace("<h1>{t('اسمك. قصتك.','Your name. Your story.')}<br/><span>{t('مساحتك.','Your space.')}</span></h1>","<h1>{t('اسمك عنوانك.','Your name. Your address.')}<br/><span>{t('والقصة قصتك.','The story is yours.')}</span></h1>")
s=s.replace("<p>{t('حي الله فخرنا. نرافقك من أول خطوة، إلى موقع تفخر بمشاركته.','Welcome. We’re with you from your first step to a site you’re proud to share.')}</p>","<p>{t('مساحة مستقلة لخبرتك، تبدأ بخطوة بسيطة.','An independent place for your expertise. Start with one simple step.')}</p>")
s=s.replace('<div className="eyebrow">KSA.MEN</div>\n   <h2>{quick?', '<div className="auth-card-top"><span className="eyebrow">{t(\'مساحتك الخاصة\',\'YOUR OWN SPACE\')}</span><ShieldCheck size={21}/></div>\n   <h2>{quick?',1)
s=s.replace("challenge?t('أدخل الرمز المرسل إلى '+email,'Enter the code sent to '+email):quick?t('أدخل بريد الحساب ورمزك الشخصي. يعمل فقط على جهاز موثوق للحساب نفسه؛ للجهاز الجديد استخدم رمز البريد.','Enter your account email and PIN. This device must be trusted for that same account. Use email verification on a new device.')", "challenge?<>{t('أرسلنا رمزًا إلى','A code was sent to')} <bdi dir=\"ltr\">{email}</bdi></>:quick?t('بريد الحساب ورمزك الشخصي، على جهاز موثوق فقط.','Your account email and PIN, on a trusted device only.')")
s=s.replace('   <form onSubmit={submit} className="stack">', '''   {!challenge&&mode!=='register'&&<div className="auth-methods" role="group" aria-label={t('طريقة الدخول','Sign-in method')}><button type="button" aria-pressed={!quick} className={!quick?'selected':''} onClick={()=>changeMethod('login',false)}><Mail size={16}/>{t('رمز البريد','Email code')}</button><button type="button" aria-pressed={quick} className={quick?'selected':''} onClick={()=>changeMethod('login',true)}><LockKeyhole size={16}/><bdi>PIN</bdi></button></div>}
   <form onSubmit={submit} className="stack">''',1)
s=s.replace("<button disabled={busy} onClick={()=>changeMethod('login',!quick)}>{quick?t('التحقق بالبريد','Verify with email'):t('PIN على جهاز موثوق','PIN on a trusted device')}</button>", "<p className=\"auth-security-note\"><ShieldCheck size={15}/>{t('رمز آمن. لا كلمة مرور مشتركة.','Secure verification. No shared password.')}</p>")
s=s.replace('<input required type="email" name="email" autoComplete=', '<input required type="email" name="email" autoComplete=',1)
# Expose correct directional contexts in public short identifiers.
s=s.replace('<span className="domain-label">{r.name}.ksa.men</span>', '<bdi className="domain-label" dir="ltr">{r.name}.ksa.men</bdi>')
s=s.replace('<p>{data?.profile?.title}</p>','<p>{data?.profile?.title}</p>')
p.write_text(s)
# Only permit own-origin audio; no change to auth, locks, or database.
p=Path('server/index.ts');s=p.read_text();s=s.replace("font-src 'self'; img-src", "font-src 'self'; media-src 'self' blob:; img-src");p.write_text(s)
print('Public redesign merged; business and access unchanged.')

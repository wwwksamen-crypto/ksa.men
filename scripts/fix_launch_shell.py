#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'index.html';s=p.read_text();s=s.replace('<div id="root"></div>','<div id="root"></div><script src="/bootstrap.js" defer></script>');p.write_text(s)
p=root/'server/index.ts';s=p.read_text();s=s.replace("'/offline.html', '/gate.js'","'/offline.html', '/gate.js', '/bootstrap.js'")
s=s.replace("if (error instanceof HTTPException) return c.json({ error: error.message || 'تعذر تنفيذ الطلب' }, error.status);","""if (error instanceof HTTPException) {
    const response = error.getResponse();
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      return c.newResponse(response.body, error.status, Object.fromEntries(response.headers));
    }
    return c.json({ error: error.message || 'تعذر تنفيذ الطلب' }, error.status);
  }""")
p.write_text(s)
p=root/'server/auth.ts';s=p.read_text();a=s.index(" app.post('/api/auth/request'");b=s.index(' const id=uid();',a)
s=s[:a]+""" app.post('/api/auth/request',async c=>{
  const data=requestSchema.parse(await c.req.json());
  await rate(c,'auth-ip:'+c.req.header('CF-Connecting-IP'),12,3600);
  if(data.purpose==='register'&&(!data.name||data.name.length<2||!data.whatsapp||!data.consent))
    throw new HTTPException(400,{message:'أكمل الاسم (حرفان على الأقل) وواتساب والموافقة على السياسات'});
  if(data.purpose!=='register'){delete data.name;delete data.whatsapp;delete data.consent;delete data.referral;}
  const exists=await one<User>(c,'SELECT * FROM users WHERE email=?',data.email);
  const lock:any=await one(c,\"SELECT value FROM settings WHERE key='lock'\");
  const lockData=lock?JSON.parse(lock.value):{mode:'open'};
  const rawGate=getCookie(c,'__Host-ksa_gate')||'';
  const [gateTime,gateSig]=rawGate.split('.');
  const gateValid=!!lockData.passwordHash&&Number(gateTime)>now()&&(
    gateSig===await hmac(c.env.AUTH_SECRET,gateTime+':'+lockData.passwordHash)||
    gateSig===await hmac(c.env.AUTH_SECRET,gateTime+':'+lockData.passwordHash+':'+new URL(c.req.url).hostname)
  );
  const privileged=data.email===c.env.OWNER_EMAIL||['manager','moderator'].includes(exists?.role||'');
  const blocked=!['open','home'].includes(lockData.mode)&&!privileged&&!gateValid;
  const requestMessage=data.purpose==='register'?'تم إرسال رمز التحقق إلى بريدك':'إن كان البريد مرتبطًا بحساب، سيصلك رمز الدخول. للزيارة الأولى اختر إنشاء حساب.';
  // Unknown or privately blocked login addresses get the same accepted shape, without mail,
  // account creation, or consuming the target account's delivery quota.
  if(data.purpose!=='register'&&(blocked||(!exists&&data.email!==c.env.OWNER_EMAIL)))
    return c.json({challenge:uid(),message:requestMessage,expiresIn:600});
  if(blocked)throw new HTTPException(423,{message:'المنصة في اختبار خاص. يلزم دخول البوابة أولاً'});
  await rate(c,'auth-email:'+data.email,5,3600);
"""+s[b:]
s=s.replace("return c.json({challenge:id,message:'تم إرسال رمز التحقق إلى بريدك',expiresIn:600});","return c.json({challenge:id,message:requestMessage,expiresIn:600});")
s=s.replace("code:z.string().regex(/^\\d{6}$/)","code:z.string().regex(/^\\d{6}$/,{message:'أدخل رمز التحقق من ٦ أرقام'})")
s=s.replace("pin:z.string().regex(/^\\d{6}$/)","pin:z.string().regex(/^\\d{6}$/,{message:'أدخل PIN من ٦ أرقام'})")
p.write_text(s)
p=root/'client/src/main.tsx';s=p.read_text();anchor="const features=";pos=s.index(anchor)
s=s[:pos]+"""const isStaffRole=(role:string|undefined)=>['owner','manager','moderator'].includes(role||'');
const authDestination=(role:string)=>isStaffRole(role)?'/admin':'/dashboard';
const numericCode=(value:string)=>value.replace(/[٠-٩۰-۹]/g,character=>String(character.charCodeAt(0)-(character.charCodeAt(0)>=0x6F0?0x6F0:0x660))).replace(/\\D/g,'');
class AppErrorBoundary extends React.Component<React.PropsWithChildren,{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){console.warn('View rendering failed',error.name);}
 render(){return this.state.failed?<main className="page connection-state card"><h1>لنستعد اتصالنا</h1><p>تعذر عرض هذه الصفحة. حسابك وبياناتك محفوظة.</p><button className="button primary" onClick={()=>location.reload()}>إعادة المحاولة</button><a href="/auth" className="text-link">دخول الحساب</a></main>:this.props.children;}
}
"""+s[pos:]
s=s.replace("Promise.all([api('/api/platform').then(setPlatform),refresh()]).catch(e=>setError(e.message)).finally(()=>setLoading(false));","if(sub)setLoading(false);else Promise.all([api('/api/platform').then(setPlatform),refresh()]).catch(e=>setError(e.message)).finally(()=>setLoading(false));")
s=s.replace("navigator.serviceWorker.register('/sw.js')","navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'})")
s=s.replace("user&&user.role!=='user'","user&&isStaffRole(user.role)")
s=s.replace("d.user.role==='owner'?'/admin':'/dashboard'","authDestination(d.user.role)")
s=s.replace("onChange={e=>setCode(e.target.value.replace(/\\D/g,''))}","onChange={e=>setCode(numericCode(e.target.value))}")
s=s.replace("onChange={e=>setPin(e.target.value.replace(/\\D/g,''))}","onChange={e=>setPin(numericCode(e.target.value))}")
s=s.replace("{t('أرسلنا رمزًا إلى','A code was sent to')} <bdi dir=\"ltr\">{email}</bdi>","{mode==='register'?t('أرسلنا رمزًا إلى','A code was sent to'):t('إن كان بريدك مسجلاً، ستصلك رسالة التحقق:','If your email is registered, check for your code:')} <bdi dir=\"ltr\">{email}</bdi>")
s=s.replace(".render(<App/>);",".render(<AppErrorBoundary><App/></AppErrorBoundary>);")
p.write_text(s)
p=root/'public/sw.js';s=p.read_text().replace("ksa-static-design-20261028","ksa-static-launch-20261028")
s=s.replace("const response=await fetch(event.request);","const response=await fetch(event.request,{cache:immutable?'no-cache':'default'});")
p.write_text(s)
p=root/'client/src/style.css';s=p.read_text()+"\n.boot-recovery{width:min(90%,480px);margin:12vh auto;padding:32px;border:1px solid var(--line);border-radius:24px;background:var(--surface);color:var(--text);text-align:start}.boot-recovery h1{font-size:28px}.boot-recovery p{line-height:1.8;margin:16px 0 24px}\n";p.write_text(s)
print('Launch shell/auth/error improvements applied')

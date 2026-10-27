import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {getCookie,setCookie} from 'hono/cookie';
import {ZodError} from 'zod';
import {type Bindings,type Session,type User,type Env,one,run,now,digest,hmac,verifySecret,rate,setting,safeUrl,publicProfile} from './core';
import {registerAuth} from './auth';
import {registerBackup,makeBackup} from './backup';
import {registerBusiness} from './business';
import {registerOperations} from './operations';
import {registerIntelligence,fetchRadar} from './intelligence';
import {registerPublic,publishedForHost,personalGate} from './public';
const app=new Hono<Bindings>();
const escape=(s:string)=>s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
async function gate(c:any,lock:any){const v=getCookie(c,'__Host-ksa_gate')||'';const [t,sig]=v.split('.');return Number(t)>now()&&sig===await hmac(c.env.AUTH_SECRET,t+':'+(lock.passwordHash||''));}
app.use('*',async(c,next)=>{
 const url=new URL(c.req.url),root=c.env.ROOT_DOMAIN,host=url.hostname,path=url.pathname;
 c.set('user',null);c.set('session',null);
 if(host==='www.'+root)return c.redirect('https://'+root+url.pathname+url.search,308);
 const local=['localhost','127.0.0.1'].includes(host);
 if(!local&&host!==root&&!new RegExp('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.'+root.replace('.','\\.')+'$').test(host))throw new HTTPException(404);
 const rootHost=host===root||local;
 const cookie=getCookie(c,'__Host-ksa_session');if(rootHost&&cookie){const s=await one<Session>(c,'SELECT * FROM sessions WHERE id=? AND revoked=0 AND expires_at>?',await digest(cookie),now());if(s){const u=await one<User>(c,'SELECT * FROM users WHERE id=? AND status=\'active\'',s.user_id);if(u){c.set('user',u);c.set('session',s);}}}
 const isStatic=path.startsWith('/assets/')||['/favicon.ico','/sw.js','/manifest.webmanifest','/offline.html'].includes(path);
 const lock:any=await setting(c,'lock',{mode:'private'});const bypass=c.get('user')?.role==='owner'||(['manager','moderator'].includes(c.get('user')?.role||''));const gateOk=await gate(c,lock);
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
  const origin=c.req.header('Origin');if(origin!==url.origin)throw new HTTPException(403,{message:'مصدر الطلب غير مسموح'});
  const session=c.get('session');if(session&&!['/api/auth/request','/api/auth/verify'].includes(path)&&c.req.header('X-CSRF-Token')!==session.csrf)throw new HTTPException(403,{message:'فشل التحقق من أمان الطلب'});
 }
 if(!rootHost&&path.startsWith('/api/')&&!path.startsWith('/api/public/')&&!path.startsWith('/api/media/'))throw new HTTPException(404);
 if(!rootHost&&['/manifest.webmanifest','/sw.js'].includes(path))throw new HTTPException(404);
 if(path.startsWith('/api/')&&!path.startsWith('/api/auth/')&&!['/api/platform','/api/gate'].includes(path)){
  const blocked=lock.mode!=='open'&&!(lock.mode==='home'&&path!=='/api/search');if(blocked&&!bypass&&!gateOk)throw new HTTPException(423,{message:lock.message||'المنصة مقفلة للاختبار الخاص'});
 }
 if(!rootHost&&!isStatic&&!path.startsWith('/api/')){if(lock.mode!=='open'&&!bypass&&!gateOk){return c.html(await lockHTML(c,lock),423);}const site=await publishedForHost(c);if(site.published&&await personalGate(c,site)){const p=publicProfile(JSON.parse(site.published));if(p.redirect&&safeUrl(p.redirect))return c.redirect(p.redirect,302);}}
 await next();
 c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');c.header('Strict-Transport-Security','max-age=31536000');c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");c.header('Cache-Control',isStatic?'public, max-age=3600':'private, no-store');if(lock.mode!=='open')c.header('X-Robots-Tag','noindex, nofollow');
});
async function lockHTML(c:any,lock:any){return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSA.MEN — اختبار خاص</title><body style="margin:0;background:#07120f;color:#f5f7f6;font-family:Arial;min-height:100vh;display:grid;place-items:center"><main style="padding:30px;text-align:center;max-width:460px"><img src="/assets/logo.webp" alt="KSA.MEN" width="200"><h1>ظهور رقمي يليق بك</h1><p>${escape(lock.message||'المنصة في اختبار خاص')}</p><a style="color:#6ee7a4" href="https://${c.env.ROOT_DOMAIN}/auth">دخول المالك والاختبار الخاص</a></main></body></html>`;}
app.get('/api/platform',async c=>{const lock:any=await setting(c,'lock',{mode:'private'});return c.json({lock:{mode:lock.mode,message:lock.message,reason:lock.reason,passwordEnabled:!!lock.passwordHash},access:lock.mode==='open'||c.get('user')?.role==='owner'||['manager','moderator'].includes(c.get('user')?.role||'')||await gate(c,lock),contact:await setting(c,'contact'),season:await setting(c,'season')});});
app.post('/api/gate',async c=>{const lock:any=await setting(c,'lock');await rate(c,'gate:'+c.req.header('CF-Connecting-IP'),6,900);const {password}=await c.req.json<any>();if(!lock.passwordHash||typeof password!=='string'||!await verifySecret(password,lock.passwordHash))throw new HTTPException(403,{message:'كلمة مرور البوابة غير صحيحة'});const t=now()+6*3600;setCookie(c,'__Host-ksa_gate',t+'.'+await hmac(c.env.AUTH_SECRET,t+':'+lock.passwordHash),{secure:true,httpOnly:true,sameSite:'Lax',path:'/',maxAge:6*3600});return c.json({ok:true});});
registerBackup(app);registerAuth(app);registerPublic(app);registerBusiness(app);registerOperations(app);registerIntelligence(app);
app.get('/robots.txt',async c=>{const l:any=await setting(c,'lock');return c.text(l.mode==='open'?'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /api/\n':'User-agent: *\nDisallow: /\n');});
app.get('*',async c=>{const path=new URL(c.req.url).pathname;const r=await c.env.ASSETS.fetch(new Request(new URL(path==='/'?'/index.html':path,c.req.url),c.req.raw));if(r.status===200)return r;if(path.startsWith('/assets/')||path.includes('.')||path.startsWith('/api/'))throw new HTTPException(404);return c.env.ASSETS.fetch(new Request(new URL('/index.html',c.req.url),c.req.raw));});
app.onError((err,c)=>{if(err instanceof ZodError)return c.json({error:err.issues.map(v=>v.message).join('،')},400);if(err instanceof HTTPException)return c.json({error:err.message||'تعذر تنفيذ الطلب'},err.status);console.error('KSA request failed',err.name);return c.json({error:'تعذر إتمام العملية بأمان، حاول مجددًا'},500);});
export default {fetch:app.fetch,async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(fetchRadar(env));if(new Date(_event.scheduledTime).getUTCHours()===0)ctx.waitUntil(makeBackup(env));}};

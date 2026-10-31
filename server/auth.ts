import type { App,Ctx,User } from './core';
import {now,uid,one,run,rate,hmac,digest,hashSecret,verifySecret,me,fresh,audit,safeUser,recordConsent} from './core';
import {HTTPException} from 'hono/http-exception';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import {z} from 'zod';

const emailSchema=z.string({error:'أدخل بريدك الإلكتروني'}).trim().email({message:'أدخل بريدًا إلكترونيًا صحيحًا'}).max(254,{message:'البريد الإلكتروني أطول من المسموح'}).transform(v=>v.toLowerCase());
const pinSchema=z.string({error:'أدخل PIN من ٦ أرقام'}).regex(/^\d{6}$/,{message:'يجب أن يتكون PIN من ٦ أرقام'});
const quickSchema=z.object({email:emailSchema,pin:pinSchema});
const requestSchema=z.object({
 email:emailSchema,name:z.string().trim().max(100,{message:'الاسم أطول من المسموح'}).optional(),whatsapp:z.string().trim().max(30,{message:'رقم واتساب أطول من المسموح'}).optional(),
 consent:z.boolean().optional(),ageConfirmed:z.boolean().optional(),purpose:z.enum(['login','register','recover','reauth']).default('login'),referral:z.string().max(70).optional(),
});

export async function mail(c:Ctx,email:string,code:string){
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+c.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'KSA.MEN <auth@ksa.men>',to:[email],subject:'رمز الدخول الآمن — KSA.MEN',html:`<div dir="rtl" style="font-family:Arial;padding:28px;background:#f4f7f5"><h2 style="color:#006837">ظهور رقمي يليق بك</h2><p>رمز التحقق الخاص بك:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold">${code}</p><p>صالح لعشر دقائق، لمرة واحدة. لا تشاركه مع أحد.</p><p>إذا لم تطلب الدخول فتجاهل الرسالة.</p></div>`})});
 if(!r.ok)throw new HTTPException(503,{message:'تعذر إرسال رمز البريد، حاول بعد قليل'});return r.json();
}
function deviceToken(c:Ctx){return getCookie(c,'__Host-ksa_device')||'';}
async function currentDeviceId(c:Ctx){const token=deviceToken(c);return token?digest(token):'';}
async function issueSession(c:Ctx,user:User,verifiedAt:number,expiresIn:number){
 const raw=uid()+uid(),csrf=uid(),clock=now();
 await run(c,'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',await digest(raw),user.id,csrf,clock+expiresIn,verifiedAt,clock,clock);
 setCookie(c,'__Host-ksa_session',raw,{secure:true,httpOnly:true,sameSite:'Lax',path:'/',maxAge:expiresIn});return csrf;
}
async function issueDevice(c:Ctx,user:User){
 const raw=uid()+uid(),clock=now();
 await run(c,'INSERT INTO devices(id,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)',await digest(raw),user.id,clock+30*86400,clock,clock);
 setCookie(c,'__Host-ksa_device',raw,{secure:true,httpOnly:true,sameSite:'Strict',path:'/',maxAge:30*86400});
}
function compactSession(row:any,currentId:string){return {id:String(row.id).slice(0,12),current:row.id===currentId,createdAt:Number(row.created_at||0),lastSeenAt:Number(row.last_seen_at||0),expiresAt:Number(row.expires_at),verifiedAt:Number(row.verified_at),revoked:Boolean(row.revoked)};}
function compactDevice(row:any,currentId:string){return {id:String(row.id).slice(0,12),current:row.id===currentId,createdAt:Number(row.created_at||0),lastSeenAt:Number(row.last_seen_at||0),expiresAt:Number(row.expires_at),revoked:Boolean(row.revoked)};}

export function registerAuth(app:App){
 app.get('/api/auth/me',async c=>{const u=c.get('user');const balance=u?await one<any>(c,'SELECT balance FROM wallets WHERE user_id=?',u.id):null;return c.json({user:u?{...safeUser(u),balance:balance?.balance??0}:null,csrf:c.get('session')?.csrf??null,trusted:!!(deviceToken(c)&&await one(c,'SELECT id FROM devices WHERE id=? AND revoked=0 AND expires_at>?',await currentDeviceId(c),now()))});});
 app.post('/api/auth/request',async c=>{
  const data=requestSchema.parse(await c.req.json()); await rate(c,'auth-ip:'+c.req.header('CF-Connecting-IP'),12,3600);
  if(data.purpose==='register'&&(!data.name||data.name.length<2||!data.whatsapp||data.consent!==true||data.ageConfirmed!==true))throw new HTTPException(400,{message:'أكمل الاسم وواتساب وأقر ببلوغ 18 عاماً والموافقة الصريحة على السياسات'});
  if(data.purpose!=='register'){delete data.name;delete data.whatsapp;delete data.consent;delete data.ageConfirmed;delete data.referral;}
  const exists=await one<User>(c,'SELECT * FROM users WHERE email=?',data.email);const lock:any=await one(c,"SELECT value FROM settings WHERE key='lock'");const lockData=lock?JSON.parse(lock.value):{mode:'open'};
  const rawGate=getCookie(c,'__Host-ksa_gate')||'';const [gateTime,gateSig]=rawGate.split('.');const gateValid=!!lockData.passwordHash&&Number(gateTime)>now()&&(gateSig===await hmac(c.env.AUTH_SECRET,gateTime+':'+lockData.passwordHash)||gateSig===await hmac(c.env.AUTH_SECRET,gateTime+':'+lockData.passwordHash+':'+new URL(c.req.url).hostname));
  const privileged=data.email===c.env.OWNER_EMAIL||['manager','moderator'].includes(exists?.role||'');const blocked=!['open','home'].includes(lockData.mode)&&!privileged&&!gateValid;const requestMessage=data.purpose==='register'?'تم إرسال رمز التحقق إلى بريدك':'إن كان البريد مرتبطًا بحساب، سيصلك رمز الدخول. للزيارة الأولى اختر إنشاء حساب.';
  if(data.purpose!=='register'&&(blocked||(!exists&&data.email!==c.env.OWNER_EMAIL)))return c.json({challenge:uid(),message:requestMessage,expiresIn:600});
  if(blocked)throw new HTTPException(423,{message:'المنصة في اختبار خاص. يلزم دخول البوابة أولاً'});await rate(c,'auth-email:'+data.email,5,3600);
  const id=uid(),arr=new Uint32Array(1);crypto.getRandomValues(arr);const code=String(arr[0]%1000000).padStart(6,'0');const hash=await hmac(c.env.AUTH_SECRET,id+':'+code);const nonce=uid();
  await run(c,'INSERT INTO auth_codes(id,email,code_hash,payload,purpose,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',id,data.email,hash,JSON.stringify({...data,nonce:await digest(nonce)}),data.purpose,now()+600,now());setCookie(c,'__Host-ksa_challenge',nonce,{secure:true,httpOnly:true,sameSite:'Lax',path:'/',maxAge:600});
  try{await mail(c,data.email,code);}catch(error){await run(c,'UPDATE auth_codes SET consumed=1 WHERE id=?',id);throw error;}return c.json({challenge:id,message:requestMessage,expiresIn:600});
 });
 app.post('/api/auth/verify',async c=>{
  const {challenge,code,pin}=z.object({challenge:z.string().uuid(),code:z.string().regex(/^\d{6}$/,{message:'أدخل رمز التحقق من ٦ أرقام'}),pin:z.string().regex(/^\d{6}$/,{message:'أدخل PIN من ٦ أرقام'}).optional()}).parse(await c.req.json());
  await rate(c,'verify:'+c.req.header('CF-Connecting-IP'),30,600);const row:any=await one(c,'SELECT * FROM auth_codes WHERE id=?',challenge);if(!row||row.consumed||row.expires_at<now()||row.attempts>=5)throw new HTTPException(400,{message:'الرمز منتهي أو استُخدم. اطلب رمزًا جديدًا'});
  await run(c,'UPDATE auth_codes SET attempts=attempts+1 WHERE id=?',challenge);const payload=JSON.parse(row.payload);if(await digest(getCookie(c,'__Host-ksa_challenge')||'')!==payload.nonce||await hmac(c.env.AUTH_SECRET,challenge+':'+code)!==row.code_hash)throw new HTTPException(400,{message:'رمز التحقق غير صحيح'});
  const consumed=await run(c,'UPDATE auth_codes SET consumed=1 WHERE id=? AND consumed=0 AND expires_at>=? AND attempts<=5',challenge,now());if(!consumed.meta.changes)throw new HTTPException(400,{message:'الرمز مستخدم'});
  let u=await one<User>(c,'SELECT * FROM users WHERE email=?',row.email);let created=false;
  if(!u){let referral:number|null=null;if(payload.referral){const n=String(payload.referral);const ref:any=/^C\d+$/.test(n)?await one(c,'SELECT id,email FROM users WHERE id=?',Number(n.slice(1))):await one(c,'SELECT u.id,u.email FROM dns_names n JOIN users u ON u.id=n.owner_id WHERE n.name=?',n.toLowerCase());if(ref&&ref.email!==row.email)referral=ref.id;}
   const owner=row.email===c.env.OWNER_EMAIL&&!await one(c,"SELECT id FROM users WHERE role='owner'");await run(c,'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,referrer_id,consent_at,last_active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING',row.email,payload.name||(owner?'التميمي':'عضو KSA.MEN'),payload.whatsapp||'',owner?'owner':'user',now(),now()+3*86400,referral,now(),now());u=await one<User>(c,'SELECT * FROM users WHERE email=?',row.email);created=true;
  }
  if(!u||u.status!=='active')throw new HTTPException(403,{message:'الحساب معلق'});if(pin)await run(c,'UPDATE users SET pin_hash=? WHERE id=?',await hashSecret(pin),u.id);
  if(row.purpose==='recover'||pin)await c.env.DB.batch([c.env.DB.prepare("UPDATE sessions SET revoked=1,revocation_reason='credential_reset' WHERE user_id=?").bind(u.id),c.env.DB.prepare("UPDATE devices SET revoked=1,revocation_reason='credential_reset' WHERE user_id=?").bind(u.id)]);
  const csrf=await issueSession(c,u,now(),7*86400);await issueDevice(c,u);deleteCookie(c,'__Host-ksa_challenge',{path:'/',secure:true});
  if(created){c.set('user',u);await recordConsent(c,'account_creation','registration',true);}
  c.set('user',u);await audit(c,'auth.verified',u.id,{purpose:row.purpose,accountCreated:created});return c.json({user:safeUser(u),csrf});
 });
 app.post('/api/auth/quick',async c=>{const {email,pin}=quickSchema.parse(await c.req.json());const token=deviceToken(c);if(!token)throw new HTTPException(401,{message:'تحقق بالبريد لتوثيق هذا الجهاز أولاً'});const id=await currentDeviceId(c);const d:any=await one(c,'SELECT * FROM devices WHERE id=? AND revoked=0 AND expires_at>?',id,now());if(!d)throw new HTTPException(401,{message:'انتهت ثقة الجهاز، تحقق بالبريد'});await rate(c,'pin:'+d.id,5,900);const u:any=await one(c,'SELECT * FROM users WHERE id=? AND email=?',d.user_id,email);if(!u?.pin_hash||u.status!=='active'||!await verifySecret(pin,u.pin_hash))throw new HTTPException(401,{message:'تعذر الدخول بهذا البريد وPIN على الجهاز الحالي. تحقق من بياناتك أو استخدم رمز البريد'});await run(c,'UPDATE devices SET last_seen_at=? WHERE id=?',now(),id);const csrf=await issueSession(c,u,0,86400);return c.json({user:safeUser(u),csrf});});
 app.post('/api/auth/pin',async c=>{const u=me(c);fresh(c);const {pin}=z.object({pin:pinSchema}).parse(await c.req.json());const current=c.get('session')!.id;await c.env.DB.batch([c.env.DB.prepare('UPDATE users SET pin_hash=? WHERE id=?').bind(await hashSecret(pin),u.id),c.env.DB.prepare("UPDATE devices SET revoked=1,revocation_reason='pin_changed' WHERE user_id=?").bind(u.id),c.env.DB.prepare("UPDATE sessions SET revoked=1,revocation_reason='pin_changed' WHERE user_id=? AND id<>?").bind(u.id,current)]);await issueDevice(c,u);await audit(c,'auth.pin.changed',u.id,{});return c.json({ok:true});});
 app.get('/api/auth/sessions',async c=>{const u=me(c);fresh(c);const current=c.get('session')!.id;const rows=(await c.env.DB.prepare('SELECT id,expires_at,verified_at,revoked,created_at,last_seen_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(u.id).all()).results;return c.json({sessions:rows.map(row=>compactSession(row,current))});});
 app.get('/api/auth/devices',async c=>{const u=me(c);fresh(c);const current=await currentDeviceId(c);const rows=(await c.env.DB.prepare('SELECT id,expires_at,revoked,created_at,last_seen_at FROM devices WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(u.id).all()).results;return c.json({devices:rows.map(row=>compactDevice(row,current))});});
 app.post('/api/auth/sessions/:id/revoke',async c=>{const u=me(c);fresh(c);const prefix=z.string().regex(/^[a-f0-9]{12}$/).parse(c.req.param('id'));const result=await run(c,"UPDATE sessions SET revoked=1,revocation_reason='member_revoked' WHERE user_id=? AND substr(id,1,12)=? AND revoked=0",u.id,prefix);if(!result.meta.changes)throw new HTTPException(404,{message:'الجلسة غير موجودة أو منتهية'});await audit(c,'auth.session.revoked',`session:${prefix}`,{});return c.json({ok:true});});
 app.post('/api/auth/devices/:id/revoke',async c=>{const u=me(c);fresh(c);const prefix=z.string().regex(/^[a-f0-9]{12}$/).parse(c.req.param('id'));const result=await run(c,"UPDATE devices SET revoked=1,revocation_reason='member_revoked' WHERE user_id=? AND substr(id,1,12)=? AND revoked=0",u.id,prefix);if(!result.meta.changes)throw new HTTPException(404,{message:'الجهاز غير موجود أو منتهٍ'});if((await currentDeviceId(c)).startsWith(prefix))deleteCookie(c,'__Host-ksa_device',{path:'/',secure:true});await audit(c,'auth.device.revoked',`device:${prefix}`,{});return c.json({ok:true});});
 app.post('/api/auth/logout',async c=>{const s=c.get('session');if(s)await run(c,"UPDATE sessions SET revoked=1,revocation_reason='logout' WHERE id=?",s.id);deleteCookie(c,'__Host-ksa_session',{path:'/',secure:true});deleteCookie(c,'__Host-ksa_gate',{path:'/',secure:true});return c.json({ok:true});});
 app.post('/api/auth/devices/revoke',async c=>{const u=me(c);fresh(c);await c.env.DB.batch([c.env.DB.prepare("UPDATE devices SET revoked=1,revocation_reason='member_revoked_all' WHERE user_id=?").bind(u.id),c.env.DB.prepare("UPDATE sessions SET revoked=1,revocation_reason='member_revoked_all' WHERE user_id=? AND id<>?").bind(u.id,c.get('session')!.id)]);deleteCookie(c,'__Host-ksa_device',{path:'/',secure:true});await audit(c,'auth.devices.revoked_all',u.id,{});return c.json({ok:true});});
}

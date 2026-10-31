import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export interface Env {
  DB:D1Database; MEDIA:R2Bucket; AI:Ai; ASSETS:Fetcher;
  AUTH_SECRET:string; RESEND_API_KEY:string; ROOT_DOMAIN:string; OWNER_EMAIL:string;
  /** Independent backup secret. Never fall back to AUTH_SECRET. */
  BACKUP_ENCRYPTION_KEY?:string;
  /** Previous independent backup secret, used only while rotating backup ciphertexts. */
  BACKUP_ENCRYPTION_PREVIOUS_KEY?:string;
}
export interface User {id:number;email:string;name:string;whatsapp:string;role:'owner'|'manager'|'moderator'|'user';financial:number;status:string;pin_hash?:string|null;created_at:number;trial_until:number;entitlement_until:number;referrer_id?:number|null;assigned_to?:number|null;balance?:number;}
export interface Session {id:string;user_id:number;csrf:string;expires_at:number;verified_at:number;revoked:number;created_at?:number;last_seen_at?:number;}
export type Bindings={Bindings:Env;Variables:{user:User|null;session:Session|null}};
export type App=Hono<Bindings>; export type Ctx=Context<Bindings>;
export const now=()=>Math.floor(Date.now()/1000); export const uid=()=>crypto.randomUUID();
export const one=async<T=any>(c:Ctx,sql:string,...args:any[])=>c.env.DB.prepare(sql).bind(...args).first<T>();
export const all=async<T=any>(c:Ctx,sql:string,...args:any[])=> (await c.env.DB.prepare(sql).bind(...args).all<T>()).results;
export const run=async(c:Ctx,sql:string,...args:any[])=>c.env.DB.prepare(sql).bind(...args).run();

const enc=new TextEncoder();
export async function digest(text:string){const b=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}
export async function hmac(secret:string,text:string){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const b=await crypto.subtle.sign('HMAC',k,enc.encode(text));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}

function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)]));
 if(['string','number','boolean'].includes(typeof value)||value===null)return value;
 return String(value);
}
const auditSensitive=/^(?:email|phone|whatsapp|password|pin|code|token|secret|authorization|reason|message|body|content|snapshot|draft|receipt|evidence)$/i;
async function minimizedAuditDetail(env:Env,input:unknown):Promise<string>{
 let value:unknown=input;
 if(typeof value==='string'){const raw=value;try{value=JSON.parse(raw);}catch{return JSON.stringify({text_hash:await hmac(env.AUTH_SECRET,raw),present:Boolean(raw)});}}
 const sanitize=async(item:unknown,key=''):Promise<unknown>=>{
  if(auditSensitive.test(key))return {redacted:true,hash:await hmac(env.AUTH_SECRET,typeof item==='string'?item:JSON.stringify(stable(item)))};
  if(Array.isArray(item))return Promise.all(item.slice(0,30).map(entry=>sanitize(entry)));
  if(item&&typeof item==='object'){
   const output:Record<string,unknown>={};
   for(const [name,entry] of Object.entries(item as Record<string,unknown>).slice(0,40))output[name]=await sanitize(entry,name);
   return output;
  }
  if(typeof item==='string')return item.length>160?{truncated:true,hash:await hmac(env.AUTH_SECRET,item)}:item;
  return item===undefined?null:item;
 };
 return JSON.stringify(await sanitize(value));
}
export async function auditRowHash(prevHash:string,actorId:number|null,action:string,target:string|number,detail:string,createdAt:number){
 return digest(JSON.stringify(stable({prevHash,actorId,action,target:String(target),detail,createdAt})));
}
/** Appends an integrity-linked, minimised record. Migration 0011 makes audit immutable. */
export async function appendAudit(env:Env,actorId:number|null,action:string,target:string|number,detail:unknown={}):Promise<void>{
 const createdAt=now(); const safeDetail=await minimizedAuditDetail(env,detail);
 for(let attempt=0;attempt<4;attempt++){
  const state=await env.DB.prepare("SELECT last_hash,last_audit_id FROM audit_chain_state WHERE chain_name='primary'").first<{last_hash:string;last_audit_id:number}>();
  if(!state)throw new Error('Audit chain is not initialised');
  const rowHash=await auditRowHash(state.last_hash,actorId,action,target,safeDetail,createdAt);
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO audit(actor_id,action,target,detail,created_at,prev_hash,row_hash)
                   SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_chain_state WHERE chain_name='primary' AND last_hash=?)`)
     .bind(actorId,action,String(target),safeDetail,createdAt,state.last_hash,rowHash,state.last_hash),
   env.DB.prepare("UPDATE audit_chain_state SET last_hash=?,last_audit_id=(SELECT MAX(id) FROM audit),updated_at=? WHERE chain_name='primary' AND last_hash=?")
     .bind(rowHash,createdAt,state.last_hash),
  ]);
  if(Number(result[0]?.meta?.changes??0)===1)return;
 }
 throw new Error('Audit chain contention exceeded retry limit');
}
export const audit=async(c:Ctx,action:string,target:string|number,detail:any={})=>appendAudit(c.env,c.get('user')?.id??null,action,target,detail);

const consentCopy:Record<string,{question:string;affirmation:string}>={
 account_creation:{question:'هل تريد إنشاء حساب في KSA.MEN؟',affirmation:'نعم، أريد إنشاء حسابي.'},
 public_profile:{question:'هل تريد إرسال موقعك للمراجعة تمهيداً للنشر العام؟',affirmation:'نعم، أريد طلب نشر موقعي للعامة بعد الاعتماد.'},
 translation:{question:'هل تريد معالجة النصوص التي اخترتها للترجمة؟',affirmation:'نعم، أريد ترجمة النصوص المحددة.'},
 contact:{question:'هل تريد إتاحة طلبات التواصل عبر موقعك؟',affirmation:'نعم، أريد إتاحة طلبات التواصل.'},
};
export async function recordConsent(c:Ctx,purpose:keyof typeof consentCopy,source:string,affirmative=true):Promise<void>{
 const user=me(c); const wording=consentCopy[purpose];
 if(!affirmative)throw new HTTPException(422,{message:'يلزم تأكيد إرادة صريحة لهذا الخيار'});
 const notice=await setting<string>(c,'privacy_notice_version','2026-10-31');
 const active=await one<{id:string}>(c,"SELECT id FROM consent_records WHERE user_id=? AND purpose=? AND withdrawn_at IS NULL ORDER BY granted_at DESC LIMIT 1",user.id,purpose);
 if(active)return;
 await run(c,"INSERT INTO consent_records(id,user_id,purpose,notice_version,question,affirmation,source,granted_at) VALUES(?,?,?,?,?,?,?,?)",uid(),user.id,purpose,notice,wording.question,wording.affirmation,source,now());
 await audit(c,'consent.granted',`consent:${purpose}`,{purpose,source,noticeVersion:notice});
}
export async function withdrawConsent(c:Ctx,purpose:keyof typeof consentCopy,source:string):Promise<void>{
 const user=me(c); const result=await run(c,"UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND purpose=? AND withdrawn_at IS NULL",now(),user.id,purpose);
 if(Number((result as any).meta?.changes??0))await audit(c,'consent.withdrawn',`consent:${purpose}`,{purpose,source});
}

export const me=(c:Ctx):User=>{const u=c.get('user');if(!u)throw new HTTPException(401,{message:'سجّل الدخول أولاً'});if(u.status!=='active')throw new HTTPException(403,{message:'الحساب غير متاح'});return u;};
export const role=(c:Ctx,roles:string[])=>{const u=me(c);if(!roles.includes(u.role))throw new HTTPException(403,{message:'ليست لديك صلاحية لهذا الإجراء'});return u;};
export const finance=(c:Ctx)=>{const u=role(c,['owner','manager']);if(u.role!=='owner'&&!u.financial)throw new HTTPException(403,{message:'يلزم تفويض مالي'});return u;};
/** 15-minute email-verification step-up required for every sensitive server operation. */
export const fresh=(c:Ctx)=>{me(c);if(!c.get('session')||now()-(c.get('session')?.verified_at??0)>900)throw new HTTPException(403,{message:'أعد التحقق من البريد لإتمام الإجراء الحساس'});};
const requestSettings=new WeakMap<object,Promise<Map<string,any>>>();
export async function setting<T=any>(c:Ctx,key:string,fallback?:T):Promise<T>{let pending=requestSettings.get(c);if(!pending){pending=all<{key:string,value:string}>(c,'SELECT key,value FROM settings').then(rows=>new Map(rows.map(r=>[r.key,JSON.parse(r.value)])));requestSettings.set(c,pending);}const values=await pending;return values.has(key)?values.get(key):fallback as T;}
export async function siteFor(c:Ctx,id?:string){const u=me(c);const s:any=id?await one(c,'SELECT * FROM sites WHERE id=?',id):await one(c,'SELECT * FROM sites WHERE user_id=? ORDER BY created_at LIMIT 1',u.id);if(!s)throw new HTTPException(404,{message:'الموقع غير موجود'});if(s.user_id===u.id||s.manager_id===u.id||u.role==='owner')return s;if(u.role==='manager'&&s.user_id!==null&&await one(c,'SELECT id FROM users WHERE id=? AND assigned_to=?',s.user_id,u.id))return s;throw new HTTPException(403,{message:'الموقع ليس ضمن صلاحياتك'});}

export async function serviceState(c:Ctx,key:string,userId?:number){
 const u=userId?await one<User>(c,'SELECT * FROM users WHERE id=?',userId):me(c);
 if(!u||u.status!=='active')throw new HTTPException(403,{message:'الحساب غير متاح'});
 const catalog:any=await one(c,'SELECT * FROM services WHERE key=?',key);
 if(!catalog)return {enabled:false,entitled:false,reason:'الخدمة غير موجودة',sources:[]};
 const override:any=await one(c,'SELECT * FROM user_services WHERE user_id=? AND key=?',u.id,key);
 const policy=typeof catalog.policy==='string'?JSON.parse(catalog.policy):catalog.policy||{};
 const clock=now();
 const active:any[]=await all(c,'SELECT source_kind,starts_at,ends_at FROM entitlement_sources WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND ends_at>?',u.id,clock,clock);
 const sources=active.filter(v=>policy[v.source_kind]!==false).map(v=>v.source_kind);
 if(u.trial_until>clock&&policy.trial!==false&&!sources.includes('trial'))sources.push('trial');
 if(override?.mode==='grant'&&policy.grant!==false&&(!override.until_at||override.until_at>clock))sources.push('grant');
 const enabled=!!catalog.enabled;
 const suspended=override?.mode==='suspended';
 const entitled=enabled&&!suspended&&(!catalog.premium||sources.length>0);
 return {enabled,entitled,policy,override:override?{mode:override.mode,untilAt:override.until_at}:null,sources:[...new Set(sources)],reason:!enabled?'الخدمة معلقة على مستوى المنصة':suspended?'الخدمة معلقة لهذا الحساب':!entitled?'الخدمة تحتاج استحقاقًا نشطًا':null};
}
export async function service(c:Ctx,key:string,userId?:number){const state=await serviceState(c,key,userId);if(!state.entitled)throw new HTTPException(403,{message:state.reason||'الخدمة غير متاحة'});return true;}
export async function hashSecret(value:string){const salt=uid();const k=await crypto.subtle.importKey('raw',enc.encode(value),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256);return salt+'.'+Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifySecret(value:string,hash:string){const [salt,expected]=hash.split('.');if(!salt||!expected)return false;const k=await crypto.subtle.importKey('raw',enc.encode(value),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256);const actual=Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');return equal(actual,expected);}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function rate(c:Ctx,key:string,max:number,seconds:number){const k=await digest(key);await run(c,'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END',k,now()+seconds,now(),now());const r:any=await one(c,'SELECT count FROM rate_limits WHERE key=?',k);if(r.count>max)throw new HTTPException(429,{message:'محاولات متكررة، انتظر قليلًا ثم حاول مجددًا'});}
export function safeUrl(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function publicProfile(p:any){const r=structuredClone(p||{});for(const k of r.hidden||[])delete r[k];delete r.hidden;delete r.translations;delete r.private;delete r.notes;return r;}
export function safeUser(u:any){if(!u)return null;const {pin_hash,...rest}=u;return rest;}

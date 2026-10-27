import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
export interface Env { DB:D1Database; MEDIA:R2Bucket; AI:Ai; ASSETS:Fetcher; AUTH_SECRET:string; RESEND_API_KEY:string; ROOT_DOMAIN:string; OWNER_EMAIL:string }
export interface User {id:number;email:string;name:string;whatsapp:string;role:'owner'|'manager'|'moderator'|'user';financial:number;status:string;pin_hash?:string|null;created_at:number;trial_until:number;entitlement_until:number;referrer_id?:number|null;assigned_to?:number|null;balance?:number;}
export interface Session {id:string;user_id:number;csrf:string;expires_at:number;verified_at:number;revoked:number;}
export type Bindings={Bindings:Env;Variables:{user:User|null;session:Session|null}};
export type App=Hono<Bindings>; export type Ctx=Context<Bindings>;
export const now=()=>Math.floor(Date.now()/1000); export const uid=()=>crypto.randomUUID();
export const one=async<T=any>(c:Ctx,sql:string,...args:any[])=>c.env.DB.prepare(sql).bind(...args).first<T>();
export const all=async<T=any>(c:Ctx,sql:string,...args:any[])=> (await c.env.DB.prepare(sql).bind(...args).all<T>()).results;
export const run=async(c:Ctx,sql:string,...args:any[])=>c.env.DB.prepare(sql).bind(...args).run();
export const audit=async(c:Ctx,action:string,target:string|number,detail:any={})=>run(c,'INSERT INTO audit(actor_id,action,target,detail,created_at) VALUES(?,?,?,?,?)',c.get('user')?.id??null,action,String(target),JSON.stringify(detail),now());
export const me=(c:Ctx):User=>{const u=c.get('user');if(!u)throw new HTTPException(401,{message:'سجّل الدخول أولاً'});if(u.status!=='active')throw new HTTPException(403,{message:'الحساب غير متاح'});return u;};
export const role=(c:Ctx,roles:string[])=>{const u=me(c);if(!roles.includes(u.role))throw new HTTPException(403,{message:'ليست لديك صلاحية لهذا الإجراء'});return u;};
export const finance=(c:Ctx)=>{const u=role(c,['owner','manager']);if(u.role!=='owner'&&!u.financial)throw new HTTPException(403,{message:'يلزم تفويض مالي'});return u;};
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

const enc=new TextEncoder();
export async function digest(text:string){const b=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}
export async function hmac(secret:string,text:string){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const b=await crypto.subtle.sign('HMAC',k,enc.encode(text));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}
export async function hashSecret(value:string){const salt=uid();const k=await crypto.subtle.importKey('raw',enc.encode(value),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256);return salt+'.'+Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifySecret(value:string,hash:string){const [salt,expected]=hash.split('.');if(!salt||!expected)return false;const k=await crypto.subtle.importKey('raw',enc.encode(value),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256);const actual=Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');return equal(actual,expected);}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function rate(c:Ctx,key:string,max:number,seconds:number){const k=await digest(key);await run(c,'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END',k,now()+seconds,now(),now());const r:any=await one(c,'SELECT count FROM rate_limits WHERE key=?',k);if(r.count>max)throw new HTTPException(429,{message:'محاولات متكررة، انتظر قليلًا ثم حاول مجددًا'});}
export function safeUrl(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function publicProfile(p:any){const r=structuredClone(p||{});for(const k of r.hidden||[])delete r[k];delete r.hidden;delete r.translations;delete r.private;return r;}
export function safeUser(u:any){if(!u)return null;const {pin_hash,...rest}=u;return rest;}

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { defaultProfile } from '../server/business';
import { digest, now, uid } from '../server/core';
import { newQuickToken } from '../server/quick-links';
import { quickURL } from '../shared/quick-link';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-quick-')), 'local.sqlite');
function sql(payload: unknown): any { const result=spawnSync('python3',['scripts/sqlite_bridge.py'],{input:JSON.stringify({database,...payload as object}),encoding:'utf8'});const value=JSON.parse(result.stdout||'{}');if(value.error)throw new Error(value.error);return value; }
class Statement { params:unknown[]=[];constructor(public query:string){}bind(...params:unknown[]){this.params=params;return this;}async all(){return sql({sql:this.query,params:this.params});}async first(){return(await this.all()).results[0]||null;}async run(){return this.all();} }
const actors:Record<string,{id:number;cookie:string;csrf:string}>={};
const siteId=uid();let current='';
const profile={...defaultProfile('هوية اختبار غير حقيقية'),title:'مختص اختبار',phone:'0555123456',whatsapp:'0555123456',email:'selected@quick.invalid',notes:'PRIVATE NOTE',bio:'UNSELECTED BIO'};
const env:any={ROOT_DOMAIN:'ksa.men',AUTH_SECRET:'unit-quick-secret',DB:{prepare:(q:string)=>new Statement(q),batch:async(rows:Statement[])=>sql({batch:rows.map(s=>({sql:s.query,params:s.params}))})},ASSETS:{fetch:async()=>new Response('<!doctype html><html><head><title>Old</title><meta property="og:image" content="old-cover"></head><body><div id="root"></div></body></html>',{headers:{'Content-Type':'text/html'}})}};
async function request(path:string,actor?:string,method='GET',body?:unknown,extra:Record<string,string>={}) { const headers:Record<string,string>={Origin:'https://ksa.men',...extra};if(actor){headers.Cookie=actors[actor].cookie;headers['X-CSRF-Token']=actors[actor].csrf;}if(body)headers['Content-Type']='application/json';Object.assign(headers,extra);const response=await worker.fetch(new Request('https://ksa.men'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,{} as any);return{response,status:response.status,body:await response.clone().text(),data:await response.json().catch(()=>null)}; }
beforeAll(async()=>{
 sql({setup:'migrations'});sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 for(const key of ['member','stranger']){sql({sql:'INSERT INTO users(email,name,whatsapp,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?)',params:[key+'@quick.invalid',key,'0555123456',now(),now()+86400,now()]});const id=sql({sql:'SELECT id FROM users WHERE email=?',params:[key+'@quick.invalid']}).results[0].id;const raw=uid()+uid(),csrf=uid();sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,?)',params:[await digest(raw),id,csrf,now()+86400,now()]});actors[key]={id,cookie:'__Host-ksa_session='+raw,csrf};}
 sql({sql:'INSERT INTO sites(id,user_id,draft,status,created_at,updated_at) VALUES(?,?,?,\'draft\',?,?)',params:[siteId,actors.member.id,JSON.stringify(profile),now(),now()]});
 sql({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:['quick-local',actors.member.id,siteId,now()]});
},30000);
describe.sequential('Short introductions and social metadata — local D1 fixture only',()=>{
 it('creates direct 16-character random links without changing the draft or selected lifetime/mode',async()=>{
  const tokens=Array.from({length:100},newQuickToken);expect(new Set(tokens).size).toBe(100);for(const token of tokens)expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
  const r=await request('/api/quick-links?siteId='+siteId,'member','POST',{mode:'business',fields:['name','phone','whatsapp','site'],expiresDays:7});expect(r.status,r.body).toBe(201);current=r.data.id;expect(r.data.url).toBe('https://ksa.men/q/'+current);expect(r.data.url.length).toBeLessThan(40);expect(r.data.mode).toBe('business');expect(r.data.expiresAt-r.data.createdAt).toBe(7*86400);
  const data=await request('/api/public/quick/'+current);expect(data.data.mode).toBe('business');expect(data.data.profile.phone).toBe(profile.phone);expect(data.data.profile.url).toBe('https://quick-local.ksa.men/');expect(data.body).not.toMatch(/PRIVATE NOTE|UNSELECTED BIO|selected@quick.invalid/);
  expect(JSON.parse(sql({sql:'SELECT draft FROM sites WHERE id=?',params:[siteId]}).results[0].draft)).toEqual(profile);
 });
 it('renders one branded generic preview before JS for visitors and social bots, no private contact data or schema',async()=>{
  for(const path of ['/q/'+current,'/quick/'+current])for(const ua of ['Mozilla/5.0','facebookexternalhit/1.1','Twitterbot','LinkedInBot']){const r=await request(path,undefined,'GET',undefined,{'User-Agent':ua});expect(r.status,r.body).toBe(200);expect(r.response.headers.get('Location')).toBeNull();expect(r.response.headers.get('Cache-Control')).toBe('private, no-store');expect(r.response.headers.get('Referrer-Policy')).toBe('no-referrer');expect(r.response.headers.get('X-Robots-Tag')).toContain('noindex');expect(r.body.match(/property="og:image"/g)).toHaveLength(1);expect(r.body).toContain('https://ksa.men/assets/share-logo-1200-v1.png');expect(r.body).toContain('content="1200"');expect(r.body).toContain('بطاقة تعارف');expect(r.body).not.toMatch(/0555123456|selected@quick.invalid|هوية اختبار غير حقيقية|PRIVATE NOTE|UNSELECTED BIO|application\/ld\+json|old-cover/);}
  const en=await request('/q/'+current+'?lang=en');expect(en.body).toContain('Introduction card');expect(en.body).toContain('lang="en" dir="ltr"');
 });
 it('preserves a legacy UUID and payload byte-for-byte and resolves it without redirection',async()=>{
  const old='610ea163-ce4a-4b24-bccb-006ddbb22fe8',payload=JSON.stringify({values:{name:profile.name,email:profile.email,notes:'DO NOT LEAK',url:'javascript:alert(1)'}});sql({sql:'INSERT INTO quick_links(id,user_id,payload,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)',params:[old,actors.member.id,payload,now()+86400,now()]});
  expect(quickURL(old,'ksa.men')).toBe('https://ksa.men/quick/'+old);expect((await request('/quick/'+old)).status).toBe(200);const r=await request('/api/public/quick/'+old);expect(r.status,r.body).toBe(200);expect(r.data.profile.email).toBe(profile.email);expect(r.body).not.toMatch(/DO NOT LEAK|javascript/);expect(sql({sql:'SELECT payload FROM quick_links WHERE id=?',params:[old]}).results[0].payload).toBe(payload);
 });
 it('enforces hiding, locking, suspension and tombstones at every read without changing the link snapshot',async()=>{
  sql({sql:'INSERT INTO site_visibility(site_id,hidden_fields,hidden_items,visible,listed,indexable,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)',params:[siteId,'["phone","whatsapp"]','[]',1,1,1,now(),actors.member.id]});let r=await request('/api/public/quick/'+current);expect(r.status,r.body).toBe(200);expect(r.data.profile).not.toHaveProperty('phone');expect(r.data.profile).not.toHaveProperty('whatsapp');
  sql({sql:'UPDATE site_visibility SET visible=0 WHERE site_id=?',params:[siteId]});expect((await request('/q/'+current)).status).toBe(404);expect((await request('/api/public/quick/'+current)).status).toBe(404);sql({sql:'UPDATE site_visibility SET visible=1 WHERE site_id=?',params:[siteId]});
  sql({sql:'UPDATE sites SET lock_hash=? WHERE id=?',params:['locked',siteId]});expect((await request('/api/public/quick/'+current)).status).toBe(404);sql({sql:'UPDATE sites SET lock_hash=NULL WHERE id=?',params:[siteId]});
  sql({sql:"UPDATE users SET status='suspended' WHERE id=?",params:[actors.member.id]});expect((await request('/q/'+current)).status).toBe(404);sql({sql:"UPDATE users SET status='active' WHERE id=?",params:[actors.member.id]});
  sql({sql:"UPDATE sites SET status='deleted' WHERE id=?",params:[siteId]});expect((await request('/api/public/quick/'+current)).status).toBe(404);sql({sql:"UPDATE sites SET status='draft' WHERE id=?",params:[siteId]});
 });
 it('keeps creation/revocation scoped and CSRF-protected; a repeated owner revocation is safe',async()=>{
  expect((await request('/api/quick-links',undefined,'POST',{fields:['name'],expiresDays:1})).status).toBe(401);
  expect((await request('/api/quick-links/'+current+'/revoke','stranger','POST',{})).status).toBe(404);
  expect((await request('/api/quick-links?siteId='+siteId,'stranger','POST',{fields:['name'],expiresDays:1})).status).toBe(403);
  expect((await request('/api/quick-links/'+current+'/revoke','member','POST',{}, {'X-CSRF-Token':'wrong'})).status).toBe(403);
  for(let i=0;i<2;i++)expect((await request('/api/quick-links/'+current+'/revoke','member','POST',{})).status).toBe(200);
  const r=await request('/q/'+current);expect(r.status).toBe(404);expect(r.body).toContain('رابط التعارف غير متاح');expect(r.body).not.toContain(current);expect((await request('/api/public/quick/'+current)).status).toBe(404);
 });
 it('returns real no-store 404s for expired/unknown/malformed links and excludes both paths from indexing',async()=>{
  const expired=uid();sql({sql:'INSERT INTO quick_links(id,user_id,payload,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)',params:[expired,actors.member.id,JSON.stringify({values:{email:profile.email}}),now()-1,now()-86400]});
  for(const id of [expired,'UnknownToken____','bad%27token','x'.repeat(100)])for(const path of ['/quick/','/q/','/api/public/quick/']){const r=await request(path+id);expect(r.status,r.body).toBe(404);expect(r.response.headers.get('Cache-Control')).toContain('no-store');expect(r.response.headers.get('Referrer-Policy')).toBe('no-referrer');expect(r.body).not.toContain(profile.email);}
  const robots=await request('/robots.txt');expect(robots.body).toContain('Disallow: /q/');expect(robots.body).toContain('Disallow: /quick/');expect((await request('/sitemap-pages.xml')).body).not.toMatch(/\/q\/|\/quick\//);
 });
 it('limits token-changing guesses using one IP budget without echoing the token',async()=>{
  const key=await digest('quick-read:192.0.2.88');sql({sql:'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,?,?)',params:[key,180,now()+60]});const r=await request('/q/NeverKnownToken_',undefined,'GET',undefined,{'CF-Connecting-IP':'192.0.2.88'});expect(r.status).toBe(429);expect(r.body).not.toContain('NeverKnownToken_');expect(r.response.headers.get('Referrer-Policy')).toBe('no-referrer');
 });
});

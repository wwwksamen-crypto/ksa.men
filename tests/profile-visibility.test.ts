import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { defaultProfile } from '../server/business';
import { digest, now, uid } from '../server/core';
import { profileItemIds, draftWithIdentities } from '../shared/profile-visibility';
import { generateVCard } from '../client/src/Exports';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const database=join(mkdtempSync(join(tmpdir(),'ksa-visibility-')),'local.sqlite');
function sql(payload:any){const result=spawnSync('python3',['scripts/sqlite_bridge.py'],{input:JSON.stringify({database,...payload}),encoding:'utf8'});const value=JSON.parse(result.stdout||'{}');if(value.error)throw new Error(value.error);return value;}
class Statement {params:unknown[]=[];constructor(public sql:string){}bind(...params:unknown[]){this.params=params;return this;}async all(){return sql({sql:this.sql,params:this.params});}async first(){return(await this.all()).results[0]||null;}async run(){return this.all();}}
const objects=new Map<string,Uint8Array>([['privacy-media',new Uint8Array(16)]]);
const env:any={ROOT_DOMAIN:'ksa.men',OWNER_EMAIL:'owner@visibility.invalid',AUTH_SECRET:'local-test-auth-secret',RESEND_API_KEY:'local-test-email',DB:{prepare:(query:string)=>new Statement(query),batch:async(statements:Statement[])=>sql({batch:statements.map(s=>({sql:s.sql,params:s.params}))})},MEDIA:{head:async(key:string)=>objects.has(key)?{key}:null,get:async(key:string)=>objects.has(key)?{body:objects.get(key)}:null},ASSETS:{fetch:async()=>new Response('<!doctype html><html><head><title>KSA.MEN</title></head><body><div id="root"></div></body></html>',{headers:{'Content-Type':'text/html'}})}};
const actors:Record<string,{id:number;cookie:string;csrf:string}>={};
const siteId='dd48d67f-dc7e-4c58-89df-b4216d866881';
const approved={...defaultProfile('هوية معتمدة'),title:'مختص محلي',bio:'نبذة معتمدة',email:'visible@visibility.invalid',city:'الرياض',skills:['مهارة مرئية','مهارة مخفية'],skillRadar:{human:['تواصل'],scientific:['إحصاء'],professional:['هندسة']},skillImages:['/api/media/privacy-media'],blog:'مدونة معتمدة',notes:'PRIVATE NOTE',hidden:[],translations:{en:{...defaultProfile('Approved identity'),email:'translated@visibility.invalid',skills:['Visible skill','Hidden skill'],skillImages:['/api/media/privacy-media']}}};
const ids=profileItemIds(approved);
let policy={version:0,hidden:[] as string[],hiddenItems:[] as string[],visible:true,listed:true,indexable:true};
async function request(path:string,actor?:string,method='GET',body?:unknown,host='ksa.men',csrf=true){const headers:Record<string,string>={Origin:'https://'+host};if(actor){headers.Cookie=actors[actor].cookie;if(csrf)headers['X-CSRF-Token']=actors[actor].csrf;}if(body)headers['Content-Type']='application/json';const response=await worker.fetch(new Request('https://'+host+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,{waitUntil:()=>{}} as any);return{response,status:response.status,data:await response.clone().json().catch(()=>null)};}
async function update(patch:Partial<typeof policy>){const result=await request(`/api/sites/${siteId}/visibility`,'member','PUT',{version:policy.version,hidden:policy.hidden,hiddenItems:policy.hiddenItems,visible:policy.visible,listed:policy.listed,indexable:policy.indexable,...patch});expect(result.status,JSON.stringify(result.data)).toBe(200);policy=result.data.policy;return result;}
beforeAll(async()=>{
 sql({setup:'migrations'});sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 for(const [key,role]of[['owner','owner'],['member','user'],['stranger','user']]){sql({sql:'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)',params:[key+'@visibility.invalid',key,'0555000000',role,now(),now()+86400,now()]});const id=sql({sql:'SELECT id FROM users WHERE email=?',params:[key+'@visibility.invalid']}).results[0].id;const raw=uid()+uid(),csrf=uid();sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)',params:[await digest(raw),id,csrf,now()+86400]});actors[key]={id,cookie:'__Host-ksa_session='+raw,csrf};}
 sql({sql:"INSERT INTO sites(id,user_id,draft,published,published_version,status,created_at,updated_at) VALUES(?,?,?,?,1,'published',?,?)",params:[siteId,actors.member.id,JSON.stringify({...approved,name:'مسودة أحدث لا تنشر',skills:['مهارة مرئية','مهارة مخفية معدلة'],notes:'PRIVATE DRAFT'}),JSON.stringify(approved),now(),now()]});
 sql({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:['visibility-local',actors.member.id,siteId,now()]});
 sql({sql:'INSERT INTO media(id,owner_id,site_id,purpose,bucket_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)',params:['privacy-media',actors.member.id,siteId,'skill','privacy-media','image/webp',16,now()]});
 sql({sql:'INSERT INTO quick_links(id,user_id,payload,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)',params:['privacy-quick',actors.member.id,JSON.stringify({values:{name:approved.name,email:approved.email}}),now()+86400,now()]});
},30000);
afterAll(()=>vi.restoreAllMocks());
describe.sequential('reversible visibility applies to all public paths without publishing drafts',()=>{
 it('requires an active scoped session and CSRF, but no repeated email step-up',async()=>{
  expect((await request(`/api/sites/${siteId}/visibility`)).status).toBe(401);
  expect((await request(`/api/sites/${siteId}/visibility`,'stranger')).status).toBe(403);
  expect((await request(`/api/sites/${siteId}/visibility`,'stranger','PUT',policy)).status).toBe(403);
  expect((await request(`/api/sites/${siteId}/visibility`,'member','PUT',policy,'ksa.men',false)).status).toBe(403);
  expect((await request(`/api/sites/${siteId}/visibility`,'member')).data.policy.version).toBe(0);
  await update({hidden:['email','blog','skillRadar.scientific'],hiddenItems:[`skills:${ids.skills[1]}`,`skillImages:${ids.skillImages[0]}`]});
  const stale=await request(`/api/sites/${siteId}/visibility`,'member','PUT',{version:0,hidden:policy.hidden,hiddenItems:policy.hiddenItems,visible:policy.visible,listed:policy.listed,indexable:policy.indexable});expect(stale.status).toBe(409);
 });
 it('immediately filters fields, list items and images from Arabic and English profile/export/QR data without changing the approved snapshot',async()=>{
  for(const lang of['ar','en']){const result=await request('/api/public/profile?lang='+lang,undefined,'GET',undefined,'visibility-local.ksa.men');expect(result.status).toBe(200);const profile=result.data.profile;expect(profile).not.toHaveProperty('email');expect(profile).not.toHaveProperty('blog');expect(profile.skills).toEqual([lang==='ar'?'مهارة مرئية':'Visible skill']);expect(profile.skillImages).toEqual([]);expect(profile).not.toHaveProperty('notes');expect(profile).not.toHaveProperty('itemIds');}
  const exported=await request('/api/public/export-data/visibility-local?kind=qr');expect(exported.status).toBe(200);expect(exported.data.profile.skills).toEqual(['مهارة مرئية']);expect(generateVCard(exported.data.profile)).not.toContain('visible@visibility.invalid');
  const ownExport=await request(`/api/export-data/${siteId}?kind=qr`,'member');expect(ownExport.status).toBe(200);expect(ownExport.data.profile.name).toBe('مسودة أحدث لا تنشر');expect(ownExport.data.profile).not.toHaveProperty('email');expect(ownExport.data.profile.skills).toEqual(['مهارة مرئية']);
  expect((await request('/api/media/privacy-media')).status).toBe(403);expect((await request('/api/media/privacy-media','stranger')).status).toBe(403);expect((await request('/api/media/privacy-media','member')).status).toBe(200);
  expect((await request('/api/public/quick/privacy-quick')).data.profile).not.toHaveProperty('email');
  expect(JSON.parse(sql({sql:'SELECT published FROM sites WHERE id=?',params:[siteId]}).results[0].published)).toEqual(approved);
 });
 it('separates the platform directory from search-engine indexing and strips hidden content from public HTML/SEO',async()=>{
  expect((await request('/api/search?q=visibility-local')).data.items).toHaveLength(1);
  await update({listed:false,indexable:true});expect((await request('/api/search?q=visibility-local')).data.items).toHaveLength(0);
  const direct=await request('/',undefined,'GET',undefined,'visibility-local.ksa.men');expect(direct.status).toBe(200);expect(direct.response.headers.get('X-Robots-Tag')).toBeNull();
  await update({listed:true,indexable:false});expect((await request('/api/search?q=visibility-local')).data.items).toHaveLength(1);
  const html=await request('/',undefined,'GET',undefined,'visibility-local.ksa.men');expect(html.response.headers.get('X-Robots-Tag')).toContain('noindex');const body=await html.response.text();expect(body).toContain('name="robots"');expect(body).not.toContain('PRIVATE');expect(body).not.toContain('visible@visibility.invalid');
  const robots=await request('/robots.txt',undefined,'GET',undefined,'visibility-local.ksa.men');expect(await robots.response.text()).toContain('Disallow: /');
 });
 it('restricts ambiguous old rows when both content and length changed before stable IDs existed, and reverses the choice cleanly',async()=>{
  const draft={...approved,name:'مسودة أحدث لا تنشر',skills:['مهارة جديدة منفردة'],notes:'PRIVATE DRAFT'};
  sql({sql:'UPDATE sites SET draft=? WHERE id=?',params:[JSON.stringify(draft),siteId]});
  const current=draftWithIdentities(draft,approved), key=`skills:${profileItemIds(current).skills[0]}`;
  await update({hiddenItems:[key]});
  expect((await request('/api/public/profile',undefined,'GET',undefined,'visibility-local.ksa.men')).data.profile.skills).toEqual([]);
  expect((await request(`/api/export-data/${siteId}?kind=qr`,'member')).data.profile.skills).toEqual([]);
  expect((await request('/api/search?q=visibility-local')).data.items[0].profile.skills ?? []).toEqual([]);
  sql({sql:'UPDATE sites SET draft=? WHERE id=?',params:[JSON.stringify({...draft,skills:[]}),siteId]});
  await update({listed:true});
  expect((await request('/api/public/profile',undefined,'GET',undefined,'visibility-local.ksa.men')).data.profile.skills).toEqual([]);
  await update({hiddenItems:[]});
  expect((await request('/api/public/profile',undefined,'GET',undefined,'visibility-local.ksa.men')).data.profile.skills).toEqual(approved.skills);
 });
 it('hides the whole site immediately across profile, HTML, exports, media, quick links and OG, while retaining authorized editing',async()=>{
  await update({visible:false});
  for(const path of['/api/public/profile','/'])expect((await request(path,undefined,'GET',undefined,'visibility-local.ksa.men')).status,path).toBe(404);
  for(const path of['/api/public/export-data/visibility-local?kind=qr','/api/public/og/visibility-local','/api/public/quick/privacy-quick'])expect((await request(path)).status,path).toBe(404);
  expect((await request('/api/media/privacy-media')).status).toBe(403);expect((await request('/api/search?q=visibility-local')).data.items).toHaveLength(0);
  const own=await request(`/api/sites/${siteId}`,'member');expect(own.status).toBe(200);expect(own.data.site.draft.notes).toBe('PRIVATE DRAFT');expect(own.data.site.visibility.visible).toBe(false);
 });
 it('immediately hides individual download types on root and same-origin identity export APIs',async()=>{
  await update({visible:true,hidden:['exportProfile','exportAts','exportBadge','exportVcard'],hiddenItems:[]});
  const profile=await request('/api/public/profile',undefined,'GET',undefined,'visibility-local.ksa.men');
  expect(profile.data.downloads).toEqual({profile:false,ats:false,badge:false,vcard:false});
  for(const kind of ['profile','ats','badge','card','vcard'])for(const host of ['ksa.men','visibility-local.ksa.men'])expect((await request('/api/public/export-data/visibility-local?kind='+kind,undefined,'GET',undefined,host)).status).toBe(404);
  expect((await request('/api/public/export-data/other-name?kind=qr',undefined,'GET',undefined,'visibility-local.ksa.men')).status).toBe(404);
  expect((await request('/api/public/export-data/visibility-local?kind=qr',undefined,'GET',undefined,'visibility-local.ksa.men')).status).toBe(200);
  await update({hidden:[]});
  const exported=await request('/api/public/export-data/visibility-local?kind=profile',undefined,'GET',undefined,'visibility-local.ksa.men');
  expect(exported.status).toBe(200);expect(exported.data.source).toBe('published');expect(exported.data.profile.name).toBe(approved.name);
 });
 it('restores only approved content, never the latest draft, and records each reversible choice',async()=>{
  await update({visible:true,hidden:[],hiddenItems:[],indexable:true});
  const profile=await request('/api/public/profile',undefined,'GET',undefined,'visibility-local.ksa.men');expect(profile.data.profile.name).toBe('هوية معتمدة');expect(profile.data.profile.skills).toHaveLength(2);
  expect((await request('/api/media/privacy-media')).status).toBe(200);
  expect(sql({sql:"SELECT COUNT(*) n FROM audit WHERE action='site.visibility' AND target=?",params:[siteId]}).results[0].n).toBe(policy.version);
  expect(sql({sql:'SELECT COUNT(*) n FROM reviews WHERE site_id=?',params:[siteId]}).results[0].n).toBe(0);
 });
});

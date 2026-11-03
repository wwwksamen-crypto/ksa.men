import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { defaultProfile } from '../server/business';
import { now,uid,digest } from '../server/core';
import { withVisibility,profileItemIds } from '../shared/profile-visibility';
import { profileBody,metadata,jsonScript } from '../shared/seo';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const database=join(mkdtempSync(join(tmpdir(),'ksa-seo-')),'local.sqlite');
function sql(payload:any){const result=spawnSync('python3',['scripts/sqlite_bridge.py'],{input:JSON.stringify({database,...payload}),encoding:'utf8'});const value=JSON.parse(result.stdout||'{}');if(value.error)throw new Error(value.error);return value;}
let queries:string[]=[];
class Statement{params:unknown[]=[];constructor(public query:string){}bind(...params:unknown[]){this.params=params;return this;}async all(){queries.push(this.query);return sql({sql:this.query,params:this.params});}async first(){return(await this.all()).results[0]||null;}async run(){return this.all();}}
const shell='<!doctype html><html lang="ar" dir="rtl"><head><title>KSA.MEN</title><meta name="description" content="generic"></head><body><div id="root"></div><script type="module" src="/assets/entry-12345678.js"></script></body></html>';
const env:any={ROOT_DOMAIN:'ksa.men',AUTH_SECRET:'local-seo-test-secret',DB:{prepare:(q:string)=>new Statement(q),batch:async(statements:Statement[])=>sql({batch:statements.map(s=>({sql:s.query,params:s.params}))})},ASSETS:{fetch:async(req:Request)=>new Response(new URL(req.url).pathname.startsWith('/assets/')?'asset':shell,{headers:{'Content-Type':new URL(req.url).pathname.endsWith('.js')?'application/javascript':'text/html'}})}};
let cookie='',memberId=0;
const profile={...defaultProfile('معتمد سعودي'),title:'خبرة منشورة',bio:'سيرة معتمدة',skills:['مرئي','HIDDEN ROW'],socials:[{url:'https://x.com/public-profile'}],youtube:'https://youtu.be/dQw4w9WgXcQ',email:'HIDDEN EMAIL',notes:'PRIVATE NOTE',hidden:['email'],translations:{en:{name:'Approved Saudi',bio:'Approved biography',skills:['Visible','HIDDEN ROW']}}};
const id='2fe13132-636f-4eb8-9447-03f2f8b798a4';
async function request(path:string,host='ksa.men',auth=false,ua='Mozilla/5.0'){const headers:any={'User-Agent':ua};if(auth)headers.Cookie=cookie;const started=performance.now();const response=await worker.fetch(new Request('https://'+host+path,{headers}),env,{waitUntil:()=>{}} as any);const body=await response.text();return{response,body,ms:performance.now()-started};}
beforeAll(async()=>{
 sql({setup:'migrations'});sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 sql({sql:'INSERT INTO users(email,name,whatsapp,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?)',params:['seo@tests.invalid','SEO member','0555000000',now(),now()+86400,now()]});memberId=sql({sql:'SELECT id FROM users WHERE email=?',params:['seo@tests.invalid']}).results[0].id;
 const raw=uid()+uid();cookie='__Host-ksa_session='+raw;sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)',params:[await digest(raw),memberId,uid(),now()+86400]});
 for(const [suffix,status,lock]of[['public','published',null],['draft','draft',null],['private','published','opaque-lock'],['hidden','published',null],['noindex','published',null]]){
  let owner=memberId;if(suffix!=='public'){sql({sql:'INSERT INTO users(email,name,whatsapp,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?)',params:[suffix+'@seo.invalid',suffix,'0555000000',now(),now()+86400,now()]});owner=sql({sql:'SELECT id FROM users WHERE email=?',params:[suffix+'@seo.invalid']}).results[0].id;}
  const siteId=suffix==='public'?id:uid();sql({sql:'INSERT INTO sites(id,user_id,manager_id,draft,published,published_version,status,lock_hash,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?)',params:[siteId,owner,memberId,JSON.stringify({...profile,name:'DRAFT ONLY'}),status==='published'?JSON.stringify(profile):null,status,lock,now(),now()]});
  sql({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:['seo-'+suffix,owner,siteId,now()]});
  if(['public','hidden','noindex'].includes(suffix))sql({sql:'INSERT INTO site_visibility(site_id,hidden_fields,hidden_items,visible,listed,indexable,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)',params:[siteId,'["email"]',JSON.stringify(suffix==='public'?[`skills:${profileItemIds(profile).skills[1]}`]:[]),suffix!=='hidden'?1:0,suffix==='public'?0:1,suffix!=='noindex'?1:0,now(),memberId]});
 }
 sql({sql:"INSERT INTO content(slug,title_ar,title_en,body_ar,body_en,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title_ar=excluded.title_ar,title_en=excluded.title_en,body_ar=excluded.body_ar,body_en=excluded.body_en,status='published'",params:['home','عنوان سعودي منشور','Published home title','نص منشور يحترم المستخدم','Published text for the user',now(),now()]});
},30000);
describe.sequential('Performance and crawler-visible public HTML — local requests only',()=>{
 it('renders the public homepage and managed pages with one canonical, language tags and escaped content without JS',async()=>{
  for(const path of['/','/features','/about','/privacy','/terms','/qr']){const result=await request(path);expect(result.response.status,path).toBe(200);expect(result.body,path).toContain('id="initial-content"');expect(result.body.match(/rel="canonical"/g)).toHaveLength(1);expect(result.body).toContain('application/ld+json');expect(result.response.headers.get('Cache-Control')).toBe('private, no-store');}
  const legacy=await request('/index.html?lang=en');expect(legacy.response.status).toBe(308);expect(legacy.response.headers.get('Location')).toBe('https://ksa.men/?lang=en');
  const en=await request('/?lang=en');expect(en.body).toContain('Published home title');expect(en.body).toContain('Published text for the user');expect(en.body).toContain('https://ksa.men/?lang=en');expect(en.body).toContain('lang="en" dir="ltr"');
 });
 it('serves identical approved initial content for visitor, Googlebot and social crawlers, never draft or hidden values',async()=>{
  const bodies=[];for(const ua of['Mozilla/5.0','Googlebot','Twitterbot']){const result=await request('/','seo-public.ksa.men',false,ua);expect(result.response.status).toBe(200);expect(result.body).toContain('<h1>معتمد سعودي</h1>');expect(result.body).toContain('خبرة منشورة');expect(result.body).toContain('https://x.com/public-profile');expect(result.body).not.toMatch(/DRAFT ONLY|HIDDEN EMAIL|HIDDEN ROW|PRIVATE NOTE/);bodies.push(result.body);}expect(new Set(bodies).size).toBe(1);
  const en=await request('/?lang=en','seo-public.ksa.men');expect(en.body).toContain('Approved Saudi');expect(en.body).not.toContain('HIDDEN ROW');
 });
 it('uses real 404s for unknown pages and missing/hidden/draft sites; locked identities never embed a personal payload',async()=>{
  for(const [path,host]of[['/nothing-here','ksa.men'],['/unknown.html','ksa.men'],['/unknown.xml','seo-public.ksa.men'],['/nothing-here','seo-public.ksa.men'],['/','seo-draft.ksa.men'],['/','seo-hidden.ksa.men'],['/','seo-missing.ksa.men']]){const r=await request(path,host);expect(r.response.status).toBe(404);expect(r.body).not.toContain('DRAFT ONLY');}
  const privateSite=await request('/','seo-private.ksa.men');expect(privateSite.response.status).toBe(200);expect(privateSite.body).toContain('noindex');expect(privateSite.body).not.toMatch(/معتمد سعودي|application\/ld\+json|id="initial-content"/);
  for(const path of['/dashboard','/admin','/auth','/export/ats','/quick/test','/search']){const r=await request(path);expect(r.body).toContain('noindex');expect(r.body).not.toContain('application/ld+json');}
 });
 it('publishes same-origin and paged sitemaps from live eligibility, independent of directory listing, without private URLs',async()=>{
  const index=await request('/sitemap.xml');expect(index.body).toContain('sitemap-profiles/1.xml');expect(index.body).toContain('sitemap-pages.xml');
  const profiles=await request('/sitemap-profiles/1.xml');expect(profiles.response.headers.get('Content-Type')).toContain('application/xml');expect(profiles.body).toContain('https://seo-public.ksa.men/');for(const name of['draft','private','hidden','noindex'])expect(profiles.body).not.toContain('seo-'+name);
  const own=await request('/sitemap.xml','seo-public.ksa.men');expect(own.body).toContain('https://seo-public.ksa.men/');expect(own.body).not.toContain('https://ksa.men/');
  for(const name of['private','hidden','noindex']){const map=await request('/sitemap.xml','seo-'+name+'.ksa.men');expect(map.body).not.toContain('<url>');const robots=await request('/robots.txt','seo-'+name+'.ksa.men');expect(robots.body).toContain('Disallow: /');}
  expect((await request('/robots.txt')).body).toContain('Sitemap: https://ksa.men/sitemap.xml');expect((await request('/sitemap-pages.xml')).body).not.toMatch(/\/auth|\/dashboard|\/admin/);
 });
 it('omits all indexing and structured data while the platform is closed, including privileged views, without changing its lock',async()=>{
  sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"private"}','lock']});
  const root=await request('/');expect(root.body).not.toContain('application/ld+json');expect(root.body).not.toContain('id="initial-content"');expect(root.response.headers.get('X-Robots-Tag')).toContain('noindex');
  expect((await request('/robots.txt')).body).toContain('Disallow: /');expect((await request('/sitemap.xml')).body).not.toContain('<url>');expect((await request('/sitemap-profiles/1.xml')).body).not.toContain('seo-public');
  sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 });
 it('scopes editor data to three business reads, retains authenticated ownership and obtains other services only in their tab',async()=>{
  queries=[];const full=await request('/api/dashboard','ksa.men',true);const fullQueries=queries.length;expect(full.response.status).toBe(200);
  queries=[];const editor=await request('/api/dashboard?view=editor','ksa.men',true);const editorQueries=queries.length;expect(editor.response.status,editor.body).toBe(200);
  const data=JSON.parse(editor.body);expect(data.sites).toHaveLength(5);expect(data.sites[0]).not.toHaveProperty('draft');expect(data.sites[0]).not.toHaveProperty('published');expect(data.services).toEqual([]);expect(data.notifications).toEqual([]);expect(data.ledger).toEqual([]);
  expect(queries.some(q=>/FROM analytics|FROM services|FROM ledger|FROM quick_links|FROM member_preferences/.test(q))).toBe(false);expect(editorQueries).toBeLessThan(fullQueries);expect(editor.body.length).toBeLessThan(full.body.length);
  queries=[];const services=await request('/api/dashboard?view=services','ksa.men',true);expect(services.response.status).toBe(200);expect(queries.some(q=>q.includes('FROM services'))).toBe(true);
  expect((await request('/api/dashboard?view=editor')).response.status).toBe(401);
  writeFileSync('/home/ubuntu/ksa-men-checkpoints/repair5-20261103/local-request-metrics.json',JSON.stringify({full:{queries:fullQueries,bytes:full.body.length,ms:full.ms},editor:{queries:editorQueries,bytes:editor.body.length,ms:editor.ms},note:'Local SQLite bridge; timings are not production latency. Queries include session and platform lock.'},null,2));
 });
 it('escapes script/attribute delimiters and filters item-level privacy before body and JSON-LD serialization',()=>{
  const raw={...profile,name:'</script><script>alert(1)</script>',bio:'" onload="bad',skills:['visible','secret']};const clean=withVisibility(raw,{hidden:['email'],hiddenItems:[`skills:${profileItemIds(raw).skills[1]}`],visible:true,listed:true,indexable:true});
  const body=profileBody(clean,'seo-public','ar');expect(body).not.toContain('<script>');expect(body).not.toContain('secret');expect(body).toContain('&lt;/script&gt;');
  const head=metadata({title:raw.name,description:raw.bio,lang:'ar',indexable:true,url:'https://ksa.men/',schema:{name:raw.name}});expect(head).not.toContain('</script><script>');expect(jsonScript({name:raw.name})).toContain('\\u003c');
 });
});

import{beforeAll,describe,it,expect,vi}from'vitest';
import{spawnSync}from'node:child_process';import{mkdtempSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{webcrypto}from'node:crypto';import worker from'../server/index';import{digest,uid,now}from'../server/core';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});const database=join(mkdtempSync(join(tmpdir(),'ksa-request-removal-')),'local.sqlite');
function sql(payload:any){const p=spawnSync('python3',['scripts/sqlite_bridge.py'],{input:JSON.stringify({database,...payload}),encoding:'utf8'});const data=JSON.parse(p.stdout||'{}');if(data.error)throw new Error(data.error);return data;}
class Statement{params:unknown[]=[];constructor(public sql:string){}bind(...p:unknown[]){this.params=p;return this;}async all(){return sql({sql:this.sql,params:this.params});}async first(){return(await this.all()).results[0]||null;}async run(){return this.all();}}
let beforeEraseBatch:(()=>void)|undefined;
const env:any={ROOT_DOMAIN:'ksa.men',OWNER_EMAIL:'owner@unit.invalid',AUTH_SECRET:'LOCAL-ERASURE-SECRET',DB:{prepare:(q:string)=>new Statement(q),batch:async(s:Statement[])=>{if(s[0]?.sql.includes('INSERT INTO owner_request_removals')&&beforeEraseBatch){const hook=beforeEraseBatch;beforeEraseBatch=undefined;hook();}return sql({batch:s.map(x=>({sql:x.sql,params:x.params}))});}},ASSETS:{fetch:async()=>new Response('app')},MEDIA:{get:vi.fn(),delete:vi.fn()}};const actors:Record<string,any>={};let user:number,site:string;
async function request(path:string,actor='owner',body?:any,method=body?'POST':'GET',csrf=true){const h:any={Origin:'https://ksa.men',Cookie:actors[actor]?.cookie};if(csrf)h['X-CSRF-Token']=actors[actor]?.csrf;if(body)h['Content-Type']='application/json';const r=await worker.fetch(new Request('https://ksa.men'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,{waitUntil:()=>{}}as any);return{status:r.status,data:await r.json()as any};}
function makeMember(name:string){sql({sql:'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)',params:[name+'@unit.invalid',name,'0500000000','user',now(),now()+86400,now()]});const id=sql({sql:'SELECT id FROM users WHERE email=?',params:[name+'@unit.invalid']}).results[0].id;const s=uid();sql({sql:"INSERT INTO sites(id,user_id,draft,draft_version,published,published_version,status,created_at,updated_at) VALUES(?,?,?,2,?,1,'published',?,?)",params:[s,id,'{"name":"PRIVATE-DRAFT"}','{"name":"PRIVATE-PUBLIC"}',now(),now()]});sql({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:[name,id,s,now()]});return{id,site:s};}
beforeAll(async()=>{sql({setup:'migrations'});sql({sql:"UPDATE settings SET value=? WHERE key='lock'",params:['{"mode":"open"}']});for(const key of['owner','manager','member','stale']){sql({sql:'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)',params:[key+'@unit.invalid',key,'',key==='owner'||key==='stale'?'owner':key==='member'?'user':'manager',now(),now()+86400,now()]});const id=sql({sql:'SELECT id FROM users WHERE email=?',params:[key+'@unit.invalid']}).results[0].id;const raw=uid()+uid(),csrf=uid();sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,?)',params:[await digest(raw),id,csrf,now()+3600,key==='stale'?0:now()]});actors[key]={id,cookie:'__Host-ksa_session='+raw,csrf};}const m=makeMember('eraselocal');user=m.id;site=m.site;},30000);

function fixture(kind:'review'|'membership',name:string){
 const m=makeMember(name),id=uid();
 if(kind==='review')sql({sql:"INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,created_at) SELECT ?,id,user_id,draft,draft_version,published_version,'pending',? FROM sites WHERE id=?",params:[id,now(),m.site]});
 else sql({sql:"INSERT INTO subscription_requests(id,user_id,kind,status,created_at) VALUES(?,?,'annual_contact','pending',?)",params:[id,m.id,now()]});
 return {...m,request:id};
}
const remove=(kind:string,id:string,actor='owner',extra:any={})=>request(`/api/admin/request-removals/${kind}/${id}`,actor,{reason:'طلب حذف محلي موثق',expectedStatus:'pending',...extra});
describe.sequential('owner request removal — local D1 only',()=>{
 it('requires owner, CSRF and a reason; normal owner session works without additional verification',async()=>{
  const m=fixture('membership','requestpermissions');
  for(const actor of ['member','manager'])expect((await remove('membership',m.request,actor)).status).toBe(403);
  expect((await request('/api/admin/request-removals/membership/'+m.request,'owner',{reason:'سبب',expectedStatus:'pending'},'POST',false)).status).toBe(403);
  expect((await remove('membership',m.request,'owner',{reason:''})).status).toBe(400);
  expect((await remove('membership',m.request,'stale')).status).toBe(200);
 });
 it('removes a pending publication request, keeps the published profile and user, and records one proof under repetition',async()=>{
  const m=fixture('review','requestpublication'),before=sql({sql:'SELECT published,published_version FROM sites WHERE id=?',params:[m.site]}).results[0];
  const r=await remove('review',m.request);expect(r.status,JSON.stringify(r.data)).toBe(200);expect(r.data.removed).toBe(true);
  expect(sql({sql:'SELECT published,published_version FROM sites WHERE id=?',params:[m.site]}).results[0]).toEqual(before);
  expect(sql({sql:'SELECT status FROM review_decisions WHERE review_id=?',params:[m.request]}).results[0].status).toBe('rejected');
  expect((await request('/api/admin/reviews?status=rejected')).data.reviews.some((v:any)=>v.id===m.request)).toBe(false);
  expect((await remove('review',m.request)).data.idempotent).toBe(true);
  expect(sql({sql:"SELECT * FROM owner_request_removals WHERE kind='review' AND request_id=?",params:[m.request]}).results).toHaveLength(1);
  expect((await request('/api/admin/reviews/'+m.request+'/decision','owner',{decision:'approved'})).status).toBe(409);
  const next=await request('/api/admin/sites/'+m.site+'/publish','owner',{});expect(next.status,JSON.stringify(next.data)).toBe(200);
 });
 it('hides an already approved publication request without unpublishing or changing its original decision',async()=>{
  const m=fixture('review','requestapproved');expect((await request('/api/admin/reviews/'+m.request+'/decision','owner',{decision:'approved'})).status).toBe(200);
  const before=sql({sql:'SELECT * FROM sites WHERE id=?',params:[m.site]}).results[0],decision=sql({sql:'SELECT * FROM review_decisions WHERE review_id=?',params:[m.request]}).results[0];
  expect((await remove('review',m.request,'owner',{expectedStatus:'approved'})).status).toBe(200);
  expect(sql({sql:'SELECT * FROM sites WHERE id=?',params:[m.site]}).results[0]).toEqual(before);
  expect(sql({sql:'SELECT * FROM review_decisions WHERE review_id=?',params:[m.request]}).results[0]).toEqual(decision);
 });
 it('removes pending membership without changing ledger or entitlement and allows a new membership request',async()=>{
  const m=fixture('membership','requestmembership');const ledger=sql({sql:'SELECT * FROM ledger'}).results,userBefore=sql({sql:'SELECT * FROM users WHERE id=?',params:[m.id]}).results[0];
  expect((await remove('membership',m.request)).status).toBe(200);
  expect(sql({sql:'SELECT * FROM users WHERE id=?',params:[m.id]}).results[0]).toEqual(userBefore);expect(sql({sql:'SELECT * FROM ledger'}).results).toEqual(ledger);
  expect((await request('/api/admin/subscription-requests')).data.requests.some((v:any)=>v.id===m.request)).toBe(false);
  sql({sql:"INSERT INTO subscription_requests(id,user_id,kind,status,created_at) VALUES(?,?,'annual_contact','pending',?)",params:[uid(),m.id,now()]});
  expect((await request('/api/admin/subscription-requests/'+m.request+'/decision','owner',{decision:'approved'})).status).toBe(409);
 });
 it('keeps approved membership and past entitlement/financial records exactly intact',async()=>{
  const m=fixture('membership','requestmembershipapproved');sql({sql:"UPDATE subscription_requests SET status='approved',decided_by=?,decided_at=? WHERE id=?",params:[actors.owner.id,now(),m.request]});
  const before=sql({sql:'SELECT * FROM subscription_requests WHERE id=?',params:[m.request]}).results[0],userBefore=sql({sql:'SELECT * FROM users WHERE id=?',params:[m.id]}).results[0];
  expect((await remove('membership',m.request,'owner',{expectedStatus:'approved'})).status).toBe(200);
  expect(sql({sql:'SELECT * FROM subscription_requests WHERE id=?',params:[m.request]}).results[0]).toEqual(before);expect(sql({sql:'SELECT * FROM users WHERE id=?',params:[m.id]}).results[0]).toEqual(userBefore);
 });
 it('blocks stale state and a hold appearing immediately before the transaction, without partial cancellation',async()=>{
  const m=fixture('membership','requestheld');expect((await remove('membership',m.request,'owner',{expectedStatus:'approved'})).status).toBe(409);
  beforeEraseBatch=()=>sql({sql:"INSERT INTO retention_holds(id,user_id,resource_type,resource_id,legal_basis,status,created_at) VALUES(?,?,'account',?,'local hold','active',?)",params:[uid(),m.id,String(m.id),now()]});
  expect((await remove('membership',m.request)).status).toBe(409);
  expect(sql({sql:'SELECT status FROM subscription_requests WHERE id=?',params:[m.request]}).results[0].status).toBe('pending');expect(sql({sql:'SELECT * FROM owner_request_removals WHERE request_id=?',params:[m.request]}).results).toHaveLength(0);
 });
 it('exposes reason and actor only to the owner and preserves the audit chain',async()=>{
  expect((await request('/api/admin/request-removals','member')).status).toBe(403);const records=(await request('/api/admin/request-removals')).data.records;
  expect(records.some((v:any)=>v.actor_id===actors.owner.id&&v.reason==='طلب حذف محلي موثق'&&v.before_hash.length===64)).toBe(true);
  expect((await request('/api/admin/audit/verify')).data.intact).toBe(true);
 });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { digest, hashSecret, now, uid, verifySecret } from '../server/core';
import { makeBackup } from '../server/backup';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-managed-')), 'snapshot.sqlite');
function sql(payload:any) { const p = spawnSync('python3', ['scripts/sqlite_bridge.py'], { input: JSON.stringify({ database, ...payload }), encoding: 'utf8' }); const data = JSON.parse(p.stdout || '{}'); if (data.error) throw new Error(data.error); return data; }
class Statement {
 params:unknown[]=[]; constructor(public sql:string){}
 bind(...params:unknown[]){this.params=params;return this;}
 async all(){return sql({sql:this.sql,params:this.params});}
 async first(){return (await this.all()).results[0]||null;}
 async run(){return this.all();}
}
const objects = new Map<string,any>();
const env:any = { ROOT_DOMAIN:'ksa.men', OWNER_EMAIL:'managed-owner@unit.invalid', AUTH_SECRET:'managed-unit-secret', RESEND_API_KEY:'unit', BACKUP_ENCRYPTION_KEY:'unit-independent-key', DB:{ prepare:(query:string)=>new Statement(query),batch:async(statements:Statement[])=>sql({batch:statements.map(s=>({sql:s.sql,params:s.params}))}) }, MEDIA:{put:async(key:string,bytes:any,metadata:any)=>objects.set(key,{bytes,metadata}),get:async(key:string)=>objects.has(key)?{body:objects.get(key).bytes}:null}, ASSETS:{fetch:async()=>new Response('<!doctype html>Application fixture',{headers:{'Content-Type':'text/html'}})} };
const actors:Record<string,{id:number;cookie:string;csrf:string}>={};
let managedId=0,siteId='',ownerPin='';
let capturedEmails:any[]=[];
async function request(path:string,actor?:string,method='GET',body?:unknown,extra:Record<string,string>={}) {
 const headers:Record<string,string>={Origin:'https://ksa.men',...extra};if(actor){headers.Cookie=actors[actor].cookie;headers['X-CSRF-Token']=actors[actor].csrf;}if(body)headers['Content-Type']='application/json';
 const background:Promise<unknown>[]=[];
 const response=await worker.fetch(new Request('https://ksa.men'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,{waitUntil:(p:Promise<unknown>)=>{background.push(p);}} as any);
 await Promise.all(background);
 return {response,status:response.status,data:await response.clone().json().catch(()=>null)};
}
beforeAll(async()=>{
 sql({setup:'migrations'});sql({sql:"INSERT OR IGNORE INTO reserved_names(name,active) VALUES('test',1)"});sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 ownerPin=await hashSecret('672105');
 for(const [key,role] of [['owner','owner'],['manager','manager'],['moderator','moderator'],['member','user']]){
  sql({sql:'INSERT INTO users(email,name,whatsapp,role,pin_hash,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?,?)',params:[key==='owner'?env.OWNER_EMAIL:key+'@unit.invalid',key,'0555000000',role,key==='owner'?ownerPin:null,now(),now()+86400,now()]});
  const row=sql({sql:'SELECT id FROM users WHERE name=?',params:[key]}).results[0];const raw=uid()+uid(),csrf=uid();sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)',params:[await digest(raw),row.id,csrf,now()+86400]});actors[key]={id:row.id,cookie:'__Host-ksa_session='+raw,csrf};
 }
 vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,options)=>{capturedEmails.push(JSON.parse(String(options?.body)));return new Response(JSON.stringify({id:uid()}),{status:200});});
},30000);
const body={name:'عضو اختبار الحساب المدار',email:'managed-owner@unit.invalid',whatsapp:'0555000000',subdomain:'test',pin:'215839',title:'هوية اختبار',authorized:true};
describe.sequential('Managed identity and one-click administrative publication',()=>{
 it('only owner creates a separate managed member even when contact email equals administration',async()=>{
  expect((await request('/api/admin/managed-accounts','member','POST',body)).status).toBe(403);
  expect((await request('/api/admin/managed-accounts','manager','POST',body)).status).toBe(403);
  expect((await request('/api/names/reserve','member','POST',{name:'test'})).status).toBe(409);
  expect((await request('/api/admin/managed-accounts','owner','POST',{...body,subdomain:'admin'})).status).toBe(409);
  const x=await request('/api/admin/managed-accounts','owner','POST',body);expect(x.status).toBe(201);managedId=x.data.userId;siteId=x.data.siteId;expect(managedId).not.toBe(actors.owner.id);
  expect(sql({sql:'SELECT role,pin_hash FROM users WHERE id=?',params:[actors.owner.id]}).results[0]).toEqual({role:'owner',pin_hash:ownerPin});
  const managed=sql({sql:'SELECT role,pin_hash,email,consent_at FROM users WHERE id=?',params:[managedId]}).results[0];expect(managed.role).toBe('user');expect(managed.consent_at).toBe(0);expect(await verifySecret(body.pin,managed.pin_hash)).toBe(true);expect(managed.email).toContain('@managed.ksa.men');
  expect((await request('/api/admin/managed-accounts','owner','POST',body)).status).toBe(409);
  expect(sql({sql:"SELECT active FROM reserved_names WHERE name='test'"}).results[0].active).toBe(1);
  const upload=new FormData();upload.set('file',new File([new Uint8Array(readFileSync('public/assets/logo-emblem.webp'))],'owner-photo.webp',{type:'image/webp'}));upload.set('purpose','photo');upload.set('siteId',siteId);
  const uploaded=await worker.fetch(new Request('https://ksa.men/api/upload',{method:'POST',headers:{Origin:'https://ksa.men',Cookie:actors.owner.cookie,'X-CSRF-Token':actors.owner.csrf},body:upload}),env,{} as any);expect(uploaded.status).toBe(200);const media=(await uploaded.json()) as {id:string};
  expect((await request('/api/media/'+media.id,'moderator')).status).toBe(403);
  expect((await request('/api/admin/managed-accounts/'+managedId+'/assign','owner','POST',{managerId:actors.moderator.id})).status).toBe(200);
  expect((await request('/api/media/'+media.id,'moderator')).status).toBe(200);
  expect((await request('/api/media/'+media.id,'member')).status).toBe(403);
  expect((await request('/api/admin/managed-accounts/'+managedId+'/assign','owner','POST',{managerId:actors.owner.id})).status).toBe(200);
  expect((await request('/api/media/'+media.id,'moderator')).status).toBe(403);

 });
 it('publishes immediately in a PIN session without fresh email and remains idempotent and logged',async()=>{
  const x=await request('/api/admin/sites/'+siteId+'/publish','owner','POST');expect(x.status).toBe(200);expect(x.data.published).toBe(true);expect(x.data.url).toBe('https://test.ksa.men');
  expect((await request('/api/admin/sites/'+siteId+'/publish','owner','POST')).data.idempotent).toBe(true);
  expect(sql({sql:'SELECT status FROM sites WHERE id=?',params:[siteId]}).results[0].status).toBe('published');
  expect(sql({sql:"SELECT COUNT(*) AS n FROM audit WHERE action='site.published' AND target=?",params:[siteId]}).results[0].n).toBe(1);
  const response=await worker.fetch(new Request('https://test.ksa.men/api/public/profile'),env,{} as any);expect(response.status).toBe(200);
  expect(capturedEmails[0].to).toEqual([body.email]);
 });
 it('keeps user, CSRF, scope, and financial protections while allowing the assigned moderator to edit and publish',async()=>{
  expect((await request('/api/admin/sites/'+siteId+'/publish','member','POST')).status).toBe(403);
  expect((await request('/api/admin/sites/'+siteId+'/publish','manager','POST')).status).toBe(403);
  const noCSRF=await worker.fetch(new Request('https://ksa.men/api/admin/sites/'+siteId+'/publish',{method:'POST',headers:{Origin:'https://ksa.men',Cookie:actors.owner.cookie}}),env,{} as any);expect(noCSRF.status).toBe(403);
  expect((await request('/api/admin/backups','owner')).status).toBe(403);
  expect((await request('/api/admin/managed-accounts/'+managedId+'/assign','owner','POST',{managerId:actors.moderator.id})).status).toBe(200);
  const editor=await request('/api/sites/'+siteId,'moderator');expect(editor.status).toBe(200);
  const draft=editor.data.site.draft;draft.bio='تعديل المشرف المسؤول';
  expect((await request('/api/sites/'+siteId+'/draft','moderator','PUT',{draft,version:1})).status).toBe(200);
  expect((await request('/api/admin/sites/'+siteId+'/publish','moderator','POST')).status).toBe(200);
 });
 it('emails a secret invitation without revealing it in API and consumes acceptance only once without changing admin credentials',async()=>{
  const result=await request('/api/admin/managed-accounts/'+managedId+'/deliver','owner','POST',{email:body.email});expect(result.status).toBe(200);expect(result.data).toEqual({sent:true});
  const letter=capturedEmails.findLast(e=>String(e.subject).includes('استلم حسابك'));const token=/claim=([a-f0-9-]+)/.exec(letter.html)![1];
  expect((await request('/api/auth/managed-claim?token='+token)).status).toBe(200);
  const acceptance=await request('/api/auth/managed-claim',undefined,'POST',{token,pin:'359142',agree:true});expect(acceptance.status).toBe(200);
  expect((await request('/api/auth/managed-claim',undefined,'POST',{token,pin:'359142',agree:true})).status).toBe(410);
  expect((await request('/api/admin/managed-accounts/'+managedId+'/deliver','owner','POST',{email:body.email})).status).toBe(409);
  expect(sql({sql:'SELECT pin_hash,role FROM users WHERE id=?',params:[actors.owner.id]}).results[0]).toEqual({pin_hash:ownerPin,role:'owner'});
  expect(sql({sql:'SELECT manager_id FROM sites WHERE id=?',params:[siteId]}).results[0].manager_id).toBeNull();
  expect((await request('/api/sites/'+siteId,'moderator')).status).toBe(403);
  const cookies=acceptance.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const quick=await request('/api/auth/quick',undefined,'POST',{email:body.email,pin:'359142'},{Cookie:cookies,'X-CSRF-Token':acceptance.data.csrf});expect(quick.status).toBe(200);expect(quick.data.user.role).toBe('user');
  expect((await request('/api/auth/managed-claim?token='+token)).status).toBe(410);
 });
 it('excludes invitation capabilities from encrypted backups',async()=>{
  const result=await makeBackup(env,'unit-managed-test');
  expect(result).toBeTruthy();
  const record=[...objects.values()].at(-1)!;const raw=new Uint8Array(record.bytes);
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.BACKUP_ENCRYPTION_KEY)),{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(4,16)},key,raw.slice(16));
  const data=JSON.parse(new TextDecoder().decode(plain));expect(data.tables.managed_claim_tokens).toBeUndefined();expect(data.tables.managed_accounts.length).toBe(1);
 });
});

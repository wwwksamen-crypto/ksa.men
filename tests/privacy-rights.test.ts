import { describe, it, expect, vi } from 'vitest';
import { fixture } from './repair-fixture';
import { digest, now, uid } from '../server/core';
import { processPrivacyJobs } from '../server/privacy-jobs';
import { selfExport } from '../server/privacy-export';
import { makeBackup, scrubTombstones } from '../server/backup';
import worker from '../server/index';
type F=Awaited<ReturnType<typeof fixture>>;
async function enabled(){const f=await fixture();f.sql({sql:"INSERT INTO settings(key,value) VALUES('privacy_rights',?)",params:[JSON.stringify({enabled:true,policyVersion:'synthetic-v1',downloadHours:24,responseDays:30})]});return f;}
async function create(f:F,type='export',message='',key=uid()) {return f.request('/api/privacy/requests','member','POST',{type,message,idempotencyKey:key});}
const job=(f:F)=>f.sql({sql:'SELECT * FROM operational_jobs'}).results[0];
const statuses=(f:F)=>f.sql({sql:'SELECT status FROM privacy_requests'}).results.map((r:any)=>r.status);
async function ready(f:F){const request=await create(f);expect(request.status,JSON.stringify(request.data)).toBe(201);await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['ready']);return request.data.request.id as string;}

describe('Selective privacy rights — local SQLite/R2, no production/email/destructive operations',()=>{
  it('is disabled by default and does not depend on new tables until a complete policy is enabled',async()=>{
    const f=await fixture(),prepare=f.env.DB.prepare;
    f.env.DB.prepare=(q:string)=>{if(/privacy_requests|operational_jobs|privacy_export_artifacts/.test(q))throw Error('NEW_SCHEMA_NOT_AVAILABLE');return prepare(q);};
    expect((await f.request('/api/privacy/summary','member')).data.enabled).toBe(false);
    expect((await create(f)).status).toBe(503);await processPrivacyJobs(f.env);expect(f.puts()).toBe(0);
  });
  it('requires the authenticated owner, CSRF, fresh email and an explicit supported body before creating any job',async()=>{
    const f=await enabled();
    expect((await f.request('/api/privacy/summary')).status).toBe(401);
    f.sql({sql:'UPDATE sessions SET verified_at=0 WHERE user_id=?',params:[f.actors.member.id]});expect(await create(f)).toMatchObject({status:403,data:{code:'REAUTH_REQUIRED'}});
    f.sql({sql:'UPDATE sessions SET verified_at=? WHERE user_id=?',params:[now(),f.actors.member.id]});
    expect((await f.request('/api/privacy/requests','member','POST',{type:'export',idempotencyKey:uid(),userId:f.actors.owner.id})).status).toBe(400);
    const r=await worker.fetch(new Request('https://ksa.men/api/privacy/requests',{method:'POST',headers:{Origin:'https://ksa.men',Cookie:f.actors.member.cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'export',idempotencyKey:uid()})}),f.env,{} as any);expect(r.status).toBe(403);
    expect(statuses(f)).toEqual([]);expect(f.puts()).toBe(0);
  });
  it('registers one request/event/job for repeated or concurrent clicks and never claims readiness on receipt',async()=>{
    const f=await enabled(),key=uid();
    const both=await Promise.all([create(f,'export','',key),create(f,'export','',key)]);expect(both.map(r=>r.status).sort()).toEqual([200,201]);
    const again=await create(f,'export','',uid());expect(again.status).toBe(200);expect(again.data.idempotent).toBe(true);
    expect(statuses(f)).toEqual(['received']);expect(f.sql({sql:'SELECT * FROM privacy_request_events'}).results).toHaveLength(1);expect(f.sql({sql:'SELECT * FROM operational_jobs'}).results).toHaveLength(1);expect(f.puts()).toBe(0);
    expect((await f.request('/api/privacy/summary','member')).data.requests[0].downloadable).toBe(false);
  });
  it('rejects idempotency-key reuse with a changed request body without duplicating evidence',async()=>{
    const f=await enabled(),key=uid();expect((await create(f,'correction','SYNTHETIC REQUEST',key)).status).toBe(201);
    expect((await create(f,'objection','SYNTHETIC REQUEST',key)).status).toBe(409);expect(statuses(f)).toEqual(['received']);
  });
  it('generates a private copy from explicit subject-only fields, with verified bytes and no credentials, restricted evidence or delegated member data',async()=>{
    const f=await enabled();
    f.sql({sql:'UPDATE users SET pin_hash=? WHERE id=?',params:['AUTHENTICATION-SECRET-SENTINEL',f.actors.member.id]});
    const p=JSON.parse(f.sql({sql:'SELECT draft FROM sites WHERE id=?',params:[f.site]}).results[0].draft);p.notes='OWN-PRIVATE-NOTE';p.unknownInternal='INTERNAL-SENTINEL';p.experience=[{id:'own',title:'OWN WORK',secret:'NESTED-INTERNAL'}];f.sql({sql:'UPDATE sites SET draft=? WHERE id=?',params:[JSON.stringify(p),f.site]});
    f.sql({sql:"INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,created_at) VALUES(?,?,?,'RESTRICTED-REVIEW-EVIDENCE',0,0,'pending',?)",params:[uid(),f.site,f.actors.member.id,now()]});
    const id=await ready(f),copy=await f.request('/api/privacy/requests/'+id+'/download','member');expect(copy.status,JSON.stringify(copy.data)).toBe(200);
    expect(copy.data.account.id).toBe(f.actors.member.id);expect(copy.data.sites[0].draft.notes).toBe('OWN-PRIVATE-NOTE');expect(copy.data.sites[0].draft.experience[0].title).toBe('OWN WORK');
    const text=JSON.stringify(copy.data);for(const secret of ['AUTHENTICATION-SECRET-SENTINEL','INTERNAL-SENTINEL','NESTED-INTERNAL','RESTRICTED-REVIEW-EVIDENCE','owner@synthetic.invalid','manager@synthetic.invalid','SYNTHETIC-AUTH'])expect(text).not.toContain(secret);
    expect(copy.data.coverage.mediaContent).toBe('references-only');expect(job(f).status).toBe('succeeded');expect(f.purges()).toBe(0);
    const manager=JSON.parse(new TextDecoder().decode(await selfExport(f.env,f.actors.manager.id,'synthetic-v1')));expect(manager.sites).toEqual([]);expect(manager.account.id).toBe(f.actors.manager.id);
  });
  it('never lets a visitor, another member, assigned manager or platform owner read the requester file through the self route',async()=>{
    const f=await enabled(),id=await ready(f);
    for(const actor of [undefined,'manager','owner'])expect((await f.request('/api/privacy/requests/'+id+'/download',actor)).status).toBe(actor?404:401);
    expect((await f.request('/api/privacy/requests/'+id,'manager')).status).toBe(404);
    const record=f.sql({sql:'SELECT bucket_key FROM privacy_export_artifacts WHERE request_id=?',params:[id]}).results[0];
    const unsafe=await worker.fetch(new Request('https://ksa.men/api/media/'+encodeURIComponent(record.bucket_key)),f.env,{} as any);expect(unsafe.status).not.toBe(200);
    const response=await worker.fetch(new Request('https://ksa.men/api/privacy/requests/'+id+'/download',{headers:{Cookie:f.actors.member.cookie}}),f.env,{} as any);
    expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');expect(response.headers.get('Content-Disposition')).toContain('attachment');
  });
  it('expires download permission without deleting production data, and permits a new request with a new key',async()=>{
    const f=await enabled(),id=await ready(f);f.sql({sql:'UPDATE privacy_export_artifacts SET expires_at=? WHERE request_id=?',params:[now()-1,id]});
    expect((await f.request('/api/privacy/requests/'+id+'/download','member')).status).toBe(410);expect((await f.request('/api/privacy/summary','member')).data.requests[0]).toMatchObject({status:'expired',downloadable:false});
    const fresh=await create(f);expect(fresh.status).toBe(201);expect(fresh.data.request.id).not.toBe(id);expect(f.purges()).toBe(0);
  });
  it('does not mark an R2 failure ready and resumes with a bounded attempt and a durable candidate-key trail',async()=>{
    const f=await enabled();await create(f);const put=f.env.MEDIA.put;f.env.MEDIA.put=vi.fn(async()=>{throw Error('SYNTHETIC-R2-FAILURE');});
    await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['failed']);expect(job(f).attempts).toBe(1);expect(JSON.parse(job(f).artifact_keys)).toHaveLength(1);expect(f.sql({sql:'SELECT * FROM privacy_export_artifacts'}).results).toHaveLength(0);
    f.env.MEDIA.put=put;f.sql({sql:'UPDATE operational_jobs SET next_attempt_at=0'});await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['ready']);expect(job(f).attempts).toBe(2);expect(JSON.parse(job(f).artifact_keys)).toHaveLength(2);
  });
  it('rejects corrupt stored bytes and never treats a metadata checksum as proof',async()=>{
    const f=await enabled();await create(f);const get=f.env.MEDIA.get;
    f.env.MEDIA.get=async(key:string)=>{const item=await get(key);if(!item)return item;const bytes=new Uint8Array(await item.arrayBuffer()).slice();bytes[0]^=1;return {...item,arrayBuffer:async()=>bytes.buffer};};
    await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['failed']);expect(job(f).last_error_code).toBe('export_write_unverified');expect(f.sql({sql:'SELECT * FROM privacy_export_artifacts'}).results).toHaveLength(0);
  });
  it('a failed ready-commit leaves no artifact or false ready state and preserves the staged-key evidence',async()=>{
    const f=await enabled();await create(f);f.sql({sql:"CREATE TRIGGER synthetic_ready_failure BEFORE INSERT ON privacy_export_artifacts BEGIN SELECT RAISE(ABORT,'SYNTHETIC_READY_FAILURE'); END"});
    await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['failed']);expect(job(f).status).toBe('failed');expect(f.puts()).toBe(1);expect(JSON.parse(job(f).artifact_keys)).toHaveLength(1);expect(f.sql({sql:'SELECT * FROM privacy_export_artifacts'}).results).toHaveLength(0);
  });
  it('concurrent dispatch uses one lease and caps a persistent failure at three attempts',async()=>{
    const f=await enabled();await create(f);await Promise.all([processPrivacyJobs(f.env),processPrivacyJobs(f.env)]);expect(statuses(f)).toEqual(['ready']);expect(f.puts()).toBe(1);expect(job(f).attempts).toBe(1);
    const g=await enabled();await create(g);g.env.MEDIA.put=vi.fn(async()=>{throw Error('SYNTHETIC_ALWAYS_FAILED');});
    for(let i=0;i<4;i++){g.sql({sql:'UPDATE operational_jobs SET next_attempt_at=0'});await processPrivacyJobs(g.env);}
    expect(job(g).attempts).toBe(3);expect(g.env.MEDIA.put).toHaveBeenCalledTimes(3);expect(statuses(g)).toEqual(['failed']);
  });
  it('a removal or policy disable during R2 staging prevents readiness and does not restore credentials or publish a link',async()=>{
    const f=await enabled();await create(f);const put=f.env.MEDIA.put;f.env.MEDIA.put=async(...args:any[])=>{await put(...args);f.sql({sql:"UPDATE users SET status='deleted' WHERE id=?",params:[f.actors.member.id]});f.sql({sql:"INSERT INTO deleted_tombstones(resource_type,resource_id,deleted_at,source) VALUES('account',?,?,'SYNTHETIC')",params:[String(f.actors.member.id),now()]});};
    await processPrivacyJobs(f.env);expect(statuses(f)).not.toEqual(['ready']);expect(f.sql({sql:'SELECT * FROM privacy_export_artifacts'}).results).toHaveLength(0);expect((await f.request('/api/privacy/summary','member')).status).not.toBe(200);
    const g=await enabled();await create(g);const other=g.env.MEDIA.put;g.env.MEDIA.put=async(...args:any[])=>{await other(...args);g.sql({sql:"UPDATE settings SET value='{}' WHERE key='privacy_rights'"});};await processPrivacyJobs(g.env);expect(statuses(g)).toEqual(['failed']);expect(g.sql({sql:'SELECT * FROM privacy_export_artifacts'}).results).toHaveLength(0);
  });
  it('records an erasure-right request and an explained owner response without deleting, publishing or widening the current lifecycle',async()=>{
    const f=await enabled();const before=f.sql({sql:'SELECT * FROM users WHERE id=?',params:[f.actors.member.id]}).results;
    const created=await create(f,'erasure','SYNTHETIC PLEASE REVIEW');expect(created.status).toBe(201);const id=created.data.request.id;
    const route='/api/admin/privacy/requests/'+id+'/reply';for(const actor of ['member','manager'])expect((await f.request(route,actor,'POST',{status:'answered',response:'SYNTHETIC RESPONSE',expectedRevision:1})).status).toBe(403);
    expect((await f.request(route,'owner','POST',{status:'blocked',response:'SYNTHETIC EXPLAINED FOLLOW-UP',expectedRevision:1})).status).toBe(200);
    expect((await f.request(route,'owner','POST',{status:'answered',response:'STALE RESPONSE',expectedRevision:1})).status).toBe(409);
    expect((await f.request('/api/privacy/requests/'+id,'member')).data.request).toMatchObject({status:'blocked',response:'SYNTHETIC EXPLAINED FOLLOW-UP'});
    expect(f.sql({sql:'SELECT * FROM users WHERE id=?',params:[f.actors.member.id]}).results).toEqual(before);expect(f.sql({sql:'SELECT * FROM deletion_requests'}).results).toHaveLength(0);expect(f.purges()).toBe(0);expect(f.puts()).toBe(0);
  });
  it('withdraws optional contact choice through live visibility without altering a published snapshot or another account',async()=>{
    const f=await enabled();const before=f.sql({sql:'SELECT draft,published,draft_version,published_version FROM sites WHERE id=?',params:[f.site]}).results;
    expect((await f.request('/api/privacy/consents/contact/withdraw','member','POST')).status).toBe(200);expect(f.sql({sql:'SELECT allow_contact FROM sites WHERE id=?',params:[f.site]}).results[0].allow_contact).toBe(0);expect(f.sql({sql:'SELECT hidden_fields FROM site_visibility WHERE site_id=?',params:[f.site]}).results[0].hidden_fields).toContain('allowContact');expect(f.sql({sql:'SELECT draft,published,draft_version,published_version FROM sites WHERE id=?',params:[f.site]}).results).toEqual(before);
    expect((await f.request('/api/privacy/consents/seasonal_notices/withdraw','member','POST')).status).toBe(400);expect((await f.request('/api/privacy/consents/account_creation/withdraw','member','POST')).status).toBe(400);
  });
  it('excludes runtime jobs/download capabilities from encrypted backups and anonymizes erased-subject rights without dropping their events',async()=>{
    const f=await enabled();await ready(f);const saved=await makeBackup(f.env,'synthetic-privacy');const object=await f.env.MEDIA.get('backups/'+saved.id+'.ksab');expect(object).not.toBeNull();
    const bytes=new Uint8Array(await object.arrayBuffer());const material=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.env.BACKUP_ENCRYPTION_KEY));
    const key=await crypto.subtle.importKey('raw',material,{name:'AES-GCM'},false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16)},key,bytes.slice(16));const payload=JSON.parse(new TextDecoder().decode(plain));
    expect(payload.tables.operational_jobs||[]).toHaveLength(0);expect(payload.tables.privacy_export_artifacts||[]).toHaveLength(0);expect(payload.tables.privacy_requests[0].status).toBe('ready');expect(payload.tables.privacy_request_events.length).toBeGreaterThan(0);
    const recovery=await f.request('/api/admin/backups/'+saved.id,'owner');expect(recovery.status).toBe(200);expect(recovery.data.tables.privacy_requests[0].status).toBe('expired');
    const tables:any={users:[{id:41,email:'OLD PRIVATE',name:'OLD',status:'active',role:'user'}],privacy_requests:[{id:'old',user_id:41,type:'export',status:'ready',message:'OLD PRIVATE',public_response:'PRIVATE',assigned_to:41,payload_hash:'CAPABILITY',idempotency_key:'OLD'}],privacy_request_events:[{actor_id:41,request_id:'old'}],deleted_tombstones:[{resource_type:'account',resource_id:'41'}],operational_jobs:[{lease_token:'TOKEN'}],privacy_export_artifacts:[{bucket_key:'PRIVATE'}]};
    scrubTombstones(tables);expect(tables.privacy_requests[0]).toMatchObject({user_id:null,message:'',public_response:'',assigned_to:null,status:'cancelled'});expect(tables.users[0]).toMatchObject({status:'deleted',name:'حساب محذوف'});expect(tables.privacy_request_events).toHaveLength(1);expect(tables.operational_jobs).toEqual([]);expect(tables.privacy_export_artifacts).toEqual([]);
  });
});

describe('Privacy rights bounds and isolated recovery',()=>{
  it('pages subject-owned history at equal timestamps and administrative due dates without duplication or a foreign request',async()=>{
    const f=await enabled(),clock=now(),items=[];
    for(let i=0;i<27;i++)items.push({sql:"INSERT INTO privacy_requests(id,user_id,type,message,idempotency_key,payload_hash,policy_version,due_at,created_at,updated_at) VALUES(?,?,'correction','LOCAL',?,'HASH','synthetic-v1',?,?,?)",params:[uid(),f.actors.member.id,uid(),clock+86400,clock,clock]});
    items.push({sql:"INSERT INTO privacy_requests(id,user_id,type,message,idempotency_key,payload_hash,policy_version,due_at,created_at,updated_at) VALUES(?,?,'correction','FOREIGN-SENTINEL',?,'HASH','synthetic-v1',?,?,?)",params:[uid(),f.actors.manager.id,uid(),clock,clock,clock]});f.sql({batch:items});
    const first=(await f.request('/api/privacy/summary','member')).data;expect(first.requests).toHaveLength(25);expect(first.nextBefore).toBeTruthy();
    const second=(await f.request('/api/privacy/requests?before='+encodeURIComponent(first.nextBefore),'member')).data;expect(second.requests).toHaveLength(2);expect(second.nextBefore).toBeNull();expect(new Set([...first.requests,...second.requests].map(r=>r.id)).size).toBe(27);expect(JSON.stringify(second)).not.toContain('FOREIGN-SENTINEL');
    const a=(await f.request('/api/admin/privacy/requests','owner')).data;expect(a.requests[0].dueAt).toBe(clock);const b=(await f.request('/api/admin/privacy/requests?after='+encodeURIComponent(a.nextAfter),'owner')).data;expect(new Set([...a.requests,...b.requests].map(r=>r.id)).size).toBe(28);
    expect((await f.request('/api/privacy/requests?before=bad','member')).status).toBe(400);
  });
  it('routes an oversized copy to assistance instead of loading enormous site rows or returning a truncated ready file',async()=>{
    const f=await enabled();await create(f);f.sql({sql:'UPDATE sites SET draft=? WHERE id=?',params:[JSON.stringify({name:'LOCAL',notes:'x'.repeat(4*1024*1024)}),f.site]});
    const prepare=f.env.DB.prepare,loaded=vi.fn();f.env.DB.prepare=(q:string)=>{if(q.startsWith('SELECT id,draft,published'))loaded();return prepare(q);};
    await processPrivacyJobs(f.env);expect(statuses(f)).toEqual(['failed']);expect(job(f).last_error_code).toBe('export_requires_assistance');expect(job(f).attempts).toBe(3);expect(f.puts()).toBe(0);expect(loaded).not.toHaveBeenCalled();
  });
  it('restores the new schema into a fresh local SQLite file without runtime artifacts, jobs or auto-ready files',async()=>{
    const {mkdtempSync,writeFileSync,readFileSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawnSync}=await import('node:child_process');
    const f=await enabled();await ready(f);const saved=await makeBackup(f.env,'synthetic-restore');const raw=await f.env.MEDIA.get('backups/'+saved.id+'.ksab');
    const dir=mkdtempSync(join(tmpdir(),'ksa-privacy-restore-')),source=join(dir,'synthetic.ksab'),context=join(dir,'context.json'),target=join(dir,'restored.sqlite');
    writeFileSync(source,new Uint8Array(await raw.arrayBuffer()));writeFileSync(context,JSON.stringify({generatedAt:now(),deleted_tombstones:[],retained_sites:[]}));
    const result=spawnSync('python3',['scripts/restore_snapshot.py',source,target,'--sha256',saved.sha256,'--tombstones',context],{encoding:'utf8',env:{PATH:process.env.PATH,BACKUP_ENCRYPTION_KEY:f.env.BACKUP_ENCRYPTION_KEY}});
    expect(result.status,result.stderr+result.stdout).toBe(0);const report=JSON.parse(readFileSync(join(dir,'restored.verification.json'),'utf8'));
    expect(report.sqliteIntegrity).toBe('ok');expect(report.foreignKeyViolations).toEqual([]);expect(report.productionModified).toBe(false);expect(report.tableCounts.operational_jobs).toBe(0);expect(report.tableCounts.privacy_export_artifacts).toBe(0);
    const check=spawnSync('python3',['-c','import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute("SELECT status FROM privacy_requests").fetchall()))',target],{encoding:'utf8'});expect(JSON.parse(check.stdout)).toEqual([['expired']]);
    const fk=f.sql({sql:'PRAGMA foreign_key_list(privacy_request_events)'}).results;expect(fk.some((r:any)=>r.from==='actor_id')).toBe(false);
    // A genuine encrypted v2 envelope with its OLD schema must still restore.
    const material=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.env.BACKUP_ENCRYPTION_KEY));
    const key=await crypto.subtle.importKey('raw',material,{name:'AES-GCM'},false,['encrypt','decrypt']);
    const original=new Uint8Array(await raw.arrayBuffer());
    const legacy=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:original.slice(4,16)},key,original.slice(16))));
    const names=['privacy_requests','privacy_request_events','privacy_export_artifacts','operational_jobs'];
    legacy.schema=legacy.schema.filter((item:any)=>!names.some(name=>String(item.sql||'').includes(name)));
    for(const name of names)delete legacy.tables[name]; // In-memory synthetic payload, never a SQL deletion.
    const plain=new TextEncoder().encode(JSON.stringify(legacy)),nonce=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plain),envelope=new Uint8Array(16+cipher.byteLength);envelope.set(new TextEncoder().encode('KSA2'));envelope.set(nonce,4);envelope.set(new Uint8Array(cipher),16);
    const legacySource=join(dir,'legacy.ksab'),legacyTarget=join(dir,'legacy.sqlite');writeFileSync(legacySource,envelope);
    const {privateFileHash}=await import('../server/privacy-jobs');
    const oldResult=spawnSync('python3',['scripts/restore_snapshot.py',legacySource,legacyTarget,'--sha256',await privateFileHash(plain),'--tombstones',context],{encoding:'utf8',env:{PATH:process.env.PATH,BACKUP_ENCRYPTION_KEY:f.env.BACKUP_ENCRYPTION_KEY}});
    expect(oldResult.status,oldResult.stderr+oldResult.stdout).toBe(0);const oldReport=JSON.parse(readFileSync(join(dir,'legacy.verification.json'),'utf8'));expect(oldReport.foreignKeyViolations).toEqual([]);expect(oldReport.sqliteIntegrity).toBe('ok');expect(oldReport.tableCounts.operational_jobs).toBeUndefined();
  });
});

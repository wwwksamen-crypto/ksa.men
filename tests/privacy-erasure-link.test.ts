import {describe,it,expect} from 'vitest';
import {fixture} from './repair-fixture';
import {uid,now} from '../server/core';
type F=Awaited<ReturnType<typeof fixture>>;
async function setup(){const f=await fixture();f.sql({sql:"INSERT INTO settings(key,value) VALUES('privacy_rights',?)",params:[JSON.stringify({enabled:true,policyVersion:'synthetic-v1',downloadHours:24,responseDays:30})]});const r=await f.request('/api/privacy/requests','member','POST',{type:'erasure',message:'SYNTHETIC REVIEW',idempotencyKey:uid()});expect(r.status).toBe(201);return {...f,id:r.data.request.id as string};}
async function erase(f:F,scope:'account'|'account_only'|'site'='site'){
 const resource=scope==='site'?'sites':'users',id=scope==='site'?f.site:String(f.actors.member.id),root='/api/admin/'+resource+'/'+id;
 const impact=await f.request(root+'/erasure-impact'+(scope==='account_only'?'?mode=account_only':''),'owner');
 return f.request(root+'/erase','owner','POST',{mode:scope==='account_only'?'account_only':undefined,reason:'SYNTHETIC AUTHORISED',affirmation:true,confirmation:id,impactToken:impact.data.impactToken,versions:impact.data.versions});
}
const bind=(f:F,id:string,operation:string,revision=1,actor='owner')=>f.request('/api/admin/privacy/requests/'+id+'/link-erasure',actor,'POST',{deletionRequestId:operation,expectedRevision:revision});
describe('Scoped erasure association — isolated, no production or physical deletion',()=>{
 it('reads choices only, refuses an unexecuted record and does not mutate subject or rights on read',async()=>{
  const f=await setup(),before=f.sql({sql:'SELECT * FROM users'}).results;
  expect((await f.request('/api/admin/privacy/requests/'+f.id+'/erasure-options','owner')).data.operations).toEqual([]);
  const fake=uid();f.sql({sql:"INSERT INTO deletion_requests(id,user_id,reason,status,created_at,requested_action,executed_at) VALUES(?,?,'SYNTHETIC','destroyed',?,'owner-site',?)",params:[fake,f.actors.member.id,now(),now()]});
  expect((await bind(f,f.id,fake)).status).toBe(409);expect(f.sql({sql:'SELECT * FROM users'}).results).toEqual(before);expect(f.sql({sql:'SELECT * FROM privacy_erasure_links'}).results).toEqual([]);expect(f.purges()).toBe(0);
 });
 it('links only an already committed site scope without erasing an account or calling a purge',async()=>{
  const f=await setup(),op=await erase(f);expect(op.status,JSON.stringify(op.data)).toBe(200);
  const before=f.sql({sql:'SELECT * FROM users'}).results;
  const linked=await bind(f,f.id,op.data.requestId);expect(linked.status,JSON.stringify(linked.data)).toBe(200);expect(linked.data.outcome).toMatchObject({scope:'site',operationRecorded:true,recordsRetained:true,fullErasureVerified:false,media:{state:'verified',total:0}});
  const member=await f.request('/api/privacy/requests/'+f.id,'member');expect(member.data.outcome.scope).toBe('site');expect(member.data.request.status).toBe('answered');expect(f.sql({sql:'SELECT * FROM users'}).results).toEqual(before);expect(f.purges()).toBe(0);
 });
 it('retains sites when account_only is linked and never revives a removed user session',async()=>{
  const f=await setup(),op=await erase(f,'account_only');expect(op.status).toBe(200);
  const result=await bind(f,f.id,op.data.requestId);expect(result.status,JSON.stringify(result.data)).toBe(200);expect(result.data.outcome).toMatchObject({scope:'account_only',fullErasureVerified:false,media:{state:'retained'}});
  expect((await f.request('/api/privacy/requests/'+f.id,'member')).status).toBe(401);const site=f.sql({sql:'SELECT * FROM sites WHERE id=?',params:[f.site]}).results[0];expect(site.user_id).toBeNull();expect(site.manager_id).toBe(f.actors.owner.id);expect(site.status).not.toBe('deleted');expect(f.purges()).toBe(0);
 });
 it('reports pending and failed media as follow-up, not full erasure, even after a queue completion record',async()=>{
  const f=await setup(),m=uid();f.sql({sql:"INSERT INTO media(id,owner_id,site_id,bucket_key,purpose,mime,size,public,created_at) VALUES(?,?,?,?,'logo','image/webp',12,1,?)",params:[m,f.actors.member.id,f.site,'synthetic/'+m,now()]});
  const op=await erase(f);expect(op.status).toBe(200);const linked=await bind(f,f.id,op.data.requestId);expect(linked.data.outcome.media).toMatchObject({state:'pending',total:1,pending:1,removed:0});
  f.sql({sql:"UPDATE media_purge_queue SET status='failed' WHERE deletion_request_id=?",params:[op.data.requestId]});expect((await f.request('/api/privacy/requests/'+f.id,'member')).data.outcome.media.failed).toBe(1);
  f.sql({sql:"UPDATE media_purge_queue SET status='deleted',completed_at=? WHERE deletion_request_id=?",params:[now(),op.data.requestId]});const final=await f.request('/api/privacy/requests/'+f.id,'member');expect(final.data.outcome.media.state).toBe('verified');expect(final.data.outcome.fullErasureVerified).toBe(false);expect(f.purges()).toBe(0);
 });
 it('does not bypass a hold or an open report and never uses linking as an erasure command',async()=>{
  const f=await setup();f.sql({sql:"INSERT INTO retention_holds(id,resource_type,resource_id,user_id,legal_basis,created_at) VALUES(?,'account',?,?,'SYNTHETIC HOLD',?)",params:[uid(),String(f.actors.member.id),f.actors.member.id,now()]});const op=await erase(f,'account');expect(op.status).toBe(409);
  expect((await bind(f,f.id,uid())).status).toBe(409);expect(f.sql({sql:'SELECT status FROM users WHERE id=?',params:[f.actors.member.id]}).results[0].status).toBe('active');expect(f.sql({sql:'SELECT * FROM privacy_erasure_links'}).results).toEqual([]);
 });
 it('rejects a stale decision and preserves a previously linked operation under repeated and concurrent clicks',async()=>{
  const f=await setup(),op=await erase(f);expect((await bind(f,f.id,op.data.requestId,2)).status).toBe(409);
  const both=await Promise.all([bind(f,f.id,op.data.requestId),bind(f,f.id,op.data.requestId)]);expect(both.some(r=>r.status===200)).toBe(true);expect(both.every(r=>[200,409].includes(r.status))).toBe(true);
  expect((await bind(f,f.id,op.data.requestId)).data.idempotent).toBe(true);expect((await bind(f,f.id,uid())).status).toBe(409);expect(f.sql({sql:'SELECT * FROM privacy_erasure_links'}).results).toHaveLength(1);expect(f.sql({sql:"SELECT * FROM privacy_request_events WHERE event_code='scoped_operation_linked'"}).results).toHaveLength(1);
 });
 it('refuses operations before the request or for a different subject',async()=>{
  const f=await setup(),op=await erase(f);f.sql({sql:'UPDATE privacy_requests SET created_at=? WHERE id=?',params:[now()+10,f.id]});expect((await bind(f,f.id,op.data.requestId)).status).toBe(409);
  f.sql({sql:'UPDATE privacy_requests SET created_at=?,user_id=? WHERE id=?',params:[now()-10,f.actors.manager.id,f.id]});expect((await bind(f,f.id,op.data.requestId)).status).toBe(409);
 });
 it('enforces ownership of administration, fresh authentication, complete policy and strict request shape',async()=>{
  const f=await setup(),op=await erase(f);
  for(const actor of ['member','manager'])expect((await bind(f,f.id,op.data.requestId,1,actor)).status).toBe(403);
  expect((await f.request('/api/admin/privacy/requests/'+f.id+'/link-erasure','owner','POST',{deletionRequestId:op.data.requestId,expectedRevision:1,eraseNow:true})).status).toBe(400);
  f.sql({sql:'UPDATE sessions SET verified_at=0 WHERE user_id=?',params:[f.actors.owner.id]});expect((await bind(f,f.id,op.data.requestId)).data.code).toBe('REAUTH_REQUIRED');
  f.sql({sql:'UPDATE sessions SET verified_at=? WHERE user_id=?',params:[now(),f.actors.owner.id]});f.sql({sql:"UPDATE settings SET value='{}' WHERE key='privacy_rights'"});expect((await bind(f,f.id,op.data.requestId)).status).toBe(503);
 });
 it('rolls back link/event/status together on a failed D1 commit, leaving the existing erasure intact',async()=>{
  const f=await setup(),op=await erase(f);f.sql({sql:"CREATE TRIGGER synthetic_link_fail BEFORE UPDATE ON privacy_requests WHEN NEW.status='answered' BEGIN SELECT RAISE(ABORT,'SYNTHETIC'); END"});
  const result=await bind(f,f.id,op.data.requestId);expect(result.status).not.toBe(200);expect(f.sql({sql:'SELECT * FROM privacy_erasure_links'}).results).toHaveLength(0);expect(f.sql({sql:'SELECT status FROM privacy_requests WHERE id=?',params:[f.id]}).results[0].status).toBe('received');expect(f.sql({sql:'SELECT status FROM deletion_requests WHERE id=?',params:[op.data.requestId]}).results[0].status).toBe('destroyed');
 });
});

describe('Post-commit association truthfulness',()=>{
 it('does not claim rollback when the association committed but the later audit failed',async()=>{
  const f=await setup(),op=await erase(f),prepare=f.env.DB.prepare;
  f.env.DB.prepare=(q:string)=>{if(/INSERT\s+INTO\s+audit\b/i.test(q))throw Error('SYNTHETIC AUDIT FAILURE');return prepare(q);};
  const result=await bind(f,f.id,op.data.requestId);expect(result.status,JSON.stringify(result.data)).toBe(200);expect(result.data.linked).toBe(true);expect(result.data.auditRecorded).toBe(false);expect(f.sql({sql:'SELECT * FROM privacy_erasure_links'}).results).toHaveLength(1);expect((await bind(f,f.id,op.data.requestId)).data.idempotent).toBe(true);
 });
});

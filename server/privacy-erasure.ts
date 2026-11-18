import {z} from 'zod';
import {HTTPException} from 'hono/http-exception';
import type {App,Ctx} from './core';
import {all,audit,fresh,now,one,role,uid} from './core';
import {privacyPolicy} from './privacy-jobs';
import type {PrivacyErasureOutcome} from '../shared/privacy-rights';

const bodySchema=z.object({deletionRequestId:z.string().uuid(),expectedRevision:z.number().int().positive()}).strict();
const candidateSQL=`SELECT d.id,d.requested_action,d.executed_at,t.resource_id
 FROM deletion_requests d JOIN deleted_tombstones t ON t.deletion_request_id=d.id
 WHERE d.user_id=? AND d.created_at>=? AND d.status='destroyed' AND d.executed_at IS NOT NULL
 AND d.requested_action IN ('owner-account','owner-account_only','owner-site') AND t.source='owner-erasure'
 AND ((d.requested_action='owner-site' AND t.resource_type='site') OR
      (d.requested_action IN ('owner-account','owner-account_only') AND t.resource_type='account' AND t.resource_id=CAST(d.user_id AS TEXT)))`;
function deny(message:string):never{throw new HTTPException(409,{message});}
async function guard(c:Ctx){role(c,['owner']);fresh(c);c.header('Cache-Control','private, no-store');c.header('X-Robots-Tag','noindex, nofollow');if(!(await privacyPolicy(c.env)).enabled)throw new HTTPException(503,{message:'طلبات البيانات متاحة عبر الدعم حالياً'});}

/** Read only. A committed scope and a media queue are not proof of complete physical erasure. */
export async function erasureOutcome(c:Ctx,requestId:string):Promise<PrivacyErasureOutcome|null> {
 const row=await one<any>(c,`SELECT l.deletion_request_id,l.scope,l.resource_id,d.status,d.executed_at,
   (SELECT CAST(json_extract(a.detail,'$.mediaCount') AS INTEGER) FROM audit a
    WHERE a.action='owner.erasure.requested' AND json_valid(a.detail) AND json_extract(a.detail,'$.requestId')=d.id ORDER BY a.id LIMIT 1) AS expected_media
   FROM privacy_erasure_links l JOIN deletion_requests d ON d.id=l.deletion_request_id WHERE l.request_id=?`,requestId);
 if(!row)return null;
 const queue=await one<any>(c,`SELECT COUNT(*) AS total,COALESCE(SUM(status='deleted'),0) AS removed,
 COALESCE(SUM(status='failed'),0) AS failed FROM media_purge_queue WHERE deletion_request_id=?`,row.deletion_request_id);
 const total=Number(queue?.total||0),removed=Number(queue?.removed||0),failed=Number(queue?.failed||0),expected=row.expected_media===null?null:Number(row.expected_media);
 const recorded=row.status==='destroyed'&&Boolean(row.executed_at)&&Boolean(await one(c,`SELECT 1 FROM deleted_tombstones WHERE deletion_request_id=? AND source='owner-erasure' AND resource_type=? AND resource_id=?`,row.deletion_request_id,row.scope==='site'?'site':'account',row.resource_id));
 const state=row.scope==='account_only'?'retained':!recorded||expected===null||total!==expected?'incomplete':removed===total?'verified':'pending';
 return {scope:row.scope,operationRecorded:recorded,executedAt:Number(row.executed_at||0),recordsRetained:true,fullErasureVerified:false,
   media:{total,removed,failed,pending:Math.max(0,total-removed-failed),state}};
}
export function registerPrivacyErasure(app:App){
 app.get('/api/admin/privacy/requests/:id/erasure-options',async c=>{
  await guard(c);const request=await one<any>(c,"SELECT id,user_id,created_at FROM privacy_requests WHERE id=? AND type='erasure'",c.req.param('id'));
  if(!request)throw new HTTPException(404,{message:'الطلب غير موجود'});
  if(request.user_id===null)return c.json({operations:[]});
  const rows=await all<any>(c,candidateSQL+' ORDER BY d.executed_at DESC,d.id DESC LIMIT 20',request.user_id,request.created_at);
  return c.json({operations:rows.map(r=>({id:r.id,scope:r.requested_action.slice(6),executedAt:r.executed_at}))});
 });
 app.post('/api/admin/privacy/requests/:id/link-erasure',async c=>{
  await guard(c);const actor=role(c,['owner']),body=bodySchema.parse(await c.req.json()),id=c.req.param('id');
  const request=await one<any>(c,"SELECT id,user_id,type,status,created_at,revision,policy_version FROM privacy_requests WHERE id=?",id);
  if(!request||request.type!=='erasure')throw new HTTPException(404,{message:'طلب الإزالة غير موجود'});
  const previous=await one<any>(c,'SELECT deletion_request_id FROM privacy_erasure_links WHERE request_id=?',id);
  if(previous){if(previous.deletion_request_id!==body.deletionRequestId)deny('رُبط الطلب بعملية أخرى؛ لا يمكن استبدال إثباته');return c.json({linked:true,idempotent:true,outcome:await erasureOutcome(c,id)});}
  if(request.user_id===null||request.revision!==body.expectedRevision||!['received','reviewing','blocked','answered'].includes(request.status))deny('تغيّرت حالة الطلب؛ حدّث التفاصيل');
  const operation=await one<any>(c,candidateSQL+' AND d.id=?',request.user_id,request.created_at,body.deletionRequestId);
  if(!operation)deny('لا توجد عملية إزالة موثقة لهذا الطلب وصاحبه');
  const scope=operation.requested_action.slice(6),clock=now();
  // Recheck subject, revision, operation and tombstone inside the same atomic batch.
  const gate=`EXISTS(SELECT 1 FROM privacy_requests r JOIN deletion_requests d ON d.user_id=r.user_id
    JOIN deleted_tombstones t ON t.deletion_request_id=d.id
    WHERE r.id=? AND r.type='erasure' AND r.revision=? AND r.user_id=? AND r.policy_version=?
    AND r.status IN ('received','reviewing','blocked','answered') AND d.id=? AND d.status='destroyed'
    AND d.created_at>=r.created_at AND d.executed_at IS NOT NULL AND d.requested_action=?
    AND t.source='owner-erasure' AND t.resource_type=? AND t.resource_id=?)`;
  const result=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT OR IGNORE INTO privacy_erasure_links(request_id,deletion_request_id,scope,resource_id,policy_version,linked_by,linked_at)
    SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(id,body.deletionRequestId,scope,operation.resource_id,request.policy_version,actor.id,clock,id,body.expectedRevision,request.user_id,request.policy_version,body.deletionRequestId,operation.requested_action,scope==='site'?'site':'account',operation.resource_id),
   c.env.DB.prepare(`UPDATE privacy_requests SET status='answered',updated_at=?,revision=revision+1 WHERE id=? AND changes()=1`).bind(clock,id),
   c.env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at)
    SELECT ?,?,?,'answered','scoped_operation_linked',? WHERE changes()=1`).bind(uid(),id,actor.id,clock),
  ]);
  if(!Number(result[0]?.meta?.changes))deny('تغيّرت العملية أو رُبطت سابقاً؛ حدّث الطلب');
  let auditRecorded=true;
  try{await audit(c,'privacy.erasure.linked','privacy:'+id,{scope,operationId:body.deletionRequestId,fullErasureVerified:false});}
  catch{auditRecorded=false;} // The atomic link and append-only event already committed.
  return c.json({linked:true,idempotent:false,auditRecorded,outcome:await erasureOutcome(c,id)});
 });
}

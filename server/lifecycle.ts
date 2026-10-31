import { HTTPException } from 'hono/http-exception';
import type { Ctx, Env } from './core';
import { appendAudit, audit, fresh, me, now, one, run, setting, uid } from './core';

type LifecycleAction='hide'|'archive'|'schedule'|'destroy';
type Hold={kind:string;id:string};

function changed(result:unknown){return Number((result as any)?.meta?.changes??0);}
function safeError(error:unknown){return error instanceof Error?error.name:'r2_delete_failed';}

async function hidePublicPresence(c:Ctx,userId:number,at:number){
 const sites=(await c.env.DB.prepare('SELECT id FROM sites WHERE user_id=?').bind(userId).all<{id:string}>()).results;
 const statements=[
  c.env.DB.prepare("UPDATE sites SET status='hidden',searchable=0,allow_contact=0,updated_at=? WHERE user_id=? AND status<>'proxy_pending'").bind(at,userId),
  c.env.DB.prepare('UPDATE quick_links SET revoked=1 WHERE user_id=? AND revoked=0').bind(userId),
 ];
 await c.env.DB.batch(statements);
 return sites.map(site=>site.id);
}

/** Immediate owner-controlled withdrawal from all public routes; publication is never required to hide. */
export async function hideMyPublicPresence(c:Ctx){
 const user=me(c); const at=now(); const sites=await hidePublicPresence(c,user.id,at);
 await c.env.DB.prepare("UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND purpose IN ('public_profile','contact') AND withdrawn_at IS NULL").bind(at,user.id).run();
 await audit(c,'privacy.hide_public_presence',`user:${user.id}`,{siteCount:sites.length,at});
 return {hiddenAt:at,siteCount:sites.length};
}

async function activeHolds(env:Env,userId:number):Promise<Hold[]>{
 const explicit=(await env.DB.prepare("SELECT resource_type,resource_id FROM retention_holds WHERE user_id=? AND status='active'").bind(userId).all<{resource_type:string;resource_id:string}>()).results.map(row=>({kind:row.resource_type,id:row.resource_id}));
 const checks:[string,string][]=[
  ['payments',"SELECT id FROM payments WHERE user_id=? AND status<>'rejected'"],
  ['financial_ledger',"SELECT id FROM ledger WHERE from_id=? OR to_id=?"],
  ['reviews',"SELECT id FROM reviews WHERE user_id=?"],
  ['reports',"SELECT id FROM reports WHERE user_id=?"],
  ['transfers',"SELECT id FROM transfers WHERE from_id=? OR to_id=?"],
  ['handovers',"SELECT id FROM handovers WHERE accepted_by=? OR creator_id=?"],
  ['audit',"SELECT id FROM audit WHERE actor_id=?"],
  ['assigned_accounts',"SELECT id FROM users WHERE referrer_id=? OR assigned_to=?"],
 ];
 const implicit:Hold[]=[];
 for(const [kind,sql] of checks){const rows=(await env.DB.prepare(sql).bind(userId,userId).all<{id:string}>()).results;for(const row of rows.slice(0,10))implicit.push({kind,id:String(row.id)});}
 return [...explicit,...implicit];
}

async function tombstone(env:Env,type:'account'|'site'|'media'|'conversation'|'message',id:string,requestId:string|undefined,source:string){
 await env.DB.prepare('INSERT OR IGNORE INTO deleted_tombstones(resource_type,resource_id,deletion_request_id,deleted_at,source) VALUES(?,?,?,?,?)').bind(type,id,requestId??null,now(),source).run();
}

async function queueMedia(env:Env,requestId:string,media:Array<{id:string;bucket_key:string}>){
 if(!media.length)return;
 await env.DB.batch(media.map(item=>env.DB.prepare('INSERT OR IGNORE INTO media_purge_queue(id,deletion_request_id,media_id,bucket_key,status,attempts,created_at) VALUES(?,?,?,?,\'pending\',0,?)').bind(uid(),requestId,item.id,item.bucket_key,now())));
}

async function destroyEligibleAccount(env:Env,userId:number,requestId:string,source:string){
 const holds=await activeHolds(env,userId);
 if(holds.length){
  await env.DB.prepare("UPDATE deletion_requests SET status='blocked',blocked_reason=?,executed_at=? WHERE id=?").bind(JSON.stringify(holds.map(item=>item.kind).slice(0,6)),now(),requestId).run();
  await appendAudit(env,null,'privacy.deletion.blocked',`request:${requestId}`,{holdKinds:[...new Set(holds.map(item=>item.kind))]});
  return {status:'blocked' as const,holdKinds:[...new Set(holds.map(item=>item.kind))]};
 }
 const sites=(await env.DB.prepare('SELECT id FROM sites WHERE user_id=?').bind(userId).all<{id:string}>()).results;
 const media=(await env.DB.prepare('SELECT id,bucket_key FROM media WHERE owner_id=? OR site_id IN (SELECT id FROM sites WHERE user_id=?)').bind(userId,userId).all<{id:string;bucket_key:string}>()).results;
 const conversations=(await env.DB.prepare('SELECT id FROM conversations WHERE from_id=? OR to_id=?').bind(userId,userId).all<{id:string}>()).results;
 const messages=conversations.length? (await env.DB.prepare(`SELECT id FROM messages WHERE conversation_id IN (${conversations.map(()=>'?').join(',')})`).bind(...conversations.map(row=>row.id)).all<{id:string}>()).results:[];
 for(const site of sites)await tombstone(env,'site',site.id,requestId,source);
 for(const item of media)await tombstone(env,'media',item.id,requestId,source);
 for(const item of conversations)await tombstone(env,'conversation',item.id,requestId,source);
 for(const item of messages)await tombstone(env,'message',item.id,requestId,source);
 await tombstone(env,'account',String(userId),requestId,source);
 await queueMedia(env,requestId,media);
 const siteIds=sites.map(site=>site.id);
 const statements=[] as D1PreparedStatement[];
 if(conversations.length){
  const marks=conversations.map(()=>'?').join(',');
  statements.push(env.DB.prepare(`DELETE FROM messages WHERE conversation_id IN (${marks})`).bind(...conversations.map(row=>row.id)));
  statements.push(env.DB.prepare(`DELETE FROM conversations WHERE id IN (${marks})`).bind(...conversations.map(row=>row.id)));
 }
 if(siteIds.length){
  const marks=siteIds.map(()=>'?').join(',');
  statements.push(env.DB.prepare(`DELETE FROM analytics WHERE site_id IN (${marks})`).bind(...siteIds));
  statements.push(env.DB.prepare(`DELETE FROM names WHERE site_id IN (${marks})`).bind(...siteIds));
  statements.push(env.DB.prepare(`DELETE FROM dns_names WHERE site_id IN (${marks})`).bind(...siteIds));
  statements.push(env.DB.prepare(`DELETE FROM proxy_media WHERE site_id IN (${marks})`).bind(...siteIds));
  statements.push(env.DB.prepare(`DELETE FROM proxy_sites WHERE site_id IN (${marks})`).bind(...siteIds));
  statements.push(env.DB.prepare(`DELETE FROM site_custody WHERE site_id IN (${marks})`).bind(...siteIds));
 }
 statements.push(
  env.DB.prepare('DELETE FROM media WHERE owner_id=? OR site_id IN (SELECT id FROM sites WHERE user_id=?)').bind(userId,userId),
  env.DB.prepare('DELETE FROM quick_links WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM notifications WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM contact_requests WHERE from_id=? OR to_id=?').bind(userId,userId),
  env.DB.prepare('DELETE FROM blocks WHERE user_id=? OR blocked_id=?').bind(userId,userId),
  env.DB.prepare('DELETE FROM user_services WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM entitlement_sources WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM wallets WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM consent_records WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId),
  env.DB.prepare('DELETE FROM devices WHERE user_id=?').bind(userId),
  env.DB.prepare("UPDATE deletion_requests SET user_id=0,reason='',status='destroyed',executed_at=?,blocked_reason=NULL WHERE id=?").bind(now(),requestId),
 );
 if(siteIds.length)statements.push(env.DB.prepare(`DELETE FROM sites WHERE id IN (${siteIds.map(()=>'?').join(',')})`).bind(...siteIds));
 statements.push(env.DB.prepare('DELETE FROM users WHERE id=?').bind(userId));
 await env.DB.batch(statements);
 await appendAudit(env,null,'privacy.deletion.executed',`request:${requestId}`,{deleted:true,siteCount:sites.length,mediaCount:media.length,conversationCount:conversations.length});
 return {status:'destroyed' as const,siteCount:sites.length,mediaCount:media.length};
}

/** Creates a documented lifecycle record. Immediate destruction is allowed only after an explicit affirmation and a no-hold check. */
export async function requestDeletionLifecycle(c:Ctx,action:LifecycleAction,reason:string,scheduledFor:number|undefined,affirmation:boolean){
 const user=me(c); if(user.role==='owner')throw new HTTPException(409,{message:'حذف حساب المالك يتطلب إجراء حوكمة خارجي ونقل المسؤولية أولاً'});
 fresh(c);
 if(!['hide','archive','schedule','destroy'].includes(action))throw new HTTPException(422,{message:'خيار الإتلاف غير صحيح'});
 if((action==='destroy'||action==='schedule')&&!affirmation)throw new HTTPException(422,{message:'يلزم تأكيد صريح: نعم، أريد تنفيذ هذا الإجراء'});
 if(action==='schedule'&&(!scheduledFor||scheduledFor<=now()))throw new HTTPException(422,{message:'اختر تاريخاً مستقبلياً للإتلاف المجدول'});
 const at=now(); const id=uid(); const notice=await setting<string>(c,'privacy_notice_version','2026-10-31');
 const existing=await one<{id:string;status:string}>(c,"SELECT id,status FROM deletion_requests WHERE user_id=? AND status IN ('pending','scheduled','hidden','archived') ORDER BY created_at DESC LIMIT 1",user.id);
 if(existing)return {request:{id:existing.id,status:existing.status},idempotent:true};
 await hidePublicPresence(c,user.id,at);
 await c.env.DB.prepare("UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND purpose IN ('public_profile','contact') AND withdrawn_at IS NULL").bind(at,user.id).run();
 const status=action==='hide'?'hidden':action==='archive'?'archived':action==='schedule'?'scheduled':'pending';
 await run(c,'INSERT INTO deletion_requests(id,user_id,reason,status,created_at,requested_action,scheduled_for,hidden_at,archived_at,notice_version) VALUES(?,?,?,?,?,?,?,?,?,?)',id,user.id,reason,status,at,action,scheduledFor??null,at,action==='archive'?at:null,notice);
 await audit(c,'privacy.deletion.request',`request:${id}`,{action,scheduled:Boolean(scheduledFor),noticeVersion:notice,reasonProvided:Boolean(reason)});
 if(action==='destroy')return {request:{id,status:'pending'},idempotent:false,...await destroyEligibleAccount(c.env,user.id,id,'member-request')};
 return {request:{id,status,createdAt:at,scheduledFor:scheduledFor??null},idempotent:false};
}

async function purgeMedia(env:Env){
 const rows=(await env.DB.prepare("SELECT id,bucket_key FROM media_purge_queue WHERE status IN ('pending','failed') ORDER BY created_at LIMIT 100").all<{id:string;bucket_key:string}>()).results;
 let deleted=0,failed=0;
 for(const row of rows){try{await env.MEDIA.delete(row.bucket_key);await env.DB.prepare("UPDATE media_purge_queue SET status='deleted',attempts=attempts+1,last_error=NULL,completed_at=? WHERE id=?").bind(now(),row.id).run();deleted++;}catch(error){await env.DB.prepare("UPDATE media_purge_queue SET status='failed',attempts=attempts+1,last_error=? WHERE id=?").bind(safeError(error),row.id).run();failed++;}}
 return {deleted,failed};
}

async function purgeExpiredConversations(env:Env){
 const retention=await env.DB.prepare("SELECT value FROM settings WHERE key='retention'").first<{value:string}>();
 let days=30;try{days=Number(JSON.parse(retention?.value??'{}').messagesDays??30);}catch{}
 const cutoff=now()-Math.max(1,Math.min(days,3650))*86400;
 const conversations=(await env.DB.prepare("SELECT c.id FROM conversations c WHERE c.status='expired' AND c.last_activity<? AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.conversation_id=c.id AND r.status<>'closed') LIMIT 100").bind(cutoff).all<{id:string}>()).results;
 if(!conversations.length)return {conversations:0,messages:0};
 let messageCount=0;
 for(const conversation of conversations){
  const messages=(await env.DB.prepare('SELECT id FROM messages WHERE conversation_id=?').bind(conversation.id).all<{id:string}>()).results;
  for(const message of messages)await tombstone(env,'message',message.id,undefined,'retention-cron');
  await tombstone(env,'conversation',conversation.id,undefined,'retention-cron');
  await env.DB.batch([env.DB.prepare('DELETE FROM messages WHERE conversation_id=?').bind(conversation.id),env.DB.prepare('DELETE FROM conversations WHERE id=?').bind(conversation.id)]);
  messageCount+=messages.length;
 }
 if(conversations.length)await appendAudit(env,null,'retention.expired_messages.purged','conversations',{conversationCount:conversations.length,messageCount});
 return {conversations:conversations.length,messages:messageCount};
}

/** Cron-only lifecycle: scheduled erasure, expired-message purge and retryable R2 deletion. */
export async function runDataLifecycle(env:Env){
 const due=(await env.DB.prepare("SELECT id,user_id FROM deletion_requests WHERE status='scheduled' AND scheduled_for IS NOT NULL AND scheduled_for<=? ORDER BY scheduled_for LIMIT 50").bind(now()).all<{id:string;user_id:number}>()).results;
 const destroyed=[] as string[];
 for(const request of due){const result=await destroyEligibleAccount(env,request.user_id,request.id,'scheduled-cron');if(result.status==='destroyed')destroyed.push(request.id);}
 const [messages,media]=await Promise.all([purgeExpiredConversations(env),purgeMedia(env)]);
 return {scheduledProcessed:due.length,destroyed:destroyed.length,expiredConversations:messages.conversations,expiredMessages:messages.messages,mediaPurged:media.deleted,mediaFailures:media.failed};
}

import {HTTPException} from 'hono/http-exception';
import type {App,Ctx} from './core';
import {all,audit,fresh,now,one,role,setting,uid} from './core';

type Scope='account'|'site';
type Site={id:string;user_id:number|null;draft_version:number;published_version:number;status:string};
async function impact(c:Ctx,scope:Scope,id:string){
 role(c,['owner']);
 if(scope==='account'&&!/^[1-9]\d*$/.test(id))throw new HTTPException(400,{message:'معرّف الحساب غير صحيح'});
 const account=scope==='account'?await one<{id:number;role:string;status:string}>(c,'SELECT id,role,status FROM users WHERE id=?',Number(id)):null;
 if(scope==='account'&&!account)throw new HTTPException(404,{message:'الحساب غير موجود'});
 if(account?.role==='owner')throw new HTTPException(409,{message:'لا يمكن إزالة حساب المشرف الرئيسي؛ انقل المسؤولية أولاً'});
 const sites=scope==='account'?await all<Site>(c,'SELECT id,user_id,draft_version,published_version,status FROM sites WHERE user_id=?',Number(id)):await all<Site>(c,'SELECT id,user_id,draft_version,published_version,status FROM sites WHERE id=?',id);
 if(scope==='site'&&!sites.length)throw new HTTPException(404,{message:'الموقع غير موجود'});
 const prior=await one<{deletion_request_id:string|null}>(c,'SELECT deletion_request_id FROM deleted_tombstones WHERE resource_type=? AND resource_id=? AND source=?',scope,id,'owner-erasure');
 const userId=scope==='account'?Number(id):sites[0].user_id;
 const holds=await all<{resource_type:string}>(c,`SELECT resource_type FROM retention_holds WHERE status='active' AND (user_id=? OR (resource_type=? AND resource_id=?) OR resource_id IN (${sites.map(()=>'?').join(',')||"''"}) OR (resource_type='media' AND resource_id IN (SELECT id FROM media WHERE site_id IN (${sites.map(()=>'?').join(',')||"''"}))))`,userId,scope,id,...sites.map(s=>s.id),...sites.map(s=>s.id));
 const openReport=userId?await one(c,"SELECT id FROM reports WHERE user_id=? AND status<>'closed' LIMIT 1",userId):null;
 const media=await all<{id:string;bucket_key:string}>(c,scope==='account'?'SELECT m.id,m.bucket_key FROM media m WHERE (m.owner_id=? OR m.site_id IN (SELECT id FROM sites WHERE user_id=?)) AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.receipt_id=m.id)':'SELECT m.id,m.bucket_key FROM media m WHERE m.site_id=? AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.receipt_id=m.id)',...(scope==='account'?[Number(id),Number(id)]:[id]));
 return {scope,id,account,sites,media,prior,holds:[...new Set(holds.map(h=>h.resource_type)),...(openReport?['open_report']:[])],userId};
}
export function registerOwnerErasure(app:App){
 app.get('/api/admin/erasure-records',async c=>{role(c,['owner']);fresh(c);return c.json({records:await all(c,"SELECT id,user_id,reason,status,created_at,executed_at,requested_action FROM deletion_requests WHERE requested_action IN ('owner-account','owner-site') ORDER BY created_at DESC LIMIT 100")});});
 for(const scope of ['account','site'] as const){
  const resource=scope==='account'?'users':'sites';
  app.get(`/api/admin/${resource}/:id/erasure-impact`,async c=>{const x=await impact(c,scope,c.req.param('id'));return c.json({scope,siteCount:x.sites.length,mediaCount:x.media.length,holdKinds:x.holds,alreadyErased:!!x.prior,versions:x.sites.map(s=>({id:s.id,draft:s.draft_version,published:s.published_version})),retained:['financial_records','audit_and_review_evidence','reference_identifiers'],mediaRemoval:'queued_after_explicit_confirmation'});});
  app.post(`/api/admin/${resource}/:id/erase`,async c=>{
   const actor=role(c,['owner']);fresh(c);
   const body=await c.req.json<{reason?:unknown;affirmation?:unknown;confirmation?:unknown;versions?:Array<{id:string;draft:number;published:number}>}>();
   const reason=typeof body.reason==='string'?body.reason.trim():'';
   if(reason.length<8||reason.length>1000||body.affirmation!==true||body.confirmation!==c.req.param('id'))throw new HTTPException(422,{message:'اكتب سبباً واضحاً، وأكد الإزالة بإدخال المعرّف المعروض'});
   const x=await impact(c,scope,c.req.param('id'));
   if(x.prior)return c.json({erased:true,idempotent:true,requestId:x.prior.deletion_request_id,retainedRecords:true,mediaRemoval:'queued_or_completed'});
   if(x.holds.length)throw new HTTPException(409,{message:'تعذر الإزالة لوجود حصانة احتفاظ أو بلاغ مفتوح. راجع السجل أولاً'});
   if(!Array.isArray(body.versions)||JSON.stringify(body.versions)!==JSON.stringify(x.sites.map(s=>({id:s.id,draft:s.draft_version,published:s.published_version}))))throw new HTTPException(409,{message:'تغيّرت بيانات الموقع؛ راجع أثر الإزالة من جديد قبل التأكيد'});
   const requestId=uid(),clock=now(),notice=await setting<string>(c,'privacy_notice_version','2026-11-08');
   await audit(c,'owner.erasure.requested',`${scope}:${x.id}`,{requestId,reason,scope,siteCount:x.sites.length,mediaCount:x.media.length,affirmation:true,retained:'financial,audit,review,reference-identifiers'});
   const gate='EXISTS(SELECT 1 FROM deletion_requests WHERE id=?)';
   const statements:D1PreparedStatement[]=[];
   const cas=x.sites.map(()=> 'EXISTS(SELECT 1 FROM sites WHERE id=? AND draft_version=? AND published_version=?)').join(' AND ');
   const alive=scope==='account'?'EXISTS(SELECT 1 FROM users WHERE id=? AND status<>\'deleted\')':'EXISTS(SELECT 1 FROM sites WHERE id=? AND status<>\'deleted\')';
   statements.push(c.env.DB.prepare(`INSERT INTO deletion_requests(id,user_id,reason,status,created_at,requested_action,executed_at,notice_version) SELECT ?,?,?,'destroyed',?,'owner-${scope}',?,? WHERE ${alive} ${cas?'AND '+cas:''}`).bind(requestId,x.userId??0,reason,clock,clock,notice,scope==='account'?Number(x.id):x.id,...x.sites.flatMap(s=>[s.id,s.draft_version,s.published_version])));
   const stone=(kind:string,key:string)=>statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO deleted_tombstones(resource_type,resource_id,deletion_request_id,deleted_at,source) SELECT ?,?,?,?,'owner-erasure' WHERE ${gate}`).bind(kind,key,requestId,clock,requestId));
   const update=(sql:string,...args:unknown[])=>statements.push(c.env.DB.prepare(sql+` AND ${gate}`).bind(...args,requestId));
   if(scope==='account')stone('account',x.id);
   for(const site of x.sites){
    stone('site',site.id);
    update("UPDATE subdomain_change_requests SET status='cancelled',decided_at=? WHERE site_id=? AND status='pending'",clock,site.id);
    // Freeze outstanding reviews without editing their immutable evidential snapshots.
    update("UPDATE reviews SET status='rejected',reason=?,reviewer_id=?,decided_at=? WHERE site_id=? AND status='pending'",'إزالة نهائية موثقة: '+reason,actor.id,clock,site.id);
    update("UPDATE sites SET user_id=NULL,manager_id=NULL,draft='{}',published=NULL,status='deleted',searchable=0,allow_contact=0,lock_hash=NULL,lock_message='',authorization=NULL,draft_version=draft_version+1,updated_at=? WHERE id=?",clock,site.id);
    update('UPDATE site_visibility SET visible=0,listed=0,indexable=0,updated_at=?,version=version+1 WHERE site_id=?',clock,site.id);
    update("UPDATE dns_names SET name='erased-'||lower(hex(randomblob(16))) WHERE site_id=?",site.id);
    update("UPDATE names SET name='erased-'||lower(hex(randomblob(16))) WHERE site_id=?",site.id);
    update("UPDATE quick_links SET revoked=1,payload='{}' WHERE json_extract(payload,'$.siteId')=?",site.id);
    update("UPDATE proxy_sites SET target_email='',authorization='',pending_name=NULL WHERE site_id=?",site.id);
    update("UPDATE handovers SET target_email='',status='rejected' WHERE site_id=? AND status='pending'",site.id);
   }
   for(const media of x.media){
    stone('media',media.id);
    statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO media_purge_queue(id,deletion_request_id,media_id,bucket_key,status,attempts,created_at) SELECT ?,?,?,?,'pending',0,? WHERE ${gate}`).bind(uid(),requestId,media.id,media.bucket_key,clock,requestId));
    update("UPDATE media SET public=0,bucket_key='erased/'||id WHERE id=?",media.id);
   }
   if(scope==='account'){
    const id=Number(x.id);
    update("UPDATE users SET status='deleted',email='erased-'||id||'@deleted.ksa.men',name='حساب محذوف',whatsapp='',pin_hash=NULL,role='user',financial=0,trial_until=0,entitlement_until=0,assigned_to=NULL,last_active=0 WHERE id=?",id);
    update("UPDATE sessions SET revoked=1,revocation_reason='owner-erasure',expires_at=? WHERE user_id=?",clock,id);
    update("UPDATE devices SET revoked=1,revocation_reason='owner-erasure',expires_at=? WHERE user_id=?",clock,id);
    update("UPDATE managed_accounts SET contact_email='' WHERE user_id=?",id);
    update("UPDATE managed_claim_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",clock,id);
    update("UPDATE quick_links SET revoked=1,payload='{}' WHERE user_id=?",id);
    update("UPDATE notifications SET title='',body='',read_at=? WHERE user_id=?",clock,id);
    update('UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND withdrawn_at IS NULL',clock,id);
   }
   try{const results=await c.env.DB.batch(statements);if(Number(results[0].meta.changes)!==1)throw new HTTPException(409,{message:'تغيّرت بيانات الحساب؛ أعد مراجعة أثر الإزالة'});}
   catch(error){if(error instanceof HTTPException)throw error;throw new HTTPException(409,{message:'لم تكتمل الإزالة؛ لم يطبّق التغيير الجزئي. حدّث السجل وراجع الحصانات'});}
   await audit(c,'owner.erasure.completed',`${scope}:${x.id}`,{requestId,reason,scope,siteCount:x.sites.length,mediaCount:x.media.length,retainedRecords:true,mediaRemoval:'queued'});
   return c.json({erased:true,idempotent:false,requestId,siteCount:x.sites.length,mediaCount:x.media.length,retainedRecords:true,mediaRemoval:'queued'});
  });
 }
}

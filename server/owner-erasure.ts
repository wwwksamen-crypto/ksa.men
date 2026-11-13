import {HTTPException} from 'hono/http-exception';
import type {App,Ctx} from './core';
import {all,audit,digest,now,one,role,setting,uid} from './core';
import {registerAuditExport} from './audit-export';

type Scope='account'|'account_only'|'site';
const accountScope=(scope:Scope)=>scope!=='site';
const resourceScope=(scope:Scope)=>scope==='site'?'site':'account';
function mediaSelection(scope:Scope,id:string){
 if(scope==='account_only')return {sql:'1=0',args:[] as unknown[]};
 if(scope==='account')return {sql:'(m.site_id IN (SELECT id FROM sites WHERE user_id=?) OR (m.owner_id=? AND m.site_id IS NULL))',args:[Number(id),Number(id)] as unknown[]};
 return {sql:'m.site_id=?',args:[id] as unknown[]};
}
type Site={id:string;user_id:number|null;draft_version:number;published_version:number;status:string};
async function impact(c:Ctx,scope:Scope,id:string){
 role(c,['owner']);
 if(accountScope(scope)&&!/^[1-9]\d*$/.test(id))throw new HTTPException(400,{message:'معرّف الحساب غير صحيح'});
 const account=accountScope(scope)?await one<{id:number;role:string;status:string}>(c,'SELECT id,role,status FROM users WHERE id=?',Number(id)):null;
 if(accountScope(scope)&&!account)throw new HTTPException(404,{message:'الحساب غير موجود'});
 if(account?.role==='owner')throw new HTTPException(409,{message:'لا يمكن إزالة حساب المشرف الرئيسي؛ انقل المسؤولية أولاً'});
 const sites=accountScope(scope)?await all<Site>(c,'SELECT id,user_id,draft_version,published_version,status FROM sites WHERE user_id=? ORDER BY id',Number(id)):await all<Site>(c,'SELECT id,user_id,draft_version,published_version,status FROM sites WHERE id=?',id);
 if(scope==='site'&&!sites.length)throw new HTTPException(404,{message:'الموقع غير موجود'});
 const prior=await one<{deletion_request_id:string|null;requested_action:string|null}>(c,"SELECT t.deletion_request_id,d.requested_action FROM deleted_tombstones t LEFT JOIN deletion_requests d ON d.id=t.deletion_request_id WHERE t.resource_type=? AND t.resource_id=? AND t.source=?",resourceScope(scope),id,'owner-erasure');
 const userId=accountScope(scope)?Number(id):sites[0].user_id;
 const holds=await all<{resource_type:string}>(c,`SELECT resource_type FROM retention_holds WHERE status='active' AND (user_id=? OR (resource_type=? AND resource_id=?) OR resource_id IN (${sites.map(()=>'?').join(',')||"''"}) OR (resource_type='media' AND resource_id IN (SELECT id FROM media WHERE site_id IN (${sites.map(()=>'?').join(',')||"''"}))))`,userId,resourceScope(scope),id,...sites.map(s=>s.id),...sites.map(s=>s.id));
 const openReport=userId?await one(c,"SELECT id FROM reports WHERE user_id=? AND status<>'closed' LIMIT 1",userId):null;
 const selection=mediaSelection(scope,id);
 const media=await all<{id:string;bucket_key:string}>(c,`SELECT m.id,m.bucket_key FROM media m WHERE ${selection.sql} AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.receipt_id=m.id)`,...selection.args);
 const impactToken=await digest(JSON.stringify({scope,id,account,sites,media:media.slice().sort((a,b)=>a.id.localeCompare(b.id))}));
 return {impactToken,scope,id,account,sites,media,prior,holds:[...new Set(holds.map(h=>h.resource_type)),...(openReport?['open_report']:[])],userId};
}
export function registerOwnerErasure(app:App){
 registerAuditExport(app);
 app.get('/api/admin/retained-sites',async c=>{
  role(c,['owner']);
  const sites=await all<{id:string;name:string|null;title:string|null;status:string}>(c,"SELECT s.id,n.name,json_extract(s.draft,'$.name') AS title,s.status FROM sites s LEFT JOIN dns_names n ON n.site_id=s.id WHERE s.user_id IS NULL AND s.status<>'deleted' ORDER BY s.updated_at DESC");
  return c.json({sites:sites.map(site=>({...site,url:site.name?'https://'+site.name+'.'+c.env.ROOT_DOMAIN:null}))});
 });

 app.get('/api/admin/erasure-records',async c=>{
  role(c,['owner']);
  const records=await all(c,`SELECT d.id,d.user_id,d.reason,d.status,d.created_at,d.executed_at,d.requested_action,
   a.actor_id,u.name AS actor_name,a.target,a.row_hash AS evidence_hash,
   (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id) AS files_total,
   (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id AND q.status='deleted') AS files_removed,
   (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id AND q.status='failed') AS files_failed
   FROM deletion_requests d LEFT JOIN audit a ON a.id=(SELECT MIN(a2.id) FROM audit a2 WHERE a2.action='owner.erasure.requested' AND json_valid(a2.detail) AND json_extract(a2.detail,'$.requestId')=d.id)
   LEFT JOIN users u ON u.id=a.actor_id WHERE d.requested_action IN ('owner-account','owner-account_only','owner-site') ORDER BY d.created_at DESC LIMIT 100`);
  return c.json({records});
 });
 for(const routeScope of ['account','site'] as const){
  const scope=routeScope;
  const resource=scope==='account'?'users':'sites';
  app.get(`/api/admin/${resource}/:id/erasure-impact`,async c=>{
   const actualScope:Scope=scope==='account'&&c.req.query('mode')==='account_only'?'account_only':scope;
   const x=await impact(c,actualScope,c.req.param('id'));
   await audit(c,'owner.erasure.reviewed',`${resourceScope(actualScope)}:${x.id}`,{scope:actualScope,siteCount:actualScope==='account_only'?0:x.sites.length,mediaCount:x.media.length,blocked:!!x.holds.length,alreadyErased:!!x.prior});
   return c.json({scope:actualScope,impactToken:x.impactToken,siteCount:actualScope==='account_only'?0:x.sites.length,retainedSiteCount:actualScope==='account_only'?x.sites.length:0,mediaCount:x.media.length,holdKinds:x.holds,alreadyErased:!!x.prior,versions:x.sites.map(s=>({id:s.id,draft:s.draft_version,published:s.published_version})),retained:['financial_records','audit_and_review_evidence','reference_identifiers'],mediaRemoval:'queued_after_explicit_confirmation'});
  });
  app.post(`/api/admin/${resource}/:id/erase`,async c=>{
   try { role(c,['owner']); }
   catch(error) { if(c.get('user')?.status==='active')await audit(c,'owner.erasure.denied',`${scope}:${c.req.param('id')}`,{scope,outcome:'not-executed'});throw error; }
   const actor=role(c,['owner']);
   const body=await c.req.json<{mode?:unknown;reason?:unknown;affirmation?:unknown;confirmation?:unknown;impactToken?:unknown;versions?:Array<{id:string;draft:number;published:number}>}>();
   const actualScope:Scope=routeScope==='account'&&body.mode==='account_only'?'account_only':routeScope;
   const reason=typeof body.reason==='string'?body.reason.trim():'';
   if(!reason.length||reason.length>1000||body.affirmation!==true||body.confirmation!==c.req.param('id')||body.mode!==undefined&&(body.mode!=='account_only'||routeScope!=='account')){await audit(c,'owner.erasure.invalid',`${scope}:${c.req.param('id')}`,{scope,outcome:'not-executed'});throw new HTTPException(422,{message:'اكتب سبب الحذف وحدد الهدف الصحيح'});}
   let x:Awaited<ReturnType<typeof impact>>;
   try{x=await impact(c,actualScope,c.req.param('id'));}catch(error){await audit(c,'owner.erasure.blocked',`${scope}:${c.req.param('id')}`,{scope,outcome:'not-executed'});throw error;}
   if(x.prior&&x.prior.requested_action==='owner-account_only'&&actualScope==='account')throw new HTTPException(409,{message:'حُذف الحساب سابقاً مع إبقاء المواقع؛ احذف الموقع المطلوب مباشرة من إدارته'});
   if(x.prior){await audit(c,'owner.erasure.repeated',`${scope}:${x.id}`,{scope,requestId:x.prior.deletion_request_id,outcome:'no-new-effect'});return c.json({erased:true,idempotent:true,requestId:x.prior.deletion_request_id,retainedRecords:true,mediaRemoval:'queued_or_completed'});}
   if(x.holds.length){await audit(c,'owner.erasure.blocked',`${scope}:${x.id}`,{scope,holdKinds:x.holds,outcome:'not-executed'});throw new HTTPException(409,{message:'تعذر الإزالة لوجود حصانة احتفاظ أو بلاغ مفتوح. راجع السجل أولاً'});}
   if(body.impactToken!==x.impactToken||!Array.isArray(body.versions)||JSON.stringify(body.versions)!==JSON.stringify(x.sites.map(s=>({id:s.id,draft:s.draft_version,published:s.published_version})))){await audit(c,'owner.erasure.conflict',`${scope}:${x.id}`,{scope,outcome:'not-executed'});throw new HTTPException(409,{message:'تغيّرت البيانات؛ اضغط الحذف مجدداً لتأكيد البيانات الحالية'});}
   const requestId=uid(),clock=now(),notice=await setting<string>(c,'privacy_notice_version','2026-11-08');
   await audit(c,'owner.erasure.requested',`${scope}:${x.id}`,{requestId,reason,scope:actualScope,siteCount:x.sites.length,mediaCount:x.media.length,affirmation:true,retained:'financial,audit,review,reference-identifiers'});
   const gate='EXISTS(SELECT 1 FROM deletion_requests WHERE id=?)';
   const statements:D1PreparedStatement[]=[];
   const cas=x.sites.map(()=> 'EXISTS(SELECT 1 FROM sites WHERE id=? AND draft_version=? AND published_version=? AND user_id IS ?)').join(' AND ');
   const alive=accountScope(actualScope)?'EXISTS(SELECT 1 FROM users WHERE id=? AND status<>\'deleted\' AND role<>\'owner\')':'EXISTS(SELECT 1 FROM sites WHERE id=? AND status<>\'deleted\')';
   // The same transaction rechecks full site membership, open reports, active holds and the confirmed media set.
   const siteSet=accountScope(actualScope)?'(SELECT COUNT(*) FROM sites WHERE user_id=?)=?':'1=1';
   const selectedMedia=mediaSelection(actualScope,x.id);
   const mediaSource=selectedMedia.sql,mediaArgs=selectedMedia.args;
   const mediaCount=`(SELECT COUNT(*) FROM media m WHERE ${mediaSource} AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.receipt_id=m.id))=?`;
   const mediaCas=x.media.map(()=> 'EXISTS(SELECT 1 FROM media WHERE id=? AND bucket_key=?)').join(' AND ');
   const siteIds=x.sites.map(s=>s.id),slots=siteIds.map(()=>'?').join(',')||"''";
   const unheld=`NOT EXISTS(SELECT 1 FROM retention_holds WHERE status='active' AND (user_id=? OR (resource_type=? AND resource_id=?) OR resource_id IN (${slots}) OR (resource_type='media' AND resource_id IN (SELECT id FROM media WHERE site_id IN (${slots})))))`;
   statements.push(c.env.DB.prepare(`INSERT INTO deletion_requests(id,user_id,reason,status,created_at,requested_action,executed_at,notice_version) SELECT ?,?,?,'destroyed',?,'owner-${actualScope}',?,? WHERE ${alive} ${cas?'AND '+cas:''} AND ${siteSet} AND ${mediaCount} ${mediaCas?'AND '+mediaCas:''} AND ${unheld} AND NOT EXISTS(SELECT 1 FROM reports WHERE user_id=? AND status<>'closed')`).bind(requestId,x.userId??0,reason,clock,clock,notice,accountScope(actualScope)?Number(x.id):x.id,...x.sites.flatMap(s=>[s.id,s.draft_version,s.published_version,s.user_id]),...(accountScope(actualScope)?[Number(x.id),x.sites.length]:[]),...mediaArgs,x.media.length,...x.media.flatMap(m=>[m.id,m.bucket_key]),x.userId,resourceScope(actualScope),x.id,...siteIds,...siteIds,x.userId));
   const stone=(kind:string,key:string)=>statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO deleted_tombstones(resource_type,resource_id,deletion_request_id,deleted_at,source) SELECT ?,?,?,?,'owner-erasure' WHERE ${gate}`).bind(kind,key,requestId,clock,requestId));
   const update=(sql:string,...args:unknown[])=>statements.push(c.env.DB.prepare(sql+` AND ${gate}`).bind(...args,requestId));
   if(accountScope(actualScope))stone('account',x.id);
   for(const site of x.sites){
    if(actualScope==='account_only'){
     update("UPDATE subdomain_change_requests SET status='cancelled',decided_at=? WHERE site_id=? AND status='pending'",clock,site.id);
     update("UPDATE reviews SET status='rejected',reason=?,reviewer_id=?,decided_at=? WHERE site_id=? AND status='pending'",'حذف حساب مع إبقاء موقعه بإدارة المشرف: '+reason,actor.id,clock,site.id);
     update('UPDATE sites SET user_id=NULL,manager_id=?,updated_at=? WHERE id=?',actor.id,clock,site.id);
     update('UPDATE dns_names SET owner_id=? WHERE site_id=?',actor.id,site.id);
     continue;
    }
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
   if(accountScope(actualScope)){
    const id=Number(x.id);
    if(actualScope==='account_only')update("UPDATE media SET owner_id=? WHERE owner_id=? AND purpose<>'receipt'",actor.id,id);
    update("UPDATE users SET status='deleted',email='erased-'||id||'@deleted.ksa.men',name='حساب محذوف',whatsapp='',pin_hash=NULL,role='user',financial=0,trial_until=0,entitlement_until=0,assigned_to=NULL,last_active=0 WHERE id=?",id);
    update("UPDATE sessions SET revoked=1,revocation_reason='owner-erasure',expires_at=? WHERE user_id=?",clock,id);
    update("UPDATE devices SET revoked=1,revocation_reason='owner-erasure',expires_at=? WHERE user_id=?",clock,id);
    update("UPDATE managed_accounts SET contact_email='' WHERE user_id=?",id);
    update("UPDATE managed_claim_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL",clock,id);
    update("UPDATE quick_links SET revoked=1,payload='{}' WHERE user_id=?",id);
    update("UPDATE notifications SET title='',body='',read_at=? WHERE user_id=?",clock,id);
    update('UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND withdrawn_at IS NULL',clock,id);
   }
   try{const results=await c.env.DB.batch(statements);if(Number(results[0].meta.changes)!==1)throw new HTTPException(409,{message:'تغيّرت بيانات الحساب؛ اضغط الحذف مجدداً لتأكيد البيانات الحالية'});}
   catch(error){await audit(c,error instanceof HTTPException?'owner.erasure.conflict':'owner.erasure.failed',`${scope}:${x.id}`,{requestId,scope,outcome:'not-executed'});if(error instanceof HTTPException)throw error;throw new HTTPException(409,{message:'لم تكتمل الإزالة؛ لم يطبّق التغيير الجزئي. حدّث السجل وراجع الحصانات'});}
   let completionAudit='recorded';
   try{await audit(c,'owner.erasure.completed',`${scope}:${x.id}`,{requestId,reason,scope:actualScope,siteCount:actualScope==='account_only'?0:x.sites.length,retainedSiteCount:actualScope==='account_only'?x.sites.length:0,mediaCount:x.media.length,retainedRecords:true,mediaRemoval:actualScope==='account_only'?'retained_with_sites':'queued'});}
   catch{completionAudit='not_recorded';} // The atomic request and requested audit row already prove the committed decision. Never report a rollback after commit.
   return c.json({erased:true,idempotent:false,requestId,completionAudit,evidenceDurable:true,siteCount:actualScope==='account_only'?0:x.sites.length,retainedSiteCount:actualScope==='account_only'?x.sites.length:0,mediaCount:x.media.length,retainedRecords:true,mediaRemoval:actualScope==='account_only'?'retained_with_sites':'queued'});
  });
 }
}

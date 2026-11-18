import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { App, Ctx } from './core';
import { all, audit, fresh, hmac, me, now, one, rate, role, run, uid, withdrawConsent } from './core';
import { hideMyPublicPresence } from './lifecycle';
import { privacyPolicy, processPrivacyJobs, privateFileHash } from './privacy-jobs';
import { MAX_PRIVATE_EXPORT_BYTES } from './privacy-export';
import type { PrivacyRequest } from '../shared/privacy-rights';

function fail(status:400|404|409|410|503,message:string):never {throw new HTTPException(status,{message});}
const requestSchema=z.object({type:z.enum(['export','correction','erasure','objection']),message:z.string().trim().max(2000).default(''),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/)}).strict();
const replySchema=z.object({status:z.enum(['reviewing','answered','blocked','rejected']),response:z.string().trim().min(3).max(2000),expectedRevision:z.number().int().positive()}).strict();
const selection='r.id,r.type,r.status,r.public_response,r.created_at,r.updated_at,r.due_at,a.expires_at';
function present(row:any):PrivacyRequest {
  const expired=row.type==='export'&&row.status==='ready'&&(!row.expires_at||row.expires_at<=now());
  return {id:row.id,type:row.type,status:expired?'expired':row.status,response:row.public_response||'',createdAt:row.created_at,updatedAt:row.updated_at,dueAt:row.due_at,expiresAt:row.expires_at||null,downloadable:row.status==='ready'&&!expired};
}
async function enabled(c:Ctx){const policy=await privacyPolicy(c.env);if(!policy.enabled)fail(503,'طلبات البيانات متاحة عبر الدعم حالياً');return policy;}
async function ownRequest(c:Ctx,id:string) {const u=me(c);const row=await one<any>(c,`SELECT ${selection},r.message,r.policy_version FROM privacy_requests r LEFT JOIN privacy_export_artifacts a ON a.request_id=r.id AND a.user_id=r.user_id WHERE r.id=? AND r.user_id=?`,id,u.id);if(!row)fail(404,'الطلب غير موجود');return row;}
function noStore(c:Ctx){c.header('Cache-Control','private, no-store');c.header('X-Robots-Tag','noindex, nofollow');}
async function requestPage(c:Ctx,userId:number,cursor='') {
  const match=cursor.match(/^(\d{1,12}):([A-Za-z0-9_-]{8,100})$/);if(cursor&&!match)fail(400,'حدّث قائمة طلباتك');
  const clock=match?Number(match[1]):0,id=match?.[2]||'';
  const rows=await all<any>(c,`SELECT ${selection} FROM privacy_requests r LEFT JOIN privacy_export_artifacts a ON a.request_id=r.id AND a.user_id=r.user_id
    WHERE r.user_id=? AND (?=0 OR r.created_at<? OR (r.created_at=? AND r.id<?)) ORDER BY r.created_at DESC,r.id DESC LIMIT 26`,userId,clock,clock,clock,id);
  const first=rows.slice(0,25),last=first.at(-1);
  return {requests:first.map(present),nextBefore:rows.length>25&&last?`${last.created_at}:${last.id}`:null};
}

export function registerPrivacy(app:App) {
  app.get('/api/privacy/summary',async c=>{
    const u=me(c);noStore(c);const policy=await privacyPolicy(c.env);
    const records=await all<any>(c,'SELECT id,purpose,notice_version,granted_at,withdrawn_at FROM consent_records WHERE user_id=? ORDER BY granted_at DESC,id DESC LIMIT 100',u.id);
    const consents=records.map(r=>({id:r.id,purpose:r.purpose,noticeVersion:r.notice_version,grantedAt:r.granted_at,withdrawnAt:r.withdrawn_at}));
    if(!policy.enabled)return c.json({enabled:false,policyVersion:null,requests:[],consents});
    const page=await requestPage(c,u.id);
    return c.json({enabled:true,policyVersion:policy.policyVersion,...page,consents});
  });
  app.get('/api/privacy/requests',async c=>{
    const u=me(c);noStore(c);await enabled(c);return c.json(await requestPage(c,u.id,c.req.query('before')||''));
  });
  app.post('/api/privacy/requests',async c=>{
    const u=me(c);fresh(c);noStore(c);const policy=await enabled(c);const body=requestSchema.parse(await c.req.json());
    if(body.type!=='export'&&body.message.length<3)fail(400,'اكتب توضيحاً مختصراً لطلبك');
    if(body.type==='export'&&body.message)fail(400,'طلب النسخة لا يحتاج بيانات إضافية');
    const payload=await hmac(c.env.AUTH_SECRET,body.type+'\n'+body.message),clock=now();
    const existing=await one<any>(c,'SELECT id,payload_hash FROM privacy_requests WHERE user_id=? AND idempotency_key=?',u.id,body.idempotencyKey);
    if(existing){if(existing.payload_hash!==payload)fail(409,'تغيّرت تفاصيل الطلب؛ سجله كطلب جديد');return c.json({request:present(await ownRequest(c,existing.id)),idempotent:true});}
    if(body.type==='export') {
      await run(c,`UPDATE privacy_requests SET status='expired',updated_at=? WHERE user_id=? AND type='export' AND status='ready'
        AND NOT EXISTS(SELECT 1 FROM privacy_export_artifacts a WHERE a.request_id=privacy_requests.id AND a.user_id=? AND a.expires_at>?)`,clock,u.id,u.id,clock);
      const active=await one<{id:string}>(c,"SELECT id FROM privacy_requests WHERE user_id=? AND type='export' AND status IN ('received','processing','ready')",u.id);
      if(active)return c.json({request:present(await ownRequest(c,active.id)),idempotent:true});
    }
    await rate(c,'privacy-request:'+u.id,5,86400);
    const id=uid(),jobId=uid(),dueAt=clock+policy.responseDays*86400;
    const statements=[
      c.env.DB.prepare(`INSERT OR IGNORE INTO privacy_requests(id,user_id,type,message,idempotency_key,payload_hash,policy_version,due_at,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')
        AND NOT EXISTS(SELECT 1 FROM deleted_tombstones WHERE resource_type='account' AND resource_id=?)`)
        .bind(id,u.id,body.type,body.message,body.idempotencyKey,payload,policy.policyVersion,dueAt,clock,clock,u.id,String(u.id)),
      c.env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at) SELECT ?,?,?, 'received','request_received',? WHERE EXISTS(SELECT 1 FROM privacy_requests WHERE id=?)`).bind(uid(),id,u.id,clock,id),
    ];
    if(body.type==='export')statements.push(c.env.DB.prepare(`INSERT INTO operational_jobs(id,request_id,kind,next_attempt_at,created_at)
      SELECT ?,?,'privacy_export',?,? WHERE EXISTS(SELECT 1 FROM privacy_requests WHERE id=?)`).bind(jobId,id,clock,clock,id));
    await c.env.DB.batch(statements);
    const saved=await one<any>(c,'SELECT id,payload_hash FROM privacy_requests WHERE id=? OR (user_id=? AND (idempotency_key=? OR (type=\'export\' AND status IN (\'received\',\'processing\',\'ready\') AND ?=\'export\')))',id,u.id,body.idempotencyKey,body.type);
    if(!saved)fail(409,'تغيّر وضع الحساب قبل تسجيل الطلب');
    if(saved.payload_hash!==payload)fail(409,'تغيّرت تفاصيل الطلب؛ سجل طلباً جديداً');
    const result=present(await ownRequest(c,saved.id));
    if(saved.id===id)await audit(c,'privacy.request.received',`privacy:${id}`,{type:body.type,policyVersion:policy.policyVersion});
    if(body.type==='export') {
      try {const ctx=c.executionCtx;if(typeof ctx.waitUntil==='function')ctx.waitUntil(processPrivacyJobs(c.env,saved.id).catch(()=>console.warn('Private export background work requires follow-up')));}
      catch { /* A native Cron resumes saved jobs. Never mark a response ready here. */ }
    }
    return c.json({request:result,idempotent:saved.id!==id},saved.id===id?201:200);
  });
  app.get('/api/privacy/requests/:id',async c=>{
    me(c);noStore(c);await enabled(c);const row=await ownRequest(c,c.req.param('id'));
    const events=(await all<any>(c,'SELECT status,event_code,created_at FROM privacy_request_events WHERE request_id=? ORDER BY created_at,id LIMIT 100',row.id)).map(r=>({status:r.status,code:r.event_code,createdAt:r.created_at}));
    return c.json({request:present(row),message:row.message,policyVersion:row.policy_version,events});
  });
  app.get('/api/privacy/requests/:id/download',async c=>{
    const u=me(c);fresh(c);noStore(c);await enabled(c);const row=await ownRequest(c,c.req.param('id'));
    if(!present(row).downloadable)fail(row.status==='ready'?410:409,'النسخة غير متاحة للتنزيل؛ راجع حالة طلبك');
    const file=await one<any>(c,'SELECT bucket_key,sha256,bytes,expires_at FROM privacy_export_artifacts WHERE request_id=? AND user_id=? AND expires_at>?',row.id,u.id,now());
    if(!file)fail(410,'انتهت مهلة تنزيل هذه النسخة');
    const stored=await c.env.MEDIA.get(file.bucket_key);
    if(!stored||stored.size!==file.bytes||stored.size>MAX_PRIVATE_EXPORT_BYTES)fail(503,'تعذر قراءة النسخة المحفوظة؛ طلبك باقٍ للمتابعة');
    const bytes=new Uint8Array(await stored.arrayBuffer());if(await privateFileHash(bytes)!==file.sha256)fail(503,'تعذر التحقق من النسخة؛ طلبك باقٍ للمتابعة');
    // Ownership/removal/expiry may have changed during the R2 read. Recheck just before delivery.
    const live=await one(c,`SELECT r.id FROM privacy_requests r JOIN users u ON u.id=r.user_id JOIN sessions s ON s.user_id=u.id
      WHERE r.id=? AND r.user_id=? AND r.status='ready' AND u.status='active' AND s.id=? AND s.revoked=0 AND s.expires_at>?
      AND NOT EXISTS(SELECT 1 FROM deleted_tombstones WHERE resource_type='account' AND resource_id=CAST(u.id AS TEXT))`,row.id,u.id,c.get('session')?.id,now());
    if(!live||file.expires_at<=now())fail(410,'لم يعد التنزيل متاحاً');
    c.header('Content-Type','application/json; charset=utf-8');c.header('Content-Disposition','attachment; filename="ksa-men-my-data.json"');c.header('Content-Length',String(bytes.byteLength));
    return c.body(bytes);
  });
  app.post('/api/privacy/consents/:purpose/withdraw',async c=>{
    const u=me(c);noStore(c);await enabled(c);const purpose=c.req.param('purpose');
    if(purpose==='public_profile'){await hideMyPublicPresence(c);return c.json({withdrawn:true,publicHidden:true});}
    if(purpose==='translation'){await withdrawConsent(c,'translation','privacy-panel');return c.json({withdrawn:true});}
    if(purpose==='contact') {
      const clock=now();
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE sites SET allow_contact=0,updated_at=? WHERE user_id=? AND status NOT IN ('deleted','deletion_pending')").bind(clock,u.id),
        c.env.DB.prepare(`INSERT INTO site_visibility(site_id,hidden_fields,updated_at,updated_by)
          SELECT id,'["allowContact"]',?,? FROM sites WHERE user_id=? AND status NOT IN ('deleted','deletion_pending')
          ON CONFLICT(site_id) DO UPDATE SET hidden_fields=CASE WHEN EXISTS(SELECT 1 FROM json_each(site_visibility.hidden_fields) WHERE value='allowContact') THEN site_visibility.hidden_fields ELSE json_insert(site_visibility.hidden_fields,'$[#]','allowContact') END,
          version=site_visibility.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(clock,u.id,u.id),
        c.env.DB.prepare("UPDATE consent_records SET withdrawn_at=? WHERE user_id=? AND purpose='contact' AND withdrawn_at IS NULL").bind(clock,u.id),
      ]);
      await audit(c,'consent.withdrawn','consent:contact',{purpose,source:'privacy-panel'});return c.json({withdrawn:true});
    }
    fail(400,'هذا الغرض يُدار من إعدادات الخدمة أو بطلب حقوق مستقل');
  });
  app.get('/api/admin/privacy/requests',async c=>{
    role(c,['owner']);fresh(c);noStore(c);const policy=await privacyPolicy(c.env);if(!policy.enabled)return c.json({enabled:false,requests:[]});
    const cursor=c.req.query('after')||'',match=cursor.match(/^(\d{1,12}):([A-Za-z0-9_-]{8,100})$/);if(cursor&&!match)fail(400,'حدّث قائمة الطلبات');
    const after=match?Number(match[1]):0,lastId=match?.[2]||'';
    const rows=await all<any>(c,`SELECT r.id,r.user_id,r.type,r.status,r.due_at,r.created_at,r.updated_at,u.name
      FROM privacy_requests r LEFT JOIN users u ON u.id=r.user_id WHERE (?=0 OR r.due_at>? OR (r.due_at=? AND r.id>?)) ORDER BY r.due_at,r.id LIMIT 26`,after,after,after,lastId);
    const requests=rows.slice(0,25),last=requests.at(-1);
    return c.json({enabled:true,requests:requests.map(r=>({id:r.id,subjectId:r.user_id,name:r.name||'',type:r.type,status:r.status,dueAt:r.due_at,createdAt:r.created_at,updatedAt:r.updated_at})),nextAfter:rows.length>25&&last?`${last.due_at}:${last.id}`:null});
  });
  app.get('/api/admin/privacy/requests/:id',async c=>{
    role(c,['owner']);fresh(c);noStore(c);await enabled(c);
    const r=await one<any>(c,'SELECT id,user_id,type,status,message,public_response,policy_version,assigned_to,due_at,created_at,updated_at,revision FROM privacy_requests WHERE id=?',c.req.param('id'));if(!r)fail(404,'الطلب غير موجود');
    return c.json({request:{id:r.id,subjectId:r.user_id,type:r.type,status:r.status,message:r.message,response:r.public_response,policyVersion:r.policy_version,dueAt:r.due_at,createdAt:r.created_at,updatedAt:r.updated_at,revision:r.revision}});
  });
  app.post('/api/admin/privacy/requests/:id/reply',async c=>{
    const actor=role(c,['owner']);fresh(c);noStore(c);await enabled(c);const body=replySchema.parse(await c.req.json()),id=c.req.param('id'),clock=now();
    const results=await c.env.DB.batch([
      c.env.DB.prepare("UPDATE privacy_requests SET status=?,public_response=?,assigned_to=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND user_id IS NOT NULL AND type<>'export' AND status IN ('received','reviewing','blocked')").bind(body.status,body.response,actor.id,clock,id,body.expectedRevision),
      c.env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at) SELECT ?,?,?,?,'administrator_reply',? WHERE changes()=1`).bind(uid(),id,actor.id,body.status,clock),
    ]);
    if(!Number(results[0]?.meta?.changes))fail(409,'تغيّرت حالة الطلب أو يحتاج مسار تجهيز مستقلاً');
    await audit(c,'privacy.request.reply',`privacy:${id}`,{status:body.status});return c.json({saved:true});
  });
}

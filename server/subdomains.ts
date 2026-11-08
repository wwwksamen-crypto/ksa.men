import { HTTPException } from 'hono/http-exception';
import type { App, Ctx } from './core';
import { all, audit, now, one, rate, role, run, siteFor, uid, recordConsent } from './core';
import { publicationProfile } from './business';
import { draftWithIdentities } from '../shared/profile-visibility';
import { normalizeSubdomain, safeRedirectTarget } from '../shared/subdomains';
import { submissionNotice } from './publication-notice';
function candidate(c: Ctx, value: unknown) { try { return normalizeSubdomain(value, c.env.ROOT_DOMAIN); } catch (e) { throw new HTTPException(400, {message: (e as Error).message}); } }
function target(c: Ctx, value: unknown, name: string) { try { return safeRedirectTarget(value, name, c.env.ROOT_DOMAIN); } catch (e) { throw new HTTPException(400, {message: (e as Error).message}); } }
export async function pendingName(c: Ctx, siteId: string) { return one<{id:string;new_name:string;old_name:string;requested_version:number}>(c, "SELECT id,new_name,old_name,requested_version FROM subdomain_change_requests WHERE site_id=? AND status='pending'", siteId); }
async function assertAvailable(c: Ctx, name: string, siteId = '') {
  const conflict = await one(c, `SELECT name FROM dns_names WHERE name=? UNION ALL SELECT name FROM reserved_names WHERE name=? AND active=1 UNION ALL SELECT new_name AS name FROM subdomain_change_requests WHERE new_name=? AND status='pending' AND site_id<>? LIMIT 1`, name, name, name, siteId);
  if (conflict) throw new HTTPException(409, {message:'هذا الاسم محجوز أو بانتظار الاعتماد؛ اختر اسماً آخر'});
}
async function preventLoop(c: Ctx, name: string, destination: string) {
  const rows=await all<{name:string;target_url:string}>(c,'SELECT name,target_url FROM owner_subdomain_redirects WHERE active=1');
  const visited=new Set<string>([name]); let url=new URL(destination);
  for(let hop=0;hop<=rows.length;hop++) {
    if(!url.hostname.endsWith('.'+c.env.ROOT_DOMAIN) || url.pathname!=='/')return;
    const label=url.hostname.slice(0,-c.env.ROOT_DOMAIN.length-1);
    if(visited.has(label))throw new HTTPException(400,{message:'هذه الوجهة تنشئ حلقة تحويل؛ اختر رابطاً نهائياً'});
    visited.add(label);const next=rows.find(r=>r.name===label);if(!next)return;url=new URL(next.target_url);
  }
  throw new HTTPException(400,{message:'اختر وجهة نهائية دون سلسلة تحويل'});
}
export async function resolveOwnerRedirect(c: Ctx, name: string): Promise<string | null> {
  const row=await one<{target_url:string}>(c,`SELECT r.target_url FROM owner_subdomain_redirects r JOIN dns_names n ON n.name=r.name JOIN users u ON u.id=r.created_by WHERE r.name=? AND r.active=1 AND n.site_id IS NULL AND n.owner_id=r.created_by AND u.role='owner' AND u.status='active'`,name);
  if(!row)return null;return target(c,row.target_url,name);
}
export function registerSubdomains(app: App) {
  app.get('/api/sites/:id/name-change',async c=>{
    const site=await siteFor(c,c.req.param('id'));
    return c.json({pending:await pendingName(c,site.id)});
  });
  app.post('/api/sites/:id/name-change',async c=>{
    const site=await siteFor(c,c.req.param('id'));
    const actor=c.get('user')!;
    if(!site.user_id)throw new HTTPException(409,{message:'يلزم ربط الموقع بصاحب حساب قبل تغيير اسمه'});
    await rate(c,'name-change:'+site.id,12,3600);
    const body=await c.req.json<{name:unknown;version?:number;currentName?:unknown}>();const name=candidate(c,body.name);
    const named=await one<{name:string;owner_id:number}>(c,'SELECT name,owner_id FROM dns_names WHERE site_id=? ORDER BY created_at LIMIT 1',site.id);
    if(!named||named.owner_id!==site.user_id)throw new HTTPException(409,{message:'تغيّر ارتباط الاسم؛ حدّث موقعك ثم حاول مجدداً'});
    if(body.currentName!==undefined&&candidate(c,body.currentName)!==named.name)throw new HTTPException(409,{message:'اعتمد اسم أحدث على جهاز آخر؛ حدّث رابطك قبل أي طلب جديد'});
    const prior=await pendingName(c,site.id);
    const message='وصل طلبك. يبقى رابطك الحالي فعالاً حتى اعتماد الاسم الجديد ونشره؛ بعد الاعتماد يصبح الاسم السابق متاحاً للآخرين.';
    if(prior?.new_name===name && (body.version===prior.requested_version-1 || site.draft_version===prior.requested_version))return c.json({pending:prior,draftVersion:site.draft_version,idempotent:true,message});
    if(body.version!==site.draft_version)throw new HTTPException(409,{message:'هناك تعديل أحدث؛ احفظ أحدث نسخة ثم أعد طلب النشر'});
    if(name===named.name){
      if(prior){const result=await run(c,"UPDATE subdomain_change_requests SET status='cancelled',decided_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM dns_names WHERE name=? AND site_id=?)",now(),prior.id,named.name,site.id);if(!result.meta.changes)throw new HTTPException(409,{message:'اتخذ قرار بشأن الاسم؛ حدّث الحالة قبل إلغاء الطلب'});}
      await audit(c,'name.change.cancelled',site.id,{requestId:prior?.id||null});return c.json({cancelled:true,draftVersion:site.draft_version,message:'أُلغي طلب تغيير الاسم؛ رابطك الحالي باقٍ كما هو.'});
    }
    await assertAvailable(c,name,site.id);
    const account=await one<{name:string}>(c,'SELECT name FROM users WHERE id=?',site.user_id);
    const snapshot=JSON.stringify(publicationProfile(draftWithIdentities(JSON.parse(site.draft),site.published?JSON.parse(site.published):undefined),account?.name||''));
    const clock=now(),id=uid(),reviewId=uid(),version=site.draft_version+1;
    try {
      const results=await c.env.DB.batch([
        c.env.DB.prepare("UPDATE subdomain_change_requests SET status='cancelled',decided_at=? WHERE site_id=? AND status='pending' AND EXISTS(SELECT 1 FROM sites WHERE id=? AND draft_version=?)").bind(clock,site.id,site.id,site.draft_version),
        c.env.DB.prepare('UPDATE sites SET draft_version=draft_version+1,updated_at=? WHERE id=? AND draft_version=?').bind(clock,site.id,site.draft_version),
        c.env.DB.prepare(`INSERT INTO subdomain_change_requests(id,site_id,user_id,requested_by,old_name,new_name,requested_version,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`).bind(id,site.id,site.user_id,actor.id,named.name,name,version,clock),
        c.env.DB.prepare(`INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,kind,created_at) SELECT ?,?,?,?,?,?,'pending','content',? WHERE EXISTS(SELECT 1 FROM subdomain_change_requests WHERE id=?)`).bind(reviewId,site.id,site.user_id,snapshot,version,site.published_version,clock,id),
        c.env.DB.prepare("UPDATE sites SET status='pending' WHERE id=? AND published IS NULL AND EXISTS(SELECT 1 FROM subdomain_change_requests WHERE id=?)").bind(site.id,id),
      ]);
      if(results[2].meta.changes!==1||results[3].meta.changes!==1)throw new Error('Stale request');
    } catch {
      const replay=await pendingName(c,site.id);
      if(replay?.new_name===name&&body.version===replay.requested_version-1)return c.json({pending:replay,draftVersion:Number((await one<{draft_version:number}>(c,'SELECT draft_version FROM sites WHERE id=?',site.id))?.draft_version),idempotent:true,message});
      throw new HTTPException(409,{message:'تغيّر الملف أو حُجز الاسم أثناء الطلب. موقعك ورابطك الحالي محفوظان؛ حدّث الحالة ثم حاول مجدداً'});
    }
    await audit(c,'name.change.requested',site.id,{requestId:id,reviewId,oldName:named.name,newName:name,version});
    await recordConsent(c,'public_profile','review-submission',true);
    await submissionNotice(c,reviewId);
    return c.json({pending:{id,new_name:name,old_name:named.name,requested_version:version},reviewId,draftVersion:version,message},201);
  });
  app.get('/api/admin/subdomain-redirects',async c=>{role(c,['owner']);return c.json({redirects:await all(c,'SELECT name,target_url,active,version,created_at,updated_at FROM owner_subdomain_redirects ORDER BY updated_at DESC LIMIT 500')});});
  app.post('/api/admin/subdomain-redirects',async c=>{
    const actor=role(c,['owner']);const body=await c.req.json<{name:unknown;url:unknown}>();const name=candidate(c,body.name),url=target(c,body.url,name);
    const old=await one<{name:string;target_url:string;active:number}>(c,'SELECT name,target_url,active FROM owner_subdomain_redirects WHERE name=?',name);
    if(old){if(old.active===1&&old.target_url===url)return c.json({name,url,idempotent:true});throw new HTTPException(409,{message:'الرابط محجوز لديك؛ عدّل وجهته من سجله'});}
    await assertAvailable(c,name);await preventLoop(c,name,url);const clock=now();
    try {await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,NULL,?)').bind(name,actor.id,clock),
      c.env.DB.prepare('INSERT INTO owner_subdomain_redirects(name,target_url,created_by,created_at,updated_at) VALUES(?,?,?,?,?)').bind(name,url,actor.id,clock,clock),
    ]);}catch{throw new HTTPException(409,{message:'حُجز الاسم قبل إتمام العملية؛ لم تتغير أي هوية قائمة'});}
    await audit(c,'owner.redirect.created',name,{url});return c.json({name,url,active:true},201);
  });
  app.put('/api/admin/subdomain-redirects/:name',async c=>{
    role(c,['owner']);const name=candidate(c,c.req.param('name'));const body=await c.req.json<{url:unknown;active:boolean;version:number}>();const url=target(c,body.url,name);
    if(typeof body.active!=='boolean'||!Number.isInteger(body.version))throw new HTTPException(400,{message:'حدّث سجل الرابط ثم أعد المحاولة'});
    if(body.active)await preventLoop(c,name,url);
    const result=await run(c,'UPDATE owner_subdomain_redirects SET target_url=?,active=?,version=version+1,updated_at=? WHERE name=? AND version=?',url,body.active?1:0,now(),name,body.version);
    if(!result.meta.changes)throw new HTTPException(409,{message:'تغيّر هذا الرابط على جهاز آخر؛ حدّث السجل'});
    await audit(c,'owner.redirect.updated',name,{url,active:body.active});return c.json({name,url,active:body.active,version:body.version+1});
  });
}

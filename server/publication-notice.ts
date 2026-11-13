import type { Ctx, Env } from './core';
import { digest, hmac, now, one, run, uid } from './core';
import { deliverDecisionEmail } from './decision-email';

/** Only a committed immutable review may generate the publication notice. */
export async function publicationNotice(c: Ctx, reviewId: string) {
  const historic=await one<{channel:string}>(c,'SELECT channel FROM mail_delivery_events WHERE event_key=?','publication:'+reviewId);
  if(historic?.channel==='legacy')return;
  const review = await one<{ user_id: number; name: string; email: string; site_name: string; site_id:string; status: string }>(c,
    `SELECT r.site_id,s.user_id,u.name,COALESCE(m.contact_email,u.email) AS email,d.status,
      (SELECT n.name FROM dns_names n WHERE n.site_id=r.site_id LIMIT 1) AS site_name
     FROM reviews r JOIN review_decisions d ON d.review_id=r.id JOIN sites s ON s.id=r.site_id JOIN users u ON u.id=s.user_id
     LEFT JOIN managed_accounts m ON m.user_id=u.id WHERE r.id=? AND d.status='approved' AND u.status='active' AND s.status NOT IN ('deleted','deletion_pending')`, reviewId);
  if (!review?.site_name) return;
  const event = 'publication:' + reviewId, clock = now();
  const policy=await one<{visible:number}>(c,'SELECT visible FROM site_visibility WHERE site_id=?',review.site_id);
  const visible=policy?.visible!==0;
  const url = visible?`https://${review.site_name}.${c.env.ROOT_DOMAIN}`:`https://${c.env.ROOT_DOMAIN}/dashboard?site=${review.site_id}&tab=editor`;
  const title=visible?'هويتك أصبحت جاهزة للمشاركة':'اعتمدنا هويتك؛ موقعك مخفي باختيارك';
  const message=visible?'شكراً لما أعددته. اعتمدنا موقعك ونشرناه وفق خيارات ظهورك. يمكنك الآن مشاركته.':'شكراً لما أعددته. اعتمدنا هويتك، ويبقى الموقع مخفياً وفق اختيارك. يمكنك إظهاره من الخصوصية في مساحتك.';
  await run(c, 'INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at,action_url) VALUES(?,?,?,?,?,?)',
    'publication-' + await digest(reviewId), review.user_id, title, message, clock, url);
  const input={to:review.email,name:review.name,subject:'تم اعتماد هويتك — KSA.MEN',title,message,
    actionLabel:visible?'فتح موقعي':'فتح مساحتي',actionUrl:url};
  const payloadHash=await hmac(c.env.AUTH_SECRET,JSON.stringify(input)),lease=uid();
  await run(c,"INSERT OR IGNORE INTO mail_delivery_events(event_key,user_id,state,created_at,attempts,next_attempt_at,payload_hash) VALUES(?,?,'failed',?,0,?,?)",event,review.user_id,clock,clock,payloadHash);
  const claim=await run(c,`UPDATE mail_delivery_events SET state='sending',attempts=attempts+1,last_attempt_at=?,lease_token=?,payload_hash=COALESCE(payload_hash,?)
    WHERE event_key=? AND state='failed' AND attempts<3 AND created_at>? AND COALESCE(next_attempt_at,0)<=?
      AND payload_hash=?`,clock,lease,payloadHash,event,clock-86400,clock,payloadHash);
  if(!claim.meta.changes)return;
  try{
    const result=await deliverDecisionEmail(c.env,{...input,idempotencyKey:'publication-'+await digest(reviewId)});
    const state=result.delivered?'sent':result.uncertain?'uncertain':'failed';
    await run(c,`UPDATE mail_delivery_events SET state=?,channel=?,finished_at=?,next_attempt_at=?
      WHERE event_key=? AND lease_token=? AND state='sending'`,state,result.channel,now(),state==='failed'?now()+300:null,event,lease);
  }catch{
    await run(c,"UPDATE mail_delivery_events SET state='uncertain',finished_at=?,next_attempt_at=NULL WHERE event_key=? AND lease_token=? AND state='sending'",now(),event,lease);
  }
}

export async function submissionNotice(c: Ctx, reviewId: string) {
  const review = await one<{ user_id: number; site_id:string }>(c, 'SELECT s.user_id,s.id AS site_id FROM reviews r JOIN sites s ON s.id=r.site_id WHERE r.id=?', reviewId);
  if (!review?.user_id) return;
  const id = await digest(reviewId), clock = now();
  await run(c, 'INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at,action_url) VALUES(?,?,?,?,?,?)',
    'submission-' + id, review.user_id, 'موقعك الآن تحت المراجعة', 'شكراً لك، وصلنا ما أعددته لهويتك المهنية. موقعك الآن تحت المراجعة، وسنبلغك هنا وبالبريد فور اعتماده ونشره. يمكنك متابعة العمل في مساحتك.', clock, `/dashboard?site=${review.site_id}&tab=editor`);
  await run(c, "INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at,action_url) SELECT ?||'-'||id,id,?,?,?,? FROM users WHERE role='owner' AND status='active'", 'submission-owner-' + id, 'هوية جديدة بانتظار النشر', 'وصل طلب نشر جديد. يمكنك معاينته ثم اعتماده ونشره من لوحة الإدارة.', clock, '/admin?tab=reviews');
}

/** Existing app Cron only. Sending with a lost result is quarantined, not blindly retried. */
export async function retryPublicationNotices(env:Env){
 const clock=now();
 await env.DB.prepare("UPDATE mail_delivery_events SET state='uncertain',finished_at=?,next_attempt_at=NULL WHERE state='sending' AND event_key LIKE 'publication:%' AND COALESCE(last_attempt_at,created_at)<?").bind(clock,clock-600).run();
 const rows=(await env.DB.prepare("SELECT event_key FROM mail_delivery_events WHERE event_key LIKE 'publication:%' AND state='failed' AND payload_hash IS NOT NULL AND attempts<3 AND created_at>? AND COALESCE(next_attempt_at,0)<=? LIMIT 25").bind(clock-86400,clock).all<{event_key:string}>()).results;
 let processed=0,failed=0;
 for(const row of rows){try{await publicationNotice({env} as Ctx,row.event_key.slice('publication:'.length));processed++;}catch{failed++;}}
 return {processed,failed};
}

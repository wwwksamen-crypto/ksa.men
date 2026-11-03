import type { Ctx } from './core';
import { digest, now, one, run } from './core';
import { deliverDecisionEmail } from './decision-email';

/** Only a committed immutable review may generate the publication notice. */
export async function publicationNotice(c: Ctx, reviewId: string) {
  const historic=await one<{channel:string}>(c,'SELECT channel FROM mail_delivery_events WHERE event_key=?','publication:'+reviewId);
  if(historic?.channel==='legacy')return;
  const review = await one<{ user_id: number; name: string; email: string; site_name: string; site_id:string; status: string }>(c,
    `SELECT r.site_id,s.user_id,u.name,COALESCE(m.contact_email,u.email) AS email,d.status,
      (SELECT n.name FROM dns_names n WHERE n.site_id=r.site_id LIMIT 1) AS site_name
     FROM reviews r JOIN review_decisions d ON d.review_id=r.id JOIN sites s ON s.id=r.site_id JOIN users u ON u.id=s.user_id
     LEFT JOIN managed_accounts m ON m.user_id=u.id WHERE r.id=? AND d.status='approved'`, reviewId);
  if (!review?.site_name) return;
  const event = 'publication:' + reviewId, clock = now();
  const policy=await one<{visible:number}>(c,'SELECT visible FROM site_visibility WHERE site_id=?',review.site_id);
  const visible=policy?.visible!==0;
  const url = visible?`https://${review.site_name}.${c.env.ROOT_DOMAIN}`:`https://${c.env.ROOT_DOMAIN}/dashboard?site=${review.site_id}&tab=editor`;
  const title=visible?'هويتك أصبحت جاهزة للمشاركة':'اعتمدنا هويتك؛ موقعك مخفي باختيارك';
  const message=visible?'شكراً لما أعددته. اعتمدنا موقعك ونشرناه وفق خيارات ظهورك. يمكنك الآن مشاركته.':'شكراً لما أعددته. اعتمدنا هويتك، ويبقى الموقع مخفياً وفق اختيارك. يمكنك إظهاره من الخصوصية في مساحتك.';
  await run(c, 'INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at,action_url) VALUES(?,?,?,?,?,?)',
    'publication-' + await digest(reviewId), review.user_id, title, message, clock, url);
  const claim = await run(c, "INSERT OR IGNORE INTO mail_delivery_events(event_key,user_id,state,created_at) VALUES(?,?,'sending',?)", event, review.user_id, clock);
  if (!claim.meta.changes) return;
  try {
    const result = await deliverDecisionEmail(c.env, { to: review.email, name: review.name, subject: 'تم اعتماد هويتك — KSA.MEN', title, message, actionLabel: visible?'فتح موقعي':'فتح مساحتي', actionUrl: url });
    await run(c, 'UPDATE mail_delivery_events SET state=?,channel=?,finished_at=? WHERE event_key=?', result.delivered ? 'sent' : result.uncertain ? 'uncertain' : 'failed', result.channel, now(), event);
  } catch {
    // No automatic re-send after an ambiguous delivery or a process interruption.
    await run(c, "UPDATE mail_delivery_events SET state='uncertain',finished_at=? WHERE event_key=?", now(), event);
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

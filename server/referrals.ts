import { usageMetricsEnabled } from './optional-metrics';
import type { App, Ctx } from './core';
import { me, now, one, rate, run } from './core';
import { referralCode, referralURL, memberReferralCode, type ReferralSummary } from '../shared/referral';
import { z } from 'zod';

export async function resolveReferrer(c:Ctx,value:unknown,email?:string):Promise<number|null> {
  const code=referralCode(value);if(!code)return null;
  const id=/^C([1-9]\d*)$/.exec(code);
  const ref=id?await one<{id:number;email:string}>(c,"SELECT id,email FROM users WHERE id=? AND status='active'",Number(id[1])):await one<{id:number;email:string}>(c,"SELECT u.id,u.email FROM dns_names n JOIN users u ON u.id=n.owner_id WHERE n.name=? AND u.status='active'",code);
  return ref && (!email || ref.email.toLowerCase()!==email.toLowerCase()) ? ref.id : null;
}
export async function referralSummary(c:Ctx,id:number):Promise<ReferralSummary> {
  const totals=await one<{registered:number;eligible:number;rewarded:number;cancelled:number}>(c,`SELECT COUNT(*) AS registered,
    COALESCE(SUM(EXISTS(SELECT 1 FROM payments p WHERE p.user_id=u.id AND p.status='approved' AND p.reversed_at IS NULL)
      OR EXISTS(SELECT 1 FROM entitlement_sources e WHERE e.user_id=u.id AND e.revoked_at IS NULL AND
        CASE WHEN json_valid(e.detail) THEN json_extract(e.detail,'$.basis') ELSE '' END='admin_annual_approval')),0) AS eligible,
    COALESCE(SUM(EXISTS(SELECT 1 FROM ledger l WHERE l.reference='referral-'||u.id AND l.to_id=?)),0) AS rewarded,
    COALESCE(SUM(EXISTS(SELECT 1 FROM payment_reversals pr JOIN payments p ON p.id=pr.payment_id WHERE p.user_id=u.id AND (pr.referral_recovered>0 OR pr.referral_outstanding>0))),0) AS cancelled
    FROM users u WHERE u.referrer_id=? AND u.id<>?`,id,id,id);
  const points=await one<{issued:number;recovered:number;outstanding:number}>(c,`SELECT
    (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE to_id=? AND kind='referral') AS issued,
    (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE from_id=? AND kind='referral_reversal') AS recovered,
    (SELECT COALESCE(SUM(pr.referral_outstanding),0) FROM payment_reversals pr JOIN payments p ON p.id=pr.payment_id WHERE p.referrer_id=?) AS outstanding`,id,id,id);
  const metricsEnabled=await usageMetricsEnabled(c);
  const visits=metricsEnabled?await one<{n:number}>(c,"SELECT COUNT(*) AS n FROM analytics WHERE site_id=? AND event='referral_landing'",'referral:'+memberReferralCode(id)):null;
  return {url:referralURL(id,c.env.ROOT_DOMAIN),code:memberReferralCode(id),metricsEnabled,visits:metricsEnabled?Number(visits?.n||0):null,registered:Number(totals?.registered||0),eligible:Number(totals?.eligible||0),rewarded:Number(totals?.rewarded||0),cancelled:Number(totals?.cancelled||0),pointsIssued:Number(points?.issued||0),pointsRecovered:Number(points?.recovered||0),pointsOutstanding:Number(points?.outstanding||0),rewardPoints:1000};
}
export function registerReferrals(app:App){
  app.get('/api/referrals',async c=>c.json(await referralSummary(c,me(c).id)));
  app.post('/api/public/referral-visit',async c=>{
    if(!await usageMetricsEnabled(c))return c.json({ok:true,recorded:false});
    const data=z.object({code:z.string().max(70)}).parse(await c.req.json());
    await rate(c,'referral-landing:'+c.req.header('CF-Connecting-IP'),30,3600);
    const id=await resolveReferrer(c,data.code);
    if(id && c.get('user')?.id!==id)await run(c,'INSERT INTO analytics(site_id,event,created_at) VALUES(?,?,?)','referral:'+memberReferralCode(id),'referral_landing',now());
    // Never reveal whether a particular account exists or who it belongs to.
    return c.json({ok:true});
  });
}

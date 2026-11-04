import { HTTPException } from 'hono/http-exception';
import type { Ctx } from './core';
import { audit, now, one } from './core';

export type MembershipSettlement = 'confirmed' | 'strategic';
type MembershipRequest = { id: string; user_id: number; kind: string; status: string; applied_until: number | null; settlement: string | null };
const DAY = 86_400;
function fail(status: 400 | 404 | 409, message: string, code: string): never {
  throw new HTTPException(status, { res: Response.json({ error: message, code }, { status }) });
}
async function readRequest(c: Ctx, id: string) {
  return one<MembershipRequest>(c, `SELECT r.id,r.user_id,r.kind,r.status,r.applied_until,
    (SELECT CASE WHEN json_valid(e.detail) THEN json_extract(e.detail,'$.settlement') END
     FROM entitlement_sources e WHERE e.reference='subscription-annual-'||r.id) AS settlement
    FROM subscription_requests r WHERE r.id=?`, id);
}

/** A receipt is never required. Confirmation is the owner's attestation, not invented revenue. */
export async function decideMembershipRequest(c: Ctx, operatorId: number, body: Record<string, unknown>) {
  const decision = String(body.decision ?? '').toLowerCase();
  if (!['approve', 'reject', 'changes_requested'].includes(decision)) fail(400, 'Decision is invalid', 'invalid_input');
  const requestedSettlement = body.settlement;
  if (requestedSettlement !== undefined && !['confirmed', 'strategic'].includes(String(requestedSettlement))) fail(400, 'Settlement is invalid', 'invalid_input');
  const rawReason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (rawReason.length > 2_000 || (decision !== 'approve' && !rawReason)) fail(400, 'Decision reason is invalid', 'invalid_input');
  const requestId = c.req.param('id');
  if (!requestId) fail(404, 'Membership request not found', 'not_found');
  const request = await readRequest(c, requestId);
  if (!request) fail(404, 'Membership request not found', 'not_found');
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested';
  const settlement: MembershipSettlement = requestedSettlement === 'strategic' ? 'strategic' : 'confirmed';
  const annual = request.kind === 'annual_contact';
  const replay = (previous: MembershipRequest) => {
    if (previous.status !== status || (annual && decision === 'approve' && requestedSettlement !== undefined && previous.settlement && previous.settlement !== settlement)) fail(409, 'This request already has a different decision', 'request_stale');
    return c.json({ requestId: previous.id, status: previous.status, appliedUntil: previous.applied_until, settlement: previous.settlement, idempotent: true });
  };
  if (request.status !== 'pending') return replay(request);
  const at = now(), approved = decision === 'approve';
  let days = 0;
  if (approved) {
    const account = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=? AND status='active'", request.user_id);
    if (!account) fail(404, 'Member account is unavailable', 'not_found');
    days = annual ? 365 : Number(body.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 365) fail(400, 'Extension days are invalid', 'invalid_input');
  }
  const reason = rawReason || (annual ? settlement === 'strategic' ? 'منحة استراتيجية بقرار المشرف الرئيسي دون سداد فعلي.' : 'اعتماد السداد بتأكيد المشرف الرئيسي دون اشتراط وصل.' : 'اعتماد تمديد الفترة المجانية بقرار المشرف الرئيسي.');
  const title = approved ? annual ? 'تم تفعيل اشتراكك السنوي' : 'تم تمديد الفترة المجانية' : decision === 'changes_requested' ? 'مطلوب توضيح لطلبك' : 'تحديث بشأن طلبك';
  const copy = approved ? annual ? settlement === 'strategic' ? 'منحتك الإدارة عضوية سنوية. سعداء بما ستضيفه إلى مجتمع KSA.MEN.' : 'تم اعتماد اتفاق عضويتك وتفعيل اشتراكك السنوي. حضورك يستحق.' : 'تمت إضافة مدة مجانية إلى استحقاقك.' : reason;
  const detail = JSON.stringify({ basis: 'admin_annual_approval', settlement, requestId: request.id, operatorId, reason, amount: null, receiptRequired: false, confirmedAt: at });
  const statements = [c.env.DB.prepare(`UPDATE subscription_requests SET status=?,admin_reason=?,decided_by=?,decided_at=?,
      applied_until=CASE WHEN ? THEN (SELECT MAX(?,trial_until,entitlement_until)+? FROM users WHERE id=? AND status='active') ELSE NULL END
      WHERE id=? AND status='pending' AND (?=0 OR EXISTS(SELECT 1 FROM users WHERE id=? AND status='active'))`)
    .bind(status, reason, operatorId, at, approved ? 1 : 0, at, days * DAY, request.user_id, request.id, approved ? 1 : 0, request.user_id)];
  if (approved) {
    if (annual) {
      statements.push(c.env.DB.prepare(`INSERT INTO subscriptions(id,user_id,payment_id,kind,start_at,end_at,created_at)
        SELECT ?,user_id,NULL,'annual_negotiated',applied_until-?,applied_until,? FROM subscription_requests WHERE id=? AND status='approved'`)
        .bind('annual-' + request.id, days * DAY, at, request.id));
      // Classify the new trigger-created provenance inside this transaction, never old history.
      statements.push(c.env.DB.prepare('UPDATE entitlement_sources SET source_kind=?,detail=?,created_by=? WHERE reference=?')
        .bind(settlement === 'strategic' ? 'grant' : 'subscription', detail, operatorId, 'subscription-annual-' + request.id));
      statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO ledger(id,from_id,to_id,amount,kind,notes,created_at,reference)
        SELECT 'referral-'||u.id,0,u.referrer_id,1000,'referral',?,?,'referral-'||u.id
        FROM users u JOIN users ref ON ref.id=u.referrer_id AND ref.status='active'
        JOIN subscription_requests r ON r.user_id=u.id AND r.id=? AND r.status='approved'
        WHERE u.status='active' AND ref.id<>u.id AND NOT EXISTS(SELECT 1 FROM ledger l WHERE l.reference='referral-'||u.id)`)
        .bind(detail, at, request.id));
      statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at,action_url)
        SELECT 'referral-notice-'||r.user_id,l.to_id,'دعوتك تصنع أثراً','سُجلت لك 1000 نقطة تقدير بعد اعتماد عضوية مؤهلة. شكراً لمساهمتك في مجتمع KSA.MEN.',?,'/dashboard?tab=wallet'
        FROM subscription_requests r JOIN ledger l ON l.reference='referral-'||r.user_id
        WHERE r.id=? AND l.notes=? AND l.created_at=?`).bind(at, request.id, detail, at));
    } else {
      statements.push(c.env.DB.prepare(`INSERT INTO entitlement_sources(id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at)
        SELECT ?,user_id,'grant',applied_until-?,applied_until,?,?,?,? FROM subscription_requests WHERE id=? AND status='approved'`)
        .bind('membership-source-' + request.id, days * DAY, 'membership-request-' + request.id, reason, operatorId, at, request.id));
    }
    statements.push(c.env.DB.prepare(`UPDATE users SET entitlement_until=MAX(entitlement_until,(SELECT applied_until FROM subscription_requests WHERE id=? AND status='approved')) WHERE id=? AND EXISTS(SELECT 1 FROM subscription_requests WHERE id=? AND status='approved')`)
      .bind(request.id, request.user_id, request.id));
  }
  statements.push(c.env.DB.prepare(`INSERT INTO notifications(id,user_id,title,body,created_at,action_url)
    SELECT ?,user_id,?,?,?,'/dashboard?tab=subscription' FROM subscription_requests WHERE id=? AND status=? AND decided_by=? AND decided_at=?`)
    .bind('membership-decision-' + request.id, title, copy, at, request.id, status, operatorId, at));
  try {
    const results = await c.env.DB.batch(statements);
    if (!Number(results[0]?.meta?.changes || 0)) fail(409, 'This membership request is no longer pending', 'request_stale');
  } catch (error) {
    const previous = await readRequest(c, request.id);
    if (previous && previous.status !== 'pending') return replay(previous);
    throw error;
  }
  const updated = await readRequest(c, request.id);
  await audit(c, 'membership.decision', 'membership:' + request.id, { kind: request.kind, decision, settlement: annual && approved ? settlement : null, appliedUntil: updated?.applied_until, reason, receiptRequired: false, revenueRecorded: false, amount: null, referralBasis: annual && approved ? 'admin_annual_approval' : null, delivery: 'in_app' });
  return c.json({ requestId: request.id, status, appliedUntil: updated?.applied_until, settlement: annual && approved ? settlement : null });
}

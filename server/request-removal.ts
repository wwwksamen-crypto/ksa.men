import { HTTPException } from 'hono/http-exception';
import { type App, type Ctx, role, one, all, audit, digest, uid, now } from './core';

type Kind = 'review' | 'membership';
type RequestRow = { id: string; status: string; user_id: number; site_id?: string; decision_status?: string | null; [key: string]: unknown };
function fail(c: Ctx, status: 400 | 404 | 409, message: string, code: string): never {
  throw new HTTPException(status, { res: c.json({ message, code }, status) });
}
export async function assertRequestPresent(c: Ctx, kind: Kind, id: string) {
  if (await one(c, 'SELECT id FROM owner_request_removals WHERE kind=? AND request_id=?', kind, id)) {
    fail(c, 409, 'هذا الطلب محذوف من قائمة العمل. يمكن لصاحبه إرسال طلب جديد.', 'request_removed');
  }
}
export function registerRequestRemoval(app: App) {
  app.get('/api/admin/request-removals', async c => {
    await role(c, ['owner']);
    const records = await all(c, `SELECT r.*,u.name AS actor_name FROM owner_request_removals r
      LEFT JOIN users u ON u.id=r.actor_id ORDER BY r.created_at DESC LIMIT 100`);
    return c.json({ records });
  });
  app.post('/api/admin/request-removals/:kind/:id', async c => {
    const actor = await role(c, ['owner']);
    const kind = c.req.param('kind') as Kind, id = c.req.param('id');
    if (!['review', 'membership'].includes(kind) || !id || id.length > 150) fail(c, 400, 'نوع الطلب أو معرّفه غير صالح.', 'invalid_input');
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 1000) fail(c, 400, 'اكتب سبب حذف الطلب.', 'reason_required');
    const reason = body.reason.trim();
    const previous = await one<{ id: string }>(c, 'SELECT id FROM owner_request_removals WHERE kind=? AND request_id=?', kind, id);
    if (previous) return c.json({ removed: true, idempotent: true, proofId: previous.id });
    const table = kind === 'review' ? 'reviews' : 'subscription_requests';
    const row = kind === 'review'
      ? await one<RequestRow>(c, 'SELECT r.*,d.status AS decision_status FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.id=?', id)
      : await one<RequestRow>(c, 'SELECT * FROM subscription_requests WHERE id=?', id);
    if (!row) fail(c, 404, 'لم يعد الطلب موجوداً.', 'not_found');
    const status = String(row.decision_status || row.status);
    if (body.expectedStatus !== status) fail(c, 409, 'تغيرت حالة الطلب. حدّث القائمة قبل إعادة المحاولة.', 'request_stale');
    const holdSQL = `SELECT 1 FROM retention_holds WHERE status='active' AND
      (user_id=? OR (resource_id<>'' AND (resource_id=? OR (resource_type='account' AND resource_id=?) OR (resource_type='site' AND resource_id=?))))`;
    const holdArgs = [row.user_id, id, String(row.user_id), row.site_id || ''];
    if (await one(c, holdSQL, ...holdArgs)) {
      await audit(c, 'admin.request.blocked', `${kind}:${id}`, JSON.stringify({ reason, cause: 'retention_hold' }));
      fail(c, 409, 'توجد حصانة احتفاظ تمنع إزالة هذا الطلب. راجع السجل.', 'retention_hold');
    }
    const proofId = uid(), time = now(), beforeHash = await digest(JSON.stringify(row));
    await audit(c, 'admin.request.requested', `${kind}:${id}`, JSON.stringify({ proofId, reason, previousStatus: status }));
    const bind = (...values: unknown[]) => values;
    const rawStatusGuard = kind === 'review'
      ? ' AND COALESCE((SELECT status FROM review_decisions WHERE review_id=?),\'\')=?'
      : '';
    const statements = [c.env.DB.prepare(`INSERT INTO owner_request_removals(id,kind,request_id,actor_id,reason,previous_status,before_hash,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status=?${rawStatusGuard})
      AND NOT EXISTS(${holdSQL})`).bind(...bind(proofId, kind, id, actor.id, reason, status, beforeHash, time, id, row.status,
        ...(kind === 'review' ? [id, row.decision_status || ''] : []), ...holdArgs))];
    if (kind === 'review' && row.status === 'pending' && !row.decision_status) {
      statements.push(c.env.DB.prepare(`INSERT INTO review_decisions(review_id,status,reviewer_id,reason,decided_at)
        SELECT ?,'rejected',?,?,? WHERE EXISTS(SELECT 1 FROM owner_request_removals WHERE id=?)`).bind(id, actor.id, reason, time, proofId));
      statements.push(c.env.DB.prepare(`UPDATE sites SET
        draft_version=draft_version+CASE WHEN draft_version=? THEN 1 ELSE 0 END,
        status=CASE WHEN status='pending' AND NOT EXISTS(
          SELECT 1 FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id
          WHERE r.site_id=sites.id AND r.status='pending' AND d.review_id IS NULL
        ) THEN CASE WHEN published_version>0 THEN 'published' ELSE 'draft' END ELSE status END,
        updated_at=? WHERE id=? AND status<>'deleted' AND EXISTS(SELECT 1 FROM owner_request_removals WHERE id=?)
      `).bind(row.draft_version, time, row.site_id, proofId));
    } else if (kind === 'membership' && ['pending', 'changes_requested'].includes(row.status)) {
      statements.push(c.env.DB.prepare(`UPDATE subscription_requests SET status='rejected',admin_reason=?,decided_by=?,decided_at=?
        WHERE id=? AND EXISTS(SELECT 1 FROM owner_request_removals WHERE id=?)`).bind(reason, actor.id, time, id, proofId));
    }
    let applied = false;
    try { const result = await c.env.DB.batch(statements); applied = Number(result[0].meta?.changes || 0) === 1; }
    catch { await audit(c, 'admin.request.conflict', `${kind}:${id}`, JSON.stringify({ proofId })); fail(c, 409, 'تعذر حذف الطلب بسبب تغيره أو وجود حصانة. لم تتغير القرارات السابقة.', 'request_stale'); }
    if (!applied) {
      const completed = await one<{ id: string }>(c, 'SELECT id FROM owner_request_removals WHERE kind=? AND request_id=?', kind, id);
      if (completed) return c.json({ removed: true, idempotent: true, proofId: completed.id });
      await audit(c, 'admin.request.conflict', `${kind}:${id}`, JSON.stringify({ proofId }));
      fail(c, 409, 'تغير الطلب أثناء التنفيذ. حدّث القائمة.', 'request_stale');
    }
    let auditPending = false;
    try { await audit(c, 'admin.request.completed', `${kind}:${id}`, JSON.stringify({ proofId, reason, previousStatus: status, beforeHash })); }
    catch { auditPending = true; }
    return c.json({ removed: true, proofId, auditPending });
  });
}

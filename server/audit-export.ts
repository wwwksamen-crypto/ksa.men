import type { App } from './core';
import { all, audit, one, role, minimizedAuditDetail } from './core';
import { HTTPException } from 'hono/http-exception';

function integer(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new HTTPException(400, {message:'طلب صفحات السجل غير صحيح'});
  return Number(value);
}
export function registerAuditExport(app: App) {
  app.get('/api/admin/audit/export', async c => {
    const actor = role(c, ['owner']);
    c.header('Cache-Control', 'private, no-store');
    const kind = c.req.query('kind') || 'audit';
    if (kind !== 'audit' && kind !== 'erasure') throw new HTTPException(400, {message:'نوع سجل التصدير غير مدعوم'});
    const limit = integer(c.req.query('limit'), 500, 500);
    const before = integer(c.req.query('before'), Number.MAX_SAFE_INTEGER);
    const max = await one<{id:number}>(c, 'SELECT COALESCE(MAX(id),0) AS id FROM audit');
    const snapshot = integer(c.req.query('snapshot'), Number(max?.id || 0));
    if (snapshot > Number(max?.id || 0)) throw new HTTPException(400, {message:'نطاق السجل غير موجود'});
    if (!c.req.query('snapshot')) await audit(c, 'audit.export.requested', kind, {actorId:actor.id,snapshot,scope:kind,outcome:'snapshot-prepared'});
    let rows: Record<string, unknown>[];
    if (kind === 'audit') {
      rows = await all<Record<string,unknown>>(c, `SELECT a.id,a.actor_id,u.name AS actor_name,a.action,a.target,a.detail,a.created_at,a.prev_hash,a.row_hash
        FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id<=? AND a.id<? ORDER BY a.id DESC LIMIT ?`, snapshot, before, limit);
      rows = await Promise.all(rows.map(async row => ({...row,detail:JSON.parse(await minimizedAuditDetail(c.env,String(row.detail || '{}')))})));
    } else {
      rows = await all<Record<string,unknown>>(c, `SELECT a.id AS cursor,d.id AS request_id,d.user_id,d.reason,d.status,d.created_at,d.executed_at,d.requested_action,a.actor_id,u.name AS actor_name,a.target,a.row_hash AS evidence_hash,
        (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id) AS files_total,
        (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id AND q.status='deleted') AS files_removed,
        (SELECT COUNT(*) FROM media_purge_queue q WHERE q.deletion_request_id=d.id AND q.status='failed') AS files_failed
        FROM deletion_requests d JOIN audit a ON a.id=(SELECT MIN(a2.id) FROM audit a2 WHERE a2.action='owner.erasure.requested' AND json_valid(a2.detail) AND json_extract(a2.detail,'$.requestId')=d.id)
        LEFT JOIN users u ON u.id=a.actor_id WHERE d.requested_action IN ('owner-account','owner-account_only','owner-site') AND a.id<=? AND a.id<? ORDER BY a.id DESC LIMIT ?`, snapshot, before, limit);
    }
    const cursor = Number(rows.at(-1)?.[kind === 'audit' ? 'id' : 'cursor']);
    return c.json({records:rows,snapshot,nextBefore:rows.length === limit ? cursor : null,scope:kind,actorId:actor.id,detailsRedacted:true,hashesReferenceOriginalRows:true});
  });
}

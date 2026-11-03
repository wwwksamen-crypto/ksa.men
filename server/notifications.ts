import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { App } from './core';
import { all, audit, me, now, one, run } from './core';

const idSchema = z.string().min(1).max(200);
export function registerNotifications(app: App) {
  app.get('/api/notifications', async c => {
    const user = me(c);
    const query = z.object({ before: z.coerce.number().int().nonnegative().optional(), beforeId: idSchema.optional() }).parse(c.req.query());
    if ((query.before === undefined) !== (query.beforeId === undefined)) throw new HTTPException(400);
    const rows = await all<{ id: string; title: string; body: string; read_at: number | null; created_at: number }>(c,
      `SELECT id,title,body,read_at,created_at,action_url FROM notifications WHERE user_id=? AND dismissed_at IS NULL
       ${query.before !== undefined ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
       ORDER BY created_at DESC,id DESC LIMIT 51`, user.id,
      ...(query.before !== undefined ? [query.before, query.before, query.beforeId] : []));
    const count = await one<{ count: number }>(c, 'SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND dismissed_at IS NULL AND read_at IS NULL', user.id);
    const notifications = rows.slice(0, 50), last = notifications.at(-1);
    return c.json({ notifications, unread: Number(count?.count || 0), next: rows.length > 50 && last ? { before: last.created_at, beforeId: last.id } : null });
  });
  app.post('/api/notifications/read', async c => {
    const user = me(c);
    const body = z.object({ ids: z.array(idSchema).min(1).max(80) }).parse(await c.req.json());
    const ids = [...new Set(body.ids)];
    await run(c, `UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND dismissed_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, now(), user.id, ...ids);
    return c.json({ read: true });
  });
  app.post('/api/notifications/dismiss', async c => {
    const user = me(c);
    const body = z.discriminatedUnion('scope', [z.object({ scope: z.literal('all') }), z.object({ scope: z.literal('selected'), ids: z.array(idSchema).min(1).max(80) })]).parse(await c.req.json());
    const ids = body.scope === 'selected' ? [...new Set(body.ids)] : [];
    const result = await run(c, `UPDATE notifications SET dismissed_at=? WHERE user_id=? AND dismissed_at IS NULL ${body.scope === 'selected' ? `AND id IN (${ids.map(() => '?').join(',')})` : ''}`, now(), user.id, ...ids);
    if (result.meta.changes) await audit(c, 'notification.inbox.dismissed', user.id, { scope: body.scope, count: Number(result.meta.changes) });
    return c.json({ dismissed: true, count: Number(result.meta.changes || 0) });
  });
}

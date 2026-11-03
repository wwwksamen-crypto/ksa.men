import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { App, Ctx } from './core';
import { one, siteFor, audit, now, rate, me } from './core';
import { list, record } from '../shared/profile-content';
import { visibilityFields, listFields, withVisibility, type VisibilityPolicy } from '../shared/profile-visibility';

type VisibilityRow = { hidden_fields: string; hidden_items: string; visible: number; listed: number; indexable: number; version: number };
type Site = { id: string; draft?: string; published?: string | null; searchable?: number };
export async function siteVisibility(c: Ctx, site: Site): Promise<VisibilityPolicy> {
  const row = await one<VisibilityRow>(c, 'SELECT hidden_fields,hidden_items,visible,listed,indexable,version FROM site_visibility WHERE site_id=?', site.id);
  if (row) return { hidden: JSON.parse(row.hidden_fields), hiddenItems: JSON.parse(row.hidden_items), visible: !!row.visible, listed: !!row.listed, indexable: !!row.indexable, version: row.version };
  let raw: Record<string, unknown> = {};
  try { raw = record(JSON.parse(site.published || site.draft || '{}')); } catch { /* Fail closed on each content route's own parser. */ }
  return { hidden: [...new Set([...list(raw.hidden).filter((item): item is string => typeof item === 'string'), ...(raw.allowContact === false ? ['allowContact'] : [])]) ], hiddenItems: list(raw.hiddenItems).filter((item): item is string => typeof item === 'string'), visible: true, listed: site.searchable !== 0, indexable: true, version: 0 };
}
export async function visibleSiteProfile(c: Ctx, site: Site, raw: unknown) {
  const policy = await siteVisibility(c, site);
  if (!policy.visible) throw new HTTPException(404, { message: 'هذه الهوية غير متاحة الآن' });
  return withVisibility(raw, policy);
}
const fieldSet = new Set<string>(visibilityFields);
const hiddenSchema = z.array(z.string().refine(key => fieldSet.has(key))).max(40).transform(values => [...new Set(values)]);
const listSet = new Set<string>(listFields);
const hiddenItemSchema = z.array(z.string().max(120).refine(value => { const [field, id, extra] = value.split(':'); return !extra && listSet.has(field) && /^[A-Za-z\d_-]{1,80}$/.test(id || ''); })).max(1000).transform(values => [...new Set(values)]);
export function registerVisibility(app: App) {
  app.get('/api/sites/:id/visibility', async c => { const site = await siteFor(c, c.req.param('id')); return c.json({ siteId: site.id, policy: await siteVisibility(c, site) }); });
  app.put('/api/sites/:id/visibility', async c => {
    const user = me(c), site = await siteFor(c, c.req.param('id'));
    await rate(c, 'visibility:' + user.id, 600, 3600);
    const input = z.object({ version: z.number().int().min(0), hidden: hiddenSchema, hiddenItems: hiddenItemSchema, visible: z.boolean(), listed: z.boolean(), indexable: z.boolean() }).strict().parse(await c.req.json());
    const result = await c.env.DB.prepare(`INSERT INTO site_visibility(site_id,hidden_fields,hidden_items,visible,listed,indexable,version,updated_at,updated_by)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM site_visibility WHERE site_id=? AND version=?)
      ON CONFLICT(site_id) DO UPDATE SET hidden_fields=excluded.hidden_fields,hidden_items=excluded.hidden_items,visible=excluded.visible,listed=excluded.listed,indexable=excluded.indexable,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE site_visibility.version=?`)
      .bind(site.id, JSON.stringify(input.hidden), JSON.stringify(input.hiddenItems), +input.visible, +input.listed, +input.indexable, input.version + 1, now(), user.id, input.version, site.id, input.version, input.version).run();
    if (Number(result.meta.changes) !== 1) throw new HTTPException(409, { message: 'تغيّرت خيارات الظهور في نافذة أخرى. حدّثها ثم أعد اختيارك.' });
    await audit(c, 'site.visibility', site.id, { hidden: input.hidden, hiddenItemCount: input.hiddenItems.length, visible: input.visible, listed: input.listed, indexable: input.indexable, version: input.version + 1 });
    return c.json({ siteId: site.id, policy: { ...input, version: input.version + 1 } });
  });
}

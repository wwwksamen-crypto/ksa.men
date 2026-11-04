import { HTTPException } from 'hono/http-exception';
import { one, now, publicProfile, rate, type Ctx } from './core';
import { siteVisibility } from './visibility';
import { withVisibility } from '../shared/profile-visibility';
import { isQuickToken, quickFields, safeQuickSite } from '../shared/quick-link';

export function newQuickToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12)))).replace(/\+/g, '-').replace(/\//g, '_');
}

const unavailable = () => new HTTPException(404, { message: 'رابط التعارف غير متاح الآن. انتهت صلاحيته أو أوقف صاحبه مشاركته.' });
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function readQuickLink(c: Ctx, id: string) {
  // Shared IP budget across HTML/API and identifiers: changing tokens must not bypass the limit.
  await rate(c, 'quick-read:' + (c.req.header('CF-Connecting-IP') || 'unknown'), 180, 60);
  if (!isQuickToken(id)) throw unavailable();
  const link = await one<{ payload: string; user_id: number; expires_at: number }>(c,
    "SELECT q.payload,q.user_id,q.expires_at FROM quick_links q JOIN users u ON u.id=q.user_id WHERE q.id=? AND q.revoked=0 AND q.expires_at>? AND u.status='active'", id, now());
  if (!link) throw unavailable();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(link.payload)); } catch { throw unavailable(); }
  const site = typeof payload.siteId === 'string'
    ? await one<Record<string, unknown> & { id: string }>(c, 'SELECT s.*,u.status AS owner_status FROM sites s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?', payload.siteId)
    : await one<Record<string, unknown> & { id: string }>(c, 'SELECT s.*,u.status AS owner_status FROM sites s LEFT JOIN users u ON u.id=s.user_id WHERE s.user_id=? ORDER BY s.created_at LIMIT 1', link.user_id);
  if (!site || site.lock_hash || site.owner_status !== 'active' || ['deleted', 'deletion_pending'].includes(String(site.status))) throw unavailable();
  const policy = await siteVisibility(c, site);
  if (!policy.visible) throw unavailable();
  const values = object(payload.values || payload);
  const selected = Array.isArray(payload.fields) ? payload.fields : Object.keys(values);
  const bounded: Record<string, unknown> = {};
  for (const field of quickFields) if (selected.includes(field) && typeof values[field] === 'string') bounded[field] = values[field];
  const profile = publicProfile(withVisibility(bounded, policy)) as Record<string, unknown>;
  // 'site' is not a profile scalar, so honour the corresponding URL hiding alias explicitly.
  if (policy.hidden.includes('site') || policy.hidden.includes('url')) delete profile.site;
  const siteURL = safeQuickSite(profile.site, c.env.ROOT_DOMAIN);
  delete profile.site;
  return {
    profile: { ...profile, ...(siteURL ? { url: siteURL } : {}) },
    mode: ['professional', 'business', 'quick'].includes(String(payload.mode)) ? String(payload.mode) : 'professional',
    expiresAt: link.expires_at,
  };
}

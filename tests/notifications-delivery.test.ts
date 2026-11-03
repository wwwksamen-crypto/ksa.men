import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { defaultProfile } from '../server/business';
import { digest, now, uid } from '../server/core';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-inbox-')), 'unit.sqlite');
function sql(payload: any) { const p = spawnSync('python3', ['scripts/sqlite_bridge.py'], { input: JSON.stringify({ database, ...payload }), encoding: 'utf8' }); const d = JSON.parse(p.stdout || '{}'); if (d.error) throw new Error(d.error); return d; }
class Statement { params: unknown[] = []; constructor(public sql: string) {} bind(...p: unknown[]) { this.params = p; return this; } async all() { return sql({ sql: this.sql, params: this.params }); } async first() { return (await this.all()).results[0] || null; } async run() { return this.all(); } }
const actors: Record<string, { id: number; cookie: string; csrf: string; hash: string }> = {};
const emails: any[] = [];
const env: any = { ROOT_DOMAIN: 'ksa.men', OWNER_EMAIL: 'notice-owner@unit.invalid', AUTH_SECRET: 'notice-unit-secret', RESEND_API_KEY: 'local-fixture', BACKUP_ENCRYPTION_KEY: 'independent-unit', DB: { prepare: (q: string) => new Statement(q), batch: async (s: Statement[]) => sql({ batch: s.map(x => ({ sql: x.sql, params: x.params })) }) }, ASSETS: { fetch: async () => new Response('<!doctype html>fixture', { headers: { 'Content-Type': 'text/html' } }) }, MEDIA: { head: async () => null } };
let reviewId = '', siteId = '', managedId = 0;
async function request(path: string, actor?: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const work: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request('https://ksa.men' + path, { method, headers: { Origin: 'https://ksa.men', ...(actor ? { Cookie: actors[actor].cookie, 'X-CSRF-Token': actors[actor].csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p: Promise<unknown>) => work.push(p) } as any);
  await Promise.all(work); return { response, status: response.status, data: await response.clone().json().catch(() => null) };
}
beforeAll(async () => {
  sql({ setup: 'migrations' }); sql({ sql: "UPDATE settings SET value='\"open\"' WHERE key='unused'" }); sql({ sql: 'UPDATE settings SET value=? WHERE key=?', params: ['{"mode":"open"}', 'lock'] });
  for (const [key, role] of [['owner', 'owner'], ['member', 'user'], ['outside', 'manager']]) {
    sql({ sql: 'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)', params: [key === 'owner' ? env.OWNER_EMAIL : key + '@unit.invalid', key, '0555000000', role, now(), now() + 86400, now()] });
    const id = sql({ sql: 'SELECT id FROM users WHERE name=?', params: [key] }).results[0].id, token = uid() + uid(), csrf = uid(), hash = await digest(token);
    sql({ sql: 'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)', params: [hash, id, csrf, now() + 86400] }); actors[key] = { id, cookie: '__Host-ksa_session=' + token, csrf, hash };
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => { emails.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ id: uid() }), { status: 200 }); });
}, 30000);
afterAll(() => vi.restoreAllMocks());

describe.sequential('Inbox dismissal and one-time publication delivery', () => {
  it('pages a private inbox by timestamp and id without duplicating equal-time rows', async () => {
    const batch = Array.from({ length: 122 }, (_, i) => ({ sql: 'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)', params: [`note-${String(i).padStart(3, '0')}`, i === 121 ? actors.owner.id : actors.member.id, 'تحديث', 'محتوى الوحدة', now()] })); sql({ batch });
    expect((await request('/api/notifications')).status).toBe(401);
    const first = await request('/api/notifications', 'member'); expect(first.status).toBe(200); expect(first.data.notifications).toHaveLength(50); expect(first.data.unread).toBe(121);
    const second = await request(`/api/notifications?before=${first.data.next.before}&beforeId=${first.data.next.beforeId}`, 'member'); expect(second.data.notifications).toHaveLength(50); expect(second.data.notifications.some((n: any) => first.data.notifications.some((old: any) => old.id === n.id))).toBe(false);
    expect((await request('/api/notifications?before=4', 'member')).status).toBe(400);
  });
  it('marks shown rows read and dismisses selected/all across sessions without deleting records or touching another user', async () => {
    expect((await request('/api/notifications/dismiss', 'member', 'POST', { scope: 'selected', ids: ['note-121'] })).data.count).toBe(0);
    expect((await request('/api/notifications/read', 'member', 'POST', { ids: ['note-120'] })).status).toBe(200);
    expect((await request('/api/notifications/dismiss', 'member', 'POST', { scope: 'selected', ids: ['note-119', 'note-121'] })).data.count).toBe(1);
    const again = await request('/api/notifications', 'member'); expect(again.data.notifications.some((n: any) => n.id === 'note-119')).toBe(false); expect(again.data.unread).toBe(119);
    expect((await request('/api/notifications/dismiss', 'member', 'POST', { scope: 'all' }, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect((await request('/api/notifications/dismiss', 'member', 'POST', { scope: 'all' }, { Origin: 'https://foreign.invalid' })).status).toBe(403);
    expect((await request('/api/notifications/dismiss', 'member', 'POST', { scope: 'all' })).data.count).toBe(120);
    expect((await request('/api/notifications', 'member')).data).toMatchObject({ notifications: [], unread: 0 });
    expect(sql({ sql: 'SELECT COUNT(*) AS n FROM notifications' }).results[0].n).toBe(122);
    expect(sql({ sql: 'SELECT dismissed_at FROM notifications WHERE id=?', params: ['note-121'] }).results[0].dismissed_at).toBeNull();
    const dashboard = await request('/api/dashboard', 'member'); expect(dashboard.status).toBe(200); expect(dashboard.data.notifications).toEqual([]);
    expect(sql({ sql: "SELECT COUNT(*) AS n FROM audit WHERE action='notification.inbox.dismissed'" }).results[0].n).toBe(2);
  });
  it('reuses an identical submission, alerts the main administrator and leaves later edits outside the sent snapshot', async () => {
    siteId = uid(); const profile = { ...defaultProfile('عضو الإشعارات'), title: 'الهوية الأولى', notes: 'ملاحظة خاصة' };
    sql({ sql: 'INSERT INTO sites(id,user_id,draft,draft_version,created_at,updated_at) VALUES(?,?,?,1,?,?)', params: [siteId, actors.member.id, JSON.stringify(profile), now(), now()] });
    sql({ sql: 'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)', params: ['notice-proof', actors.member.id, siteId, now()] });
    const first = await request(`/api/sites/${siteId}/submit`, 'member', 'POST', { version: 1 }); expect(first.status).toBe(201);
    const repeated = await request(`/api/sites/${siteId}/submit`, 'member', 'POST', { version: 1 }); expect(repeated.status).toBe(200); expect(repeated.data.idempotent).toBe(true); expect(repeated.data.review.id).toBe(first.data.review.id);
    expect((await request('/api/notifications', 'owner')).data.notifications.some((n: any) => n.title.includes('بانتظار النشر'))).toBe(true);
    expect(emails).toHaveLength(0);
    const saved = await request(`/api/sites/${siteId}/draft`, 'member', 'PUT', { version: 1, draft: { ...profile, title: 'الهوية الأحدث' } }); expect(saved.status).toBe(200);
    const next = await request(`/api/sites/${siteId}/submit`, 'member', 'POST', { version: 2 }); expect(next.status).toBe(201); reviewId = next.data.review.id;
    expect(JSON.parse(sql({ sql: 'SELECT snapshot FROM reviews WHERE id=?', params: [first.data.review.id] }).results[0].snapshot).title).toBe('الهوية الأولى');
    expect(JSON.parse(sql({ sql: 'SELECT snapshot FROM reviews WHERE id=?', params: [reviewId] }).results[0].snapshot).notes).toBeUndefined();
    expect((await request(`/api/sites/${siteId}/submit`, 'member', 'POST', { version: 1 })).status).toBe(409);
  });
  it('approves in a PIN session once, without fresh verification, and sends one publication email with the live link', async () => {
    expect((await request(`/api/admin/reviews/${reviewId}/decision`, 'member', 'POST', { decision: 'approve' })).status).toBe(403);
    expect((await request(`/api/admin/reviews/${reviewId}/decision`, 'outside', 'POST', { decision: 'approve' })).status).toBe(403);
    const approved = await request(`/api/admin/reviews/${reviewId}/decision`, 'owner', 'POST', { decision: 'approve' }); expect(approved.status).toBe(200);
    expect((await request(`/api/admin/reviews/${reviewId}/decision`, 'owner', 'POST', { decision: 'approve' })).data.idempotent).toBe(true);
    expect((await request(`/api/admin/reviews/${reviewId}/decision`, 'owner', 'POST', { decision: 'reject', reason: 'تغيير القرار' })).status).toBe(409);
    expect(emails).toHaveLength(1); expect(emails[0].to).toEqual(['member@unit.invalid']); expect(emails[0].html).toContain('https://notice-proof.ksa.men');
    expect(sql({ sql: 'SELECT state FROM mail_delivery_events WHERE event_key=?', params: ['publication:' + reviewId] }).results[0].state).toBe('sent');
    expect(sql({ sql: "SELECT COUNT(*) AS n FROM audit WHERE action='review.decision'" }).results[0].n).toBe(1);
    const old = sql({ sql: 'SELECT id FROM reviews WHERE site_id=? AND id<>?', params: [siteId, reviewId] }).results[0].id;
    expect((await request(`/api/admin/reviews/${old}/decision`, 'owner', 'POST', { decision: 'approve' })).status).toBe(409);
    expect((await request(`/api/sites/${siteId}/submit`, 'member', 'POST', { version: 2 })).data.alreadyPublished).toBe(true);
    expect((await request('/api/notifications', 'member')).data.notifications.filter((n: any) => n.title.includes('جاهزة للمشاركة'))).toHaveLength(1);
  });
  it('keeps routine decisions in-app and does not weaken fresh verification for role changes', async () => {
    expect((await request(`/api/admin/users/${actors.outside.id}/action`, 'owner', 'POST', { action: 'status', status: 'suspended' })).status).toBe(403);
    sql({ sql: 'UPDATE sessions SET verified_at=? WHERE id=?', params: [now(), actors.owner.hash] });
    expect((await request(`/api/admin/users/${actors.outside.id}/action`, 'owner', 'POST', { action: 'status', status: 'suspended' })).status).toBe(200);
    expect(emails).toHaveLength(1);
  });
  it('creates a separate managed account once for a repeated request, even with administration contact email', async () => {
    const data = { name: 'حساب تحت الإدارة', email: env.OWNER_EMAIL, whatsapp: '0555000000', subdomain: 'inbox-managed', pin: '417395', authorized: true, idempotencyKey: uid() };
    const first = await request('/api/admin/managed-accounts', 'owner', 'POST', data); expect(first.status).toBe(201); managedId = first.data.userId;
    const again = await request('/api/admin/managed-accounts', 'owner', 'POST', data); expect(again.status).toBe(200); expect(again.data.userId).toBe(managedId);
    expect((await request('/api/admin/managed-accounts', 'owner', 'POST', { ...data, bio: 'طلب مختلف' })).status).toBe(409);
    expect(sql({ sql: 'SELECT COUNT(*) AS n FROM managed_creation_requests' }).results[0].n).toBe(1);
    expect(managedId).not.toBe(actors.owner.id);
  });
  it('sends one secret acceptance invitation, keeps the first link valid after repeat clicks and consumes it once', async () => {
    const before = emails.length;
    expect((await request(`/api/admin/managed-accounts/${managedId}/deliver`, 'owner', 'POST', { email: env.OWNER_EMAIL })).data.sent).toBe(true);
    const repeat = await request(`/api/admin/managed-accounts/${managedId}/deliver`, 'owner', 'POST', { email: env.OWNER_EMAIL }); expect(repeat.data.alreadySent).toBe(true); expect(emails.length - before).toBe(1);
    const token = /claim=([a-f0-9-]+)/.exec(emails.at(-1).html)![1];
    expect(JSON.stringify(repeat.data)).not.toContain(token);
    const list = await request('/api/admin/managed-accounts', 'owner'); expect(list.data.accounts.find((a: any) => a.id === managedId)).toMatchObject({ invitation_status: 'sent', invitation_email: env.OWNER_EMAIL });
    expect((await request('/api/auth/managed-claim?token=' + token)).status).toBe(200);
    const accepted = await request('/api/auth/managed-claim', undefined, 'POST', { token, pin: '624751', agree: true }); expect(accepted.status).toBe(200);
    expect((await request('/api/auth/managed-claim', undefined, 'POST', { token, pin: '624751', agree: true })).status).toBe(410);
    expect(sql({ sql: 'SELECT id,role FROM users WHERE email=?', params: [env.OWNER_EMAIL] }).results[0]).toMatchObject({ id: actors.owner.id, role: 'owner' });
    expect(sql({ sql: 'SELECT role FROM users WHERE id=?', params: [managedId] }).results[0].role).toBe('user');
  });
  it('respects whole-site visibility in the publication notice and provides a private workspace link instead',async()=>{
    const created=await request('/api/admin/managed-accounts','owner','POST',{name:'هوية مخفية',email:env.OWNER_EMAIL,whatsapp:'0555000000',subdomain:'hidden-notice-proof',pin:'417395',authorized:true});expect(created.status).toBe(201);
    const id=created.data.siteId;
    expect((await request(`/api/sites/${id}/visibility`,'owner','PUT',{version:0,hidden:[],hiddenItems:[],visible:false,listed:false,indexable:false})).status).toBe(200);
    expect((await request(`/api/admin/sites/${id}/publish`,'owner','POST',{version:1})).status).toBe(200);
    expect(emails.at(-1).text).toContain('/dashboard?site='+id);expect(emails.at(-1).text).toContain('مخفياً');
    expect(emails.at(-1).text).not.toContain('https://hidden-notice-proof.ksa.men');
    const notice=sql({sql:'SELECT title,action_url FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1',params:[created.data.userId]}).results[0];expect(notice.title).toContain('مخفي');
  });

});

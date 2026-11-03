import { draftWithIdentities } from '../shared/profile-visibility';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { App, Ctx, User } from './core';
import { all, audit, digest, hashSecret, now, one, rate, role, run, siteFor, uid, recordConsent } from './core';
import { defaultProfile, normalizeProfile, publicationProfile } from './business';
import { deliverDecisionEmail } from './decision-email';
import { issueSession, issueDevice } from './auth';

const staffRoles = ['owner', 'manager', 'moderator'];
const nameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'اختر اسم موقع صالحاً');
const emailSchema = z.string().trim().email('أدخل بريداً صحيحاً').max(254).transform(value => value.toLowerCase());
const managedCreate = z.object({
  name: z.string().trim().min(2).max(100), email: emailSchema,
  whatsapp: z.string().trim().min(7).max(30), subdomain: nameSchema,
  pin: z.string().regex(/^\d{6}$/, 'أدخل PIN من ستة أرقام'),
  title: z.string().trim().max(160).default(''), bio: z.string().max(6000).default(''),
  managerId: z.number().int().positive().optional(), authorized: z.literal(true),
});

/** Notification latency never changes an already committed publication result. */
export async function background(c: Ctx, work: Promise<unknown>): Promise<void> {
  const safe = work.catch(error => console.warn('Background account notice failed', error?.name));
  try { c.executionCtx.waitUntil(safe); } catch { await safe; }
}

export async function publishCurrentDraft(c: Ctx, siteId: string) {
  const operator = role(c, staffRoles);
  const site = await siteFor(c, siteId);
  const account = await one<User>(c, "SELECT * FROM users WHERE id=? AND status='active'", site.user_id);
  if (!account) throw new HTTPException(409, { message: 'فعّل حساب صاحب الموقع أولاً' });
  const name = await one<{ name: string }>(c, 'SELECT name FROM dns_names WHERE site_id=? LIMIT 1', site.id);
  if (!name) throw new HTTPException(409, { message: 'احجز اسم الموقع أولاً' });
  const snapshot = JSON.stringify(publicationProfile(draftWithIdentities(JSON.parse(site.draft),site.published?JSON.parse(site.published):undefined), account.name));
  // Existing immutable evidence may predate private-note separation. Compare its
  // publishable content, never rewrite history or require the user to edit again.
  if (site.status === 'published' && site.published_version === site.draft_version && site.published && JSON.stringify(publicationProfile(JSON.parse(site.published), account.name)) === snapshot) return { published: true, url: `https://${name.name}.${c.env.ROOT_DOMAIN}`, idempotent: true };
  const pending = await one<{ id: string; snapshot: string; base_version: number }>(c,
    "SELECT r.id,r.snapshot,r.base_version FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.site_id=? AND r.draft_version=? AND r.status='pending' AND d.review_id IS NULL ORDER BY r.created_at DESC LIMIT 1", site.id, site.draft_version);
  const reviewId = pending?.id || uid();
  if (pending && (JSON.stringify(publicationProfile(draftWithIdentities(JSON.parse(pending.snapshot),site.published?JSON.parse(site.published):undefined), account.name)) !== snapshot || pending.base_version !== site.published_version)) throw new HTTPException(409, { message: 'تغيّر الموقع. احفظ أحدث تعديل ثم أعد النشر' });
  const clock = now();
  await audit(c, 'site.publish.requested', site.id, { draftVersion: site.draft_version, responsibility: 'administration', reviewId });
  const statements = [];
  if (!pending) statements.push(c.env.DB.prepare(`INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,kind,created_at)
    SELECT ?,id,user_id,?,draft_version,published_version,'pending','content',? FROM sites WHERE id=? AND draft_version=? AND draft=?`)
    .bind(reviewId, snapshot, clock, site.id, site.draft_version, site.draft));
  statements.push(c.env.DB.prepare("INSERT INTO review_decisions(review_id,status,reviewer_id,reason,decided_at) VALUES(?,'approved',?,'نشر على مسؤولية الإدارة',?)").bind(reviewId, operator.id, clock));
  try { await c.env.DB.batch(statements); }
  catch { throw new HTTPException(409, { message: 'تغيّر الطلب أو صدر قرار عليه. حدّث الموقع ثم أعد النشر' }); }
  await audit(c, 'site.published', site.id, { reviewId, version: site.draft_version, responsibility: 'administration' });
  const contact = await one<{ contact_email: string }>(c, 'SELECT contact_email FROM managed_accounts WHERE user_id=?', account.id);
  await background(c, (async () => {
    await run(c, 'INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)', uid(), account.id, 'تم نشر موقعك', 'أصبح موقعك متاحاً على عنوانك الخاص.', clock);
    await deliverDecisionEmail(c.env, { to: contact?.contact_email || account.email, subject: 'تم نشر موقعك — KSA.MEN', name: account.name, title: 'حضورك أصبح متاحاً', message: 'تم نشر هويتك المهنية على عنوانك الخاص.', actionLabel: 'فتح الموقع', actionUrl: `https://${name.name}.${c.env.ROOT_DOMAIN}` });
  })());
  return { published: true, url: `https://${name.name}.${c.env.ROOT_DOMAIN}`, reviewId, idempotent: false };
}

async function managedScope(c: Ctx, userId: number) {
  const operator = role(c, staffRoles);
  const account = await one<{ user_id: number; managed_by: number; contact_email: string; status: string }>(c, 'SELECT * FROM managed_accounts WHERE user_id=?', userId);
  if (!account || (operator.role !== 'owner' && account.managed_by !== operator.id)) throw new HTTPException(403, { message: 'الحساب ليس ضمن إدارتك' });
  return account;
}

export function registerManaged(app: App) {
  app.get('/api/admin/managed-accounts', async c => {
    const operator = role(c, staffRoles);
    const accounts = await all(c, `SELECT u.id,u.name,u.whatsapp,m.contact_email AS email,m.status AS management_status,m.managed_by,
      n.name AS subdomain,s.id AS site_id,s.status AS site_status,s.published_version,s.draft_version
      FROM managed_accounts m JOIN users u ON u.id=m.user_id JOIN sites s ON s.user_id=u.id
      JOIN dns_names n ON n.site_id=s.id WHERE (?='owner' OR (m.managed_by=? AND m.status='managed')) ORDER BY m.created_at DESC`, operator.role, operator.id);
    return c.json({ accounts });
  });
  app.post('/api/admin/managed-accounts', async c => {
    const creator = role(c, ['owner']);
    await rate(c, 'managed-create:' + creator.id, 30, 3600);
    const data = managedCreate.parse(await c.req.json());
    const reserved = await one(c, 'SELECT name FROM reserved_names WHERE name=? AND active=1', data.subdomain);
    const reservedTest = Boolean(reserved && data.subdomain === 'test');
    if ((reserved && !reservedTest) || await one(c, 'SELECT name FROM dns_names WHERE name=?', data.subdomain)) throw new HTTPException(409, { message: 'الاسم محجوز، اختر اسماً آخر' });
    const managerId = data.managerId || creator.id;
    if (!await one(c, "SELECT id FROM users WHERE id=? AND role IN ('owner','manager','moderator') AND status='active'", managerId)) throw new HTTPException(400, { message: 'اختر مشرفاً نشطاً' });
    const clock = now(), siteId = uid(), internalEmail = uid() + '@managed.' + c.env.ROOT_DOMAIN;
    const profile = normalizeProfile({ ...defaultProfile(data.name), title: data.title, bio: data.bio, email: data.email, whatsapp: data.whatsapp, phone: data.whatsapp }, data.name);
    const pinHash = await hashSecret(data.pin);
    await audit(c, 'managed.creation.requested', siteId, { managerId, authorization: true });
    // The owner-approved demo name is created in one transaction. Its reservation is
    // restored before commit, so ordinary reservations never see an unprotected name.
    try { await c.env.DB.batch([
      ...(reservedTest ? [c.env.DB.prepare("UPDATE reserved_names SET active=0 WHERE name='test' AND active=1")] : []),
      c.env.DB.prepare("INSERT INTO users(email,name,whatsapp,role,pin_hash,created_at,trial_until,assigned_to,consent_at,last_active) VALUES(?,?,?,'user',?,?,?,?,0,?)").bind(internalEmail, data.name, data.whatsapp, pinHash, clock, clock + 7 * 86400, managerId, clock),
      c.env.DB.prepare("INSERT INTO managed_accounts(user_id,contact_email,created_by,managed_by,created_at) SELECT id,?,?,?,? FROM users WHERE email=?").bind(data.email, creator.id, managerId, clock, internalEmail),
      c.env.DB.prepare("INSERT INTO sites(id,user_id,manager_id,draft,draft_version,created_at,updated_at) SELECT ?,id,?,?,1,?,? FROM users WHERE email=?").bind(siteId, managerId, JSON.stringify(profile), clock, clock, internalEmail),
      c.env.DB.prepare('INSERT INTO dns_names(name,owner_id,site_id,created_at) SELECT ?,id,?,? FROM users WHERE email=?').bind(data.subdomain, siteId, clock, internalEmail),
      ...(reservedTest ? [c.env.DB.prepare("UPDATE reserved_names SET active=1 WHERE name='test' AND active=0")] : []),
    ]);
    } catch { throw new HTTPException(409, { message: 'تعذر حجز الاسم أو إنشاء الحساب. حدّث القائمة واختر اسماً متاحاً' }); }
    const account = await one<{ id: number }>(c, 'SELECT id FROM users WHERE email=?', internalEmail);
    await audit(c, 'managed.created', siteId, { userId: account!.id, managerId });
    return c.json({ userId: account!.id, siteId, subdomain: data.subdomain, editUrl: `/dashboard?site=${siteId}&tab=editor` }, 201);
  });
  app.post('/api/admin/sites/:id/publish', async c => c.json(await publishCurrentDraft(c, c.req.param('id'))));
  app.post('/api/admin/managed-accounts/:id/assign', async c => {
    role(c, ['owner']); const id = Number(c.req.param('id')); const account = await managedScope(c, id);
    if (account.status !== 'managed') throw new HTTPException(409, { message: 'الحساب أصبح بإدارة صاحبه' });
    const { managerId } = z.object({ managerId: z.number().int().positive() }).parse(await c.req.json());
    if (!await one(c, "SELECT id FROM users WHERE id=? AND role IN ('owner','manager','moderator') AND status='active'", managerId)) throw new HTTPException(400, { message: 'اختر مشرفاً نشطاً' });
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE managed_accounts SET managed_by=? WHERE user_id=?').bind(managerId, id),
      c.env.DB.prepare('UPDATE sites SET manager_id=? WHERE user_id=?').bind(managerId, id),
      c.env.DB.prepare('UPDATE users SET assigned_to=? WHERE id=?').bind(managerId, id),
    ]);
    await audit(c, 'managed.assigned', id, { managerId }); return c.json({ ok: true });
  });
  app.post('/api/admin/managed-accounts/:id/deliver', async c => {
    const operator = role(c, ['owner']); const id = Number(c.req.param('id')); const account = await managedScope(c, id);
    if (account.status !== 'managed') throw new HTTPException(409, { message: 'تم تسليم الحساب من قبل' });
    const { email } = z.object({ email: emailSchema }).parse(await c.req.json());
    await rate(c, 'managed-deliver:' + id, 3, 3600);
    const token = uid() + uid(), hash = await digest(token), clock = now();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE managed_claim_tokens SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').bind(clock, id),
      c.env.DB.prepare('INSERT INTO managed_claim_tokens(token_hash,user_id,contact_email,created_by,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(hash, id, email, operator.id, clock + 48 * 3600, clock),
    ]);
    const result = await deliverDecisionEmail(c.env, { to: email, name: '', subject: 'استلم حسابك — KSA.MEN', title: 'هويتك جاهزة لك', message: 'استلم إدارة حسابك واضبط رمزك الشخصي. الرابط صالح لمدة 48 ساعة ولمرة واحدة. لا تشاركه مع غيرك.', actionLabel: 'استلام حسابي', actionUrl: `https://${c.env.ROOT_DOMAIN}/auth?claim=${token}` });
    if (!result.delivered) { await run(c, 'UPDATE managed_claim_tokens SET revoked_at=? WHERE token_hash=?', clock, hash); throw new HTTPException(503, { message: 'تعذر إرسال الدعوة الآن. بقي الحساب بإدارتك، حاول لاحقاً' }); }
    await audit(c, 'managed.invitation.sent', id, { channel: result.channel }); return c.json({ sent: true });
  });
  app.get('/api/auth/managed-claim', async c => {
    const token = z.string().max(100).min(32).parse(c.req.query('token'));
    const row = await one(c, `SELECT u.name,n.name AS subdomain FROM managed_claim_tokens t JOIN managed_accounts m ON m.user_id=t.user_id
      JOIN users u ON u.id=t.user_id JOIN dns_names n ON n.owner_id=u.id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.consumed_at IS NULL AND t.expires_at>? AND m.status='managed' AND u.status='active' AND u.role='user' LIMIT 1`, await digest(token), now());
    if (!row) throw new HTTPException(410, { message: 'انتهت الدعوة أو تم استلام الحساب. استخدم رابط الدخول الخاص بك' });
    return c.json(row);
  });
  app.post('/api/auth/managed-claim', async c => {
    const data = z.object({ token: z.string().min(32).max(100), pin: z.string().regex(/^\d{6}$/), agree: z.literal(true) }).parse(await c.req.json());
    await rate(c, 'managed-claim:' + c.req.header('CF-Connecting-IP'), 10, 900);
    const hash = await digest(data.token), clock = now();
    const row = await one<{ user_id: number }>(c, 'SELECT user_id FROM managed_claim_tokens WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?', hash, clock);
    if (!row) throw new HTTPException(410, { message: 'انتهت الدعوة أو تم استلام الحساب' });
    let result;
    try { result = await run(c, 'UPDATE managed_claim_tokens SET consumed_at=?,accepted_pin_hash=? WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?', clock, await hashSecret(data.pin), hash, clock); }
    catch { throw new HTTPException(410, { message: 'تم استلام الحساب من قبل أو انتهت الدعوة' }); }
    if (!result.meta.changes) throw new HTTPException(410, { message: 'تم استلام الحساب من قبل' });
    const user = await one<User>(c, 'SELECT * FROM users WHERE id=?', row.user_id);
    if (!user) throw new HTTPException(410);
    const csrf = await issueSession(c, user, clock, 7 * 86400); await issueDevice(c, user);
    c.set('user', user); await recordConsent(c, 'account_creation', 'managed-account-acceptance', true); await audit(c, 'managed.claimed', row.user_id, { consent: true });
    return c.json({ accepted: true, csrf });
  });
}

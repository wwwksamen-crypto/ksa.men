import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { defaultProfile, normalizeProfile, publicationProfile } from '../server/business';
import { digest, now, uid } from '../server/core';
import { parseDraft } from '../client/src/Dashboard';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-editor-')), 'local.sqlite');
function sql(payload: any) { const result = spawnSync('python3', ['scripts/sqlite_bridge.py'], { input: JSON.stringify({ database, ...payload }), encoding: 'utf8' }); const value = JSON.parse(result.stdout || '{}'); if (value.error) throw new Error(value.error); return value; }
class Statement { params: unknown[] = []; constructor(public sql: string) {} bind(...params: unknown[]) { this.params = params; return this; } async all() { return sql({ sql: this.sql, params: this.params }); } async first() { return (await this.all()).results[0] || null; } async run() { return this.all(); } }
const objects = new Map<string, Uint8Array>();
const env: any = { ROOT_DOMAIN: 'ksa.men', OWNER_EMAIL: 'owner@editor.invalid', AUTH_SECRET: 'local-unit-secret', RESEND_API_KEY: 'local-unit-key', BACKUP_ENCRYPTION_KEY: 'independent-local-test-key', DB: { prepare: (query: string) => new Statement(query), batch: async (statements: Statement[]) => sql({ batch: statements.map((s) => ({ sql: s.sql, params: s.params })) }) }, MEDIA: { head: async (key: string) => objects.has(key) ? { key } : null, get: async (key: string) => objects.has(key) ? { body: objects.get(key) } : null, put: async (key: string, bytes: Uint8Array) => objects.set(key, bytes) }, ASSETS: { fetch: async () => new Response('<!doctype html>Local fixture', { headers: { 'Content-Type': 'text/html' } }) } };
const actors: Record<string, { id: number; cookie: string; csrf: string }> = {};
const siteId = '0f097df3-22e7-4032-817a-105c27bbcf31', otherSite = '0f097df3-22e7-4032-817a-105c27bbcf32';
const item = { title: 'عنوان تدقيق', organization: 'جهة تدقيق', start: '2020', end: '2025', description: 'تفصيل تدقيق' };
const fixture = { ...defaultProfile('هوية اختبار محلية'), title: 'عنوان مهني', bio: 'نبذة كاملة للتدقيق المحلي فقط', email: 'profile@editor.invalid', phone: '0555000000', whatsapp: '0555000000', city: 'الرياض', country: 'السعودية', experience: [{ ...item }], education: [{ ...item }], training: [{ ...item }], timeline: [{ ...item }], skills: ['مهارة عامة'], skillRadar: { human: ['تواصل'], scientific: ['تحليل'], professional: ['هندسة'] }, memberships: ['عضوية'], languages: ['العربية'], hobbies: ['قراءة'], achievements: ['إنجاز'], youtube: 'https://youtu.be/abcdefghijk', socials: [{ label: '', url: 'https://x.com/local-test' }], buttons: [{ label: '', url: 'https://example.com/' }], blog: 'مدونة اختبار', notes: 'ملاحظة خاصة لا تنشر', skillImages: [] as string[], workImages: [] as string[], hidden: ['email'] };
async function request(path: string, actor?: string, method = 'GET', body?: unknown, host = 'ksa.men') { const headers: Record<string, string> = { Origin: 'https://' + host }; if (actor) { headers.Cookie = actors[actor].cookie; headers['X-CSRF-Token'] = actors[actor].csrf; } if (body) headers['Content-Type'] = 'application/json'; const response = await worker.fetch(new Request('https://' + host + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: () => {} } as any); return { response, status: response.status, data: await response.clone().json().catch(() => null) }; }
beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"local-email"}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  sql({ setup: 'migrations' }); sql({ sql: 'UPDATE settings SET value=? WHERE key=?', params: ['{"mode":"open"}', 'lock'] });
  for (const [key, role] of [['owner','owner'], ['member','user'], ['stranger','user'], ['moderator','moderator']]) {
    sql({ sql: 'INSERT INTO users(email,name,whatsapp,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)', params: [key+'@editor.invalid', key, '0555000000', role, now(), now()+86400, now()] });
    const id = sql({ sql: 'SELECT id FROM users WHERE email=?', params: [key+'@editor.invalid'] }).results[0].id;
    const raw = uid()+uid(), csrf = uid(); sql({ sql: 'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)', params: [await digest(raw),id,csrf,now()+86400] }); actors[key] = { id, cookie: '__Host-ksa_session='+raw, csrf };
  }
  for (const [id, actor, name] of [[siteId,'member','editor-local'],[otherSite,'stranger','editor-other']]) {
    sql({ sql: 'INSERT INTO sites(id,user_id,draft,created_at,updated_at) VALUES(?,?,?,?,?)', params: [id, actors[actor].id, JSON.stringify(defaultProfile(name)), now(), now()] });
    sql({ sql: 'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)', params: [name,actors[actor].id,id,now()] });
  }
  for (const [id, owner, site, purpose, exists] of [['saved-skill','member',siteId,'skill',true],['saved-work','member',siteId,'work',true],['missing-object','member',siteId,'skill',false],['other-site-image','stranger',otherSite,'skill',true],['private-receipt','member',siteId,'receipt',true]]) {
    sql({ sql: 'INSERT INTO media(id,owner_id,site_id,purpose,bucket_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)', params: [id,actors[String(owner)].id,site,purpose,id,'image/webp',16,now()] });
    if (exists) objects.set(String(id), new Uint8Array(16));
  }
}, 30000);
afterAll(() => vi.restoreAllMocks());

describe.sequential('complete draft content — local D1 and R2 only', () => {
  it('retains every section, blank row, partial URL/email, whitespace and private note on save/reopen', async () => {
    const draft = { ...fixture, name: '', email: 'unfinished@', experience: [{ ...item, title: '' }, { title:'',organization:'',start:'',end:'',description:'' }], skills: ['مهارة', ''], socials: [{ label:'',url:'https://x.' }, { label:'',url:'' }], buttons: [{ label:'',url:'' }], youtube: 'https://youtu.', bio: 'نص مع مسافة  ', skillImages: ['/api/media/saved-skill'], workImages: ['/api/media/saved-work'] };
    const saved = await request(`/api/sites/${siteId}/draft`, 'member', 'PUT', { version:0, draft }); expect(saved.status).toBe(200);
    const reopened = await request(`/api/sites/${siteId}`, 'member'); expect(reopened.status).toBe(200);
    const parsed = parseDraft(reopened.data.site.draft);
    for (const key of Object.keys(draft)) if (key !== 'translations') expect((parsed as any)[key], key).toEqual((draft as any)[key]);
    const submit = await request(`/api/sites/${siteId}/submit`, 'member','POST',{version:1}); expect(submit.status).toBe(422); expect(submit.data.code).toBe('INCOMPLETE_PROFILE');
    expect(sql({sql:'SELECT COUNT(*) n FROM reviews WHERE site_id=?',params:[siteId]}).results[0].n).toBe(0);
    expect((await request(`/api/sites/${siteId}/draft`,'member','PUT',{version:0,draft})).status).toBe(409);
  });
  it('offers only existing authorized skill/work images and never publishes restoration automatically', async () => {
    const result = await request(`/api/sites/${siteId}/media`,'member'); expect(result.status).toBe(200);
    expect(result.response.headers.get('Cache-Control')).toContain('no-store');
    expect(result.data.items.map((image: any) => image.id).sort()).toEqual(['saved-skill','saved-work']);
    expect((await request(`/api/sites/${siteId}/media`,'stranger')).status).toBe(403);
    expect((await request(`/api/sites/${siteId}/media`,'moderator')).status).toBe(403);
    expect((await request(`/api/sites/${siteId}/media`)).status).toBe(401);
    expect((await request('/api/media/other-site-image','member')).status).toBe(403);
    expect(sql({sql:'SELECT published FROM sites WHERE id=?',params:[siteId]}).results[0].published).toBeNull();
  });
  it('preserves legacy text entries and structured metadata rather than discarding them', () => {
    const legacy = { ...fixture, experience:['خبرة نصية'], memberships:[{...item}], languages:[{...item,title:'العربية'}], hobbies:[{...item,title:'قراءة'}], skills:[{...item,title:'تحليل'}], achievements:[{...item}], socials:['https://x.com/local-test'], buttons:['https://example.com/'] };
    const parsed = parseDraft(JSON.stringify(legacy));
    expect(parsed.experience[0].title).toBe('خبرة نصية'); expect(parsed.memberships[0]).toEqual(item);
    expect((parsed.languages[0] as any).start).toBe('2020'); expect(parsed.socials[0]).toEqual({label:'',url:'https://x.com/local-test'});
    const normalized = normalizeProfile(parsed, '', false, true); expect(normalized.memberships).toEqual([item]);
    expect(normalized.skillRadar).toEqual(fixture.skillRadar); expect(normalized.skills).toEqual(legacy.skills);
  });
  it('freezes every completed section for review/publication while leaving private notes in the editable copy only', async () => {
    const draft = { ...fixture, skillImages:['/api/media/saved-skill'], workImages:['/api/media/saved-work'], translations:{en:{...fixture,name:'Local identity',notes:'PRIVATE ENGLISH NOTE'}} };
    const saved = await request(`/api/sites/${siteId}/draft`,'member','PUT',{version:1,draft}); expect(saved.status).toBe(200);
    expect((await request(`/api/sites/${siteId}/submit`,'member','POST',{version:1})).status).toBe(409);
    const submitted = await request(`/api/sites/${siteId}/submit`,'member','POST',{version:2}); expect(submitted.status).toBe(201);
    const snapshot = submitted.data.review.snapshot;
    expect(snapshot).toEqual(publicationProfile(draft)); expect(JSON.stringify(snapshot)).not.toContain('notes');
    const later = {...draft,bio:'تعديل لاحق لا ينشر سراً',notes:'ملاحظتي الأحدث'};
    expect((await request(`/api/sites/${siteId}/draft`,'member','PUT',{version:2,draft:later})).status).toBe(200);
    const approved = await request(`/api/admin/reviews/${submitted.data.review.id}/decision`,'owner','POST',{decision:'approve'}); expect(approved.status).toBe(200);
    const publicProfile = await request('/api/public/profile',undefined,'GET',undefined,'editor-local.ksa.men'); expect(publicProfile.status).toBe(200);
    const content = publicProfile.data.profile;
    for (const field of ['name','title','bio','phone','whatsapp','city','country','photo','cover','experience','education','training','skills','skillRadar','memberships','languages','hobbies','achievements','timeline','skillImages','workImages','youtube','blog']) expect(content[field],field).toEqual((publicationProfile(draft) as any)[field]);
    expect(content.socials[0].url).toBe(draft.socials[0].url); expect(content.buttons[0].url).toBe(draft.buttons[0].url);
    expect(content).not.toHaveProperty('email'); expect(content).not.toHaveProperty('notes'); expect(content).not.toHaveProperty('translations');
    const current = (await request(`/api/sites/${siteId}`,'member')).data.site.draft; expect(current.notes).toBe('ملاحظتي الأحدث'); expect(current.translations.en.notes).toBe('PRIVATE ENGLISH NOTE');
    const exported = await request('/api/public/export-data/editor-local?kind=qr'); expect(JSON.stringify(exported.data)).not.toContain('PRIVATE ENGLISH NOTE'); expect(JSON.stringify(exported.data)).not.toContain('notes');
  });
  it('keeps legacy publication idempotent and approves existing immutable legacy evidence without forcing another edit', async () => {
    const legacy = {...fixture, notes:'LEGACY PRIVATE NOTE'};
    sql({sql:'UPDATE sites SET draft=?,draft_version=1 WHERE id=?',params:[JSON.stringify(legacy),otherSite]});
    sql({sql:"INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,kind,created_at) VALUES(?,?,?,?,1,0,'pending','content',?)",params:['legacy-local-review',otherSite,actors.stranger.id,JSON.stringify(legacy),now()]});
    const published = await request(`/api/admin/sites/${otherSite}/publish`,'owner','POST',{});expect(published.status).toBe(200);
    const count = sql({sql:'SELECT COUNT(*) n FROM reviews WHERE site_id=?',params:[otherSite]}).results[0].n;
    const repeated = await request(`/api/admin/sites/${otherSite}/publish`,'owner','POST',{});expect(repeated.status).toBe(200);expect(repeated.data.idempotent).toBe(true);
    expect(sql({sql:'SELECT COUNT(*) n FROM reviews WHERE site_id=?',params:[otherSite]}).results[0].n).toBe(count);
    const publicView = await request('/api/public/profile',undefined,'GET',undefined,'editor-other.ksa.men');expect(publicView.status).toBe(200);expect(JSON.stringify(publicView.data)).not.toContain('LEGACY PRIVATE NOTE');
    expect(sql({sql:'SELECT snapshot FROM reviews WHERE id=?',params:['legacy-local-review']}).results[0].snapshot).toBe(JSON.stringify(legacy));
  });

});

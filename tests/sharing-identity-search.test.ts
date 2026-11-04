import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { decode as decodePng } from 'fast-png';
import worker from '../server/index';
import { defaultProfile, normalizeProfile } from '../server/business';
import { now } from '../server/core';
import { collectTranslationFields } from '../server/intelligence';
import { shareProfile } from '../server/og';
import { shareImageData, webpDimensions } from '../server/share-image';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-share-')), 'local.sqlite');
function sql(payload: any) {
  const process = spawnSync('python3', ['scripts/sqlite_bridge.py'], { input: JSON.stringify({ database, ...payload }), encoding: 'utf8' });
  const value = JSON.parse(process.stdout || '{}'); if (value.error) throw new Error(value.error); return value;
}
class Statement {
  params: unknown[] = []; constructor(public query: string) {}
  bind(...params: unknown[]) { this.params = params; return this; }
  async all() { return sql({ sql: this.query, params: this.params }); }
  async first() { return (await this.all()).results[0] || null; }
  async run() { return this.all(); }
}
const brand = new Uint8Array(readFileSync('public/assets/share-logo-1200-v1.png'));
const portrait = new Uint8Array(readFileSync('public/assets/logo-emblem.webp'));
const objects = new Map<string, Uint8Array>([['portrait-webp', portrait], ['corrupt-photo', new Uint8Array([1, 2, 3])]]);
const env: any = {
  ROOT_DOMAIN: 'ksa.men', AUTH_SECRET: 'local-only-share-test',
  DB: { prepare: (q: string) => new Statement(q) },
  MEDIA: {
    get: async (key: string) => { const bytes = objects.get(key); return bytes ? { body: bytes, arrayBuffer: async () => bytes.slice().buffer } : null; },
    put: async (key: string, bytes: Uint8Array) => { objects.set(key, new Uint8Array(bytes)); },
  },
  ASSETS: { fetch: async (request: Request) => new URL(request.url).pathname.endsWith('.png')
    ? new Response(brand, { headers: { 'Content-Type': 'image/png' } })
    : new Response('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } }) },
};
const base = { ...defaultProfile('هوية منشورة'), title: 'مدير تنفيذي', specialty: 'التسويق الرقمي', city: 'جدة', notes: 'PRIVATE NOTE', photo: '/api/media/portrait', translations: { en: { name: 'Published identity', photo: '/assets/logo-emblem.webp', specialty: 'Digital marketing' } } };
async function request(path: string, host = 'ksa.men') { return worker.fetch(new Request('https://' + host + path), env, { waitUntil() {} } as any); }
function policy(hidden: string[]) { sql({ sql: 'UPDATE site_visibility SET hidden_fields=? WHERE site_id=?', params: [JSON.stringify(hidden), 'share-test-site'] }); }
function publish(patch: Record<string, unknown>) { sql({ sql: 'UPDATE sites SET published=?,published_version=published_version+1 WHERE id=?', params: [JSON.stringify({ ...base, ...patch }), 'share-test-site'] }); }
beforeAll(() => {
  sql({ setup: 'migrations' }); sql({ sql: 'UPDATE settings SET value=? WHERE key=?', params: ['{"mode":"open"}', 'lock'] });
  sql({ sql: 'INSERT INTO users(id,email,name,created_at,trial_until,consent_at) VALUES(1,?,?,?,?,?)', params: ['share@local.invalid', 'local', now(), now() + 86400, now()] });
  for (const [id, name, published] of [['share-test-site', 'identity-local', base], ['legacy-site', 'legacy-local', { name: 'ملف قديم', title: 'هندسة', city: 'الرياض' }]] as const) {
    const owner = id === 'legacy-site' ? 2 : 1;
    if (owner === 2) sql({ sql: 'INSERT INTO users(id,email,name,created_at,trial_until,consent_at) VALUES(2,?,?,?,?,?)', params: ['legacy@local.invalid', 'legacy', now(), now() + 86400, now()] });
    sql({ sql: "INSERT INTO sites(id,user_id,draft,published,published_version,status,created_at,updated_at) VALUES(?,?,?,?,1,'published',?,?)", params: [id, owner, JSON.stringify({ ...published, specialty: 'DRAFT ONLY SPECIALTY' }), JSON.stringify(published), now(), now()] });
    sql({ sql: 'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)', params: [name, owner, id, now()] });
  }
  sql({ sql: 'INSERT INTO site_visibility(site_id,hidden_fields,hidden_items,updated_at,updated_by) VALUES(?,?,?,?,1)', params: ['share-test-site', '[]', '[]', now()] });
  for (const [id, key] of [['portrait', 'portrait-webp'], ['bad', 'corrupt-photo'], ['missing', 'not-in-r2']]) sql({ sql: 'INSERT INTO media(id,owner_id,site_id,purpose,bucket_key,mime,size,created_at) VALUES(?,1,?,?,?,?,?,?)', params: [id, 'share-test-site', 'photo', key, 'image/webp', portrait.length, now()] });
});
describe.sequential('approved visible identity and directory fields — local only', () => {
  it('uses a full original-logo PNG, not a cover, in the platform metadata', async () => {
    const response = await request('/'); const html = await response.text();
    expect(html).toContain('https://ksa.men/assets/share-logo-1200-v1.png'); expect(html).not.toContain('cover-1600.webp');
    expect(html).toContain('property="og:image:width" content="1200"'); expect(html).toContain('property="og:image:height" content="630"');
    const decoded = decodePng(brand); expect([decoded.width, decoded.height]).toEqual([1200, 630]);
  });
  it('decodes the actual WebP format to a PNG that social platforms can read', async () => {
    expect(webpDimensions(portrait)).toEqual({ width: 660, height: 630 });
    const image = await shareImageData(portrait, 'image/webp'); expect(image?.mime).toBe('image/png');
    const decoded = decodePng(image!.bytes); expect([decoded.width, decoded.height]).toEqual([660, 630]);
  });
  it('renders the approved portrait with contain, does not fall back silently, and uses a fresh v2 cache', async () => {
    const response = await request('/api/public/og/identity-local'); expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer()); expect(bytes).not.toEqual(brand);
    const image = decodePng(bytes); expect([image.width, image.height]).toEqual([1200, 630]);
    expect([...objects.keys()].some(key => key.startsWith('sharing/v2/share-test-site/'))).toBe(true);
    const en = shareProfile(base, 'en'); expect(en.photo).toBe(base.photo); expect(en.specialty).toBe('Digital marketing');
  });
  it('re-evaluates hidden photo before any old cached URL and changes the metadata fingerprint', async () => {
    const before = await (await request('/', 'identity-local.ksa.men')).text(); policy(['photo']);
    const response = await request('/api/public/og/identity-local?v=old'); expect(new Uint8Array(await response.arrayBuffer())).toEqual(brand);
    const after = await (await request('/', 'identity-local.ksa.men')).text();
    expect(before.match(/og:image" content="([^"]+)/)?.[1]).not.toBe(after.match(/og:image" content="([^"]+)/)?.[1]);
    expect(after).not.toContain('/api/media/portrait'); policy([]);
  });
  it('falls back for missing, corrupt and unowned images without sharing a draft or a receipt', async () => {
    for (const photo of ['/api/media/bad', '/api/media/missing', '/api/media/not-owned', '/assets/logo-emblem.webp', 'https://outside.invalid/image.png']) {
      publish({ photo }); const response = await request('/api/public/og/identity-local'); expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(brand);
    }
    publish({ photo: base.photo });
  });
  it('keeps locked and unavailable sites out of public OG', async () => {
    sql({ sql: 'UPDATE sites SET lock_hash=? WHERE id=?', params: ['opaque-local-lock', 'share-test-site'] });
    expect((await request('/api/public/og/identity-local')).status).toBe(423);
    expect(await (await request('/', 'identity-local.ksa.men')).text()).not.toContain('api/public/og/identity-local');
    sql({ sql: 'UPDATE sites SET lock_hash=NULL WHERE id=?', params: ['share-test-site'] });
    sql({ sql: 'UPDATE site_visibility SET visible=0 WHERE site_id=?', params: ['share-test-site'] });
    expect((await request('/api/public/og/identity-local')).status).toBe(404);
    sql({ sql: 'UPDATE site_visibility SET visible=1 WHERE site_id=?', params: ['share-test-site'] });
  });
  it('searches and filters approved specialty separately from title and city, retaining legacy profiles', async () => {
    const response = await request('/api/search?q=' + encodeURIComponent('التسويق') + '&specialty=' + encodeURIComponent('التسويق الرقمي') + '&city=' + encodeURIComponent('جدة'));
    const data: any = await response.json(); expect(data.items).toHaveLength(1); expect(data.items[0].profile).toMatchObject({ title: 'مدير تنفيذي', specialty: 'التسويق الرقمي', city: 'جدة' });
    expect(data.specialties).toContain('التسويق الرقمي'); expect(data.specialties).toContain('هندسة'); expect(data.specialties).not.toContain('مدير تنفيذي');
    expect((await (await request('/api/search?q=DRAFT%20ONLY%20SPECIALTY')).json() as any).items).toHaveLength(0);
  });
  it('removes hidden specialty and city from search, filter choices, SEO and public export immediately', async () => {
    policy(['specialty', 'city']);
    const data: any = await (await request('/api/search?q=identity-local')).json(); expect(data.items[0].profile).not.toHaveProperty('specialty'); expect(data.items[0].profile).not.toHaveProperty('city');
    expect(data.specialties).not.toContain('التسويق الرقمي'); expect(data.specialties).not.toContain('مدير تنفيذي'); expect(data.cities).not.toContain('جدة');
    expect((await (await request('/api/search?specialty=' + encodeURIComponent('التسويق الرقمي'))).json() as any).items).toHaveLength(0);
    const html = await (await request('/', 'identity-local.ksa.men')).text(); expect(html).not.toContain('التسويق الرقمي'); expect(html).not.toContain('جدة');
    const exported: any = await (await request('/api/public/export-data/identity-local?kind=qr')).json(); expect(exported.profile).not.toHaveProperty('specialty'); expect(exported.profile).not.toHaveProperty('city'); policy([]);
  });
  it('collects the editable specialty for translation but never the name or private contact', () => {
    const fields = collectTranslationFields({ ...base, email: 'private@local.invalid' });
    expect(fields.some(field => field.path.join('.') === 'specialty')).toBe(true);
    expect(fields.some(field => ['name', 'email', 'photo'].includes(field.path.join('.')))).toBe(false);
  });
  it('rejects malformed and oversized identity images safely', async () => {
    expect(await shareImageData(new Uint8Array([1,2,3]), 'image/webp')).toBeNull();
    expect(await shareImageData(new Uint8Array(5_000_001), 'image/png')).toBeNull();
    expect(await shareImageData(new Uint8Array([0xff,0xd8,0xff,0xd9]), 'image/jpeg')).toBeNull();
    expect(await shareImageData(brand, 'image/svg+xml')).toBeNull();
  });
  it('validates specialty without making it required, preserving city and old values', () => {
    const legacy = normalizeProfile({ name: 'قديم', title: 'مسماه', city: 'الرياض' }); expect(legacy.specialty).toBe(''); expect(legacy.city).toBe('الرياض');
    const profile = normalizeProfile({ ...base, specialty: '  التسويق الرقمي  ', translations: undefined }); expect(profile.specialty).toBe('التسويق الرقمي'); expect(profile.title).toBe(base.title);
    expect(() => normalizeProfile({ name: 'عضو', specialty: 'a'.repeat(121) })).toThrow();
    expect(() => normalizeProfile({ name: 'عضو', specialty: 123 })).toThrow();
  });
  it('finds eligible old profiles beyond 200 without returning full profiles or drafts', async () => {
    const batch: { sql: string; params: unknown[] }[] = [];
    for (let i=0;i<205;i++) {
      const owner=100+i, id='bulk-local-'+i;
      const profile={ name:'اختبار التوسع '+i,title:'مسمى اختبار',specialty:'اختبار الترقيم',city:'مدينة الاختبار',notes:'PRIVATE BULK',blog:'PUBLIC BLOG NOT DIRECTORY',allowContact:true };
      batch.push({sql:'INSERT INTO users(id,email,name,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?)',params:[owner,'bulk'+i+'@local.invalid','bulk',now(),now()+86400,now()]});
      batch.push({sql:"INSERT INTO sites(id,user_id,draft,published,published_version,status,created_at,updated_at) VALUES(?,?,?,?,1,'published',?,?)",params:[id,owner,JSON.stringify({...profile,specialty:'PRIVATE DRAFT BULK'}),JSON.stringify(profile),now(),now()+i+1]});
      batch.push({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:[id,owner,id,now()]});
    }
    sql({batch});
    const oldest:any=await (await request('/api/search?q=identity-local')).json(); expect(oldest.items).toHaveLength(1);
    const page:any=await (await request('/api/search?specialty='+encodeURIComponent('اختبار الترقيم')+'&offset=200')).json();
    expect(page.total).toBe(205);expect(page.items).toHaveLength(5);
    expect(page.items[4].name).toBe('bulk-local-0');
    expect(Object.keys(page.items[0].profile).sort()).toEqual(['allowContact','city','name','specialty','title'].sort());
    expect(JSON.stringify(page)).not.toContain('PRIVATE');expect(JSON.stringify(page)).not.toContain('PUBLIC BLOG');
    expect((await (await request('/api/search?q=PRIVATE%20DRAFT%20BULK')).json() as any).items).toHaveLength(0);
    const invalid:any=await (await request('/api/search?offset=NaN')).json();expect(invalid.items).toHaveLength(20);
    const negative:any=await (await request('/api/search?offset=-10')).json();expect(negative.items).toEqual(invalid.items);
    const injection:any=await (await request('/api/search?q='+encodeURIComponent("' OR 1=1 --"))).json();expect(injection.items).toHaveLength(0);
    expect((await (await request('/api/search?q=%25')).json() as any).items).toHaveLength(0);
  });
  it('keeps a hidden or locked old profile out of matching and facets after the directory grows',async()=>{
    policy(['title','specialty','city','photo']);
    const data:any=await (await request('/api/search?q=identity-local')).json();expect(data.items[0].profile).toEqual({name:base.name,allowContact:base.allowContact});
    expect(data.specialties).not.toContain(base.specialty);expect(data.cities).not.toContain(base.city);
    expect((await (await request('/api/search?q='+encodeURIComponent(base.title))).json() as any).items).toHaveLength(0);
    policy([]);sql({sql:'UPDATE sites SET lock_hash=? WHERE id=?',params:['local-lock','share-test-site']});
    expect((await (await request('/api/search?q=identity-local')).json() as any).total).toBe(0);
    sql({sql:'UPDATE sites SET lock_hash=NULL WHERE id=?',params:['share-test-site']});
  });
  it('disables automatic invocation URL logs and redacts query strings without disabling observability or the audit ledger',()=>{
    const config=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
    expect(config.observability).toMatchObject({enabled:true,redact_query_string:true,logs:{enabled:true,invocation_logs:false}});
    expect(config.triggers.crons).toEqual(['0 * * * *']);expect(config.d1_databases[0].database_id).toBe('dd006d15-8b4c-4469-9809-af08cbb42ad4');
  });
});

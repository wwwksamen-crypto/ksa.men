import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { saudiDay } from '../server/auth-mail-policy';
import { digest, hashSecret, now, uid } from '../server/core';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const database = join(mkdtempSync(join(tmpdir(), 'ksa-mail-policy-')), 'unit.sqlite');
function sql(p: any) { const r = spawnSync('python3', ['scripts/sqlite_bridge.py'], { input: JSON.stringify({ database, ...p }), encoding: 'utf8' }); const d = JSON.parse(r.stdout || '{}'); if (d.error) throw new Error(d.error); return d; }
class Statement { params: unknown[] = []; constructor(public sql: string) {} bind(...p: unknown[]) { this.params = p; return this; } async all() { return sql({ sql: this.sql, params: this.params }); } async first() { return (await this.all()).results[0] || null; } async run() { return this.all(); } }
const env: any = { ROOT_DOMAIN: 'ksa.men', OWNER_EMAIL: 'mail-owner@unit.invalid', AUTH_SECRET: 'unit-mail-policy', RESEND_API_KEY: 'fixture', DB: { prepare: (q: string) => new Statement(q), batch: async (s: Statement[]) => sql({ batch: s.map(x => ({ sql: x.sql, params: x.params })) }) }, ASSETS: { fetch: async () => new Response('<!doctype html>fixture') } };
const emails: any[] = [], jar: Record<string, string> = {}, device = 'trusted-mail-policy-fixture';
let memberId = 0, otherId = 0, firstChallenge = '';
async function post(path: string, body: unknown, cookies = jar, ip = '198.51.100.17') {
  const response = await worker.fetch(new Request('https://ksa.men' + path, { method: 'POST', headers: { Origin: 'https://ksa.men', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) }), env, {} as any);
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], at = pair.indexOf('='); cookies[pair.slice(0, at)] = pair.slice(at + 1); }
  return { status: response.status, data: await response.clone().json().catch(() => null), response };
}
beforeAll(async () => {
  sql({ setup: 'migrations' }); sql({ sql: 'UPDATE settings SET value=? WHERE key=?', params: ['{"mode":"open"}', 'lock'] });
  for (const name of ['member', 'outside']) { sql({ sql: 'INSERT INTO users(email,name,whatsapp,pin_hash,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)', params: [name + '@mail-unit.invalid', name, '0555000000', await hashSecret('264913'), now(), now() + 86400, now()] }); }
  memberId = sql({ sql: 'SELECT id FROM users WHERE name=?', params: ['member'] }).results[0].id; otherId = sql({ sql: 'SELECT id FROM users WHERE name=?', params: ['outside'] }).results[0].id;
  sql({ sql: 'INSERT INTO devices(id,user_id,expires_at) VALUES(?,?,?)', params: [await digest(device), memberId, now() + 86400] }); jar['__Host-ksa_device'] = device;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => { emails.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ id: uid() }), { status: 200 }); });
}, 30000);
afterAll(() => vi.restoreAllMocks());

describe.sequential('Daily email budget and explicit backup', () => {
  it('uses midnight in Saudi Arabia rather than UTC midnight', () => {
    expect(saudiDay(Date.parse('2026-11-03T20:59:59Z') / 1000)).toBe('2026-11-03');
    expect(saudiDay(Date.parse('2026-11-03T21:00:00Z') / 1000)).toBe('2026-11-04');
  });
  it('does not send automatically and returns the existing browser-bound code after duplicate requests', async () => {
    expect(emails).toHaveLength(0);
    const first = await post('/api/auth/request', { email: 'member@mail-unit.invalid' }); expect(first.status).toBe(200); firstChallenge = first.data.challenge;
    const second = await post('/api/auth/request', { email: 'member@mail-unit.invalid' }); expect(second.status).toBe(200); expect(second.data.challenge).toBe(firstChallenge); expect(second.data.idempotent).toBe(true); expect(emails).toHaveLength(1);
  });
  it('rejects an unsolicited backup or borrowed challenge without consuming the legitimate backup slot', async () => {
    expect((await post('/api/auth/request', { email: 'member@mail-unit.invalid', backup: true, previousChallenge: firstChallenge }, {}, '198.51.100.19')).status).toBe(400);
    expect(sql({ sql: 'SELECT backup_used FROM auth_mail_daily_limits WHERE user_id=?', params: [memberId] }).results[0].backup_used).toBe(0);
    expect(emails).toHaveLength(1);
  });
  it('allows one explicit backup, invalidates the old code only after accepted sending, and rejects another', async () => {
    const backup = await post('/api/auth/request', { email: 'member@mail-unit.invalid', backup: true, previousChallenge: firstChallenge }); expect(backup.status).toBe(200); expect(backup.data.backup).toBe(true); expect(emails).toHaveLength(2);
    expect(sql({ sql: 'SELECT consumed FROM auth_codes WHERE id=?', params: [firstChallenge] }).results[0].consumed).toBe(1);
    expect((await post('/api/auth/request', { email: 'member@mail-unit.invalid', backup: true, previousChallenge: backup.data.challenge })).status).toBe(429); expect(emails).toHaveLength(2);
    sql({ sql: 'UPDATE auth_codes SET expires_at=? WHERE id=?', params: [now() - 1, backup.data.challenge] });
    expect((await post('/api/auth/request', { email: 'member@mail-unit.invalid' })).status).toBe(429);
    const quick = await post('/api/auth/quick', { email: 'member@mail-unit.invalid', pin: '264913' }); expect(quick.status).toBe(200); expect(quick.data.user.id).toBe(memberId); expect(emails).toHaveLength(2);
  });
  it('does not issue a wrong-account session from a shared PIN or an expected-id mismatch', async () => {
    const cookies = { '__Host-ksa_device': device };
    const wrong = await post('/api/auth/quick', { email: 'member@mail-unit.invalid', pin: '264913', expectedUserId: otherId }, cookies, '198.51.100.20'); expect(wrong.status).toBe(401); expect(wrong.response.headers.get('Set-Cookie') || '').not.toContain('__Host-ksa_session=');
    expect((await post('/api/auth/quick', { email: 'outside@mail-unit.invalid', pin: '264913' }, cookies, '198.51.100.20')).status).toBe(401);
  });
  it('does not allow a public requester to use sensitive reauthentication as an unlimited-mail bypass', async () => {
    const x = await post('/api/auth/request', { email: 'outside@mail-unit.invalid', purpose: 'reauth' }, {}, '198.51.100.21'); expect(x.status).toBe(401);
  });
  it('keeps a trusted account budget available after unverified requesters exhaust their separate abuse limit', async () => {
    const target = 'protected@mail-unit.invalid'; sql({ sql: 'INSERT INTO users(email,name,whatsapp,pin_hash,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?,?)', params: [target, 'protected', '0555000000', await hashSecret('264913'), now(), now() + 86400, now()] });
    const id = sql({ sql: 'SELECT id FROM users WHERE email=?', params: [target] }).results[0].id;
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/request', { email: target }, {}, '198.51.100.' + (50 + i))).status).toBe(200);
    expect((await post('/api/auth/request', { email: target }, {}, '198.51.100.90')).status).toBe(429);
    const trusted = 'protected-device-fixture'; sql({ sql: 'INSERT INTO devices(id,user_id,expires_at) VALUES(?,?,?)', params: [await digest(trusted), id, now() + 86400] });
    expect((await post('/api/auth/request', { email: target }, { '__Host-ksa_device': trusted }, '198.51.100.91')).status).toBe(200);
    expect(sql({ sql: 'SELECT COUNT(*) AS n FROM auth_mail_daily_limits WHERE user_id=? AND primary_used=1', params: [id] }).results[0].n).toBe(6);
  });
  it('keeps the existing code and nonce usable when backup sending is definitively rejected',async()=>{
    const retryJar:Record<string,string>={};
    const primary=await post('/api/auth/request',{email:'outside@mail-unit.invalid'},retryJar,'198.51.100.101');expect(primary.status).toBe(200);
    const primaryCode=/\b(\d{6})\b/.exec(emails.at(-1).text)![1],nonce=retryJar['__Host-ksa_challenge'];
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}',{status:422}));
    const failed=await post('/api/auth/request',{email:'outside@mail-unit.invalid',backup:true,previousChallenge:primary.data.challenge},retryJar,'198.51.100.101');expect(failed.status).toBe(503);
    expect(retryJar['__Host-ksa_challenge']).toBe(nonce);expect(sql({sql:'SELECT consumed FROM auth_codes WHERE id=?',params:[primary.data.challenge]}).results[0].consumed).toBe(0);
    expect((await post('/api/auth/verify',{challenge:primary.data.challenge,code:primaryCode},retryJar,'198.51.100.101')).status).toBe(200);
  });
  it('does not send a second-provider copy or release the daily budget after an ambiguous upstream response',async()=>{
    const target='uncertain@mail-unit.invalid';sql({sql:'INSERT INTO users(email,name,created_at,trial_until,consent_at,whatsapp) VALUES(?,?,?,?,?,?)',params:[target,'uncertain',now(),now()+86400,now(),'0555000000']});
    const cookies:Record<string,string>={},send=vi.fn();env.CLOUDFLARE_EMAIL={send};
    const count=vi.mocked(fetch).mock.calls.length;vi.mocked(fetch).mockRejectedValueOnce(new Error('Lost upstream response'));
    const first=await post('/api/auth/request',{email:target},cookies,'198.51.100.102');expect(first.status).toBe(200);
    const repeated=await post('/api/auth/request',{email:target},cookies,'198.51.100.102');expect(repeated.data.challenge).toBe(first.data.challenge);
    expect(vi.mocked(fetch).mock.calls.length-count).toBe(1);expect(send).not.toHaveBeenCalled();delete env.CLOUDFLARE_EMAIL;
  });
  it('allows another required step-up after the freshness window without reopening ordinary daily email allowance',async()=>{
    const token=uid()+uid(),hash=await digest(token);sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,0)',params:[hash,otherId,'unit',now()+86400]});
    const cookies:Record<string,string>={'__Host-ksa_session':token};const clock=Date.now(),mock=vi.spyOn(Date,'now');
    try{mock.mockReturnValue(clock);expect((await post('/api/auth/request',{email:'outside@mail-unit.invalid',purpose:'reauth'},cookies,'198.51.100.103')).status).toBe(200);
      mock.mockReturnValue(clock+901000);expect((await post('/api/auth/request',{email:'outside@mail-unit.invalid',purpose:'reauth'},cookies,'198.51.100.103')).status).toBe(200);
    }finally{mock.mockRestore();}
  });

});

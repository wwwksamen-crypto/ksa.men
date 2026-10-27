import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../server/index';
import { digest, hashSecret, now } from '../server/core';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const database = join(mkdtempSync(join(tmpdir(), 'ksa-auth-')), 'auth.sqlite');
function bridge(payload: any) {
  const result = spawnSync('python3', ['scripts/sqlite_bridge.py'], {
    input: JSON.stringify({ database, ...payload }),
    encoding: 'utf8',
  });
  const data = JSON.parse(result.stdout || '{}');
  if (data.error) throw new Error(data.error);
  return data;
}

class Statement {
  params: any[] = [];
  constructor(public sql: string) {}
  bind(...args: any[]) { this.params = args; return this; }
  async all() { return bridge({ sql: this.sql, params: this.params }); }
  async first(column?: string) {
    const row = (await this.all()).results[0] ?? null;
    return column && row ? row[column] : row;
  }
  async run() { return bridge({ sql: this.sql, params: this.params }); }
}

const env: any = {
  ROOT_DOMAIN: 'ksa.men',
  OWNER_EMAIL: 'owner@unit.invalid',
  AUTH_SECRET: 'auth-test-secret-not-production',
  RESEND_API_KEY: 'resend-fixture-key',
  DB: {
    prepare: (sql: string) => new Statement(sql),
    batch: async (items: Statement[]) => bridge({ batch: items.map(item => ({ sql: item.sql, params: item.params })) }),
  },
  ASSETS: { fetch: async () => new Response('<!doctype html><title>asset fixture</title>', { headers: { 'Content-Type': 'text/html' } }) },
};

const accounts = {
  alpha: { email: 'alpha@unit.invalid', pin: '314159', device: 'trusted-device-alpha', id: 0 },
  bravo: { email: 'bravo@unit.invalid', pin: '314159', device: 'trusted-device-bravo', id: 0 },
};

type Result = { response: Response; data: any };
async function post(path: string, body: unknown, device?: string): Promise<Result> {
  const response = await worker.fetch(new Request(`https://ksa.men${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://ksa.men',
      'CF-Connecting-IP': '198.51.100.42',
      'Content-Type': 'application/json',
      ...(device ? { Cookie: `__Host-ksa_device=${device}` } : {}),
    },
    body: JSON.stringify(body),
  }), env, {} as any);
  return { response, data: await response.clone().json().catch(() => null) };
}

const resendFixture = () => new Response(JSON.stringify({ id: 'resend-fixture-message' }), {
  status: 202,
  headers: { 'Content-Type': 'application/json' },
});
const noSessionCookie = (response: Response) => expect(response.headers.get('Set-Cookie') || '').not.toContain('__Host-ksa_session=');

beforeAll(async () => {
  bridge({ setup: 'migrations' });
  for (const [key, account] of Object.entries(accounts)) {
    bridge({
      sql: 'INSERT INTO users(email,name,whatsapp,pin_hash,created_at,trial_until,consent_at,last_active) VALUES(?,?,?,?,?,?,?,?)',
      params: [account.email, `Fixture ${key}`, '0555000000', await hashSecret(account.pin), now(), now() + 86_400, now(), now()],
    });
    account.id = bridge({ sql: 'SELECT id FROM users WHERE email=?', params: [account.email] }).results[0].id;
    bridge({
      sql: 'INSERT INTO devices(id,user_id,expires_at,revoked) VALUES(?,?,?,0)',
      params: [await digest(account.device), account.id, now() + 86_400],
    });
  }
});

afterEach(() => vi.restoreAllMocks());

describe.sequential('trusted-device quick authentication', () => {
  it('normalizes trimmed email before mailing the login challenge', async () => {
    const resend = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => resendFixture());
    const result = await post('/api/auth/request', { email: '  ALPHA@UNIT.INVALID  ', name: '', purpose: 'login' });

    expect(result.response.status).toBe(200);
    expect(resend).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));
    expect(JSON.parse(String(resend.mock.calls[0][1]?.body))).toMatchObject({ to: [accounts.alpha.email] });
    expect(bridge({ sql: 'SELECT email FROM auth_codes ORDER BY created_at DESC LIMIT 1' }).results[0].email).toBe(accounts.alpha.email);
  });

  it('keeps legacy empty names valid for login, recovery, and reauthentication', async () => {
    const resend = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => resendFixture());
    for (const purpose of ['login', 'recover', 'reauth']) {
      const result = await post('/api/auth/request', { email: accounts.alpha.email, name: '', purpose });
      expect(result.response.status).toBe(200);
    }
    expect(resend).toHaveBeenCalledTimes(3);
  });

  it('requires a meaningful Arabic-facing name only for registration', async () => {
    const resend = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => resendFixture());
    const result = await post('/api/auth/request', { email: accounts.bravo.email, name: '', whatsapp: '0555000000', consent: true, purpose: 'register' });

    expect(result.response.status).toBe(400);
    expect(result.data.error).toMatch(/الاسم|أكمل/);
    expect(resend).not.toHaveBeenCalled();
  });

  it('rejects a guest even with a correctly shaped email and PIN', async () => {
    const result = await post('/api/auth/quick', { email: accounts.alpha.email, pin: accounts.alpha.pin });
    expect(result.response.status).toBe(401);
    noSessionCookie(result.response);
  });

  it('requires the email in addition to a trusted-device cookie and PIN', async () => {
    const result = await post('/api/auth/quick', { pin: accounts.alpha.pin }, accounts.alpha.device);
    expect(result.response.status).toBe(400);
    noSessionCookie(result.response);
  });

  it('requires a six-digit PIN before issuing a session', async () => {
    const result = await post('/api/auth/quick', { email: accounts.alpha.email, pin: '31415' }, accounts.alpha.device);
    expect(result.response.status).toBe(400);
    noSessionCookie(result.response);
  });

  it('rejects a wrong PIN on an otherwise valid trusted device', async () => {
    const result = await post('/api/auth/quick', { email: accounts.alpha.email, pin: '000000' }, accounts.alpha.device);
    expect(result.response.status).toBe(401);
    noSessionCookie(result.response);
  });

  it('rejects an expired trusted device without setting a session', async () => {
    const device = 'trusted-device-expired';
    bridge({ sql: 'INSERT INTO devices(id,user_id,expires_at,revoked) VALUES(?,?,?,0)', params: [await digest(device), accounts.alpha.id, now() - 1] });
    const result = await post('/api/auth/quick', { email: accounts.alpha.email, pin: accounts.alpha.pin }, device);

    expect(result.response.status).toBe(401);
    noSessionCookie(result.response);
  });

  it('rejects a revoked trusted device without setting a session', async () => {
    const device = 'trusted-device-revoked';
    bridge({ sql: 'INSERT INTO devices(id,user_id,expires_at,revoked) VALUES(?,?,?,1)', params: [await digest(device), accounts.alpha.id, now() + 86_400] });
    const result = await post('/api/auth/quick', { email: accounts.alpha.email, pin: accounts.alpha.pin }, device);

    expect(result.response.status).toBe(401);
    noSessionCookie(result.response);
  });

  it('allows the shared PIN only when each account presents its own trusted device', async () => {
    for (const account of Object.values(accounts)) {
      const result = await post('/api/auth/quick', { email: account.email, pin: account.pin }, account.device);
      expect(result.response.status).toBe(200);
      expect(result.data.user.email).toBe(account.email);
      expect(result.response.headers.get('Set-Cookie')).toContain('__Host-ksa_session=');
    }
  });

  it('does not let a shared PIN cross the trusted-device account boundary', async () => {
    const result = await post('/api/auth/quick', { email: accounts.bravo.email, pin: accounts.bravo.pin }, accounts.alpha.device);

    expect(result.response.status).toBe(401);
    noSessionCookie(result.response);
  });
});

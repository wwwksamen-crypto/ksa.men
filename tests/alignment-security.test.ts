import { describe, it, expect, vi } from 'vitest';
import { fixture } from './repair-fixture';
import { digest, now, uid } from '../server/core';
import { commitAccountAuthority } from '../server/admin-security';

async function stale(f: Awaited<ReturnType<typeof fixture>>, actor = 'owner') {
  f.sql({sql:'UPDATE sessions SET verified_at=0 WHERE user_id=?',params:[f.actors[actor].id]});
}
async function device(f: Awaited<ReturnType<typeof fixture>>, actor = 'manager') {
  const raw = uid()+uid();
  f.sql({sql:'INSERT INTO devices(id,user_id,expires_at) VALUES(?,?,?)',params:[await digest(raw),f.actors[actor].id,now()+86400]});
  return raw;
}
const action = (f: Awaited<ReturnType<typeof fixture>>, actor: string, body: Record<string,unknown>) =>
  f.request('/api/admin/users/'+f.actors[actor].id+'/action','owner','POST',body);

describe('Selective alignment stage 1 — synthetic SQLite only', () => {
  it('blocks irreversible erasure with stale/PIN verification before any mutation, while impact and ordinary records remain readable', async () => {
    const f=await fixture();await stale(f);
    expect((await f.request('/api/admin/sites/'+f.site+'/erasure-impact','owner')).status).toBe(200);
    const before=f.sql({sql:'SELECT * FROM sites WHERE id=?',params:[f.site]}).results;
    const result=await f.request('/api/admin/sites/'+f.site+'/erase','owner','POST',{reason:'SYNTHETIC',affirmation:true,confirmation:f.site});
    expect(result).toMatchObject({status:403,data:{code:'REAUTH_REQUIRED'}});
    expect(f.sql({sql:'SELECT * FROM sites WHERE id=?',params:[f.site]}).results).toEqual(before);
    expect(f.sql({sql:'SELECT * FROM deletion_requests'}).results).toHaveLength(0);
    expect(f.sql({sql:'SELECT * FROM media_purge_queue'}).results).toHaveLength(0);
    expect((await f.request('/api/admin/erasure-records','owner')).status).toBe(200);
    expect(f.purges()).toBe(0);
  });
  it('requires modern verification for every export page, but not opening ordinary audit pages', async () => {
    const f=await fixture();await stale(f);
    expect((await f.request('/api/admin/audit','owner')).status).toBe(200);
    for(const url of ['/api/admin/audit/export','/api/admin/audit/export?kind=erasure&snapshot=1&before=1']) {
      expect(await f.request(url,'owner')).toMatchObject({status:403,data:{code:'REAUTH_REQUIRED'}});
    }
    expect(f.sql({sql:"SELECT * FROM audit WHERE action='audit.export.requested'"}).results).toHaveLength(0);
  });
  it('keeps the ordinary site editor and direct publication usable without a fresh email', async () => {
    const f=await fixture();await stale(f,'member');await stale(f);
    expect((await f.request('/api/sites/'+f.site,'member')).status).toBe(200);
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('No external mail in a synthetic test');}));
    const publication=await f.request('/api/admin/sites/'+f.site+'/publish','owner','POST',{});
    expect(publication.status,JSON.stringify(publication.data)).toBe(200);
    expect(f.sql({sql:'SELECT status FROM sites WHERE id=?',params:[f.site]}).results[0].status).toBe('published');
  });
  it('revokes only the target manager sessions and PIN devices when withdrawing a role', async () => {
    const f=await fixture();await device(f);
    expect((await action(f,'manager',{action:'role',role:'user'})).status).toBe(200);
    expect(f.sql({sql:'SELECT revoked,revocation_reason FROM sessions WHERE user_id=?',params:[f.actors.manager.id]}).results[0]).toEqual({revoked:1,revocation_reason:'authority_changed'});
    expect(f.sql({sql:'SELECT revoked FROM devices WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(1);
    expect((await f.request('/api/admin/overview','manager')).status).toBe(401);
    expect((await f.request('/api/admin/overview','owner')).status).toBe(200);
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[f.actors.member.id]}).results[0].revoked).toBe(0);
  });
  it('revokes credentials when withdrawing financial authority without changing ledger or balances', async () => {
    const f=await fixture();await device(f);
    f.sql({sql:'UPDATE users SET financial=1 WHERE id=?',params:[f.actors.manager.id]});
    const ledger=f.sql({sql:'SELECT * FROM ledger ORDER BY id'}).results;
    const wallets=f.sql({sql:'SELECT * FROM wallets ORDER BY user_id'}).results;
    expect((await action(f,'manager',{action:'role',role:'manager',financial:false})).status).toBe(200);
    expect(f.sql({sql:'SELECT role,financial FROM users WHERE id=?',params:[f.actors.manager.id]}).results[0]).toEqual({role:'manager',financial:0});
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(1);
    expect(f.sql({sql:'SELECT * FROM ledger ORDER BY id'}).results).toEqual(ledger);
    expect(f.sql({sql:'SELECT * FROM wallets ORDER BY user_id'}).results).toEqual(wallets);
  });
  it('a repeated unchanged role/financial/status never forces sign-out', async () => {
    const f=await fixture();await device(f);
    for(const body of [{action:'role',role:'manager',financial:false},{action:'status',status:'active'}])expect((await action(f,'manager',body)).status).toBe(200);
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(0);
    expect(f.sql({sql:'SELECT revoked FROM devices WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(0);
  });
  it('suspend then reactivate cannot revive an old trusted device or session', async () => {
    const f=await fixture();await device(f);
    expect((await action(f,'manager',{action:'status',status:'suspended'})).status).toBe(200);
    expect((await action(f,'manager',{action:'status',status:'active'})).status).toBe(200);
    expect((await f.request('/api/auth/me','manager')).data.user).toBeNull();
    expect(f.sql({sql:'SELECT revoked FROM devices WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(1);
  });
  it('a stale expected tuple fails safely without signing out the account or overwriting a newer role', async () => {
    const f=await fixture();await device(f);
    const before=f.sql({sql:'SELECT id,role,financial,status FROM users WHERE id=?',params:[f.actors.manager.id]}).results[0];
    f.sql({sql:"UPDATE users SET role='moderator' WHERE id=?",params:[before.id]});
    await expect(commitAccountAuthority({env:f.env} as any,before,{role:'user',financial:0,status:'active'})).rejects.toMatchObject({status:409});
    expect(f.sql({sql:'SELECT role FROM users WHERE id=?',params:[before.id]}).results[0].role).toBe('moderator');
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[before.id]}).results[0].revoked).toBe(0);
  });
  it('a database failure rolls back role, session and device changes together', async () => {
    const f=await fixture();await device(f);
    f.sql({sql:`CREATE TRIGGER synthetic_authority_failure BEFORE UPDATE OF role ON users WHEN OLD.id=${f.actors.manager.id} BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END`});
    const result=await action(f,'manager',{action:'role',role:'user'});expect(result.status).toBe(500);
    expect(f.sql({sql:'SELECT role FROM users WHERE id=?',params:[f.actors.manager.id]}).results[0].role).toBe('manager');
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(0);
    expect(f.sql({sql:'SELECT revoked FROM devices WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(0);
  });
  it('a stale actor cannot change authority or invalidate another account', async () => {
    const f=await fixture();await stale(f);
    expect(await action(f,'manager',{action:'role',role:'user'})).toMatchObject({status:403,data:{code:'REAUTH_REQUIRED'}});
    expect(f.sql({sql:'SELECT role FROM users WHERE id=?',params:[f.actors.manager.id]}).results[0].role).toBe('manager');
    expect(f.sql({sql:'SELECT revoked FROM sessions WHERE user_id=?',params:[f.actors.manager.id]}).results[0].revoked).toBe(0);
  });
});

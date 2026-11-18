import { HTTPException } from 'hono/http-exception';
import { type Ctx, type User, now } from './core';

export type AccountAuthority = Pick<User, 'id' | 'role' | 'financial' | 'status'>;

/**
 * D1.batch is transactional. Revoke credentials BEFORE the guarded account update,
 * using the same expected tuple in each statement. This also covers devices used
 * for PIN sign-in. A no-op never signs the account out; a stale tuple changes none.
 * No schema change, audit history rewrite, or financial balance adjustment.
 */
export async function commitAccountAuthority(c: Ctx, before: AccountAuthority, after: Omit<AccountAuthority, 'id'>) {
  if (before.role === after.role && before.financial === after.financial && before.status === after.status) {
    return { changed: false, sessionsRevoked: 0, devicesRevoked: 0 };
  }
  const clock = now();
  const reason = before.role !== after.role || before.financial !== after.financial ? 'authority_changed' : 'account_status_changed';
  const expected = [before.id, before.role, before.financial, before.status];
  const guard = 'EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND financial=? AND status=?)';
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sessions SET revoked=1,revocation_reason=?,expires_at=MIN(expires_at,?) WHERE user_id=? AND revoked=0 AND ${guard}`)
      .bind(reason, clock, before.id, ...expected),
    c.env.DB.prepare(`UPDATE devices SET revoked=1,revocation_reason=?,expires_at=MIN(expires_at,?) WHERE user_id=? AND revoked=0 AND ${guard}`)
      .bind(reason, clock, before.id, ...expected),
    c.env.DB.prepare('UPDATE users SET role=?,financial=?,status=? WHERE id=? AND role=? AND financial=? AND status=?')
      .bind(after.role, after.financial, after.status, ...expected),
  ]);
  if (Number(results[2]?.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(409, { message: 'تغيّرت صلاحية الحساب؛ حدّث بياناته قبل إعادة المحاولة' });
  }
  return { changed: true, sessionsRevoked: Number(results[0]?.meta?.changes ?? 0), devicesRevoked: Number(results[1]?.meta?.changes ?? 0) };
}

import { getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Ctx, User } from './core';
import { digest, now, one, run, uid } from './core';

export function saudiDay(clock = now()) { return new Date((clock + 3 * 3600) * 1000).toISOString().slice(0, 10); }
export type MailRequest = { email: string; account?: string; purpose: string; backup?: boolean; previousChallenge?: string };
export async function reserveMailSlot(c: Ctx, data: MailRequest, user: User | null) {
  const day = saudiDay(), clock = now();
  let requester = getCookie(c, '__Host-ksa_auth_requester');
  if (!requester || !/^[a-f0-9-]{72}$/.test(requester)) {
    requester = uid() + uid();
    setCookie(c, '__Host-ksa_auth_requester', requester, { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 86400 });
  }
  const rawDevice = getCookie(c, '__Host-ksa_device') || '';
  const device = rawDevice ? await one<{ user_id: number }>(c, 'SELECT user_id FROM devices WHERE id=? AND revoked=0 AND expires_at>?', await digest(rawDevice), clock) : null;
  const trusted = Boolean(user && (device?.user_id === user.id || c.get('user')?.id === user.id));
  let bucket = await digest(`${day}|${data.purpose==='reauth'?'step-up:'+Math.floor(clock/900):data.purpose==='recover'?'recovery':'ordinary'}|${trusted ? 'trusted:' + user!.id : 'new:' + data.email + ':' + (data.account || '') + ':' + requester}`);
  if (data.purpose === 'reauth' && (!user || c.get('user')?.id !== user.id)) throw new HTTPException(401, { message: 'ادخل إلى حسابك أولاً لإتمام إجراء الأمان' });
  if (data.backup) {
    const previous = data.previousChallenge ? await one<{ payload: string; email: string; purpose: string; created_at: number }>(c, 'SELECT payload,email,purpose,created_at FROM auth_codes WHERE id=?', data.previousChallenge) : null;
    const payload = previous ? JSON.parse(previous.payload) : null;
    if (!previous || previous.email !== data.email || previous.purpose !== data.purpose || payload.account !== data.account || saudiDay(previous.created_at) !== day || payload.nonce !== await digest(getCookie(c, '__Host-ksa_challenge') || '')) {
      throw new HTTPException(400, { message: 'اطلب الرسالة الاحتياطية من شاشة الرمز نفسها' });
    }
    bucket = payload.mailBucket || bucket;
    if(!payload.mailBucket)await run(c,'INSERT OR IGNORE INTO auth_mail_daily_limits(bucket,user_id,day_key,primary_used,updated_at) VALUES(?,?,?,1,?)',bucket,user?.id||null,day,clock);
  }
  await run(c, 'INSERT OR IGNORE INTO auth_mail_daily_limits(bucket,user_id,day_key,updated_at) VALUES(?,?,?,?)', bucket, user?.id || null, day, clock);
  const column = data.backup ? 'backup_used' : 'primary_used';
  const claimed = await run(c, `UPDATE auth_mail_daily_limits SET ${column}=1,updated_at=? WHERE bucket=? AND ${column}=0 ${data.backup ? 'AND primary_used=1' : ''}`, clock, bucket);
  if (!claimed.meta.changes) throw new HTTPException(429, { message: data.backup ? 'استُخدمت الرسالة الاحتياطية اليوم. استخدم رمزك الأخير أو PIN على جهازك الموثوق.' : 'طلبت رمز البريد اليوم. استخدم الرمز الأخير أو PIN على جهازك الموثوق؛ يمكنك طلب احتياط واحد من شاشة الرمز.' });
  return { bucket, column, trusted };
}
export async function releaseMailSlot(c: Ctx, slot: { bucket: string; column: string }) {
  const column = slot.column === 'backup_used' ? 'backup_used' : 'primary_used';
  await run(c, `UPDATE auth_mail_daily_limits SET ${column}=0 WHERE bucket=?`, slot.bucket);
}

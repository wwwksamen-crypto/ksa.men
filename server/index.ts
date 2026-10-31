import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie } from 'hono/cookie';
import { ZodError } from 'zod';
import { type Bindings, type Session, type User, type Env, one, now, digest, hmac, verifySecret, rate, setting, safeUrl, publicProfile } from './core';
import { registerAuth } from './auth';
import {registerPreview} from './preview';
import { registerOG,personalizedHTML } from './og';
import { registerBackup, makeBackup } from './backup';
import { registerBusiness } from './business';
import { registerOperations } from './operations';
import { registerIntelligence, fetchRadar } from './intelligence';
import { registerPublic, publishedForHost, personalGate } from './public';
import { runDataLifecycle } from './lifecycle';

const app = new Hono<Bindings>();
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const staticPath = (path: string) => path.startsWith('/assets/') || ['/favicon.ico', '/sw.js', '/manifest.webmanifest', '/offline.html', '/gate.js', '/bootstrap.js'].includes(path);
function security(c: any, isStatic = false) {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=31536000');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  c.header('Cache-Control', isStatic && ((c.res.status >= 200 && c.res.status < 300) || c.res.status === 304) ? (/[-.][A-Za-z0-9_-]{8,}\.(js|css)$/.test(new URL(c.req.url).pathname) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600') : 'private, no-store');
}
async function gate(c: any, lock: any) {
  const value = getCookie(c, '__Host-ksa_gate') || '';
  const [expiry, signature] = value.split('.');
  if (!lock.passwordHash || Number(expiry) <= now()) return false;
  const expected = await hmac(c.env.AUTH_SECRET, expiry + ':' + lock.passwordHash + ':' + new URL(c.req.url).hostname);
  // Existing root-origin gate cookies remain valid until they expire; they are host-only.
  const legacy = new URL(c.req.url).hostname === c.env.ROOT_DOMAIN ? await hmac(c.env.AUTH_SECRET, expiry + ':' + lock.passwordHash) : '';
  return signature === expected || (!!legacy && signature === legacy);
}

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const root = c.env.ROOT_DOMAIN;
  const host = url.hostname;
  const path = url.pathname;
  c.set('user', null);
  c.set('session', null);
  security(c, staticPath(path));
  if (host === 'www.' + root) return c.redirect('https://' + root + path + url.search, 308);
  const local = ['localhost', '127.0.0.1'].includes(host);
  const rootHost = host === root || local;
  const ownedHost = new RegExp('^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(host);
  if (!rootHost && !ownedHost) throw new HTTPException(404);
  if (!rootHost && ['/manifest.webmanifest', '/sw.js'].includes(path)) throw new HTTPException(404);

  // Public application assets contain no account data; no session/settings queries are needed.
  if (staticPath(path)) { await next(); security(c, true); return; }
  const rawCookie = getCookie(c, '__Host-ksa_session');
  if (rootHost && rawCookie) {
    const session = await one<Session>(c, 'SELECT * FROM sessions WHERE id=? AND revoked=0 AND expires_at>?', await digest(rawCookie), now());
    if (session) {
      const user = await one<User>(c, "SELECT * FROM users WHERE id=? AND status='active'", session.user_id);
      if (user) { c.set('user', user); c.set('session', session); }
    }
  }
  const lock: any = await setting(c, 'lock', { mode: 'private' });
  const staff = ['owner', 'manager', 'moderator'].includes(c.get('user')?.role || '');
  const gateOk = await gate(c, lock);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('Origin') !== url.origin) throw new HTTPException(403, { message: 'مصدر الطلب غير مسموح' });
    const session = c.get('session');
    if (session && !['/api/auth/request', '/api/auth/verify'].includes(path) && c.req.header('X-CSRF-Token') !== session.csrf) throw new HTTPException(403, { message: 'فشل التحقق من أمان الطلب' });
  }
  const safeGlobal = ['/api/platform', '/api/gate'].includes(path);
  if (!rootHost && path.startsWith('/api/') && !safeGlobal && !path.startsWith('/api/public/') && !path.startsWith('/api/media/')) throw new HTTPException(404);
  const homeClosed = lock.mode === 'home';
  const blocked = lock.mode !== 'open' && (!homeClosed || path === '/' || path === '/index.html' || path === '/api/search');
  const exempt = safeGlobal || (rootHost && path.startsWith('/api/auth/')) || (rootHost && ['/auth', '/admin', '/privacy', '/terms'].includes(path));
  if (blocked && !staff && !gateOk && !exempt) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (path.startsWith('/api/')) throw new HTTPException(423, { message: lock.message || 'المنصة مقفلة' });
    // Root keeps the interactive SPA gate; subdomains use an origin-local gate form.
    if (!rootHost) return c.html(lockHTML(c, lock), 423);
  }
  if (!rootHost && !path.startsWith('/api/')) {
    const site = await publishedForHost(c);
    if (site.published && await personalGate(c, site)) {
      const profile = publicProfile(JSON.parse(site.published));
      if (profile.redirect && safeUrl(profile.redirect)) return c.redirect(profile.redirect, 302);
    }
  }
  await next();
  security(c);
  if (lock.mode !== 'open') c.header('X-Robots-Tag', 'noindex, nofollow');
});
function lockHTML(c: any, lock: any) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSA.MEN — ${escape(lock.reason || 'صيانة')}</title><style>@font-face{font-family:Tajawal;src:url('/assets/Tajawal-Regular.ttf')}body{margin:0;background:#07120f;color:#f5f7f6;font-family:Tajawal,Arial;min-height:100vh;display:grid;place-items:center}main{padding:30px;text-align:center;width:min(90vw,460px);box-sizing:border-box;border:1px solid #294237;border-radius:24px;background:#0b1b14}img{max-width:190px;width:50%}input,button{font:inherit;border:1px solid #345342;border-radius:12px;padding:14px;box-sizing:border-box;width:100%;margin-top:12px}input{background:#10291c;color:white}button{background:#006837;color:white}a{color:#88e8b2}#error{color:#ffc7b7}</style></head><body><main><img src="/assets/logo.webp" alt="KSA.MEN"><h1>${escape(lock.reason || 'صيانة')}</h1><p>${escape(lock.message || 'ظهور رقمي يليق بك')}</p>${lock.passwordHash ? '<form id="gate"><input id="password" type="password" autocomplete="current-password" aria-label="كلمة مرور الدخول الخاص" placeholder="كلمة مرور الدخول الخاص" required><button>دخول</button><p id="error" role="alert"></p></form><script src="/gate.js" defer></script>' : ''}<p><a href="https://${c.env.ROOT_DOMAIN}/auth">دخول الحساب والإدارة</a></p></main></body></html>`;
}
app.get('/api/platform', async c => {
  const lock: any = await setting(c, 'lock', { mode: 'private' });
  return c.json({ lock: { mode: lock.mode, message: lock.message, reason: lock.reason, passwordEnabled: !!lock.passwordHash }, access: lock.mode === 'open' || ['owner', 'manager', 'moderator'].includes(c.get('user')?.role || '') || await gate(c, lock), contact: await setting(c, 'contact'), season: await setting(c, 'season') });
});
app.post('/api/gate', async c => {
  const lock: any = await setting(c, 'lock');
  await rate(c, 'gate:' + new URL(c.req.url).hostname + ':' + c.req.header('CF-Connecting-IP'), 6, 900);
  const { password } = await c.req.json<any>();
  if (!lock.passwordHash || typeof password !== 'string' || !await verifySecret(password, lock.passwordHash)) throw new HTTPException(403, { message: 'كلمة مرور البوابة غير صحيحة' });
  const expiry = now() + 6 * 3600;
  setCookie(c, '__Host-ksa_gate', expiry + '.' + await hmac(c.env.AUTH_SECRET, expiry + ':' + lock.passwordHash + ':' + new URL(c.req.url).hostname), { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 6 * 3600 });
  return c.json({ ok: true });
});
registerPreview(app);
registerOG(app);
registerBackup(app);
registerAuth(app);
registerPublic(app);
registerBusiness(app);
registerOperations(app);
registerIntelligence(app);
app.get('/robots.txt', async c => {
  const lock: any = await setting(c, 'lock');
  return c.text(lock.mode === 'open' ? 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /api/\n' : 'User-agent: *\nDisallow: /\n');
});
app.get('*', async c => {
  const path = new URL(c.req.url).pathname;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(path === '/' ? '/index.html' : path, c.req.url), c.req.raw));
  // Preserve conditional (304), range (206) and missing-asset responses unchanged.
  if (staticPath(path)) return asset;
  if (asset.status === 200) { if(new URL(c.req.url).hostname!==c.env.ROOT_DOMAIN&&path==='/')return c.html(await personalizedHTML(c,await asset.text()));return asset; }
  if (path.startsWith('/assets/') || path.includes('.') || path.startsWith('/api/')) throw new HTTPException(404);
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw));
});
app.onError((error, c) => {
  security(c);
  if (error instanceof ZodError) return c.json({ error: error.issues.map(issue => issue.message).join('،') }, 400);
  if (error instanceof HTTPException) {
    const response = error.getResponse();
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      return c.newResponse(response.body, error.status, Object.fromEntries(response.headers));
    }
    return c.json({ error: error.message || 'تعذر تنفيذ الطلب' }, error.status);
  }
  if (error instanceof SyntaxError) return c.json({ error: 'صيغة البيانات غير صحيحة' }, 400);
  console.error('KSA request failed', error.name);
  return c.json({ error: 'تعذر إتمام العملية بأمان، حاول مجددًا' }, 500);
});
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(fetchRadar(env));
    ctx.waitUntil(runDataLifecycle(env));
    if (new Date(event.scheduledTime).getUTCHours() === 0) ctx.waitUntil(makeBackup(env));
  },
};

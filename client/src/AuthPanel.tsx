import { captureReferral, clearReferral, trackReferral } from './referral-source';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpLeft, Check, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api, Button, setCSRF, useApp, type User } from './lib';

type Props = { embedded?: boolean; purpose?: 'login' | 'reauth'; initialEmail?: string; account?: string; expectedUserId?: number; onAuthenticated?: (user: User) => void | Promise<void> };
const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660))).replace(/\D/g, '');
function destination(role: string) {
  const staff = ['owner', 'manager', 'moderator'].includes(role), back = new URLSearchParams(location.search).get('return');
  if (back && back.length < 2048 && (/^\/dashboard(?:[?#]|$)/.test(back) || (staff && /^\/admin(?:[?#]|$)/.test(back)))) return back;
  return staff ? '/admin' : '/dashboard';
}
export default function AuthPanel({ embedded = false, purpose, initialEmail, account, expectedUserId, onAuthenticated }: Props) {
  const { user, t, refresh, notify } = useApp();
  const params = new URLSearchParams(location.search), accountName = account ?? params.get('account') ?? '';
  const [referral, setReferral] = useState(() => embedded ? '' : captureReferral(location.search));
  const [mode, setMode] = useState(purpose || (params.has('reauth') ? 'reauth' : !user && (params.has('register') || referral) ? 'register' : 'login'));
  useEffect(() => { if (referral && !embedded && !user) void trackReferral(referral, code => api('/api/public/referral-visit', { method: 'POST', body: JSON.stringify({ code }) })); }, [referral, embedded, user?.id]);
  const [email, setEmail] = useState(initialEmail ?? user?.email ?? ''), [name, setName] = useState(''), [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false), [challenge, setChallenge] = useState(''), [code, setCode] = useState(''), [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [quick, setQuick] = useState(embedded && purpose !== 'reauth'), [showPin, setShowPin] = useState(false), [backupUsed, setBackupUsed] = useState(false);
  const pending = useRef(false), emailInput = useRef<HTMLInputElement>(null), codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (embedded) emailInput.current?.focus(); }, [embedded]);
  useEffect(() => { if (challenge) codeInput.current?.focus(); }, [challenge]);
  function changeMethod(next: string, usePin = false) {
    if (pending.current) return;
    setMode(next); setQuick(usePin); setChallenge(''); setCode(''); setPin(''); setShowPin(false); setError(''); setBackupUsed(false);
  }
  async function finish(result: { csrf: string; user: User }) {
    if (expectedUserId !== undefined && result.user?.id !== expectedUserId) throw new Error(t('ادخل بالحساب الذي كنت تعمل به لمتابعة عملك.', 'Use the account you were editing with to continue.'));
    if (!embedded) clearReferral();
    setCSRF(result.csrf); await refresh({ ...result.user, email: email.trim().toLowerCase(), ...(accountName ? { account: accountName } : {}) });
    if (onAuthenticated) await onAuthenticated(result.user); else location.assign(destination(result.user.role));
  }
  async function requestCode(backup = false) {
    const normalized = email.trim().toLowerCase();
    const result = await api<{ challenge: string; message: string; backup?: boolean }>('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: normalized, account: accountName || undefined, expectedUserId, purpose: mode, backup, previousChallenge: backup ? challenge : undefined, ...(mode === 'register' ? { name: name.trim(), whatsapp: phone.trim(), consent: agree, ageConfirmed: agree, eligibilityConfirmed: agree, referral: referral || undefined } : {}) }) });
    setEmail(normalized); setChallenge(result.challenge); setCode(''); if (backup) setBackupUsed(true); notify(result.message);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try {
      if (quick) await finish(await api('/api/auth/quick', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), pin, account: accountName || undefined, expectedUserId }) }));
      else if (!challenge) await requestCode();
      else await finish(await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ challenge, code, ...(mode === 'register' && pin ? { pin } : {}) }) }));
    } catch (e) { setError(e instanceof Error ? e.message : t('تعذر الدخول. حاول من جديد.', 'Sign-in failed. Please retry.')); }
    finally { pending.current = false; setBusy(false); }
  }
  async function backup() {
    if (pending.current || !challenge || backupUsed) return; pending.current = true; setBusy(true); setError('');
    try { await requestCode(true); } catch (e) { setError(e instanceof Error ? e.message : t('تعذر طلب الاحتياط.', 'Could not request the backup.')); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={embedded ? 'auth-embedded' : 'auth-page'}>{!embedded && <section className="auth-story"><div className="auth-mark"><img src="/assets/logo-emblem.webp" alt=""/></div><span className="eyebrow">{t('الخطوة الأولى إلى حضورك', 'YOUR NEXT CHAPTER')}</span><h1>{t('اسمك عنوانك.', 'Your name. Your address.')}<br/><span>{t('والقصة قصتك.', 'The story is yours.')}</span></h1><p>{t('مساحة مهنية للرجال السعوديين والمقيمين والمحبين للمملكة، تبدأ بخطوة بسيطة.', 'A professional space for Saudi men, residents, and people who value the Kingdom. Start with one simple step.')}</p><img src="/assets/cover-720.webp" alt=""/><div className="auth-benefits"><p><Check/>{t('عنوان مستقل يحمل اسمك', 'An independent address')}</p><p><Check/>{t('٧ أيام مجانية لجميع المزايا', '7 free days with every feature')}</p><p><ShieldCheck/>{t('دخول آمن بالبريد وPIN', 'Secure email and PIN sign-in')}</p></div></section>}<section className={embedded ? 'auth-embedded-card' : 'auth-card card'}>
    {!embedded && <div className="auth-card-top"><span className="eyebrow">{t('مساحتك الخاصة', 'YOUR OWN SPACE')}</span><ShieldCheck size={21}/></div>}
    <h2>{quick ? t('الدخول السريع', 'Email & PIN sign-in') : challenge ? t('تحقق من بريدك', 'Check your email') : mode === 'register' ? t('أنشئ موقعك', 'Create your site') : mode === 'recover' ? t('استرجاع الحساب', 'Recover your account') : mode === 'reauth' ? t('أكمل تأكيد حسابك', 'Confirm your account') : t('عوداً مرحباً', 'Welcome back')}</h2>
    <p className="muted">{challenge ? <>{t('تحقق من رسالة الرمز في بريدك:', 'Check your email for the code:')} <bdi dir="ltr">{email}</bdi></> : quick ? t('بريد الحساب وPIN على جهازك الموثوق.', 'Your account email and PIN on your trusted device.') : t('يُستخدم رمز البريد لإثبات أن الحساب لك.', 'An email code confirms that this account belongs to you.')}</p>
    {!challenge && mode === 'register' && referral && <div className="auth-referral-notice"><ShieldCheck size={17}/><p>{t('وصلت عبر دعوة إلى KSA.MEN. يُحفظ مصدرها لإتمام التسجيل فقط، حتى 30 يوماً. لا يؤثر ذلك في سعر عضويتك.', 'You arrived through a KSA.MEN invitation. Its source is retained only to complete registration, for up to 30 days. It does not change your membership price.')}</p><button type="button" disabled={busy} onClick={() => { clearReferral(); setReferral(''); }}>{t('إزالة الدعوة', 'Remove invitation')}</button></div>}
    {!challenge && !['register', 'reauth'].includes(mode) && <div className="auth-methods" role="group" aria-label={t('طريقة الدخول', 'Sign-in method')}><button type="button" disabled={busy} aria-pressed={!quick} className={!quick ? 'selected' : ''} onClick={() => changeMethod('login')}><Mail size={16}/>{t('رمز البريد', 'Email code')}</button><button type="button" disabled={busy} aria-pressed={quick} className={quick ? 'selected' : ''} onClick={() => changeMethod('login', true)}><LockKeyhole size={16}/><bdi>PIN</bdi></button></div>}
    <form onSubmit={submit} className="stack" aria-busy={busy}>
      {!challenge && <label className="field"><span>{t('البريد الإلكتروني', 'Email')}</span><input ref={emailInput} required readOnly={embedded && Boolean(initialEmail)} type="email" name="email" autoComplete={quick ? 'username' : 'email'} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" dir="ltr" autoCapitalize="none" spellCheck={false}/></label>}
      {!quick && !challenge && mode === 'register' && <><label className="field"><span>{t('اسمك', 'Your name')}</span><input required name="name" minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} autoComplete="name"/></label><label className="field"><span>{t('رقم واتساب', 'WhatsApp')}</span><input required name="whatsapp" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" dir="ltr" placeholder="05xxxxxxxx"/></label><label className="check-label"><input type="checkbox" required checked={agree} onChange={e => setAgree(e.target.checked)}/><span>{t('أقر ببلوغي 18 عاماً وانطباق فئة المنصة عليّ، وأوافق على', 'I confirm I am 18 or older, eligible, and agree to the')} <a href="/privacy" target="_blank" rel="noreferrer">{t('سياسة الخصوصية', 'privacy policy')}</a> {t('و', 'and')} <a href="/terms" target="_blank" rel="noreferrer">{t('سياسة الاستخدام', 'terms')}</a>، {t('وأقر بصحة بياناتي.', 'and confirm my data is accurate.')}</span></label></>}
      {challenge && <label className="field"><span>{t('رمز التحقق — ٦ أرقام', 'Verification code — 6 digits')}</span><input ref={codeInput} className="otp" required name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(digits(e.target.value))} dir="ltr"/></label>}
      {(quick || (challenge && mode === 'register')) && <label className="field"><span>{quick ? 'PIN' : t('اختر PIN من ٦ أرقام لجهازك الموثوق', 'Choose a 6-digit PIN for your trusted device')}</span><input required name="pin" inputMode="numeric" type={showPin ? 'text' : 'password'} autoComplete={quick ? 'current-password' : 'new-password'} pattern="[0-9]{6}" maxLength={6} value={pin} onChange={e => setPin(digits(e.target.value))} dir="ltr"/><button className="text-link" type="button" aria-pressed={showPin} onClick={() => setShowPin(!showPin)}>{showPin ? t('إخفاء PIN', 'Hide PIN') : t('إظهار PIN', 'Show PIN')}</button></label>}
      {error && <p className="error" role="alert">{error}</p>}
      <Button disabled={busy} className="primary">{busy ? t('لحظة من فضلك…', 'One moment…') : challenge ? t('تحقق وادخل', 'Verify & sign in') : quick ? t('دخول', 'Sign in') : t('أرسل رمز التحقق', 'Send verification code')}<ArrowUpLeft size={18}/></Button>
    </form>
    <div className="auth-links">{challenge ? <><button type="button" disabled={busy || backupUsed} onClick={() => void backup()}>{backupUsed ? t('تم طلب الرسالة الاحتياطية', 'Backup message requested') : t('لم يصلك الرمز؟ اطلب رسالة احتياطية', 'No code? Request one backup message')}</button>{mode !== 'reauth' && <button type="button" disabled={busy} onClick={() => changeMethod('login', true)}>{t('الدخول باستخدام PIN', 'Sign in with PIN')}</button>}</> : !embedded && <><button type="button" disabled={busy} onClick={() => changeMethod(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? t('لديك حساب؟ ادخل', 'Already a member? Sign in') : t('أول زيارة؟ أنشئ حسابك', 'New here? Create an account')}</button>{mode !== 'reauth' && <button type="button" disabled={busy} onClick={() => changeMethod('recover')}>{t('استرجاع الحساب', 'Recover account')}</button>}</>}
    <p className="auth-security-note">{t('رمز بريد واحد عند الحاجة في اليوم، ثم PIN على جهازك الموثوق. يمكنك طلب رسالة احتياطية واحدة. قد نطلب تحققاً مستقلاً لجهاز جديد أو لحماية حسابك.', 'One email code when needed each day, then PIN on your trusted device. You can request one backup message. A new device or account protection may require separate verification.')}</p></div>
  </section></div>;
}

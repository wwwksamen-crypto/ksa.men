import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { api, setCSRF, useApp } from './lib';

export default function ManagedClaim() {
  const { t } = useApp();
  const token = new URLSearchParams(location.search).get('claim') || '';
  const [account, setAccount] = useState<{ name: string; subdomain: string } | null>(null);
  const [pin, setPin] = useState(''), [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<{ name: string; subdomain: string }>(`/api/auth/managed-claim?token=${encodeURIComponent(token)}`).then(setAccount).catch(e => setError(e.message)); }, [token]);
  async function accept(event: FormEvent) {
    event.preventDefault(); if (!account || busy || !agree) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ csrf: string }>('/api/auth/managed-claim', { method: 'POST', body: JSON.stringify({ token, pin, agree }) });
      setCSRF(result.csrf); history.replaceState({}, '', '/dashboard'); location.href = '/dashboard';
    } catch (e) { setError(e instanceof Error ? e.message : t('تعذر استلام الحساب', 'Could not accept this account')); }
    finally { setBusy(false); }
  }
  return <div className="page"><section className="card stack" style={{ maxWidth: 520, marginInline: 'auto' }}><ShieldCheck size={32}/><h1>{t('هويتك جاهزة لك', 'Your identity is ready')}</h1>{account && <><h2>{account.name}</h2><bdi dir="ltr">{account.subdomain}.ksa.men</bdi><p>{t('اضبط رمزك الشخصي لتستلم إدارة حسابك. لا يمكن استلامه مرة أخرى بهذا الرابط.', 'Set your PIN to take control of your account. This invitation can only be accepted once.')}</p><form className="stack" onSubmit={accept}><label className="field"><span>{t('رمز دخول من ستة أرقام', 'Six-digit PIN')}</span><input required type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={6} pattern="[0-9]{6}" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}/></label><label className="check"><input required type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)}/><span>{t('أقر ببلوغ 18 عاماً وانطباق فئة المنصة، وأوافق على', 'I confirm I am 18 or older, meet platform eligibility, and agree to the')} <a href="/privacy" target="_blank" rel="noreferrer">{t('سياسة الخصوصية', 'Privacy policy')}</a> {t('و', 'and')} <a href="/terms" target="_blank" rel="noreferrer">{t('الاستخدام', 'Terms')}</a>.</span></label><button className="button primary" disabled={busy || pin.length !== 6 || !agree}><Check size={18}/>{busy ? t('جارٍ الاستلام', 'Accepting') : t('استلام حسابي', 'Accept my account')}</button></form></>}{error && <p role="alert">{error}</p>}{!account && !error && <p>{t('نجهّز دعوتك', 'Loading your invitation')}</p>}</section></div>;
}

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from './lib';
import AuthPanel from './AuthPanel';

export default function SessionReturn() {
  const { user, t, lang, notify } = useApp();
  const [reason, setReason] = useState<'login' | 'reauth' | null>(null), [saved, setSaved] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const required = (event: Event) => { if (!user) return; const detail = (event as CustomEvent).detail; setReason(current => current || (detail?.reason === 'reauth' ? 'reauth' : 'login')); setSaved(false); };
    window.addEventListener('ksa:session-required', required);
    return () => window.removeEventListener('ksa:session-required', required);
  }, [user?.id]);
  useEffect(() => {
    if (!reason) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current; if (!node) return; node.showModal();
    return () => { node.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, [reason]);
  if (!reason || !user) return null;
  return <dialog className="session-return" ref={dialog} aria-labelledby="session-return-title" dir={lang === 'ar' ? 'rtl' : 'ltr'} onCancel={event => { event.preventDefault(); setReason(null); }}><header><h1 id="session-return-title">{t('لنكمل من حيث توقفت', 'Continue where you left off')}</h1><button className="icon-button" aria-label={t('إغلاق والعودة إلى عملي', 'Close and return to my work')} onClick={() => setReason(null)}><X size={20}/></button></header><p className="muted">{t('عملك باقٍ في هذه الصفحة. ادخل بالحساب نفسه لمتابعة الحفظ والإجراءات.', 'Your work remains on this page. Sign in with the same account to continue saving and working.')}</p><AuthPanel embedded purpose={reason} initialEmail={user.email} expectedUserId={user.id} account={String((user as unknown as { account?: string }).account || '')} onAuthenticated={() => { setReason(null); setSaved(true); window.dispatchEvent(new Event('ksa:session-restored')); notify(t('أهلاً بعودتك. يمكنك متابعة عملك.', 'Welcome back. Continue your work.')); }}/>{saved && <span className="sr-only" role="status">{t('عادت جلستك', 'Session restored')}</span>}</dialog>;
}

import { useEffect, useRef, useState } from 'react';
import { Trash2, ShieldAlert } from 'lucide-react';
import { api, useApp } from './lib';
import './owner-erasure.css';

type Impact = { impactToken: string; siteCount: number; mediaCount: number; holdKinds: string[]; alreadyErased: boolean; versions: { id: string; draft: number; published: number }[] };
type Result = { erased?: boolean; requestId?: string; mediaRemoval?: string };
export default function OwnerErasurePanel({ accountId, siteId, accountLabel, siteLabel, onErase, onAudit }: {
  accountId: string; siteId: string; accountLabel?: string; siteLabel?: string;
  onErase: (path: string, body: Record<string, unknown>) => Promise<unknown>; onAudit?: () => void;
}) {
  const { t } = useApp();
  const [scope, setScope] = useState<'account' | 'site'>(siteId ? 'site' : 'account');
  const [open, setOpen] = useState(false), [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const requestSequence = useRef(0), acting = useRef(false);
  const id = scope === 'account' ? accountId : siteId, resource = scope === 'account' ? 'users' : 'sites';
  const target = scope === 'account' ? `${accountLabel || t('الحساب', 'Account')} — C${accountId}` : (siteLabel || siteId);
  useEffect(() => {
    requestSequence.current++; acting.current = false;
    setScope(siteId ? 'site' : 'account'); setOpen(false); setImpact(null); setReason(''); setError(''); setBusy(false); setResult(null);
    return () => { requestSequence.current++; };
  }, [accountId, siteId]);
  const changeScope = (next: 'account' | 'site') => {
    requestSequence.current++; setScope(next); setImpact(null); setError(''); setResult(null);
  };
  const review = async () => {
    if (!id || acting.current || reason.trim().length < 8) return;
    acting.current = true; setBusy(true); setError('');
    const sequence = ++requestSequence.current;
    try {
      const response = await api<Impact>(`/api/admin/${resource}/${encodeURIComponent(id)}/erasure-impact`);
      if (sequence === requestSequence.current) setImpact(response);
    } catch (failure) {
      if (sequence === requestSequence.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (sequence === requestSequence.current) { acting.current = false; setBusy(false); } }
  };
  const erase = async () => {
    if (!impact || impact.alreadyErased || impact.holdKinds.length || acting.current || reason.trim().length < 8) return;
    acting.current = true; setBusy(true); setError('');
    const sequence = requestSequence.current;
    try {
      // The final button is the explicit affirmation; exact IDs and versions are never taken from an editable field.
      const response = await onErase(`/api/admin/${resource}/${encodeURIComponent(id)}/erase`, {
        reason: reason.trim(), confirmation: id, affirmation: true, versions: impact.versions, impactToken: impact.impactToken,
      }) as Result | undefined;
      if (!response?.erased) throw new Error(t('لم تتأكد الإزالة. راجع السجل قبل إعادة المحاولة.', 'Removal was not confirmed. Review the record before retrying.'));
      if (sequence === requestSequence.current) setResult(response);
    } catch (failure) {
      if (sequence === requestSequence.current) { setError(failure instanceof Error ? failure.message : String(failure)); setImpact(null); }
    } finally { if (sequence === requestSequence.current) { acting.current = false; setBusy(false); } }
  };
  return <section className="owner-erasure">
    <button type="button" className="owner-erasure__heading owner-erasure__toggle" aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); setImpact(null); }}>
      <Trash2 size={18}/><span>{t('حذف موقع أو حساب', 'Delete a site or account')}</span>
    </button>
    {open && <>
      <p>{t('تحذف بيانات الهوية والموقع نهائياً من الخدمة. تبقى السجلات المالية والتدقيقية وأدلة المراجعة المطلوبة، وتُتابَع إزالة الملفات في طابور موثق.', 'Identity and website data are permanently removed from service. Required financial, audit and review evidence remains; file removal is tracked in a documented queue.')}</p>
      {!result && <>
        <label>{t('ما الذي تريد حذفه؟', 'What should be removed?')}
          <select disabled={busy} value={scope} onChange={event => changeScope(event.target.value as typeof scope)}>
            <option value="site" disabled={!siteId}>{t('الموقع فقط — يبقى الحساب', 'Website only — keep account')}</option>
            <option value="account">{t('الحساب وجميع مواقعه', 'Account and all its websites')}</option>
          </select>
        </label>
        <p className="owner-erasure__target"><strong>{t('الهدف', 'Target')}: </strong><bdi dir="auto">{target}</bdi></p>
        <label>{t('سبب الحذف — 8 أحرف على الأقل', 'Reason — at least 8 characters')}
          <textarea dir="auto" rows={2} value={reason} maxLength={1000} disabled={busy} onChange={event => { setReason(event.target.value); setImpact(null); }}/>
        </label>
        {!impact && <button className="button button-quiet" type="button" disabled={busy || !id || reason.trim().length < 8} onClick={() => void review()}>
          {busy ? t('جارٍ مراجعة الأثر…', 'Reviewing impact…') : t('مراجعة أثر الإزالة', 'Review removal impact')}
        </button>}
        {impact && <div className="owner-erasure__confirmation" role="region" aria-label={t('تأكيد الحذف', 'Confirm deletion')}>
          <p><ShieldAlert size={18}/> {t(`سيُحذف ${impact.siteCount} موقع، ويُحجب ${impact.mediaCount} ملف فوراً. لا يمكن التراجع عن هذا القرار.`, `${impact.siteCount} websites will be removed and ${impact.mediaCount} files blocked immediately. This decision cannot be reversed.`)}</p>
          {impact.alreadyErased ? <p role="status">{t('هذا المورد مزال بالفعل.', 'This resource is already removed.')}</p> : impact.holdKinds.length ? <p role="alert">{t('تمنع حصانة احتفاظ أو بلاغ مفتوح الحذف. راجع السجل.', 'A retention hold or open report blocks deletion. Review the record.')}</p> : <div className="owner-erasure__actions">
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void erase()}>{busy ? t('جارٍ تنفيذ الحذف…', 'Removing…') : t('تأكيد الحذف النهائي', 'Confirm permanent deletion')}</button>
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => { setImpact(null); setOpen(false); }}>{t('إلغاء', 'Cancel')}</button>
          </div>}
        </div>}
      </>}
      {result && <div role="status"><p>{t('أزيلت الهوية من الخدمة وحُفظ إثبات القرار. يتابع السجل إزالة الملفات.', 'Identity removed from service and decision evidence saved. File removal is tracked in the record.')}</p><bdi dir="ltr">{result.requestId}</bdi></div>}
      {onAudit && <button type="button" className="member-text-action" disabled={busy} onClick={onAudit}>{t('فتح السجل', 'Open record')}</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </>}
  </section>;
}

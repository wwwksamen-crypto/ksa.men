import { useEffect, useRef, useState } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { api, useApp } from './lib';
import './owner-erasure.css';

type Mode = 'site' | 'account_only' | 'both';
type Impact = { impactToken: string; siteCount: number; retainedSiteCount?: number; mediaCount: number; holdKinds: string[]; alreadyErased: boolean; versions: { id: string; draft: number; published: number }[] };
type Result = { erased?: boolean; requestId?: string; mediaRemoval?: string; retainedSiteCount?: number };
export default function OwnerErasurePanel({ accountId, siteId, accountLabel, siteLabel, onErase, onAudit, openRequest = 0 }: {
  accountId: string; siteId: string; accountLabel?: string; siteLabel?: string; openRequest?: number;
  onErase: (path: string, body: Record<string, unknown>) => Promise<unknown>; onAudit?: () => void;
}) {
  const { t } = useApp();
  const [mode, setMode] = useState<Mode>(siteId ? 'site' : 'account_only');
  const [open, setOpen] = useState(false), [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const sequence = useRef(0), acting = useRef(false);
  const id = mode === 'site' ? siteId : accountId, resource = mode === 'site' ? 'sites' : 'users';
  const base = `/api/admin/${resource}/${encodeURIComponent(id)}`;
  const impactURL = base + '/erasure-impact' + (mode === 'account_only' ? '?mode=account_only' : '');
  const target = mode === 'site' ? (siteLabel || siteId) : `${accountLabel || t('الحساب', 'Account')} — C${accountId}`;
  useEffect(() => {
    sequence.current++; acting.current = false;
    setMode(siteId ? 'site' : 'account_only'); setOpen(false); setImpact(null); setReason(''); setError(''); setBusy(false); setResult(null);
    return () => { sequence.current++; };
  }, [accountId, siteId]);
  useEffect(() => {
    if (!openRequest) return;
    setMode('account_only'); setOpen(true);
    requestAnimationFrame(() => document.querySelector('.owner-erasure')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
  }, [openRequest]);
  useEffect(() => {
    const current = ++sequence.current;
    if (!open || !id || result) return;
    setLoading(true); setImpact(null); setError('');
    void api<Impact>(impactURL).then(value => { if (current === sequence.current) setImpact(value); })
      .catch(failure => { if (current === sequence.current) setError(failure instanceof Error ? failure.message : String(failure)); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [open, impactURL, result]);
  const erase = async () => {
    if (!id || !reason.trim() || acting.current || impact?.holdKinds.length || impact?.alreadyErased) return;
    acting.current = true; setBusy(true); setError('');
    const current = sequence.current;
    try {
      // Read the current snapshot automatically; the clicked final button is the single explicit confirmation.
      const latest = await api<Impact>(impactURL);
      if (current !== sequence.current) return;
      setImpact(latest);
      if (latest.holdKinds.length) throw new Error(t('توجد حصانة احتفاظ أو بلاغ مفتوح يمنع الحذف. راجع السجل.', 'A retention hold or open report prevents deletion. Review the record.'));
      if (latest.alreadyErased) { setResult({ erased: true }); return; }
      const response = await onErase(base + '/erase', {
        reason: reason.trim(), confirmation: id, affirmation: true, versions: latest.versions, impactToken: latest.impactToken,
        ...(mode === 'account_only' ? { mode: 'account_only' } : {}),
      }) as Result | undefined;
      if (!response?.erased) throw new Error(t('لم تتأكد الإزالة. راجع السجل قبل إعادة المحاولة.', 'Removal was not confirmed. Review the record before retrying.'));
      if (current === sequence.current) setResult(response);
    } catch (failure) {
      if (current === sequence.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { if (current === sequence.current) { acting.current = false; setBusy(false); } }
  };
  const disabled = busy || loading;
  return <section className="owner-erasure">
    <button type="button" className="owner-erasure__heading owner-erasure__toggle" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
      <Trash2 size={18}/><span>{t('حذف موقع أو حساب', 'Delete a site or account')}</span>
    </button>
    {open && <>
      {!result && <>
        <label>{t('ما الذي تريد حذفه؟', 'What should be removed?')}
          <select disabled={disabled} value={mode} onChange={event => { setMode(event.target.value as Mode); setImpact(null); }}>
            <option value="site" disabled={!siteId}>{t('الموقع فقط', 'Website only')}</option>
            <option value="account_only" disabled={!accountId}>{t('الحساب فقط', 'Account only')}</option>
            <option value="both" disabled={!accountId}>{t('الحساب ومواقعه معاً', 'Account and its websites together')}</option>
          </select>
        </label>
        <p className="owner-erasure__target"><strong>{t('الهدف', 'Target')}: </strong><bdi dir="auto">{target}</bdi></p>
        <label>{t('سبب الحذف', 'Deletion reason')}
          <textarea dir="auto" rows={2} required value={reason} maxLength={1000} disabled={busy} placeholder={t('مثال: بناءً على طلب صاحب الحساب', 'For example: requested by the account holder')} onChange={event => setReason(event.target.value)}/>
        </label>
        <p className="muted">{mode === 'account_only'
          ? t('يُلغى دخول الحساب، وتبقى المواقع ومحتواها وروابطها بإدارة المشرف. يُسجل القرار وسببه.', 'Account sign-in is removed. Websites, content and addresses remain under administrator management. The decision and reason are recorded.')
          : t('الحذف نهائي من الخدمة؛ تبقى السجلات المالية والتدقيقية المطلوبة، وإزالة الملفات موثقة بالطابور.', 'Removal from service is permanent. Required financial and audit records remain; file removal is tracked in a queue.')}</p>
        {loading ? <p role="status">{t('جارٍ التحقق من النطاق…', 'Checking scope…')}</p> : impact && <p className="muted">{mode === 'account_only'
          ? t(`${impact.retainedSiteCount || 0} موقع سيبقى دون تغيير محتواه.`, `${impact.retainedSiteCount || 0} websites will remain with unchanged content.`)
          : t(`${impact.siteCount} موقع و${impact.mediaCount} ملف ضمن الإزالة. لا يمكن التراجع.`, `${impact.siteCount} websites and ${impact.mediaCount} files are in scope. This cannot be undone.`)}</p>}
        {impact?.holdKinds.length ? <p role="alert">{t('تمنع حصانة احتفاظ أو بلاغ مفتوح الحذف. راجع السجل.', 'A retention hold or open report prevents deletion. Review the record.')}</p> : impact?.alreadyErased ? <p role="status">{t('هذا المورد مزال بالفعل.', 'This resource is already removed.')}</p> : <div className="owner-erasure__actions">
          <button type="button" className="button button-danger" aria-busy={busy} disabled={disabled || !id || !reason.trim()} onClick={() => void erase()}>
            {busy ? <RefreshCw size={17} className="spin"/> : <Trash2 size={17}/>}{busy ? t('جارٍ تنفيذ الحذف…', 'Removing…') : t('حذف نهائي وتسجيل السبب', 'Delete permanently and record reason')}
          </button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</button>
        </div>}
      </>}
      {result && <div role="status"><p>{mode === 'account_only' ? t('حُذف الحساب وبقي الموقع بإدارة المشرف؛ حُفظ إثبات القرار.', 'The account was removed and websites retained under administrator management; evidence was saved.') : t('أزيلت الهوية من الخدمة وحُفظ إثبات القرار. يتابع السجل إزالة الملفات.', 'Identity removed from service and decision evidence saved. The record tracks file removal.')}</p><bdi dir="ltr">{result.requestId}</bdi></div>}
      {onAudit && <button type="button" className="button button-quiet" disabled={busy} onClick={onAudit}>{t('فتح السجل', 'Open record')}</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </>}
  </section>;
}

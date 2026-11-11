import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useApp } from './lib';

type RecordRow = {
  id: string; user_id: number; reason: string; status: string; requested_action: string; created_at: number; executed_at: number | null;
  actor_id?: number; actor_name?: string; target?: string; evidence_hash?: string; files_total?: number; files_removed?: number; files_failed?: number;
};
export default function OwnerErasureRecords() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<RecordRow[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const sequence=useRef(0);
  const load = useCallback(async () => {
    const current=++sequence.current; setLoading(true); setError('');
    try { const response = await api<{records:RecordRow[]}>('/api/admin/erasure-records'); if(current===sequence.current) setRows(response.records); }
    catch(failure) { if(current===sequence.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if(current===sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return()=>{sequence.current++;}; }, [load]);
  return <section className="card stack admin-record-list">
    <div className="admin-section-heading"><h2>{t('سجل الحذف وأسبابه', 'Deletion records and reasons')}</h2><button type="button" className="button button-quiet" disabled={loading} onClick={()=>void load()}>{t('تحديث', 'Refresh')}</button></div>
    <p className="muted">{t('كل قرار مرتبط بمنفذه ومعرف إثباته. إتلاف الهوية لا يمحو السجلات المالية والتدقيقية المطلوبة.', 'Each decision links to its actor and evidence ID. Removing an identity does not erase required financial and audit records.')}</p>
    {loading ? <p role="status">{t('جارٍ قراءة السجل…', 'Loading records…')}</p> : error ? <div role="alert"><p>{error}</p><a className="button button-quiet" href="/auth?reauth=1">{t('تأكيد الدخول ثم العودة', 'Confirm sign-in, then return')}</a></div> : rows.length ? rows.map(row => {
      const total=Number(row.files_total??0),removed=Number(row.files_removed??0),failed=Number(row.files_failed??0);
      return <article key={row.id}>
        <h3>{row.requested_action==='owner-account'?t('حذف حساب ومواقعه', 'Account and websites deleted'):t('حذف موقع فقط', 'Website deleted')}</h3>
        <p dir="auto">{row.reason}</p>
        <dl>
          <div><dt>{t('بواسطة', 'By')}</dt><dd>{row.actor_id ? `${row.actor_name || t('مشرف', 'Administrator')} — C${row.actor_id}` : t('غير متاح بالسجل التاريخي', 'Unavailable in historical record')}</dd></div>
          <div><dt>{t('الهدف', 'Target')}</dt><dd><bdi dir="ltr">{row.target || `C${row.user_id}`}</bdi></dd></div>
          <div><dt>{t('الوقت', 'Time')}</dt><dd>{new Date((row.executed_at||row.created_at)*1000).toLocaleString(lang==='ar'?'ar-SA':'en-GB')}</dd></div>
          <div><dt>{t('النتيجة', 'Result')}</dt><dd>{row.status==='destroyed'?t('أزيلت الهوية من الخدمة', 'Identity removed from service'):row.status}</dd></div>
          <div><dt>{t('الملفات', 'Files')}</dt><dd>{total ? t(`${removed} أزيلت، ${Math.max(0,total-removed-failed)} تنتظر، ${failed} تعاد محاولتها`, `${removed} removed, ${Math.max(0,total-removed-failed)} pending, ${failed} awaiting retry`) : t('لا ملفات في الطابور', 'No queued files')}</dd></div>
        </dl>
        <details><summary>{t('معرف الإثبات وبصمته', 'Evidence ID and hash')}</summary><p><bdi dir="ltr">{row.id}</bdi></p><p><bdi dir="ltr">{row.evidence_hash||t('غير متاح', 'Unavailable')}</bdi></p></details>
      </article>;
    }) : <p>{t('لا توجد قرارات حذف مسجلة.', 'No deletion decisions recorded.')}</p>}
  </section>;
}

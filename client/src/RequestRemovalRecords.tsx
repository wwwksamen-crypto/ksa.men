import { useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { api, useApp } from './lib';
type Entry = { id: string; kind: string; request_id: string; actor_id: number; actor_name?: string; reason: string; previous_status: string; before_hash: string; created_at: number };
export default function RequestRemovalRecords() {
  const { t, lang, notify } = useApp();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]), [error, setError] = useState(''), [page, setPage] = useState(0);
  async function toggle() {
    if (loading) return;
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true); setError('');
    try { const value = await api<{ records: Entry[] }>('/api/admin/request-removals'); setEntries(value.records); setPage(0); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setLoading(false); }
  }
  function exportRecords() {
    const url=URL.createObjectURL(new Blob([JSON.stringify({ scope: 'latest-100-request-removals', records: entries },null,2)],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='request-removal-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify(t('جُهز ملف إثباتات حذف الطلبات.', 'Request-removal evidence file prepared.'));
  }
  return <section className="card request-removal-records">
    <button type="button" className="button button-quiet" aria-expanded={open} disabled={loading} onClick={() => void toggle()}><Archive size={17}/>{t('فتح سجل حذف الطلبات', 'Open request-removal record')}</button>
    {open && <div className="stack">
      {loading ? <p role="status">{t('جارٍ تحميل الإثباتات…', 'Loading evidence…')}</p> : error ? <p role="alert">{error}</p> : <>
        <p className="muted">{t('آخر 100 عملية؛ خمس عمليات في كل صفحة.', 'Latest 100 operations; five per page.')}</p>
        <button type="button" className="button button-small" disabled={!entries.length} onClick={exportRecords}><Download size={16}/>{t('تصدير الإثباتات المعروضة', 'Export loaded evidence')}</button>
        {entries.slice(page*5,page*5+5).map(entry => <article className="card" key={entry.id}>
          <strong>{entry.kind==='review' ? t('حذف طلب موقع', 'Website request removed') : t('حذف طلب عضوية', 'Membership request removed')}</strong>
          <p>{t('المنفذ', 'Actor')}: <bdi dir="auto">{entry.actor_name || `C${entry.actor_id}`}</bdi> · C{entry.actor_id}</p>
          <p>{t('السبب', 'Reason')}: <span dir="auto">{entry.reason}</span></p>
          <time>{new Date(entry.created_at*1000).toLocaleString(lang==='ar'?'ar-SA':'en-GB')}</time>
          <p>{t('معرّف الإثبات', 'Proof ID')}: <bdi dir="ltr">{entry.id}</bdi></p>
          <p>{t('معرّف الطلب', 'Request ID')}: <bdi dir="ltr">{entry.request_id}</bdi></p>
        </article>)}
        {!entries.length && <p>{t('لا توجد طلبات محذوفة مسجلة.', 'No request removals recorded.')}</p>}
        {entries.length>5 && <div className="row"><button type="button" className="button button-small" disabled={page===0} onClick={()=>setPage(page-1)}>{t('السابق','Previous')}</button><button type="button" className="button button-small" disabled={(page+1)*5>=entries.length} onClick={()=>setPage(page+1)}>{t('التالي','Next')}</button></div>}
      </>}
    </div>}
  </section>;
}

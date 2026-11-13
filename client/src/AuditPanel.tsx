import { useRef, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api, useApp } from './lib';
import { auditActionLabel, auditOutcomeLabel } from './audit-copy';
import { downloadAudit, type AuditRow } from './audit-download';
import './action-clarity.css';
export default function AuditPanel() {
  const { t, lang, notify } = useApp();
  const [open,setOpen]=useState(false), [rows,setRows]=useState<AuditRow[]>([]), [pages,setPages]=useState<number[]>([]);
  const [loading,setLoading]=useState(false), [loaded,setLoaded]=useState(false), [error,setError]=useState(''), [exporting,setExporting]=useState('');
  const lock=useRef(false);
  const load=async(before?:number,next=false)=>{
    if(lock.current)return;lock.current=true;setLoading(true);setError('');
    try {
      const result=await api<{audit:AuditRow[]}>('/api/admin/audit?limit=10'+(before?'&before='+before:''));
      if(!Array.isArray(result.audit))throw new Error(t('تعذر قراءة السجل.', 'Unable to read the record.'));
      if(next&&rows.length)setPages(values=>[...values,Number(rows[0].id)+1]);
      setRows(result.audit);setLoaded(true);
    }catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
    finally{setLoading(false);lock.current=false;}
  };
  const toggle=()=>{setOpen(!open);if(!open&&!loaded)void load();notify(open?t('أغلق سجل العمليات.', 'Action record closed.'):t('فتح سجل العمليات.', 'Action record opened.'));};
  const exportFile=async(format:'json'|'csv')=>{
    if(lock.current)return;lock.current=true;setExporting(format);setError('');
    try { const count=await downloadAudit('audit',format);notify(t(`جُهز ملف السجل: ${count} عملية.`, `Record file prepared: ${count} actions.`)); }
    catch(failure){const message=failure instanceof Error?failure.message:String(failure);setError(message);notify(message);}
    finally{setExporting('');lock.current=false;}
  };
  return <section className="card audit-disclosure">
    <div className="audit-disclosure__tools"><button className="button" type="button" aria-expanded={open} onClick={toggle}><FileText size={18}/>{open?t('إغلاق سجل العمليات', 'Close action record'):t('فتح سجل العمليات', 'Open action record')}</button>
      {open&&<><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>void exportFile('csv')}><Download size={16}/>{exporting==='csv'?t('جارٍ تجهيز الملف…','Preparing…'):t('تصدير CSV','Export CSV')}</button><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>void exportFile('json')}><Download size={16}/>{exporting==='json'?t('جارٍ تجهيز الملف…','Preparing…'):t('تصدير JSON','Export JSON')}</button></>}
    </div>
    {open&&<div className="audit-disclosure__body">
      {loading?<p role="status"><RefreshCw size={16} className="spin"/>{t('جارٍ قراءة السجل…','Reading record…')}</p>:rows.length?<div className="audit-disclosure__list">{rows.map(row=><article key={String(row.id)} className="audit-entry"><div className="audit-entry__heading"><strong>{auditActionLabel(String(row.action||''),t)}</strong><time>{new Date(Number(row.created_at)*1000).toLocaleString(lang==='ar'?'ar-SA':'en')}</time></div><p>{auditOutcomeLabel(String(row.action||''),t)}</p><p>{t('بواسطة','By')}: <bdi dir="auto">{String(row.actor_name||'')} — C{String(row.actor_id??'')}</bdi></p><p>{t('الهدف','Target')}: <bdi dir="auto">{String(row.target||'')}</bdi></p><details><summary>{t('فتح الإثبات','Open evidence')}</summary><p><bdi dir="ltr">{String(row.action||'')}</bdi></p><pre dir="auto">{JSON.stringify(row.detail||{},null,2)}</pre></details></article>)}</div>:loaded&&!error&&<p>{t('لا توجد أحداث في هذه الصفحة.','No events on this page.')}</p>}
      <div className="audit-page-controls"><button type="button" className="button button-quiet" disabled={loading||!!exporting||!pages.length} onClick={()=>{const before=pages.at(-1);setPages(values=>values.slice(0,-1));void load(before);}}>{t('السابق','Previous')}</button><button type="button" className="button button-quiet" disabled={loading||!!exporting||rows.length<10} onClick={()=>void load(Number(rows.at(-1)?.id),true)}>{t('التالي','Next')}</button><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>{setPages([]);void load();}}>{t('تحديث','Refresh')}</button></div>
      {error&&<p role="alert">{error}</p>}
    </div>}
  </section>;
}

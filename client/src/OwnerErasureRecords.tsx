import { useCallback, useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { api, useApp } from './lib';
import { downloadAudit } from './audit-download';
import './action-clarity.css';

type RecordRow = { id:string;user_id:number;reason:string;status:string;requested_action:string;created_at:number;executed_at:number|null;actor_id?:number;actor_name?:string;target?:string;evidence_hash?:string;files_total?:number;files_removed?:number;files_failed?:number };
export default function OwnerErasureRecords() {
  const {t,lang,notify}=useApp();
  const [open,setOpen]=useState(false),[rows,setRows]=useState<RecordRow[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[page,setPage]=useState(0),[exporting,setExporting]=useState('');
  const sequence=useRef(0),busy=useRef(false);
  const load=useCallback(async()=>{
    if(busy.current)return;busy.current=true;const current=++sequence.current;setLoading(true);setError('');
    try {const response=await api<{records:RecordRow[]}>('/api/admin/erasure-records');if(!Array.isArray(response.records))throw new Error('تعذر قراءة السجل');if(current===sequence.current){setRows(response.records);setLoaded(true);setPage(0);}}
    catch(failure){if(current===sequence.current)setError(failure instanceof Error?failure.message:String(failure));}
    finally{if(current===sequence.current)setLoading(false);busy.current=false;}
  },[]);
  const toggle=()=>{setOpen(!open);if(!open&&!loaded)void load();notify(open?t('أغلق سجل الحذف.','Deletion record closed.'):t('فتح سجل الحذف.','Deletion record opened.'));};
  const exportFile=async(format:'json'|'csv')=>{
    if(busy.current)return;busy.current=true;setExporting(format);setError('');
    try{const count=await downloadAudit('erasure',format);notify(t(`جُهز سجل الحذف: ${count} قرار.`,`Deletion record prepared: ${count} decisions.`));}
    catch(failure){const message=failure instanceof Error?failure.message:String(failure);setError(message);notify(message);}
    finally{busy.current=false;setExporting('');}
  };
  return <section className="card audit-disclosure admin-record-list">
    <div className="audit-disclosure__tools"><button type="button" className="button button-quiet" aria-expanded={open} onClick={toggle}><FileText size={18}/>{t('سجل الحذف وأسبابه','Deletion records and reasons')}</button>
      {open&&<><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>void exportFile('csv')}><Download size={16}/>{exporting==='csv'?t('جارٍ التجهيز…','Preparing…'):t('تصدير CSV','Export CSV')}</button><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>void exportFile('json')}><Download size={16}/>{exporting==='json'?t('جارٍ التجهيز…','Preparing…'):t('تصدير JSON','Export JSON')}</button></>}
    </div>
    {open&&<div className="audit-disclosure__body">
      <p className="muted">{t('أحدث 100 قرار، خمس عمليات في الصفحة. التصدير يشمل جميع القرارات. السجلات المالية والتدقيقية المطلوبة لا تُمحى.','Latest 100 decisions, five per page. Export includes all decisions. Required financial and audit records remain.')}</p>
      {loading?<p role="status">{t('جارٍ قراءة السجل…','Loading records…')}</p>:rows.length?rows.slice(page*5,page*5+5).map(row=>{
        const total=Number(row.files_total??0),removed=Number(row.files_removed??0),failed=Number(row.files_failed??0);
        return <article key={row.id} className="audit-entry">
          <h3>{row.requested_action==='owner-account'?t('حذف حساب ومواقعه','Account and websites deleted'):row.requested_action==='owner-account_only'?t('حذف الحساب وإبقاء المواقع','Account deleted, websites retained'):t('حذف موقع فقط','Website deleted')}</h3>
          <p dir="auto">{row.reason}</p>
          <dl><div><dt>{t('بواسطة','By')}</dt><dd>{row.actor_id?`${row.actor_name||t('مشرف','Administrator')} — C${row.actor_id}`:t('غير متاح بالسجل التاريخي','Unavailable in historical record')}</dd></div>
            <div><dt>{t('الهدف','Target')}</dt><dd><bdi dir="ltr">{row.target||`C${row.user_id}`}</bdi></dd></div>
            <div><dt>{t('الوقت','Time')}</dt><dd>{new Date((row.executed_at||row.created_at)*1000).toLocaleString(lang==='ar'?'ar-SA':'en-GB')}</dd></div>
            <div><dt>{t('النتيجة','Result')}</dt><dd>{row.status==='destroyed'?t('نُفذ القرار وحُفظ إثباته','Decision executed and evidence saved'):row.status}</dd></div>
            <div><dt>{t('الملفات','Files')}</dt><dd>{total?t(`${removed} أزيلت، ${Math.max(0,total-removed-failed)} تنتظر، ${failed} تعاد محاولتها`,`${removed} removed, ${Math.max(0,total-removed-failed)} pending, ${failed} awaiting retry`):t('لا ملفات في الطابور','No queued files')}</dd></div>
          </dl><details><summary>{t('معرف الإثبات وبصمته','Evidence ID and hash')}</summary><p><bdi dir="ltr">{row.id}</bdi></p><p><bdi dir="ltr">{row.evidence_hash||t('غير متاح','Unavailable')}</bdi></p></details>
        </article>;
      }):loaded&&!error&&<p>{t('لا توجد قرارات حذف مسجلة.','No deletion decisions recorded.')}</p>}
      <div className="audit-page-controls"><button type="button" className="button button-quiet" disabled={loading||page===0} onClick={()=>setPage(page-1)}>{t('السابق','Previous')}</button><span>{page+1}</span><button type="button" className="button button-quiet" disabled={loading||(page+1)*5>=rows.length} onClick={()=>setPage(page+1)}>{t('التالي','Next')}</button><button type="button" className="button button-quiet" disabled={loading||!!exporting} onClick={()=>void load()}>{t('تحديث','Refresh')}</button></div>
      {error&&<p role="alert">{error}</p>}
    </div>}
  </section>;
}

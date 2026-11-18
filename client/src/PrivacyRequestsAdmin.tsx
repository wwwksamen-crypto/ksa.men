import { useEffect, useState } from 'react';
import { api, useApp } from './lib';
import { privacyTypeLabel, privacyStatusLabel, type PrivacyRequest } from '../../shared/privacy-rights';
import './privacy-space.css';
type Item=Pick<PrivacyRequest,'id'|'type'|'status'|'dueAt'|'createdAt'> & {name?:string;subjectId?:number|null};
type Detail=Item & {message:string;response:string;revision:number};
export default function PrivacyRequestsAdmin() {
  const {t,notify,lang}=useApp();const [open,setOpen]=useState(false),[rows,setRows]=useState<Item[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[detail,setDetail]=useState<Detail|null>(null);
  const [response,setResponse]=useState(''),[status,setStatus]=useState('reviewing');
  async function load(after='') {const result=await api<{enabled:boolean;requests:Item[];nextAfter?:string|null}>('/api/admin/privacy/requests'+(after?'?after='+encodeURIComponent(after):''));setRows(result.requests);setCursor(result.nextAfter||null);}
  useEffect(()=>{if(!open)return;setBusy(true);void load().catch(error=>notify(error.message)).finally(()=>setBusy(false));},[open]);
  const date=(value:number)=>new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{dateStyle:'medium',calendar:'gregory'}).format(new Date(value*1000));
  async function inspect(id:string) {setBusy(true);try{const data=await api<{request:Detail}>('/api/admin/privacy/requests/'+encodeURIComponent(id));setDetail(data.request);setResponse(data.request.response||'');setStatus('reviewing');}catch(error){notify((error as Error).message);}finally{setBusy(false);}}
  async function reply(){if(!detail)return;setBusy(true);try{await api('/api/admin/privacy/requests/'+encodeURIComponent(detail.id)+'/reply',{method:'POST',body:JSON.stringify({status,response:response.trim(),expectedRevision:detail.revision})});notify(t('حُفظ الرد وتوثقت متابعة الطلب.','Response saved and request follow-up recorded.'));setDetail(null);await load();}catch(error){notify((error as Error).message);}finally{setBusy(false);}}
  return <details className="card privacy-space" onToggle={event=>setOpen(event.currentTarget.open)}><summary className="button button--quiet">{t('طلبات البيانات والخصوصية','Data and privacy requests')}</summary>{open&&<div className="stack privacy-space-body">
    <div className="row"><p className="muted">{t('الأقرب موعداً أولاً؛ افتح التفاصيل عند الحاجة.','Earliest due first; open details as needed.')}</p><button className="button button--quiet" type="button" disabled={busy} onClick={()=>{setBusy(true);void load().catch(error=>notify(error.message)).finally(()=>setBusy(false));}}>{t('تحديث','Refresh')}</button></div>
    {busy&&<p role="status">{t('جارٍ استحضار الطلب…','Loading request…')}</p>}
    {rows.length?rows.map(row=><article key={row.id} className="privacy-request"><strong>{row.name||t('طلب محفوظ','Retained request')} · {privacyTypeLabel(row.type,t)}</strong><p>{privacyStatusLabel(row.status,t)}</p><small>{t('موعد المتابعة','Follow-up due')}: {date(row.dueAt)}</small><button type="button" className="button button--quiet" disabled={busy} onClick={()=>void inspect(row.id)}>{t('فتح التفاصيل','Open details')}</button></article>):!busy&&<p>{t('لا توجد طلبات معروضة.','No requests to display.')}</p>}
    {cursor&&<button type="button" className="button button--quiet" disabled={busy} onClick={()=>{setBusy(true);void load(cursor).catch(error=>notify(error.message)).finally(()=>setBusy(false));}}>{t('الصفحة التالية','Next page')}</button>}
    {detail&&<section className="privacy-request stack"><h3>{privacyTypeLabel(detail.type,t)}</h3>{detail.message&&<p className="privacy-copy">{detail.message}</p>}{detail.response&&<p className="privacy-copy">{detail.response}</p>}
      {detail.type!=='export'&&['received','reviewing','blocked'].includes(detail.status)&&detail.subjectId&&<>
        <label><span>{t('حالة المتابعة','Follow-up status')}</span><select className="field" value={status} onChange={event=>setStatus(event.target.value)}>{['reviewing','answered','blocked','rejected'].map(value=><option value={value} key={value}>{privacyStatusLabel(value,t)}</option>)}</select></label>
        <textarea className="field" rows={3} maxLength={2000} aria-label={t('رد يظهر لصاحب الطلب','Response shown to the requester')} placeholder={t('رد واضح لصاحب الطلب، دون أدلة مقيدة أو معلومات آخرين.','A clear requester response, without restricted evidence or other people’s information.')} value={response} onChange={event=>setResponse(event.target.value)}/>
        <p className="muted">{t('حفظ الرد لا ينفذ حذفاً أو تغييراً في ملف العضو.','Saving a response does not erase data or alter the member profile.')}</p>
        <button type="button" className="button" disabled={busy||response.trim().length<3} onClick={()=>void reply()}>{t('حفظ الرد والمتابعة','Save response and follow-up')}</button>
      </>}
      <button type="button" className="button button--quiet" onClick={()=>setDetail(null)}>{t('إغلاق التفاصيل','Close details')}</button>
    </section>}
  </div>}</details>;
}

import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Send, X } from 'lucide-react';
import { api, useApp } from './lib';
import { normalizeSubdomain } from '../../shared/subdomains';
import './subdomain-workflows.css';
type Pending = {new_name:string;old_name:string};
export default function SiteNameEditor({siteId,currentName,disabled,onRequest,onPublish}:{siteId:string;currentName:string;disabled:boolean;onRequest:(name:string)=>Promise<boolean>;onPublish:()=>void}) {
  const {t}=useApp();const [editing,setEditing]=useState(false),[name,setName]=useState(currentName),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  const load=()=>api<{pending:Pending|null}>(`/api/sites/${encodeURIComponent(siteId)}/name-change`).then(r=>setPending(r.pending)).catch(()=>{});
  useEffect(()=>{let live=true;api<{pending:Pending|null}>(`/api/sites/${encodeURIComponent(siteId)}/name-change`).then(r=>{if(live)setPending(r.pending);}).catch(()=>{});return()=>{live=false;};},[siteId,currentName]);
  const send=async(value=name)=>{
    if(lock.current||disabled)return;let normalized:string;try{normalized=normalizeSubdomain(value);}catch(e){setError((e as Error).message);return;}
    lock.current=true;setBusy(true);setError('');
    try{if(await onRequest(normalized)){setEditing(false);await load();}}finally{lock.current=false;setBusy(false);}
  };
  return <section className="site-name-editor" aria-label={t('تعديل رابط موقعك','Edit your site link')}>
    <div className="site-name-actions"><button type="button" className="button button--quiet" disabled={disabled||busy} onClick={()=>{setName(pending?.new_name||currentName);setEditing(true);setError('');}}><Pencil size={15}/>{t('تعديل','Edit')}</button><button type="button" className="button" disabled={disabled||busy} onClick={()=>{if(editing)void send();else if(pending)void send(pending.new_name);else onPublish();}}><Send size={15}/>{busy?t('جارٍ الإرسال','Sending'):t('طلب نشر','Request publication')}</button></div>
    {pending&&<p className="site-name-pending" role="status"><Check size={14}/>{t('الاسم المطلوب:','Requested name:')} <bdi dir="ltr">{pending.new_name}.ksa.men</bdi> — {t('بانتظار النشر','Awaiting publication')}</p>}
    {editing&&<form className="site-name-form" onSubmit={e=>{e.preventDefault();void send();}}><label><span>{t('اسم موقعك الجديد أو رابطه الكامل','New site name or full link')}</span><input className="field" value={name} dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={260} onChange={e=>setName(e.target.value)} placeholder="name.ksa.men" disabled={busy}/></label><p className="muted">{t('يبقى رابطك الحالي حتى الاعتماد. عند نشر الاسم الجديد يصبح السابق متاحاً للآخرين.','Your current link remains active until approval. Publishing the new name makes the previous one available to others.')}</p>{error&&<p role="alert">{error}</p>}<div className="site-name-actions"><button className="button" disabled={disabled||busy} type="submit"><Send size={15}/>{t('طلب نشر الاسم','Request name publication')}</button><button className="button button--quiet" type="button" disabled={busy} onClick={()=>setEditing(false)}><X size={15}/>{t('إغلاق','Close')}</button>{pending&&<button className="button button--quiet" type="button" disabled={busy||disabled} onClick={()=>void send(currentName)}>{t('إلغاء طلب تغيير الاسم','Cancel name change')}</button>}</div></form>}
  </section>;
}

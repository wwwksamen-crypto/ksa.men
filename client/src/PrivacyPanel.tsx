import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCcw, ShieldCheck } from 'lucide-react';
import { api, useApp } from './lib';
import { consentPurposeLabel, privacyStatusLabel, privacyTypeLabel, type PrivacySummary, type PrivacyRequest, type PrivacyRequestType, type PrivacyEvent, type PrivacyErasureOutcome as Outcome } from '../../shared/privacy-rights';
import PrivacyErasureOutcome from './PrivacyErasureOutcome';
import './privacy-space.css';

export default function PrivacyPanel({children}:{children?:ReactNode}) {
  const {user,t,notify,lang}=useApp();
  const [open,setOpen]=useState(false),[summary,setSummary]=useState<PrivacySummary|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState('');
  const [type,setType]=useState<PrivacyRequestType>('correction'),[message,setMessage]=useState(''),[detail,setDetail]=useState<{request:PrivacyRequest;message:string;events:PrivacyEvent[];outcome?:Outcome|null}|null>(null);
  const key=useRef<{fingerprint:string;id:string}|null>(null);
  const date=(value:number)=>new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{dateStyle:'medium',timeStyle:'short',calendar:'gregory'}).format(new Date(value*1000));
  const load=async(signal?:AbortSignal)=>{const data=await api<PrivacySummary>('/api/privacy/summary',{signal});setSummary(data);};
  useEffect(()=>{
    if(!open)return;const controller=new AbortController();let alive=true;setLoading(true);
    void load(controller.signal).catch(error=>{if(!controller.signal.aborted)notify(error.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;controller.abort();};
  },[open,user?.id]);
  async function request(requestType:PrivacyRequestType) {
    if(busy)return;setBusy('request');
    const text=requestType==='export'?'':message.trim(),fingerprint=requestType+'\n'+text;
    if(key.current?.fingerprint!==fingerprint)key.current={fingerprint,id:crypto.randomUUID()};
    try {
      const result=await api<{request:PrivacyRequest;idempotent:boolean}>('/api/privacy/requests',{method:'POST',body:JSON.stringify({type:requestType,message:text,idempotencyKey:key.current.id})});
      notify(result.idempotent?t('طلبك السابق محفوظ ويمكنك متابعة حالته.','Your existing request is retained; follow its status.'):t('استلمنا طلبك، ويمكنك متابعته هنا.','Request received; follow it here.'));
      await load();key.current=null;if(requestType!=='export')setMessage('');setDetail(null);
    }catch(error){notify((error as Error).message);}finally{setBusy('');}
  }
  async function show(id:string) {setBusy(id);try{setDetail(await api('/api/privacy/requests/'+encodeURIComponent(id)));}catch(error){notify((error as Error).message);}finally{setBusy('');}}
  async function older() {
    if(!summary?.nextBefore)return;setBusy('older');
    try{const page=await api<{requests:PrivacyRequest[];nextBefore:string|null}>('/api/privacy/requests?before='+encodeURIComponent(summary.nextBefore));setSummary(current=>current?{...current,...page}:current);setDetail(null);}catch(error){notify((error as Error).message);}finally{setBusy('');}
  }
  async function download(id:string) {
    setBusy(id);try {
      const data=await api<Record<string,unknown>>('/api/privacy/requests/'+encodeURIComponent(id)+'/download');
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='ksa-men-my-data.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify(t('بدأ تنزيل نسختك الخاصة. احفظها في مكان آمن.','Your private download has started. Store it safely.'));
    }catch(error){notify((error as Error).message);}finally{setBusy('');}
  }
  async function withdraw(purpose:string) {
    setBusy(purpose);try{await api('/api/privacy/consents/'+encodeURIComponent(purpose)+'/withdraw',{method:'POST'});await load();notify(purpose==='public_profile'?t('أُخفي حضورك العام فوراً.','Your public presence is now hidden.'):t('حُفظ سحب اختيارك لهذا الغرض.','Your withdrawal for this purpose is saved.'));}catch(error){notify((error as Error).message);}finally{setBusy('');}
  }
  return <details className="card privacy-space" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="button button--quiet"><ShieldCheck size={18}/>{t('خصوصيتي وبياناتي','My privacy and data')}</summary>
    {open&&<div className="stack privacy-space-body">
      {loading&&<p role="status">{t('جارٍ استحضار بياناتك…','Loading your information…')}</p>}
      <p>{t('تحكم في اختياراتك، واطلب نسخة خاصة من بياناتك أو تابع طلباً للمعالجة.','Manage your choices, request a private data copy, or follow a data request.')}</p>
      {summary?.enabled&&<>
        <button type="button" className="button" disabled={!!busy} onClick={()=>void request('export')}><Download size={17}/>{t('طلب نسخة بياناتي','Request my data copy')}</button>
        <p className="muted">{t('النسخة لك وحدك بعد إعادة التحقق. تشمل بياناتك المتاحة للتصدير ومراجع صورك، ولا تستبدل حفظ الصور نفسها.','The copy is yours after re-verification. It contains your exportable information and image references, not the image files themselves.')}</p>
        <details><summary className="button button--quiet">{t('طلب بخصوص بياناتي','Request about my data')}</summary><div className="stack privacy-space-body">
          <label><span>{t('ماذا تحتاج؟','What do you need?')}</span><select className="field" value={type} onChange={e=>setType(e.target.value as PrivacyRequestType)}>{(['correction','erasure','objection'] as const).map(value=><option key={value} value={value}>{privacyTypeLabel(value,t)}</option>)}</select></label>
          <textarea className="field" rows={3} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)} aria-label={t('توضيح الطلب','Request explanation')} placeholder={t('اكتب المطلوب باختصار دون بيانات دخول أو معلومات أشخاص آخرين.','Briefly explain your request without sign-in details or other people’s information.')}/>
          {type==='erasure'&&<p>{t('تسجيل هذا الطلب لا ينفذ حذفاً تلقائياً؛ تُراجع حالته ويُوضح لك القرار.','Submitting this request does not automatically erase data; it is reviewed and the decision is explained.')}</p>}
          <button type="button" className="button" disabled={!!busy||message.trim().length<3} onClick={()=>void request(type)}>{t('إرسال طلبي','Send my request')}</button>
        </div></details>
        <section><div className="row"><h3>{t('متابعة طلباتي','My request status')}</h3><button type="button" className="button button--quiet" disabled={!!busy} onClick={()=>{setBusy('refresh');void load().catch(error=>notify(error.message)).finally(()=>setBusy(''));}}><RefreshCcw size={16}/>{t('تحديث','Refresh')}</button></div>
          {summary.requests.length?<div className="stack">{summary.requests.map(r=><article className="privacy-request" key={r.id}><strong>{privacyTypeLabel(r.type,t)}</strong><p role="status">{privacyStatusLabel(r.status,t)}</p><small>{date(r.createdAt)}</small>{r.downloadable&&r.expiresAt&&<p>{t('متاحة حتى','Available until')} {date(r.expiresAt)}</p>}<div className="row"><button type="button" className="button button--quiet" disabled={!!busy} onClick={()=>void show(r.id)}>{t('تفاصيل الطلب','Request details')}</button>{r.downloadable&&<button type="button" className="button" disabled={!!busy} onClick={()=>void download(r.id)}><Download size={16}/>{t('تنزيل نسختي','Download my copy')}</button>}</div></article>)}</div>:<p className="muted">{t('لا توجد طلبات مسجلة بعد.','No requests recorded yet.')}</p>}
          {summary.requests.some(r=>['received','processing'].includes(r.status))&&<p className="muted">{t('اضغط «تحديث» لمتابعة حالة التجهيز.','Press Refresh to check preparation status.')}</p>}
          {summary.nextBefore&&<button type="button" className="button button--quiet" disabled={!!busy} onClick={()=>void older()}>{t('طلبات أقدم','Older requests')}</button>}
        </section>
        {detail&&<section className="privacy-request"><h3>{t('تفاصيل طلبي','My request details')}</h3><p>{privacyStatusLabel(detail.request.status,t)}</p><p>{t('مرجع الطلب','Request reference')}: <bdi>{detail.request.id}</bdi></p>{detail.message&&<p className="privacy-copy">{detail.message}</p>}{detail.request.response&&<p className="privacy-copy">{detail.request.response}</p>}<PrivacyErasureOutcome outcome={detail.outcome}/>{detail.request.type==='erasure'&&<p>{t('احفظ مرجع طلبك. إذا أزيل حسابك، تابع مع الدعم بعد التحقق من هويتك؛ لا يعاد تفعيل دخولك السابق.','Keep your request reference. If your account is removed, follow up with support after identity verification; your old sign-in is not restored.')}</p>}<ol>{detail.events.map((event,i)=><li key={`${event.createdAt}:${i}`}>{privacyStatusLabel(event.status,t)} · {date(event.createdAt)}</li>)}</ol><button type="button" className="button button--quiet" onClick={()=>setDetail(null)}>{t('إغلاق التفاصيل','Close details')}</button></section>}
      </>}
      <details><summary className="button button--quiet">{t('اختياراتي والموافقات','My choices and consents')}</summary><div className="stack privacy-space-body">{children}
        {summary?.consents.map(consent=><div className="privacy-request" key={consent.id}><strong>{consentPurposeLabel(consent.purpose,t)}</strong><p>{consent.withdrawnAt?t('سُحب هذا الاختيار','Choice withdrawn'):t('اختيار مسجل','Recorded choice')} · {date(consent.withdrawnAt||consent.grantedAt)}</p>{summary.enabled&&!consent.withdrawnAt&&['translation','contact','public_profile'].includes(consent.purpose)&&<button type="button" className="button button--quiet" disabled={!!busy} onClick={()=>void withdraw(consent.purpose)}>{consent.purpose==='public_profile'?t('إخفاء موقعي وسحب إتاحته العامة','Hide my site and withdraw public access'):t('سحب هذا الاختيار','Withdraw this choice')}</button>}</div>)}
      </div></details>
      <a className="button button--quiet" href="mailto:support@ksa.men">{t('التواصل بخصوص بياناتي','Contact us about my data')}</a>
    </div>}
  </details>;
}

import {useEffect,useState} from 'react';
import {ExternalLink,Globe,PencilLine} from 'lucide-react';
import {api,useApp} from './lib';
import OwnerErasurePanel from './OwnerErasurePanel';

type RetainedSite={id:string;name:string|null;title:string|null;status:string;url:string|null};

export default function RetainedSites(){
 const{t,notify}=useApp();
 const[sites,setSites]=useState<RetainedSite[]>([]);
 const[open,setOpen]=useState(false);
 const[error,setError]=useState('');
 const load=async()=>{
  try{
   const data=await api<{sites:RetainedSite[]}>('/api/admin/retained-sites');
   setSites(Array.isArray(data.sites)?data.sites:[]);
   setError('');
  }catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
 };
 useEffect(()=>{void load();},[]);
 if(!sites.length&&!error)return null;
 return <section className="card stack">
  <button type="button" className="button button-quiet" aria-expanded={open} onClick={()=>setOpen(!open)}>
   <Globe size={18}/>{t('مواقع بإدارة المشرف','Administrator-managed websites')} ({sites.length})
  </button>
  {open&&<>
   <p className="muted">{t('مواقع محفوظة دون حساب دخول لصاحبها. محتواها وروابطها باقية؛ يمكنك إدارتها أو حذف الموقع وحده.','Websites retained without an owner sign-in account. Content and addresses remain; you can manage them or delete the website only.')}</p>
   {sites.map(site=><article key={site.id} className="audit-entry">
    <h3 dir="auto">{site.title||site.name||t('موقع محفوظ','Retained website')}</h3>
    <p><bdi dir="ltr">{site.name}</bdi></p>
    <div className="audit-disclosure__tools">
     <a className="button button-quiet" href={'/dashboard?tab=editor&mode=edit&site='+encodeURIComponent(site.id)}>
      <PencilLine size={17}/>{t('تعديل الموقع','Edit website')}
     </a>
     {site.url&&<a className="button button-quiet" href={site.url} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={17}/>{t('فتح الموقع','Open website')}
     </a>}
    </div>
    <OwnerErasurePanel accountId="" siteId={site.id} onErase={async(path,body)=>{
     try{
      const result=await api<{erased:boolean}>(path,{method:'POST',body:JSON.stringify(body)});
      if(!result.erased)throw new Error(t('لم يتأكد حذف الموقع.','Website deletion was not confirmed.'));
      notify(t('حُذف الموقع وسُجل سبب القرار.','Website removed and decision reason recorded.'));
      void load();
      return result;
     }catch(failure){
      notify(failure instanceof Error?failure.message:String(failure));
      throw failure;
     }
    }}/>
   </article>)}
   {error&&<p role="alert">{error}</p>}
  </>}
 </section>;
}

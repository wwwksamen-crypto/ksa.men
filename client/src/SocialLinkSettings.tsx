import { useEffect, useState } from 'react';
import { socialPlatforms, socialOverrides, validateSocialOverrides, type SocialOverrides } from '../../shared/social-platforms';
import { api, useApp } from './lib';
import SocialIconGrid from './SocialIconGrid';
import './social-links.css';
export default function SocialLinkSettings({onSave}:{onSave:(value:SocialOverrides,previous:SocialOverrides)=>Promise<boolean>}) {
 const {t,notify}=useApp();const [value,setValue]=useState<SocialOverrides>({}),[previous,setPrevious]=useState<SocialOverrides>({});const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api<{social_links?:unknown}>('/api/admin/settings').then(data=>{if(active){const links=socialOverrides(data.social_links);setValue(links);setPrevious(links);setReady(true);}}).catch(()=>{if(active)setError(t('تعذر تحميل روابط المنصة؛ حدّث الصفحة للمحاولة.','Could not load platform links. Refresh to try again.'));});return()=>{active=false;};},[]);
 const save=async()=>{setError('');try{const links=validateSocialOverrides(value);setBusy(true);if(await onSave(links,previous)){setValue(links);setPrevious(links);notify(t('حُفظت روابط منصتنا.','Our platform links were saved.'));}}catch(cause){setError(cause instanceof Error?cause.message:t('تعذر حفظ الروابط.','Could not save links.'));}finally{setBusy(false);}};
 return <section className="card stack social-settings"><div><h2>{t('أيقونات التواصل وروابط منصتنا','Social icons and our platform links')}</h2><p className="muted">{t('الحقول الفارغة تفتح المواقع الأصلية. أضف روابط حسابات منصتنا لتظهر في الرئيسية؛ لا تتغير روابط الأعضاء.','Empty fields open the original platforms. Add our account links for the homepage; member links are unchanged.')}</p></div>
  <SocialIconGrid values={socialOverrides(value)}/>
  <form className="stack" onSubmit={event=>{event.preventDefault();void save();}}>
   <div className="social-link-fields">{socialPlatforms.map(platform=><label className="field" key={platform.key}><span>{t(platform.ar,platform.key==='x'?'X':platform.key[0].toUpperCase()+platform.key.slice(1))}</span><input dir="ltr" type="url" disabled={!ready||busy} value={value[platform.key]||''} placeholder={platform.url} maxLength={2048} onChange={event=>setValue(current=>({...current,[platform.key]:event.target.value}))}/></label>)}</div>
   {error&&<p role="alert">{error}</p>}<button className="button" disabled={!ready||busy}>{busy?t('جارٍ الحفظ','Saving'):t('حفظ روابط منصتنا','Save our platform links')}</button>
  </form>
 </section>;
}

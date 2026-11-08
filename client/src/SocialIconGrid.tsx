import { brandNames } from '../../shared/profile-content';
import { orderedSocialLinks, type SocialOverrides } from '../../shared/social-platforms';
import { brandPaths } from './brand-paths';
import { useApp } from './lib';
import './social-links.css';
export default function SocialIconGrid({values=[],className='',onClick}:{values?:unknown[]|SocialOverrides;className?:string;onClick?:()=>void}) {
 const {t}=useApp();
 return <div className={`social-icon-grid ${className}`} aria-label={t('منصات التواصل الاجتماعي','Social platforms')}>
  {orderedSocialLinks(values).map(link=><a className="social-icon-grid__link" data-brand={link.key} key={link.key} href={link.url} target="_blank" rel="noopener noreferrer" onClick={onClick} title={link.isDefault?t(`الموقع الرسمي لـ${link.ar}`,`${brandNames[link.brand]} homepage`):brandNames[link.brand]} aria-label={`${t(link.ar,brandNames[link.brand])} — ${brandNames[link.brand]}${link.isDefault?t(' — الموقع الرسمي للمنصة',' — platform homepage'):''}`}>
   <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d={brandPaths[link.key]}/></svg>
  </a>)}
 </div>;
}

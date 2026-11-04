import { useEffect, useState } from 'react';
import { Mail, Phone, Globe, MessageCircle, Clock3, ShieldCheck, Link2 } from 'lucide-react';
import { api, useApp } from './lib';
import LoadingState from './LoadingState';
import { quickPhone, safeQuickSite } from '../../shared/quick-link';
import { updateQuickMetadata } from './page-metadata';
import './quick-introduction.css';

type QuickData = { profile: { name?: string; title?: string; phone?: string; email?: string; whatsapp?: string; url?: string }; mode: string; expiresAt: number };
export default function QuickIntroduction() {
  const { t, lang } = useApp();
  const [data, setData] = useState<QuickData | null>(null);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let active = true;
    const id = location.pathname.split('/').pop() || '';
    api<QuickData>('/api/public/quick/' + encodeURIComponent(id)).then(result => { if (active) setData(result); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!data) return;
    const check = () => setExpired(data.expiresAt * 1000 <= Date.now());
    check(); const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [data]);
  const unavailable = failed || expired;
  useEffect(() => { updateQuickMetadata(location.pathname, lang, !unavailable); }, [lang, unavailable]);
  const profile = unavailable ? undefined : data?.profile;
  const phone = profile?.phone ? quickPhone(profile.phone) : '';
  const whatsapp = profile?.whatsapp ? quickPhone(profile.whatsapp) : '';
  const site = safeQuickSite(profile?.url);
  const email = profile?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) ? profile.email : '';
  return <div className="page quick-introduction"><section className="card quick-introduction__card" aria-labelledby="quick-title">
    <img className="quick-introduction__logo" src="/assets/logo-emblem.webp" alt={t('شعار KSA.MEN', 'KSA.MEN logo')} width="120" height="120"/>
    {unavailable ? <><Link2 size={26} aria-hidden="true"/><h1 id="quick-title">{t('رابط التعارف غير متاح الآن', 'This introduction link is unavailable')}</h1><p>{t('انتهت صلاحيته أو أوقف صاحبه مشاركته. اطلب منه رابطاً جديداً للتواصل.', 'It has expired or its owner has stopped sharing it. Ask them for a new link to connect.')}</p><a className="button secondary" href="/" rel="noreferrer">{t('إلى منصة KSA.MEN', 'Explore KSA.MEN')}</a></>
    : !data ? <LoadingState compact/> : <>
      <span className="eyebrow">{data.mode === 'business' ? t('تعارف تجاري', 'BUSINESS INTRODUCTION') : data.mode === 'professional' ? t('تعارف مهني', 'PROFESSIONAL INTRODUCTION') : t('تعارف سريع', 'A QUICK INTRODUCTION')}</span>
      <h1 id="quick-title">{profile?.name || t('بطاقة تعارف', 'Introduction card')}</h1>
      {profile?.title && <p className="quick-introduction__role">{profile.title}</p>}
      <div className="quick-introduction__actions">
        {whatsapp && <a className="button primary" href={'https://wa.me/' + whatsapp} rel="noopener noreferrer" target="_blank"><MessageCircle size={19}/>{t('تواصل عبر واتساب', 'Connect on WhatsApp')}</a>}
        {email && <a className="button secondary" href={'mailto:' + email} rel="noreferrer"><Mail size={18}/><bdi dir="ltr">{email}</bdi></a>}
        {phone && <a className="button secondary" href={'tel:+' + phone} rel="noreferrer"><Phone size={18}/><bdi dir="ltr">{profile?.phone}</bdi></a>}
        {site && <a className="button secondary" href={site} rel="noopener noreferrer" target="_blank"><Globe size={18}/>{t('زيارة الموقع', 'Visit website')}</a>}
      </div>
      <p className="quick-introduction__expiry"><Clock3 size={17}/><span>{t('متاح حتى', 'Available until')} <time dateTime={new Date(data.expiresAt * 1000).toISOString()}>{new Date(data.expiresAt * 1000).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' })}</time> {t('بتوقيت السعودية', '(Saudi time)')}</span></p>
      <p className="quick-introduction__privacy"><ShieldCheck size={17}/>{t('بيانات اختار صاحبها مشاركتها معك. احترم خصوصيتها.', 'These details were chosen by their owner to share with you. Please respect their privacy.')}</p>
    </>}
  </section></div>;
}

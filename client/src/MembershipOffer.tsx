import { Check, Sparkles } from 'lucide-react';
import { useApp } from './lib';
import './membership-offer.css';
export default function MembershipOffer() {
  const { t, user } = useApp();
  return <section className="membership-offer card" aria-labelledby="membership-offer-title">
    <div className="membership-offer__intro"><span className="eyebrow"><Sparkles size={17}/>{t('باقة التميز', 'Excellence membership')}</span><h2 id="membership-offer-title">{t('ابدأ مجاناً. واستمر بما يناسبك.', 'Start free. Continue your way.')}</h2><p>{t('٧ أيام لجميع المزايا، دون بطاقة دفع. بعد التجربة يظل موقعك الأساسي ورمز الاستجابة السريعة متاحين.', '7 days with every feature, no payment card. Your basic site and QR remain available after the trial.')}</p></div>
    <div className="membership-offer__prices"><div><strong>13 <small>{t('ريالاً', 'SAR')}</small></strong><span>{t('شهرياً', 'per month')}</span></div><div className="membership-offer__annual"><span>{t('بمناسبة اليوم الوطني', 'National Day offer')}</span><strong>96 <small>{t('ريالاً', 'SAR')}</small></strong><span>{t('سنوياً بدلاً من', 'per year instead of')} <del>156</del></span></div></div>
    <div className="membership-offer__action"><p><Check size={16}/>{t('اختر التميز الكامل عندما تحتاجه.', 'Choose the full membership when you need it.')}</p><a className="button primary" href={user ? '/dashboard?tab=subscription' : '/start'}>{user ? t('خيارات عضويتي', 'My membership options') : t('ابدأ تجربتك', 'Start your trial')}</a></div>
  </section>;
}

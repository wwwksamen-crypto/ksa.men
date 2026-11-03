import React from 'react';
import { Eye, EyeOff, ShieldCheck, ImageIcon } from 'lucide-react';
import { useApp } from './lib';
import { itemText, list, mediaSource, socialLink, text, type ProfileRecord } from '../../shared/profile-content';
import { pathValue, profileItemIds, scalarFields, listFields, type VisibilityPolicy } from '../../shared/profile-visibility';

type Change = (patch: Partial<Omit<VisibilityPolicy, 'version'>>) => void;
export const visibilityLabels: Record<string, [string, string]> = {
  name: ['الاسم', 'Name'], title: ['المسمى', 'Title'], bio: ['النبذة', 'Introduction'], email: ['البريد', 'Email'], phone: ['الهاتف', 'Phone'], whatsapp: ['واتساب', 'WhatsApp'], city: ['المدينة', 'City'], country: ['الدولة', 'Country'], photo: ['صورة الهوية', 'Profile image'], cover: ['الغلاف', 'Cover'], youtube: ['YouTube', 'YouTube'], blog: ['المدونة', 'Journal'],
  experience: ['الخبرات', 'Experience'], education: ['التعليم', 'Education'], training: ['التدريب', 'Training'], skills: ['المهارات', 'Skills'], memberships: ['العضويات', 'Memberships'], languages: ['اللغات', 'Languages'], hobbies: ['الهوايات', 'Interests'], achievements: ['الإنجازات', 'Achievements'], timeline: ['المحطات', 'Milestones'], skillImages: ['شواهد المهارات', 'Skill evidence'], workImages: ['نماذج الأعمال', 'Work samples'], socials: ['التواصل الاجتماعي', 'Social profiles'], buttons: ['الأزرار', 'Custom buttons'], 'skillRadar.human': ['المهارات الإنسانية', 'Human skills'], 'skillRadar.scientific': ['المهارات العلمية', 'Scientific skills'], 'skillRadar.professional': ['المهارات المهنية', 'Professional skills'],
};
const sectionFields: Record<string, string[]> = { identity: ['name','title','city','country','photo','cover'], contact: ['email','phone','whatsapp'], skills: ['skills','skillRadar.human','skillRadar.scientific','skillRadar.professional'], achievements: ['achievements','timeline'] };
export function VisibilityButton({ hidden, label, busy, onClick }: { hidden: boolean; label: string; busy: boolean; onClick: () => void }) {
  const { t } = useApp();
  return <button type="button" className={`profile-visibility-toggle ${hidden ? 'is-hidden' : ''}`} aria-label={`${hidden ? t('إظهار', 'Show') : t('إخفاء', 'Hide')}: ${label}`} aria-pressed={!hidden} disabled={busy} onClick={onClick}>
    {hidden ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}<span>{hidden ? t('مخفي', 'Hidden') : t('ظاهر', 'Visible')}</span>
  </button>;
}
export function VisibilityControls({ profile, policy, onChange, busy = false, section, siteOptions = false }: { profile: ProfileRecord; policy: VisibilityPolicy; onChange: Change; busy?: boolean; section?: string; siteOptions?: boolean }) {
  const { t } = useApp();
  const ids = profileItemIds(profile), allowed = section ? sectionFields[section] || [section] : [...scalarFields, ...listFields];
  const toggleField = (field: string) => { if (field.startsWith('skillRadar.') && policy.hidden.includes('skillRadar')) { onChange({ hidden: [...policy.hidden.filter(key => key !== 'skillRadar' && key !== field), ...listFields.filter(key => key.startsWith('skillRadar.') && key !== field && !policy.hidden.includes(key))] }); return; } onChange({ hidden: policy.hidden.includes(field) ? policy.hidden.filter(key => key !== field) : [...policy.hidden, field] }); };
  const toggleItem = (field: string, index: number) => { const id = `${field}:${ids[field][index]}`; onChange({ hiddenItems: policy.hiddenItems.includes(id) ? policy.hiddenItems.filter(key => key !== id) : [...policy.hiddenItems, id] }); };
  return <section className="profile-visibility-controls" aria-label={t('خيارات الظهور', 'Visibility choices')}>
    {siteOptions && <div className="profile-visibility-site-options">
      {(['visible','listed','indexable'] as const).map(key => { const label = key === 'visible' ? t('إتاحة الموقع للزوار', 'Make the site available to visitors') : key === 'listed' ? t('الظهور في دليل المنصة', 'Appear in the platform directory') : t('السماح بفهرسة محركات البحث', 'Allow search engine indexing'); return <div key={key}><span>{label}</span><VisibilityButton hidden={!policy[key]} label={label} busy={busy} onClick={() => onChange({ [key]: !policy[key] })}/></div>; })}
      <p>{t('خيارات الظهور تُحفظ مباشرة. إتاحة الموقع لا تنشر تعديلات لم تعتمد بعد، وقد تحتاج محركات البحث وقتاً لتحديث نتائجها.', 'Visibility choices save immediately. Making the site available never publishes unapproved edits. Search engines may take time to refresh their results.')}</p>
      <div><span>{t('طلبات التواصل المهني', 'Professional contact requests')}</span><VisibilityButton hidden={policy.hidden.includes('allowContact')} label={t('طلبات التواصل المهني', 'Professional contact requests')} busy={busy} onClick={() => toggleField('allowContact')}/></div>
    </div>}
    {allowed.filter(field => text(pathValue(profile, field)) || list(pathValue(profile, field)).some(value => text(value) || Object.keys(value && typeof value === 'object' ? value : {}).length)).map(field => {
      const label = visibilityLabels[field] ? t(...visibilityLabels[field]) : field;
      const isList = (listFields as readonly string[]).includes(field), items = isList ? list(pathValue(profile, field)) : [], hidden = policy.hidden.includes(field) || field.startsWith('skillRadar.') && policy.hidden.includes('skillRadar');
      return <section className="profile-visibility-group" key={field}>
        <header><strong>{label}</strong><VisibilityButton hidden={hidden} label={label} busy={busy} onClick={() => toggleField(field)}/></header>
        {isList ? <ul>{items.map((item, index) => {
          const image = field === 'skillImages' || field === 'workImages' ? mediaSource(item) : '';
          const link = field === 'socials' || field === 'buttons' ? socialLink(item) : null;
          const itemLabel = image ? `${label} ${index + 1}` : link ? `${link.label} — ${link.url}` : itemText(item);
          if (!itemLabel) return null;
          return <li key={ids[field][index]}>{image ? <img src={image} alt={itemLabel} loading="lazy"/> : <span>{itemLabel}</span>}<VisibilityButton hidden={hidden || policy.hiddenItems.includes(`${field}:${ids[field][index]}`)} label={itemLabel} busy={busy || hidden} onClick={() => toggleItem(field, index)}/></li>;
        })}</ul> : <div className="profile-visibility-value">{mediaSource(profile[field]) ? <img src={mediaSource(profile[field])} alt={label} loading="lazy"/> : <p>{text(profile[field])}</p>}</div>}
      </section>;
    })}
  </section>;
}

import { useRef, useState } from 'react';
import { BadgeCheck, Download, FileText, LoaderCircle, Printer, Sparkles } from 'lucide-react';
import { api, useApp } from './lib';
import './identity-downloads.css';
type Kind = 'profile' | 'ats' | 'badge' | 'badgePdf';
export type PublicDownloads = { profile: boolean; ats: boolean; badge: boolean; vcard: boolean };
export default function IdentityExportActions({ name, downloads }: { name: string; downloads?: PublicDownloads }) {
  const { t, lang, notify } = useApp();
  const [busy, setBusy] = useState<Kind | ''>('');
  const pending = useRef(false);
  const download = async (kind: Kind) => {
    if (pending.current) return;
    pending.current = true; setBusy(kind);
    try {
      const [module, data] = await Promise.all([
        import('./Exports'),
        api<any>(`/api/public/export-data/${encodeURIComponent(name)}?${new URLSearchParams({kind:kind === 'badgePdf' ? 'badge' : kind,lang})}`),
      ]);
      if (!data.allowed) throw new Error(t('هذا المخرج غير متاح.', 'This download is unavailable.'));
      if (lang === 'en' && !data.translated) throw new Error(t('لم يضف صاحب الهوية نسخة إنجليزية بعد.', 'The identity owner has not added an English version yet.'));
      await module.downloadPublishedIdentity(data, lang, kind);
      notify(t('بدأ تنزيل الملف.', 'Your download has started.'));
    } catch (error) { notify(error instanceof Error ? error.message : t('تعذر تجهيز الملف. حاول مجدداً.', 'Could not prepare the file. Please try again.')); }
    finally { pending.current = false; setBusy(''); }
  };
  const options = [
    {kind:'profile' as const, enabled:downloads?.profile !== false, Icon:Sparkles, label:t('تنزيل البروفايل الفاخر', 'Executive PDF')},
    {kind:'ats' as const, enabled:downloads?.ats !== false, Icon:FileText, label:t('تنزيل السيرة الذاتية', 'ATS PDF')},
    {kind:'badge' as const, enabled:downloads?.badge !== false, Icon:BadgeCheck, label:t('بطاقة معرض رقمية', 'Digital event badge')},
    {kind:'badgePdf' as const, enabled:downloads?.badge !== false, Icon:Printer, label:t('بطاقة معرض للطباعة', 'Print-ready event badge')},
  ];
  if (!options.some(o => o.enabled)) return null;
  return <section className="identity-card identity-downloads" aria-label={t('مخرجات الهوية', 'Identity downloads')}><div className="identity-aside__marker"><Download size={18}/><span>{t('هويتي معك', 'Take my identity with you')}</span></div><div className="identity-downloads__actions">{options.filter(o => o.enabled).map(({kind,Icon,label}) => <button type="button" className="button secondary" key={kind} onClick={() => void download(kind)} disabled={Boolean(busy)} aria-busy={busy === kind}>{busy === kind ? <LoaderCircle size={17} className="spin"/> : <Icon size={17}/>}<span>{label}</span></button>)}</div>{busy && <p role="status">{t('نجهز ملفاً يليق بهذه الهوية…', 'Preparing an identity worth sharing…')}</p>}</section>;
}

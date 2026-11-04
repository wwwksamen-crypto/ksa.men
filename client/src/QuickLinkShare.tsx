import { useState } from 'react';
import { Copy, Share2, Clock3 } from 'lucide-react';
import { useApp } from './lib';

export default function QuickLinkShare({ url, expiresAt }: { url: string; expiresAt: number }) {
  const { t, lang, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const validTime = Number.isFinite(expiresAt) && expiresAt > 0;
  const expired = validTime && expiresAt * 1000 <= Date.now();
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); notify(t('تم نسخ رابط التعارف.', 'Introduction link copied.')); }
    catch { notify(t('يمكنك نسخ الرابط الظاهر بالضغط المطول عليه.', 'Long-press the displayed link to copy it.')); }
  };
  const share = async () => {
    if (!navigator.share) { await copy(); return; }
    setBusy(true);
    try { await navigator.share({ title: t('بطاقة تعارف — KSA.MEN', 'Introduction card — KSA.MEN'), url }); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) await copy(); }
    finally { setBusy(false); }
  };
  return <div className="quick-link-share">
    <div className="quick-link-share__actions">
      <button type="button" className="button button--quiet" onClick={copy} disabled={expired}><Copy size={17}/>{t('نسخ الرابط', 'Copy link')}</button>
      <button type="button" className="button button--quiet" onClick={share} disabled={busy || expired}><Share2 size={17}/>{t('مشاركة', 'Share')}</button>
    </div>
    {validTime && <p className="quick-link-share__expiry"><Clock3 size={15}/><span>{expired ? t('انتهت صلاحية الرابط.', 'This link has expired.') : <>{t('صالح حتى', 'Valid until')} <time dateTime={new Date(expiresAt * 1000).toISOString()}>{new Date(expiresAt * 1000).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' })}</time> {t('بتوقيت السعودية', '(Saudi time)')}</>}</span></p>}
  </div>;
}

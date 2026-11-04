import { useEffect, useState } from 'react';
import { Copy, Share2, UsersRound, RefreshCw } from 'lucide-react';
import { api, useApp } from './lib';
import { referralURL, type ReferralSummary } from '../../shared/referral';

export default function ReferralPanel() {
  const { user, t, lang, notify } = useApp();
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const url = data?.url || referralURL(user?.id), locale = lang === 'ar' ? 'ar-SA' : 'en-GB';
  async function load() {
    setBusy(true);
    try { setData(await api<ReferralSummary>('/api/referrals')); setError(''); }
    catch { setError(t('تعذر تحديث الإحصاءات الآن. يمكنك مشاركة رابطك والمحاولة لاحقاً.', 'Statistics are temporarily unavailable. You can still share your link.')); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [user?.id]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); notify(t('تم نسخ رابط دعوتك.', 'Your invitation link was copied.')); }
    catch { notify(t('اضغط مطولاً على الرابط الظاهر لنسخه.', 'Long-press the displayed link to copy it.')); }
  }
  async function share() {
    if (!navigator.share) return copy();
    try { await navigator.share({ title: t('دعوة إلى KSA.MEN', 'Invitation to KSA.MEN'), text: t('أنشئ حضورك المهني باسمك، وجرّب المزايا سبعة أيام.', 'Create your own professional presence and try the features for seven days.'), url }); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) await copy(); }
  }
  const metrics: Array<[keyof ReferralSummary, string, string]> = [['visits', 'فتح الدعوة', 'Invitation opens'], ['registered', 'سجّلوا حساباً', 'Registered accounts'], ['eligible', 'سداد مؤهل', 'Eligible payments'], ['rewarded', 'مكافآت مسجلة', 'Recorded rewards']];
  return <section className="card dashboard-referral referral-panel">
    <div className="dashboard-section-heading"><div><UsersRound size={19}/><h2>{t('دعوة تصنع حضوراً', 'An invitation that builds presence')}</h2></div><button type="button" className="dashboard-icon-button" disabled={busy} onClick={() => void load()} aria-label={t('تحديث الإحالات', 'Refresh referrals')}><RefreshCw size={17}/></button></div>
    <p>{t('شارك دعوة إلى هوية مهنية يستفيد منها صديقك. يحصل المحيل على 1000 نقطة تقديرية مرة واحدة بعد أول سداد مؤهل وموثق، وليس لمجرد التسجيل.', 'Invite a friend to build a useful professional identity. The referrer receives 1,000 recognition points once after the first eligible documented payment, not just registration.')}</p>
    <a className="referral-panel__url" href={url} target="_blank" rel="noreferrer"><bdi dir="ltr">{url}</bdi></a>
    <div className="referral-panel__actions"><button type="button" className="button" onClick={() => void share()} disabled={!url}><Share2 size={17}/>{t('مشاركة الدعوة', 'Share invitation')}</button><button type="button" className="button button--quiet" onClick={() => void copy()} disabled={!url}><Copy size={17}/>{t('نسخ الرابط', 'Copy link')}</button></div>
    {error ? <p role="status">{error}</p> : data ? <>
      <dl className="referral-panel__metrics">{metrics.map(([key, ar, en]) => <div key={key}><dt>{t(ar, en)}</dt><dd>{Number(data[key] || 0).toLocaleString(locale)}</dd></div>)}</dl>
      <p className="muted">{t('فتح الدعوة قياس مجهول بدأ عند تفعيل هذه الميزة، وليس عدد أشخاص فريدين. بقية الحالات من سجلات التسجيل والسداد والنقاط.', 'Invitation opens are anonymous events recorded since this feature was enabled, not unique people. Other counts come from registration, payment, and points records.')}</p>
      {(data.cancelled > 0 || data.pointsRecovered > 0 || data.pointsOutstanding > 0) && <p>{t('إحالات أُلغي سدادها:', 'Cancelled payments:')} {data.cancelled.toLocaleString(locale)} · {t('نقاط مستردة:', 'Recovered points:')} {data.pointsRecovered.toLocaleString(locale)}{data.pointsOutstanding > 0 && <> · {t('قيد تسوية الإدارة:', 'Pending administrative settlement:')} {data.pointsOutstanding.toLocaleString(locale)}</>}</p>}
    </> : <p role="status">{t('نحدّث سجل إحالاتك…', 'Updating your referral record…')}</p>}
    <p className="muted">{t('النقاط غير نقدية، ولا تعني خصماً أو رصيداً مالياً. لا تظهر لك البيانات الخاصة لمن دعوتهم.', 'Points are non-cash and are not a discount or financial balance. Invitees’ private details are not disclosed.')}</p>
  </section>;
}

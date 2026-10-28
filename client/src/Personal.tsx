import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  ChartNoAxesCombined,
  Download,
  Facebook,
  Github,
  Globe2,
  GraduationCap,
  HeartHandshake,
  ImageIcon,
  Instagram,
  Landmark,
  Link2,
  Linkedin,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Play,
  Share2,
  Sparkles,
  Target,
  Twitter,
  UserRound,
  X,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import { api, Button, useApp } from './lib';
import './personal.css';

type ProfileRecord = Record<string, unknown>;
type PublicProfileData = {
  profile?: ProfileRecord;
  site?: string;
  name?: string;
  branding?: boolean;
  userId?: string | null;
  locked?: boolean;
  photo?: string;
  message?: string;
};
type MediaPreview = { src: string; alt: string } | null;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function itemsFor(profile: ProfileRecord, key: string) {
  return Array.isArray(profile[key]) ? profile[key] : [];
}

function imageSource(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return stringValue((value as ProfileRecord).url);
  return '';
}

function loadPublicImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image unavailable'));
    image.src = src;
  });
}

function roundedCanvasRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

async function brandedQr(url: string, mark: string) {
  const qr = await import('qrcode');
  const dataUrl = await qr.toDataURL(url, { width: 640, margin: 4, errorCorrectionLevel: 'H' });

  try {
    const code = await loadPublicImage(dataUrl);
    let avatar: HTMLImageElement;
    try {
      avatar = await loadPublicImage(mark);
    } catch {
      avatar = await loadPublicImage('/assets/icon-192.png');
    }

    const canvas = document.createElement('canvas');
    canvas.width = code.naturalWidth;
    canvas.height = code.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;

    context.drawImage(code, 0, 0);
    const size = Math.round(canvas.width * .18);
    const x = Math.round((canvas.width - size) / 2);
    const y = Math.round((canvas.height - size) / 2);
    const padding = Math.round(size * .14);
    context.save();
    context.fillStyle = '#fff';
    roundedCanvasRect(context, x - padding, y - padding, size + padding * 2, size + padding * 2, Math.round(size * .22));
    context.fill();
    roundedCanvasRect(context, x, y, size, size, Math.round(size * .16));
    context.clip();
    context.drawImage(avatar, x, y, size, size);
    context.restore();
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

function socialDetails(value: unknown) {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as ProfileRecord).url : '';
  const url = stringValue(raw);
  if (!url) return null;

  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  const label = value && typeof value === 'object' ? stringValue((value as ProfileRecord).label) || host : host;
  const Icon = host.includes('linkedin.') ? Linkedin
    : host.includes('instagram.') ? Instagram
      : host.includes('facebook.') ? Facebook
        : host.includes('github.') ? Github
          : host.includes('youtube.') || host === 'youtu.be' ? Youtube
            : host.includes('twitter.') || host === 'x.com' ? Twitter
              : Globe2;
  return { url, label, Icon };
}

function youtubeId(value: string) {
  try {
    const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (!['youtube.com', 'm.youtube.com'].includes(host)) return '';
    if (url.pathname === '/watch') return url.searchParams.get('v') || '';
    const [kind, id] = url.pathname.split('/').filter(Boolean);
    return ['embed', 'shorts', 'live'].includes(kind) ? id || '' : '';
  } catch {
    return '';
  }
}

function ProfileSection({
  id,
  icon: Icon,
  kicker,
  title,
  children,
}: {
  id: string;
  icon: LucideIcon;
  kicker?: string;
  title: string;
  children: React.ReactNode;
}) {
  return <section className="identity-section" id={id}>
    <header className="identity-section__heading">
      <span className="identity-section__icon" aria-hidden="true"><Icon size={19}/></span>
      <div>
        {kicker && <p className="identity-section__kicker">{kicker}</p>}
        <h2>{title}</h2>
      </div>
    </header>
    <div className="identity-section__body">{children}</div>
  </section>;
}

function TimelineList({ items }: { items: unknown[] }) {
  return <div className="identity-timeline">
    {items.map((item, index) => {
      if (typeof item === 'string') return <p className="identity-timeline__note" key={`${item}-${index}`}>{item}</p>;
      if (!item || typeof item !== 'object') return null;

      const entry = item as ProfileRecord;
      const period = [stringValue(entry.start) || stringValue(entry.date), stringValue(entry.end)].filter(Boolean).join(' — ');
      const title = stringValue(entry.title) || stringValue(entry.name) || stringValue(entry.role);
      const organization = stringValue(entry.organization) || stringValue(entry.institution);
      const description = stringValue(entry.description);
      if (!period && !title && !organization && !description) return null;

      return <article className="identity-timeline__entry" key={`${title || organization || 'entry'}-${index}`}>
        {period && <p className="identity-timeline__period">{period}</p>}
        {title && <h3>{title}</h3>}
        {organization && <p className="identity-timeline__organization">{organization}</p>}
        {description && <p className="identity-timeline__description">{description}</p>}
      </article>;
    })}
  </div>;
}

function PillList({ items }: { items: unknown[] }) {
  const values = items.map(stringValue).filter(Boolean);
  if (!values.length) return null;
  return <ul className="identity-pills">
    {values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
  </ul>;
}

function MediaGallery({
  items,
  title,
  onPreview,
}: {
  items: unknown[];
  title: string;
  onPreview: (preview: MediaPreview) => void;
}) {
  const media = items.map(imageSource).filter(Boolean);
  if (!media.length) return null;

  return <div className="identity-gallery">
    {media.map((src, index) => <button
      type="button"
      className="identity-gallery__item"
      key={`${src}-${index}`}
      onClick={() => onPreview({ src, alt: `${title} ${index + 1}` })}
      aria-label={`${title} ${index + 1}`}
    >
      <img loading="lazy" src={src} alt={`${title} ${index + 1}`}/>
      <span><ImageIcon size={18}/></span>
    </button>)}
  </div>;
}

export default function Personal() {
  const { t, lang, notify } = useApp();
  const [data, setData] = useState<PublicProfileData | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<MediaPreview>(null);
  const [video, setVideo] = useState(false);
  const [qr, setQr] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  const profile = data?.profile || {};
  const siteName = stringValue(data?.name);
  const profileUrl = siteName ? `https://${siteName}.ksa.men` : '';
  const staticImage = (value: string) => value.startsWith('/assets/') && !value.includes('?') ? value + '?rev=launch20261028' : value;
  const profilePhoto = staticImage(stringValue(profile.photo) || '/assets/icon-192.png');
  const profileCover = staticImage(stringValue(profile.cover) || '/assets/cover-1600.webp');
  const displayName = stringValue(profile.name) || siteName;
  const location = [stringValue(profile.city), stringValue(profile.country)].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');

  const load = useCallback(() => {
    setError('');
    return api<PublicProfileData>(`/api/public/profile?lang=${lang}`)
      .then((result) => {
        setData(result);
        setVideo(false);
        if (result.site && !result.locked) {
          void api('/api/public/event', { method: 'POST', body: JSON.stringify({ site: result.site, event: 'visit' }) }).catch(() => {});
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('تعذر فتح الموقع', 'Could not open the site')));
  }, [lang, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let current = true;
    if (!profileUrl) {
      setQr('');
      return undefined;
    }

    void brandedQr(profileUrl, profilePhoto)
      .then((value) => { if (current) setQr(value); })
      .catch(() => { if (current) setQr(''); });
    return () => { current = false; };
  }, [profilePhoto, profileUrl]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (preview && !dialog.open) dialog.showModal();
    if (!preview && dialog.open) dialog.close();
  }, [preview]);

  const track = (event: 'contact' | 'vcard' | 'qr') => {
    if (!data?.site) return;
    void api('/api/public/event', { method: 'POST', body: JSON.stringify({ site: data.site, event }) }).catch(() => {});
  };

  const downloadVCard = async () => {
    try {
      const module = await import('./Exports');
      const text = module.generateVCard(profile, siteName, profileUrl);
      const anchor = document.createElement('a');
      const href = URL.createObjectURL(new Blob([text], { type: 'text/vcard;charset=utf-8' }));
      anchor.href = href;
      anchor.download = `${siteName || 'ksa-men'}.vcf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
      track('vcard');
    } catch {
      notify(t('تعذر تجهيز بطاقة الاتصال', 'Could not prepare the contact card'));
    }
  };

  const share = async () => {
    if (!profileUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName || siteName, url: profileUrl });
      } else {
        await navigator.clipboard.writeText(profileUrl);
        notify(t('تم نسخ الرابط', 'Link copied'));
      }
    } catch {
      // Share sheets can be cancelled by the visitor without needing a message.
    }
  };

  if (error) {
    return <div className="identity-page">
      <section className="identity-state" aria-live="polite">
        <span className="identity-state__mark"><Globe2 size={26}/></span>
        <h1>{t('الموقع غير متاح', 'Site unavailable')}</h1>
        <p>{error}</p>
        <a href="https://ksa.men" className="identity-page__text-link">KSA.MEN <ArrowUpRight size={16}/></a>
      </section>
    </div>;
  }

  if (!data) {
    return <div className="identity-page"><div className="identity-loading" role="status"><span/><p>{t('جارٍ تجهيز الهوية', 'Preparing this identity')}</p></div></div>;
  }

  if (data.locked) {
    return <div className="identity-page">
      <section className="identity-lock" aria-labelledby="identity-lock-title">
        <div className="identity-lock__photo"><img src={stringValue(data.photo) || '/assets/icon-192.png'} alt=""/></div>
        <span className="identity-lock__icon"><LockKeyhole size={22}/></span>
        <p className="identity-section__kicker">KSA.MEN / PRIVATE IDENTITY</p>
        <h1 id="identity-lock-title">{data.message || t('موقع خاص', 'Private site')}</h1>
        <p>{t('هذه الهوية متاحة بإذن صاحبها فقط.', 'This identity is available only with its owner’s permission.')}</p>
        <form onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api('/api/public/unlock', { method: 'POST', body: JSON.stringify({ password }) });
            void load();
          } catch (cause: unknown) {
            notify(cause instanceof Error ? cause.message : t('تعذر الدخول', 'Could not enter'));
          }
        }}>
          <label>
            <span>{t('كلمة الدخول', 'Access password')}</span>
            <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password"/>
          </label>
          <Button className="primary">{t('دخول الموقع', 'Enter site')} <ArrowUpRight size={18}/></Button>
        </form>
      </section>
    </div>;
  }

  const videoId = youtubeId(stringValue(profile.youtube));
  const experience = itemsFor(profile, 'experience');
  const education = itemsFor(profile, 'education');
  const training = itemsFor(profile, 'training');
  const timeline = itemsFor(profile, 'timeline');
  const skills = itemsFor(profile, 'skills');
  const memberships = itemsFor(profile, 'memberships');
  const languages = itemsFor(profile, 'languages');
  const hobbies = itemsFor(profile, 'hobbies');
  const achievements = itemsFor(profile, 'achievements');
  const skillImages = itemsFor(profile, 'skillImages');
  const workImages = itemsFor(profile, 'workImages');
  const socials = itemsFor(profile, 'socials');
  const buttons = itemsFor(profile, 'buttons');
  const allowContact = profile.allowContact !== false;

  return <div className="identity-page">
    <header className="identity-hero">
      <picture className="identity-hero__cover">
        <img src={profileCover} alt="" fetchPriority="high"/>
      </picture>
      <div className="identity-hero__wash" aria-hidden="true"/>
      <div className="identity-hero__content">
        <div className="identity-hero__portrait"><img src={profilePhoto} alt={displayName}/></div>
        <div className="identity-hero__copy">
          <div className="identity-hero__meta">
            <span>KSA.MEN / {t('هوية مهنية', 'PROFESSIONAL IDENTITY')}</span>
            {siteName && <bdi dir="ltr">{siteName}.ksa.men</bdi>}
          </div>
          <h1>{displayName}</h1>
          {stringValue(profile.title) && <p className="identity-hero__title">{stringValue(profile.title)}</p>}
          {location && <p className="identity-hero__location"><MapPin size={16}/>{location}</p>}
        </div>
        <div className="identity-hero__actions" aria-label={t('إجراءات الهوية', 'Identity actions')}>
          <Button className="primary" onClick={() => void downloadVCard()}><Download size={18}/>{t('حفظ جهة الاتصال', 'Save contact')}</Button>
          <Button className="secondary" onClick={() => void share()}><Share2 size={18}/>{t('مشاركة', 'Share')}</Button>
        </div>
      </div>
    </header>

    <div className="identity-workspace">
      <main className="identity-content">
        {stringValue(profile.bio) && <section className="identity-introduction" aria-labelledby="identity-introduction-title">
          <div className="identity-introduction__number" aria-hidden="true">01</div>
          <div>
            <p className="identity-section__kicker">{t('في سطور', 'IN BRIEF')}</p>
            <h2 id="identity-introduction-title">{t('رحلة مهنية، بصوت صاحبها.', 'A professional journey, in his own words.')}</h2>
          </div>
          <p className="identity-introduction__copy">{stringValue(profile.bio)}</p>
        </section>}

        {(experience.length > 0 || education.length > 0 || training.length > 0 || timeline.length > 0) && <div className="identity-group">
          <div className="identity-group__label"><Landmark size={17}/><span>{t('المسيرة', 'JOURNEY')}</span></div>
          {experience.length > 0 && <ProfileSection id="experience" icon={BriefcaseBusiness} title={t('الخبرات العملية', 'Experience')}>
            <TimelineList items={experience}/>
          </ProfileSection>}
          {education.length > 0 && <ProfileSection id="education" icon={GraduationCap} title={t('المؤهلات التعليمية', 'Education')}>
            <TimelineList items={education}/>
          </ProfileSection>}
          {training.length > 0 && <ProfileSection id="training" icon={BadgeCheck} title={t('التدريب والتطوير', 'Training')}>
            <TimelineList items={training}/>
          </ProfileSection>}
          {timeline.length > 0 && <ProfileSection id="milestones" icon={ChartNoAxesCombined} title={t('سجل الإنجازات', 'Milestones')}>
            <TimelineList items={timeline}/>
          </ProfileSection>}
        </div>}

        {(skills.length > 0 || achievements.length > 0 || languages.length > 0 || memberships.length > 0 || hobbies.length > 0) && <div className="identity-group">
          <div className="identity-group__label"><Sparkles size={17}/><span>{t('القدرات والاهتمامات', 'CAPABILITIES')}</span></div>
          <div className="identity-capabilities">
            {skills.length > 0 && <ProfileSection id="skills" icon={Sparkles} title={t('المهارات', 'Skills')}><PillList items={skills}/></ProfileSection>}
            {achievements.length > 0 && <ProfileSection id="achievements" icon={Target} title={t('الإنجازات', 'Achievements')}><PillList items={achievements}/></ProfileSection>}
            {languages.length > 0 && <ProfileSection id="languages" icon={Globe2} title={t('اللغات', 'Languages')}><PillList items={languages}/></ProfileSection>}
            {memberships.length > 0 && <ProfileSection id="memberships" icon={Building2} title={t('العضويات المهنية', 'Memberships')}><PillList items={memberships}/></ProfileSection>}
            {hobbies.length > 0 && <ProfileSection id="interests" icon={HeartHandshake} title={t('الاهتمامات', 'Interests')}><PillList items={hobbies}/></ProfileSection>}
          </div>
        </div>}

        {(skillImages.length > 0 || workImages.length > 0 || videoId) && <div className="identity-group">
          <div className="identity-group__label"><ImageIcon size={17}/><span>{t('شواهد مختارة', 'SELECTED EVIDENCE')}</span></div>
          {skillImages.length > 0 && <ProfileSection id="skill-evidence" icon={BadgeCheck} title={t('توثيق المهارات', 'Skill evidence')}>
            <MediaGallery items={skillImages} title={t('توثيق المهارات', 'Skill evidence')} onPreview={setPreview}/>
          </ProfileSection>}
          {workImages.length > 0 && <ProfileSection id="work-samples" icon={ImageIcon} title={t('نماذج الأعمال', 'Selected work')}>
            <MediaGallery items={workImages} title={t('نماذج الأعمال', 'Selected work')} onPreview={setPreview}/>
          </ProfileSection>}
          {videoId && <ProfileSection id="video" icon={Play} title={t('تعرّف عليّ', 'Meet me')}>
            {video ? <iframe
              className="identity-video"
              src={`https://www.youtube-nocookie.com/embed/${videoId}`}
              title={t('الفيديو التعريفي', 'Introduction video')}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            /> : <button className="identity-video__launch" type="button" onClick={() => setVideo(true)}>
              <span><Play size={22} fill="currentColor"/></span>
              <strong>{t('تشغيل الفيديو التعريفي', 'Play introduction')}</strong>
              <small>{t('يفتح الفيديو عند اختيارك فقط', 'Loads only when you choose to play')}</small>
            </button>}
          </ProfileSection>}
        </div>}
      </main>

      <aside className="identity-aside" aria-label={t('بيانات التواصل والمشاركة', 'Contact and sharing details')}>
        <section className="identity-card identity-aside__identity">
          <div className="identity-aside__marker"><UserRound size={18}/><span>{t('بطاقة الهوية', 'IDENTITY CARD')}</span></div>
          <h2>{displayName}</h2>
          {stringValue(profile.title) && <p>{stringValue(profile.title)}</p>}
          {siteName && <p className="identity-domain"><Globe2 size={15}/><bdi dir="ltr">{siteName}.ksa.men</bdi></p>}
          {location && <p className="identity-aside__location"><MapPin size={15}/>{location}</p>}
        </section>

        <section className="identity-card identity-aside__contact">
          <div className="identity-aside__marker"><MessageCircle size={18}/><span>{t('التواصل', 'CONTACT')}</span></div>
          {(stringValue(profile.email) || stringValue(profile.phone) || stringValue(profile.whatsapp) || allowContact) ? <div className="identity-contact-list">
            {stringValue(profile.email) && <a href={`mailto:${stringValue(profile.email)}`} onClick={() => track('contact')}>
              <Mail size={17}/><bdi dir="ltr">{stringValue(profile.email)}</bdi>
            </a>}
            {stringValue(profile.phone) && <a href={`tel:${stringValue(profile.phone)}`} onClick={() => track('contact')}>
              <Phone size={17}/><bdi dir="ltr">{stringValue(profile.phone)}</bdi>
            </a>}
            {stringValue(profile.whatsapp) && <a className="identity-contact-list__whatsapp" href={`https://wa.me/${stringValue(profile.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={() => track('contact')}>
              <MessageCircle size={17}/><span>WhatsApp</span><ArrowUpRight size={15}/>
            </a>}
            {allowContact && data.userId && <a className="identity-contact-list__request" href={`https://ksa.men/contact?recipient=${encodeURIComponent(data.userId)}`} onClick={() => track('contact')}>
              <MessageCircle size={17}/><span>{t('طلب تواصل مهني', 'Request contact')}</span><ArrowUpRight size={15}/>
            </a>}
          </div> : <p className="identity-aside__empty">{t('لا توجد وسيلة تواصل عامة مضافة.', 'No public contact method has been added.')}</p>}
        </section>

        {(socials.length > 0 || buttons.length > 0) && <section className="identity-card identity-aside__links">
          <div className="identity-aside__marker"><Link2 size={18}/><span>{t('روابط مختارة', 'SELECTED LINKS')}</span></div>
          <div className="identity-link-list">
            {socials.map((item, index) => {
              const social = socialDetails(item);
              if (!social) return null;
              const Icon = social.Icon;
              return <a key={`${social.url}-${index}`} href={social.url} target="_blank" rel="noreferrer" onClick={() => track('contact')}>
                <Icon size={17}/><bdi dir="ltr">{social.label}</bdi><ArrowUpRight size={14}/>
              </a>;
            })}
            {buttons.map((item, index) => {
              if (!item || typeof item !== 'object') return null;
              const link = item as ProfileRecord;
              const href = stringValue(link.url);
              const label = stringValue(link.label) || stringValue(link.title);
              if (!href || !label) return null;
              return <a key={`${href}-${index}`} href={href} target="_blank" rel="noreferrer" onClick={() => track('contact')}>
                <Link2 size={17}/><span>{label}</span><ArrowUpRight size={14}/>
              </a>;
            })}
          </div>
        </section>}

        <section className="identity-card identity-qr">
          <div className="identity-aside__marker"><span>{t('للوصول السريع', 'SCAN TO VISIT')}</span></div>
          {qr && <div className="identity-qr__image"><img src={qr} alt={t('رمز QR لموقع الهوية', 'QR code for this identity site')}/></div>}
          <p>{t('امسح الرمز للاحتفاظ بالرابط أو مشاركته.', 'Scan to keep or share this address.')}</p>
          {qr && <a download={`${siteName || 'ksa-men'}-qr.png`} href={qr} className="identity-page__text-link" onClick={() => track('qr')}><Download size={15}/>{t('تنزيل QR', 'Download QR')}</a>}
        </section>
      </aside>
    </div>

    {data.branding && <footer className="identity-branding">
      <img src="/assets/icon-192.png" alt=""/>
      <span>{t('ظهور رقمي يليق بك', 'A digital presence worthy of you')}</span>
      <a href="https://ksa.men/auth?register=1">{t('أنشئ موقعك', 'Create your site')} <ArrowUpRight size={15}/></a>
    </footer>}

    <dialog
      ref={dialogRef}
      className="identity-lightbox"
      aria-label={preview?.alt || t('معاينة الصورة', 'Image preview')}
      onCancel={(event) => { event.preventDefault(); setPreview(null); }}
      onClose={() => setPreview(null)}
      onClick={(event) => { if (event.currentTarget === event.target) setPreview(null); }}
    >
      {preview && <div className="identity-lightbox__frame">
        <img src={preview.src} alt={preview.alt}/>
        <button type="button" className="identity-lightbox__close" onClick={() => setPreview(null)} aria-label={t('إغلاق المعاينة', 'Close preview')}><X size={21}/></button>
        <p>{preview.alt}</p>
      </div>}
    </dialog>
  </div>;
}

import { displayCountry } from '../../shared/display-country';
import { displayError } from './lib';
import { pdfText } from './pdf-text';
import type { PdfInlineText } from './pdf-text';
import { generateVCard } from './vcard';
export { generateVCard } from './vcard';
import { sanitizeProfile } from '../../shared/profile-visibility';
import { canRestorePublishedBadge, readPublishedBadge } from './export-offline';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLandscapeProfile } from './profile-pdf';
import { loadProfilePdfAssets } from './profile-pdf-assets';
const ProfilePdfPreview = lazy(() => import('./ProfilePdfPreview'));
type ProfilePdfFile = { bytes: Uint8Array; imagesUnavailable: number };
import {
  BadgeCheck,
  Check,
  ContactRound,
  Download,
  FileText,
  IdCard,
  ImageDown,
  Languages,
  LoaderCircle,
  Printer,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, Button, useApp } from './lib';
import './exports.css';
import { buildResumeContent, resumePlainText } from './ats-content';

type Language = 'ar' | 'en';
type ExportKind = 'profile' | 'pdf' | 'ats' | 'badge' | 'card' | 'social' | 'vcard' | 'qr';
type SmartCardMode = 'professional' | 'business' | 'quick';

type StructuredItem = {
  title?: string;
  organization?: string;
  start?: string;
  end?: string;
  description?: string;
};

type LinkItem = { label?: string; name?: string; url?: string };

type Profile = {
  name?: string;
  title?: string;
  bio?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  city?: string;
  country?: string;
  photo?: string;
  cover?: string;
  experience?: Array<StructuredItem | string>;
  education?: Array<StructuredItem | string>;
  training?: Array<StructuredItem | string>;
  skills?: string[];
  memberships?: string[];
  languages?: string[];
  hobbies?: string[];
  achievements?: string[];
  timeline?: Array<StructuredItem | string>;
  socials?: LinkItem[];
  buttons?: LinkItem[];
  hidden?: string[];
  translations?: { ar?: Partial<Profile>; en?: Partial<Profile> };
  [key: string]: unknown;
};

type ExportData = {
  profile: Profile;
  name: string;
  site: string;
  allowed: boolean;
  translated: boolean;
  source?: 'draft' | 'published';
};

type PdfMaker = {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  addFonts: (fonts: Record<string, unknown>) => void;
  createPdf: (definition: unknown) => { download: (filename: string) => void; getBuffer: (callback: (buffer: Uint8Array) => void) => void };
};

const knownKinds: ExportKind[] = ['profile', 'pdf', 'ats', 'badge', 'card', 'social', 'vcard', 'qr'];
const routeAliases: Record<string, ExportKind> = {
  professional: 'profile',
  conference: 'badge',
  identity: 'profile',
};
// The server maps card, badge and social to digital_card; do not collapse them to PDF.
const exportDataKindFor = (kind: ExportKind): ExportKind => kind;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const cleanFilename = (value: string) => {
  const cleaned = value.normalize('NFKD').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned.slice(0, 72) || 'ksa-men-profile';
};

function currentRouteKind(): ExportKind {
  if (typeof window === 'undefined') return 'profile';
  const candidate = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || 'profile').toLowerCase();
  if (routeAliases[candidate]) return routeAliases[candidate];
  return knownKinds.includes(candidate as ExportKind) ? candidate as ExportKind : 'profile';
}

function currentLanguage(fallback: Language): Language {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'ar';
}

function displayName(data: ExportData | null, profile?: Profile) {
  return text(profile?.name) || text(data?.profile?.name) || text(data?.name) || 'KSA.MEN';
}

function isVisible(profile: Profile, key: string) {
  return !list<string>(profile.hidden).includes(key);
}

function field(profile: Profile, key: keyof Profile) {
  return isVisible(profile, String(key)) ? text(profile[key]) : '';
}

function profileUrl(name: string) {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  const root = host.replace(/^(www|app|admin|auth)\./, '');
  const port = window.location.port ? `:${window.location.port}` : '';
  if (!name) return window.location.origin;
  return `${window.location.protocol}//${name}.${root}${port}`;
}

function structuredLine(item: StructuredItem | string) {
  if (typeof item === 'string') return item.trim();
  const primary = text(item.title);
  const organization = text(item.organization);
  const period = [text(item.start), text(item.end)].filter(Boolean).join(' – ');
  const description = text(item.description);
  return [primary, organization, period, description].filter(Boolean).join(' — ');
}

function downloadable(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function waitForCardAssets(node: HTMLElement) {
  await document.fonts?.ready;
  await Promise.all([...node.querySelectorAll('img')].map((image) => {
    if (image.complete && image.naturalWidth) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

const QR_BRAND_ICON = '/assets/logo-emblem.webp';

function ownedImage(value: string) {
  return value.startsWith('/api/media/') || value.startsWith('/assets/') ? value : QR_BRAND_ICON;
}

function profileImage(profile: Profile) {
  return ownedImage(field(profile, 'photo'));
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the QR centre image.'));
    image.src = source;
  });
}

type QrOptions = { width?: number; centerImage?: string };

/**
 * Creates a print-sized QR code. The circular centre covers less than 3% of the
 * symbol area and is protected by H-level correction; an image failure returns
 * the unmodified QR instead of preventing a scan or download.
 */
async function qrDataUrl(value: string, options: QrOptions = {}) {
  const width = options.width ?? 1800;
  const imported: any = await import('qrcode');
  const QRCode = imported.default ?? imported;
  const qr = await QRCode.toDataURL(value, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width,
    color: { dark: '#004422', light: '#FFFFFFFF' },
  });
  if (!options.centerImage || typeof document === 'undefined') return qr;
  try {
    const [image, symbol] = await Promise.all([loadImage(ownedImage(options.centerImage)), loadImage(qr)]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = width;
    const context = canvas.getContext('2d');
    if (!context) return qr;
    context.drawImage(symbol, 0, 0, width, width);
    const disc = Math.round(width * .165);
    const radius = disc / 2;
    const x = Math.round((width - disc) / 2);
    const y = Math.round((width - disc) / 2);
    context.save();
    context.beginPath();
    context.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.clip();
    const scale = Math.max(disc / image.naturalWidth, disc / image.naturalHeight);
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    context.drawImage(image, x + (disc - drawnWidth) / 2, y + (disc - drawnHeight) / 2, drawnWidth, drawnHeight);
    context.restore();
    context.beginPath();
    context.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(3, Math.round(width * .002));
    context.strokeStyle = '#ffffff';
    context.stroke();
    return canvas.toDataURL('image/png');
  } catch {
    return qr;
  }
}

function bufferToBase64(bytes: Uint8Array) {
  // The chunk size is divisible by three, so only the final segment can include padding.
  const chunkSize = 0x6000;
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return encoded;
}

async function fontBase64(path: string) {
  const response = await fetch(path, { cache: 'force-cache' });
  if (!response.ok) throw new Error('Unable to load the embedded PDF font.');
  return bufferToBase64(new Uint8Array(await response.arrayBuffer()));
}

let pdfMakerPromise: Promise<PdfMaker> | null = null;
async function loadPdfMaker() {
  if (!pdfMakerPromise) {
    pdfMakerPromise = Promise.all([
      import('pdfmake/build/pdfmake.js'),
      fontBase64('/assets/Tajawal-Regular.ttf'),
      fontBase64('/assets/Tajawal-Bold.ttf'),
    ]).then(([module, regular, bold]) => {
      const pdfMake = ((module as any).default ?? module) as PdfMaker;
      pdfMake.addVirtualFileSystem({
        'Tajawal-Regular.ttf': regular,
        'Tajawal-Bold.ttf': bold,
      });
      pdfMake.addFonts({
        Tajawal: {
          normal: 'Tajawal-Regular.ttf',
          bold: 'Tajawal-Bold.ttf',
          italics: 'Tajawal-Regular.ttf',
          bolditalics: 'Tajawal-Bold.ttf',
        },
      });
      return pdfMake;
    });
  }
  return pdfMakerPromise;
}

const smartCardLabels = {
  ar: {
    professional: 'مهني',
    business: 'تجاري',
    quick: 'تعارف سريع',
    professionalKicker: 'هوية مهنية',
    businessKicker: 'بطاقة أعمال',
    quickKicker: 'بطاقة تعارف سريعة',
    publicProfile: 'الملف العام',
  },
  en: {
    professional: 'Professional',
    business: 'Business',
    quick: 'Quick introduction',
    professionalKicker: 'Professional identity',
    businessKicker: 'Business card',
    quickKicker: 'Quick introduction',
    publicProfile: 'Public profile',
  },
} as const;

function publicLink(profile: Profile) {
  if (!isVisible(profile, 'buttons')) return null;
  for (const item of list<LinkItem>(profile.buttons)) {
    const url = text(item.url);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!isWebUrl(parsed)) continue;
      return { label: text(item.label) || parsed.hostname, url: parsed.toString() };
    } catch {
      // An invalid custom button must never become an export destination.
    }
  }
  return null;
}

function isWebUrl(url: URL) {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function validWebUrl(value: string) {
  try { return isWebUrl(new URL(value)); } catch { return false; }
}

function smartCardDetails(profile: Profile, publicUrl: string, mode: SmartCardMode, lang: Language) {
  const copy = smartCardLabels[lang];
  const location = [field(profile, 'city'), displayCountry(profile.country, lang)].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');
  const contact = [field(profile, 'email'), field(profile, 'phone')].filter(Boolean).join(' · ');
  const business = publicLink(profile);
  if (mode === 'business') return {
    kicker: copy.businessKicker,
    title: field(profile, 'title'),
    detail: business?.label || location || copy.publicProfile,
    destination: business?.url || publicUrl,
  };
  if (mode === 'quick') return {
    kicker: copy.quickKicker,
    title: field(profile, 'title'),
    detail: contact || location || publicUrl,
    destination: publicUrl,
  };
  return {
    kicker: copy.professionalKicker,
    title: field(profile, 'title'),
    detail: location || copy.publicProfile,
    destination: publicUrl,
  };
}

function KindButton({ kind, active, onClick, children }: { kind: ExportKind; active: boolean; onClick: (kind: ExportKind) => void; children: React.ReactNode }) {
  return <button type="button" className={`exports-kind${active ? ' is-active' : ''}`} onClick={() => onClick(kind)} aria-pressed={active}>{children}</button>;
}

type DigitalCardArtworkProps = {
  cardRef?: React.Ref<HTMLDivElement>;
  avatar: string;
  profileQr: string;
  identity: string;
  details: ReturnType<typeof smartCardDetails> | null;
  publicUrl: string;
  lang: Language;
  mode: SmartCardMode;
};

function DigitalCardArtwork({ cardRef, avatar, profileQr, identity, details, publicUrl, lang, mode }: DigitalCardArtworkProps) {
  return <div ref={cardRef} className="export-digital-card" data-mode={mode} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div className="export-digital-card__mesh"/>
    <span className="export-digital-card__brand">KSA.MEN</span>
    <div className="export-digital-card__portrait"><img src={avatar} alt=""/></div>
    {profileQr && <img className="export-digital-card__qr" src={profileQr} alt=""/>}
    <div className="export-digital-card__content">
      <p>{details?.kicker}</p>
      <h2>{identity}</h2>
      {details?.title && <strong>{details.title}</strong>}
      <small>{details?.detail}</small>
    </div>
    <div className="export-digital-card__foot"><bdi dir="ltr">{details?.destination || publicUrl}</bdi></div>
  </div>;
}

type SocialCardArtworkProps = {
  cardRef?: React.Ref<HTMLDivElement>;
  avatar: string;
  profileQr: string;
  identity: string;
  title: string;
  bio: string;
  publicUrl: string;
  lang: Language;
  shareLabel: string;
};

function SocialCardArtwork({ cardRef, avatar, profileQr, identity, title, bio, publicUrl, lang, shareLabel }: SocialCardArtworkProps) {
  return <div ref={cardRef} className="export-social-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div className="export-social-card__arc export-social-card__arc--one"/>
    <div className="export-social-card__arc export-social-card__arc--two"/>
    <p className="export-social-card__brand">KSA.MEN</p>
    <div className="export-social-card__portrait"><img src={avatar} alt=""/></div>
    {profileQr && <img className="export-social-card__qr" src={profileQr} alt=""/>}
    <div className="export-social-card__content">
      <span>{shareLabel}</span>
      <h2>{identity}</h2>
      <strong>{title}</strong>
      <p>{bio.slice(0, 210)}</p>
    </div>
    <div className="export-social-card__foot"><bdi dir="ltr">{publicUrl}</bdi></div>
  </div>;
}

export default function Exports() {
  const { lang: appLang, t, notify } = useApp();
  const [kind, setKind] = useState<ExportKind>(currentRouteKind);
  const [exportLang, setExportLang] = useState<Language>(() => currentLanguage(appLang));
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [profileFile, setProfileFile] = useState<ProfilePdfFile | null>(null);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [resumeFile, setResumeFile] = useState<Uint8Array | null>(null);
  const [showResumePreview, setShowResumePreview] = useState(false);
  const resumePrepared = useRef<Uint8Array | null>(null);
  const resumePromise = useRef<Promise<Uint8Array> | null>(null);
  const reloadGeneration = useRef(0);
  const profilePromise = useRef<Promise<ProfilePdfFile> | null>(null);
  const profilePrepared = useRef<ProfilePdfFile | null>(null);
  const invalidateProfile = useCallback(() => {
    reloadGeneration.current++; profilePromise.current = null; profilePrepared.current = null;
    setProfileFile(null); setShowProfilePreview(false);
    resumePrepared.current = null; resumePromise.current = null; setResumeFile(null); setShowResumePreview(false);
  }, []);
  useEffect(() => () => { reloadGeneration.current++; profilePromise.current = null; profilePrepared.current = null; resumePromise.current = null; resumePrepared.current = null; }, []);
  const [error, setError] = useState('');
  const [translationConsent, setTranslationConsent] = useState(false);
  const [cardMode, setCardMode] = useState<SmartCardMode>('professional');
  const [qrMode, setQrMode] = useState<'site' | 'vcard'>('site');
  const [profileQr, setProfileQr] = useState('');
  const [vcardQr, setVcardQr] = useState('');
  const badgeRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const site = query.get('site') || '';
  const publicName = query.get('public') || '';
  const isPublishedSource = Boolean(publicName);

  const reload = useCallback(async () => {
    if (!site && !publicName) { setError(t('لم يتم تحديد موقع للتصدير.', 'No site was selected for export.')); setLoading(false); return; }
    invalidateProfile();
    const generation = reloadGeneration.current;
    setLoading(true);
    setError('');
    const requestQuery = new URLSearchParams({ lang: exportLang, kind: exportDataKindFor(kind) });
    const cacheKey = `ksa-men:published-badge:v2:${publicName}:${exportLang}`;
    if (isPublishedSource) { try { window.localStorage.removeItem(`ksa-men:published-export:${publicName}:${exportLang}`); } catch {} }
    try {
      const response = await api<ExportData>(isPublishedSource
        ? `/api/public/export-data/${encodeURIComponent(publicName)}?${requestQuery}`
        : `/api/export-data/${encodeURIComponent(site)}?${requestQuery}`);
      if (generation !== reloadGeneration.current) return;
      if (!response.allowed) throw new Error(t('لا تملك صلاحية هذا التصدير.', 'You are not allowed to create this export.'));
      setData(response);
      if (isPublishedSource && kind === 'badge' && response.source === 'published') { try { window.localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data: response })); } catch {} }
    } catch (cause) {
      if (generation !== reloadGeneration.current) return;
      if (canRestorePublishedBadge(kind, isPublishedSource, window.navigator.onLine, cause)) {
        try {
          const saved = readPublishedBadge(window.localStorage.getItem(cacheKey), publicName);
          if (saved) { setData(saved); return; }
        } catch {}
      } else if (isPublishedSource) {
        try { window.localStorage.removeItem(cacheKey); } catch {}
      }
      const message = displayError(cause, t('تعذر جلب بيانات التصدير.', 'Could not load export data.'));
      setData(null);
      setError(message);
    } finally { if (generation === reloadGeneration.current) setLoading(false); }
  }, [exportLang, invalidateProfile, isPublishedSource, kind, publicName, site, t]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onPopState = () => { setKind(currentRouteKind()); setExportLang(currentLanguage(appLang)); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [appLang]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ksa:sanad-context', {
      detail: {
        section: kind === 'qr' ? 'qr' : 'editor',
        step: `export-${kind}`,
        saveStatus: loading ? 'loading' : 'saved',
        reviewStatus: error ? 'attention' : 'ready',
      },
    }));
  }, [error, kind, loading]);

  const verified = Boolean(data && (exportLang === 'ar' || data.translated));
  const profile = verified && data ? data.profile : null;
  const identity = profile && data ? displayName(data, profile) : '';
  const publicUrl = data ? profileUrl(data.name) : '';
  const avatar = profile ? profileImage(profile) : QR_BRAND_ICON;
  const filename = useCallback((suffix: string, extension: string) => `${cleanFilename(data?.name || identity || data?.site || 'ksa-men')}-${kind}-${suffix}.${extension}`, [data?.name, data?.site, identity, kind]);
  const vcardPayload = useMemo(() => profile && data ? generateVCard(profile, data.name, publicUrl) : '', [data, profile, publicUrl]);
  const buildProfileQr = useCallback(async () => {
    if (!publicUrl) throw new Error('A public profile URL is required for QR export.');
    return qrDataUrl(publicUrl, { width: 1800, centerImage: avatar });
  }, [avatar, publicUrl]);
  const buildVCardQr = useCallback(async () => {
    if (!vcardPayload) throw new Error('A contact card is required for QR export.');
    return qrDataUrl(vcardPayload, { width: 1800, centerImage: avatar });
  }, [avatar, vcardPayload]);

  useEffect(() => {
    let disposed = false;
    if (kind === 'ats' || !profile || !publicUrl || !vcardPayload) {
      setProfileQr('');
      setVcardQr('');
      return () => { disposed = true; };
    }
    setProfileQr('');
    setVcardQr('');
    void buildProfileQr().then((value) => { if (!disposed) setProfileQr(value); }).catch(() => { if (!disposed) setProfileQr(''); });
    void buildVCardQr().then((value) => { if (!disposed) setVcardQr(value); }).catch(() => { if (!disposed) setVcardQr(''); });
    return () => { disposed = true; };
  }, [buildProfileQr, buildVCardQr, kind, profile, publicUrl, vcardPayload]);

  const selectKind = (next: ExportKind) => {
    if (next === kind) return;
    invalidateProfile(); setLoading(true); setData(null);
    setKind(next);
    const url = new URL(window.location.href);
    const root = url.pathname.replace(/\/[^/]+$/, '') || '/export';
    url.pathname = `${root}/${next}`;
    url.searchParams.set('lang', exportLang);
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
  };

  const selectLanguage = (next: Language) => {
    if (next === exportLang) return;
    invalidateProfile(); setLoading(true); setData(null);
    setExportLang(next);
    setTranslationConsent(false);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const translateEnglish = async () => {
    if (isPublishedSource || !site || !translationConsent) return;
    setBusy('translate');
    try {
      await api('/api/translate', { method: 'POST', body: JSON.stringify({ siteId: site, target: 'en', consent: true }) });
      await reload();
      notify(t('تمت إعادة جلب النسخة الإنجليزية المحفوظة من الخادم.', 'The saved English version was fetched again from the server.'));
    } catch (cause) {
      notify(displayError(cause, t('تعذرت الترجمة.', 'Translation could not be completed.')));
    } finally { setBusy(''); }
  };

  const prepareProfile = async (): Promise<ProfilePdfFile> => {
    if (!profile || !data || !verified || loading) throw new Error(t('حدّث بيانات الملف أولاً.', 'Refresh the profile data first.'));
    if (profilePrepared.current) return profilePrepared.current;
    if (profilePromise.current) return profilePromise.current;
    const generation = reloadGeneration.current;
    const promise = (async () => {
      const [pdfMake, assets] = await Promise.all([loadPdfMaker(), loadProfilePdfAssets(profile)]);
      await window.document.fonts.load('10.5px Tajawal');
      await window.document.fonts.load('bold 27px Tajawal');
      const definition = buildLandscapeProfile(profile, { name: data.name, url: publicUrl, lang: exportLang }, assets, pdfText);
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(t('استغرق تجهيز الملف وقتاً أطول. حاول مجدداً.', 'Preparing the file took too long. Please try again.'))), 90_000);
        try { pdfMake.createPdf(definition).getBuffer(buffer => { window.clearTimeout(timer); resolve(Uint8Array.from(buffer)); }); }
        catch (error) { window.clearTimeout(timer); reject(error); }
      });
      if (generation !== reloadGeneration.current) throw new Error(t('تغيرت بيانات الملف. جهّز النسخة الحالية.', 'The profile changed. Prepare the current version.'));
      const result = { bytes, imagesUnavailable: assets.unavailable.length };
      profilePrepared.current = result; setProfileFile(result); return result;
    })();
    profilePromise.current = promise;
    try { return await promise; } finally { if (profilePromise.current === promise) profilePromise.current = null; }
  };

  const previewProfile = async () => {
    setBusy('pdf');
    try { await prepareProfile(); setShowProfilePreview(true); }
    catch (cause) { notify(displayError(cause, t('تعذرت معاينة الملف.', 'Could not preview the profile.'))); }
    finally { setBusy(''); }
  };

  const resumeContent = useMemo(() => profile && data ? buildResumeContent(profile, { name: data.name, url: publicUrl, lang: exportLang }) : null, [data, profile, publicUrl, exportLang]);
  const prepareResume = async (): Promise<Uint8Array> => {
    if (!resumeContent || !verified || loading) throw new Error(t('حدّث بيانات الملف أولاً.', 'Refresh the profile data first.'));
    if (resumePrepared.current) return resumePrepared.current;
    if (resumePromise.current) return resumePromise.current;
    const generation = reloadGeneration.current;
    const promise = (async () => {
      const { createResumePdf, loadResumeFonts } = await import('./ats-pdf');
      const bytes = await createResumePdf(resumeContent, await loadResumeFonts());
      if (generation !== reloadGeneration.current) throw new Error(t('تغيرت بيانات الملف. جهّز النسخة الحالية.', 'The profile changed. Prepare the current version.'));
      resumePrepared.current = bytes; setResumeFile(bytes); return bytes;
    })();
    resumePromise.current = promise;
    try { return await promise; } finally { if (resumePromise.current === promise) resumePromise.current = null; }
  };
  const previewResume = async () => {
    setBusy('ats');
    try { await prepareResume(); setShowResumePreview(true); }
    catch (cause) { notify(displayError(cause, t('تعذرت معاينة السيرة.', 'Could not preview the résumé.'))); }
    finally { setBusy(''); }
  };
  const downloadResumeAlternative = async (format: 'docx' | 'txt') => {
    if (!resumeContent || !data || !verified || loading) return;
    const generation = reloadGeneration.current; setBusy('ats');
    try {
      if (format === 'docx') {
        const { createResumeDocx } = await import('./ats-docx');
        const bytes = await createResumeDocx(resumeContent);
        if (generation !== reloadGeneration.current) throw new Error(t('تغيرت بيانات الملف. جهّز النسخة الحالية.', 'The profile changed. Prepare the current version.'));
        const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
        downloadable(buffer, `${cleanFilename(data.name)}-resume-${exportLang}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      } else downloadable(resumePlainText(resumeContent), `${cleanFilename(data.name)}-resume-${exportLang}.txt`, 'text/plain;charset=utf-8');
      notify(t('بدأ تنزيل السيرة.', 'Your résumé download has started.'));
    } catch (cause) { notify(displayError(cause, t('تعذر تنزيل السيرة.', 'Could not download the résumé.'))); }
    finally { setBusy(''); }
  };
  const downloadPdf = async (ats = false) => {
    if (!profile || !data || loading) return;
    setBusy(ats ? 'ats' : 'pdf');
    try {
      if (ats) {
        const bytes = await prepareResume();
        const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
        downloadable(buffer, `${cleanFilename(data.name || identity)}-resume-${exportLang}.pdf`, 'application/pdf');
      } else {
        const result = await prepareProfile();
        const buffer = new ArrayBuffer(result.bytes.length); new Uint8Array(buffer).set(result.bytes);
        downloadable(buffer, `${cleanFilename(data.name || identity)}-profile-${exportLang}.pdf`, 'application/pdf');
        if (result.imagesUnavailable) notify(t('تم تجهيز الملف؛ بعض الصور غير متاحة حالياً. يمكنك تحديث البيانات والمحاولة مجدداً.', 'The file is ready; some images are currently unavailable. Refresh the data to try again.'));
      }
      notify(t('بدأ تنزيل الملف.', 'Your PDF download has started.'));
    } catch (cause) {
      notify(displayError(cause, t('تعذر إنشاء الملف.', 'Could not create the PDF.')));
    } finally { setBusy(''); }
  };

  const downloadVCard = () => {
    if (!profile || !data) return;
    downloadable(generateVCard(profile, data.name, publicUrl), filename('contact', 'vcf'), 'text/vcard;charset=utf-8');
    notify(t('بدأ تنزيل بطاقة الاتصال.', 'Your contact card download has started.'));
  };

  const downloadQr = async () => {
    if (!data || !publicUrl) return;
    setBusy('qr');
    try {
      const isVcard = qrMode === 'vcard';
      const image = isVcard ? (vcardQr || await buildVCardQr()) : (profileQr || await buildProfileQr());
      downloadDataUrl(image, filename(isVcard ? 'vcard-qr' : 'site-qr', 'png'));
      notify(t('تم تجهيز رمز الاستجابة السريعة عالي الدقة للطباعة.', 'A high-resolution print QR has been prepared.'));
    } catch (cause) { notify(displayError(cause, t('تعذر إنشاء رمز الاستجابة السريعة.', 'Could not create the QR code.'))); }
    finally { setBusy(''); }
  };

  const imageFromCard = async (target: 'badge' | 'social') => {
    const node = target === 'badge' ? badgeRef.current : socialRef.current;
    if (!node) return;
    setBusy(target);
    try {
      if (!profileQr) {
        setProfileQr(await buildProfileQr());
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      await waitForCardAssets(node);
      const imageModule: any = await import('html-to-image');
      const toPng = imageModule.toPng ?? imageModule.default?.toPng;
      const dimensions = target === 'social' ? { width: 1200, height: 630 } : { width: 900, height: 1200 };
      const png = await toPng(node, { ...dimensions, canvasWidth: dimensions.width * 2, canvasHeight: dimensions.height * 2, pixelRatio: 1, cacheBust: true });
      downloadDataUrl(png, filename(target, 'png'));
      notify(t('تم إنشاء بطاقة صورة عالية الدقة.', 'A high-resolution PNG card has been created.'));
    } catch (cause) { notify(displayError(cause, t('تعذر إنشاء البطاقة.', 'Could not create the card image.'))); }
    finally { setBusy(''); }
  };

  const printBadge = () => {
    if (!profile) return;
    window.print();
  };

  const actionForRoute = () => {
    if (kind === 'ats') return <Button onClick={() => void downloadPdf(true)} disabled={!verified || Boolean(busy)}><FileText size={17}/>{busy === 'ats' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل السيرة الذاتية', 'Download ATS résumé')}</Button>;
    if (kind === 'vcard') return <Button onClick={downloadVCard} disabled={!verified}><ContactRound size={17}/>{t('تنزيل بطاقة الاتصال', 'Download vCard')}</Button>;
    if (kind === 'qr') return <Button onClick={() => void downloadQr()} disabled={!verified || Boolean(busy)}><QrCode size={17}/>{busy === 'qr' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {qrMode === 'vcard' ? t('تنزيل رمز الاستجابة السريعة لبطاقة الاتصال', 'Download vCard QR') : t('تنزيل رمز الاستجابة السريعة للموقع', 'Download site QR')}</Button>;
    if (kind === 'badge') return <Button onClick={printBadge} disabled={!verified}><Printer size={17}/>{t('طباعة شارة المؤتمر', 'Print conference badge')}</Button>;
    if (kind === 'card') return <Button onClick={() => void imageFromCard('badge')} disabled={!verified || Boolean(busy)}><ImageDown size={17}/>{busy === 'badge' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل البطاقة الرقمية', 'Download digital card')}</Button>;
    if (kind === 'social') return <Button onClick={() => void imageFromCard('social')} disabled={!verified || Boolean(busy)}><Share2 size={17}/>{busy === 'social' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل بطاقة المشاركة', 'Download social card')}</Button>;
    return <Button onClick={() => void downloadPdf(false)} disabled={!verified || Boolean(busy)}><Sparkles size={17}/>{busy === 'pdf' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل الملف التعريفي', 'Download identity PDF')}</Button>;
  };

  const summary = useMemo(() => {
    if (!profile) return [];
    return [field(profile, 'title'), field(profile, 'city'), field(profile, 'email')].filter(Boolean);
  }, [profile]);
  const cardDetails = useMemo(() => profile ? smartCardDetails(profile, publicUrl, cardMode, exportLang) : null, [cardMode, exportLang, profile, publicUrl]);

  return <div className={`exports-shell${isPublishedSource ? ' exports-shell--published' : ''}${kind === 'badge' ? ' exports-shell--badge' : ''}`} dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
    <section className="exports-main">
      <header className="exports-hero card">
        <div className="exports-hero__halo" aria-hidden="true"/>
        <div className="exports-hero__copy">
          <p className="exports-kicker"><ShieldCheck size={16}/>{isPublishedSource ? t('مخرجات منشورة', 'Published exports') : t('مخرجاتك الخاصة', 'Your private exports')}</p>
          <h1>{isPublishedSource ? t('هوية جاهزة للمشاركة', 'An identity ready to share') : t('ملفك جاهز للمشاركة بثقة', 'Your profile, ready to share with confidence')}</h1>
          <p>{isPublishedSource ? t('تستخدم هذه الصفحة النسخة المنشورة فقط، وتحترم الحقول التي اختار صاحب الهوية إخفاءها.', 'This page uses only the published version and respects fields its owner chose to hide.') : t('ننشئ الملفات من بياناتك المخزنة فقط، مع احترام الحقول المخفية واللغة التي تختارها.', 'Files are made only from your stored data, respecting hidden fields and your selected language.')}</p>
        </div>
        <div className="exports-hero__controls">
          <label className="exports-language"><Languages size={16}/><span className="sr-only">{t('لغة التصدير', 'Export language')}</span><select value={exportLang} onChange={(event) => selectLanguage(event.target.value === 'en' ? 'en' : 'ar')}><option value="ar">العربية</option><option value="en">الإنجليزية</option></select></label>
          <Button className="button-quiet exports-refresh" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? 'exports-spin' : ''} size={16}/>{t('تحديث', 'Refresh')}</Button>
        </div>
      </header>

      <nav className="exports-kinds" aria-label={t('أنواع التصدير', 'Export types')}>
        <KindButton kind="profile" active={kind === 'profile' || kind === 'pdf'} onClick={selectKind}><FileText size={16}/>{t('ملف تعريفي', 'Identity PDF')}</KindButton>
        <KindButton kind="ats" active={kind === 'ats'} onClick={selectKind}><BadgeCheck size={16}/>{t('سيرة ذاتية', 'ATS résumé')}</KindButton>
        <KindButton kind="badge" active={kind === 'badge'} onClick={selectKind}><Printer size={16}/>{t('شارة مؤتمر', 'Conference badge')}</KindButton>
        <KindButton kind="card" active={kind === 'card'} onClick={selectKind}><IdCard size={16}/>{t('بطاقة رقمية', 'Digital card')}</KindButton>
        <KindButton kind="vcard" active={kind === 'vcard'} onClick={selectKind}><ContactRound size={16}/>{t('بطاقة الاتصال', 'vCard')}</KindButton>
        <KindButton kind="qr" active={kind === 'qr'} onClick={selectKind}><QrCode size={16}/>{t('رمز الاستجابة', 'QR')}</KindButton>
        <KindButton kind="social" active={kind === 'social'} onClick={selectKind}><Share2 size={16}/>{t('مشاركة', 'Social')}</KindButton>
      </nav>

      {loading && <section className="exports-state card"><LoaderCircle className="exports-spin" size={25}/><div><h2>{t('نجهز بيانات التصدير', 'Preparing export data')}</h2><p>{t('نتحقق من الصلاحية واللغة قبل إنشاء الملف.', 'We are verifying entitlement and language before creating the file.')}</p></div></section>}
      {!loading && error && <section className="exports-state exports-state--error card"><ShieldCheck size={25}/><div><h2>{t('تعذر فتح التصدير', 'Could not open this export')}</h2><p>{error}</p><Button className="button-quiet" onClick={() => void reload()}><RefreshCw size={16}/>{t('إعادة المحاولة', 'Try again')}</Button></div></section>}

      {!loading && !error && data && !isPublishedSource && exportLang === 'en' && !data.translated && <section className="exports-translation card">
        <div className="exports-translation__mark"><Languages size={23}/></div>
        <div><h2>{t('لا توجد نسخة إنجليزية محفوظة بعد', 'There is no saved English version yet')}</h2><p>{t('لا نستبدل المحتوى العربي بترجمة شكلية. وافق صراحةً على طلب ترجمة المحتوى، ثم سنعيد جلب النسخة المحفوظة من الخادم.', 'We do not substitute your Arabic content with a cosmetic translation. Explicitly consent to translate the content, then we will fetch the saved server version again.')}</p>
          <label className="exports-consent"><input type="checkbox" checked={translationConsent} onChange={(event) => setTranslationConsent(event.target.checked)}/><span>{t('أوافق على إرسال بيانات ملفي إلى مزود الترجمة المعتمد لإنشاء نسخة إنجليزية قابلة للتصحيح.', 'I consent to send my profile data to the approved translation provider to create an editable English version.')}</span></label>
          <Button onClick={() => void translateEnglish()} disabled={!translationConsent || busy === 'translate'}>{busy === 'translate' ? <LoaderCircle className="exports-spin" size={17}/> : <Languages size={17}/>} {t('ترجمة وحفظ النسخة الإنجليزية', 'Translate and save English version')}</Button>
        </div>
      </section>}

      {!loading && !error && data && verified && profile && <>
        <section className="exports-workspace card">
          <div className="exports-workspace__summary">
            <span className="exports-monogram">{identity.slice(0, 1) || 'K'}</span>
            <div><p className="exports-kicker">KSA.MEN / {t(({profile:'الملف التعريفي',pdf:'الملف التعريفي',ats:'السيرة الذاتية',vcard:'بطاقة الاتصال',qr:'رمز الاستجابة',badge:'شارة المعرض',card:'البطاقة الرقمية',social:'بطاقة المشاركة'} as Record<string,string>)[kind] || 'المخرجات', kind.toUpperCase())}</p><h2>{identity}</h2><p>{summary.join(' · ') || t('سيُصدّر الملف بالحقول المهنية العامة المتاحة.', 'The export will include available public professional fields.')}</p></div>
          </div>
          <div className="exports-workspace__actions">{(kind === 'profile' || kind === 'pdf') && <Button className="button-quiet" onClick={() => void previewProfile()} disabled={Boolean(busy)}><FileText size={17}/>{t('معاينة الصفحات', 'Preview pages')}</Button>}{kind === 'ats' && <Button className="button-quiet" onClick={() => void previewResume()} disabled={Boolean(busy)}><FileText size={17}/>{t('معاينة السيرة', 'Preview résumé')}</Button>}{actionForRoute()}</div>
        </section>

        {(kind === 'profile' || kind === 'pdf') && showProfilePreview && profileFile && <Suspense fallback={<p role="status">{t('نفتح معاينة ملفك', 'Opening your file preview')}</p>}><ProfilePdfPreview bytes={profileFile.bytes} profile={profile} lang={exportLang} t={t}/></Suspense>}
        {kind === 'ats' && showResumePreview && resumeFile && resumeContent && <Suspense fallback={<p role="status">{t('نفتح معاينة سيرتك', 'Opening your résumé preview')}</p>}><ProfilePdfPreview bytes={resumeFile} profile={profile} lang={exportLang} t={t} resume={resumeContent}/></Suspense>}
        {kind === 'ats' && <section className="card exports-resume-alternatives"><div><h2>{t('سيرة واضحة للتقديم الوظيفي', 'A clear résumé for job applications')}</h2><p>{t('عمود نصي واحد بلا صور، مع ترتيب الخبرات بالأحدث أولاً عند توفر التواريخ. اختر وورد إذا طلبته جهة التوظيف؛ تختلف قراءة الملفات من نظام لآخر.', 'A single text column without images, with newest experience first when dates are available. Choose Word if requested by the employer; parsing varies between systems.')}</p></div><div className="exports-workspace__actions"><Button className="button-quiet" onClick={() => void downloadResumeAlternative('docx')} disabled={Boolean(busy)}><Download size={16}/>{t('تنزيل وورد', 'Download Word')}</Button><Button className="button-quiet" onClick={() => void downloadResumeAlternative('txt')} disabled={Boolean(busy)}><FileText size={16}/>{t('تنزيل نسخة نصية', 'Download text copy')}</Button></div></section>}
        <section className="exports-details">
          <article className="exports-detail card"><FileText size={19}/><div><h3>{t('ملف تعريفي فاخر', 'Luxury identity PDF')}</h3><p>{t('بروفايل أفقي بغلاف وصورك ومحتواك العام، مع معاينة مطابقة لملف التنزيل.', 'A landscape profile with a cover, your images and public content, and a preview of the downloaded file.')}</p></div><Button className="button-quiet" onClick={() => void downloadPdf(false)} disabled={Boolean(busy)}><Download size={15}/>{t('تنزيل الملف', 'PDF')}</Button></article>
          <article className="exports-detail card"><BadgeCheck size={19}/><div><h3>{t('سيرة مهنية نصية', 'Text-based résumé')}</h3><p>{t('مخرج مستقل للتقديم الوظيفي، وليس البروفايل البصري. تختلف قراءة الملفات بين أنظمة التوظيف.', 'A separate document for job applications, not the visual profile. Parsing varies between recruitment systems.')}</p></div><Button className="button-quiet" onClick={() => void downloadPdf(true)} disabled={Boolean(busy)}><Download size={15}/>{t('السيرة', 'ATS')}</Button></article>
          <article className="exports-detail card"><QrCode size={19}/><div><h3>{t('رمز الاستجابة السريعة للموقع وبطاقة الاتصال', 'Site and contact QR')}</h3><p>{t('اختر رمزاً مستقلاً للموقع أو لبطاقة بطاقة الاتصال؛ وكلاهما يحترم الحقول المخفية.', 'Choose a separate code for the site or vCard; both respect hidden fields.')}</p></div><Button className="button-quiet" onClick={() => void downloadQr()} disabled={Boolean(busy)}><Download size={15}/>{t('الرمز', 'QR')}</Button></article>
          <article className="exports-detail card"><ContactRound size={19}/><div><h3>{t('بطاقة اتصال بطاقة الاتصال', 'vCard contact file')}</h3><p>{t('تتضمن فقط وسائل الاتصال والحقول غير المخفية في ملفك.', 'Includes only non-hidden contact channels and profile fields.')}</p></div><Button className="button-quiet" onClick={downloadVCard}><Download size={15}/>{t('بطاقة الاتصال', 'vCard')}</Button></article>
        </section>

        {kind === 'card' && <section className="exports-mode-panel card">
          <div><p className="exports-kicker"><IdCard size={15}/>{t('بطاقة التعارف الذكية', 'Smart introduction card')}</p><h2>{t('اختر سياق بطاقتك', 'Choose your card context')}</h2><p>{t('كل وضع يعيد ترتيب معلوماتك العامة فقط؛ لا ينشئ مؤهلات أو روابط جديدة.', 'Each mode rearranges only your public information; it never invents qualifications or links.')}</p></div>
          <div className="exports-mode-switch" aria-label={t('أوضاع بطاقة التعارف', 'Smart-card modes')}>
            {(['professional', 'business', 'quick'] as SmartCardMode[]).map((mode) => <button type="button" key={mode} onClick={() => setCardMode(mode)} className={cardMode === mode ? 'is-active' : ''} aria-pressed={cardMode === mode}>{smartCardLabels[exportLang][mode]}</button>)}
          </div>
        </section>}

        {kind === 'badge' && <section className="exports-badge-screen card">
          <div><p className="exports-kicker"><BadgeCheck size={15}/>{t('بطاقة للمعرض', 'Event badge')}</p><h2>{t('بطاقة شاشة وجاهزة للطباعة', 'Screen-ready and print-ready')}</h2><p>{isPublishedSource ? t('يمكن فتح هذه البطاقة بلا اتصال بعد عرضها مرة واحدة على هذا الجهاز.', 'This published badge can be reopened offline after it has been viewed once on this device.') : t('اطبع الشارة أو افتحها في وضع الشاشة عند لقاء الحضور.', 'Print the badge or open it in screen mode when meeting attendees.')}</p></div>
          <div className="exports-badge-screen__frame"><DigitalCardArtwork avatar={avatar} profileQr={profileQr} identity={identity} details={cardDetails} publicUrl={publicUrl} lang={exportLang} mode={cardMode}/></div>
        </section>}

        {(kind === 'card' || kind === 'badge' || kind === 'social') && <section className="exports-preview-panel card">
          <div className="exports-preview-panel__copy">
            <p className="exports-kicker"><Sparkles size={15}/>{t('معاينة مباشرة', 'Live preview')}</p>
            <h2>{kind === 'social' ? t('بطاقة مشاركة متوازنة', 'A balanced social card') : kind === 'badge' ? t('هوية المؤتمر للطباعة', 'Conference identity for print') : t('بطاقتك الرقمية', 'Your digital card')}</h2>
            <p>{t('هذه المعاينة تستخدم الحقول العامة نفسها التي ستظهر في ملف صورة أو الشارة المطبوعة.', 'This preview uses the same public fields that will appear in the PNG or printed badge.')}</p>
            <span className="exports-preview-panel__note"><Check size={15}/>{t('المعلومات المخفية لا تظهر في أي نسخة.', 'Hidden information is excluded from every version.')}</span>
          </div>
          <div className={`exports-preview-frame${kind === 'social' ? ' exports-preview-frame--social' : ''}`}>
            {kind === 'social'
              ? <SocialCardArtwork avatar={avatar} profileQr={profileQr} identity={identity} title={field(profile, 'title')} bio={field(profile, 'bio')} publicUrl={publicUrl} lang={exportLang} shareLabel={t('ظهور رقمي يليق بك', 'A digital presence worthy of you')}/>
              : <DigitalCardArtwork avatar={avatar} profileQr={profileQr} identity={identity} details={cardDetails} publicUrl={publicUrl} lang={exportLang} mode={cardMode}/>
            }
          </div>
        </section>}

        {kind === 'qr' && <section className="exports-qr-preview card">
          <div><p className="exports-kicker"><QrCode size={15}/>{t('معاينة قابلة للمسح', 'Scannable preview')}</p><h2>{qrMode === 'site' ? t('رمز موقع الهوية', 'Identity website code') : t('رمز بطاقة الاتصال', 'Contact-card code')}</h2><p>{qrMode === 'site' ? t('يرتبط هذا الرمز بعنوان ملفك المنشور.', 'This code opens your published identity address.') : t('يحمل هذا الرمز بطاقة بطاقة الاتصال بوسائل الاتصال العامة فقط.', 'This code carries a vCard with public contact channels only.')}</p><div className="exports-qr-mode-switch" role="group" aria-label={t('نوع رمز الاستجابة السريعة', 'QR type')}><button type="button" className={qrMode === 'site' ? 'is-active' : ''} onClick={() => setQrMode('site')}>{t('الموقع', 'Website')}</button><button type="button" className={qrMode === 'vcard' ? 'is-active' : ''} onClick={() => setQrMode('vcard')}>{t('بطاقة الاتصال', 'vCard')}</button></div><bdi dir="ltr">{qrMode === 'site' ? publicUrl : t('بطاقة اتصال عامة', 'Public contact card')}</bdi></div>
          <div className="exports-qr-preview__code">{(qrMode === 'site' ? profileQr : vcardQr) ? <img src={qrMode === 'site' ? profileQr : vcardQr} alt={qrMode === 'site' ? t('رمز الاستجابة السريعة للملف العام', 'QR code for the public profile') : t('رمز الاستجابة السريعة لبطاقة الاتصال', 'QR code for the contact card')}/> : <LoaderCircle className="exports-spin" size={28}/>}</div>
        </section>}

        <section className="exports-card-actions card">
          <div><p className="exports-kicker"><IdCard size={15}/>{t('بطاقات قابلة للاستخدام', 'Ready-to-use cards')}</p><h2>{t('شارة مؤتمر وبطاقات مشاركة', 'Conference badge and share cards')}</h2><p>{t('اطبع الشارة أو نزّل بطاقات صورة رقمية واجتماعية من بيانات ملفك المهني.', 'Print the badge or download digital and social PNG cards rendered from live HTML.')}</p></div>
          <div className="exports-card-actions__buttons"><Button className="button-quiet" onClick={printBadge}><Printer size={16}/>{t('طباعة الشارة', 'Print badge')}</Button><Button className="button-quiet" onClick={() => void imageFromCard('badge')} disabled={Boolean(busy)}><ImageDown size={16}/>{t('صورة رقمية', 'Digital PNG')}</Button><Button className="button-quiet" onClick={() => void imageFromCard('social')} disabled={Boolean(busy)}><ImageDown size={16}/>{t('صورة مشاركة', 'Social PNG')}</Button></div>
        </section>
      </>}
    </section>

    {profile && data && verified && <>
      <section className="export-print-sheet" dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="export-print-sheet__top"><span>KSA.MEN</span><span>{t('شارة مؤتمر', 'Conference badge')}</span></div>
        <div className="export-print-sheet__body"><img className="export-print-sheet__photo" src={avatar} alt=""/><h1>{identity}</h1><p>{field(profile, 'title')}</p><small>{[field(profile, 'city'), displayCountry(profile.country, exportLang)].filter(Boolean).join(' · ')}</small>{profileQr && <div className="export-print-sheet__qr"><img src={profileQr} alt={t('رمز الاستجابة السريعة للملف العام', 'QR code for the public profile')}/><span>{t('امسح لفتح الملف', 'Scan to open profile')}</span></div>}</div>
        <div className="export-print-sheet__bottom"><span>{publicUrl}</span><span>{t('هوية مؤتمر', 'Conference identity')}</span></div>
      </section>
      <div className="exports-capture-stage" aria-hidden="true">
        <DigitalCardArtwork cardRef={badgeRef} avatar={avatar} profileQr={profileQr} identity={identity} details={cardDetails} publicUrl={publicUrl} lang={exportLang} mode={cardMode}/>
        <SocialCardArtwork cardRef={socialRef} avatar={avatar} profileQr={profileQr} identity={identity} title={field(profile, 'title')} bio={field(profile, 'bio')} publicUrl={publicUrl} lang={exportLang} shareLabel={t('ظهور رقمي يليق بك', 'A digital presence worthy of you')}/>
      </div>
    </>}
  </div>;
}

export function QRTools() {
  const { lang, t, notify } = useApp();
  const [mode, setMode] = useState<'url' | 'vcard'>('url');
  const [url, setUrl] = useState('');
  const [form, setForm] = useState({ name: '', title: '', organization: '', email: '', phone: '', website: '' });
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ksa:sanad-context', {
      detail: { section: 'qr', step: mode, saveStatus: 'saved', reviewStatus: preview ? 'ready' : 'draft' },
    }));
  }, [mode, preview]);
  const content = mode === 'url'
    ? url.trim()
    : generateVCard({ name: form.name, title: form.title, email: form.email, phone: form.phone }, form.organization, form.website.trim());
  const hasValidWebUrl = !url.trim() || validWebUrl(url.trim());
  const hasValidVCardWebsite = !form.website.trim() || validWebUrl(form.website.trim());
  const canCreate = mode === 'url'
    ? Boolean(url.trim()) && hasValidWebUrl
    : Boolean(form.name.trim() || form.phone.trim() || form.email.trim() || form.website.trim()) && hasValidVCardWebsite;

  const createQr = async () => qrDataUrl(content, { width: 1800, centerImage: QR_BRAND_ICON });

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try { setPreview(await createQr()); }
    catch (cause) { notify(displayError(cause, t('تعذر إنشاء رمز الاستجابة السريعة.', 'Could not create the QR code.'))); }
    finally { setBusy(false); }
  };

  const download = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const image = preview || await createQr();
      if (!preview) setPreview(image);
      downloadDataUrl(image, `ksa-men-${mode}-qr.png`);
    } catch (cause) { notify(displayError(cause, t('تعذر إنشاء رمز الاستجابة السريعة.', 'Could not create the QR code.'))); }
    finally { setBusy(false); }
  };

  const downloadContact = () => {
    if (mode !== 'vcard') return;
    downloadable(content, 'ksa-men-contact.vcf', 'text/vcard;charset=utf-8');
  };

  return <section className="qr-tools" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <section className="qr-tools__hero card"><div><p className="exports-kicker"><QrCode size={16}/>{t('خدمة مجانية', 'Free tool')}</p><h1>{t('أنشئ رمز الاستجابة السريعة أو بطاقة الاتصال في ثوانٍ', 'Create a QR or vCard in seconds')}</h1><p>{t('تعمل هذه الأداة محلياً في متصفحك ولا تتطلب تسجيلاً. تحمل الرموز شعار المنصة وتُجهّز بجودة مناسبة للطباعة.', 'This tool runs locally in your browser and needs no sign-in or API request. Codes include the KSA.MEN mark, H-level correction and a print-safe quiet zone.')}</p></div><QrCode size={72} strokeWidth={1.1}/></section>
    <section className="qr-tools__workspace card">
      <div className="qr-tools__tabs"><button type="button" onClick={() => { setMode('url'); setPreview(''); }} className={mode === 'url' ? 'is-active' : ''}><Share2 size={16}/>{t('رابط', 'URL')}</button><button type="button" onClick={() => { setMode('vcard'); setPreview(''); }} className={mode === 'vcard' ? 'is-active' : ''}><ContactRound size={16}/>{t('بطاقة الاتصال', 'vCard')}</button></div>
      {mode === 'url' ? <><label className="qr-tools__field"><span>{t('الرابط المراد ترميزه', 'URL to encode')}</span><input value={url} onChange={(event) => { setUrl(event.target.value); setPreview(''); }} dir="ltr" type="url" placeholder="https://example.com" aria-invalid={!hasValidWebUrl}/></label>{!hasValidWebUrl && <p className="qr-tools__validation" role="alert">{t('استخدم رابط ويب كاملاً يبدأ بـ http:// أو https://.', 'Use a complete website URL beginning with http:// or https://.')}</p>}</> : <><div className="qr-tools__fields"><label className="qr-tools__field"><span>{t('الاسم', 'Name')}</span><input value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('المسمى', 'Title')}</span><input value={form.title} onChange={(event) => { setForm({ ...form, title: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('الجهة', 'Organization')}</span><input value={form.organization} onChange={(event) => { setForm({ ...form, organization: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('البريد', 'Email')}</span><input value={form.email} onChange={(event) => { setForm({ ...form, email: event.target.value }); setPreview(''); }} dir="ltr" type="email"/></label><label className="qr-tools__field"><span>{t('الهاتف', 'Phone')}</span><input value={form.phone} onChange={(event) => { setForm({ ...form, phone: event.target.value }); setPreview(''); }} dir="ltr" type="tel"/></label><label className="qr-tools__field"><span>{t('الموقع', 'Website')}</span><input value={form.website} onChange={(event) => { setForm({ ...form, website: event.target.value }); setPreview(''); }} dir="ltr" type="url" placeholder="https://example.com" aria-invalid={!hasValidVCardWebsite}/></label></div>{!hasValidVCardWebsite && <p className="qr-tools__validation" role="alert">{t('رابط الموقع في بطاقة الاتصال يجب أن يبدأ بـ http:// أو https://.', 'The vCard website must begin with http:// or https://.')}</p>}</>}
      <div className="qr-tools__actions"><Button onClick={() => void create()} disabled={!canCreate || busy}>{busy ? <LoaderCircle className="exports-spin" size={17}/> : <QrCode size={17}/>} {t('إنشاء رمز الاستجابة السريعة عالي الدقة', 'Create high-res QR')}</Button>{preview && <Button className="button-quiet" onClick={() => void download()} disabled={busy}><Download size={17}/>{t('تنزيل صورة', 'Download PNG')}</Button>}{mode === 'vcard' && <Button className="button-quiet" onClick={downloadContact} disabled={!canCreate || busy}><ContactRound size={17}/>{t('تنزيل بطاقة الاتصال', 'Download vCard')}</Button>}</div>
      {preview && <div className="qr-tools__preview"><img src={preview} alt={t('رمز الاستجابة السريعة تم إنشاؤه', 'Generated QR code')}/><p>{t('جاهز للطباعة أو المشاركة. يحمل الرمز مستوى تصحيح عالياً.', 'Ready to print or share. The code uses a high error-correction level.')}</p></div>}
    </section>
  </section>;
}

/** Browser-only public download, using the existing approved-data generators and artwork. */
export async function downloadPublishedIdentity(data: ExportData, lang: Language, kind: 'profile' | 'ats' | 'badge' | 'badgePdf') {
  if (!data.allowed || data.source !== 'published') throw new Error('هذا المخرج غير متاح.');
  const profile = sanitizeProfile(data.profile) as Profile;
  const url = profileUrl(data.name), base = cleanFilename(data.name), identity = displayName(data, profile);
  const saveBytes = (bytes: Uint8Array, suffix: string) => {
    const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
    downloadable(buffer, `${base}-${suffix}-${lang}.pdf`, 'application/pdf');
  };
  if (kind === 'ats') {
    const { createResumePdf, loadResumeFonts } = await import('./ats-pdf');
    saveBytes(await createResumePdf(buildResumeContent(profile, { name: data.name, url, lang }), await loadResumeFonts()), 'resume');
    return;
  }
  const pdfMake = await loadPdfMaker();
  await document.fonts.load('16px Tajawal'); await document.fonts.load('bold 27px Tajawal');
  const bytesFrom = (definition: unknown) => new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(lang === 'ar' ? 'استغرق تجهيز الملف وقتاً أطول. حاول مجدداً.' : 'Preparing the file took too long. Please try again.')), 90_000);
    try { pdfMake.createPdf(definition).getBuffer(bytes => { clearTimeout(timer); resolve(Uint8Array.from(bytes)); }); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
  if (kind === 'profile') {
    const assets = await loadProfilePdfAssets(profile);
    saveBytes(await bytesFrom(buildLandscapeProfile(profile, { name: data.name, url, lang }, assets, pdfText)), 'profile');
    return;
  }
  const avatar = profileImage(profile), code = await qrDataUrl(url, { width: 1800, centerImage: avatar });
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;pointer-events:none';
  document.body.appendChild(host);
  const [{ createRoot }, { flushSync }] = await Promise.all([import('react-dom/client'), import('react-dom')]);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<DigitalCardArtwork avatar={avatar} profileQr={code} identity={identity} details={smartCardDetails(profile, url, 'professional', lang)} publicUrl={url} lang={lang} mode="professional"/>));
    const node = host.firstElementChild as HTMLElement;
    await waitForCardAssets(node);
    const { toPng } = await import('html-to-image');
    const png = await toPng(node, { width: 900, height: 1200, canvasWidth: 1800, canvasHeight: 2400, pixelRatio: 1, cacheBust: true });
    if (kind === 'badge') downloadDataUrl(png, `${base}-badge-${lang}.png`);
    else {
      const width = 90 * 72 / 25.4, height = 120 * 72 / 25.4;
      saveBytes(await bytesFrom({pageSize:{width,height},pageMargins:0,defaultStyle:{font:'Tajawal'},info:{title:identity,creator:'KSA.MEN'},content:[{image:png,width,height}]}), 'badge');
    }
  } finally { root.unmount(); host.remove(); }
}

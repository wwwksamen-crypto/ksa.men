import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
};

type PdfMaker = {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  addFonts: (fonts: Record<string, unknown>) => void;
  createPdf: (definition: unknown) => { download: (filename: string) => void };
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
const escapeVCard = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
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

function profileVCard(profile: Profile, siteName: string, url: string) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = field(profile, 'name');
  const title = field(profile, 'title');
  const email = field(profile, 'email');
  const phone = field(profile, 'phone');
  const whatsapp = field(profile, 'whatsapp');
  const city = field(profile, 'city');
  const country = field(profile, 'country');
  const bio = field(profile, 'bio');
  if (name) { lines.push(`FN:${escapeVCard(name)}`); lines.push(`N:${escapeVCard(name)};;;;`); }
  if (title) lines.push(`TITLE:${escapeVCard(title)}`);
  if (siteName) lines.push(`ORG:${escapeVCard(siteName)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`);
  if (whatsapp) lines.push(`TEL;TYPE=WORK:${escapeVCard(whatsapp)}`);
  if (city || country) lines.push(`ADR;TYPE=WORK:;;;${escapeVCard(city)};;${escapeVCard(country)};`);
  if (url) lines.push(`URL:${escapeVCard(url)}`);
  if (bio) lines.push(`NOTE:${escapeVCard(bio)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** A local serializer for the public profile route and the free QR/vCard tool. */
export function generateVCard(profile: Profile, siteName = '', url = '') {
  return profileVCard(profile, siteName, url);
}

function structuredLine(item: StructuredItem | string) {
  if (typeof item === 'string') return item.trim();
  const primary = text(item.title);
  const organization = text(item.organization);
  const period = [text(item.start), text(item.end)].filter(Boolean).join(' – ');
  const description = text(item.description);
  return [primary, organization, period, description].filter(Boolean).join(' — ');
}

function downloadable(data: string, filename: string, type: string) {
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

const QR_BRAND_ICON = '/assets/icon-192.png';

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

const labels = {
  ar: {
    profile: 'ملف تعريفي',
    professional: 'الملف المهني',
    summary: 'نبذة مهنية',
    experience: 'الخبرات',
    education: 'التعليم',
    training: 'التدريب',
    skills: 'المهارات',
    memberships: 'العضويات',
    languages: 'اللغات',
    achievements: 'الإنجازات',
    contact: 'التواصل',
    location: 'الموقع',
    generated: 'صادر من KSA.MEN',
    noContent: 'لا توجد تفاصيل مهنية عامة مضافة بعد.',
  },
  en: {
    profile: 'Professional Profile',
    professional: 'Professional profile',
    summary: 'Professional summary',
    experience: 'Experience',
    education: 'Education',
    training: 'Training',
    skills: 'Skills',
    memberships: 'Memberships',
    languages: 'Languages',
    achievements: 'Achievements',
    contact: 'Contact',
    location: 'Location',
    generated: 'Generated with KSA.MEN',
    noContent: 'No public professional details have been added yet.',
  },
} as const;

type PdfInlineText = string | Array<{ text: string }>;

/** Wrap logical lines first; reorder Arabic word runs per line, preserving LTR phrases. */
function pdfText(value: string, rtl: boolean, width = 500, size = 10.5): PdfInlineText {
  if (!rtl || !/[\u0600-\u06ff]/u.test(value)) return value;
  const canvas=document.createElement('canvas');const measure=canvas.getContext('2d');
  if(measure)measure.font=`${size}px Tajawal`;
  const lines:string[]=[];
  for(const paragraph of value.split(/\r?\n/)){
    let line='';
    for(const word of paragraph.trim().split(/\s+/u).filter(Boolean)){
      const candidate=line?line+' '+word:word;
      if(line&&measure&&measure.measureText(candidate).width>width){lines.push(line);line=word;}else line=candidate;
    }
    lines.push(line);
  }
  return lines.flatMap((line,lineIndex)=>{
    const runs:Array<{text:string,latin:boolean}>=[];
    for(const word of line.split(/\s+/u).filter(Boolean)){
      const latin=!/[\u0600-\u06ff]/u.test(word);const last=runs[runs.length-1];
      if(latin&&last?.latin)last.text+=' '+word;else runs.push({text:word,latin});
    }
    const output=runs.reverse().flatMap((run,index)=>index?[{text:' '},{text:run.text}]:[{text:run.text}]);
    if(lineIndex<lines.length-1)output.push({text:'\n'});return output;
  });
}

function profileSections(profile: Profile, lang: Language) {
  const copy = labels[lang];
  const structured = (key: keyof Profile, title: string) => isVisible(profile, String(key))
    ? list<StructuredItem | string>(profile[key]).map(structuredLine).filter(Boolean).map((line) => ({ text: pdfText(line, lang === 'ar'), margin: [0, 0, 0, 6] }))
    : [];
  const strings = (key: keyof Profile, title: string) => isVisible(profile, String(key))
    ? list<string>(profile[key]).map(text).filter(Boolean).map((line) => ({ text: pdfText(line, lang === 'ar'), margin: [0, 0, 0, 6] }))
    : [];
  const sections: Array<[string, Array<{ text: PdfInlineText; margin: number[] }>]> = [
    [copy.experience, structured('experience', copy.experience)],
    [copy.education, structured('education', copy.education)],
    [copy.training, structured('training', copy.training)],
    [copy.skills, strings('skills', copy.skills)],
    [copy.memberships, strings('memberships', copy.memberships)],
    [copy.languages, strings('languages', copy.languages)],
    [copy.achievements, strings('achievements', copy.achievements)],
  ];
  return sections.filter(([, entries]) => entries.length);
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
  const location = [field(profile, 'city'), field(profile, 'country')].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');
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

function luxuryPdf(profile: Profile, data: ExportData, lang: Language) {
  const copy = labels[lang];
  const rtl = lang === 'ar';
  const name = displayName(data, profile);
  const title = field(profile, 'title');
  const bio = field(profile, 'bio');
  const contact = [field(profile, 'email'), field(profile, 'phone'), field(profile, 'whatsapp')].filter(Boolean).join('  •  ');
  const location = [field(profile, 'city'), field(profile, 'country')].filter(Boolean).join('، ');
  const sections = profileSections(profile, lang);
  const content: any[] = [
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 7, color: '#006837' }], margin: [0, 0, 0, 22] },
    {
      stack: [
        {text:'KSA.MEN',style:'brand',margin:[0,0,0,12]},
        {text:pdfText(name,rtl,500,25),style:'name'},
        title?{text:pdfText(title,rtl,500,13),style:'title'}:{},
        {text:pdfText(copy.professional,rtl),style:'eyebrow'},
      ],
      margin: [0, 0, 0, 24],
    },
  ];
  if (bio) content.push({ text: pdfText(copy.summary, rtl), style: 'heading' }, { text: pdfText(bio, rtl), style: 'body', margin: [0, 0, 0, 18] });
  if (contact || location) {
    content.push({
      columns: rtl
        ? [
          { width: '*', stack: [contact ? { text: pdfText(`${copy.contact}: ${contact}`, rtl), style: 'meta' } : {}, location ? { text: pdfText(`${copy.location}: ${location}`, rtl), style: 'meta' } : {}] },
          { width: 10, canvas: [{ type: 'rect', x: 0, y: 0, w: 3, h: 34, color: '#C89D4D' }] },
        ]
        : [
          { width: 10, canvas: [{ type: 'rect', x: 0, y: 0, w: 3, h: 34, color: '#C89D4D' }] },
          { width: '*', stack: [contact ? { text: pdfText(`${copy.contact}: ${contact}`, rtl), style: 'meta' } : {}, location ? { text: pdfText(`${copy.location}: ${location}`, rtl), style: 'meta' } : {}] },
        ],
      margin: [0, 0, 0, 22],
    });
  }
  sections.forEach(([heading, entries]) => content.push({ text: pdfText(heading, rtl), style: 'heading' }, { stack: entries, margin: [0, 0, 0, 14] }));
  if (content.length === 2) content.push({ text: pdfText(copy.noContent, rtl), style: 'body' });
  return {
    pageSize: 'A4',
    pageMargins: [40, 38, 40, 44],
    info: { title: `${name} — ${copy.profile}`, author: 'KSA.MEN', subject: copy.professional },
    defaultStyle: { font: 'Tajawal', fontSize: 10, color: '#173529', alignment: rtl ? 'right' : 'left', lineHeight: 1.32 },
    footer: () => ({ text: pdfText(copy.generated, rtl), font: 'Tajawal', fontSize: 8, color: '#587164', alignment: 'center', margin: [0, 12, 0, 0] }),
    styles: {
      name: { font: 'Tajawal', bold: true, fontSize: 25, color: '#004422', alignment: rtl ? 'right' : 'left' },
      title: { font: 'Tajawal', fontSize: 13, color: '#236645', margin: [0, 4, 0, 4], alignment: rtl ? 'right' : 'left' },
      eyebrow: { font: 'Tajawal', bold: true, fontSize: 8.5, color: '#9A7332', characterSpacing: .8, alignment: rtl ? 'right' : 'left' },
      brand: { font: 'Tajawal', bold: true, fontSize: 15, color: '#006837', characterSpacing: 1.1 },
      heading: { font: 'Tajawal', bold: true, fontSize: 12, color: '#006837', margin: [0, 10, 0, 7], alignment: rtl ? 'right' : 'left' },
      body: { font: 'Tajawal', fontSize: 10.5, color: '#2B4739', lineHeight: 1.5, alignment: rtl ? 'right' : 'left' },
      meta: { font: 'Tajawal', fontSize: 8.5, color: '#506C5D', margin: [0, 0, 0, 4], alignment: rtl ? 'right' : 'left' },
    },
    content,
  };
}

function atsPdf(profile: Profile, data: ExportData, lang: Language) {
  const copy = labels[lang];
  const rtl = lang === 'ar';
  const name = displayName(data, profile);
  const title = field(profile, 'title');
  const bio = field(profile, 'bio');
  const contact = [field(profile, 'email'), field(profile, 'phone'), field(profile, 'whatsapp'), [field(profile, 'city'), field(profile, 'country')].filter(Boolean).join(', ')].filter(Boolean).join(' | ');
  const content: any[] = [{ text: pdfText(name, rtl, 500, 22), style: 'name' }];
  if (title) content.push({ text: pdfText(title, rtl), style: 'role' });
  if (contact) content.push({ text: pdfText(contact, rtl), style: 'contact' });
  if (bio) content.push({ text: pdfText(copy.summary, rtl), style: 'heading' }, { text: pdfText(bio, rtl), style: 'body' });
  profileSections(profile, lang).forEach(([heading, entries]) => {
    content.push({ text: pdfText(heading, rtl), style: 'heading' }, ...entries.map((entry) => ({ ...entry, style: 'entry' })));
  });
  if (content.length === 1) content.push({ text: pdfText(copy.noContent, rtl), style: 'body' });
  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 42],
    info: { title: `${name} — ATS`, author: 'KSA.MEN', subject: 'ATS résumé' },
    defaultStyle: { font: 'Tajawal', fontSize: 10.5, color: '#111111', alignment: rtl ? 'right' : 'left', lineHeight: 1.28 },
    styles: {
      name: { font: 'Tajawal', bold: true, fontSize: 22, color: '#111111', margin: [0, 0, 0, 3], alignment: rtl ? 'right' : 'left' },
      role: { font: 'Tajawal', bold: true, fontSize: 12, color: '#222222', margin: [0, 0, 0, 4], alignment: rtl ? 'right' : 'left' },
      contact: { font: 'Tajawal', fontSize: 9, color: '#333333', margin: [0, 0, 0, 14], alignment: rtl ? 'right' : 'left' },
      heading: { font: 'Tajawal', bold: true, fontSize: 12, color: '#111111', margin: [0, 13, 0, 5], decoration: 'underline', alignment: rtl ? 'right' : 'left' },
      body: { font: 'Tajawal', fontSize: 10.5, color: '#111111', margin: [0, 0, 0, 5], alignment: rtl ? 'right' : 'left' },
      entry: { font: 'Tajawal', fontSize: 10.5, color: '#111111', margin: [0, 0, 0, 6], alignment: rtl ? 'right' : 'left' },
    },
    content,
  };
}

function KindButton({ kind, active, onClick, children }: { kind: ExportKind; active: boolean; onClick: (kind: ExportKind) => void; children: React.ReactNode }) {
  return <button type="button" className={`exports-kind${active ? ' is-active' : ''}`} onClick={() => onClick(kind)} aria-pressed={active}>{children}</button>;
}

export default function Exports() {
  const { lang: appLang, t, notify } = useApp();
  const [kind, setKind] = useState<ExportKind>(currentRouteKind);
  const [exportLang, setExportLang] = useState<Language>(() => currentLanguage(appLang));
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [translationConsent, setTranslationConsent] = useState(false);
  const [cardMode, setCardMode] = useState<SmartCardMode>('professional');
  const [profileQr, setProfileQr] = useState('');
  const badgeRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const site = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('site') || '';

  const reload = useCallback(async () => {
    if (!site) { setError(t('لم يتم تحديد موقع للتصدير.', 'No site was selected for export.')); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ lang: exportLang, kind: exportDataKindFor(kind) });
      const response = await api<ExportData>(`/api/export-data/${encodeURIComponent(site)}?${query}`);
      if (!response.allowed) throw new Error(t('لا تملك صلاحية هذا التصدير.', 'You are not allowed to create this export.'));
      setData(response);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('تعذر جلب بيانات التصدير.', 'Could not load export data.');
      setData(null);
      setError(message);
    } finally { setLoading(false); }
  }, [exportLang, kind, site, t]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onPopState = () => { setKind(currentRouteKind()); setExportLang(currentLanguage(appLang)); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [appLang]);

  const verified = Boolean(data && (exportLang === 'ar' || data.translated));
  const profile = verified && data ? data.profile : null;
  const identity = profile && data ? displayName(data, profile) : '';
  const publicUrl = data ? profileUrl(data.name) : '';
  const avatar = profile ? profileImage(profile) : QR_BRAND_ICON;
  const filename = useCallback((suffix: string, extension: string) => `${cleanFilename(data?.name || identity || data?.site || 'ksa-men')}-${kind}-${suffix}.${extension}`, [data?.name, data?.site, identity, kind]);
  const buildProfileQr = useCallback(async () => {
    if (!publicUrl) throw new Error('A public profile URL is required for QR export.');
    return qrDataUrl(publicUrl, { width: 1800, centerImage: avatar });
  }, [avatar, publicUrl]);

  useEffect(() => {
    let disposed = false;
    if (!profile || !publicUrl) {
      setProfileQr('');
      return () => { disposed = true; };
    }
    setProfileQr('');
    void buildProfileQr().then((value) => { if (!disposed) setProfileQr(value); }).catch(() => { if (!disposed) setProfileQr(''); });
    return () => { disposed = true; };
  }, [buildProfileQr, profile, publicUrl]);

  const selectKind = (next: ExportKind) => {
    setKind(next);
    const url = new URL(window.location.href);
    const root = url.pathname.replace(/\/[^/]+$/, '') || '/export';
    url.pathname = `${root}/${next}`;
    url.searchParams.set('lang', exportLang);
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
  };

  const selectLanguage = (next: Language) => {
    setExportLang(next);
    setTranslationConsent(false);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const translateEnglish = async () => {
    if (!site || !translationConsent) return;
    setBusy('translate');
    try {
      await api('/api/translate', { method: 'POST', body: JSON.stringify({ siteId: site, target: 'en', consent: true }) });
      await reload();
      notify(t('تمت إعادة جلب النسخة الإنجليزية المحفوظة من الخادم.', 'The saved English version was fetched again from the server.'));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t('تعذرت الترجمة.', 'Translation could not be completed.'));
    } finally { setBusy(''); }
  };

  const downloadPdf = async (ats = false) => {
    if (!profile || !data) return;
    setBusy(ats ? 'ats' : 'pdf');
    try {
      const pdfMake = await loadPdfMaker();
      await window.document.fonts.load('10.5px Tajawal');
      await window.document.fonts.load('bold 25px Tajawal');
      const document = ats ? atsPdf(profile, data, exportLang) : luxuryPdf(profile, data, exportLang);
      pdfMake.createPdf(document).download(filename(ats ? 'ats' : 'profile', 'pdf'));
      notify(t('بدأ تنزيل ملف PDF قابل لاستخراج النص.', 'Your text-extractable PDF download has started.'));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t('تعذر إنشاء ملف PDF.', 'Could not create the PDF.'));
    } finally { setBusy(''); }
  };

  const downloadVCard = () => {
    if (!profile || !data) return;
    downloadable(profileVCard(profile, data.name, publicUrl), filename('contact', 'vcf'), 'text/vcard;charset=utf-8');
    notify(t('بدأ تنزيل بطاقة الاتصال.', 'Your contact card download has started.'));
  };

  const downloadQr = async () => {
    if (!data || !publicUrl) return;
    setBusy('qr');
    try {
      downloadDataUrl(profileQr || await buildProfileQr(), filename('qr', 'png'));
      notify(t('تم تجهيز QR عالي الدقة للطباعة.', 'A high-resolution print QR has been prepared.'));
    } catch (cause) { notify(cause instanceof Error ? cause.message : t('تعذر إنشاء QR.', 'Could not create the QR code.')); }
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
      notify(t('تم إنشاء بطاقة PNG عالية الدقة.', 'A high-resolution PNG card has been created.'));
    } catch (cause) { notify(cause instanceof Error ? cause.message : t('تعذر إنشاء البطاقة.', 'Could not create the card image.')); }
    finally { setBusy(''); }
  };

  const printBadge = () => {
    if (!profile) return;
    window.print();
  };

  const actionForRoute = () => {
    if (kind === 'ats') return <Button onClick={() => void downloadPdf(true)} disabled={!verified || Boolean(busy)}><FileText size={17}/>{busy === 'ats' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل سيرة ATS', 'Download ATS résumé')}</Button>;
    if (kind === 'vcard') return <Button onClick={downloadVCard} disabled={!verified}><ContactRound size={17}/>{t('تنزيل vCard', 'Download vCard')}</Button>;
    if (kind === 'qr') return <Button onClick={() => void downloadQr()} disabled={!verified || Boolean(busy)}><QrCode size={17}/>{busy === 'qr' ? <LoaderCircle className="exports-spin" size={17}/> : <Download size={17}/>} {t('تنزيل QR', 'Download QR')}</Button>;
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

  return <div className="exports-shell" dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
    <main className="exports-main">
      <header className="exports-hero card">
        <div className="exports-hero__halo" aria-hidden="true"/>
        <div className="exports-hero__copy">
          <p className="exports-kicker"><ShieldCheck size={16}/>{t('مخرجاتك الخاصة', 'Your private exports')}</p>
          <h1>{t('ملفك جاهز للمشاركة بثقة', 'Your profile, ready to share with confidence')}</h1>
          <p>{t('ننشئ الملفات من بياناتك المخزنة فقط، مع احترام الحقول المخفية واللغة التي تختارها.', 'Files are made only from your stored data, respecting hidden fields and your selected language.')}</p>
        </div>
        <div className="exports-hero__controls">
          <label className="exports-language"><Languages size={16}/><span className="sr-only">{t('لغة التصدير', 'Export language')}</span><select value={exportLang} onChange={(event) => selectLanguage(event.target.value === 'en' ? 'en' : 'ar')}><option value="ar">العربية</option><option value="en">English</option></select></label>
          <Button className="button-quiet exports-refresh" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? 'exports-spin' : ''} size={16}/>{t('تحديث', 'Refresh')}</Button>
        </div>
      </header>

      <nav className="exports-kinds" aria-label={t('أنواع التصدير', 'Export types')}>
        <KindButton kind="profile" active={kind === 'profile' || kind === 'pdf'} onClick={selectKind}><FileText size={16}/>{t('PDF تعريفي', 'Identity PDF')}</KindButton>
        <KindButton kind="ats" active={kind === 'ats'} onClick={selectKind}><BadgeCheck size={16}/>{t('سيرة ATS', 'ATS résumé')}</KindButton>
        <KindButton kind="badge" active={kind === 'badge'} onClick={selectKind}><Printer size={16}/>{t('شارة مؤتمر', 'Conference badge')}</KindButton>
        <KindButton kind="card" active={kind === 'card'} onClick={selectKind}><IdCard size={16}/>{t('بطاقة رقمية', 'Digital card')}</KindButton>
        <KindButton kind="vcard" active={kind === 'vcard'} onClick={selectKind}><ContactRound size={16}/>vCard</KindButton>
        <KindButton kind="qr" active={kind === 'qr'} onClick={selectKind}><QrCode size={16}/>QR</KindButton>
        <KindButton kind="social" active={kind === 'social'} onClick={selectKind}><Share2 size={16}/>{t('مشاركة', 'Social')}</KindButton>
      </nav>

      {loading && <section className="exports-state card"><LoaderCircle className="exports-spin" size={25}/><div><h2>{t('نجهز بيانات التصدير', 'Preparing export data')}</h2><p>{t('نتحقق من الصلاحية واللغة قبل إنشاء الملف.', 'We are verifying entitlement and language before creating the file.')}</p></div></section>}
      {!loading && error && <section className="exports-state exports-state--error card"><ShieldCheck size={25}/><div><h2>{t('تعذر فتح التصدير', 'Could not open this export')}</h2><p>{error}</p><Button className="button-quiet" onClick={() => void reload()}><RefreshCw size={16}/>{t('إعادة المحاولة', 'Try again')}</Button></div></section>}

      {!loading && !error && data && exportLang === 'en' && !data.translated && <section className="exports-translation card">
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
            <div><p className="exports-kicker">KSA.MEN / {kind.toUpperCase()}</p><h2>{identity}</h2><p>{summary.join(' · ') || t('سيُصدّر الملف بالحقول المهنية العامة المتاحة.', 'The export will include available public professional fields.')}</p></div>
          </div>
          <div className="exports-workspace__actions">{actionForRoute()}</div>
        </section>

        <section className="exports-details">
          <article className="exports-detail card"><FileText size={19}/><div><h3>{t('PDF تعريفي فاخر', 'Luxury identity PDF')}</h3><p>{t('تصميم بهوية KSA.MEN ونص حيّ قابل للاستخراج، مختلف عن السيرة الآلية.', 'KSA.MEN-branded, live extractable text in a design distinct from the machine-readable résumé.')}</p></div><Button className="button-quiet" onClick={() => void downloadPdf(false)} disabled={Boolean(busy)}><Download size={15}/>{t('PDF', 'PDF')}</Button></article>
          <article className="exports-detail card"><BadgeCheck size={19}/><div><h3>{t('سيرة ATS أحادية العمود', 'Single-column ATS résumé')}</h3><p>{t('عناوين واضحة ونص Unicode حيّ بلا صورة صفحة أو زخارف تعيق التحليل.', 'Clear headings and live Unicode text, without a page image or decoration that hinders parsing.')}</p></div><Button className="button-quiet" onClick={() => void downloadPdf(true)} disabled={Boolean(busy)}><Download size={15}/>ATS</Button></article>
          <article className="exports-detail card"><QrCode size={19}/><div><h3>{t('QR عالي الدقة', 'High-resolution QR')}</h3><p>{t('يرتبط بعنوان ملفك العام، ومهيأ للطباعة والمسح الواضح.', 'Links to your public profile address and is prepared for crisp printing and scanning.')}</p></div><Button className="button-quiet" onClick={() => void downloadQr()} disabled={Boolean(busy)}><Download size={15}/>QR</Button></article>
          <article className="exports-detail card"><ContactRound size={19}/><div><h3>{t('بطاقة اتصال vCard', 'vCard contact file')}</h3><p>{t('تتضمن فقط وسائل الاتصال والحقول غير المخفية في ملفك.', 'Includes only non-hidden contact channels and profile fields.')}</p></div><Button className="button-quiet" onClick={downloadVCard}><Download size={15}/>vCard</Button></article>
        </section>

        {kind === 'card' && <section className="exports-mode-panel card">
          <div><p className="exports-kicker"><IdCard size={15}/>{t('بطاقة التعارف الذكية', 'Smart introduction card')}</p><h2>{t('اختر سياق بطاقتك', 'Choose your card context')}</h2><p>{t('كل وضع يعيد ترتيب معلوماتك العامة فقط؛ لا ينشئ مؤهلات أو روابط جديدة.', 'Each mode rearranges only your public information; it never invents qualifications or links.')}</p></div>
          <div className="exports-mode-switch" aria-label={t('أوضاع بطاقة التعارف', 'Smart-card modes')}>
            {(['professional', 'business', 'quick'] as SmartCardMode[]).map((mode) => <button type="button" key={mode} onClick={() => setCardMode(mode)} className={cardMode === mode ? 'is-active' : ''} aria-pressed={cardMode === mode}>{smartCardLabels[exportLang][mode]}</button>)}
          </div>
        </section>}

        <section className="exports-card-actions card">
          <div><p className="exports-kicker"><IdCard size={15}/>{t('بطاقات قابلة للاستخدام', 'Ready-to-use cards')}</p><h2>{t('شارة مؤتمر وبطاقات مشاركة', 'Conference badge and share cards')}</h2><p>{t('اطبع الشارة أو نزّل بطاقات PNG رقمية واجتماعية من تصميم HTML حيّ.', 'Print the badge or download digital and social PNG cards rendered from live HTML.')}</p></div>
          <div className="exports-card-actions__buttons"><Button className="button-quiet" onClick={printBadge}><Printer size={16}/>{t('طباعة الشارة', 'Print badge')}</Button><Button className="button-quiet" onClick={() => void imageFromCard('badge')} disabled={Boolean(busy)}><ImageDown size={16}/>{t('PNG رقمي', 'Digital PNG')}</Button><Button className="button-quiet" onClick={() => void imageFromCard('social')} disabled={Boolean(busy)}><ImageDown size={16}/>{t('PNG مشاركة', 'Social PNG')}</Button></div>
        </section>
      </>}
    </main>

    {profile && data && verified && <>
      <section className="export-print-sheet" dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="export-print-sheet__top"><span>KSA.MEN</span><span>{t('شارة مؤتمر', 'Conference badge')}</span></div>
        <div className="export-print-sheet__body"><img className="export-print-sheet__photo" src={avatar} alt=""/><h1>{identity}</h1><p>{field(profile, 'title')}</p><small>{[field(profile, 'city'), field(profile, 'country')].filter(Boolean).join(' · ')}</small>{profileQr && <div className="export-print-sheet__qr"><img src={profileQr} alt={t('رمز QR للملف العام', 'QR code for the public profile')}/><span>{t('امسح لفتح الملف', 'Scan to open profile')}</span></div>}</div>
        <div className="export-print-sheet__bottom"><span>{publicUrl}</span><span>{t('هوية مؤتمر', 'Conference identity')}</span></div>
      </section>
      <div className="exports-capture-stage" aria-hidden="true">
        <div ref={badgeRef} className="export-digital-card" data-mode={cardMode} dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
          <div className="export-digital-card__mesh"/><span className="export-digital-card__brand">KSA.MEN</span><div className="export-digital-card__portrait"><img src={avatar} alt=""/></div>{profileQr && <img className="export-digital-card__qr" src={profileQr} alt=""/>}<div className="export-digital-card__content"><p>{cardDetails?.kicker}</p><h2>{identity}</h2>{cardDetails?.title && <strong>{cardDetails.title}</strong>}<small>{cardDetails?.detail}</small></div><div className="export-digital-card__foot">{cardDetails?.destination || publicUrl}</div>
        </div>
        <div ref={socialRef} className="export-social-card" dir={exportLang === 'ar' ? 'rtl' : 'ltr'}>
          <div className="export-social-card__arc export-social-card__arc--one"/><div className="export-social-card__arc export-social-card__arc--two"/><p className="export-social-card__brand">KSA.MEN</p><div className="export-social-card__portrait"><img src={avatar} alt=""/></div>{profileQr && <img className="export-social-card__qr" src={profileQr} alt=""/>}<div className="export-social-card__content"><span>{t('ظهور رقمي يليق بك', 'A digital presence worthy of you')}</span><h2>{identity}</h2><strong>{field(profile, 'title')}</strong><p>{field(profile, 'bio').slice(0, 210)}</p></div><div className="export-social-card__foot">{publicUrl}</div>
        </div>
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
  const content = mode === 'url'
    ? url.trim()
    : profileVCard({ name: form.name, title: form.title, email: form.email, phone: form.phone }, form.organization, form.website.trim());
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
    catch (cause) { notify(cause instanceof Error ? cause.message : t('تعذر إنشاء QR.', 'Could not create the QR code.')); }
    finally { setBusy(false); }
  };

  const download = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const image = preview || await createQr();
      if (!preview) setPreview(image);
      downloadDataUrl(image, `ksa-men-${mode}-qr.png`);
    } catch (cause) { notify(cause instanceof Error ? cause.message : t('تعذر إنشاء QR.', 'Could not create the QR code.')); }
    finally { setBusy(false); }
  };

  const downloadContact = () => {
    if (mode !== 'vcard') return;
    downloadable(content, 'ksa-men-contact.vcf', 'text/vcard;charset=utf-8');
  };

  return <main className="qr-tools" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <section className="qr-tools__hero card"><div><p className="exports-kicker"><QrCode size={16}/>{t('خدمة مجانية', 'Free tool')}</p><h1>{t('أنشئ QR أو vCard في ثوانٍ', 'Create a QR or vCard in seconds')}</h1><p>{t('تعمل هذه الأداة محلياً في متصفحك ولا تتطلب تسجيلاً أو طلب API. تحمل الرموز شعار KSA.MEN في المركز مع تصحيح H وهامش للطباعة.', 'This tool runs locally in your browser and needs no sign-in or API request. Codes include the KSA.MEN mark, H-level correction and a print-safe quiet zone.')}</p></div><QrCode size={72} strokeWidth={1.1}/></section>
    <section className="qr-tools__workspace card">
      <div className="qr-tools__tabs"><button type="button" onClick={() => { setMode('url'); setPreview(''); }} className={mode === 'url' ? 'is-active' : ''}><Share2 size={16}/>{t('رابط', 'URL')}</button><button type="button" onClick={() => { setMode('vcard'); setPreview(''); }} className={mode === 'vcard' ? 'is-active' : ''}><ContactRound size={16}/>vCard</button></div>
      {mode === 'url' ? <><label className="qr-tools__field"><span>{t('الرابط المراد ترميزه', 'URL to encode')}</span><input value={url} onChange={(event) => { setUrl(event.target.value); setPreview(''); }} dir="ltr" type="url" placeholder="https://example.com" aria-invalid={!hasValidWebUrl}/></label>{!hasValidWebUrl && <p className="qr-tools__validation" role="alert">{t('استخدم رابط ويب كاملاً يبدأ بـ http:// أو https://.', 'Use a complete website URL beginning with http:// or https://.')}</p>}</> : <><div className="qr-tools__fields"><label className="qr-tools__field"><span>{t('الاسم', 'Name')}</span><input value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('المسمى', 'Title')}</span><input value={form.title} onChange={(event) => { setForm({ ...form, title: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('الجهة', 'Organization')}</span><input value={form.organization} onChange={(event) => { setForm({ ...form, organization: event.target.value }); setPreview(''); }}/></label><label className="qr-tools__field"><span>{t('البريد', 'Email')}</span><input value={form.email} onChange={(event) => { setForm({ ...form, email: event.target.value }); setPreview(''); }} dir="ltr" type="email"/></label><label className="qr-tools__field"><span>{t('الهاتف', 'Phone')}</span><input value={form.phone} onChange={(event) => { setForm({ ...form, phone: event.target.value }); setPreview(''); }} dir="ltr" type="tel"/></label><label className="qr-tools__field"><span>{t('الموقع', 'Website')}</span><input value={form.website} onChange={(event) => { setForm({ ...form, website: event.target.value }); setPreview(''); }} dir="ltr" type="url" placeholder="https://example.com" aria-invalid={!hasValidVCardWebsite}/></label></div>{!hasValidVCardWebsite && <p className="qr-tools__validation" role="alert">{t('رابط الموقع في vCard يجب أن يبدأ بـ http:// أو https://.', 'The vCard website must begin with http:// or https://.')}</p>}</>}
      <div className="qr-tools__actions"><Button onClick={() => void create()} disabled={!canCreate || busy}>{busy ? <LoaderCircle className="exports-spin" size={17}/> : <QrCode size={17}/>} {t('إنشاء QR عالي الدقة', 'Create high-res QR')}</Button>{preview && <Button className="button-quiet" onClick={() => void download()} disabled={busy}><Download size={17}/>{t('تنزيل PNG', 'Download PNG')}</Button>}{mode === 'vcard' && <Button className="button-quiet" onClick={downloadContact} disabled={!canCreate || busy}><ContactRound size={17}/>{t('تنزيل vCard', 'Download vCard')}</Button>}</div>
      {preview && <div className="qr-tools__preview"><img src={preview} alt={t('رمز QR تم إنشاؤه', 'Generated QR code')}/><p>{t('جاهز للطباعة أو المشاركة. يحمل الرمز مستوى تصحيح عالياً.', 'Ready to print or share. The code uses a high error-correction level.')}</p></div>}
    </section>
  </main>;
}

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Gift,
  Globe2,
  ImagePlus,
  Languages,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  PanelTop,
  PencilLine,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  Youtube,
} from 'lucide-react';
import { api, useApp } from './lib';
import './dashboard.css';

type Tab = 'editor' | 'wallet' | 'services' | 'messages' | 'subscription' | 'settings';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type UploadPurpose = 'photo' | 'cover' | 'skill' | 'work' | 'receipt';

type ResumeItem = {
  title: string;
  organization: string;
  start: string;
  end: string;
  description: string;
};

type Social = { label: string; url: string };
type CustomButton = { label: string; url: string };
type ProfileDraft = {
  name: string;
  title: string;
  bio: string;
  email: string;
  phone: string;
  whatsapp: string;
  city: string;
  country: string;
  photo: string;
  cover: string;
  youtube: string;
  experience: ResumeItem[];
  education: ResumeItem[];
  training: ResumeItem[];
  skills: string[];
  memberships: string[];
  languages: string[];
  hobbies: string[];
  achievements: string[];
  timeline: ResumeItem[];
  skillImages: string[];
  workImages: string[];
  socials: Social[];
  buttons: CustomButton[];
  hidden: string[];
  searchable: boolean;
  allowContact: boolean;
  redirect: string;
  translations?: { ar?: Partial<ProfileDraft>; en?: Partial<ProfileDraft> };
};

type Site = {
  id: string;
  name?: string;
  draft?: ProfileDraft | string;
  draft_version?: number;
  version?: number;
  status?: string;
  published_version?: number;
  analytics?: unknown;
  lock?: { enabled?: boolean; message?: string };
  [key: string]: unknown;
};

type DashboardData = {
  sites?: Site[];
  unboundNames?: UnboundName[];
  reviews?: Record<string, unknown>[];
  wallet?: { balance?: number; [key: string]: unknown };
  ledger?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  services?: Service[];
  notifications?: Notification[];
  user?: Record<string, unknown>;
  analytics?: Record<string, unknown> | unknown[];
  quickLinks?: QuickLink[];
  transfers?: Record<string, unknown>[];
  nameTransfers?: Record<string, unknown>[];
  handovers?: Record<string, unknown>[];
  [key: string]: unknown;
};

type UnboundName = {
  name: string;
  [key: string]: unknown;
};
type NameAvailability = { name: string; valid: boolean; available: boolean; reason?: string | null; suggestions?: string[] };
type NameReservation = { name: string; site: Site; createdAt: number };
type PaymentInstructionsResult = { available?: boolean; instructions?: unknown; reason?: unknown };
type WalletOperation = 'transfer' | 'redeem';

type Service = {
  key: string;
  name_ar?: string;
  name_en?: string;
  enabled?: boolean | number;
  premium?: boolean | number;
  entitled?: boolean;
  until_at?: number;
  policy?: string | Record<string, unknown>;
  [key: string]: unknown;
};

type Notification = {
  id: string;
  title: string;
  body?: string;
  read_at?: number | null;
  created_at?: number;
};

type QuickLink = { id: string; url?: string; expires_at?: number; revoked?: boolean | number; fields?: string[]; [key: string]: unknown };
type UploadResult = { id: string; url: string };
type Conversation = {
  id: string;
  status?: string;
  last_activity?: number;
  other_user?: { id?: number; name?: string };
  other_id?: number | string;
  other_name?: string;
  [key: string]: unknown;
};
type Message = { id: string; body: string; sender_id: number; created_at: number };
type ConversationDetail = Conversation & { messages?: Message[] };
type QuickMode = 'professional' | 'business' | 'quick';
type TranslationTarget = 'ar' | 'en';
type Quality = { score: number; recommendations: string[]; completed: string[] };
type IdentityInsights = {
  siteId?: string | null;
  periodDays?: number;
  events?: { visits?: number; contactClicks?: number; vcardDownloads?: number; qrInteractions?: number; total?: number };
  activity?: { last7Days?: number; last30Days?: number };
  quality?: Quality;
};

const tabs: Array<{ key: Tab; ar: string; en: string; icon: typeof PencilLine }> = [
  { key: 'editor', ar: 'المحرر', en: 'Editor', icon: PencilLine },
  { key: 'wallet', ar: 'المحفظة', en: 'Wallet', icon: WalletCards },
  { key: 'services', ar: 'الخدمات', en: 'Services', icon: Sparkles },
  { key: 'messages', ar: 'الرسائل', en: 'Messages', icon: MessageCircle },
  { key: 'subscription', ar: 'الاشتراك', en: 'Subscription', icon: ReceiptText },
  { key: 'settings', ar: 'الإعدادات', en: 'Settings', icon: Settings2 },
];

const editorSections = [
  ['identity', 'الهوية الأساسية', 'Core identity'],
  ['bio', 'النبذة', 'Introduction'],
  ['contact', 'التواصل والموقع', 'Contact and location'],
  ['experience', 'الخبرات', 'Experience'],
  ['education', 'التعليم', 'Education'],
  ['training', 'التدريب', 'Training'],
  ['skills', 'المهارات', 'Skills'],
  ['memberships', 'العضويات', 'Memberships'],
  ['languages', 'اللغات', 'Languages'],
  ['hobbies', 'الهوايات', 'Hobbies'],
  ['achievements', 'الإنجازات', 'Achievements'],
  ['timeline', 'السجل الزمني', 'Timeline'],
  ['skillImages', 'إثبات المهارات', 'Skill evidence'],
  ['workImages', 'نماذج الأعمال', 'Work samples'],
  ['youtube', 'الفيديو التعريفي', 'Introduction video'],
  ['socials', 'الروابط الاجتماعية', 'Social links'],
  ['buttons', 'الأزرار المخصصة', 'Custom buttons'],
  ['privacy', 'الخصوصية والظهور', 'Privacy and discovery'],
] as const;

type EditorSection = (typeof editorSections)[number][0];

const editorGroups: Array<{ key: string; ar: string; en: string; steps: EditorSection[] }> = [
  { key: 'identity', ar: 'الهوية', en: 'Identity', steps: ['identity', 'bio', 'contact'] },
  { key: 'journey', ar: 'المسيرة', en: 'Journey', steps: ['experience', 'education', 'training', 'timeline'] },
  { key: 'expertise', ar: 'الخبرات', en: 'Expertise', steps: ['skills', 'memberships', 'languages', 'hobbies', 'achievements'] },
  { key: 'showcase', ar: 'العرض', en: 'Showcase', steps: ['skillImages', 'workImages', 'youtube', 'socials', 'buttons'] },
  { key: 'control', ar: 'التحكم', en: 'Control', steps: ['privacy'] },
];

const editorSectionMap = Object.fromEntries(editorSections.map(([key, ar, en]) => [key, { ar, en }])) as Record<EditorSection, { ar: string; en: string }>;

const notificationSoundStorageKey = 'ksa-men:dashboard-notification-sound';
type AudioContextConstructor = new () => AudioContext;
const blankItem = (): ResumeItem => ({ title: '', organization: '', start: '', end: '', description: '' });
const emptyDraft = (): ProfileDraft => ({
  name: '', title: '', bio: '', email: '', phone: '', whatsapp: '', city: '', country: 'المملكة العربية السعودية',
  photo: '', cover: '', youtube: '', experience: [], education: [], training: [], skills: [], memberships: [], languages: [],
  hobbies: [], achievements: [], timeline: [], skillImages: [], workImages: [], socials: [], buttons: [], hidden: [],
  searchable: true, allowContact: true, redirect: '',
});

function asArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function asText(value: unknown): string { return typeof value === 'string' ? value : ''; }
function asBool(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback; }
function retentionDays(value: unknown): number | null {
  const days = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(days) && days > 0 ? days : null;
}
function browserAudioContext(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}
function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error && typeof (error as { error?: unknown }).error === 'string') return (error as { error: string }).error;
  if (error instanceof Error) return error.message;
  return 'تعذر إتمام الطلب. حاول مرة أخرى.';
}
function parseDraft(source: unknown): ProfileDraft {
  let raw: Record<string, unknown> = {};
  try { raw = typeof source === 'string' ? JSON.parse(source) as Record<string, unknown> : (source ?? {}) as Record<string, unknown>; } catch { raw = {}; }
  const normalizeStructured = (value: unknown): ResumeItem[] => asArray<Record<string, unknown>>(value).map((item) => ({
    title: asText(item.title), organization: asText(item.organization), start: asText(item.start), end: asText(item.end), description: asText(item.description),
  }));
  const normalizeStrings = (value: unknown): string[] => asArray<unknown>(value).filter((item): item is string => typeof item === 'string');
  const normalizeLinks = (value: unknown): Social[] => asArray<Record<string, unknown>>(value).map((item) => ({ label: asText(item.label) || asText(item.name), url: asText(item.url) }));
  return {
    ...emptyDraft(),
    ...Object.fromEntries(Object.keys(emptyDraft()).map((key) => [key, raw[key] ?? (emptyDraft() as unknown as Record<string, unknown>)[key]])),
    name: asText(raw.name), title: asText(raw.title), bio: asText(raw.bio), email: asText(raw.email), phone: asText(raw.phone), whatsapp: asText(raw.whatsapp),
    city: asText(raw.city), country: asText(raw.country) || 'المملكة العربية السعودية', photo: asText(raw.photo), cover: asText(raw.cover), youtube: asText(raw.youtube), redirect: asText(raw.redirect),
    experience: normalizeStructured(raw.experience), education: normalizeStructured(raw.education), training: normalizeStructured(raw.training), timeline: normalizeStructured(raw.timeline),
    skills: normalizeStrings(raw.skills), memberships: normalizeStrings(raw.memberships), languages: normalizeStrings(raw.languages), hobbies: normalizeStrings(raw.hobbies), achievements: normalizeStrings(raw.achievements),
    skillImages: normalizeStrings(raw.skillImages).slice(0, 3), workImages: normalizeStrings(raw.workImages).slice(0, 4), hidden: normalizeStrings(raw.hidden),
    socials: normalizeLinks(raw.socials), buttons: normalizeLinks(raw.buttons).slice(0, 3), searchable: asBool(raw.searchable, true), allowContact: asBool(raw.allowContact, true),
    translations: raw.translations as ProfileDraft['translations'],
  };
}
function formatDate(value?: number, locale = 'ar-SA') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value * 1000));
}
function createIdempotencyKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `dash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const NAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function validNameLabel(value: string) { return NAME_LABEL_RE.test(value); }
function publicSiteUrl(value: unknown) {
  const label = asText(value).trim().toLowerCase();
  return validNameLabel(label) ? `https://${label}.ksa.men` : '';
}
function walletAttemptStorageKey(operation: WalletOperation) { return `ksa-men:wallet-idempotency:${operation}`; }
function walletIdempotencyKey(operation: WalletOperation, signature: string) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(walletAttemptStorageKey(operation)) || 'null') as { key?: unknown; signature?: unknown } | null;
    if (typeof stored?.key === 'string' && stored.signature === signature) return stored.key;
  } catch { /* A private-browser storage failure only affects retry persistence, not the request. */ }
  const key = createIdempotencyKey();
  try { window.localStorage.setItem(walletAttemptStorageKey(operation), JSON.stringify({ key, signature })); } catch { /* The current in-flight request still carries its key. */ }
  return key;
}
function clearWalletIdempotencyKey(operation: WalletOperation, key: string) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(walletAttemptStorageKey(operation)) || 'null') as { key?: unknown } | null;
    if (stored?.key === key) window.localStorage.removeItem(walletAttemptStorageKey(operation));
  } catch { /* Storage is optional after a definitive response. */ }
}
function ambiguousNetworkFailure(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /(?:failed to fetch|network(?:error)?|load failed)/i.test(error.message));
}
function routeParams() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { tab: query.get('tab') ?? hash.get('tab'), site: query.get('site') ?? hash.get('site') };
}
function getInitialTab(): Tab {
  const tab = routeParams().tab as Tab | null;
  return tabs.some((item) => item.key === tab) ? tab! : 'editor';
}
function requestedSiteId() {
  const site = routeParams().site?.trim() ?? '';
  return site.length > 0 && site.length <= 128 ? site : '';
}
function socialHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function numericId(value: unknown): number | undefined {
  const text = String(value ?? '').replace(/^C/i, '');
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
function normalizeConversation(value: Conversation): Conversation {
  const raw = value as Record<string, unknown>;
  const other = raw.other_user && typeof raw.other_user === 'object' ? raw.other_user as Record<string, unknown> : {};
  const id = numericId(other.id ?? raw.other_id ?? raw.otherId);
  const name = asText(other.name ?? raw.other_name ?? raw.otherName);
  return {
    ...value,
    id: asText(raw.id),
    status: asText(raw.status),
    last_activity: Number(raw.last_activity ?? raw.lastActivity ?? 0),
    other_user: { id, name },
  };
}
function normalizeMessage(value: Message): Message {
  const raw = value as unknown as Record<string, unknown>;
  return { id: asText(raw.id), body: asText(raw.body), sender_id: Number(raw.sender_id ?? raw.senderId), created_at: Number(raw.created_at ?? raw.createdAt) };
}
function qualityCopy(value: string, tr: (ar: string, en: string) => string) {
  const copy: Record<string, [string, string]> = {
    'professional identity': ['الهوية المهنية', 'Professional identity'],
    'professional bio': ['النبذة المهنية', 'Professional bio'],
    'contact method': ['وسيلة التواصل', 'Contact method'],
    location: ['الموقع', 'Location'],
    experience: ['الخبرات', 'Experience'],
    'education or training': ['التعليم أو التدريب', 'Education or training'],
    skills: ['المهارات', 'Skills'],
    'work evidence': ['إثبات المهارات أو نماذج الأعمال', 'Work evidence'],
    'share links': ['روابط المشاركة', 'Share links'],
    'visual identity': ['الهوية البصرية', 'Visual identity'],
    'Add a clear professional title.': ['أضف مسمى مهنياً واضحاً.', 'Add a clear professional title.'],
    'Write a concise professional bio of at least a few sentences.': ['اكتب نبذة مهنية موجزة من عدة جمل.', 'Write a concise professional bio of at least a few sentences.'],
    'Add at least one contact method.': ['أضف وسيلة تواصل واحدة على الأقل.', 'Add at least one contact method.'],
    'Add city and country.': ['أضف المدينة والدولة.', 'Add city and country.'],
    'Add at least one professional experience.': ['أضف خبرة مهنية واحدة على الأقل.', 'Add at least one professional experience.'],
    'Add education or training details.': ['أضف تفاصيل التعليم أو التدريب.', 'Add education or training details.'],
    'List at least three skills.': ['أضف ثلاث مهارات على الأقل.', 'List at least three skills.'],
    'Add skill or work samples.': ['أضف إثبات مهارة أو نموذج عمل.', 'Add skill or work samples.'],
    'Add a professional social or custom link.': ['أضف رابطاً مهنياً أو زراً مخصصاً.', 'Add a professional social or custom link.'],
    'Add a profile photo or cover.': ['أضف صورة شخصية أو غلافاً.', 'Add a profile photo or cover.'],
  };
  return copy[value] ? tr(...copy[value]) : value;
}

export default function Dashboard() {
  const { user, lang, t, notify } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeSite, setActiveSite] = useState<Site | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [editorSection, setEditorSection] = useState<EditorSection>('identity');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [uploading, setUploading] = useState<UploadPurpose | ''>('');
  const [services, setServices] = useState<Service[]>([]);
  const [messagesData, setMessagesData] = useState<Record<string, unknown> | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [messageRecipient, setMessageRecipient] = useState(new URLSearchParams(location.search).get('recipient')||'');
  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructionsResult | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [quickLink, setQuickLink] = useState<QuickLink | null>(null);
  const [transferForm, setTransferForm] = useState({ recipient: new URLSearchParams(location.search).get('recipient')||'', amount: '' });
  const [redeemDays, setRedeemDays] = useState('1');
  const [translationConsent, setTranslationConsent] = useState(false);
  const [translationTarget, setTranslationTarget] = useState<TranslationTarget>('en');
  const [nameTransfer, setNameTransfer] = useState({ name: '', recipient: '', confirmed: false });
  const [lockForm, setLockForm] = useState({ enabled: false, password: '', message: '' });
  const [pin, setPinValue] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', days: '', notes: '', receiptId: '', receiptUrl: '' });
  const [quickFields, setQuickFields] = useState<Record<string, boolean>>({ name: true, title: true, whatsapp: false, email: false, site: true });
  const [quickDays, setQuickDays] = useState('7');
  const [quickMode, setQuickMode] = useState<QuickMode>('professional');
  const [exportLanguage, setExportLanguage] = useState<'ar' | 'en'>('ar');
  const [identityInsights, setIdentityInsights] = useState<IdentityInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [nameCandidate, setNameCandidate] = useState('');
  const [nameAvailability, setNameAvailability] = useState<NameAvailability | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const [reservingName, setReservingName] = useState(false);
  const [walletOperation, setWalletOperation] = useState<WalletOperation | ''>('');
  const [receiptError, setReceiptError] = useState('');
  const [attachingName, setAttachingName] = useState('');
  const [attachTargetId, setAttachTargetId] = useState('');
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => {
    try { return window.localStorage.getItem(notificationSoundStorageKey) === 'on'; } catch { return false; }
  });

  const draftRef = useRef(draft);
  const siteIdRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const notificationSoundRef = useRef(notificationSoundEnabled);
  const notificationAudioRef = useRef<AudioContext | null>(null);
  const seenNotificationIdsRef = useRef<Set<string> | null>(null);
  const dashboardInteractiveRef = useRef<HTMLDivElement | null>(null);
  const nameCheckSequenceRef = useRef(0);

  const tr = useCallback((ar: string, en: string) => t(ar, en), [t]);
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  const normalizedNameCandidate = nameCandidate.trim().toLowerCase();
  const localNameCandidateValid = validNameLabel(normalizedNameCandidate);

  useEffect(() => {
    const candidate = normalizedNameCandidate;
    const sequence = ++nameCheckSequenceRef.current;
    if (!candidate) {
      setCheckingName(false);
      setNameAvailability(null);
      return;
    }
    if (!validNameLabel(candidate)) {
      setCheckingName(false);
      setNameAvailability({ name: candidate, valid: false, available: false, reason: tr('استخدم 1–63 حرفاً صغيراً أو رقماً، مع شرطات داخلية فقط. الشرطات المتتالية مسموحة.', 'Use 1–63 lowercase letters or numbers with internal hyphens only. Consecutive hyphens are allowed.') });
      return;
    }
    setCheckingName(true);
    const timer = window.setTimeout(() => {
      void api<NameAvailability>(`/api/names/check?name=${encodeURIComponent(candidate)}`)
        .then((result) => { if (nameCheckSequenceRef.current === sequence) setNameAvailability(result); })
        .catch((error) => {
          if (nameCheckSequenceRef.current === sequence) setNameAvailability({ name: candidate, valid: false, available: false, reason: errorMessage(error) });
        })
        .finally(() => { if (nameCheckSequenceRef.current === sequence) setCheckingName(false); });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [normalizedNameCandidate, tr]);

  const playNotificationChime = useCallback(() => {
    const context = notificationAudioRef.current;
    if (!notificationSoundRef.current || !context || context.state !== 'running') return;
    try {
      const startedAt = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, startedAt);
      oscillator.frequency.exponentialRampToValueAtTime(1320, startedAt + 0.14);
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.07, startedAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.23);
    } catch { /* Sound is optional and must never interrupt notification polling. */ }
  }, []);

  const observeNotifications = useCallback((items: Notification[]) => {
    const nextIds = new Set(items.map((item) => item.id).filter(Boolean));
    const previousIds = seenNotificationIdsRef.current;
    if (previousIds && Array.from(nextIds).some((id) => !previousIds.has(id))) playNotificationChime();
    seenNotificationIdsRef.current = nextIds;
  }, [playNotificationChime]);

  const setNotificationSound = async (enabled: boolean) => {
    if (!enabled) {
      notificationSoundRef.current = false;
      setNotificationSoundEnabled(false);
      try { window.localStorage.setItem(notificationSoundStorageKey, 'off'); } catch { /* Local preference is optional. */ }
      return;
    }
    try {
      const AudioContext = browserAudioContext();
      if (!AudioContext) throw new Error('unsupported');
      const context = notificationAudioRef.current ?? new AudioContext();
      notificationAudioRef.current = context;
      if (context.state === 'suspended') await context.resume();
      if (context.state !== 'running') throw new Error('not-running');
      notificationSoundRef.current = true;
      setNotificationSoundEnabled(true);
      try { window.localStorage.setItem(notificationSoundStorageKey, 'on'); } catch { /* Local preference is optional. */ }
      notify(tr('تم تفعيل صوت التنبيه محلياً لهذا المتصفح.', 'Notification sound is enabled locally in this browser.'));
    } catch {
      notificationSoundRef.current = false;
      setNotificationSoundEnabled(false);
      try { window.localStorage.setItem(notificationSoundStorageKey, 'off'); } catch { /* Local preference is optional. */ }
      notify(tr('تعذر تفعيل الصوت من المتصفح. بقي الخيار متوقفاً.', 'The browser could not enable sound. The option remains off.'));
    }
  };

  useEffect(() => { notificationSoundRef.current = notificationSoundEnabled; }, [notificationSoundEnabled]);
  useEffect(() => () => { void notificationAudioRef.current?.close(); }, []);
  useEffect(() => {
    const requiredMissing = activeTab === 'editor'
      ? [
          ...(draft.name.trim() ? [] : [tr('الاسم', 'Name')]),
          ...(draft.title.trim() ? [] : [tr('المسمى المهني', 'Professional title')]),
        ]
      : [];
    window.dispatchEvent(new CustomEvent('ksa:sanad-context', {
      detail: {
        section: activeTab,
        step: activeTab === 'editor' ? editorSection : '',
        requiredMissing,
        saveStatus: saveState,
        reviewStatus: activeSite?.status || 'draft',
      },
    }));
  }, [activeSite?.status, activeTab, draft.name, draft.title, editorSection, saveState, tr]);
  useEffect(() => {
    const interactive = dashboardInteractiveRef.current;
    if (!interactive || !previewOpen) return;
    interactive.setAttribute('inert', '');
    return () => {
      interactive.removeAttribute('inert');
    };
  }, [previewOpen]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api<DashboardData>('/api/dashboard');
      observeNotifications(asArray<Notification>(data.notifications));
      setDashboard(data);
      const receivedServices = asArray<Service>(data.services);
      if (receivedServices.length) setServices(receivedServices);
      const candidates = asArray<Site>(data.sites);
      const explicitSite = requestedSiteId();
      // A delegated editor link is always resolved by the server route; it is never fabricated from URL data.
      if (!siteIdRef.current && explicitSite) await openSite({ id: explicitSite });
      else if (!siteIdRef.current && candidates[0]) await openSite(candidates[0]);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  // openSite is stable enough for initial fetch; its declaration is hoisted in this closure at execution time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observeNotifications]);

  const loadServices = useCallback(async () => {
    try {
      const response = await api<Service[] | { services?: Service[] }>('/api/services');
      const result = Array.isArray(response) ? response : asArray<Service>(response.services);
      if (result.length || Array.isArray(response)) setServices(result);
    } catch { /* Dashboard data remains the authoritative fallback if this optional fetch is unavailable. */ }
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const response = await api<Record<string, unknown>>('/api/messages');
      setMessagesData({ ...response, conversations: asArray<Conversation>(response.conversations).map(normalizeConversation) });
    } catch (error) { if (activeTab === 'messages') notify(errorMessage(error)); }
  }, [activeTab, notify]);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await api<Pick<DashboardData, 'notifications'>>('/api/dashboard');
      const nextNotifications = asArray<Notification>(response.notifications);
      observeNotifications(nextNotifications);
      // Notification polling intentionally merges only notifications: it never replaces an in-progress draft.
      setDashboard((current) => current ? { ...current, notifications: nextNotifications } : current);
    } catch { /* A background refresh must not disrupt the current dashboard. */ }
  }, [observeNotifications]);

  const openSite = useCallback(async (summary: Site) => {
    siteIdRef.current = summary.id;
    try {
      const response = await api<Site | { site?: Site }>(`/api/sites/${encodeURIComponent(summary.id)}`);
      const site = ('site' in response && response.site ? response.site : response) as Site;
      setActiveSite(site);
      setLockForm({ enabled: Boolean(site.lock?.enabled), password: '', message: asText(site.lock?.message) });
      const nextDraft = parseDraft(site.draft);
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      versionRef.current = Number(site.draft_version ?? site.version ?? 0);
      revisionRef.current = 0;
      dirtyRef.current = false;
      setSaveState('saved');
    } catch (error) {
      // Dashboard summaries can offer a safe local fallback. A delegated URL has no draft and must not become a fake editable site.
      if (summary.draft !== undefined) {
        setActiveSite(summary);
        setLockForm({ enabled: Boolean(summary.lock?.enabled), password: '', message: asText(summary.lock?.message) });
        const nextDraft = parseDraft(summary.draft);
        setDraft(nextDraft);
        draftRef.current = nextDraft;
        versionRef.current = Number(summary.draft_version ?? summary.version ?? 0);
      } else {
        siteIdRef.current = null;
        setActiveSite(null);
        const nextDraft = emptyDraft();
        setDraft(nextDraft);
        draftRef.current = nextDraft;
        versionRef.current = 0;
        dirtyRef.current = false;
        setSaveState('saved');
      }
      notify(errorMessage(error));
    }
  }, [notify]);

  const reserveInitialName = async () => {
    if (!localNameCandidateValid || nameAvailability?.name !== normalizedNameCandidate || !nameAvailability.available || reservingName) return;
    setReservingName(true);
    try {
      const result = await api<NameReservation>('/api/names/reserve', { method: 'POST', body: JSON.stringify({ name: normalizedNameCandidate }) });
      setActiveTab('editor');
      setNameAvailability({ name: result.name, valid: true, available: false, reason: null });
      await openSite(result.site);
      await loadDashboard();
      notify(tr('تم حجز الاسم وإنشاء مسودتك. الخطوة 2: ابدأ بتحرير هويتك.', 'Name reserved and your draft was created. Step 2: start editing your identity.'));
    } catch (error) {
      const message = errorMessage(error);
      if ((error as { status?: unknown }).status === 409 || /(?:registered|conflict|reserved|taken)/i.test(message)) {
        setNameAvailability({ name: normalizedNameCandidate, valid: true, available: false, reason: tr('تغيّر توفر الاسم أثناء الحجز. نحدّث مسودتك الآن إن تم إنشاؤها.', 'Name availability changed while reserving. Refreshing your draft if it was created.') });
        await loadDashboard();
      }
      notify(message);
    } finally { setReservingName(false); }
  };

  useEffect(() => { void loadDashboard(); void loadServices(); }, [loadDashboard, loadServices]);
  useEffect(() => { if (activeTab === 'messages') void loadMessages(); }, [activeTab, loadMessages]);
  useEffect(() => {
    let interval: number | undefined;
    const stop = () => {
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
    };
    const start = () => {
      if (document.visibilityState !== 'visible' || interval !== undefined) return;
      interval = window.setInterval(() => {
        if (document.visibilityState === 'visible') void loadNotifications();
      }, 30_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadNotifications();
        start();
      } else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [loadNotifications]);
  const loadIdentityInsights = useCallback(async () => {
    if (!activeSite) { setIdentityInsights(null); return; }
    setInsightsLoading(true);
    setInsightsError('');
    try { setIdentityInsights(await api<IdentityInsights>(`/api/analytics?siteId=${encodeURIComponent(activeSite.id)}`)); }
    catch (error) { setIdentityInsights(null); setInsightsError(errorMessage(error)); }
    finally { setInsightsLoading(false); }
  }, [activeSite?.id]);
  useEffect(() => { if (activeTab === 'services' && activeSite) void loadIdentityInsights(); }, [activeTab, activeSite?.id, loadIdentityInsights]);
  useEffect(() => {
    const onPopState = () => {
      setActiveTab(getInitialTab());
      const explicitSite = requestedSiteId();
      if (explicitSite && explicitSite !== siteIdRef.current) void openSite({ id: explicitSite });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openSite]);

  const changeTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.pushState({}, '', url);
  };

  const changeDraft = useCallback((patch: Partial<ProfileDraft> | ((current: ProfileDraft) => ProfileDraft)) => {
    revisionRef.current += 1;
    dirtyRef.current = true;
    setSaveState('unsaved');
    setDraft((current) => {
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      draftRef.current = next;
      return next;
    });
  }, []);

  const saveDraft = useCallback(async (quiet = false): Promise<boolean> => {
    const siteId = siteIdRef.current;
    if (!siteId || !dirtyRef.current || savingRef.current) return true;
    const revision = revisionRef.current;
    const version = versionRef.current;
    const outgoing = draftRef.current;
    savingRef.current = true;
    setSaveState('saving');
    try {
      const response = await api<Site | { site?: Site; version?: number; draft_version?: number; draft?: ProfileDraft }>(`/api/sites/${encodeURIComponent(siteId)}/draft`, {
        method: 'PUT',
        body: JSON.stringify({ draft: outgoing, version }),
      });
      const saved = ('site' in response && response.site ? response.site : response) as Site;
      const receivedVersion = Number(saved.draft_version ?? saved.version ?? (response as { version?: number; draft_version?: number }).draft_version ?? (response as { version?: number }).version ?? version + 1);
      versionRef.current = receivedVersion;
      setActiveSite((current) => current ? { ...current, ...saved, draft_version: receivedVersion } : current);
      if (revisionRef.current === revision) {
        dirtyRef.current = false;
        setSaveState('saved');
        if (saved.draft) {
          const nextDraft = parseDraft(saved.draft);
          setDraft(nextDraft);
          draftRef.current = nextDraft;
        }
      } else {
        setSaveState('unsaved');
      }
      if (!quiet) notify(tr('تم حفظ المسودة بأمان.', 'Draft saved securely.'));
      return true;
    } catch (error) {
      setSaveState('error');
      notify(errorMessage(error));
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [notify, tr]);

  useEffect(() => {
    const interval = window.setInterval(() => { if (dirtyRef.current) void saveDraft(true); }, 15_000);
    return () => window.clearInterval(interval);
  }, [saveDraft]);

  const submitForReview = async () => {
    if (!activeSite) return;
    if (!window.confirm(tr('سيُنشئ هذا الإجراء لقطة ثابتة للمراجعة، ولن ينشر الموقع. هل تريد المتابعة؟', 'This creates a fixed review snapshot; it will not publish the site. Continue?'))) return;
    setSubmittingReview(true);
    try {
      if (!(await saveDraft(true))) return;
      const response = await api<{ review?: { id?: string }; id?: string }>(`/api/sites/${encodeURIComponent(activeSite.id)}/submit`, { method: 'POST', body: JSON.stringify({}) });
      setPreviewOpen(false);
      await loadDashboard();
      notify(response.review?.id || response.id ? tr('تم إرسال لقطة المراجعة.', 'Review snapshot submitted.') : tr('تم استلام طلب المراجعة.', 'Review request received.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setSubmittingReview(false); }
  };

  const compressImage = async (file: File, maxSide = 2200): Promise<File> => {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error(tr('اختر صورة PNG أو JPEG أو WebP فقط.', 'Choose a PNG, JPEG, or WebP image.'));
    if (file.size > 15 * 1024 * 1024) throw new Error(tr('حجم الصورة يتجاوز 15 ميغابايت.', 'Image exceeds 15 MB.'));
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(tr('تعذر قراءة الصورة.', 'Could not read image.'))); };
      image.src = objectUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(tr('تعذر تجهيز الصورة.', 'Could not prepare image.'));
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(tr('تعذر ضغط الصورة.', 'Could not compress image.'))), 'image/webp', 0.86));
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' });
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose, onUploaded: (upload: UploadResult) => void) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!activeSite && purpose !== 'receipt') {
      notify(tr('احجز أو اختر موقعاً قبل رفع ملفات الهوية.', 'Reserve or choose a site before uploading identity files.'));
      return;
    }
    if (purpose === 'receipt') setReceiptError('');
    setUploading(purpose);
    try {
      const compressed = purpose === 'receipt' ? file : await compressImage(file, purpose === 'cover' ? 2600 : 1800);
      if (purpose === 'receipt' && !/^application\/pdf$/i.test(file.type) && !/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error(tr('ارفع إيصال PDF أو صورة صالحة.', 'Upload a PDF receipt or valid image.'));
      const body = new FormData();
      body.append('file', compressed);
      body.append('purpose', purpose);
      if (activeSite) body.append('siteId', activeSite.id);
      const result = await api<UploadResult>('/api/upload', { method: 'POST', body });
      if (!result?.id || !result?.url) throw new Error(tr('لم يعُد الخادم بمعرّف وارتباط للملف.', 'The server did not return a file ID and URL.'));
      onUploaded(result);
      notify(purpose === 'receipt' ? tr('تم رفع الإيصال الخاص بأمان.', 'Private receipt uploaded securely.') : tr('تم ضغط الصورة ورفعها بصيغة WebP.', 'Image compressed and uploaded as WebP.'));
    } catch (error) {
      const message = errorMessage(error);
      if (purpose === 'receipt') setReceiptError(message);
      notify(message);
    }
    finally { setUploading(''); }
  };

  const doTransfer = async () => {
    if (walletOperation) return;
    const amount = Number(transferForm.amount);
    if (!transferForm.recipient.trim() || !Number.isInteger(amount) || amount < 100 || amount > 1000) {
      notify(tr('أدخل مستفيداً ومبلغاً صحيحاً بين 100 و1,000 نقطة.', 'Enter a recipient and an integer amount from 100 to 1,000 points.'));
      return;
    }
    if (!window.confirm(tr(`سيُحوّل ${amount.toLocaleString(locale)} نقطة إلى ${transferForm.recipient.trim()} بلا رسوم. لا يمكن التراجع بعد نجاح الخادم.`, `${amount.toLocaleString(locale)} points will transfer to ${transferForm.recipient.trim()} with no fee. It cannot be undone after the server succeeds.`))) return;
    const signature = JSON.stringify({ recipient: transferForm.recipient.trim().toLowerCase(), amount });
    const idempotencyKey = walletIdempotencyKey('transfer', signature);
    setWalletOperation('transfer');
    try {
      await api('/api/wallet/transfer', { method: 'POST', body: JSON.stringify({ recipient: transferForm.recipient.trim(), amount, idempotencyKey }) });
      clearWalletIdempotencyKey('transfer', idempotencyKey);
      setTransferForm({ recipient: '', amount: '' });
      await loadDashboard();
      notify(tr('تمت معالجة التحويل وإشعار الطرفين.', 'Transfer processed and both parties notified.'));
    } catch (error) {
      if (ambiguousNetworkFailure(error)) notify(tr('قد يكون التحويل ما زال قيد المعالجة. أعد المحاولة بنفس البيانات فقط؛ سيُعاد استخدام مفتاح الأمان نفسه.', 'The transfer may still be processing. Retry only with the same details; the same safety key will be reused.'));
      else { clearWalletIdempotencyKey('transfer', idempotencyKey); notify(errorMessage(error)); }
    } finally { setWalletOperation(''); }
  };

  const redeem = async () => {
    if (walletOperation) return;
    const days = Number(redeemDays);
    if (!Number.isInteger(days) || days < 1) { notify(tr('أدخل عدداً صحيحاً من الأيام.', 'Enter a whole number of days.')); return; }
    if (!window.confirm(tr(`سيُخصم ${days * 100} نقطة مقابل ${days} يوم استحقاق.`, `${days * 100} points will be redeemed for ${days} entitlement day(s).`))) return;
    const signature = JSON.stringify({ days });
    const idempotencyKey = walletIdempotencyKey('redeem', signature);
    setWalletOperation('redeem');
    try {
      await api('/api/wallet/redeem', { method: 'POST', body: JSON.stringify({ days, idempotencyKey }) });
      clearWalletIdempotencyKey('redeem', idempotencyKey);
      await loadDashboard();
      notify(tr('تمت إضافة أيام الاستحقاق ذرّياً.', 'Entitlement days were added atomically.'));
    } catch (error) {
      if (ambiguousNetworkFailure(error)) notify(tr('قد يكون الاستبدال ما زال قيد المعالجة. أعد المحاولة بنفس عدد الأيام فقط؛ سيُعاد استخدام مفتاح الأمان نفسه.', 'The redemption may still be processing. Retry only with the same number of days; the same safety key will be reused.'));
      else { clearWalletIdempotencyKey('redeem', idempotencyKey); notify(errorMessage(error)); }
    } finally { setWalletOperation(''); }
  };

  const copyReferral = async () => {
    const link = `${window.location.origin}/auth?ref=C${user?.id ?? ''}`;
    try { await navigator.clipboard.writeText(link); notify(tr('تم نسخ رابط الإحالة.', 'Referral link copied.')); }
    catch { notify(link); }
  };

  const translateDraft = async () => {
    if (!activeSite || !translationConsent) return;
    try {
      const response = await api<{ draft?: ProfileDraft; site?: Site; version?: number; draft_version?: number }>('/api/translate', {
        method: 'POST',
        body: JSON.stringify({ siteId: activeSite.id, target: translationTarget, consent: true }),
      });
      const received = response.draft ?? response.site?.draft;
      if (!received) throw new Error(tr('لم يعُد الخادم بمسودة مترجمة قابلة للتحقق.', 'The server did not return a verifiable translated draft.'));
      const returnedDraft = parseDraft(received);
      const storedTranslation = returnedDraft.translations?.[translationTarget];
      if (!storedTranslation) throw new Error(tr('لم تتضمن الاستجابة الترجمة المحفوظة للاتجاه المحدد.', 'The response did not include the saved translation for the selected direction.'));
      const nextVersion = Number(response.version ?? response.draft_version ?? response.site?.draft_version ?? response.site?.version);
      if (Number.isFinite(nextVersion) && nextVersion >= 0) versionRef.current = nextVersion;
      const wasDirty = dirtyRef.current;
      const mergedDraft = {
        ...draftRef.current,
        translations: { ...draftRef.current.translations, [translationTarget]: storedTranslation },
      };
      // Preserve the main Arabic draft and any unsaved edits; accept only the server-returned target variant.
      setDraft(mergedDraft);
      draftRef.current = mergedDraft;
      if (!wasDirty) setSaveState('saved');
      setActiveSite((current) => {
        if (!current) return current;
        const { draft: _serverDraft, ...siteUpdate } = response.site ?? {};
        return { ...current, ...siteUpdate, draft_version: Number.isFinite(nextVersion) ? nextVersion : current.draft_version };
      });
      notify(translationTarget === 'en'
        ? tr('تم التحقق من حفظ الترجمة الإنجليزية في المسودة.', 'English translation was verified in the draft.')
        : tr('تم التحقق من حفظ الترجمة العربية في المسودة.', 'Arabic translation was verified in the draft.'));
    } catch (error) { notify(errorMessage(error)); }
  };

  const updateSavedTranslation = useCallback((target: TranslationTarget, patch: Partial<ProfileDraft>) => {
    changeDraft((current) => {
      const saved = current.translations?.[target];
      if (!saved) return current;
      return { ...current, translations: { ...current.translations, [target]: { ...saved, ...patch } } };
    });
  }, [changeDraft]);

  const createQuickLink = async () => {
    if (!activeSite) return;
    const fields = Object.entries(quickFields).filter(([, enabled]) => enabled).map(([key]) => key);
    const expiresDays = Number(quickDays);
    if (!fields.length || !Number.isInteger(expiresDays) || expiresDays < 1) { notify(tr('اختر حقلاً واحداً على الأقل ومدة صالحة.', 'Choose at least one field and a valid lifetime.')); return; }
    try {
      const response = await api<QuickLink>('/api/quick-links', { method: 'POST', body: JSON.stringify({ fields, expiresDays }) });
      setQuickLink(response);
      notify(tr('تم إنشاء رابط تعارف محدود البيانات.', 'Limited-data introduction link created.'));
    } catch (error) { notify(errorMessage(error)); }
  };

  const revokeQuickLink = async (id: string) => {
    if (!window.confirm(tr('سيُبطل الرابط فوراً. هل تريد المتابعة؟', 'This link will be revoked immediately. Continue?'))) return;
    try { await api(`/api/quick-links/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({}) }); setQuickLink(null); notify(tr('تم إبطال الرابط.', 'Link revoked.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const requestContact = async () => {
    if (!messageRecipient.trim()) return;
    try { await api('/api/contact/request', { method: 'POST', body: JSON.stringify({ recipient: messageRecipient.trim() }) }); setMessageRecipient(''); await loadMessages(); notify(tr('أُرسل طلب التواصل بانتظار موافقة المستفيد.', 'Contact request sent; recipient approval is required.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const decideContact = async (id: string, accept: boolean) => {
    try { await api(`/api/contact/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ accept }) }); await loadMessages(); notify(accept ? tr('تمت الموافقة وفتح جلسة مراسلة.', 'Accepted; messaging session opened.') : tr('تم رفض طلب التواصل.', 'Contact request declined.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const openConversation = async (conversation: Conversation) => {
    try {
      // The shared client API helper intentionally returns only an Error message. Read this GET locally so 410 has an explicit, truthful UI state.
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown; conversation?: Conversation; messages?: Message[] };
      if (response.status === 410) {
        setSelectedConversation({ ...normalizeConversation({ ...conversation, status: 'expired' }), messages: [] });
        setMessageBody('');
        await loadMessages();
        notify(tr('انتهت الجلسة ولم يعد الخادم يتيح سجل الرسائل. لا يعني ذلك حذفاً أو تطهيراً فورياً للبيانات.', 'The session expired and the server no longer makes message history available. This does not promise immediate data deletion or purging.'));
        return;
      }
      if (!response.ok) throw new Error(asText(payload.error) || asText(payload.message) || tr('تعذر فتح الجلسة.', 'Could not open the session.'));
      const detail = payload.conversation ?? payload as ConversationDetail;
      const messages = payload.conversation ? payload.messages : (detail as ConversationDetail).messages;
      const opened = normalizeConversation(detail);
      const listed = normalizeConversation(conversation);
      setSelectedConversation({
        ...opened,
        other_user: { id: opened.other_user?.id ?? listed.other_user?.id, name: opened.other_user?.name || listed.other_user?.name },
        messages: asArray<Message>(messages).map(normalizeMessage),
      });
    } catch (error) { notify(errorMessage(error)); }
  };

  const sessionExpired = selectedConversation ? Date.now() / 1000 - Number(selectedConversation.last_activity ?? 0) >= 86_400 || selectedConversation.status !== 'active' : false;
  const sendMessage = async () => {
    if (!selectedConversation || sessionExpired || !messageBody.trim()) return;
    try {
      await api(`/api/conversations/${encodeURIComponent(selectedConversation.id)}/messages`, { method: 'POST', body: JSON.stringify({ body: messageBody.trim() }) });
      setMessageBody('');
      await openConversation(selectedConversation);
      await loadMessages();
    } catch (error) {
      const message = errorMessage(error);
      if (/conversation (?:has )?(?:expired|ended)/i.test(message)) {
        setSelectedConversation((current) => current ? { ...current, status: 'expired', messages: [] } : current);
        setMessageBody('');
        void loadMessages();
        notify(tr('لم تعد هذه الجلسة متاحة للمراسلة. لا يعني ذلك حذفاً أو تطهيراً فورياً للبيانات.', 'This session is no longer available for messaging. This does not promise immediate data deletion or purging.'));
      } else notify(message);
    }
  };
  const endConversation = async () => {
    if (!selectedConversation || !window.confirm(tr('سيُنهى التراسل فوراً، ويتطلب الاستئناف طلب تواصل جديداً. هل تريد المتابعة؟', 'Messaging ends immediately and resuming requires a new contact request. Continue?'))) return;
    try { await api(`/api/conversations/${encodeURIComponent(selectedConversation.id)}/end`, { method: 'POST', body: JSON.stringify({}) }); setSelectedConversation(null); await loadMessages(); notify(tr('انتهت الجلسة.', 'Session ended.')); }
    catch (error) { notify(errorMessage(error)); }
  };
  const blockConversationUser = async () => {
    const id = selectedConversation?.other_user?.id;
    if (!id) { notify(tr('لا تتوفر هوية الطرف الآخر لإجراء الحظر.', 'The other participant ID is unavailable for blocking.')); return; }
    if (!window.confirm(tr('سيمنع الحظر أي تواصل لاحق من هذا الحساب. هل تريد المتابعة؟', 'Blocking prevents future contact from this account. Continue?'))) return;
    try { await api('/api/blocks', { method: 'POST', body: JSON.stringify({ userId: id }) }); setSelectedConversation(null); await loadMessages(); notify(tr('تم حظر الحساب.', 'Account blocked.')); }
    catch (error) { notify(errorMessage(error)); }
  };
  const reportConversation = async () => {
    if (!selectedConversation) return;
    const reason = window.prompt(tr('اذكر سبب البلاغ باختصار:', 'Briefly state the report reason:'));
    if (!reason?.trim()) return;
    try { await api('/api/reports', { method: 'POST', body: JSON.stringify({ conversationId: selectedConversation.id, reason: reason.trim() }) }); notify(tr('تم توثيق البلاغ وإرساله.', 'Report documented and submitted.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const getInstructions = async () => {
    setPaymentLoading(true);
    try { const result = await api<PaymentInstructionsResult>('/api/payments/instructions'); setPaymentInstructions(result); }
    catch (error) { notify(errorMessage(error)); }
    finally { setPaymentLoading(false); }
  };
  const submitPayment = async () => {
    if (paymentInstructions?.available !== true) {
      notify(asText(paymentInstructions?.reason) || tr('لا تتوفر تعليمات بنكية نشطة لإرسال الطلب.', 'Active bank instructions are not available for submitting this request.'));
      return;
    }
    const amount = Number(paymentForm.amount); const days = Number(paymentForm.days);
    if (!paymentForm.receiptId || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(days) || days <= 0) { notify(tr('أدخل المبلغ والأيام وارفع الإيصال قبل الإرسال.', 'Enter amount and days, then upload the receipt before submitting.')); return; }
    try {
      await api('/api/payments', { method: 'POST', body: JSON.stringify({ amount, days, receiptId: paymentForm.receiptId, notes: paymentForm.notes }) });
      setPaymentForm({ amount: '', days: '', notes: '', receiptId: '', receiptUrl: '' });
      await loadDashboard();
      notify(tr('تم إرسال طلب الاشتراك للمراجعة.', 'Subscription request submitted for review.'));
    } catch (error) { notify(errorMessage(error)); }
  };

  const saveLock = async () => {
    if (!activeSite) return;
    if (lockForm.enabled && lockForm.password.length < 8) { notify(tr('استخدم كلمة مرور منفصلة للموقع من 8 أحرف على الأقل.', 'Use a separate site password with at least 8 characters.')); return; }
    if (!window.confirm(lockForm.enabled ? tr('سيطلب زوار موقعك كلمة المرور المختارة. هل تريد المتابعة؟', 'Visitors will need the chosen password. Continue?') : tr('سيُزال قفل الموقع. هل تريد المتابعة؟', 'Site lock will be removed. Continue?'))) return;
    try { await api(`/api/sites/${encodeURIComponent(activeSite.id)}/lock`, { method: 'POST', body: JSON.stringify(lockForm) }); notify(lockForm.enabled ? tr('تم حفظ قفل الموقع.', 'Site lock saved.') : tr('تمت إزالة قفل الموقع.', 'Site lock removed.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const savePin = async () => {
    if (!/^\d{6}$/.test(pin)) { notify(tr('أدخل PIN من ستة أرقام.', 'Enter a 6-digit PIN.')); return; }
    if (pin !== pinConfirm) { notify(tr('لا يتطابق تأكيد PIN.', 'PIN confirmation does not match.')); return; }
    try {
      await api('/api/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) });
      setPinValue('');
      setPinConfirm('');
      notify(tr('تم حفظ PIN للجهاز الموثوق بعد التحقق الحديث.', 'PIN was saved for this trusted device after fresh verification.'));
    } catch (error) { notify(errorMessage(error)); }
  };

  const requestDeletion = async () => {
    if (!deletionConfirmed) return;
    if (!window.confirm(tr('سيُرسل طلب حذف رسمي للمراجعة؛ لا يمكن إلغاؤه من هذه الشاشة. هل تريد المتابعة؟', 'A formal deletion request will be submitted for review; it cannot be cancelled here. Continue?'))) return;
    try { await api('/api/deletion-request', { method: 'POST', body: JSON.stringify({ reason: deleteReason.trim() }) }); setDeletionConfirmed(false); setDeleteReason(''); notify(tr('تم إرسال طلب الحذف للمراجعة.', 'Deletion request submitted for review.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const beginNameTransfer = async () => {
    if (!nameTransfer.name.trim() || !nameTransfer.recipient.trim() || !nameTransfer.confirmed) return;
    if (!window.confirm(tr('نقل الاسم لا ينقل الموقع أو الصور أو المحتوى أو QR تلقائياً. سيحتاج المستفيد لقبول العملية وموافقة الإدارة. هل تريد المتابعة؟', 'Transferring the name does not transfer the site, images, content, or QR. Recipient acceptance and administration approval are required. Continue?'))) return;
    try { await api('/api/names/transfer', { method: 'POST', body: JSON.stringify({ name: nameTransfer.name.trim(), recipient: nameTransfer.recipient.trim() }) }); setNameTransfer({ name: '', recipient: '', confirmed: false }); await loadDashboard(); notify(tr('تم إنشاء طلب نقل الاسم.', 'Name transfer request created.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const acceptNameTransfer = async (id: string) => {
    if (!window.confirm(tr('بقبول الاسم، تدرك أن بيانات ومحتوى المالك السابق لا تنتقل إليك. هل تريد المتابعة؟', 'By accepting the name, you understand the former owner’s data and content do not transfer to you. Continue?'))) return;
    try { await api(`/api/names/transfers/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({}) }); await loadDashboard(); notify(tr('تم تسجيل قبولك بانتظار الإجراء الإداري.', 'Your acceptance was recorded pending administration action.')); }
    catch (error) { notify(errorMessage(error)); }
  };
  const acceptHandover = async (id: string) => {
    if (!window.confirm(tr('سيمنحك القبول إدارة الموقع وفق السياسة؛ تحقّق من البريد والهوية قبل المتابعة.', 'Accepting grants site management under policy; verify the email and identity before proceeding.'))) return;
    try { await api(`/api/handovers/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({}) }); await loadDashboard(); notify(tr('تم قبول التسليم.', 'Handover accepted.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const attachUnboundName = async (name: string, siteId: string | null) => {
    if (attachingName) return;
    setAttachingName(name);
    try {
      const result = await api<{ site?: Site }>(`/api/names/${encodeURIComponent(name)}/attach`, { method: 'POST', body: JSON.stringify({ siteId }) });
      setActiveTab('editor');
      if (result.site) await openSite(result.site);
      await loadDashboard();
      notify(tr('تم ربط الاسم بمسودتك.', 'The name is now attached to your draft.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setAttachingName(''); }
  };

  const markNotificationRead = async (notification: Notification) => {
    if (notification.read_at) return;
    try { await api(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', body: JSON.stringify({}) }); setDashboard((current) => current ? { ...current, notifications: asArray<Notification>(current.notifications).map((item) => item.id === notification.id ? { ...item, read_at: Math.floor(Date.now() / 1000) } : item) } : current); }
    catch (error) { notify(errorMessage(error)); }
  };

  const balance = Number(dashboard?.wallet?.balance ?? (user as { balance?: number }).balance ?? 0);
  const siteAnalytics = (activeSite?.analytics ?? (dashboard?.analytics && activeSite ? (dashboard.analytics as Record<string, unknown>)[activeSite.id] : null)) as Record<string, unknown> | unknown[] | null;
  const analyticsEntries = siteAnalytics && typeof siteAnalytics === 'object' && !Array.isArray(siteAnalytics) ? Object.entries(siteAnalytics) : [];
  const reviews = asArray<Record<string, unknown>>(dashboard?.reviews).filter((review) => !activeSite || review.site_id === activeSite.id);
  const notifications = asArray<Notification>(dashboard?.notifications);
  const selectedTranslation = draft.translations?.[translationTarget];
  const pendingTransfers = asArray<Record<string, unknown>>(dashboard?.transfers ?? dashboard?.nameTransfers).filter((item) => item.status === 'pending');
  const handovers = asArray<Record<string, unknown>>(dashboard?.handovers).filter((item) => item.status === 'pending');
  const conversations = asArray<Conversation>(messagesData?.conversations);
  const requests = asArray<Record<string, unknown>>(messagesData?.requests);
  const existingQuickLinks = asArray<QuickLink>(dashboard?.quickLinks);
  const unboundNames = asArray<UnboundName>(dashboard?.unboundNames).filter((item) => validNameLabel(asText(item.name)));
  const attachSites = asArray<Site>(dashboard?.sites);
  const attachmentSiteId = attachTargetId || activeSite?.id || attachSites[0]?.id || null;
  const activeSiteUrl = publicSiteUrl(activeSite?.name);
  const bankIntakeAvailable = paymentInstructions?.available === true;
  const bankIntakeReason = asText(paymentInstructions?.reason) || (paymentInstructions === null
    ? tr('اعرض التعليمات الرسمية أولاً قبل إرسال الطلب.', 'Show the official instructions before submitting a request.')
    : tr('بوابة الحوالة غير نشطة حالياً، لذلك لا يمكن إرسال الطلب.', 'Bank-transfer intake is not active, so this request cannot be submitted.'));
  const initialReservationFlow = !activeSite && activeTab === 'editor' && unboundNames.length === 0;
  const profileCompletion = useMemo(() => {
    const signals = [draft.name, draft.title, draft.bio, draft.city, draft.photo, draft.experience.length, draft.skills.length, draft.languages.length, draft.socials.length, draft.workImages.length];
    return Math.round((signals.filter(Boolean).length / signals.length) * 100);
  }, [draft]);
  const isScopedProxySite = Boolean(activeSite && numericId(activeSite.userId) !== numericId(user?.id));
  const insightsMatchActiveSite = Boolean(activeSite && identityInsights?.siteId === activeSite.id);
  const serverQuality = insightsMatchActiveSite ? identityInsights?.quality : undefined;
  const presenceMeasurements = insightsMatchActiveSite && identityInsights?.events
    ? Object.entries({
      visits: Number(identityInsights.events.visits ?? 0),
      contactClicks: Number(identityInsights.events.contactClicks ?? 0),
      vcardDownloads: Number(identityInsights.events.vcardDownloads ?? 0),
      qrInteractions: Number(identityInsights.events.qrInteractions ?? 0),
      last30Days: Number(identityInsights.activity?.last30Days ?? identityInsights.events.total ?? 0),
    })
    : analyticsEntries;

  const statusText: Record<SaveState, [string, string]> = {
    saved: ['محفوظ', 'Saved'], unsaved: ['تغييرات غير محفوظة', 'Unsaved changes'], saving: ['جارٍ الحفظ...', 'Saving...'], error: ['تعذر الحفظ', 'Save failed'],
  };

  if (loading) return <main className="dashboard dashboard-loading" dir={lang === 'ar' ? 'rtl' : 'ltr'}><RefreshCw className="spin" /><span>{tr('جارٍ تحميل لوحتك...', 'Loading your console...')}</span></main>;
  if (loadError) return <main className="dashboard dashboard-loading" dir={lang === 'ar' ? 'rtl' : 'ltr'}><AlertTriangle /><div><strong>{tr('تعذر تحميل اللوحة', 'Unable to load dashboard')}</strong><p className="muted">{loadError}</p><button className="button" onClick={() => void loadDashboard()}>{tr('إعادة المحاولة', 'Try again')}</button></div></main>;

  return (
    <main className="dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="dashboard-shell" ref={dashboardInteractiveRef}>
        <header className="dashboard-hero card">
          <div className="dashboard-hero__copy">
            <p className="dashboard-kicker"><BadgeCheck size={15} /> {tr('مساحة العمل', 'Workspace')}</p>
            <h1>{tr('هويتك المهنية', 'Your professional identity')}</h1>
            <p className="muted">{tr('حرر موقعك وخدماتك من مكان واحد.', 'Edit your site and services from one place.')}</p>
          </div>
          {!initialReservationFlow && <div className="dashboard-hero__actions">
            <button className="dashboard-site-switch" onClick={() => activeSiteUrl && window.open(activeSiteUrl, '_blank', 'noopener')} disabled={!activeSiteUrl}>
              <Globe2 size={16} /><span dir="ltr"><bdi>{activeSiteUrl ? activeSiteUrl.replace(/^https:\/\//, '') : tr('لا يوجد اسم محجوز', 'No reserved name')}</bdi></span><ExternalLink size={14} />
            </button>
            <div className={`dashboard-save-state is-${saveState}`} aria-live="polite"><span />{tr(...statusText[saveState])}</div>
          </div>}
        </header>

        <div className={`dashboard-workspace${initialReservationFlow ? ' is-initial-reservation' : ''}`}>
          {!initialReservationFlow && <aside className="dashboard-sidebar">
            <p className="dashboard-sidebar__label">{tr('لوحة التحكم', 'Console')}</p>
            <nav className="dashboard-tabs" aria-label={tr('أقسام لوحة التحكم', 'Dashboard sections')}>
              {tabs.map(({ key, ar, en, icon: Icon }) => <button key={key} className={activeTab === key ? 'is-active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => changeTab(key)}><Icon size={17} /><span>{tr(ar, en)}</span></button>)}
            </nav>
          </aside>}

          <section className="dashboard-content">

      {notifications.length > 0 && <section className="dashboard-notifications card" aria-label={tr('الإشعارات', 'Notifications')}>
        <div className="dashboard-section-heading"><div><Bell size={18} /><h2>{tr('التنبيهات', 'Notifications')}</h2></div><span>{notifications.filter((item) => !item.read_at).length} {tr('غير مقروء', 'unread')}</span></div>
        <div className="dashboard-notification-list">
          {notifications.slice(0, 3).map((item) => <button key={item.id} className={!item.read_at ? 'is-unread' : ''} onClick={() => void markNotificationRead(item)}><Bell size={15}/><span><strong>{item.title}</strong>{item.body && <small>{item.body}</small>}</span><time>{formatDate(item.created_at, locale)}</time></button>)}
        </div>
      </section>}

      {activeTab === 'editor' && <section className="dashboard-editor">
        {!activeSite ? <InitialNameReservation
          candidate={nameCandidate}
          availability={nameAvailability?.name === normalizedNameCandidate ? nameAvailability : null}
          checking={checkingName}
          reserving={reservingName}
          locallyValid={localNameCandidateValid}
          onChange={(value) => setNameCandidate(value.toLowerCase())}
          onReserve={reserveInitialName}
          tr={tr}
        /> : <>
        <div className="dashboard-editor-top card">
          <div className="dashboard-site-row">
            <div>
              <p className="dashboard-kicker"><PanelTop size={15}/>{isScopedProxySite ? tr('تحرير مفوّض ضمن صلاحيات حسابك', 'Delegated editing within your account scope') : tr('محرر الهوية الرقمية', 'Digital identity editor')}</p>
              <h2>{activeSite?.name || tr('اختر موقعاً', 'Select a site')}</h2>
            </div>
            {asArray<Site>(dashboard?.sites).length > 1 && <select className="field" value={activeSite?.id || ''} onChange={(event) => { const site = asArray<Site>(dashboard?.sites).find((item) => item.id === event.target.value); if (site) void openSite(site); }} aria-label={tr('الموقع الحالي', 'Current site')}>
              {asArray<Site>(dashboard?.sites).map((site) => <option key={site.id} value={site.id}>{site.name || site.id}</option>)}
            </select>}
          </div>
          <div className="dashboard-editor-actions" role="group" aria-label={tr('إجراءات المسودة', 'Draft actions')}>
            <button className="button button--quiet" onClick={() => setPreviewOpen(true)} disabled={!activeSite}><Eye size={17}/>{tr('معاينة', 'Preview')}</button>
            <button className="button" onClick={() => void saveDraft(false)} disabled={!activeSite || saveState === 'saving' || saveState === 'saved'}><Save size={17}/>{saveState === 'saving' ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ', 'Save')}</button>
          </div>
        </div>

          <div className="dashboard-editor-layout">
            <aside className="dashboard-editor-navigation" aria-label={tr('أقسام محرر الهوية', 'Identity editor sections')}>
              {editorGroups.map((group) => <section className={`dashboard-editor-group ${group.steps.includes(editorSection) ? 'is-active' : ''}`} key={group.key}>
                <p className="dashboard-editor-group-label"><span>{tr(group.ar, group.en)}</span><small>{group.steps.filter((step) => step === editorSection).length ? tr('قيد التحرير', 'Editing') : `${group.steps.length} ${tr('خطوات', 'steps')}`}</small></p>
                <div className="dashboard-editor-substeps">
                  {group.steps.map((step) => <button type="button" key={step} className={editorSection === step ? 'is-active' : ''} aria-current={editorSection === step ? 'step' : undefined} onClick={() => setEditorSection(step)}>
                    <span>{tr(editorSectionMap[step].ar, editorSectionMap[step].en)}</span><ChevronLeft size={15}/>
                  </button>)}
                </div>
              </section>)}
            </aside>
            <article className="dashboard-edit-card card">
              {editorSection === 'identity' && <IdentitySection draft={draft} tr={tr} uploading={uploading} onChange={changeDraft} onUpload={uploadImage} />}
              {editorSection === 'bio' && <TextSection label={tr('النبذة التعريفية', 'Professional biography')} hint={tr('اكتب تعريفاً واضحاً ومهماً لجمهور موقعك.', 'Write a clear, meaningful introduction for your site audience.')} value={draft.bio} multiline onChange={(bio) => changeDraft({ bio })} />}
              {editorSection === 'contact' && <ContactSection draft={draft} tr={tr} onChange={changeDraft} />}
              {editorSection === 'experience' && <StructuredList title={tr('الخبرات العملية', 'Work experience')} value={draft.experience} onChange={(experience) => changeDraft({ experience })} tr={tr} />}
              {editorSection === 'education' && <StructuredList title={tr('المؤهلات التعليمية', 'Education')} value={draft.education} onChange={(education) => changeDraft({ education })} tr={tr} />}
              {editorSection === 'training' && <StructuredList title={tr('البرامج التدريبية والتطويرية', 'Training and development')} value={draft.training} onChange={(training) => changeDraft({ training })} tr={tr} />}
              {editorSection === 'skills' && <StringList title={tr('المهارات', 'Skills')} hint={tr('أضف كل مهارة في عنصر مستقل.', 'Add each skill as a separate item.')} value={draft.skills} onChange={(skills) => changeDraft({ skills })} tr={tr} />}
              {editorSection === 'memberships' && <StringList title={tr('العضويات المهنية', 'Professional memberships')} value={draft.memberships} onChange={(memberships) => changeDraft({ memberships })} tr={tr} />}
              {editorSection === 'languages' && <StringList title={tr('اللغات', 'Languages')} value={draft.languages} onChange={(languages) => changeDraft({ languages })} tr={tr} />}
              {editorSection === 'hobbies' && <StringList title={tr('الهوايات', 'Hobbies')} value={draft.hobbies} onChange={(hobbies) => changeDraft({ hobbies })} tr={tr} />}
              {editorSection === 'achievements' && <StringList title={tr('الإنجازات', 'Achievements')} value={draft.achievements} onChange={(achievements) => changeDraft({ achievements })} tr={tr} />}
              {editorSection === 'timeline' && <StructuredList title={tr('سجل الإنجازات الزمني', 'Achievement timeline')} value={draft.timeline} onChange={(timeline) => changeDraft({ timeline })} tr={tr} timeline />}
              {editorSection === 'skillImages' && <MediaSection title={tr('صور لإثبات المهارات', 'Skill evidence images')} hint={tr('حتى 3 صور. تتحول الصور إلى WebP قبل الرفع.', 'Up to 3 images. Images are converted to WebP before upload.')} items={draft.skillImages} max={3} purpose="skill" uploading={uploading} tr={tr} onUpload={uploadImage} onChange={(skillImages) => changeDraft({ skillImages })} />}
              {editorSection === 'workImages' && <MediaSection title={tr('نماذج الأعمال', 'Work samples')} hint={tr('حتى 4 صور. اختر أعمالاً تمثل خبرتك فعلاً.', 'Up to 4 images. Choose work that genuinely represents your experience.')} items={draft.workImages} max={4} purpose="work" uploading={uploading} tr={tr} onUpload={uploadImage} onChange={(workImages) => changeDraft({ workImages })} />}
              {editorSection === 'youtube' && <YoutubeSection value={draft.youtube} onChange={(youtube) => changeDraft({ youtube })} tr={tr} />}
              {editorSection === 'socials' && <LinkList title={tr('الروابط الاجتماعية', 'Social links')} hint={tr('استخدم رابطاً كاملاً وآمناً يبدأ بـ https://', 'Use a complete secure URL beginning with https://')} value={draft.socials} onChange={(socials) => changeDraft({ socials })} max={12} tr={tr} />}
              {editorSection === 'buttons' && <LinkList title={tr('الأزرار الخارجية', 'External buttons')} hint={tr('حتى 3 أزرار؛ تحقق من الوجهة قبل الحفظ.', 'Up to 3 buttons; verify each destination before saving.')} value={draft.buttons} onChange={(buttons) => changeDraft({ buttons })} max={3} tr={tr} />}
              {editorSection === 'privacy' && <PrivacySection draft={draft} tr={tr} onChange={changeDraft} />}
            </article>
          </div>
          <section className="dashboard-review-rail card">
            <div><FileCheck2 size={19}/><div><h3>{tr('المراجعة والنشر', 'Review and publication')}</h3><p className="muted">{tr('الحفظ منفصل عن الإرسال. أنشئ لقطة مراجعة قبل أن يصبح أي تعديل منشوراً.', 'Saving is separate from submission. Create a review snapshot before any edit can be published.')}</p></div></div>
            <div className="dashboard-review-rail__actions"><span className="dashboard-status">{activeSite.status || tr('مسودة', 'Draft')}</span><button className="button button--quiet" onClick={() => setPreviewOpen(true)}><Eye size={16}/>{tr('مراجعة وإرسال', 'Review & submit')}</button></div>
          </section>
          {reviews.length > 0 && <section className="dashboard-review-history card"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('سجل المراجعات', 'Review history')}</h2></div></div>{reviews.slice(0, 5).map((review, index) => <div key={String(review.id ?? index)} className="dashboard-history-row"><span>{String(review.status ?? 'pending')}</span><p>{String(review.reason || tr('بانتظار قرار المراجع.', 'Awaiting reviewer decision.'))}</p><time>{formatDate(Number(review.created_at), locale)}</time></div>)}</section>}
        </>}
      </section>}

      {activeTab === 'wallet' && <WalletPanel balance={balance} ledger={asArray<Record<string, unknown>>(dashboard?.ledger)} transferForm={transferForm} setTransferForm={setTransferForm} redeemDays={redeemDays} setRedeemDays={setRedeemDays} onTransfer={doTransfer} onRedeem={redeem} onCopyReferral={copyReferral} busyOperation={walletOperation} locale={locale} tr={tr} />}

      {activeTab === 'services' && <section className="dashboard-services stack">
        <section className="dashboard-quality-grid dashboard-quality-grid--three">
          <article className="card dashboard-completion"><div className="dashboard-section-heading"><div><Sparkles size={18}/><h2>{tr('اكتمال الهوية', 'Identity completeness')}</h2></div><strong>{profileCompletion}%</strong></div><div className="dashboard-progress"><span style={{ width: `${profileCompletion}%` }}/></div><p className="muted">{tr('مساعد التحرير يقيس الحقول المملوءة في مسودتك الحالية ويقودك للخطوة التالية.', 'The editing assistant measures populated fields in your current draft and guides your next step.')}</p></article>
          <article className="card dashboard-quality"><div className="dashboard-section-heading"><div><ShieldCheck size={18}/><h2>{tr('جودة الهوية', 'Identity quality')}</h2></div><button className="dashboard-icon-button" onClick={() => void loadIdentityInsights()} disabled={insightsLoading} aria-label={tr('تحديث تقييم الجودة', 'Refresh quality assessment')}><RefreshCw className={insightsLoading ? 'spin' : ''} size={16}/></button></div>{insightsError ? <p className="dashboard-error">{insightsError}</p> : serverQuality ? <><div className="dashboard-quality-score"><strong>{serverQuality.score}%</strong><span>{tr('تقييم خادمي للمسودة', 'Server-assessed draft')}</span></div><ul>{serverQuality.completed.map((item) => <li className="is-ready" key={item}><Check size={16}/><span>{qualityCopy(item, tr)}</span></li>)}{serverQuality.recommendations.map((item) => <li key={item}><CircleHelp size={16}/><span>{qualityCopy(item, tr)}</span></li>)}</ul></> : <EmptyInline text={insightsLoading ? tr('نحدّث التقييم من الخادم…', 'Refreshing the server assessment…') : tr('لا تتوفر نتيجة جودة معتمدة للموقع المحدد.', 'No server-approved quality result is available for the selected site.')} />}</article>
          <article className="card dashboard-opportunity"><div className="dashboard-section-heading"><div><Sparkles size={18}/><h2>{tr('مؤشر الفرص', 'Opportunity indicator')}</h2></div></div>{serverQuality ? <><strong>{serverQuality.score}%</strong><div className="dashboard-progress"><span style={{ width: `${serverQuality.score}%` }}/></div><p className="muted">{tr('مؤشر إرشادي لجاهزية ملفك مبني على تقييم الجودة الخادمي؛ لا يضمن وظيفة أو نتيجة خارج المنصة.', 'A guidance signal for profile readiness based on the server quality assessment; it does not guarantee a job or external outcome.')}</p></> : <EmptyInline text={tr('يظهر عند توفر تقييم الجودة الفعلي.', 'Shown when a live quality assessment is available.')} />}</article>
        </section>
        <section className="card dashboard-translation">
          <div className="dashboard-section-heading"><div><Languages size={18}/><h2>{tr('الترجمة المحفوظة', 'Saved translation')}</h2></div>{selectedTranslation && <span className="dashboard-status">{translationTarget === 'en' ? tr('الإنجليزية محفوظة', 'English saved') : tr('العربية محفوظة', 'Arabic saved')}</span>}</div>
          <p className="muted">{tr('يبقى محرر المسودة العربية الرئيسي أعلاه كما هو؛ هذا القسم يحفظ ويحرر نسخة الهدف المنفصلة فقط.', 'The main Arabic draft editor above remains unchanged; this section saves and edits only a separate target version.')}</p>
          <div className="dashboard-translation-direction" role="group" aria-label={tr('اتجاه الترجمة', 'Translation direction')}>
            <button className={`button button--quiet ${translationTarget === 'en' ? 'is-active' : ''}`} aria-pressed={translationTarget === 'en'} onClick={() => setTranslationTarget('en')}>{tr('العربية ← الإنجليزية', 'Arabic → English')}</button>
            <button className={`button button--quiet ${translationTarget === 'ar' ? 'is-active' : ''}`} aria-pressed={translationTarget === 'ar'} onClick={() => setTranslationTarget('ar')}>{tr('الإنجليزية ← العربية', 'English → Arabic')}</button>
          </div>
          {!selectedTranslation ? <>
            <p className="muted">{translationTarget === 'en'
              ? tr('بموافقتك، يُرسل محتوى المسودة إلى خدمة الترجمة المهيأة من المنصة لحفظ نسخة إنجليزية قابلة للتعديل. لا نعرض محتوى مترجماً إلا إذا أعاده الخادم وحفظه.', 'With your consent, draft content is sent to the platform-configured translation service to save an editable English version. No translated content is shown unless the server returns and saves it.')
              : tr('بموافقتك، يُرسل المصدر المتاح إلى خدمة الترجمة المهيأة من المنصة لحفظ نسخة عربية منفصلة قابلة للتعديل. لا نعرض محتوى مترجماً إلا إذا أعاده الخادم وحفظه.', 'With your consent, the available source is sent to the platform-configured translation service to save a separate editable Arabic version. No translated content is shown unless the server returns and saves it.')}</p>
            <label className="dashboard-check"><input type="checkbox" checked={translationConsent} onChange={(event) => setTranslationConsent(event.target.checked)} />{tr('أوافق على معالجة محتوى المسودة للترجمة في الاتجاه المحدد.', 'I consent to processing draft content for the selected translation direction.')}</label>
            <button className="button" disabled={!activeSite || !translationConsent} onClick={() => void translateDraft()}><Languages size={17}/>{translationTarget === 'en' ? tr('ترجمة وحفظ الإنجليزية', 'Translate and save English') : tr('ترجمة وحفظ العربية', 'Translate and save Arabic')}</button>
          </> : <TranslationEditor target={translationTarget} translation={parseDraft(selectedTranslation)} onChange={(patch) => updateSavedTranslation(translationTarget, patch)} tr={tr} />}
        </section>
        <section className="card dashboard-exports">
          <div className="dashboard-section-heading"><div><ArrowDownToLine size={18}/><h2>{tr('التصديرات الفعلية', 'Live exports')}</h2></div></div>
          <p className="muted">{tr('اختَر مصدر التصدير. النسخة الإنجليزية لا تتاح هنا إلا بعد حفظها وتظل قابلة للتعديل أعلاه.', 'Choose an export source. English is available here only after it has been saved and remains editable above.')}</p>
          <div className="dashboard-export-language" role="group" aria-label={tr('لغة التصدير', 'Export language')}>
            <button className={`button button--quiet ${exportLanguage === 'ar' ? 'is-active' : ''}`} aria-pressed={exportLanguage === 'ar'} onClick={() => setExportLanguage('ar')}>العربية</button>
            <button className={`button button--quiet ${exportLanguage === 'en' ? 'is-active' : ''}`} aria-pressed={exportLanguage === 'en'} disabled={!draft.translations?.en} onClick={() => setExportLanguage('en')}>English {draft.translations?.en ? <Check size={15}/> : <Lock size={15}/>}</button>
          </div>
          <div className="dashboard-export-grid">{['profile', 'ats', 'card', 'vcard', 'qr', 'social'].map((kind) => activeSite && (exportLanguage === 'ar' || draft.translations?.en) ? <a className="button button--quiet" key={kind} href={`/export/${kind}?site=${encodeURIComponent(activeSite.id)}&lang=${exportLanguage}`} target="_blank" rel="noreferrer"><FileText size={16}/>{kind === 'ats' ? tr('سيرة ATS', 'ATS résumé') : kind === 'profile' ? tr('PDF تعريفي', 'Identity PDF') : kind.toUpperCase()}<ExternalLink size={13}/></a> : <span className="button button--quiet dashboard-export-disabled" key={kind}><Lock size={16}/>{tr('احفظ الترجمة أولاً', 'Save translation first')}</span>)}</div>
        </section>
        <section className="dashboard-services-list card"><div className="dashboard-section-heading"><div><Sparkles size={18}/><h2>{tr('إتاحة الخدمات', 'Service availability')}</h2></div><button className="button button--quiet" onClick={() => void loadServices()}><RefreshCw size={15}/>{tr('تحديث', 'Refresh')}</button></div>{services.length ? <div className="dashboard-service-grid">{services.map((service) => { const enabled = Boolean(service.enabled); const entitled = service.entitled !== false; return <article key={service.key} className={!enabled || !entitled ? 'is-unavailable' : ''}><div><strong>{lang === 'ar' ? service.name_ar || service.key : service.name_en || service.key}</strong><small>{!enabled ? tr('معلّقة على مستوى المنصة', 'Suspended platform-wide') : !entitled ? tr('تتطلب استحقاقاً', 'Entitlement required') : tr('متاحة لحسابك', 'Available to your account')}</small></div><span>{enabled && entitled ? <Check size={17}/> : <Lock size={16}/>}</span></article>; })}</div> : <EmptyInline text={tr('لا توجد حالة خدمات مؤكدة من الخادم حالياً.', 'No server-confirmed service status is available yet.')} />}</section>
        <section className="dashboard-insights-grid"><article className="card"><div className="dashboard-section-heading"><div><BookOpen size={18}/><h2>{tr('قياسات الحضور', 'Presence measurements')}</h2></div></div>{presenceMeasurements.length ? <dl className="dashboard-metrics">{presenceMeasurements.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'number' ? value.toLocaleString(locale) : String(value)}</dd></div>)}</dl> : <EmptyInline text={tr('لا توجد قياسات مسجلة بعد. لا نعرض تقديرات كأنها قياسات.', 'No measurements are recorded yet. Estimates are not shown as measurements.')} />}</article><QuickLinkPanel mode={quickMode} setMode={setQuickMode} fields={quickFields} setFields={setQuickFields} days={quickDays} setDays={setQuickDays} activeLink={quickLink} existing={existingQuickLinks} onCreate={createQuickLink} onRevoke={revokeQuickLink} tr={tr} /></section>
      </section>}

      {activeTab === 'messages' && <MessagesPanel tr={tr} userId={numericId(user?.id)} requests={requests} blocks={asArray<Record<string, unknown>>(messagesData?.blocks)} conversations={conversations} retention={messagesData?.retention} selected={selectedConversation} recipient={messageRecipient} setRecipient={setMessageRecipient} body={messageBody} setBody={setMessageBody} onRequest={requestContact} onDecision={decideContact} onOpen={openConversation} onSend={sendMessage} onEmoji={(emoji) => setMessageBody((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${emoji}`.slice(0, 1_000))} onEnd={endConversation} onBlock={blockConversationUser} onReport={reportConversation} expired={sessionExpired} locale={locale} />}

      {activeTab === 'subscription' && <section className="dashboard-subscription stack">
        <section className="card dashboard-entitlement"><div><p className="dashboard-kicker"><CreditCard size={15}/>{tr('الاستحقاق', 'Entitlement')}</p><h2>{tr('التجربة والاشتراك', 'Trial and subscription')}</h2><p className="muted">{tr('يبقى موقعك الأساسي وبياناته وQR متاحين بعد انتهاء التجربة ما لم تعلّقه الإدارة. الخدمات الإضافية تتبع الاستحقاق الفعلي.', 'Your core site, data, and QR remain available after trial expiration unless administration suspends it. Additional services follow actual entitlement.')}</p></div><dl><div><dt>{tr('نهاية التجربة', 'Trial end')}</dt><dd>{formatDate(Number(user?.trial_until), locale)}</dd></div><div><dt>{tr('نهاية الاستحقاق', 'Entitlement end')}</dt><dd>{formatDate(Number(user?.entitlement_until), locale)}</dd></div></dl></section>
        <section className="card"><div className="dashboard-section-heading"><div><ReceiptText size={18}/><h2>{tr('طلب اشتراك عبر الحوالة', 'Bank-transfer subscription request')}</h2></div><button className="button button--quiet" onClick={() => void getInstructions()} disabled={paymentLoading}>{paymentLoading ? <RefreshCw className="spin" size={16}/> : <Eye size={16}/>}{tr('عرض التعليمات الرسمية', 'Show official instructions')}</button></div>{paymentInstructions === null ? <p className="muted">{tr('لم تُحمّل تعليمات بنكية رسمية بعد. لا يمكننا اختلاق بيانات تحويل أو الادعاء باستقبال دفعة قبل إعدادها من الإدارة.', 'Official bank instructions have not been loaded. We cannot invent bank details or claim to accept payment before administration configures them.')}</p> : <PaymentInstructions value={paymentInstructions} tr={tr} />}{!bankIntakeAvailable && <p className="dashboard-error" role="status">{bankIntakeReason}</p>}{receiptError && <p className="dashboard-error" role="status">{receiptError}</p>}<div className="dashboard-payment-form"><label><span>{tr('المبلغ المتفق عليه (SAR)', 'Agreed amount (SAR)')}</span><input className="field" type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })}/></label><label><span>{tr('أيام الاستحقاق', 'Entitlement days')}</span><input className="field" type="number" min="1" step="1" value={paymentForm.days} onChange={(event) => setPaymentForm({ ...paymentForm, days: event.target.value })}/></label><label className="dashboard-payment-note"><span>{tr('ملاحظة اختيارية', 'Optional note')}</span><input className="field" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })}/></label><UploadControl label={paymentForm.receiptId ? tr('تم رفع الإيصال', 'Receipt uploaded') : tr('رفع إيصال خاص', 'Upload private receipt')} purpose="receipt" uploading={uploading} tr={tr} onChange={(event) => void uploadImage(event, 'receipt', (upload) => setPaymentForm({ ...paymentForm, receiptId: upload.id, receiptUrl: upload.url }))} /><button className="button" disabled={!bankIntakeAvailable} title={!bankIntakeAvailable ? bankIntakeReason : undefined} onClick={() => void submitPayment()}><Send size={17}/>{tr('إرسال الطلب للمراجعة', 'Submit for review')}</button></div></section>
        {asArray<Record<string, unknown>>(dashboard?.payments).length > 0 && <section className="card"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('طلباتك السابقة', 'Your previous requests')}</h2></div></div>{asArray<Record<string, unknown>>(dashboard?.payments).map((payment, index) => <div className="dashboard-history-row" key={String(payment.id ?? index)}><span>{String(payment.status ?? 'requested')}</span><p>{Number(payment.amount ?? 0).toLocaleString(locale)} SAR · {String(payment.days ?? '')} {tr('يوم', 'day(s)')}</p><time>{formatDate(Number(payment.created_at), locale)}</time></div>)}</section>}
      </section>}

      {activeTab === 'settings' && <section className="dashboard-settings stack">
        <section className="card dashboard-notification-sound"><div className="dashboard-section-heading"><div><Bell size={18}/><h2>{tr('صوت التنبيهات', 'Notification sound')}</h2></div></div><p className="muted">{tr('خيار محلي لهذا المتصفح، متوقف افتراضياً. يتطلب التفعيل تفاعلك لتهيئة الصوت؛ لا يُرسل هذا التفضيل إلى الخادم.', 'A local preference for this browser, off by default. Enabling requires your interaction to initialize audio; this preference is not sent to the server.')}</p><label className="dashboard-check"><input type="checkbox" checked={notificationSoundEnabled} onChange={(event) => void setNotificationSound(event.target.checked)}/>{tr('تشغيل نغمة للتنبيهات الجديدة فقط', 'Play a chime only for newly observed notifications')}</label></section>
        <section className="card"><div className="dashboard-section-heading"><div><Lock size={18}/><h2>{tr('قفل الموقع', 'Site lock')}</h2></div></div><p className="muted">{tr('القفل خدمة استحقاقية يطبقها الخادم. كلمة المرور هنا منفصلة تماماً عن دخول حسابك.', 'Locking is entitlement-controlled and enforced by the server. This password is entirely separate from account sign-in.')}</p><label className="dashboard-check"><input type="checkbox" checked={lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, enabled: event.target.checked })}/>{tr('تفعيل كلمة مرور لزوار الموقع', 'Require a password from site visitors')}</label><div className="dashboard-settings-grid"><label><span>{tr('كلمة مرور الموقع', 'Site password')}</span><input className="field" type="password" autoComplete="new-password" value={lockForm.password} disabled={!lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, password: event.target.value })}/></label><label><span>{tr('رسالة الزوار', 'Visitor message')}</span><input className="field" value={lockForm.message} disabled={!lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, message: event.target.value })}/></label></div><button className="button" disabled={!activeSite} onClick={() => void saveLock()}><Lock size={16}/>{tr('حفظ القفل', 'Save lock')}</button></section>
        <section className="card"><div className="dashboard-section-heading"><div><ShieldCheck size={18}/><h2>{tr('PIN والجهاز الموثوق', 'PIN and trusted device')}</h2></div></div><p className="muted">{tr('أنشئ أو غيّر PIN من ستة أرقام للدخول السريع على هذا الجهاز الموثوق فقط. يرفض الخادم الإجراء حتى تعيد التحقق حديثاً من البريد.', 'Create or change a six-digit PIN for quick entry on this trusted device only. The server rejects the action until you have freshly verified by email.')}</p><div className="dashboard-inline-form dashboard-pin-form"><label><span>{tr('PIN جديد', 'New PIN')}</span><input className="field" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(event) => setPinValue(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><label><span>{tr('تأكيد PIN', 'Confirm PIN')}</span><input className="field" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><button className="button" onClick={() => void savePin()}><ShieldCheck size={16}/>{tr('إنشاء أو تغيير PIN', 'Create or change PIN')}</button></div></section>
        {unboundNames.length > 0 && <section className="card dashboard-unbound-names"><div className="dashboard-section-heading"><div><Link2 size={18}/><h2>{tr('ربط اسم منقول', 'Attach transferred name')}</h2></div></div><p className="muted">{tr('الاسم المنقول ملك لك لكنه غير مرتبط بمسودة. اختر مسودة قائمة أو أنشئ الأولى منه.', 'This transferred name belongs to you but is not attached to a draft. Choose an existing draft or create the first one from it.')}</p>{attachSites.length > 0 && <label><span>{tr('المسودة المستهدفة', 'Target draft')}</span><select className="field" value={attachmentSiteId || ''} onChange={(event) => setAttachTargetId(event.target.value)}>{attachSites.map((site) => <option key={site.id} value={site.id}>{site.name ? `${site.name}.ksa.men` : site.id}</option>)}</select></label>}<div className="dashboard-unbound-name-list">{unboundNames.map((item) => <div key={item.name}><strong dir="ltr"><bdi>{item.name}.ksa.men</bdi></strong><button className="button button--quiet" disabled={Boolean(attachingName)} onClick={() => void attachUnboundName(item.name, attachmentSiteId)}>{attachingName === item.name ? <RefreshCw className="spin" size={16}/> : <Link2 size={16}/>} {attachmentSiteId ? tr('ربط بالمسودة', 'Attach to draft') : tr('إنشاء مسودة وربط الاسم', 'Create draft & attach')}</button></div>)}</div></section>}
        <section className="card"><div className="dashboard-section-heading"><div><ArrowLeftRight size={18}/><h2>{tr('نقل الاسم المميز', 'Distinctive name transfer')}</h2></div></div><p className="muted">{tr('يُنقل الاسم فقط؛ لا تنتقل المسودة أو المحتوى أو الصور أو روابط QR تلقائياً، وقد تتأثر الروابط القديمة.', 'Only the name transfers. Draft, content, images, and QR links do not transfer automatically, and old links may be affected.')}</p><div className="dashboard-settings-grid"><label><span>{tr('الاسم المملوك', 'Owned name')}</span><input className="field" value={nameTransfer.name} onChange={(event) => setNameTransfer({ ...nameTransfer, name: event.target.value })}/></label><label><span>{tr('المستفيد (C# أو اسم)', 'Recipient (C# or name)')}</span><input className="field" value={nameTransfer.recipient} onChange={(event) => setNameTransfer({ ...nameTransfer, recipient: event.target.value })}/></label></div><label className="dashboard-check"><input type="checkbox" checked={nameTransfer.confirmed} onChange={(event) => setNameTransfer({ ...nameTransfer, confirmed: event.target.checked })}/>{tr('أفهم أثر النقل وفصل الاسم عن بيانات الموقع.', 'I understand the transfer consequences and separation from site data.')}</label><button className="button" disabled={!nameTransfer.confirmed} onClick={() => void beginNameTransfer()}><ArrowLeftRight size={16}/>{tr('إنشاء طلب نقل', 'Create transfer request')}</button>{pendingTransfers.length > 0 && <div className="dashboard-pending-list">{pendingTransfers.map((transfer, index) => <div key={String(transfer.id ?? index)}><span>{String(transfer.name ?? tr('اسم مميز', 'Distinctive name'))}</span><button className="button button--quiet" onClick={() => void acceptNameTransfer(String(transfer.id))}>{tr('قبول النقل', 'Accept transfer')}</button></div>)}</div>}</section>
        {handovers.length > 0 && <section className="card"><div className="dashboard-section-heading"><div><UsersRound size={18}/><h2>{tr('تسليمات بانتظار قبولك', 'Handovers awaiting your acceptance')}</h2></div></div>{handovers.map((handover, index) => <div className="dashboard-history-row" key={String(handover.id ?? index)}><p>{String(handover.site_id ?? '')}</p><time>{formatDate(Number(handover.created_at), locale)}</time><button className="button button--quiet" onClick={() => void acceptHandover(String(handover.id))}>{tr('قبول التسليم', 'Accept handover')}</button></div>)}</section>}
        <section className="card dashboard-danger"><div className="dashboard-section-heading"><div><Trash2 size={18}/><h2>{tr('طلب حذف الحساب والبيانات', 'Request account and data deletion')}</h2></div></div><p>{tr('لا يحذف هذا الزر بياناتك فوراً. يرسل طلباً موثقاً للمراجعة والمعالجة وفق السياسة.', 'This does not immediately erase your data. It submits a documented request for review and handling under policy.')}</p><textarea className="field" rows={3} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder={tr('سبب اختياري لطلب الحذف', 'Optional deletion reason')}/><label className="dashboard-check"><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.target.checked)}/>{tr('أفهم أن الطلب يحتاج مراجعة ولا يعني الحذف الفوري.', 'I understand the request needs review and does not mean immediate deletion.')}</label><button className="button button--danger" disabled={!deletionConfirmed} onClick={() => void requestDeletion()}><Trash2 size={16}/>{tr('إرسال طلب الحذف', 'Submit deletion request')}</button></section>
      </section>}

          </section>
        </div>
      </div>
      {previewOpen && <PreviewModal draft={draft} site={activeSite} tr={tr} submitting={submittingReview} onClose={() => setPreviewOpen(false)} onSubmit={submitForReview} />}
    </main>
  );
}

function InitialNameReservation({ candidate, availability, checking, reserving, locallyValid, onChange, onReserve, tr }: { candidate: string; availability: NameAvailability | null; checking: boolean; reserving: boolean; locallyValid: boolean; onChange: (value: string) => void; onReserve: () => void; tr: (ar: string, en: string) => string }) {
  const advisory = !candidate.trim()
    ? tr('اسمك سيكون عنوانك الخاص. تحقّق من توفره قبل الإنشاء.', 'Your name becomes your private address. Check availability before creating.')
    : checking
      ? tr('جارٍ التحقق من توفر الاسم…', 'Checking live availability…')
      : availability?.available
        ? tr('الاسم متاح ويمكن حجزه الآن.', 'This name is available to reserve now.')
        : availability?.reason || tr('أدخل اسماً صالحاً للمتابعة.', 'Enter a valid name to continue.');
  const stateClass = availability?.available ? 'is-available' : candidate.trim() && !checking ? 'is-unavailable' : '';
  return <section className="dashboard-name-reservation card" aria-labelledby="initial-name-title">
    <header><p className="dashboard-kicker"><BadgeCheck size={15}/>{tr('الخطوة 1 من 2', 'Step 1 of 2')}</p><h2 id="initial-name-title">{tr('اختر اسمك الخاص', 'Choose your private name')}</h2><p className="muted">{tr('ستنشئ المسودة التالية بعد حجز الاسم فقط.', 'Your editable draft is created only after this name is reserved.')}</p></header>
    <label><span>{tr('النطاق الفرعي الخاص', 'Private subdomain')}</span><div className="dashboard-name-field" dir="ltr"><input className={`field ${candidate.trim() && !locallyValid ? 'is-invalid' : ''}`} value={candidate} onChange={(event) => onChange(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" placeholder="your-name" aria-describedby="initial-name-advisory" disabled={reserving}/><span>.ksa.men</span></div></label>
    <p id="initial-name-advisory" className={`dashboard-name-advisory ${stateClass}`} role="status" aria-live="polite">{checking || reserving ? <RefreshCw className="spin" size={16}/> : availability?.available ? <Check size={16}/> : <CircleHelp size={16}/>}<span>{reserving ? tr('جارٍ الحجز وإنشاء المسودة…', 'Reserving name and creating draft…') : advisory}</span></p>
    {availability?.suggestions && availability.suggestions.length > 0 && <div className="dashboard-name-suggestions"><span>{tr('بدائل متاحة للتحقق:', 'Alternatives to check:')}</span>{availability.suggestions.slice(0, 3).map((suggestion) => <button type="button" key={suggestion} onClick={() => onChange(suggestion)}><bdi dir="ltr">{suggestion}.ksa.men</bdi></button>)}</div>}
    <button className="button" disabled={!locallyValid || !availability?.available || checking || reserving} onClick={onReserve}>{reserving ? <RefreshCw className="spin" size={17}/> : <Plus size={17}/>} {tr('حجز وإنشاء المسودة', 'Reserve & create')}</button>
  </section>;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof PanelTop; title: string; body: string }) { return <section className="dashboard-empty card"><Icon size={28}/><h2>{title}</h2><p className="muted">{body}</p></section>; }
function EmptyInline({ text }: { text: string }) { return <p className="dashboard-empty-inline"><CircleHelp size={17}/>{text}</p>; }

function TextSection({ label, hint, value, multiline = false, onChange }: { label: string; hint: string; value: string; multiline?: boolean; onChange: (value: string) => void }) {
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><PencilLine size={15}/>{label}</p><h2>{label}</h2><p className="muted">{hint}</p></div></header>{multiline ? <textarea className="field dashboard-textarea" rows={10} value={value} onChange={(event) => onChange(event.target.value)}/> : <input className="field" value={value} onChange={(event) => onChange(event.target.value)}/>}</>;
}

function IdentitySection({ draft, tr, uploading, onChange, onUpload }: { draft: ProfileDraft; tr: (ar: string, en: string) => string; uploading: string; onChange: (patch: Partial<ProfileDraft>) => void; onUpload: (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose, cb: (upload: UploadResult) => void) => void }) {
  return <>
    <header className="dashboard-edit-heading">
      <div>
        <p className="dashboard-kicker"><UserRound size={15}/>{tr('الخطوة 1', 'Step 1')}</p>
        <h2>{tr('الاسم والمسمى', 'Name and title')}</h2>
        <p className="muted">{tr('ابدأ ببيانات الهوية المطلوبة، ثم أضف الصورة والغلاف عندما تكون جاهزاً.', 'Start with the required identity details, then add a photo and cover when ready.')}</p>
      </div>
    </header>
    <div className="dashboard-settings-grid">
      <label><span>{tr('الاسم', 'Name')}</span><input className="field" autoComplete="name" value={draft.name} onChange={(event) => onChange({ name: event.target.value })}/></label>
      <label><span>{tr('المسمى المهني', 'Professional title')}</span><input className="field" value={draft.title} onChange={(event) => onChange({ title: event.target.value })}/></label>
    </div>
    <div className="dashboard-media-pair">
      <UploadControl label={tr('الصورة الشخصية', 'Profile photo')} purpose="photo" uploading={uploading} tr={tr} preview={draft.photo} onChange={(event) => void onUpload(event, 'photo', (upload) => onChange({ photo: upload.url }))}/>
      <UploadControl label={tr('الغلاف البانورامي', 'Panoramic cover')} purpose="cover" uploading={uploading} tr={tr} preview={draft.cover} onChange={(event) => void onUpload(event, 'cover', (upload) => onChange({ cover: upload.url }))}/>
    </div>
  </>;
}
function ContactSection({ draft, tr, onChange }: { draft: ProfileDraft; tr: (ar: string, en: string) => string; onChange: (patch: Partial<ProfileDraft>) => void }) { return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Mail size={15}/>{tr('الخطوة 3', 'Step 3')}</p><h2>{tr('بيانات التواصل والموقع', 'Contact and location')}</h2><p className="muted">{tr('يمكنك لاحقاً التحكم في ظهور كل حقل ضمن إعدادات الخصوصية.', 'You can later control visibility for each field in privacy settings.')}</p></div></header><div className="dashboard-settings-grid">{([['email', tr('البريد الإلكتروني', 'Email'), 'email'], ['phone', tr('الهاتف', 'Phone'), 'tel'], ['whatsapp', tr('واتساب', 'WhatsApp'), 'tel'], ['city', tr('المدينة', 'City'), 'text'], ['country', tr('الدولة', 'Country'), 'text']] as const).map(([key, label, type]) => <label key={key}><span>{label}</span><input className="field" type={type} value={draft[key]} onChange={(event) => onChange({ [key]: event.target.value })}/></label>)}</div></>;
}
function StructuredList({ title, value, onChange, tr, timeline = false }: { title: string; value: ResumeItem[]; onChange: (value: ResumeItem[]) => void; tr: (ar: string, en: string) => string; timeline?: boolean }) {
  const update = (index: number, key: keyof ResumeItem, text: string) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: text } : item));
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><BookOpen size={15}/>{timeline ? tr('خط زمني', 'Timeline') : tr('قائمة منظمة', 'Structured list')}</p><h2>{title}</h2><p className="muted">{tr('أضف المعلومات التي يمكنك تأكيدها فقط. يمكنك ترك تاريخ النهاية فارغاً للحالة الحالية.', 'Add only information you can confirm. Leave the end date empty for a current item.')}</p></div><button className="button button--quiet" onClick={() => onChange([...value, blankItem()])}><Plus size={16}/>{tr('إضافة عنصر', 'Add item')}</button></header><div className="dashboard-structured-list">{value.length === 0 && <EmptyInline text={tr('لا توجد عناصر بعد.', 'No items yet.')} />}{value.map((item, index) => <article key={`${index}-${item.title}`}><div className="dashboard-list-card-top"><strong>{tr('عنصر', 'Item')} {index + 1}</strong><button className="dashboard-icon-button" aria-label={tr('حذف العنصر', 'Remove item')} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16}/></button></div><div className="dashboard-settings-grid"><label><span>{tr('العنوان أو المسمى', 'Title or role')}</span><input className="field" value={item.title} onChange={(event) => update(index, 'title', event.target.value)}/></label><label><span>{tr('الجهة', 'Organization')}</span><input className="field" value={item.organization} onChange={(event) => update(index, 'organization', event.target.value)}/></label><label><span>{tr('البداية', 'Start')}</span><input className="field" value={item.start} onChange={(event) => update(index, 'start', event.target.value)} placeholder="2024-01"/></label><label><span>{tr('النهاية', 'End')}</span><input className="field" value={item.end} onChange={(event) => update(index, 'end', event.target.value)} placeholder={tr('الحالي أو 2025-01', 'Current or 2025-01')}/></label></div><label><span>{tr('الوصف', 'Description')}</span><textarea className="field" rows={3} value={item.description} onChange={(event) => update(index, 'description', event.target.value)}/></label></article>)}</div></>;
}
function StringList({ title, hint, value, onChange, tr }: { title: string; hint?: string; value: string[]; onChange: (value: string[]) => void; tr: (ar: string, en: string) => string }) { return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Check size={15}/>{tr('قائمة قابلة للتحرير', 'Editable list')}</p><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}</div><button className="button button--quiet" onClick={() => onChange([...value, ''])}><Plus size={16}/>{tr('إضافة', 'Add')}</button></header><div className="dashboard-string-list">{value.length === 0 && <EmptyInline text={tr('أضف أول عنصر لتبدأ.', 'Add your first item to start.')} />}{value.map((item, index) => <div key={`${index}-${item}`}><input className="field" value={item} onChange={(event) => onChange(value.map((valueItem, valueIndex) => valueIndex === index ? event.target.value : valueItem))}/><button className="dashboard-icon-button" aria-label={tr('حذف', 'Remove')} onClick={() => onChange(value.filter((_, valueIndex) => valueIndex !== index))}><X size={16}/></button></div>)}</div></>;
}
function MediaSection({ title, hint, items, max, purpose, uploading, tr, onUpload, onChange }: { title: string; hint: string; items: string[]; max: number; purpose: 'skill' | 'work'; uploading: string; tr: (ar: string, en: string) => string; onUpload: (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose, cb: (upload: UploadResult) => void) => void; onChange: (items: string[]) => void }) { return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><ImagePlus size={15}/>{items.length}/{max}</p><h2>{title}</h2><p className="muted">{hint}</p></div>{items.length < max && <UploadControl label={tr('إضافة صورة', 'Add image')} purpose={purpose} uploading={uploading} tr={tr} compact onChange={(event) => void onUpload(event, purpose, (upload) => onChange([...items, upload.url]))}/>}</header><div className="dashboard-image-grid">{items.length === 0 && <EmptyInline text={tr('لا توجد صور مرفوعة بعد.', 'No images uploaded yet.')} />}{items.map((url, index) => <figure key={url}><img src={url} alt=""/><button className="dashboard-icon-button" onClick={() => onChange(items.filter((_, imageIndex) => imageIndex !== index))} aria-label={tr('إزالة الصورة', 'Remove image')}><X size={16}/></button></figure>)}</div></>;
}
function YoutubeSection({ value, onChange, tr }: { value: string; onChange: (value: string) => void; tr: (ar: string, en: string) => string }) { const valid = !value || /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(value); return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Youtube size={15}/>{tr('فيديو اختياري', 'Optional video')}</p><h2>{tr('فيديو YouTube التعريفي', 'YouTube introduction')}</h2><p className="muted">{tr('يُحمّل مشغّل الفيديو في موقعك بعد تفاعل الزائر فقط.', 'The video player loads on your site only after visitor interaction.')}</p></div></header><label><span>{tr('رابط YouTube', 'YouTube URL')}</span><input className={`field ${!valid ? 'is-invalid' : ''}`} type="url" placeholder="https://youtu.be/..." value={value} onChange={(event) => onChange(event.target.value)}/></label>{!valid && <p className="dashboard-error">{tr('استخدم رابطاً صحيحاً من YouTube.', 'Use a valid YouTube URL.')}</p>}</>;
}
function LinkList({ title, hint, value, onChange, max, tr }: { title: string; hint: string; value: Social[]; onChange: (value: Social[]) => void; max: number; tr: (ar: string, en: string) => string }) { const update = (index: number, key: keyof Social, text: string) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: text } : item)); return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Link2 size={15}/>{value.length}/{max}</p><h2>{title}</h2><p className="muted">{hint}</p></div>{value.length < max && <button className="button button--quiet" onClick={() => onChange([...value, { label: '', url: '' }])}><Plus size={16}/>{tr('إضافة رابط', 'Add link')}</button>}</header><div className="dashboard-link-list">{value.length === 0 && <EmptyInline text={tr('لا توجد روابط مضافة بعد.', 'No links added yet.')} />}{value.map((item, index) => <div key={`${index}-${item.url}`}><Globe2 size={17}/><input className="field" value={item.label} placeholder={tr('العنوان', 'Label')} onChange={(event) => update(index, 'label', event.target.value)}/><input className="field" type="url" value={item.url} placeholder="https://" onChange={(event) => update(index, 'url', event.target.value)}/>{item.url && <small>{socialHost(item.url)}</small>}<button className="dashboard-icon-button" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={tr('حذف الرابط', 'Remove link')}><X size={16}/></button></div>)}</div></>;
}
function PrivacySection({ draft, tr, onChange }: { draft: ProfileDraft; tr: (ar: string, en: string) => string; onChange: (patch: Partial<ProfileDraft>) => void }) { const fields = [['email', tr('البريد الإلكتروني', 'Email')], ['phone', tr('الهاتف', 'Phone')], ['whatsapp', tr('واتساب', 'WhatsApp')], ['city', tr('المدينة', 'City')]]; const toggleHidden = (key: string) => onChange({ hidden: draft.hidden.includes(key) ? draft.hidden.filter((item) => item !== key) : [...draft.hidden, key] }); return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><ShieldCheck size={15}/>{tr('الظهور العام', 'Public visibility')}</p><h2>{tr('الخصوصية والظهور', 'Privacy and discovery')}</h2><p className="muted">{tr('إخفاء الحقل يمنع عرضه في الموقع والبحث وQR والتصديرات العامة.', 'Hiding a field prevents it appearing on the site, search, QR, and public exports.')}</p></div></header><div className="dashboard-privacy-options"><label className="dashboard-check"><input type="checkbox" checked={draft.searchable} onChange={(event) => onChange({ searchable: event.target.checked })}/>{tr('السماح بظهور الموقع في البحث', 'Allow site discovery in search')}</label><label className="dashboard-check"><input type="checkbox" checked={draft.allowContact} onChange={(event) => onChange({ allowContact: event.target.checked })}/>{tr('السماح بطلبات التواصل', 'Allow contact requests')}</label>{fields.map(([key, label]) => <label className="dashboard-check" key={key}><input type="checkbox" checked={draft.hidden.includes(key)} onChange={() => toggleHidden(key)}/>{tr('إخفاء', 'Hide')} {label}</label>)}</div><label><span>{tr('طلب إعادة توجيه خارجي', 'External redirect request')}</span><input className="field" type="url" placeholder="https://" value={draft.redirect} onChange={(event) => onChange({ redirect: event.target.value })}/><small className="muted">{tr('تُنفذ إعادة التوجيه بعد موافقة الإدارة والتحقق من الوجهة.', 'Redirect is applied only after administration approval and destination validation.')}</small></label></>;
}
function UploadControl({ label, purpose, uploading, tr, preview, compact = false, onChange }: { label: string; purpose: UploadPurpose; uploading: string; tr: (ar: string, en: string) => string; preview?: string; compact?: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) { const id = `upload-${purpose}-${Math.random().toString(36).slice(2)}`; return <label className={`dashboard-upload ${compact ? 'is-compact' : ''}`} htmlFor={id}>{preview && <img src={preview} alt=""/>}<span>{uploading === purpose ? <RefreshCw size={16} className="spin"/> : <Upload size={16}/>} {uploading === purpose ? tr('جارٍ الرفع...', 'Uploading...') : label}</span><input id={id} type="file" accept={purpose === 'receipt' ? 'application/pdf,image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp'} onChange={onChange} disabled={Boolean(uploading)}/></label>; }
function MidPointMark({ compact = false }: { compact?: boolean }) { return <span className={`midpoint-mark${compact ? ' is-compact' : ''}`} aria-label="MIDPOINT"><Gift size={compact ? 13 : 16}/><span>MIDPOINT</span></span>; }
function MidPointAmount({ value, locale }: { value: number; locale: string }) { return <span className="midpoint-amount"><strong>{value.toLocaleString(locale)}</strong><MidPointMark compact/></span>; }
function WalletPanel({ balance, ledger, transferForm, setTransferForm, redeemDays, setRedeemDays, onTransfer, onRedeem, onCopyReferral, busyOperation, locale, tr }: { balance: number; ledger: Record<string, unknown>[]; transferForm: { recipient: string; amount: string }; setTransferForm: (value: { recipient: string; amount: string }) => void; redeemDays: string; setRedeemDays: (value: string) => void; onTransfer: () => void; onRedeem: () => void; onCopyReferral: () => void; busyOperation: WalletOperation | ''; locale: string; tr: (ar: string, en: string) => string }) {
  const amount = Number(transferForm.amount);
  const days = Number(redeemDays);
  const transferBusy = busyOperation === 'transfer';
  const redeemBusy = busyOperation === 'redeem';
  return <section className="dashboard-wallet stack"><section className="dashboard-wallet-hero card"><div><p className="dashboard-kicker"><WalletCards size={16}/>{tr('نقاط الوسط', 'Mid Points')}</p><h2><MidPointAmount value={balance} locale={locale}/></h2><p>{tr('نقاط غير نقدية؛ لا تُسحب أو تُستبدل بالنقد.', 'Non-cash points; they cannot be withdrawn or exchanged for cash.')}</p></div><div className="dashboard-wallet-mark"><MidPointMark/></div></section><section className="dashboard-wallet-grid"><article className="card"><div className="dashboard-section-heading"><div><ArrowLeftRight size={18}/><h2>{tr('تحويل نقاط', 'Transfer points')}</h2></div></div><p className="muted">{tr('من 100 إلى 1,000 MIDPOINT للعملية، بلا رسوم أو حدّ لعدد العمليات. لا يمكن الإرسال إلى حسابك نفسه أو فوق رصيدك.', '100 to 1,000 MIDPOINT per transfer, no fee and no count limit. You cannot send to yourself or above your balance.')}</p><div className="dashboard-inline-form"><input className="field" value={transferForm.recipient} onChange={(event) => setTransferForm({ ...transferForm, recipient: event.target.value })} disabled={Boolean(busyOperation)} placeholder={tr('المستفيد: C2 أو اسم', 'Recipient: C2 or name')}/><label className="dashboard-point-input"><input className="field" type="number" min="100" max="1000" step="1" value={transferForm.amount} onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })} disabled={Boolean(busyOperation)} placeholder="100–1,000"/><MidPointMark compact/></label>{Number.isInteger(amount) && <span className="dashboard-point-preview"><MidPointAmount value={amount} locale={locale}/></span>}<button className="button" disabled={Boolean(busyOperation)} aria-busy={transferBusy} onClick={onTransfer}>{transferBusy ? <RefreshCw className="spin" size={16}/> : <Send size={16}/>} {transferBusy ? tr('جارٍ التحويل', 'Transferring') : tr('تحويل', 'Transfer')}</button></div></article><article className="card"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('استبدال الاستحقاق', 'Redeem entitlement')}</h2></div></div><p className="muted">{tr('كل 100 MIDPOINT تضيف يوماً كاملاً إلى استحقاق الخدمات. تُطبّق العملية ذرّياً لدى الخادم.', 'Every 100 MIDPOINT adds a full entitlement day. The server applies this atomically.')}</p><div className="dashboard-inline-form"><input className="field" type="number" min="1" step="1" value={redeemDays} onChange={(event) => setRedeemDays(event.target.value)} disabled={Boolean(busyOperation)} aria-label={tr('عدد الأيام', 'Number of days')}/>{Number.isInteger(days) && days > 0 && <span className="dashboard-point-preview"><MidPointAmount value={days * 100} locale={locale}/><small>{tr('مقابل', 'for')} {days} {tr('يوم', 'day(s)')}</small></span>}<button className="button" disabled={Boolean(busyOperation)} aria-busy={redeemBusy} onClick={onRedeem}>{redeemBusy ? <RefreshCw className="spin" size={16}/> : <Gift size={16}/>}<MidPointMark compact/>{redeemBusy ? tr('جارٍ الاستبدال', 'Redeeming') : tr('استبدال', 'Redeem')}</button></div></article></section><section className="card dashboard-referral"><div><p className="dashboard-kicker"><UsersRound size={15}/>{tr('الإحالة', 'Referral')}</p><h2>{tr('رابط إحالتك الخاص', 'Your referral link')}</h2><p className="muted">{tr('تُضاف', 'A')} <MidPointAmount value={1000} locale={locale}/> {tr('مرة واحدة فقط عند أول اشتراك مدفوع مؤهل ومعتمد للشخص المُحال، وليس عند التسجيل.', 'is added once only when the referred person’s first eligible paid subscription is approved, not at registration.')}</p></div><button className="button button--quiet" onClick={onCopyReferral}><Copy size={16}/>{tr('نسخ الرابط', 'Copy link')}</button></section><section className="card"><div className="dashboard-section-heading"><div><FileText size={18}/><h2>{tr('دفتر الحركات', 'Ledger')}</h2></div></div>{ledger.length ? <div className="dashboard-ledger">{ledger.slice(0, 20).map((entry, index) => <div key={String(entry.id ?? index)}><span>{String(entry.kind ?? 'movement')}</span><MidPointAmount value={Number(entry.amount ?? 0)} locale={locale}/><small>{String(entry.notes ?? '')}</small><time>{formatDate(Number(entry.created_at), locale)}</time></div>)}</div> : <EmptyInline text={tr('لا توجد حركات مؤكدة لعرضها بعد.', 'No confirmed ledger entries to show yet.')} />}</section></section>;
}
function QuickLinkPanel({ mode, setMode, fields, setFields, days, setDays, activeLink, existing, onCreate, onRevoke, tr }: { mode: QuickMode; setMode: (value: QuickMode) => void; fields: Record<string, boolean>; setFields: (value: Record<string, boolean>) => void; days: string; setDays: (value: string) => void; activeLink: QuickLink | null; existing: QuickLink[]; onCreate: () => void; onRevoke: (id: string) => void; tr: (ar: string, en: string) => string }) {
  const labels: Record<string, [string, string]> = { name: ['الاسم', 'Name'], title: ['المسمى', 'Title'], whatsapp: ['واتساب', 'WhatsApp'], email: ['البريد', 'Email'], site: ['رابط الموقع', 'Site link'] };
  const modes: Array<{ key: QuickMode; ar: string; en: string; fields: string[] }> = [
    { key: 'professional', ar: 'مهني', en: 'Professional', fields: ['name', 'title', 'email', 'site'] },
    { key: 'business', ar: 'تجاري', en: 'Business', fields: ['name', 'title', 'whatsapp', 'site'] },
    { key: 'quick', ar: 'تعارف سريع', en: 'Quick intro', fields: ['name', 'title', 'whatsapp'] },
  ];
  const chooseMode = (next: typeof modes[number]) => { setMode(next.key); setFields(Object.fromEntries(Object.keys(fields).map((key) => [key, next.fields.includes(key)]))); };
  const links = activeLink ? [activeLink] : existing.filter((item) => !item.revoked);
  return <article className="card dashboard-quick-link"><div className="dashboard-section-heading"><div><Link2 size={18}/><h2>{tr('بطاقة ورابط التعارف', 'Introduction card and link')}</h2></div></div><p className="muted">{tr('اختر وضعاً ثم راجع الحقول المشتركة. الرابط مستقل عن خصوصية موقعك الأساسي ويمكن إلغاؤه فوراً.', 'Choose a mode, then review the shared fields. The link is independent of core-site privacy and can be revoked immediately.')}</p><div className="dashboard-intro-modes" role="group" aria-label={tr('وضع التعارف', 'Introduction mode')}>{modes.map((item) => <button key={item.key} className={`button button--quiet ${mode === item.key ? 'is-active' : ''}`} aria-pressed={mode === item.key} onClick={() => chooseMode(item)}><UsersRound size={15}/>{tr(item.ar, item.en)}</button>)}</div><div className="dashboard-quick-fields">{Object.keys(fields).map((key) => <label key={key}><input type="checkbox" checked={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.checked })}/>{tr(...labels[key])}</label>)}</div><div className="dashboard-inline-form"><input className="field" type="number" min="1" value={days} onChange={(event) => setDays(event.target.value)} aria-label={tr('مدة الصلاحية بالأيام', 'Lifetime in days')}/><button className="button" onClick={onCreate}><Link2 size={16}/>{tr('إنشاء الرابط', 'Create link')}</button></div>{links.map((link) => <div className="dashboard-created-link" key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.url || link.id}</a><button className="dashboard-icon-button" onClick={() => onRevoke(link.id)} aria-label={tr('إلغاء الرابط', 'Revoke link')}><Ban size={16}/></button></div>)}</article>;
}
function MessageRetention({ retention, tr }: { retention: unknown; tr: (ar: string, en: string) => string }) {
  const values = retention && typeof retention === 'object' && !Array.isArray(retention) ? retention as Record<string, unknown> : {};
  const periods = [
    { key: 'messagesDays', ar: 'الرسائل', en: 'Messages' },
    { key: 'reportDays', ar: 'أدلة البلاغات', en: 'Report evidence' },
    { key: 'authDays', ar: 'بيانات التحقق', en: 'Authentication data' },
  ].flatMap(({ key, ar, en }) => {
    const days = retentionDays(values[key]);
    return days === null ? [] : [{ key, label: tr(ar, en), days }];
  });
  return <section className="card dashboard-message-retention"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('فترات الاحتفاظ', 'Retention periods')}</h2></div></div>{periods.length ? <dl>{periods.map((period) => <div key={period.key}><dt>{period.label}</dt><dd>{period.days} {tr('يوماً', 'days')}</dd></div>)}</dl> : <p className="muted">{tr('لم يُعد الخادم حالياً فترة احتفاظ قابلة للعرض.', 'The server did not return a displayable retention period.')}</p>}<p className="dashboard-retention-note">{tr('هذه الفترات كما يعيدها الخادم. انتهاء الجلسة أو عدم إتاحة سجلها لا يعني وعداً بالحذف أو التطهير الفوري للبيانات.', 'These periods are returned by the server. Session expiration or unavailable history does not promise immediate data deletion or purging.')}</p></section>;
}

function MessagesPanel({ tr, userId, requests, blocks, conversations, retention, selected, recipient, setRecipient, body, setBody, onRequest, onDecision, onOpen, onSend, onEmoji, onEnd, onBlock, onReport, expired, locale }: { tr: (ar: string, en: string) => string; userId?: number; requests: Record<string, unknown>[]; blocks: Record<string, unknown>[]; conversations: Conversation[]; retention: unknown; selected: ConversationDetail | null; recipient: string; setRecipient: (value: string) => void; body: string; setBody: (value: string) => void; onRequest: () => void; onDecision: (id: string, accept: boolean) => void; onOpen: (conversation: Conversation) => void; onSend: () => void; onEmoji: (emoji: string) => void; onEnd: () => void; onBlock: () => void; onReport: () => void; expired: boolean; locale: string }) {
  const incoming = requests.filter((request) => request.status === 'pending' && numericId(request.to_id ?? request.toId) === userId);
  const outgoing = requests.filter((request) => request.status === 'pending' && numericId(request.from_id ?? request.fromId) === userId);
  const positiveEmoji = ['🙂', '😊', '👍', '🙏', '✨', '🌟', '🎉', '🤝', '💚', '❤️'];
  return <section className="dashboard-messages">
    <aside className="dashboard-message-sidebar stack">
      <section className="card"><div className="dashboard-section-heading"><div><Send size={18}/><h2>{tr('طلب تواصل', 'Contact request')}</h2></div></div><p className="muted">{tr('لن تبدأ أي محادثة قبل قبول المستفيد الصريح. النص والرموز الإيجابية المنتقاة فقط مسموحة في الجلسة.', 'No conversation starts without explicit recipient acceptance. Only text and selected positive emoji are allowed in a session.')}</p><div className="dashboard-inline-form"><input className="field" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={tr('معرّف المستفيد C#', 'Recipient ID C#')}/><button className="button" onClick={onRequest}><Send size={16}/>{tr('إرسال', 'Send')}</button></div></section>
      <MessageRetention retention={retention} tr={tr} />
      <section className="card"><div className="dashboard-section-heading"><div><Bell size={18}/><h2>{tr('طلبات بانتظار قرارك', 'Requests awaiting you')}</h2></div></div>{incoming.length ? <div className="dashboard-request-list">{incoming.map((request, index) => <div key={String(request.id ?? index)}><div><strong>{String(request.from_name ?? request.fromName ?? request.from_id ?? '')}</strong><small>{formatDate(Number(request.created_at ?? request.createdAt), locale)}</small></div><button className="dashboard-icon-button" aria-label={tr('قبول', 'Accept')} onClick={() => onDecision(String(request.id), true)}><Check size={16}/></button><button className="dashboard-icon-button is-danger" aria-label={tr('رفض', 'Decline')} onClick={() => onDecision(String(request.id), false)}><X size={16}/></button></div>)}</div> : <EmptyInline text={tr('لا توجد طلبات تحتاج قرارك.', 'No requests need your decision.')} />}{outgoing.length > 0 && <p className="dashboard-pending-note">{tr(`لديك ${outgoing.length} طلب/طلبات مرسلة بانتظار موافقة المستفيد.`, `You have ${outgoing.length} sent request(s) awaiting recipient approval.`)}</p>}</section>
      <section className="card"><div className="dashboard-section-heading"><div><MessageCircle size={18}/><h2>{tr('جلساتك', 'Your sessions')}</h2></div></div>{conversations.length ? <div className="dashboard-conversation-list">{conversations.map((conversation) => <button key={conversation.id} className={selected?.id === conversation.id ? 'is-active' : ''} onClick={() => void onOpen(conversation)}><span><strong>{conversation.other_user?.name || (conversation.other_user?.id ? `C${conversation.other_user.id}` : conversation.id)}</strong><small>{conversation.status === 'active' ? tr('جلسة نشطة', 'Active session') : conversation.status === 'expired' ? tr('جلسة منتهية', 'Expired session') : String(conversation.status || '')}</small></span><time>{formatDate(Number(conversation.last_activity), locale)}</time></button>)}</div> : <EmptyInline text={tr('لا توجد جلسات مراسلة.', 'No messaging sessions.')} />}</section>
      {blocks.length > 0 && <section className="card dashboard-block-list"><div className="dashboard-section-heading"><div><Ban size={18}/><h2>{tr('حسابات محظورة', 'Blocked accounts')}</h2></div></div>{blocks.map((block, index) => <p key={String(block.blocked_id ?? index)}>{String(block.blocked_name ?? `C${block.blocked_id ?? ''}`)}</p>)}</section>}
    </aside>
    <section className="card dashboard-chat">
      {!selected ? <div className="dashboard-empty"><MessageCircle size={28}/><h2>{tr('اختر جلسة مراسلة', 'Choose a messaging session')}</h2><p className="muted">{tr('جلسة النصوص تنتهي بعد 24 ساعة من آخر نشاط.', 'Text-only sessions expire 24 hours after last activity.')}</p></div> : <>
        <header className="dashboard-chat-header"><div><h2>{selected.other_user?.name || (selected.other_user?.id ? `C${selected.other_user.id}` : '')}</h2><p className={expired ? 'dashboard-error' : 'muted'}>{expired ? tr('انتهت هذه الجلسة ولم يعد الخادم يتيح سجل الرسائل. يلزم طلب جديد؛ لا يعني ذلك حذفاً أو تطهيراً فورياً للبيانات.', 'This session expired and the server no longer makes message history available. A new request is required; this does not promise immediate data deletion or purging.') : tr('نشطة لمدة 24 ساعة من آخر نشاط.', 'Active for 24 hours from last activity.')}</p></div><div><button className="dashboard-icon-button" aria-label={tr('إبلاغ', 'Report')} onClick={onReport}><AlertTriangle size={17}/></button><button className="dashboard-icon-button" aria-label={tr('حظر', 'Block')} onClick={onBlock}><Ban size={17}/></button><button className="dashboard-icon-button is-danger" aria-label={tr('إنهاء الجلسة', 'End session')} onClick={onEnd} disabled={expired}><X size={17}/></button></div></header>
        <div className="dashboard-chat-log">{expired ? <EmptyInline text={tr('لا يتيح الخادم سجل هذه الجلسة المنتهية.', 'The server does not make this expired session history available.')} /> : asArray<Message>(selected.messages).map((message) => <div key={message.id} className={message.sender_id === userId ? 'is-mine' : ''}><p>{message.body}</p><time>{formatDate(message.created_at, locale)}</time></div>)}</div>
        <div className="dashboard-chat-compose"><textarea className="field" rows={2} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} disabled={expired} placeholder={tr('اكتب رسالة نصية مهنية...', 'Write a professional text message...')}/><div className="dashboard-chat-actions"><div className="dashboard-emoji-picker" aria-label={tr('رموز إيجابية مسموحة', 'Allowed positive emoji')}>{positiveEmoji.map((emoji) => <button key={emoji} className="dashboard-icon-button" type="button" disabled={expired} onClick={() => onEmoji(emoji)} aria-label={emoji}>{emoji}</button>)}</div><button className="button" disabled={expired || !body.trim()} onClick={onSend}><Send size={17}/>{tr('إرسال', 'Send')}</button></div></div>
      </>}
    </section>
  </section>;
}

function TranslationEditor({ target, translation, onChange, tr }: { target: TranslationTarget; translation: ProfileDraft; onChange: (patch: Partial<ProfileDraft>) => void; tr: (ar: string, en: string) => string }) {
  const targetName = target === 'ar' ? tr('العربية', 'Arabic') : tr('الإنجليزية', 'English');
  const updateStrings = (key: 'skills' | 'hobbies', value: string) => onChange({ [key]: value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) });
  const updateStructured = (key: 'experience' | 'education' | 'training' | 'timeline', index: number, patch: Partial<ResumeItem>) => onChange({ [key]: translation[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const sections: Array<{ key: 'experience' | 'education' | 'training' | 'timeline'; ar: string; en: string; titles: boolean }> = [
    { key: 'experience', ar: 'الخبرات', en: 'Experience', titles: true },
    { key: 'education', ar: 'التعليم', en: 'Education', titles: false },
    { key: 'training', ar: 'التدريب', en: 'Training', titles: false },
    { key: 'timeline', ar: 'السجل الزمني', en: 'Timeline', titles: true },
  ];
  return <div className="dashboard-translation-editor" dir={target === 'ar' ? 'rtl' : 'ltr'}><p className="muted">{tr(`حرر النصوص المحفوظة للنسخة ${targetName} فقط ثم استخدم الحفظ الآن أو انتظر الحفظ التلقائي. الأسماء والجهات والمؤهلات الرسمية تبقى كما هي لحمايتها من التحريف.`, `Edit only the saved ${targetName} text, then use Save now or wait for auto-save. Names, organisations, and official qualifications remain exact to prevent alteration.`)}</p><div className="dashboard-settings-grid"><label><span>{tr('المسمى المترجم', 'Translated title')}</span><input className="field" value={translation.title} onChange={(event) => onChange({ title: event.target.value })}/></label><label><span>{tr('المدينة المترجمة', 'Translated city')}</span><input className="field" value={translation.city} onChange={(event) => onChange({ city: event.target.value })}/></label><label><span>{tr('الدولة المترجمة', 'Translated country')}</span><input className="field" value={translation.country} onChange={(event) => onChange({ country: event.target.value })}/></label></div><label><span>{tr('النبذة المترجمة', 'Translated biography')}</span><textarea className="field" rows={5} value={translation.bio} onChange={(event) => onChange({ bio: event.target.value })}/></label><div className="dashboard-settings-grid"><label><span>{tr('المهارات المترجمة، مفصولة بفواصل', 'Translated skills, comma-separated')}</span><textarea className="field" rows={3} value={translation.skills.join(', ')} onChange={(event) => updateStrings('skills', event.target.value)}/></label><label><span>{tr('الهوايات المترجمة، مفصولة بفواصل', 'Translated hobbies, comma-separated')}</span><textarea className="field" rows={3} value={translation.hobbies.join(', ')} onChange={(event) => updateStrings('hobbies', event.target.value)}/></label></div><div className="dashboard-translation-lists">{sections.map((section) => translation[section.key].length > 0 && <section key={section.key}><h3>{tr(section.ar, section.en)}</h3>{translation[section.key].map((item, index) => <div className="dashboard-translation-item" key={`${section.key}-${index}`}>{section.titles && <label><span>{tr('العنوان المترجم', 'Translated title')}</span><input className="field" value={item.title} onChange={(event) => updateStructured(section.key, index, { title: event.target.value })}/></label>}<label><span>{tr('الوصف المترجم', 'Translated description')}</span><textarea className="field" rows={3} value={item.description} onChange={(event) => updateStructured(section.key, index, { description: event.target.value })}/></label></div>)}</section>)}</div></div>;
}
function PaymentInstructions({ value, tr }: { value: PaymentInstructionsResult; tr: (ar: string, en: string) => string }) {
  if (value.available !== true) return <div className="dashboard-bank-empty"><AlertTriangle size={18}/>{asText(value.reason) || tr('لا توجد بيانات بنكية رسمية منشورة حالياً؛ لا يمكن إكمال طلب الحوالة.', 'No official bank details are currently published; a bank-transfer request cannot be completed.')}</div>;
  if (typeof value.instructions === 'string' && value.instructions.trim()) return <pre className="dashboard-bank-details">{value.instructions}</pre>;
  const details = value.instructions && typeof value.instructions === 'object' && !Array.isArray(value.instructions) ? value.instructions as Record<string, unknown> : {};
  const fields = Object.entries(details).filter(([, item]) => typeof item === 'string' || typeof item === 'number');
  if (!fields.length) return <div className="dashboard-bank-empty"><AlertTriangle size={18}/>{tr('لا توجد بيانات بنكية رسمية مكتملة لإرسال الطلب.', 'No complete official bank details are available for this request.')}</div>;
  return <dl className="dashboard-bank-details">{fields.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{String(item)}</dd></div>)}</dl>;
}

function PreviewModal({ draft, site, tr, submitting, onClose, onSubmit }: { draft: ProfileDraft; site: Site | null; tr: (ar: string, en: string) => string; submitting: boolean; onClose: () => void; onSubmit: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
    };
  }, []);

  return <dialog
    className="dashboard-preview-modal"
    ref={dialogRef}
    aria-labelledby="dashboard-preview-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <header>
      <div>
        <p className="dashboard-kicker"><Eye size={15}/>{tr('معاينة محلية للمسودة', 'Local draft preview')}</p>
        <h2 id="dashboard-preview-title">{draft.name || tr('اسمك', 'Your name')}</h2>
      </div>
      <button ref={closeButtonRef} type="button" className="dashboard-icon-button" onClick={onClose} aria-label={tr('إغلاق', 'Close')}><X size={18}/></button>
    </header>
    {draft.cover && <img className="dashboard-preview-cover" src={draft.cover} alt=""/>}
    <div className="dashboard-preview-body">
      {draft.photo && <img className="dashboard-preview-avatar" src={draft.photo} alt=""/>}
      <p className="dashboard-preview-title">{draft.title}</p>
      {draft.bio && <p>{draft.bio}</p>}
      <div className="dashboard-preview-tags">{draft.skills.slice(0, 6).map((skill) => <span key={skill}>{skill}</span>)}</div>
      {site && <small dir="ltr"><bdi>{site.name}</bdi></small>}
    </div>
    <footer>
      <p className="muted">{tr('هذه معاينة للمسودة فقط. إرسالها ينشئ لقطة مراجعة مستقلة ولا ينشرها.', 'This previews only your draft. Submitting creates an independent review snapshot and does not publish it.')}</p>
      <div>
        <button type="button" className="button button--quiet" onClick={onClose}>{tr('متابعة التحرير', 'Keep editing')}</button>
        <button type="button" className="button" disabled={submitting} onClick={onSubmit}>{submitting ? <RefreshCw className="spin" size={16}/> : <FileCheck2 size={16}/>} {tr('إرسال للمراجعة', 'Submit for review')}</button>
      </div>
    </footer>
  </dialog>;
}

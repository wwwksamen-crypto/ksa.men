import { IdentityView, BrandIcon } from './Personal';
import { VisibilityControls } from './VisibilityControls';
import { itemText as profileItemText, list as profileList, mediaSource, socialLink, youtubeLink } from '../../shared/profile-content';
import { profileItemIds, reconcileItemIds, sanitizeProfile, withVisibility, type ItemIds, type VisibilityPolicy } from '../../shared/profile-visibility';
import { useCallback, useEffect, useMemo, useRef, useState, useId, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
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
  Mic,
  MicOff,
  PanelTop,
  PencilLine,
  Plus,
  QrCode,
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
import QRCode from 'qrcode';
import { api, useApp } from './lib';
import './dashboard.css';
import { publicationLabel } from './publication';
import { EditorRowKeys, appendImage, safeLink } from './editor-state';

type Tab = 'editor' | 'wallet' | 'services' | 'messages' | 'subscription' | 'settings';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type UploadPurpose = 'photo' | 'cover' | 'skill' | 'work';

export type ResumeItem = {
  title: string;
  organization: string;
  start: string;
  end: string;
  description: string;
};

type Social = { label: string; url: string };
type CustomButton = { label: string; url: string };
type SkillRadar = { human: string[]; scientific: string[]; professional: string[] };
export type ProfileDraft = {
  name: string;
  title: string;
  bio: string;
  email: string;
  phone: string;
  whatsapp: string;
  city: string;
  country: string;
  photo: string;
  avatarMode: 'photo' | 'monogram';
  cover: string;
  youtube: string;
  experience: ResumeItem[];
  education: ResumeItem[];
  training: ResumeItem[];
  skills: Array<string | ResumeItem>;
  memberships: Array<string | ResumeItem>;
  languages: Array<string | ResumeItem>;
  hobbies: Array<string | ResumeItem>;
  achievements: Array<string | ResumeItem>;
  timeline: ResumeItem[];
  skillRadar: SkillRadar;
  blog: string;
  notes: string;
  skillImages: string[];
  workImages: string[];
  socials: Social[];
  buttons: CustomButton[];
  hidden: string[];
  hiddenItems: string[];
  itemIds: ItemIds;
  searchable: boolean;
  allowContact: boolean;
  translations?: { ar?: Partial<ProfileDraft>; en?: Partial<ProfileDraft> };
};

type Site = {
  visibility?: VisibilityPolicy;
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
  reviews?: Record<string, unknown>[];
  wallet?: { balance?: number; [key: string]: unknown };
  ledger?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  subscriptionRequests?: Record<string, unknown>[];
  services?: Service[];
  notifications?: Notification[];
  user?: Record<string, unknown>;
  analytics?: Record<string, unknown> | unknown[];
  quickLinks?: QuickLink[];
  preferences?: MemberPreferences;
  loyalty?: LoyaltyData;
  [key: string]: unknown;
};

type NameAvailability = { name: string; valid: boolean; available: boolean; reason?: string | null; suggestions?: string[] };
type NameReservation = { name: string; site: Site; createdAt: number };
type WalletOperation = 'transfer';
type LoyaltyOperation = 'daily' | 'preferences' | 'competition';
type MemberPreferences = {
  ageBand: 'student' | 'early_career' | 'established' | 'expert' | 'prefer_not_to_say';
  seasonalThemeEnabled: boolean;
  seasonalNoticesEnabled: boolean;
  badgesEnabled: boolean;
  updatedAt?: number;
};
type DailyChallenge = { id: string; kind: 'memory' | 'focus' | 'speed'; title: string; prompt: string; choices: string[]; rewardPoints: number };
type DailyActivity = { completed: boolean; correct?: boolean; rewardPoints?: number; badge?: string; completedAt?: number; kind?: string; challenge?: DailyChallenge };
type CompetitionEntry = { id: string; status: 'entered' | 'winner' | 'not_selected'; createdAt?: number; decidedAt?: number | null };
type LoyaltyCompetition = { key: string; title: string; terms: string; endsAt: number; url?: string; entry?: CompetitionEntry | null };
type LoyaltyCommunity = { kind: 'telegram' | 'whatsapp' | 'youtube' | 'promotion'; label: string; url: string };
type LoyaltyData = { daily?: DailyActivity; competition?: LoyaltyCompetition | null; communities?: LoyaltyCommunity[] };
const defaultMemberPreferences: MemberPreferences = { ageBand: 'prefer_not_to_say', seasonalThemeEnabled: true, seasonalNoticesEnabled: false, badgesEnabled: true };

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
type SavedImage = UploadResult & { purpose: 'skill' | 'work'; createdAt: number };
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
  { key: 'wallet', ar: 'رصيد النقاط', en: 'Professional points', icon: WalletCards },
  { key: 'services', ar: 'الخدمات', en: 'Services', icon: Sparkles },
  { key: 'messages', ar: 'الرسائل', en: 'Messages', icon: MessageCircle },
  { key: 'subscription', ar: 'العضوية', en: 'Membership', icon: CreditCard },
  { key: 'settings', ar: 'الإعدادات', en: 'Settings', icon: Settings2 },
];

const editorSections = [
  ['identity', 'الهوية الأساسية', 'Core identity'],
  ['bio', 'النبذة', 'Introduction'],
  ['contact', 'التواصل والموقع', 'Contact and location'],
  ['experience', 'الخبرات', 'Experience'],
  ['education', 'التعليم', 'Education'],
  ['training', 'التدريب', 'Training'],
  ['skills', 'المهارات والرادار', 'Skills and radar'],
  ['memberships', 'العضويات', 'Memberships'],
  ['languages', 'اللغات', 'Languages'],
  ['hobbies', 'الهوايات', 'Hobbies'],
  ['achievements', 'الإنجازات والمحطات', 'Achievements and milestones'],
  ['skillImages', 'إثبات المهارات', 'Skill evidence'],
  ['workImages', 'نماذج الأعمال', 'Work samples'],
  ['youtube', 'الفيديو التعريفي', 'Introduction video'],
  ['socials', 'الروابط الاجتماعية', 'Social links'],
  ['buttons', 'الأزرار المخصصة', 'Custom buttons'],
  ['blog', 'المدونة', 'Journal'],
  ['notes', 'ملاحظات خاصة', 'Private notes'],
  ['privacy', 'الخصوصية والظهور', 'Privacy and discovery'],
] as const;

type EditorSection = (typeof editorSections)[number][0];

const editorGroups: Array<{ key: string; ar: string; en: string; steps: EditorSection[] }> = [
  { key: 'identity', ar: 'الهوية', en: 'Identity', steps: ['identity', 'bio', 'contact'] },
  { key: 'journey', ar: 'المسيرة', en: 'Journey', steps: ['experience', 'education', 'training', 'achievements'] },
  { key: 'expertise', ar: 'الخبرات', en: 'Expertise', steps: ['skills', 'memberships', 'languages', 'hobbies'] },
  { key: 'showcase', ar: 'العرض', en: 'Showcase', steps: ['skillImages', 'workImages', 'youtube', 'socials', 'buttons', 'blog', 'notes'] },
  { key: 'control', ar: 'التحكم', en: 'Control', steps: ['privacy'] },
];

const editorSectionMap = Object.fromEntries(editorSections.map(([key, ar, en]) => [key, { ar, en }])) as Record<EditorSection, { ar: string; en: string }>;
const editorSectionIcons: Record<EditorSection, typeof UserRound> = {
  identity: UserRound, bio: PencilLine, contact: Mail, experience: FileText, education: BookOpen, training: BadgeCheck, achievements: Sparkles,
  skills: Settings2, memberships: UsersRound, languages: Languages, hobbies: Sparkles, skillImages: ImagePlus, workImages: ImagePlus,
  youtube: Youtube, socials: Link2, buttons: PanelTop, blog: BookOpen, notes: FileText, privacy: ShieldCheck,
};
function EditorSectionIcon({ section }: { section: EditorSection }) { const Icon = editorSectionIcons[section]; return <Icon size={16} strokeWidth={1.8} aria-hidden="true"/>; }

const notificationSoundStorageKey = 'ksa-men:dashboard-notification-sound';
type AudioContextConstructor = new () => AudioContext;
const blankItem = (): ResumeItem => ({ title: '', organization: '', start: '', end: '', description: '' });
const DEFAULT_PROFILE_IMAGE = '/assets/logo-emblem.webp';
const DEFAULT_COVER_IMAGE = '/assets/cover-1600.webp';
const emptyDraft = (): ProfileDraft => ({
  name: '', title: '', bio: '', email: '', phone: '', whatsapp: '', city: '', country: 'المملكة العربية السعودية',
  photo: DEFAULT_PROFILE_IMAGE, avatarMode: 'photo', cover: DEFAULT_COVER_IMAGE, youtube: '', experience: [], education: [], training: [], skills: [], memberships: [], languages: [],
  hobbies: [], achievements: [], timeline: [], skillRadar: { human: [], scientific: [], professional: [] }, blog: '', notes: '', skillImages: [], workImages: [], socials: [], buttons: [], hidden: [], hiddenItems: [], itemIds: {},
  searchable: true, allowContact: true,
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
export function parseDraft(source: unknown): ProfileDraft {
  let raw: Record<string, unknown> = {};
  try { raw = typeof source === 'string' ? JSON.parse(source) as Record<string, unknown> : (source ?? {}) as Record<string, unknown>; } catch { raw = {}; }
  const toResume = (item: unknown): ResumeItem => {
    if (typeof item === 'string') return { ...blankItem(), title: item };
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { title: asText(entry.title) || asText(entry.name) || asText(entry.role) || asText(entry.label) || asText(entry.language) || asText(entry.value), organization: asText(entry.organization) || asText(entry.institution), start: asText(entry.start) || asText(entry.date), end: asText(entry.end), description: asText(entry.description) || asText(entry.level) || asText(entry.proficiency) };
  };
  const normalizeStructured = (value: unknown): ResumeItem[] => profileList(value).map(toResume);
  const normalizeStrings = (value: unknown): string[] => profileList(value).filter((item): item is string => typeof item === 'string');
  const normalizeTextItems = (value: unknown): Array<string | ResumeItem> => profileList(value).map((item) => typeof item === 'string' ? item : toResume(item));
  const normalizeLinks = (value: unknown): Social[] => profileList(value).map((item) => typeof item === 'string' ? { label: '', url: item } : { label: asText((item as Social)?.label) || asText((item as { name?: string })?.name), url: asText((item as Social)?.url) || asText((item as { href?: string })?.href) });
  const profile: ProfileDraft = {
    ...emptyDraft(),
    ...Object.fromEntries(Object.keys(emptyDraft()).map((key) => [key, raw[key] ?? (emptyDraft() as unknown as Record<string, unknown>)[key]])),
    name: asText(raw.name), title: asText(raw.title), bio: asText(raw.bio), email: asText(raw.email), phone: asText(raw.phone), whatsapp: asText(raw.whatsapp),
    city: asText(raw.city), country: asText(raw.country) || 'المملكة العربية السعودية', photo: asText(raw.photo) || DEFAULT_PROFILE_IMAGE, avatarMode: raw.avatarMode === 'monogram' ? 'monogram' : 'photo', cover: asText(raw.cover) || DEFAULT_COVER_IMAGE, youtube: asText(raw.youtube), blog: asText(raw.blog), notes: asText(raw.notes),
    experience: normalizeStructured(raw.experience), education: normalizeStructured(raw.education), training: normalizeStructured(raw.training), timeline: normalizeStructured(raw.timeline),
    skills: normalizeTextItems(raw.skills), memberships: normalizeTextItems(raw.memberships), languages: normalizeTextItems(raw.languages), hobbies: normalizeTextItems(raw.hobbies), achievements: normalizeTextItems(raw.achievements),
    skillRadar: {
      human: profileList((raw.skillRadar as Record<string, unknown> | undefined)?.human).map(profileItemText),
      scientific: profileList((raw.skillRadar as Record<string, unknown> | undefined)?.scientific).map(profileItemText),
      professional: profileList((raw.skillRadar as Record<string, unknown> | undefined)?.professional).map(profileItemText),
    },
    skillImages: profileList(raw.skillImages).map(mediaSource).filter(Boolean).slice(0, 3), workImages: profileList(raw.workImages).map(mediaSource).filter(Boolean).slice(0, 4), hidden: normalizeStrings(raw.hidden), hiddenItems: normalizeStrings(raw.hiddenItems),
    socials: normalizeLinks(raw.socials), buttons: normalizeLinks(raw.buttons).slice(0, 3), searchable: asBool(raw.searchable, true), allowContact: asBool(raw.allowContact, true),
    translations: raw.translations as ProfileDraft['translations'],
  };
  profile.itemIds = profileItemIds(raw);
  return profile;
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
  const status = Number((error as { status?: number } | null)?.status || 0);
  return status >= 500 || status === 408 || error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) || (error instanceof Error && /(?:failed to fetch|network(?:error)?|load failed)/i.test(error.message));
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
  const [visibilityPolicy, setVisibilityPolicy] = useState<VisibilityPolicy | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const visibilityBusyRef = useRef(false);
  const visibilityRef = useRef<VisibilityPolicy | null>(null);
  visibilityRef.current = visibilityPolicy;
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
  const [quickLink, setQuickLink] = useState<QuickLink | null>(null);
  const [transferForm, setTransferForm] = useState({ recipient: new URLSearchParams(location.search).get('recipient')||'', amount: '' });
  const [membershipNote, setMembershipNote] = useState('');
  const [membershipAction, setMembershipAction] = useState<'trial_extension' | 'annual_contact' | ''>('');
  const [translationConsent, setTranslationConsent] = useState(false);
  const [translationTarget, setTranslationTarget] = useState<TranslationTarget>('en');
  const [lockForm, setLockForm] = useState({ enabled: false, password: '', message: '' });
  const [pin, setPinValue] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [deletionAction, setDeletionAction] = useState<'archive'|'schedule'|'destroy'>('archive');
  const [deletionSchedule, setDeletionSchedule] = useState('');
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
  const [loyaltyOperation, setLoyaltyOperation] = useState<LoyaltyOperation | ''>('');
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => {
    try { return window.localStorage.getItem(notificationSoundStorageKey) === 'on'; } catch { return false; }
  });

  const [savedImages, setSavedImages] = useState<SavedImage[]>([]);
  const [openingSite, setOpeningSite] = useState(false);
  const [saveError, setSaveError] = useState('');
  const openingSiteRef = useRef(false);
  const uploadSiteRef = useRef<string | null>(null);
  const flushSaveRef = useRef<(quiet?: boolean, flush?: boolean) => Promise<boolean>>(async () => false);
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
  const editorCardRef = useRef<HTMLDetailsElement | null>(null);
  const nameCheckSequenceRef = useRef(0);

  const tr = useCallback((ar: string, en: string) => t(ar, en), [t]);
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  const normalizedNameCandidate = nameCandidate.trim().toLowerCase();
  const localNameCandidateValid = validNameLabel(normalizedNameCandidate);
  const selectEditorSection = useCallback((section: EditorSection) => {
    setEditorSection(section);
    window.setTimeout(() => {
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      editorCardRef.current?.scrollIntoView({ behavior, block: 'start' });
    }, 0);
  }, []);

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
    if (!siteIdRef.current) setLoading(true);
    setLoadError('');
    try {
      const data = await api<DashboardData>(`/api/dashboard?lang=${lang}`);
      observeNotifications(asArray<Notification>(data.notifications));
      setDashboard(data);
      const receivedServices = asArray<Service>(data.services);
      if (receivedServices.length) setServices(receivedServices);
      const candidates = asArray<Site>(data.sites);
      const explicitSite = requestedSiteId();
      // A delegated editor link is always resolved by the server route; it is never fabricated from URL data.
      if (!siteIdRef.current && explicitSite) await openSite({ id: explicitSite });
      else if (!siteIdRef.current && candidates[0]) await openSite(candidates[0]);
      else {
        const current = candidates.find((site) => site.id === siteIdRef.current);
        if (current) setActiveSite((existing) => existing ? { ...existing, ...current } : existing);
      }
    } catch (error) {
      if (!siteIdRef.current) setLoadError(errorMessage(error));
      else notify(errorMessage(error));
    } finally {
      setLoading(false);
    }
  // openSite is stable enough for initial fetch; its declaration is hoisted in this closure at execution time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, observeNotifications]);

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

  const refreshSavedImages = async (siteId: string) => {
    try {
      const response = await api<{ siteId: string; items: SavedImage[] }>(`/api/sites/${encodeURIComponent(siteId)}/media`);
      if (siteIdRef.current === siteId && response.siteId === siteId) setSavedImages(response.items);
    } catch { /* Restoration is optional; a failed listing must never change a draft. */ }
  };
  const openSite = useCallback(async (summary: Site) => {
    if (openingSiteRef.current || visibilityBusyRef.current || summary.id === siteIdRef.current) return;
    if (uploadSiteRef.current) { notify(tr('انتظر تثبيت الصورة قبل تبديل الموقع.', 'Wait until your image is saved before switching sites.')); return; }
    openingSiteRef.current = true;
    setOpeningSite(true);
    try {
      if (siteIdRef.current && !(await flushSaveRef.current(true, true))) return;
      const response = await api<Site | { site?: Site }>(`/api/sites/${encodeURIComponent(summary.id)}`);
      const site = ('site' in response && response.site ? response.site : response) as Site;
      // Never switch to a dashboard summary or clear the previous draft after a failed read.
      if (site.id !== summary.id || site.draft === undefined) throw new Error(tr('تعذر فتح الموقع. بقي عملك في مكانه.', 'Could not open the site. Your work is still here.'));
      if (uploadSiteRef.current) { notify(tr('انتظر تثبيت الصورة قبل تبديل الموقع.', 'Wait until your image is saved before switching sites.')); return; }
      if (dirtyRef.current && !(await flushSaveRef.current(true, true))) return;
      siteIdRef.current = site.id;
      setActiveSite(site);
      setLockForm({ enabled: Boolean(site.lock?.enabled), password: '', message: asText(site.lock?.message) });
      const nextDraft = parseDraft(site.draft);
      setVisibilityPolicy(site.visibility ?? { hidden: nextDraft.hidden, hiddenItems: nextDraft.hiddenItems, visible: true, listed: nextDraft.searchable, indexable: true, version: 0 });
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      versionRef.current = Number(site.draft_version ?? site.version ?? 0);
      revisionRef.current = 0;
      dirtyRef.current = false;
      setSaveState('saved');
      setSaveError('');
      setSavedImages([]);
      void refreshSavedImages(site.id);
    } catch (error) { notify(errorMessage(error)); }
    finally { openingSiteRef.current = false; setOpeningSite(false); }
  }, [notify, tr]);

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
    if (tab === 'editor') {
      window.setTimeout(() => {
        const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        (editorCardRef.current ?? dashboardInteractiveRef.current)?.scrollIntoView({ behavior, block: 'start' });
      }, 0);
    }
  };

  const changeDraft = useCallback((patch: Partial<ProfileDraft> | ((current: ProfileDraft) => ProfileDraft)) => {
    const current = draftRef.current;
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    next.itemIds = reconcileItemIds(current, next);
    draftRef.current = next;
    revisionRef.current += 1;
    dirtyRef.current = true;
    setDraft(next);
    setSaveError('');
    setSaveState('unsaved');
  }, []);

  const saveVisibility = async (patch: Partial<Omit<VisibilityPolicy, 'version'>>) => {
    const siteId = siteIdRef.current, policy = visibilityRef.current;
    if (!siteId || !policy || visibilityBusyRef.current) return;
    const { aliases: _readOnlyAliases, ...editablePolicy } = policy;
    visibilityBusyRef.current = true; setVisibilityBusy(true);
    try {
      const result = await api<{ siteId: string; policy: VisibilityPolicy }>(`/api/sites/${encodeURIComponent(siteId)}/visibility`, { method: 'PUT', body: JSON.stringify({ ...editablePolicy, ...patch }) });
      if (siteIdRef.current !== siteId || result.siteId !== siteId) return;
      visibilityRef.current = result.policy; setVisibilityPolicy(result.policy);
      changeDraft({ hidden: result.policy.hidden, hiddenItems: result.policy.hiddenItems, searchable: result.policy.listed, allowContact: !result.policy.hidden.includes('allowContact') });
      notify(tr('حُفظ اختيار الظهور.', 'Visibility choice saved.'));
    } catch (error) {
      if (Number((error as { status?: number })?.status) === 409) {
        try { const result = await api<{ siteId: string; policy: VisibilityPolicy }>(`/api/sites/${encodeURIComponent(siteId)}/visibility`); if (siteIdRef.current === siteId && result.siteId === siteId) { visibilityRef.current = result.policy; setVisibilityPolicy(result.policy); } } catch { /* Keep the current choice unchanged on a network failure. */ }
      }
      notify(errorMessage(error));
    } finally { visibilityBusyRef.current = false; setVisibilityBusy(false); }
  };
  const saveDraft = useCallback(async (quiet = false, flush = false): Promise<boolean> => {
    const siteId = siteIdRef.current;
    if (!siteId) return false;
    for (let round = 0; round < (flush ? 12 : 1); round++) {
      for (let wait = 0; savingRef.current && wait < 240; wait++) await new Promise(resolve => window.setTimeout(resolve, 50));
      if (savingRef.current || siteIdRef.current !== siteId) return false;
      if (!dirtyRef.current) return true;
      const revision = revisionRef.current;
      const version = versionRef.current;
      const outgoing = draftRef.current;
      savingRef.current = true;
      setSaveState('saving');
      try {
        const response = await api<Site | { site?: Site; version?: number; draft_version?: number }>(`/api/sites/${encodeURIComponent(siteId)}/draft`, {
          method: 'PUT', body: JSON.stringify({ draft: outgoing, version }),
        });
        if (siteIdRef.current !== siteId) return false;
        const saved = ('site' in response && response.site ? response.site : response) as Site;
        if (saved.id && saved.id !== siteId) throw new Error(tr('تعذر تأكيد الحفظ. احتفظنا بعملك هنا.', 'Could not confirm saving. Your work is still here.'));
        const receivedVersion = Number(saved.draft_version ?? saved.version ?? version + 1);
        if (!Number.isSafeInteger(receivedVersion) || receivedVersion <= version) throw new Error(tr('تعذر تأكيد الحفظ. حاول مجدداً.', 'Could not confirm saving. Try again.'));
        versionRef.current = receivedVersion;
        // Acknowledgement changes metadata only. Never trim/replace a mounted text input.
        setActiveSite((current) => current?.id === siteId ? { ...current, draft_version: receivedVersion, status: saved.status ?? current.status } : current);
        dirtyRef.current = revisionRef.current !== revision;
        setSaveError('');
        setSaveState(dirtyRef.current ? 'unsaved' : 'saved');
        if (!quiet && !dirtyRef.current) notify(tr('تم حفظ عملك.', 'Your work is saved.'));
      } catch (error) {
        if (siteIdRef.current === siteId) {
          const message = (error as { status?: number })?.status === 409
            ? tr('هناك نسخة أحدث على جهاز آخر. بقيت تعديلاتك هنا؛ لا تغلق الصفحة وتواصل معنا للمساعدة.', 'A newer copy exists on another device. Your edits remain here; keep this page open and contact us for help.')
            : tr('لم يكتمل الحفظ. بقي عملك هنا؛ تحقق من الاتصال واضغط حفظ للمحاولة مجدداً.', 'Saving did not finish. Your work is still here; check your connection and press Save to retry.');
          setSaveError(message);
          setSaveState('error');
          if (!quiet) notify(message);
        }
        return false;
      } finally { savingRef.current = false; }
      if (!dirtyRef.current) return true;
    }
    return !flush;
  }, [notify, tr]);
  flushSaveRef.current = saveDraft;

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveDraft(true); }, 3_000);
    return () => window.clearTimeout(timer);
  }, [draft, saveDraft]);
  useEffect(() => () => { siteIdRef.current = null; }, []);
  useEffect(() => {
    const beforeLeave = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !uploadSiteRef.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeLeave);
    return () => window.removeEventListener('beforeunload', beforeLeave);
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => { if (dirtyRef.current) void saveDraft(true); }, 15_000);
    return () => window.clearInterval(interval);
  }, [saveDraft]);

  const submitForReview = async () => {
    if (!activeSite || submittingReview || openingSiteRef.current) return;
    if (uploadSiteRef.current) { notify(tr('نثبّت الصورة أولاً، ثم يمكنك طلب النشر.', 'Let your image finish saving before requesting publication.')); return; }
    const submittedSiteId = siteIdRef.current;
    setSubmittingReview(true);
    try {
      if (!(await saveDraft(true, true)) || dirtyRef.current || siteIdRef.current !== submittedSiteId) return;
      const response = await api<{ review?: { id?: string }; id?: string }>(`/api/sites/${encodeURIComponent(submittedSiteId!)}/submit`, { method: 'POST', body: JSON.stringify({ version: versionRef.current }) });
      setPreviewOpen(false);
      await loadDashboard();
      notify(response.review?.id || response.id ? tr('وصل طلب النشر إلى المشرف.', 'Your publishing request reached the administrator.') : tr('تم استلام طلب المراجعة.', 'Review request received.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setSubmittingReview(false); }
  };

  const compressImage = async (file: File, initialMaxSide = 2200): Promise<File> => {
    if (!file.type.startsWith('image/')) throw new Error(tr('اختر ملف صورة صالحاً.', 'Choose a valid image file.'));
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(tr('تعذر فتح هذه الصورة في متصفحك. اختر نسخة يمكن عرضها ثم أعد المحاولة.', 'This image could not be opened by your browser. Choose a displayable copy and try again.'))); };
      image.src = objectUrl;
    });
    const maxPixels = 16_000_000;
    const originalLongest = Math.max(source.naturalWidth, source.naturalHeight);
    const originalPixels = source.naturalWidth * source.naturalHeight;
    const pixelScale = originalPixels > maxPixels ? Math.sqrt(maxPixels / originalPixels) : 1;
    const baseScale = Math.min(1, initialMaxSide / originalLongest, pixelScale);
    const attempts = [
      { scale: baseScale, quality: .88 },
      { scale: Math.min(baseScale, .82), quality: .82 },
      { scale: Math.min(baseScale, .68), quality: .76 },
    ];
    let best: Blob | null = null;
    for (const attempt of attempts) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * attempt.scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * attempt.scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(tr('تعذر تجهيز الصورة.', 'Could not prepare the image.'));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(tr('تعذر تحويل الصورة.', 'Could not convert the image.'))), 'image/webp', attempt.quality));
      best = blob;
      if (blob.size <= 3_500_000) break;
    }
    if (!best) throw new Error(tr('تعذر تحويل الصورة.', 'Could not convert the image.'));
    return new File([best], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' });
  };

  const attachImage = async (siteId: string, purpose: UploadPurpose, image: UploadResult) => {
    if (siteIdRef.current !== siteId) return false;
    changeDraft((current) => {
      if (purpose === 'photo' || purpose === 'cover') return { ...current, [purpose]: image.url };
      const key = purpose === 'skill' ? 'skillImages' : 'workImages';
      return { ...current, [key]: appendImage(current[key], image.url, purpose === 'skill' ? 3 : 4) };
    });
    return saveDraft(true, true);
  };
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploadSiteRef.current) return;
    const siteId = siteIdRef.current;
    if (!siteId) { notify(tr('اختر موقعك أولاً.', 'Choose your site first.')); return; }
    uploadSiteRef.current = siteId;
    setUploading(purpose);
    try {
      if (!file.type.startsWith('image/')) throw new Error(tr('اختر صورة صالحة من جهازك.', 'Choose a valid image from your device.'));
      const compressed = await compressImage(file, purpose === 'cover' ? 2600 : 1800);
      const body = new FormData();
      body.append('file', compressed); body.append('purpose', purpose); body.append('siteId', siteId);
      const result = await api<UploadResult>('/api/upload', { method: 'POST', body });
      if (!result?.id || !result?.url) throw new Error(tr('تعذر تأكيد رفع الصورة.', 'Could not confirm the image upload.'));
      if (siteIdRef.current !== siteId) return;
      if (await attachImage(siteId, purpose, result)) notify(tr('تمت إضافة الصورة وحفظها.', 'Your image was added and saved.'));
      else notify(tr('وصلت الصورة، لكن لم يكتمل حفظها في الملف. اضغط حفظ للمحاولة مجدداً.', 'Your image arrived, but its profile link was not saved. Press Save to retry.'));
    } catch (error) { notify(errorMessage(error) === 'IMAGE_LIST_FULL' ? tr('اكتمل عدد الصور. يمكنك اختيارها من صورك المحفوظة بعد إزالة صورة.', 'The image list is full. Remove an image to choose another from your saved images.') : errorMessage(error)); }
    finally { uploadSiteRef.current = null; setUploading(''); void refreshSavedImages(siteId); }
  };
  const restoreImage = async (image: SavedImage) => {
    const siteId = siteIdRef.current;
    if (!siteId || uploadSiteRef.current || !savedImages.some((item) => item.id === image.id)) return;
    uploadSiteRef.current = siteId;
    setUploading(image.purpose);
    try {
      if (await attachImage(siteId, image.purpose, image)) notify(tr('تمت استعادة الصورة وحفظها في ملفك.', 'Your image was restored and saved to your profile.'));
    } catch (error) { notify(errorMessage(error) === 'IMAGE_LIST_FULL' ? tr('أزل صورة من القائمة أولاً لتتمكن من استعادة أخرى.', 'Remove an image first to restore another.'):errorMessage(error)); }
    finally { uploadSiteRef.current = null; setUploading(''); }
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

  const copyReferral = async () => {
    const link = `${window.location.origin}/auth?ref=C${user?.id ?? ''}`;
    try { await navigator.clipboard.writeText(link); notify(tr('تم نسخ رابط الإحالة.', 'Referral link copied.')); }
    catch { notify(link); }
  };

  const translateDraft = async () => {
    if (!activeSite || !translationConsent || uploadSiteRef.current) return;
    const translationSiteId = siteIdRef.current;
    if (!(await saveDraft(true, true))) return;
    try {
      const response = await api<{ draft?: ProfileDraft; site?: Site; version?: number; draft_version?: number }>('/api/translate', {
        method: 'POST',
        body: JSON.stringify({ siteId: translationSiteId, target: translationTarget, consent: true }),
      });
      if (siteIdRef.current !== translationSiteId) return;
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

  const requestMembership = async (kind: 'trial_extension' | 'annual_contact') => {
    if (membershipAction) return;
    setMembershipAction(kind);
    try {
      await api('/api/subscription-requests', { method: 'POST', body: JSON.stringify({ kind, note: membershipNote.trim() }) });
      setMembershipNote('');
      await loadDashboard();
      notify(kind === 'trial_extension' ? tr('تم إرسال طلب تمديد الفترة المجانية.', 'Your free-period extension request was sent.') : tr('تم إرسال طلب التواصل للاشتراك السنوي.', 'Your annual membership contact request was sent.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setMembershipAction(''); }
  };

  const updateLoyaltyPreferences = async (patch: Partial<MemberPreferences>) => {
    if (loyaltyOperation === 'preferences') return;
    setLoyaltyOperation('preferences');
    try {
      const response = await api<{ preferences: MemberPreferences }>('/api/loyalty/preferences', { method: 'PUT', body: JSON.stringify(patch) });
      const next = response.preferences;
      setDashboard((current) => current ? { ...current, preferences: next } : current);
      if ('seasonalThemeEnabled' in patch) {
        try { window.localStorage.setItem('ksa-men:seasonal-theme', next.seasonalThemeEnabled ? 'on' : 'off'); } catch { /* This visual preference remains optional. */ }
        window.dispatchEvent(new CustomEvent('ksa:seasonal-theme', { detail: next.seasonalThemeEnabled }));
      }
      notify(tr('تم حفظ تفضيلات ركنك الخاص.', 'Your private-space preferences were saved.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setLoyaltyOperation(''); }
  };

  const submitDailyChallenge = async (challenge: DailyChallenge, answer: string) => {
    if (!answer || loyaltyOperation === 'daily') return;
    setLoyaltyOperation('daily');
    try {
      const response = await api<{ loyalty?: LoyaltyData; alreadySubmitted?: boolean }>('/api/loyalty/daily', {
        method: 'POST', body: JSON.stringify({ challengeId: challenge.id, answer, lang }),
      });
      if (response.loyalty) setDashboard((current) => current ? { ...current, loyalty: response.loyalty } : current);
      notify(response.alreadySubmitted
        ? tr('اكتمل تمرين اليوم مسبقاً.', 'Today’s exercise was already completed.')
        : tr('تم تسجيل نتيجة تمرين اليوم.', 'Today’s exercise result was recorded.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setLoyaltyOperation(''); }
  };

  const enterCompetition = async () => {
    if (loyaltyOperation === 'competition') return;
    setLoyaltyOperation('competition');
    try {
      const response = await api<{ competition?: LoyaltyCompetition; alreadyEntered?: boolean }>('/api/loyalty/competition/enter', { method: 'POST', body: JSON.stringify({}) });
      if (response.competition) setDashboard((current) => current ? { ...current, loyalty: { ...current.loyalty, competition: response.competition } } : current);
      notify(response.alreadyEntered ? tr('مشاركتك مسجلة بالفعل.', 'Your entry is already recorded.') : tr('تم تسجيل مشاركتك في المسابقة.', 'Your competition entry was recorded.'));
    } catch (error) { notify(errorMessage(error)); }
    finally { setLoyaltyOperation(''); }
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

  const hidePublicPresence = async () => {
    if (!window.confirm(tr('سيُخفى موقعك وروابطك العامة فوراً. ستبقى بيانات حسابك محفوظة حتى تختار إجراءً آخر. هل تريد المتابعة؟', 'Your public site and links will be hidden immediately. Account data remains until you choose another action. Continue?'))) return;
    try { await api('/api/privacy/hide', { method: 'POST' }); await loadDashboard(); notify(tr('تم إخفاء حضورك العام فوراً.', 'Your public presence is now hidden.')); }
    catch (error) { notify(errorMessage(error)); }
  };
  const requestDeletion = async () => {
    if (!deletionConfirmed) return;
    const scheduledFor = deletionAction === 'schedule' && deletionSchedule ? Math.floor(new Date(deletionSchedule).getTime() / 1000) : undefined;
    if (deletionAction === 'schedule' && (!scheduledFor || scheduledFor <= Math.floor(Date.now() / 1000))) { notify(tr('اختر تاريخاً مستقبلياً للإتلاف المجدول.', 'Choose a future time for scheduled erasure.')); return; }
    const label = deletionAction === 'archive' ? tr('الأرشفة', 'archive') : deletionAction === 'schedule' ? tr('الإتلاف المجدول', 'scheduled erasure') : tr('الإتلاف الفوري', 'immediate erasure');
    if (!window.confirm(tr(`سيبدأ إجراء ${label} بعد التحقق الحديث من البريد. لا يمكن التراجع عن الإتلاف بعد تنفيذه. هل تريد المتابعة؟`, `${label} starts after fresh email verification. Erasure cannot be reversed once executed. Continue?`))) return;
    try { const result = await api<{ status?: string }>('/api/deletion-request', { method: 'POST', body: JSON.stringify({ action: deletionAction, scheduledFor, reason: deleteReason.trim(), affirmation: true }) }); setDeletionConfirmed(false); setDeleteReason(''); notify(result.status === 'blocked' ? tr('أُخفي حضورك العام وسُجل الطلب، لكن توجد سجلات يجب الاحتفاظ بها نظامياً حالياً.', 'Your public presence is hidden and the request is recorded, but retained records currently block erasure.') : tr('تم تسجيل إجراء الخصوصية وحُجب موقعك العام فوراً.', 'Your privacy action is recorded and your public site is hidden immediately.')); }
    catch (error) { notify(errorMessage(error)); }
  };

  const markNotificationRead = async (notification: Notification) => {
    if (notification.read_at) return;
    try { await api(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', body: JSON.stringify({}) }); setDashboard((current) => current ? { ...current, notifications: asArray<Notification>(current.notifications).map((item) => item.id === notification.id ? { ...item, read_at: Math.floor(Date.now() / 1000) } : item) } : current); }
    catch (error) { notify(errorMessage(error)); }
  };

  const balance = Number(dashboard?.wallet?.balance ?? (user as { balance?: number }).balance ?? 0);
  const memberPreferences = dashboard?.preferences ?? defaultMemberPreferences;
  const loyalty = dashboard?.loyalty;
  const siteAnalytics = (activeSite?.analytics ?? (dashboard?.analytics && activeSite ? (dashboard.analytics as Record<string, unknown>)[activeSite.id] : null)) as Record<string, unknown> | unknown[] | null;
  const analyticsEntries = siteAnalytics && typeof siteAnalytics === 'object' && !Array.isArray(siteAnalytics) ? Object.entries(siteAnalytics) : [];
  const reviews = asArray<Record<string, unknown>>(dashboard?.reviews).filter((review) => review.kind !== 'redirect' && (!activeSite || review.site_id === activeSite.id));
  const notifications = asArray<Notification>(dashboard?.notifications);
  const conversations = asArray<Conversation>(messagesData?.conversations);
  const requests = asArray<Record<string, unknown>>(messagesData?.requests);
  const existingQuickLinks = asArray<QuickLink>(dashboard?.quickLinks);
  const selectedTranslation = draft.translations?.[translationTarget];
  const activeSiteUrl = publicSiteUrl(activeSite?.name);
  const subscriptionRequests = asArray<Record<string, unknown>>(dashboard?.subscriptionRequests);
  const initialReservationFlow = !activeSite && activeTab === 'editor';
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
            <button className="dashboard-site-switch" title={activeSite?.status === 'published' ? tr('فتح الموقع المنشور', 'Open published site') : tr('معاينة الهوية قبل النشر', 'Preview before publication')} onClick={() => { if (activeSite?.status === 'published' && activeSiteUrl) window.open(activeSiteUrl, '_blank', 'noopener'); else setPreviewOpen(true); }} disabled={!activeSiteUrl}>
              <Globe2 size={16} /><span dir="ltr"><bdi>{activeSiteUrl ? activeSiteUrl.replace(/^https:\/\//, '') : tr('لا يوجد اسم محجوز', 'No reserved name')}</bdi></span><ExternalLink size={14} />
            </button>
            <span className="dashboard-status">{publicationLabel(activeSite?.status, lang)}</span>
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
        {!activeSite ? <>
          <InitialNameReservation
          candidate={nameCandidate}
          availability={nameAvailability?.name === normalizedNameCandidate ? nameAvailability : null}
          checking={checkingName}
          reserving={reservingName}
          locallyValid={localNameCandidateValid}
          onChange={(value) => setNameCandidate(value.toLowerCase())}
          onReserve={reserveInitialName}
          tr={tr}
        /></> : <>
        <div className="dashboard-editor-top card">
          <div className="dashboard-site-row">
            <div>
              <p className="dashboard-kicker"><PanelTop size={15}/>{isScopedProxySite ? tr('تحرير مفوّض ضمن صلاحيات حسابك', 'Delegated editing within your account scope') : tr('محرر الهوية الرقمية', 'Digital identity editor')}</p>
              <h2>{activeSite?.name || tr('اختر موقعاً', 'Select a site')}</h2>
            </div>
            {asArray<Site>(dashboard?.sites).length > 1 && <select className="field" value={activeSite?.id || ''} disabled={openingSite || Boolean(uploading) || submittingReview} onChange={(event) => { const site = asArray<Site>(dashboard?.sites).find((item) => item.id === event.target.value); if (site) void openSite(site); }} aria-label={tr('الموقع الحالي', 'Current site')}>
              {asArray<Site>(dashboard?.sites).map((site) => <option key={site.id} value={site.id}>{site.name || site.id}</option>)}
            </select>}
          </div>
          <div className="dashboard-editor-actions" role="group" aria-label={tr('إجراءات المسودة', 'Draft actions')}>
            <button className="button button--quiet" onClick={() => setPreviewOpen(true)} disabled={!activeSite}><Eye size={17}/>{tr('معاينة', 'Preview')}</button>
            <button className="button" onClick={() => void saveDraft(false, true)} disabled={!activeSite || saveState === 'saving' || saveState === 'saved'}><Save size={17}/>{saveState === 'saving' ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ', 'Save')}</button>
          </div>
          {saveError && <p className="dashboard-error" role="status">{saveError}</p>}
        </div>

          <div className="dashboard-editor-layout">
            <aside className="dashboard-editor-navigation" aria-label={tr('أقسام محرر الهوية', 'Identity editor sections')}>
              {editorGroups.map((group) => <section className={`dashboard-editor-group ${group.steps.includes(editorSection) ? 'is-active' : ''}`} key={group.key}>
                <p className="dashboard-editor-group-label"><span>{tr(group.ar, group.en)}</span><small>{group.steps.filter((step) => step === editorSection).length ? tr('قيد التحرير', 'Editing') : `${group.steps.length} ${tr('خطوات', 'steps')}`}</small></p>
                <div className="dashboard-editor-substeps">
                  {group.steps.map((step) => <button type="button" key={step} className={editorSection === step ? 'is-active' : ''} aria-current={editorSection === step ? 'step' : undefined} onClick={() => selectEditorSection(step)}>
                    <EditorSectionIcon section={step}/><span>{tr(editorSectionMap[step].ar, editorSectionMap[step].en)}</span><ChevronLeft size={15}/>
                  </button>)}
                </div>
              </section>)}
            </aside>
            <details id="identity-editor-section" className="dashboard-edit-card card" ref={editorCardRef} open>
              <summary><span><PencilLine size={16}/>{tr(editorSectionMap[editorSection].ar, editorSectionMap[editorSection].en)}</span><ChevronDown size={18}/></summary>
              <div className="dashboard-edit-card__body" key={`${activeSite.id}-${editorSection}`}>
                <EditorGuide section={editorSection} tr={tr}/>
                {editorSection === 'identity' && <IdentitySection draft={draft} tr={tr} uploading={uploading} onChange={changeDraft} onUpload={uploadImage} lang={lang}/>}
                {editorSection === 'bio' && <TextSection label={tr('النبذة التعريفية', 'Professional biography')} hint={tr('اكتب تعريفاً واضحاً ومهماً لجمهور موقعك.', 'Write a clear, meaningful introduction for your site audience.')} value={draft.bio} multiline onChange={(bio) => changeDraft({ bio })} lang={lang}/>}
                {editorSection === 'contact' && <ContactSection draft={draft} tr={tr} onChange={changeDraft} lang={lang} siteName={activeSite?.name}/>}
                {editorSection === 'experience' && <StructuredList title={tr('الخبرات العملية', 'Work experience')} value={draft.experience} onChange={(experience) => changeDraft({ experience })} tr={tr} lang={lang}/>}
                {editorSection === 'education' && <StructuredList title={tr('المؤهلات التعليمية', 'Education')} value={draft.education} onChange={(education) => changeDraft({ education })} tr={tr} lang={lang}/>}
                {editorSection === 'training' && <StructuredList title={tr('البرامج التدريبية والتطويرية', 'Training and development')} value={draft.training} onChange={(training) => changeDraft({ training })} tr={tr} lang={lang}/>}
                {editorSection === 'skills' && <SkillRadarSection draft={draft} onChange={changeDraft} tr={tr} lang={lang}/>}
                {editorSection === 'memberships' && <StringList title={tr('العضويات المهنية', 'Professional memberships')} value={draft.memberships} onChange={(memberships) => changeDraft({ memberships })} tr={tr} lang={lang}/>}
                {editorSection === 'languages' && <StringList title={tr('اللغات', 'Languages')} value={draft.languages} onChange={(languages) => changeDraft({ languages })} tr={tr} lang={lang}/>}
                {editorSection === 'hobbies' && <StringList title={tr('الاهتمامات والهوايات', 'Interests')} value={draft.hobbies} onChange={(hobbies) => changeDraft({ hobbies })} tr={tr} lang={lang}/>}
                {editorSection === 'achievements' && <MilestonesSection draft={draft} onChange={changeDraft} tr={tr} lang={lang}/>}
                {editorSection === 'skillImages' && <MediaSection savedImages={savedImages} onRestore={(image) => void restoreImage(image)} title={tr('صور لإثبات المهارات', 'Skill evidence images')} hint={tr('اختر صوراً واضحة تمثلك؛ نجهزها تلقائياً للعرض.', 'Choose clear images that represent you; we prepare them for display.')} items={draft.skillImages} max={3} purpose="skill" uploading={uploading} tr={tr} onUpload={uploadImage} onChange={(skillImages) => changeDraft({ skillImages })} />}
                {editorSection === 'workImages' && <MediaSection savedImages={savedImages} onRestore={(image) => void restoreImage(image)} title={tr('نماذج الأعمال', 'Work samples')} hint={tr('اختر صوراً واضحة تمثلك؛ نجهزها تلقائياً للعرض.', 'Choose clear images that represent you; we prepare them for display.')} items={draft.workImages} max={4} purpose="work" uploading={uploading} tr={tr} onUpload={uploadImage} onChange={(workImages) => changeDraft({ workImages })} />}
                {editorSection === 'youtube' && <YoutubeSection value={draft.youtube} onChange={(youtube) => changeDraft({ youtube })} tr={tr} />}
                {editorSection === 'socials' && <LinkList title={tr('الروابط الاجتماعية', 'Social links')} hint={tr('أضف الرابط فقط؛ ستظهر أيقونة المنصة تلقائياً.', 'Just add the URL; its platform icon appears automatically.')} socialOnly value={draft.socials} onChange={(socials) => changeDraft({ socials })} max={12} tr={tr} />}
                {editorSection === 'buttons' && <LinkList title={tr('الأزرار الخارجية', 'External buttons')} hint={tr('حتى 3 أزرار؛ تحقق من الوجهة قبل الحفظ.', 'Up to 3 buttons; verify each destination before saving.')} value={draft.buttons} onChange={(buttons) => changeDraft({ buttons })} max={3} tr={tr} />}
                {editorSection === 'blog' && <TextSection label={tr('المدونة الشخصية', 'Personal journal')} hint={tr('اكتب فقرة أو مقالة مختصرة تريد ظهورها في موقعك.', 'Write a short thought or article you want to appear on your site.')} value={draft.blog} maxLength={12000} multiline onChange={(blog) => changeDraft({ blog })} lang={lang}/>}
                {editorSection === 'notes' && <TextSection label={tr('ملاحظات خاصة', 'Private notes')} hint={tr('ملاحظاتك هنا تبقى داخل المسودة ولا تظهر في موقعك المنشور.', 'These notes stay inside your draft and never appear on your published site.')} value={draft.notes} maxLength={12000} multiline onChange={(notes) => changeDraft({ notes })} lang={lang}/>}
                {editorSection === 'privacy' && visibilityPolicy && <><header className="dashboard-edit-heading"><h2>{tr('اختر ما يظهر', 'Choose what appears')}</h2></header><VisibilityControls profile={draft} policy={visibilityPolicy} onChange={saveVisibility} busy={visibilityBusy} siteOptions/></>}
                {editorSection !== 'privacy' && editorSection !== 'notes' && visibilityPolicy && <details className="dashboard-section-visibility"><summary><Eye size={17}/>{tr('ما يظهر من هذا القسم', 'What appears from this section')}</summary><VisibilityControls profile={draft} policy={visibilityPolicy} onChange={saveVisibility} busy={visibilityBusy} section={editorSection}/></details>}
              </div>
            </details>
          </div>
          <section className="dashboard-review-rail card">
            <div><FileCheck2 size={19}/><div><h3>{tr('المراجعة والنشر', 'Review and publication')}</h3><p className="muted">{tr('الحفظ منفصل عن الإرسال. أنشئ لقطة مراجعة قبل أن يصبح أي تعديل منشوراً.', 'Saving is separate from submission. Create a review snapshot before any edit can be published.')}</p></div></div>
            <div className="dashboard-review-rail__actions"><span className="dashboard-status">{publicationLabel(activeSite.status, lang)}</span><button className="button button--quiet" onClick={() => setPreviewOpen(true)}><Eye size={16}/>{tr('مراجعة وإرسال للنشر', 'Review & submit for publication')}</button></div>
          </section>
          {reviews.length > 0 && <section className="dashboard-review-history card"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('سجل المراجعات', 'Review history')}</h2></div></div>{reviews.slice(0, 5).map((review, index) => <div key={String(review.id ?? index)} className="dashboard-history-row"><span>{String(review.status ?? 'pending')}</span><p>{String(review.reason || tr('بانتظار قرار المراجع.', 'Awaiting reviewer decision.'))}</p><time>{formatDate(Number(review.created_at), locale)}</time></div>)}</section>}
        </>}
      </section>}

      {activeTab === 'wallet' && <WalletPanel balance={balance} ledger={asArray<Record<string, unknown>>(dashboard?.ledger)} transferForm={transferForm} setTransferForm={setTransferForm} onTransfer={doTransfer} onCopyReferral={copyReferral} busyOperation={walletOperation} loyalty={loyalty} loyaltyBusy={loyaltyOperation === 'daily'} competitionBusy={loyaltyOperation === 'competition'} activeSiteUrl={activeSiteUrl} onDailySubmit={submitDailyChallenge} onCompetitionEnter={enterCompetition} locale={locale} tr={tr} notify={notify} />}

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
        <section className="card dashboard-entitlement"><div><p className="dashboard-kicker"><CreditCard size={15}/>{tr('العضوية', 'Membership')}</p><h2>{tr('فترة مجانية ثم عضوية سنوية', 'Free period, then annual membership')}</h2><p className="muted">{tr('تبدأ عضويتك بفترة مجانية مدتها سبعة أيام. يبقى موقعك وبياناته متاحين وفق إعداداتك، وتُرتب العضوية السنوية بتواصل مباشر مع الإدارة.', 'Your membership begins with a seven-day free period. Your site and data remain available under your settings, and annual membership is arranged directly with administration.')}</p></div><dl><div><dt>{tr('نهاية الفترة المجانية', 'Free period ends')}</dt><dd>{formatDate(Number(user?.trial_until), locale)}</dd></div><div><dt>{tr('نهاية الاستحقاق', 'Membership entitlement ends')}</dt><dd>{formatDate(Number(user?.entitlement_until), locale)}</dd></div></dl></section>
        <section className="card dashboard-membership-request"><div className="dashboard-section-heading"><div><MessageCircle size={18}/><h2>{tr('تواصل مع الإدارة', 'Contact administration')}</h2></div></div><p className="muted">{tr('يمكنك طلب تمديد الفترة المجانية أو بدء تواصل بشأن العضوية السنوية، وسيصلك قرار الإدارة على طلبك.', 'You can request a free-period extension or start a conversation about annual membership, and the administration decision will reach you here.')}</p><label><span>{tr('رسالة اختيارية للإدارة', 'Optional note to administration')}</span><textarea className="field" rows={3} maxLength={800} value={membershipNote} onChange={(event) => setMembershipNote(event.target.value)} placeholder={tr('اكتب ما يلزم لمراجعة طلبك.', 'Add anything useful for reviewing your request.')}/></label><div className="dashboard-membership-actions"><button className="button button--quiet" disabled={Boolean(membershipAction)} onClick={() => void requestMembership('trial_extension')}><Clock3 size={16}/>{membershipAction === 'trial_extension' ? tr('جارٍ الإرسال', 'Sending') : tr('طلب تمديد الفترة المجانية', 'Request a free-period extension')}</button><button className="button" disabled={Boolean(membershipAction)} onClick={() => void requestMembership('annual_contact')}><MessageCircle size={16}/>{membershipAction === 'annual_contact' ? tr('جارٍ الإرسال', 'Sending') : tr('طلب تواصل للاشتراك السنوي', 'Request annual membership contact')}</button></div></section>
        {subscriptionRequests.length > 0 && <section className="card"><div className="dashboard-section-heading"><div><Clock3 size={18}/><h2>{tr('متابعة طلبات العضوية', 'Membership request updates')}</h2></div></div><div className="dashboard-request-history">{subscriptionRequests.map((request, index) => <div className="dashboard-history-row" key={String(request.id ?? index)}><span>{request.kind === 'trial_extension' ? tr('تمديد الفترة المجانية', 'Free-period extension') : tr('عضوية سنوية', 'Annual membership')}</span><p>{String(request.admin_reason || request.member_note || tr('قيد مراجعة الإدارة.', 'Awaiting administration review.'))}</p><strong className={`dashboard-status ${String(request.status || '')}`}>{String(request.status || 'pending')}</strong><time>{formatDate(Number(request.decided_at ?? request.created_at), locale)}</time></div>)}</div></section>}
      </section>}

      {activeTab === 'settings' && <section className="dashboard-settings stack">
        <LoyaltyPreferencesPanel preferences={memberPreferences} busy={loyaltyOperation === 'preferences'} onChange={updateLoyaltyPreferences} tr={tr}/>
        <section className="card dashboard-notification-sound"><div className="dashboard-section-heading"><div><Bell size={18}/><h2>{tr('صوت التنبيهات', 'Notification sound')}</h2></div></div><p className="muted">{tr('خيار محلي لهذا المتصفح، متوقف افتراضياً. يتطلب التفعيل تفاعلك لتهيئة الصوت؛ لا يُرسل هذا التفضيل إلى الخادم.', 'A local preference for this browser, off by default. Enabling requires your interaction to initialize audio; this preference is not sent to the server.')}</p><label className="dashboard-check"><input type="checkbox" checked={notificationSoundEnabled} onChange={(event) => void setNotificationSound(event.target.checked)}/>{tr('تشغيل نغمة للتنبيهات الجديدة فقط', 'Play a chime only for newly observed notifications')}</label></section>
        <section className="card"><div className="dashboard-section-heading"><div><Lock size={18}/><h2>{tr('قفل الموقع', 'Site lock')}</h2></div></div><p className="muted">{tr('القفل خدمة استحقاقية يطبقها الخادم. كلمة المرور هنا منفصلة تماماً عن دخول حسابك.', 'Locking is entitlement-controlled and enforced by the server. This password is entirely separate from account sign-in.')}</p><label className="dashboard-check"><input type="checkbox" checked={lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, enabled: event.target.checked })}/>{tr('تفعيل كلمة مرور لزوار الموقع', 'Require a password from site visitors')}</label><div className="dashboard-settings-grid"><label><span>{tr('كلمة مرور الموقع', 'Site password')}</span><input className="field" type="password" autoComplete="new-password" value={lockForm.password} disabled={!lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, password: event.target.value })}/></label><label><span>{tr('رسالة الزوار', 'Visitor message')}</span><input className="field" value={lockForm.message} disabled={!lockForm.enabled} onChange={(event) => setLockForm({ ...lockForm, message: event.target.value })}/></label></div><button className="button" disabled={!activeSite} onClick={() => void saveLock()}><Lock size={16}/>{tr('حفظ القفل', 'Save lock')}</button></section>
        <section className="card"><div className="dashboard-section-heading"><div><ShieldCheck size={18}/><h2>{tr('PIN والجهاز الموثوق', 'PIN and trusted device')}</h2></div><a className="button button--quiet" href="/auth?return=%2Fdashboard%3Ftab%3Dsettings">{tr('إعادة التحقق بالبريد', 'Verify again by email')}</a></div><p className="muted">{tr('أنشئ أو غيّر PIN من ستة أرقام للدخول السريع على هذا الجهاز الموثوق فقط. يرفض الخادم الإجراء حتى تعيد التحقق حديثاً من البريد.', 'Create or change a six-digit PIN for quick entry on this trusted device only. The server rejects the action until you have freshly verified by email.')}</p><div className="dashboard-inline-form dashboard-pin-form"><label><span>{tr('PIN جديد', 'New PIN')}</span><input className="field" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(event) => setPinValue(event.target.value.replace(/[٠-٩۰-۹]/g, (character) => String(character.charCodeAt(0) - (character.charCodeAt(0) >= 0x6F0 ? 0x6F0 : 0x660))).replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><label><span>{tr('تأكيد PIN', 'Confirm PIN')}</span><input className="field" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/[٠-٩۰-۹]/g, (character) => String(character.charCodeAt(0) - (character.charCodeAt(0) >= 0x6F0 ? 0x6F0 : 0x660))).replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><button className="button" onClick={() => void savePin()}><ShieldCheck size={16}/>{tr('إنشاء أو تغيير PIN', 'Create or change PIN')}</button></div></section>
        <section className="card dashboard-danger"><div className="dashboard-section-heading"><div><Trash2 size={18}/><h2>{tr('الخصوصية ودورة البيانات', 'Privacy and data lifecycle')}</h2></div><a className="button button--quiet" href="/auth?return=%2Fdashboard%3Ftab%3Dsettings">{tr('إعادة التحقق بالبريد', 'Verify again by email')}</a></div><p>{tr('ابدأ بالإخفاء الفوري عند الحاجة. الأرشفة توقف الإتاحة العامة، والإتلاف يطبّق بعد تحقق حديث ومن دون حجز نظامي أو تشغيلي قائم.', 'Use immediate hiding when needed. Archiving stops public availability; erasure executes after fresh verification and only where no legal or operational hold exists.')}</p><button className="button button--quiet" onClick={() => void hidePublicPresence()}><EyeOff size={16}/>{tr('إخفاء موقعي العام الآن', 'Hide my public site now')}</button><div className="dashboard-settings-grid"><label><span>{tr('الإجراء المطلوب', 'Requested action')}</span><select className="field" value={deletionAction} onChange={(event) => setDeletionAction(event.target.value as 'archive'|'schedule'|'destroy')}><option value="archive">{tr('أرشفة الحساب وإيقاف الإتاحة العامة', 'Archive account and stop public availability')}</option><option value="schedule">{tr('إتلاف مجدول', 'Scheduled erasure')}</option><option value="destroy">{tr('إتلاف فوري إن لم يوجد حجز', 'Immediate erasure if no hold exists')}</option></select></label>{deletionAction === 'schedule' && <label><span>{tr('موعد الإتلاف', 'Erasure time')}</span><input className="field" type="datetime-local" value={deletionSchedule} onChange={(event) => setDeletionSchedule(event.target.value)}/></label>}</div><textarea className="field" rows={3} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder={tr('سبب اختياري للإجراء', 'Optional reason')}/><label className="dashboard-check"><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.target.checked)}/>{tr('أؤكد اختياري وأفهم أن الإتلاف النهائي لا يمكن التراجع عنه بعد تنفيذه.', 'I confirm this choice and understand final erasure cannot be reversed once executed.')}</label><button className="button button--danger" disabled={!deletionConfirmed} onClick={() => void requestDeletion()}><Trash2 size={16}/>{tr('تسجيل الإجراء', 'Record this action')}</button></section>
      </section>}

          </section>
        </div>
      </div>
      {previewOpen && <PreviewModal policy={visibilityPolicy} visibilityBusy={visibilityBusy} onVisibilityChange={saveVisibility} draft={draft} site={activeSite} tr={tr} submitting={submittingReview} onClose={() => setPreviewOpen(false)} onSubmit={submitForReview} />}
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

type SpeechRecognitionResultEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> };
type BrowserSpeechRecognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function speechRecognitionConstructor() {
  const browser = window as Window & { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function VoiceButton({ value, onAppend, lang, tr }: { value: string; onAppend: (next: string) => void; lang: 'ar' | 'en'; tr: (ar: string, en: string) => string }) {
  const [listening, setListening] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const latestRef = useRef({ value, onAppend });
  latestRef.current = { value, onAppend };
  useEffect(() => () => recognitionRef.current?.stop(), []);
  const toggle = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const Constructor = speechRecognitionConstructor();
    if (!Constructor) { setUnavailable(true); return; }
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    let processed = 0;
    recognition.onresult = (event) => {
      for (let index = Math.max(processed, event.resultIndex); index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal === false) continue;
        processed = index + 1;
        const spoken = (result[0]?.transcript || '').trim();
        if (!spoken) continue;
        const latest = latestRef.current;
        const next = `${latest.value}${latest.value && !/\s$/.test(latest.value) ? ' ' : ''}${spoken}`;
        latestRef.current = { ...latest, value: next };
        latest.onAppend(next);
      }
    };
    recognition.onerror = () => setUnavailable(true);
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    try { recognition.start(); setListening(true); } catch { setUnavailable(true); }
  };
  const label = listening ? tr('إيقاف الإملاء', 'Stop dictation') : tr('إملاء صوتي', 'Voice dictation');
  return <span className="dashboard-voice-control">
    <button type="button" className={`dashboard-icon-button${listening ? ' is-listening' : ''}`} onClick={toggle} aria-label={label} aria-pressed={listening} title={label}>
      {listening ? <MicOff size={16}/> : <Mic size={16}/>}
    </button>
    {unavailable && <small>{tr('الإملاء غير متاح في هذا المتصفح.', 'Dictation is unavailable in this browser.')}</small>}
  </span>;
}

function DictatedInput({ value, onChange, lang, tr, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; lang: 'ar' | 'en'; tr: (ar: string, en: string) => string }) {
  return <div className="dashboard-dictated-field"><input className="field" {...props} value={value} onChange={(event) => onChange(event.target.value)}/><VoiceButton value={value} onAppend={onChange} lang={lang} tr={tr}/></div>;
}
function DictatedTextarea({ value, onChange, lang, tr, rows = 5, className = '', ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; lang: 'ar' | 'en'; tr: (ar: string, en: string) => string; rows?: number; className?: string }) {
  return <div className="dashboard-dictated-field dashboard-dictated-field--textarea"><textarea className={`field ${className}`} {...props} rows={rows} value={value} onChange={(event) => onChange(event.target.value)}/><VoiceButton value={value} onAppend={onChange} lang={lang} tr={tr}/></div>;
}

function EditorGuide({ section, tr }: { section: EditorSection; tr: (ar: string, en: string) => string }) {
  const key = `ksa-men:editor-guide:${section}`;
  const [visible, setVisible] = useState(() => { try { return window.localStorage.getItem(key) !== 'dismissed'; } catch { return true; } });
  if (!visible) return null;
  const copy: Record<EditorSection, [string, string]> = {
    identity: ['ابدأ بالاسم والمسمى، ثم اختر صورة أو اترك الهوية البصرية الافتراضية.', 'Start with your name and title, then choose a photo or keep the default identity.'],
    bio: ['اجعل النبذة صادقة ومباشرة. يمكنك الإملاء الصوتي عند الحاجة.', 'Keep your introduction honest and direct. Use voice dictation when helpful.'],
    contact: ['اختر فقط وسائل التواصل التي تريد إتاحتها للزوار.', 'Choose only the contact channels you want visitors to see.'],
    experience: ['رتّب الخبرات من الأحدث إلى الأقدم وأضف ما يمكنك تأكيده.', 'Order experience from newest to oldest and add only what you can confirm.'],
    education: ['أضف المؤهلات التي تمثل مسيرتك المهنية فعلاً.', 'Add the qualifications that genuinely represent your journey.'],
    training: ['اجمع البرامج والدورات التي تضيف قيمة لقصتك المهنية.', 'Collect programs and courses that add value to your professional story.'],
    skills: ['صنّف مهاراتك لتظهر صورتك الإنسانية والعلمية والمهنية بوضوح.', 'Classify skills to show your human, scientific and professional strengths clearly.'],
    memberships: ['أضف العضويات التي تريد ظهورها في ملفك.', 'Add memberships you want to appear on your profile.'],
    languages: ['أضف اللغات التي تستخدمها مهنياً.', 'Add the languages you use professionally.'],
    hobbies: ['شارك الاهتمامات التي تضيف بعداً صادقاً لهويتك.', 'Share interests that add an authentic dimension to your identity.'],
    achievements: ['اجمع الإنجازات والمحطات في مكان واحد، ثم رتّبها زمنياً.', 'Keep achievements and milestones together, then order the milestones over time.'],
    skillImages: ['اختر صورة من جهازك، وسنجهزها تلقائياً للعرض السريع.', 'Choose an image from your device and we will prepare it for fast display.'],
    workImages: ['اختر أمثلة تعبّر عن عملك، لا عن بيانات خاصة بالآخرين.', 'Choose examples that represent your work, not other people’s private data.'],
    youtube: ['أضف رابطاً تعريفياً اختيارياً من YouTube.', 'Add an optional introduction link from YouTube.'],
    socials: ['استخدم روابطك المهنية الموثوقة.', 'Use your trusted professional links.'],
    buttons: ['أضف وجهات واضحة للزائر وبحد أقصى ثلاثة أزرار.', 'Add clear visitor destinations, up to three buttons.'],
    blog: ['يمكنك نشر فكرة أو كتابة قصيرة ضمن موقعك الشخصي.', 'You can publish a thought or a short piece on your personal site.'],
    notes: ['هذه الملاحظات خاصة بمسودتك ولا تعرض للزائر.', 'These notes remain private to your draft and are never shown to visitors.'],
    privacy: ['راجع ما تود إظهاره قبل إرسال أي نسخة للمراجعة.', 'Review what you want to show before sending a version for review.'],
  };
  return <aside className="dashboard-editor-guide"><CircleHelp size={17}/><p>{tr(...copy[section])}</p><button type="button" onClick={() => { try { window.localStorage.setItem(key, 'dismissed'); } catch {} setVisible(false); }} aria-label={tr('إغلاق الإرشاد', 'Dismiss guidance')}><X size={16}/></button></aside>;
}

function TextSection({ label, hint, value, multiline = false, onChange, lang, maxLength = 5000 }: { label: string; hint: string; value: string; multiline?: boolean; maxLength?: number; onChange: (value: string) => void; lang: 'ar' | 'en' }) {
  const { t } = useApp();
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><PencilLine size={15}/>{label}</p><h2>{label}</h2><p className="muted">{hint}</p></div></header>{multiline ? <DictatedTextarea maxLength={maxLength} className="dashboard-textarea" rows={10} value={value} onChange={onChange} lang={lang} tr={t}/> : <DictatedInput value={value} onChange={onChange} lang={lang} tr={t}/>}</>;
}

function IdentitySection({ draft, tr, uploading, onChange, onUpload, lang }: { draft: ProfileDraft; tr: (ar: string, en: string) => string; uploading: string; onChange: (patch: Partial<ProfileDraft>) => void; onUpload: (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose) => void; lang: 'ar' | 'en' }) {
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><UserRound size={15}/>{tr('الخطوة 1', 'Step 1')}</p><h2>{tr('الاسم والمسمى', 'Name and title')}</h2><p className="muted">{tr('ابدأ ببيانات الهوية المطلوبة، ثم أضف الصورة والغلاف عندما تكون جاهزاً.', 'Start with the required identity details, then add a photo and cover when ready.')}</p></div></header><div className="dashboard-settings-grid"><label><span>{tr('الاسم', 'Name')}</span><DictatedInput autoComplete="name" maxLength={160} value={draft.name} onChange={(name) => onChange({ name })} lang={lang} tr={tr}/></label><label><span>{tr('المسمى المهني', 'Professional title')}</span><DictatedInput maxLength={180} value={draft.title} onChange={(title) => onChange({ title })} lang={lang} tr={tr}/></label></div><div className="dashboard-media-pair"><UploadControl label={tr('الصورة الشخصية', 'Profile photo')} purpose="photo" uploading={uploading} tr={tr} preview={draft.photo} onChange={(event) => void onUpload(event, 'photo')}/><UploadControl label={tr('الغلاف البانورامي', 'Panoramic cover')} purpose="cover" uploading={uploading} tr={tr} preview={draft.cover} onChange={(event) => void onUpload(event, 'cover')}/></div></>;
}
function ContactSection({ draft, tr, onChange, lang, siteName }: { draft: ProfileDraft; tr: (ar: string, en: string) => string; onChange: (patch: Partial<ProfileDraft>) => void; lang: 'ar' | 'en'; siteName?: string }) { const suggestion = siteName ? `${siteName}@ksa.men` : 'name@ksa.men'; return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Mail size={15}/>{tr('الخطوة 3', 'Step 3')}</p><h2>{tr('بيانات التواصل والموقع', 'Contact and location')}</h2><p className="muted">{tr('يمكنك لاحقاً التحكم في ظهور كل حقل ضمن إعدادات الخصوصية.', 'You can later control visibility for each field in privacy settings.')}</p></div></header><div className="dashboard-settings-grid">{([['email', tr('البريد الإلكتروني', 'Email'), 'email'], ['phone', tr('الهاتف', 'Phone'), 'tel'], ['whatsapp', tr('واتساب', 'WhatsApp'), 'tel'], ['city', tr('المدينة', 'City'), 'text'], ['country', tr('الدولة', 'Country'), 'text']] as const).map(([key, label, type]) => <label key={key}><span>{label}</span><DictatedInput type={type} value={draft[key]} onChange={(value) => onChange({ [key]: value })} lang={lang} tr={tr}/></label>)}</div><p className="dashboard-email-suggestion"><Mail size={15}/>{tr(`صيغة مقترحة لهويتك البريدية: ${suggestion}. هذا اقتراح فقط؛ لا تنشئ المنصة صندوق بريد أو وصولاً إليه.`, `A suggested professional format is ${suggestion}. This is only a format suggestion; the platform does not create or access a mailbox.`)}</p></>;
}
function useEditorRowKeys(length: number) {
  const registry = useRef<EditorRowKeys | null>(null);
  if (!registry.current) registry.current = new EditorRowKeys();
  return { keys: registry.current.resize(length), remove: (index: number) => registry.current!.remove(index) };
}
function textItem(item: string | ResumeItem) { return typeof item === 'string' ? item : item.title; }
export function StructuredList({ title, value, onChange, tr, timeline = false, lang }: { title: string; value: ResumeItem[]; onChange: (value: ResumeItem[]) => void; tr: (ar: string, en: string) => string; timeline?: boolean; lang: 'ar' | 'en' }) {
  const rows = useEditorRowKeys(value.length);
  const update = (index: number, key: keyof ResumeItem, text: string) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: text } : item));
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><BookOpen size={15}/>{timeline ? tr('محطات زمنية', 'Milestones') : tr('قائمة منظمة', 'Structured list')}</p><h2>{title}</h2><p className="muted">{tr('أضف المعلومات التي يمكنك تأكيدها فقط. يمكنك ترك تاريخ النهاية فارغاً للحالة الحالية.', 'Add only information you can confirm. Leave the end date empty for a current item.')}</p></div><button className="button button--quiet" disabled={value.length >= 30} onClick={() => onChange([...value, blankItem()])}><Plus size={16}/>{tr('إضافة عنصر', 'Add item')}</button></header><div className="dashboard-structured-list">{value.length === 0 && <EmptyInline text={tr('لا توجد عناصر بعد.', 'No items yet.')} />}{value.map((item, index) => <article key={rows.keys[index]}><div className="dashboard-list-card-top"><strong>{tr('عنصر', 'Item')} {index + 1}</strong><button className="dashboard-icon-button" aria-label={tr('حذف العنصر', 'Remove item')} onClick={() => { rows.remove(index); onChange(value.filter((_, itemIndex) => itemIndex !== index)); }}><Trash2 size={16}/></button></div>{!item.title.trim() && <p className="dashboard-field-hint">{tr('يمكنك إكمال العنوان لاحقاً؛ سنحتفظ بما كتبته.', 'You can complete the title later; your work is kept.')}</p>}<div className="dashboard-settings-grid"><label><span>{tr('العنوان أو المسمى', 'Title or role')}</span><DictatedInput maxLength={240} value={item.title} onChange={(text) => update(index, 'title', text)} lang={lang} tr={tr}/></label><label><span>{tr('الجهة', 'Organization')}</span><DictatedInput maxLength={240} value={item.organization} onChange={(text) => update(index, 'organization', text)} lang={lang} tr={tr}/></label><label><span>{tr('البداية', 'Start')}</span><DictatedInput maxLength={40} value={item.start} onChange={(text) => update(index, 'start', text)} placeholder="2024-01" lang={lang} tr={tr}/></label><label><span>{tr('النهاية', 'End')}</span><DictatedInput maxLength={40} value={item.end} onChange={(text) => update(index, 'end', text)} placeholder={tr('الحالي أو 2025-01', 'Current or 2025-01')} lang={lang} tr={tr}/></label></div><label><span>{tr('الوصف', 'Description')}</span><DictatedTextarea rows={3} maxLength={3000} value={item.description} onChange={(text) => update(index, 'description', text)} lang={lang} tr={tr}/></label></article>)}</div></>;
}
export function StringList({ title, hint, value, onChange, tr, lang }: { title: string; hint?: string; value: Array<string | ResumeItem>; onChange: (value: Array<string | ResumeItem>) => void; tr: (ar: string, en: string) => string; lang: 'ar' | 'en' }) { const rows = useEditorRowKeys(value.length); return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Check size={15}/>{tr('قائمة قابلة للتحرير', 'Editable list')}</p><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}</div><button className="button button--quiet" disabled={value.length >= 30} onClick={() => onChange([...value, ''])}><Plus size={16}/>{tr('إضافة', 'Add')}</button></header><div className="dashboard-string-list">{value.length === 0 && <EmptyInline text={tr('أضف أول عنصر لتبدأ.', 'Add your first item to start.')} />}{value.map((item, index) => <div key={rows.keys[index]}><DictatedInput aria-label={`${title} ${index + 1}`} maxLength={typeof item === 'string' ? 500 : 240} value={textItem(item)} onChange={(next) => onChange(value.map((valueItem, valueIndex) => valueIndex === index ? (typeof valueItem === 'string' ? next : { ...valueItem, title: next }) : valueItem))} lang={lang} tr={tr}/><button className="dashboard-icon-button" aria-label={tr('حذف', 'Remove')} onClick={() => { rows.remove(index); onChange(value.filter((_, valueIndex) => valueIndex !== index)); }}><X size={16}/></button></div>)}</div></>;
}
function SkillRadarSection({ draft, onChange, tr, lang }: { draft: ProfileDraft; onChange: (patch: Partial<ProfileDraft>) => void; tr: (ar: string, en: string) => string; lang: 'ar' | 'en' }) {
  const update = (key: keyof SkillRadar, values: string[]) => { const skillRadar = { ...draft.skillRadar, [key]: values }; onChange({ skillRadar }); };
  return <div className="dashboard-radar-editor"><StringList title={tr('رادار المهارات', 'Skills radar')} hint={tr('تظهر مهاراتك العامة في موقعك، ويمكنك تنظيمها هنا بثلاث زوايا.', 'Your combined skills appear on the site; organize them here through three lenses.')} value={draft.skills} onChange={(skills) => onChange({ skills })} tr={tr} lang={lang}/><div className="dashboard-radar-editor__groups"><StringList title={tr('إنسانية', 'Human')} hint={tr('مثل القيادة والتواصل والتعاون.', 'Such as leadership, communication and collaboration.')} value={draft.skillRadar.human} onChange={(values) => update('human', values.map(textItem))} tr={tr} lang={lang}/><StringList title={tr('علمية', 'Scientific')} hint={tr('مثل البحث والتحليل والمنهجية.', 'Such as research, analysis and methodology.')} value={draft.skillRadar.scientific} onChange={(values) => update('scientific', values.map(textItem))} tr={tr} lang={lang}/><StringList title={tr('مهنية', 'Professional')} hint={tr('مثل التخصصات والأدوات والممارسات.', 'Such as specialties, tools and practices.')} value={draft.skillRadar.professional} onChange={(values) => update('professional', values.map(textItem))} tr={tr} lang={lang}/></div></div>;
}
function MilestonesSection({ draft, onChange, tr, lang }: { draft: ProfileDraft; onChange: (patch: Partial<ProfileDraft>) => void; tr: (ar: string, en: string) => string; lang: 'ar' | 'en' }) { return <div className="dashboard-milestones-editor"><StringList title={tr('إنجازات مختصرة', 'Short achievements')} hint={tr('أضف الإنجازات التي تريد إبرازها في صورة نقاط واضحة.', 'Add achievements you want to highlight as clear points.')} value={draft.achievements} onChange={(achievements) => onChange({ achievements })} tr={tr} lang={lang}/><StructuredList title={tr('محطات المسيرة', 'Journey milestones')} value={draft.timeline} onChange={(timeline) => onChange({ timeline })} tr={tr} timeline lang={lang}/></div>; }

function MediaSection({ title, hint, items, max, purpose, uploading, tr, onUpload, onChange, savedImages, onRestore }: { title: string; hint: string; items: string[]; savedImages: SavedImage[]; onRestore: (image: SavedImage) => void; max: number; purpose: 'skill' | 'work'; uploading: string; tr: (ar: string, en: string) => string; onUpload: (event: ChangeEvent<HTMLInputElement>, purpose: UploadPurpose) => void; onChange: (items: string[]) => void }) { return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><ImagePlus size={15}/>{items.length}/{max}</p><h2>{title}</h2><p className="muted">{hint}</p></div>{items.length < max && <UploadControl label={tr('إضافة صورة', 'Add image')} purpose={purpose} uploading={uploading} tr={tr} compact onChange={(event) => void onUpload(event, purpose)}/>}</header><div className="dashboard-image-grid">{items.length === 0 && <EmptyInline text={tr('لا توجد صور مرفوعة بعد.', 'No images uploaded yet.')} />}{items.map((url, index) => <figure key={url}><img src={url} alt=""/><button className="dashboard-icon-button" onClick={() => onChange(items.filter((_, imageIndex) => imageIndex !== index))} aria-label={tr('إزالة الصورة', 'Remove image')}><X size={16}/></button></figure>)}</div>{savedImages.some((image) => image.purpose === purpose && !items.includes(image.url)) && <details className="dashboard-saved-images"><summary><ImagePlus size={17}/>{tr('صورك المحفوظة — اختر لاستعادتها', 'Your saved images — choose to restore')}</summary><div className="dashboard-image-grid">{savedImages.filter((image) => image.purpose === purpose && !items.includes(image.url)).map((image, index) => <button key={image.id} type="button" disabled={Boolean(uploading) || items.length >= max} onClick={() => onRestore(image)} aria-label={`${tr('استعادة الصورة', 'Restore image')} ${index + 1}`}><img src={image.url} alt="" loading="lazy"/><span><Plus size={16}/>{tr('استعادة', 'Restore')}</span></button>)}</div></details>}</>;
}
export function YoutubeSection({ value, onChange, tr }: { value: string; onChange: (value: string) => void; tr: (ar: string, en: string) => string }) {
  const parsed = youtubeLink(value), valid = !value.trim() || Boolean(parsed);
  return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><BrandIcon brand="youtube" size={20}/>YouTube</p><h2>{tr('قناتك أو فيديو يعرّف بك', 'Your channel or introduction video')}</h2><p className="muted">{tr('أضف رابط القناة أو الفيديو. لا يُحمّل المشغّل إلا عند اختيار المشاهدة.', 'Add your channel or video link. The player loads only when someone chooses to watch.')}</p></div></header><label><span>{tr('رابط YouTube', 'YouTube URL')}</span><input className={`field ${!valid ? 'is-invalid' : ''}`} type="url" dir="ltr" inputMode="url" maxLength={2048} placeholder="https://youtube.com/@..." value={value} onChange={event => onChange(event.target.value)}/></label>{parsed && <p className="dashboard-youtube-kind"><BrandIcon brand="youtube" size={19}/>{parsed.kind === 'channel' ? tr('ستظهر أيقونة تفتح قناتك.', 'An icon will open your channel.') : tr('ستظهر أيقونة ومشغّل لفيديوك عند الطلب.', 'An icon and an on-demand player will show your video.')}</p>}{!valid && <p className="dashboard-error">{tr('أكمل رابط القناة أو الفيديو؛ تبقى كتابتك محفوظة.', 'Complete the channel or video URL; your work stays saved.')}</p>}</>;
}

export function LinkList({ title, hint, value, onChange, max, tr, socialOnly = false }: { socialOnly?: boolean; title: string; hint: string; value: Social[]; onChange: (value: Social[]) => void; max: number; tr: (ar: string, en: string) => string }) { const rows = useEditorRowKeys(value.length); const update = (index: number, key: keyof Social, text: string) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: text } : item)); return <><header className="dashboard-edit-heading"><div><p className="dashboard-kicker"><Link2 size={15}/>{value.length}/{max}</p><h2>{title}</h2><p className="muted">{hint}</p></div>{value.length < max && <button className="button button--quiet" onClick={() => onChange([...value, { label: '', url: '' }])}><Plus size={16}/>{tr('إضافة رابط', 'Add link')}</button>}</header><div className="dashboard-link-list">{value.length === 0 && <EmptyInline text={tr('لا توجد روابط مضافة بعد.', 'No links added yet.')} />}{value.map((item, index) => <div className={socialOnly ? "dashboard-link-row--social" : ""} key={rows.keys[index]}><BrandIcon brand={socialLink(item)?.brand || "website"} size={20}/>{!socialOnly && <input className="field" maxLength={100} value={item.label} aria-label={tr('عنوان الرابط — اختياري', 'Link label — optional')} placeholder={tr('عنوان اختياري', 'Optional label')} onChange={(event) => update(index, 'label', event.target.value)}/>}<input className="field" type="url" dir="ltr" inputMode="url" maxLength={2048} aria-label={tr('الرابط', 'URL')} value={item.url} placeholder="https://" onChange={(event) => update(index, 'url', event.target.value)}/>{item.url && <small>{socialLink(item)?.host ? socialLink(item)!.host : tr('أكمل الرابط قبل طلب النشر؛ كتابتك محفوظة.', 'Complete the link before publishing; your work is saved.')}</small>}<button className="dashboard-icon-button" onClick={() => { rows.remove(index); onChange(value.filter((_, itemIndex) => itemIndex !== index)); }} aria-label={tr('حذف الرابط', 'Remove link')}><X size={16}/></button></div>)}</div></>;
}

function UploadControl({ label, purpose, uploading, tr, preview, compact = false, onChange }: { label: string; purpose: UploadPurpose; uploading: string; tr: (ar: string, en: string) => string; preview?: string; compact?: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) { const id = useId(); return <label className={`dashboard-upload ${compact ? 'is-compact' : ''}`} htmlFor={id}>{preview && <img src={preview} alt=""/>}<span>{uploading === purpose ? <RefreshCw size={16} className="spin"/> : <Upload size={16}/>} {uploading === purpose ? tr('جارٍ الرفع...', 'Uploading...') : label}</span><input id={id} type="file" accept="image/*" onChange={onChange} disabled={Boolean(uploading)}/></label>; }
function ProfessionalPointsMark({ compact = false }: { compact?: boolean }) { return <span className={`midpoint-mark${compact ? ' is-compact' : ''}`} aria-label="Professional points"><Gift size={compact ? 13 : 16}/><span>{compact ? 'نقاط' : 'نقاط التميز'}</span></span>; }
function ProfessionalPointsAmount({ value, locale }: { value: number; locale: string }) { return <span className="midpoint-amount"><strong>{value.toLocaleString(locale)}</strong><ProfessionalPointsMark compact/></span>; }
function WalletPanel({ balance, ledger, transferForm, setTransferForm, onTransfer, onCopyReferral, busyOperation, loyalty, loyaltyBusy, competitionBusy, activeSiteUrl, onDailySubmit, onCompetitionEnter, locale, tr, notify }: { balance: number; ledger: Record<string, unknown>[]; transferForm: { recipient: string; amount: string }; setTransferForm: (value: { recipient: string; amount: string }) => void; onTransfer: () => void; onCopyReferral: () => void; busyOperation: WalletOperation | ''; loyalty?: LoyaltyData; loyaltyBusy: boolean; competitionBusy: boolean; activeSiteUrl: string; onDailySubmit: (challenge: DailyChallenge, answer: string) => void; onCompetitionEnter: () => void; locale: string; tr: (ar: string, en: string) => string; notify: (message: string) => void }) {
  const amount = Number(transferForm.amount);
  const transferBusy = busyOperation === 'transfer';
  return <section className="dashboard-wallet stack">
    <section className="dashboard-wallet-hero card"><div><p className="dashboard-kicker"><WalletCards size={16}/>{tr('رصيد نقاط التميز المهني', 'Professional excellence points')}</p><h2><ProfessionalPointsAmount value={balance} locale={locale}/></h2><p>{tr('رصيد تقديري غير نقدي؛ لا يُشترى ولا يُسترد أو يُحوّل إلى نقود أو استحقاق.', 'A non-cash recognition balance. It is not sold, redeemed, or converted to cash or entitlement.')}</p></div><div className="dashboard-wallet-mark"><ProfessionalPointsMark/></div></section>
    <section className="dashboard-wallet-grid"><article className="card"><div className="dashboard-section-heading"><div><ArrowLeftRight size={18}/><h2>{tr('إهداء نقاط', 'Gift points')}</h2></div></div><p className="muted">{tr('يمكنك إهداء 100 إلى 1,000 نقطة تقدير مهنية للحسابات الأخرى. راجع المستفيد والعدد قبل التأكيد.', 'You may gift 100 to 1,000 professional-recognition points to another account. Review the recipient and amount before confirming.')}</p><div className="dashboard-inline-form"><input className="field" value={transferForm.recipient} onChange={(event) => setTransferForm({ ...transferForm, recipient: event.target.value })} disabled={Boolean(busyOperation)} placeholder={tr('المستفيد: C2 أو اسم', 'Recipient: C2 or name')}/><label className="dashboard-point-input"><input className="field" type="number" min="100" max="1000" step="1" value={transferForm.amount} onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })} disabled={Boolean(busyOperation)} placeholder="100–1,000"/><ProfessionalPointsMark compact/></label>{Number.isInteger(amount) && <span className="dashboard-point-preview"><ProfessionalPointsAmount value={amount} locale={locale}/></span>}<button className="button" disabled={Boolean(busyOperation)} aria-busy={transferBusy} onClick={onTransfer}>{transferBusy ? <RefreshCw className="spin" size={16}/> : <Send size={16}/>} {transferBusy ? tr('جارٍ الإهداء', 'Gifting') : tr('إهداء', 'Gift')}</button></div></article></section>
    <LoyaltyPanel daily={loyalty?.daily} competition={loyalty?.competition} communities={loyalty?.communities ?? []} busy={loyaltyBusy} competitionBusy={competitionBusy} activeSiteUrl={activeSiteUrl} onSubmit={onDailySubmit} onCompetitionEnter={onCompetitionEnter} tr={tr} notify={notify}/>
    <section className="card dashboard-referral"><div><p className="dashboard-kicker"><UsersRound size={15}/>{tr('الإحالة', 'Referral')}</p><h2>{tr('رابط إحالتك الخاص', 'Your referral link')}</h2><p className="muted">{tr('شارك الرابط مع من قد يستفيد من بناء حضور مهني مستقل.', 'Share this link with people who may benefit from an independent professional presence.')}</p></div><button className="button button--quiet" onClick={onCopyReferral}><Copy size={16}/>{tr('نسخ الرابط', 'Copy link')}</button></section>
    <section className="card"><div className="dashboard-section-heading"><div><FileText size={18}/><h2>{tr('سجل النقاط', 'Points history')}</h2></div></div>{ledger.length ? <div className="dashboard-ledger">{ledger.slice(0, 20).map((entry, index) => <div key={String(entry.id ?? index)}><span>{String(entry.kind ?? 'movement')}</span><ProfessionalPointsAmount value={Number(entry.amount ?? 0)} locale={locale}/><small>{String(entry.notes ?? '')}</small><time>{formatDate(Number(entry.created_at), locale)}</time></div>)}</div> : <EmptyInline text={tr('لا توجد حركات مؤكدة لعرضها بعد.', 'No confirmed movements to show yet.')} />}</section>
  </section>;
}

function LoyaltyPreferencesPanel({ preferences, busy, onChange, tr }: { preferences: MemberPreferences; busy: boolean; onChange: (patch: Partial<MemberPreferences>) => void; tr: (ar: string, en: string) => string }) {
  const ageOptions: Array<[MemberPreferences['ageBand'], string, string, string, string]> = [
    ['student', 'طالب أو في بداية التعلّم', 'Student or learning stage', 'اجعل ركنك مركزاً على بناء المهارات وعرض إنجازات التعلّم.', 'Focus your private space on skills and learning achievements.'],
    ['early_career', 'بداية المسيرة المهنية', 'Early career', 'رتّب أولوياتك حول الخبرات والمشروعات والمهارات القابلة للعرض.', 'Prioritise experience, projects, and showcase-ready skills.'],
    ['established', 'مسيرة مهنية مستقرة', 'Established career', 'ركّز على أثر الخبرة والقيادة ومحطات المسيرة الأساسية.', 'Focus on career impact, leadership, and key milestones.'],
    ['expert', 'خبرة متقدمة أو قيادية', 'Senior or leadership experience', 'أظهر رؤيتك المهنية والعضويات والإنجازات البارزة عند تحرير هويتك.', 'Highlight professional vision, memberships, and significant achievements.'],
    ['prefer_not_to_say', 'أفضل عدم التحديد', 'Prefer not to say', 'ستبقى الإرشادات عامة ويمكنك تغيير هذا الاختيار في أي وقت.', 'Guidance remains general and you can change this at any time.'],
  ];
  const current = ageOptions.find(([value]) => value === preferences.ageBand) ?? ageOptions[4];
  return <section className="card dashboard-loyalty-preferences"><div className="dashboard-section-heading"><div><Sparkles size={18}/><h2>{tr('تخصيص مساحتك', 'Personalise your space')}</h2></div></div><p className="muted">{tr('هذه الخيارات خاصة بحسابك ولا تظهر في موقعك أو ملفك العام.', 'These choices stay private to your account and never appear on your public site or profile.')}</p><div className="dashboard-settings-grid"><label><span>{tr('المرحلة المهنية التقريبية', 'Approximate career stage')}</span><select className="field" value={preferences.ageBand} disabled={busy} onChange={(event) => onChange({ ageBand: event.target.value as MemberPreferences['ageBand'] })}>{ageOptions.map(([value, ar, en]) => <option key={value} value={value}>{tr(ar, en)}</option>)}</select></label><div className="dashboard-personalisation-note"><strong>{tr('اقتراح لمساحتك', 'A suggestion for your space')}</strong><p>{tr(current[3], current[4])}</p></div></div><div className="dashboard-loyalty-options"><label className="dashboard-check"><input type="checkbox" checked={preferences.seasonalThemeEnabled} disabled={busy} onChange={(event) => onChange({ seasonalThemeEnabled: event.target.checked })}/>{tr('إظهار لمسات المناسبات في مساحتي وعلى الرئيسية لهذا المتصفح', 'Show occasion touches in my space and homepage on this browser')}</label><label className="dashboard-check"><input type="checkbox" checked={preferences.seasonalNoticesEnabled} disabled={busy} onChange={(event) => onChange({ seasonalNoticesEnabled: event.target.checked })}/>{tr('تلقي تنبيه المناسبة داخل المساحة وعبر البريد', 'Receive occasion notice in my space and by email')}</label><label className="dashboard-check"><input type="checkbox" checked={preferences.badgesEnabled} disabled={busy} onChange={(event) => onChange({ badgesEnabled: event.target.checked })}/>{tr('إظهار أوسمة تمارين اليوم في ركني الخاص', 'Show daily-exercise badges in my private corner')}</label></div></section>;
}
function LoyaltyPanel({ daily, competition, communities, busy, competitionBusy, activeSiteUrl, onSubmit, onCompetitionEnter, tr, notify }: { daily?: DailyActivity; competition?: LoyaltyCompetition | null; communities: LoyaltyCommunity[]; busy: boolean; competitionBusy: boolean; activeSiteUrl: string; onSubmit: (challenge: DailyChallenge, answer: string) => void; onCompetitionEnter: () => void; tr: (ar: string, en: string) => string; notify: (message: string) => void }) {
  const [answer, setAnswer] = useState('');
  const challenge = daily?.challenge;
  useEffect(() => { setAnswer(''); }, [challenge?.id]);
  return <details className="card dashboard-loyalty" open={false}><summary><span><Sparkles size={18}/><b>{tr('ركن العطاء والنمو', 'Giving & growth corner')}</b></span><span>{tr('اختياري وخاص بك', 'Optional and private')}</span><ChevronDown size={18}/></summary><div className="dashboard-loyalty__body"><section className="dashboard-daily-exercise"><div><p className="dashboard-kicker"><BadgeCheck size={15}/>{tr('تمرين اليوم', 'Today’s exercise')}</p><h2>{daily?.completed ? (daily.correct ? tr('أحسنت، اكتمل تمرين اليوم', 'Well done, today’s exercise is complete') : tr('اكتمل تمرين اليوم', 'Today’s exercise is complete')) : challenge?.title ?? tr('تمرين يومي', 'Daily exercise')}</h2>{daily?.completed ? <p className="muted">{daily.correct ? tr(`أضفت ${daily.rewardPoints ?? 0} نقطة تميز إلى رصيدك.${daily.badge ? ` ${daily.badge}` : ''}`, `${daily.rewardPoints ?? 0} excellence points were added to your balance.${daily.badge ? ` ${daily.badge}` : ''}`) : tr('شكراً لمشاركتك. يعود تمرين جديد غداً.', 'Thank you for taking part. A new exercise returns tomorrow.')}</p> : <p className="muted">{challenge?.prompt}</p>}</div>{!daily?.completed && challenge && <div className="dashboard-daily-choices" role="group" aria-label={tr('خيارات الإجابة', 'Answer choices')}>{challenge.choices.map((choice) => <button key={choice} type="button" className={`button button--quiet ${answer === choice ? 'is-active' : ''}`} aria-pressed={answer === choice} onClick={() => setAnswer(choice)}>{choice}</button>)}<button className="button" type="button" disabled={!answer || busy} onClick={() => onSubmit(challenge, answer)}>{busy ? <RefreshCw className="spin" size={16}/> : <Check size={16}/>} {tr('تسجيل الإجابة', 'Submit answer')}</button></div>}</section><CompetitionPanel competition={competition} busy={competitionBusy} onEnter={onCompetitionEnter} tr={tr}/><CommunityPanel communities={communities} tr={tr}/><GiftQrPanel activeSiteUrl={activeSiteUrl} tr={tr} notify={notify}/></div></details>;
}

function CompetitionPanel({ competition, busy, onEnter, tr }: { competition?: LoyaltyCompetition | null; busy: boolean; onEnter: () => void; tr: (ar: string, en: string) => string }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if (!competition?.endsAt) return undefined; const timer = window.setInterval(() => setClock(Date.now()), 1_000); return () => window.clearInterval(timer); }, [competition?.endsAt]);
  if (!competition) return null;
  const seconds = Math.max(0, competition.endsAt - Math.floor(clock / 1000));
  const days = Math.floor(seconds / 86_400); const hours = Math.floor((seconds % 86_400) / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); const remain = seconds % 60;
  const entry = competition.entry;
  const label = entry?.status === 'winner' ? tr('تم اعتمادك فائزاً', 'You were approved as a winner') : entry?.status === 'not_selected' ? tr('اكتملت النتيجة', 'Result complete') : entry?.status === 'entered' ? tr('مشاركتك مسجلة', 'Your entry is recorded') : tr('سجل مشاركتك', 'Enter competition');
  return <section className="dashboard-competition"><div><p className="dashboard-kicker"><BadgeCheck size={15}/>{tr('مسابقة معلنة', 'Announced competition')}</p><h2>{competition.title}</h2>{competition.terms && <p className="muted">{competition.terms}</p>}{competition.url && <a className="dashboard-competition-link" href={competition.url} target="_blank" rel="noreferrer">{tr('الشروط والتفاصيل', 'Terms and details')}<ArrowUpRight size={15}/></a>}</div><div className="dashboard-competition-side"><div className="dashboard-countdown" aria-label={tr('الوقت المتبقي', 'Time remaining')}><span>{days}<small>{tr('يوم', 'd')}</small></span><span>{String(hours).padStart(2, '0')}<small>{tr('ساعة', 'h')}</small></span><span>{String(minutes).padStart(2, '0')}<small>{tr('دقيقة', 'm')}</small></span><span>{String(remain).padStart(2, '0')}<small>{tr('ثانية', 's')}</small></span></div><button className={`button ${entry?.status === 'winner' ? 'button--quiet' : ''}`} type="button" disabled={busy || Boolean(entry) || seconds === 0} onClick={onEnter}>{busy ? <RefreshCw size={16} className="spin"/> : <BadgeCheck size={16}/>} {label}</button></div></section>;
}

function CommunityPanel({ communities, tr }: { communities: LoyaltyCommunity[]; tr: (ar: string, en: string) => string }) {
  if (!communities.length) return null;
  const iconFor = (kind: LoyaltyCommunity['kind']) => kind === 'youtube' ? <Youtube size={17}/> : kind === 'promotion' ? <Globe2 size={17}/> : <Send size={17}/>;
  return <section className="dashboard-community-links"><div><p className="dashboard-kicker"><UsersRound size={15}/>{tr('المجتمعات', 'Communities')}</p><h2>{tr('قنوات المنصة وروابطها المعتمدة', 'Official platform channels and approved links')}</h2></div><div>{communities.map((community) => <a className="button button--quiet" key={`${community.kind}-${community.url}`} href={community.url} target="_blank" rel="noreferrer">{iconFor(community.kind)}{community.label}<ArrowUpRight size={14}/></a>)}</div></section>;
}

function vCardText(value: string): string { return value.replace(/[\r\n;,]/g, ' ').trim().slice(0, 120); }
function GiftQrPanel({ activeSiteUrl, tr, notify }: { activeSiteUrl: string; tr: (ar: string, en: string) => string; notify: (message: string) => void }) {
  const [friend, setFriend] = useState({ name: '', phone: '', email: '' });
  const [mode, setMode] = useState<'site' | 'vcard'>('site');
  const [qr, setQr] = useState('');
  const [sharing, setSharing] = useState(false);
  const hasContact = Boolean(friend.phone.trim() || friend.email.trim());
  const sitePayload = activeSiteUrl || 'https://ksa.men/auth?register=1&source=gift-qr';
  const payload = useMemo(() => mode === 'vcard'
    ? `BEGIN:VCARD\nVERSION:3.0\nFN:${vCardText(friend.name)}\n${friend.phone.trim() ? `TEL;TYPE=CELL:${vCardText(friend.phone)}\n` : ''}${friend.email.trim() ? `EMAIL:${vCardText(friend.email)}\n` : ''}END:VCARD`
    : sitePayload, [friend.email, friend.name, friend.phone, mode, sitePayload]);
  useEffect(() => {
    if (!friend.name.trim() || (mode === 'vcard' && !hasContact)) { setQr(''); return; }
    let active = true;
    void QRCode.toDataURL(payload, { width: 360, margin: 2, color: { dark: '#004422', light: '#ffffff' }, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setQr(value); })
      .catch(() => { if (active) setQr(''); });
    return () => { active = false; };
  }, [friend.name, hasContact, mode, payload]);
  const share = async () => {
    if (!qr || sharing) return;
    setSharing(true);
    const recipient = vCardText(friend.name) || tr('صديقك', 'your friend');
    const text = mode === 'site'
      ? tr(`هذه بطاقة QR مهداه لك يا ${recipient}. امسح الرمز لاكتشاف هوية مهنية مستقلة: ${sitePayload}`, `A QR card for you, ${recipient}. Scan it to discover an independent professional identity: ${sitePayload}`)
      : tr(`هذه بطاقة QR مهداه لك يا ${recipient}. امسح الرمز لإضافة بيانات التواصل التي اختارها مُهديك.`, `A QR card for you, ${recipient}. Scan it to add the contact details chosen for you.`);
    try {
      const image = await fetch(qr).then((response) => response.blob());
      const file = new File([image], 'ksa-men-gift-qr.png', { type: 'image/png' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: tr('بطاقة QR مهداه', 'Gift QR card'), text, files: [file] });
        return;
      }
      const phone = friend.phone.replace(/\D/g, '');
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') notify(tr('تعذر فتح المشاركة الآن. يمكنك تنزيل الرمز ومشاركته من جهازك.', 'Sharing could not open. You can download the code and share it from your device.'));
    } finally { setSharing(false); }
  };
  return <section className="dashboard-gift-qr"><div><p className="dashboard-kicker"><Gift size={15}/>{tr('إهداء بسيط', 'A simple gift')}</p><h2>{tr('أريد إهداء بطاقة QR لصديق', 'I want to gift a QR card')}</h2><p className="muted">{tr('تبقى بيانات الصديق داخل هذه الصفحة على جهازك فقط.', 'Your friend’s details remain only in this page on your device.')}</p></div><div className="dashboard-gift-form"><label><span>{tr('اسم الصديق', 'Friend’s name')}</span><input className="field" value={friend.name} maxLength={80} onChange={(event) => setFriend({ ...friend, name: event.target.value })}/></label><label><span>{tr('واتساب أو هاتف اختياري', 'Optional WhatsApp or phone')}</span><input className="field" type="tel" value={friend.phone} maxLength={32} onChange={(event) => setFriend({ ...friend, phone: event.target.value })}/></label><label><span>{tr('بريد اختياري', 'Optional email')}</span><input className="field" type="email" value={friend.email} maxLength={120} onChange={(event) => setFriend({ ...friend, email: event.target.value })}/></label></div><div className="dashboard-gift-modes" role="group" aria-label={tr('محتوى رمز QR', 'QR code content')}><button type="button" className={`button button--quiet ${mode === 'site' ? 'is-active' : ''}`} aria-pressed={mode === 'site'} onClick={() => setMode('site')}><Globe2 size={16}/>{tr('رابط الهوية', 'Identity link')}</button><button type="button" className={`button button--quiet ${mode === 'vcard' ? 'is-active' : ''}`} aria-pressed={mode === 'vcard'} disabled={!hasContact} onClick={() => setMode('vcard')}><QrCode size={16}/>{tr('بطاقة تواصل', 'Contact card')}</button></div>{qr && <div className="dashboard-gift-card"><div><span>KSA.MEN</span><strong>{friend.name.trim()}</strong><small>{tr('بطاقة QR مهداه لك', 'A QR card made for you')}</small></div><img src={qr} alt={tr('رمز QR مهدى', 'Gift QR code')}/><div className="dashboard-gift-actions"><button type="button" className="button" disabled={sharing} onClick={() => void share()}>{sharing ? <RefreshCw className="spin" size={16}/> : <Send size={16}/>} {tr('مشاركة عبر واتساب أو التطبيقات', 'Share to WhatsApp or apps')}</button><a className="button button--quiet" href={qr} download="ksa-men-gift-qr.png"><ArrowDownToLine size={16}/>{tr('تنزيل الرمز', 'Download code')}</a></div></div>}</section>;
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
  return <div className="dashboard-translation-editor" dir={target === 'ar' ? 'rtl' : 'ltr'}><p className="muted">{tr(`حرر النصوص المحفوظة للنسخة ${targetName} فقط ثم استخدم الحفظ الآن أو انتظر الحفظ التلقائي. الأسماء والجهات والمؤهلات الرسمية تبقى كما هي لحمايتها من التحريف.`, `Edit only the saved ${targetName} text, then use Save now or wait for auto-save. Names, organisations, and official qualifications remain exact to prevent alteration.`)}</p><div className="dashboard-settings-grid"><label><span>{tr('المسمى المترجم', 'Translated title')}</span><input className="field" value={translation.title} onChange={(event) => onChange({ title: event.target.value })}/></label><label><span>{tr('المدينة المترجمة', 'Translated city')}</span><input className="field" value={translation.city} onChange={(event) => onChange({ city: event.target.value })}/></label><label><span>{tr('الدولة المترجمة', 'Translated country')}</span><input className="field" value={translation.country} onChange={(event) => onChange({ country: event.target.value })}/></label></div><label><span>{tr('النبذة المترجمة', 'Translated biography')}</span><textarea className="field" rows={5} value={translation.bio} onChange={(event) => onChange({ bio: event.target.value })}/></label><div className="dashboard-settings-grid"><label><span>{tr('المهارات المترجمة، مفصولة بفواصل', 'Translated skills, comma-separated')}</span><textarea className="field" rows={3} value={translation.skills.join(', ')} onChange={(event) => updateStrings('skills', event.target.value)}/></label><label><span>{tr('الهوايات المترجمة، مفصولة بفواصل', 'Translated hobbies, comma-separated')}</span><textarea className="field" rows={3} value={translation.hobbies.join(', ')} onChange={(event) => updateStrings('hobbies', event.target.value)}/></label></div><div className="dashboard-translation-lists">{sections.map((section) => translation[section.key].length > 0 && <section key={section.key}><h3>{tr(section.ar, section.en)}</h3>{translation[section.key].map((item, index) => <div className="dashboard-translation-item" key={`${section.key}-${index}`}>{section.titles && <label><span>{tr('العنوان المترجم', 'Translated title')}</span><input className="field" value={item.title} onChange={(event) => updateStructured(section.key, index, { title: event.target.value })}/></label>}<label><span>{tr('الوصف المترجم', 'Translated description')}</span><textarea className="field" rows={3} maxLength={3000} value={item.description} onChange={(event) => updateStructured(section.key, index, { description: event.target.value })}/></label></div>)}</section>)}</div></div>;
}
export function PreviewModal({ draft, site, tr, submitting, onClose, onSubmit, policy, visibilityBusy = false, onVisibilityChange }: { policy?: VisibilityPolicy | null; visibilityBusy?: boolean; onVisibilityChange?: (patch: Partial<Omit<VisibilityPolicy, 'version'>>) => void; draft: ProfileDraft; site: Site | null; tr: (ar: string, en: string) => string; submitting: boolean; onClose: () => void; onSubmit: () => void }) {
  const { lang } = useApp();
  const previewProfile = useMemo(() => {
    const translated = lang === 'en' ? draft.translations?.en : undefined;
    const localized = translated ? { ...draft, ...translated, avatarMode: draft.avatarMode, itemIds: profileItemIds(draft), hidden: draft.hidden, hiddenItems: draft.hiddenItems } : draft;
    return sanitizeProfile(withVisibility(localized, policy));
  }, [draft, policy, lang]);
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
        <p className="dashboard-kicker"><Eye size={15}/>{tr('معاينة هويتك', 'Preview your identity')}</p>
        <h2 id="dashboard-preview-title">{draft.name || tr('اسمك', 'Your name')}</h2>
      </div>
      <button ref={closeButtonRef} type="button" className="dashboard-icon-button" onClick={onClose} aria-label={tr('إغلاق', 'Close')}><X size={18}/></button>
    </header>
    <div className="dashboard-preview-scroll">
      {policy && onVisibilityChange && <details className="dashboard-preview-visibility"><summary><ShieldCheck size={18}/>{tr('اختر ما يظهر للزوار', 'Choose what visitors see')}</summary><VisibilityControls profile={draft} policy={policy} onChange={onVisibilityChange} busy={visibilityBusy} siteOptions/></details>}
      {policy?.visible === false && <p className="dashboard-preview-visibility-status" role="status">{tr('موقعك مخفي عن الزوار. هذه المعاينة الخاصة متاحة لك.', 'Your site is hidden from visitors. This private preview is available to you.')}</p>}
      <IdentityView previewMode data={{ profile: previewProfile, site: site?.id, name: site?.name || '', branding: site?.branding !== false }}/>
      {draft.notes && <aside className="dashboard-preview-private"><h3><Lock size={17}/>{tr('خاص بك', 'Only for you')}</h3><p>{draft.notes}</p></aside>}
    </div>
    <footer>
      <p className="muted">{tr('اضغط طلب النشر، وسيتولى المشرف إتاحة موقعك.', 'Request publication and your administrator will make your site available.')}</p>
      <div>
        <button type="button" className="button button--quiet" onClick={onClose}>{tr('متابعة التحرير', 'Keep editing')}</button>
        <button type="button" className="button" disabled={submitting} onClick={onSubmit}>{submitting ? <RefreshCw className="spin" size={16}/> : <FileCheck2 size={16}/>} {tr('طلب نشر موقعي', 'Request publication')}</button>
      </div>
    </footer>
  </dialog>;
}

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Banknote,
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  FileKey2,
  Gauge,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  UsersRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api, useApp } from './lib';
import './admin.css';

type AdminRole = 'owner' | 'manager' | 'moderator';
type AdminTab = 'overview' | 'users' | 'reviews' | 'membership' | 'payments' | 'services' | 'names' | 'content' | 'pricing' | 'lock' | 'economics' | 'audit' | 'backup' | 'governance';
type TabGroup = 'workspace' | 'operations' | 'governance';
type JsonRecord = Record<string, unknown>;
type MaybeRecord = JsonRecord | null | undefined;
type UserAction = 'status' | 'role' | 'grant' | 'points' | 'service' | 'assign' | 'branding';

type AdminTabDefinition = {
  id: AdminTab;
  ar: string;
  en: string;
  group: TabGroup;
  icon: LucideIcon;
  roles: AdminRole[];
};

type AdminData = Partial<Record<Exclude<AdminTab, 'content' | 'pricing' | 'lock' | 'backup'>, unknown>> & {
  settings?: unknown;
  transfers?: unknown;
};

type ContentDraft = {
  title_ar: string;
  title_en: string;
  body_ar: string;
  body_en: string;
};

type SeasonalForm = {
  enabled: boolean;
  occasion: string;
  startsAt: string;
  endsAt: string;
};

type BackupItem = {
  id: string;
  bytes?: number;
  createdAt?: unknown;
  sha256?: unknown;
};

const tabs: AdminTabDefinition[] = [
  { id: 'overview', ar: 'نظرة تنفيذية', en: 'Overview', group: 'workspace', icon: LayoutDashboard, roles: ['owner', 'manager', 'moderator'] },
  { id: 'reviews', ar: 'المراجعات', en: 'Reviews', group: 'workspace', icon: ClipboardCheck, roles: ['owner', 'manager', 'moderator'] },
  { id: 'users', ar: 'المستخدمون', en: 'Users', group: 'workspace', icon: UsersRound, roles: ['owner', 'manager'] },
  { id: 'membership', ar: 'طلبات العضوية', en: 'Membership requests', group: 'workspace', icon: ClipboardCheck, roles: ['owner'] },
  { id: 'payments', ar: 'المدفوعات', en: 'Payments', group: 'operations', icon: Banknote, roles: ['owner', 'manager'] },
  { id: 'services', ar: 'الخدمات', en: 'Services', group: 'operations', icon: Wrench, roles: ['owner', 'manager'] },
  { id: 'names', ar: 'الأسماء', en: 'Names', group: 'operations', icon: FileKey2, roles: ['owner'] },
  { id: 'content', ar: 'المحتوى', en: 'Content', group: 'operations', icon: BookOpen, roles: ['owner'] },
  { id: 'lock', ar: 'قفل المنصة', en: 'Platform lock', group: 'governance', icon: LockKeyhole, roles: ['owner'] },
  { id: 'economics', ar: 'الاقتصاديات', en: 'Economics', group: 'governance', icon: Gauge, roles: ['owner'] },
  { id: 'audit', ar: 'سجل التدقيق', en: 'Audit', group: 'governance', icon: ShieldCheck, roles: ['owner'] },
  { id: 'backup', ar: 'النسخ الاحتياطي', en: 'Backup', group: 'governance', icon: Archive, roles: ['owner'] },
  { id: 'governance', ar: 'الحوكمة ومؤشرات الجودة', en: 'Governance & quality', group: 'governance', icon: ShieldCheck, roles: ['owner'] },
];

const contentSlugs = [
  ['home', 'الصفحة الرئيسية', 'Home'],
  ['about', 'من نحن', 'About'],
  ['terms', 'شروط الاستخدام', 'Terms of use'],
  ['privacy', 'سياسة الخصوصية', 'Privacy policy'],
  ['blog', 'المدونة', 'Journal'],
  ['features', 'مزايا المنصة', 'Platform features'],
  ['campaigns', 'الحملات والعروض', 'Campaigns & offers'],
  ['contact', 'بيانات التواصل', 'Contact details'],
  ['footer', 'التذييل', 'Footer'],
  ['qr', 'أداة QR', 'QR tool'],
] as const;

const lockModes = [
  ['open', 'المنصة مفتوحة', 'Platform open'],
  ['home_closed', 'إغلاق الصفحة الرئيسية', 'Home page closed'],
  ['platform_closed', 'إغلاق كامل للمنصة', 'Entire platform closed'],
  ['maintenance', 'وضع الصيانة', 'Maintenance mode'],
  ['human_test', 'اختبار بشري خاص', 'Private human test'],
] as const;

const overviewMetrics = [
  ['total_users', 'إجمالي المستخدمين', 'Total users'],
  ['published_sites', 'المواقع المنشورة', 'Published sites'],
  ['review_requests', 'طلبات المراجعة', 'Review requests'],
  ['membership_requests', 'طلبات العضوية', 'Membership requests'],
] as const;

const overviewQueue = [
  ['review_requests', 'طلبات تحتاج مراجعة', 'Review requests awaiting a decision', 'reviews'],
  ['membership_requests', 'طلبات عضوية بانتظار القرار', 'Membership requests awaiting a decision', 'membership'],
  ['pending_sites', 'مواقع معلقة', 'Sites still pending', 'reviews'],
] as const;

const economicMetrics = [
  ['active_users', 'المستخدمون النشطون', 'Active users'],
  ['cost_per_active_user', 'تكلفة المستخدم النشط', 'Cost per active user'],
  ['storage_usage', 'استهلاك التخزين', 'Storage usage'],
  ['email_usage', 'استهلاك البريد', 'Email usage'],
  ['request_usage', 'استهلاك الطلبات', 'Request usage'],
  ['user_growth', 'نمو المستخدمين', 'User growth'],
  ['renewal_rate', 'معدل التجديد', 'Renewal rate'],
  ['trial_conversion', 'تحول التجربة إلى اشتراك', 'Trial conversion'],
  ['successful_referrals', 'الإحالات الناجحة', 'Successful referrals'],
  ['acquisition_cost', 'تكلفة اكتساب المستخدم', 'Acquisition cost'],
  ['approved_revenue', 'الإيرادات المعتمدة', 'Approved revenue'],
  ['recorded_expenses', 'المصروفات المسجلة', 'Recorded expenses'],
  ['operating_profitability', 'الربحية التشغيلية', 'Operating profitability'],
] as const;

const entitlementPolicySources = [
  { key: 'trial', ar: 'التجربة', en: 'Trial' },
  { key: 'subscription', ar: 'الاشتراك', en: 'Subscription' },
  { key: 'grant', ar: 'المنح الإداري', en: 'Administrative grant' },
  { key: 'points', ar: 'النقاط', en: 'Points' },
] as const;

function record(value: unknown): MaybeRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(record(item)));
  const object = record(value);
  if (!object) return [];
  for (const key of ['items', 'users', 'reviews', 'requests', 'payments', 'services', 'names', 'transfers', 'entries', 'audit', 'data', 'backups']) {
    if (Array.isArray(object[key])) return records(object[key]);
  }
  return [];
}

function field(item: MaybeRecord, ...keys: string[]): unknown {
  if (!item) return undefined;
  for (const key of keys) if (item[key] !== undefined) return item[key];
  return undefined;
}

function valueAt(source: unknown, key: string): unknown {
  const direct = record(source);
  if (!direct) return undefined;
  if (key in direct) return direct[key];
  for (const parent of ['metrics', 'stats', 'summary', 'data', 'totals', 'economics']) {
    const nested = record(direct[parent]);
    if (nested && key in nested) return nested[key];
  }
  return undefined;
}

function text(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '✓' : '—';
  return fallback;
}

function groupedValue(value: unknown, lang: 'ar' | 'en', fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (Number.isFinite(numeric)) {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
      maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    }).format(numeric);
  }
  return text(value, fallback);
}

function idOf(item: MaybeRecord): string {
  return text(item?.id ?? item?.user_id ?? item?.site_id ?? item?.payment_id, '');
}

function displayJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '—';
  }
}

function asDate(value: unknown, lang: 'ar' | 'en'): string {
  if (value === null || value === undefined || value === '') return '—';
  const numberValue = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numberValue)
    ? new Date((numberValue > 100_000_000_000 ? numberValue : numberValue * 1000))
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(date);
}

/** datetime-local has no zone. These helpers intentionally model its visible value as Asia/Riyadh (UTC+03:00). */
function epochToRiyadhInput(value: unknown): string {
  const epoch = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  return new Date(epoch * 1000 + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function riyadhInputToEpoch(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute));
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function statusTone(status: unknown): string {
  const value = text(status, '').toLowerCase();
  if (/approved|published|active|complete|enabled|accepted|open/.test(value)) return 'success';
  if (/reject|suspend|declin|closed|paused|disabled|failed/.test(value)) return 'danger';
  if (/pending|review|trial|await/.test(value)) return 'warning';
  return 'neutral';
}

function prettyKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isLocalMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/api\/media\/[A-Za-z0-9-]+(?:\?.*)?$/.test(value);
}

function changedImage(value: unknown): string {
  if (isLocalMediaUrl(value)) return value;
  const object = record(value);
  if (!object) return '';
  for (const [key, nested] of Object.entries(object)) {
    if (/(photo|avatar|cover|image|logo)/i.test(key)) {
      const image = changedImage(nested);
      if (image) return image;
    }
  }
  return '';
}

function contentDraftFrom(response: unknown): ContentDraft {
  const outer = record(response);
  const source = record(field(outer, 'content')) ?? outer;
  return {
    title_ar: text(field(source, 'title_ar', 'titleAr'), ''),
    title_en: text(field(source, 'title_en', 'titleEn'), ''),
    body_ar: text(field(source, 'body_ar', 'bodyAr'), ''),
    body_en: text(field(source, 'body_en', 'bodyEn'), ''),
  };
}

function parseObject(value: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return record(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function settingText(value: unknown): string {
  return typeof value === 'string' ? value : displayJson(value);
}

function isPendingPayment(item: JsonRecord): boolean {
  return ['requested', 'submitted'].includes(text(field(item, 'status', 'decision'), '').toLowerCase());
}

function isApprovedPayment(item: JsonRecord): boolean {
  return text(field(item, 'status', 'decision'), '').toLowerCase() === 'approved';
}

function isPendingReview(item: JsonRecord): boolean {
  const decisionStatus = field(item, 'decision_status', 'decisionStatus');
  return text(decisionStatus ?? field(item, 'status', 'decision'), '').toLowerCase() === 'pending';
}

function knownBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

export default function Admin() {
  const { user, lang, t, refresh, notify } = useApp();
  const tr = useCallback((ar: string, en: string) => t(ar, en), [t]);
  const ownRole = text(user?.role, '').toLowerCase() as AdminRole;
  const owner = ownRole === 'owner';
  const manager = ownRole === 'manager';
  const managerOrOwner = owner || manager;
  const financialOperator = owner || (manager && Boolean(user?.financial));

  const [tab, setTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminData>({});
  const [loadingTabs, setLoadingTabs] = useState<Partial<Record<AdminTab, boolean>>>({});
  const [loadedTabs, setLoadedTabs] = useState<Partial<Record<AdminTab, boolean>>>({});
  const [tabErrors, setTabErrors] = useState<Partial<Record<AdminTab, string>>>({});
  const [freshRequiredTabs, setFreshRequiredTabs] = useState<Partial<Record<AdminTab, boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<JsonRecord | null>(null);
  const [selectedReview, setSelectedReview] = useState<JsonRecord | null>(null);
  const [paymentReasons, setPaymentReasons] = useState<Record<string, string>>({});
  const [paymentReversalReasons, setPaymentReversalReasons] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [siteReasons, setSiteReasons] = useState<Record<string, string>>({});
  const [membershipReasons, setMembershipReasons] = useState<Record<string, string>>({});
  const [membershipQuery, setMembershipQuery] = useState('');
  const [membershipStatus, setMembershipStatus] = useState('pending');
  const [governanceReport, setGovernanceReport] = useState<MaybeRecord>();
  const [userQuery, setUserQuery] = useState('');
  const [userStatus, setUserStatus] = useState('');
  const [reviewQuery, setReviewQuery] = useState('');
  const [points, setPoints] = useState('');
  const [grantDays, setGrantDays] = useState('3');
  const [serviceKey, setServiceKey] = useState('');
  const [role, setRole] = useState('moderator');
  const [financial, setFinancial] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [notification, setNotification] = useState({ recipient: '', title: '', body: '' });
  const [nameForm, setNameForm] = useState({ name: '', kind: 'policy', reason: '' });
  const [proxySite, setProxySite] = useState({ email: '', name: '', authorization: '', profileName: '', title: '', city: '', bio: '' });
  const [lastProxy, setLastProxy] = useState<MaybeRecord>();
  const [handover, setHandover] = useState({ id: '', email: '' });
  const [contentSlug, setContentSlug] = useState<(typeof contentSlugs)[number][0]>('about');
  const [content, setContent] = useState<ContentDraft>({ title_ar: '', title_en: '', body_ar: '', body_en: '' });
  const [contentMeta, setContentMeta] = useState<MaybeRecord>();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [lock, setLock] = useState({ mode: '', reason: '', message: '', password: '' });
  const [bankInstructions, setBankInstructions] = useState('');
  const [prices, setPrices] = useState('');
  const [seasonal, setSeasonal] = useState<SeasonalForm>({ enabled: false, occasion: 'national_day', startsAt: '', endsAt: '' });
  const [nightlyBackups, setNightlyBackups] = useState<BackupItem[]>([]);
  const [backupVerification, setBackupVerification] = useState<Record<string, MaybeRecord>>({});
  const [backupsLoaded, setBackupsLoaded] = useState(false);
  const [expense, setExpense] = useState({ label: '', amount: '', notes: '' });
  const [servicePolicies, setServicePolicies] = useState<Record<string, JsonRecord>>({});

  const availableTabs = useMemo(() => tabs.filter((item) => item.roles.includes(ownRole) && (item.id !== 'payments' || financialOperator)), [ownRole, financialOperator]);
  const error = tabErrors[tab] ?? '';
  const setTabError = useCallback((target: AdminTab, message: string) => {
    setTabErrors((current) => ({ ...current, [target]: message }));
  }, []);
  const setError = useCallback((message: string) => setTabError(tab, message), [setTabError, tab]);

  const handleFailure = useCallback((failure: unknown, fresh = false, target = tab) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (fresh && /403|fresh|reauth|verify|أعد التحقق/i.test(message)) {
      setFreshRequiredTabs((current) => ({ ...current, [target]: true }));
      setTabError(target, tr('يلزم تحقق حديث قبل تنفيذ هذا الإجراء. أعد التحقق ثم عد إلى هذا القسم؛ لم يتجاوز النظام حماية الخادم.', 'Fresh verification is required before this action. Reauthenticate, then return to this section; server protection was not bypassed.'));
      return;
    }
    setTabError(target, message || tr('تعذر إكمال العملية. حاول مجدداً.', 'The operation could not be completed. Try again.'));
  }, [setTabError, tab, tr]);

  const loadTab = useCallback(async (target: AdminTab) => {
    setLoadingTabs((current) => ({ ...current, [target]: true }));
    setTabError(target, '');

    if (target === 'backup') {
      setBackupsLoaded(false);
      try {
        const response = await api<unknown>('/api/admin/backups');
        const result = record(response);
        const list = Array.isArray(result?.backups) ? result.backups : [];
        setNightlyBackups(list.flatMap((item) => {
          const backup = record(item);
          const id = text(backup?.id, '');
          return id ? [{
            id,
            bytes: typeof backup?.bytes === 'number' ? backup.bytes : undefined,
            createdAt: backup?.createdAt,
            sha256: backup?.sha256,
          }] : [];
        }));
        setBackupsLoaded(true);
      } catch (failure) {
        handleFailure(failure, true, target);
      } finally {
        setLoadedTabs((current) => ({ ...current, [target]: true }));
        setLoadingTabs((current) => ({ ...current, [target]: false }));
      }
      return;
    }

    const endpoints: Array<[keyof AdminData, string]> = target === 'overview'
      ? [['overview', '/api/admin/overview']]
      : target === 'reviews'
        ? [['reviews', '/api/admin/reviews']]
        : target === 'membership' && owner
          ? [['membership', '/api/admin/subscription-requests']]
          : target === 'governance' && owner
            ? [['governance', '/api/admin/governance']]
        : target === 'users' && managerOrOwner
          ? [['users', '/api/admin/users?limit=100'], ['services', '/api/admin/services']]
          : target === 'payments' && financialOperator
            ? [['payments', '/api/admin/payments']]
            : target === 'services' && managerOrOwner
              ? [['services', '/api/admin/services']]
              : target === 'names' && owner
                ? [['names', '/api/admin/names'], ['transfers', '/api/admin/transfers']]
                : ['content', 'pricing', 'lock'].includes(target) && owner
                  ? [['settings', '/api/admin/settings']]
                  : target === 'economics' && owner
                    ? [['economics', '/api/admin/economics']]
                    : target === 'audit' && owner
                      ? [['audit', '/api/admin/audit']]
                      : [];

    try {
      const results = await Promise.allSettled(endpoints.map(([, path]) => api<unknown>(path)));
      const next: AdminData = {};
      results.forEach((item, index) => {
        const [key] = endpoints[index];
        if (item.status === 'fulfilled') next[key] = item.value;
      });
      if (Object.keys(next).length) setData((current) => ({ ...current, ...next }));
      const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
      if (rejected) handleFailure(rejected.reason, target === 'membership' || target === 'governance', target);
    } finally {
      setLoadedTabs((current) => ({ ...current, [target]: true }));
      setLoadingTabs((current) => ({ ...current, [target]: false }));
    }
  }, [financialOperator, handleFailure, managerOrOwner, owner, setTabError]);

  const loadBackups = useCallback(() => loadTab('backup'), [loadTab]);

  const mutate = useCallback(async <T,>(key: string, work: () => Promise<T>, options?: { fresh?: boolean; success?: string; reload?: boolean; reloadTab?: AdminTab }) => {
    setBusy(key);
    setError('');
    try {
      const result = await work();
      if (options?.success) notify(options.success);
      if (options?.reload !== false) await loadTab(options?.reloadTab ?? tab);
      return result;
    } catch (failure) {
      handleFailure(failure, options?.fresh);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [handleFailure, loadTab, notify, setError, tab]);

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === tab)) setTab('overview');
  }, [availableTabs, tab]);

  useEffect(() => {
    if (!loadedTabs[tab]) void loadTab(tab);
  }, [loadTab, loadedTabs, tab]);

  useEffect(() => {
    const active = tabs.find((item) => item.id === tab);
    window.dispatchEvent(new CustomEvent('ksa:sanad-context', {
      detail: {
        section: 'admin',
        step: active?.id ?? 'overview',
        requiredMissing: [],
        saveStatus: busy ? 'saving' : 'idle',
        reviewStatus: tab === 'reviews' ? 'review' : 'none',
      },
    }));
  }, [busy, tab]);

  const users = useMemo(() => records(data.users), [data.users]);
  const filteredUsers = useMemo(() => { const query = userQuery.trim().toLowerCase(); return users.filter((item) => { const status = text(field(item, 'status'), '').toLowerCase(); const haystack = [field(item, 'name'), field(item, 'email'), field(item, 'id'), field(item, 'subdomain')].map((value) => text(value, '').toLowerCase()).join(' '); return (!userStatus || status === userStatus) && (!query || haystack.includes(query)); }); }, [userQuery, userStatus, users]);
  const reviews = useMemo(() => records(data.reviews), [data.reviews]);
  const filteredReviews = useMemo(() => { const query = reviewQuery.trim().toLowerCase(); if (!query) return reviews; return reviews.filter((item) => [field(item, 'site_name'), field(item, 'submitter_name'), field(item, 'submitter_email'), field(item, 'user_id')].some((value) => text(value, '').toLowerCase().includes(query))); }, [reviewQuery, reviews]);
  const payments = useMemo(() => records(data.payments), [data.payments]);
  const services = useMemo(() => records(data.services), [data.services]);
  const names = useMemo(() => records(data.names), [data.names]);
  const transfers = useMemo(() => records(data.transfers), [data.transfers]);
  const audit = useMemo(() => records(data.audit), [data.audit]);
  const membershipRequests = useMemo(() => records(data.membership), [data.membership]);
  const governance = useMemo(() => record(data.governance)?.governance ?? record(data.governance), [data.governance]);

  useEffect(() => {
    setServicePolicies((current) => {
      let changed = false;
      const next = { ...current };
      services.forEach((service) => {
        const key = text(field(service, 'key', 'id'), '');
        if (!key || next[key]) return;
        next[key] = { ...(record(field(service, 'policy')) ?? {}) };
        changed = true;
      });
      return changed ? next : current;
    });
  }, [services]);

  useEffect(() => {
    if (!serviceKey && services.length) setServiceKey(text(field(services[0], 'key', 'id'), ''));
  }, [serviceKey, services]);

  useEffect(() => {
    if (!selectedUser) return;
    const nextRole = text(field(selectedUser, 'role'), 'moderator');
    setRole(['owner', 'manager', 'moderator', 'user'].includes(nextRole) ? nextRole : 'moderator');
    setFinancial(Boolean(field(selectedUser, 'financial')));
    setAssignedTo(text(field(selectedUser, 'assigned_to'), ''));
    setPoints('');
    setGrantDays('3');
  }, [selectedUser]);

  useEffect(() => {
    const settings = record(data.settings);
    if (!settings) return;
    setSettingsLoaded(true);
    const lockValue = field(settings, 'lock', 'platform_lock');
    const parsedLock = record(lockValue);
    if (parsedLock && text(parsedLock.mode, '')) {
      setLock({
        mode: text(parsedLock.mode, ''),
        reason: text(parsedLock.reason, ''),
        message: text(field(parsedLock, 'message', 'card_message'), ''),
        password: '',
      });
    }
    const seasonalValue = field(settings, 'seasonal', 'season');
    const parsedSeasonal = record(seasonalValue);
    if (parsedSeasonal) {
      setSeasonal({
        enabled: Boolean(parsedSeasonal.enabled),
        occasion: text(parsedSeasonal.occasion, 'national_day'),
        startsAt: epochToRiyadhInput(field(parsedSeasonal, 'starts_at', 'startsAt')),
        endsAt: epochToRiyadhInput(field(parsedSeasonal, 'ends_at', 'endsAt')),
      });
    }
    const officialBankInfo = field(settings, 'bank_instructions', 'bank', 'payment_instructions');
    if (officialBankInfo !== undefined && officialBankInfo !== null) setBankInstructions(settingText(officialBankInfo));
    const priceInfo = field(settings, 'prices');
    if (priceInfo !== undefined && priceInfo !== null) setPrices(settingText(priceInfo));
  }, [data.settings]);

  const loadContent = useCallback(async (slug: (typeof contentSlugs)[number][0]) => {
    setBusy(`content-load-${slug}`);
    setError('');
    try {
      const response = await api<unknown>(`/api/content/${encodeURIComponent(slug)}`);
      setContent(contentDraftFrom(response));
      setContentMeta(record(response));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (/404|not found|غير موجود/i.test(message)) {
        setContent({ title_ar: '', title_en: '', body_ar: '', body_en: '' });
        setContentMeta({ state: 'new' });
      } else {
        handleFailure(failure);
      }
    } finally {
      setBusy(null);
    }
  }, [handleFailure]);

  useEffect(() => {
    if (tab === 'content' && owner) void loadContent(contentSlug);
  }, [contentSlug, loadContent, owner, tab]);

  const userAction = (action: UserAction, payload: JsonRecord, label: string, fresh = true) => {
    if (!selectedUser) return;
    const id = idOf(selectedUser);
    if (!id) return;
    void mutate(`user-${id}-${action}`, () => api(`/api/admin/users/${encodeURIComponent(id)}/action`, {
      method: 'POST', body: JSON.stringify({ action, ...payload }),
    }), { fresh, success: label }).then((result) => { if (result !== undefined) setSelectedUser(null); });
  };

  const decideReview = (review: JsonRecord, decision: 'approve' | 'reject' | 'changes') => {
    const id = idOf(review);
    const reviewerId = text(user?.id, '');
    const submitterId = text(field(review, 'user_id', 'userId'), '');
    if (!id || !isPendingReview(review)) return;
    if (reviewerId && reviewerId === submitterId) {
      setError(tr('يلزم مراجع مستقل لقرار لقطة مقدمة من حسابك.', 'An independent reviewer is required for a snapshot submitted by your account.'));
      return;
    }
    const reason = reviewReasons[id] ?? '';
    if ((decision === 'reject' || decision === 'changes') && !reason.trim()) {
      setError(tr('سبب الرفض مطلوب لحماية مسار المراجعة.', 'A rejection reason is required for the review trail.'));
      return;
    }
    void mutate(`review-${id}-${decision}`, () => api(`/api/admin/reviews/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision: decision === 'changes' ? 'reject' : decision, reason }),
    }), { fresh: true, success: decision === 'approve' ? tr('تم اعتماد اللقطة ونشرها.', 'The snapshot was approved and published.') : decision === 'changes' ? tr('أُرسل طلب التعديل مع السبب.', 'The change request was sent with its reason.') : tr('تم رفض اللقطة مع حفظ السبب.', 'The snapshot was rejected with its reason recorded.') });
  };

  const decidePayment = (payment: JsonRecord, decision: 'approve' | 'reject') => {
    const id = idOf(payment);
    if (!id || !isPendingPayment(payment)) return;
    const reason = paymentReasons[id] ?? '';
    if (decision === 'reject' && !reason.trim()) {
      setError(tr('أدخل سبب الرفض قبل إرسال القرار.', 'Enter a rejection reason before submitting the decision.'));
      return;
    }
    if (decision === 'approve' && !window.confirm(tr('اعتماد الدفع يطبق استحقاقاً وأثراً لا يتكرر. هل راجعت الطلب؟', 'Approval applies an entitlement with a non-repeatable effect. Have you reviewed the request?'))) return;
    void mutate(`payment-${id}-${decision}`, () => api(`/api/admin/payments/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, reason }),
    }), { fresh: true, success: decision === 'approve' ? tr('أرسل قرار الاعتماد لمرة واحدة إلى الخادم.', 'The one-time approval decision was sent to the server.') : tr('تم إرسال رفض طلب الدفع.', 'The payment rejection was sent.') });
  };

  const reversePayment = (payment: JsonRecord) => {
    const id = idOf(payment);
    const justification = paymentReversalReasons[id] ?? '';
    if (!id || !isApprovedPayment(payment)) return;
    if (justification.trim().length < 8) {
      setError(tr('يجب أن يتكون مبرر الإبطال من ٨ أحرف على الأقل.', 'A reversal justification must contain at least 8 characters.'));
      return;
    }
    if (!window.confirm(tr('سيُسجل الإبطال كتسوية صريحة ولن يُحذف القرار التاريخي. هل تريد المتابعة؟', 'This reversal creates an explicit adjustment and does not delete the historical decision. Continue?'))) return;
    void mutate(`payment-${id}-reverse`, () => api(`/api/admin/payments/${encodeURIComponent(id)}/reverse`, {
      method: 'POST', body: JSON.stringify({ justification }),
    }), { fresh: true, success: tr('سُجل الإبطال كتسوية صريحة.', 'The reversal was recorded as an explicit adjustment.') });
  };

  const decideSite = (review: JsonRecord, action: 'suspend' | 'delete_request') => {
    const siteId = text(field(review, 'site_id', 'siteId'), '');
    const reason = siteReasons[siteId] ?? reviewReasons[idOf(review)] ?? '';
    if (!siteId || !reason.trim()) { setError(tr('اكتب سبب القرار أولاً.', 'Enter a reason for this decision first.')); return; }
    void mutate(`site-${siteId}-${action}`, () => api(`/api/admin/sites/${encodeURIComponent(siteId)}/action`, { method: 'POST', body: JSON.stringify({ action, reason }) }), { fresh: true, success: action === 'suspend' ? tr('تم تعليق إتاحة الموقع وإبلاغ العضو.', 'Site availability was suspended and the member was notified.') : tr('تم تسجيل طلب معالجة البيانات وإخفاء الموقع.', 'The data-handling request was recorded and the site was hidden.'), reloadTab: 'reviews' });
  };

  const decideMembership = (request: JsonRecord, decision: 'approve' | 'reject' | 'changes_requested') => {
    const id = idOf(request);
    if (!id) return;
    const reason = membershipReasons[id] ?? '';
    if (decision !== 'approve' && !reason.trim()) { setError(tr('اكتب سبب القرار أولاً.', 'Enter a reason for this decision first.')); return; }
    const kind = text(field(request, 'kind'), '');
    void mutate(`membership-${id}-${decision}`, () => api(`/api/admin/subscription-requests/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, reason, ...(kind === 'trial_extension' ? { days: 7 } : {}) }),
    }), { fresh: true, success: decision === 'approve' ? (kind === 'annual_contact' ? tr('تم تفعيل العضوية السنوية لمدة عام وإبلاغ العضو.', 'The annual membership was activated for one year and the member was notified.') : tr('تم اعتماد تمديد الفترة المجانية وإبلاغ العضو.', 'The free-period extension was approved and the member was notified.')) : decision === 'changes_requested' ? tr('أُرسل طلب التوضيح إلى العضو.', 'The clarification request was sent to the member.') : tr('تم حفظ القرار وإبلاغ العضو.', 'The decision was recorded and the member was notified.'), reloadTab: 'membership' });
  };

  const generateGovernanceReport = () => {
    void mutate('governance-report', () => api<unknown>('/api/admin/governance/report', { method: 'POST', body: JSON.stringify({ confirmed: true }) }), { fresh: true, reload: false, success: tr('تم إعداد تقرير الحوكمة وتوثيق إنشائه.', 'The governance report was prepared and its generation recorded.') }).then((result) => {
      const report = record(result);
      if (report) setGovernanceReport(record(report.report));
    });
  };

  const switchTab = (next: AdminTab) => {
    if (!availableTabs.some((item) => item.id === next)) return;
    setError('');
    setTab(next);
  };

  const renderOverview = () => (
    <div className="stack admin-stack">
      <section className="admin-page-heading admin-overview-heading">
        <div>
          <p className="admin-eyebrow">KSA.MEN / {tr('التشغيل', 'OPERATIONS')}</p>
          <h1 className="page-title">{tr('نظرة تنفيذية', 'Operational overview')}</h1>
          <p className="muted">{tr('لقطة موجزة للبيانات التي أعادها النظام ضمن نطاق صلاحيتك. لا تُقدّر القيم غير المتاحة.', 'A concise view of system-returned data in your authorized scope. Unavailable values are never estimated.')}</p>
        </div>
        <p className="admin-live-note"><span aria-hidden="true" />{tr('بيانات حية من الخادم', 'Live server data')}</p>
      </section>
      <section className="admin-metrics admin-metrics-primary" aria-label={tr('المؤشرات الرئيسية للمنصة', 'Primary platform metrics')}>
        {overviewMetrics.map(([key, ar, en]) => (
          <article className="admin-metric card" key={key}>
            <span className="muted">{tr(ar, en)}</span>
            <strong><bdi dir="ltr">{groupedValue(valueAt(data.overview, key), lang, tr('غير متاح', 'Unavailable'))}</bdi></strong>
          </article>
        ))}
      </section>
      <section className="card admin-pending-queue" aria-labelledby="admin-pending-queue-title">
        <div className="admin-section-heading">
          <div>
            <p className="admin-eyebrow">{tr('أولوية التشغيل', 'OPERATIONAL PRIORITY')}</p>
            <h2 id="admin-pending-queue-title">{tr('صف الانتظار', 'Pending queue')}</h2>
          </div>
          <span className="admin-route-note">{tr('الأعداد أدناه من ملخص النظام فقط.', 'Counts below come from the system summary only.')}</span>
        </div>
        <div className="admin-queue-list">
          {overviewQueue.filter(([, , , destination]) => availableTabs.some((item) => item.id === destination)).map(([key, ar, en, destination]) => (
            <button className="admin-queue-row" type="button" key={key} onClick={() => switchTab(destination)}>
              <span>{tr(ar, en)}</span>
              <strong><bdi dir="ltr">{groupedValue(valueAt(data.overview, key), lang, tr('غير متاح', 'Unavailable'))}</bdi></strong>
            </button>
          ))}
        </div>
      </section>
      {managerOrOwner && <section className="admin-grid admin-grid-2">
        <div className="card stack">
          <div className="admin-section-heading"><h2>{tr('إشعار آمن', 'Send notification')}</h2><p className="muted">{tr('الإرسال الفردي متاح للمشرف المسؤول ضمن نطاقه؛ الإرسال للدور أو الجميع محصور بالمالك وتتحقق منه الواجهة والخادم.', 'Individual sends are available to a manager in scope; role-wide and global sends are owner-only and checked by both UI and server.')}</p></div>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            if (!notification.recipient.trim() || !notification.title.trim() || !notification.body.trim()) return;
            void mutate('notification', () => api('/api/admin/notifications', { method: 'POST', body: JSON.stringify(notification) }), { success: tr('أُرسل الإشعار وفق نطاقه المعتمد.', 'The notification was sent within its authorized scope.') }).then((result) => {
              if (result !== undefined) setNotification({ recipient: '', title: '', body: '' });
            });
          }}>
            {owner && <div className="admin-quick-targets" aria-label={tr('اختيار نطاق سريع', 'Quick scope selection')}>
              <button className="button button-quiet" type="button" onClick={() => setNotification((value) => ({ ...value, recipient: 'all' }))}>{tr('الجميع', 'All')}</button>
              <button className="button button-quiet" type="button" onClick={() => setNotification((value) => ({ ...value, recipient: 'role:manager' }))}>{tr('المديرون', 'Managers')}</button>
              <button className="button button-quiet" type="button" onClick={() => setNotification((value) => ({ ...value, recipient: 'role:moderator' }))}>{tr('المشرفون', 'Moderators')}</button>
            </div>}
            <label className="field"><span>{tr('المستلم أو النطاق', 'Recipient or scope')}</span><input value={notification.recipient} onChange={(event) => setNotification((value) => ({ ...value, recipient: event.target.value }))} placeholder="C12" /></label>
            <label className="field"><span>{tr('العنوان', 'Title')}</span><input value={notification.title} onChange={(event) => setNotification((value) => ({ ...value, title: event.target.value }))} /></label>
            <label className="field"><span>{tr('النص', 'Body')}</span><textarea rows={3} value={notification.body} onChange={(event) => setNotification((value) => ({ ...value, body: event.target.value }))} /></label>
            <button className="button" disabled={busy === 'notification'}>{tr('إرسال الإشعار', 'Send notification')}</button>
          </form>
        </div>
        <ProxySitePanel
          tr={tr}
          busy={busy}
          proxySite={proxySite}
          setProxySite={setProxySite}
          handover={handover}
          setHandover={setHandover}
          lastProxy={lastProxy}
          setError={setError}
          onCreate={(event) => {
            event.preventDefault();
            if (!proxySite.authorization.trim() || !proxySite.name.trim() || !proxySite.profileName.trim()) {
              setError(tr('أدخل اسم النطاق واسم صاحب الموقع والتفويض الموثق قبل الإنشاء.', 'Enter the subdomain, site owner name and documented authorization before creation.'));
              return;
            }
            const draft = Object.fromEntries(Object.entries({ name: proxySite.profileName.trim(), title: proxySite.title.trim(), city: proxySite.city.trim(), bio: proxySite.bio.trim() }).filter(([, value]) => Boolean(value)));
            void mutate('proxy-site', () => api<unknown>('/api/admin/sites', { method: 'POST', body: JSON.stringify({ email: proxySite.email, name: proxySite.name, authorization: proxySite.authorization, draft }) }), { fresh: true, reload: false, success: tr('أنشأ الخادم مسودة الموقع المحكومة بالتفويض.', 'The server created the authorization-governed site draft.') }).then((result) => {
              const payload = record(result);
              if (payload) {
                setLastProxy(payload);
                const created = record(payload.site);
                const id = text(created?.id, '');
                if (id) setHandover((value) => ({ ...value, id }));
              }
            });
          }}
          onHandover={(event) => {
            event.preventDefault();
            if (!handover.id || !handover.email) return;
            void mutate('handover', () => api(`/api/admin/sites/${encodeURIComponent(handover.id)}/handover`, { method: 'POST', body: JSON.stringify({ email: handover.email }) }), { fresh: true, reload: false, success: tr('أُرسل طلب التسليم؛ لا يكتمل حتى قبول الحساب صاحب البريد المتحقق منه.', 'The handover request was sent; it completes only after acceptance by the verified account for that email.') });
          }}
        />
      </section>}
    </div>
  );

  const renderUsers = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('المستخدمون وإدارة التفويض', 'Users & delegation')}</h1><p className="muted">{tr('لا تظهر إلا الحسابات الواقعة في نطاق المشرف المسؤول. تعديل الدور والإسناد محصوران بالمالك، بينما يبقى تحقق الخادم هو الحاسم.', 'Only accounts in a responsible manager’s scope are returned. Role and assignment changes are owner-only; server enforcement remains decisive.')}</p></div><span className="admin-server-note">{tr('العرض لا يمنح صلاحية', 'Visibility does not grant permission')}</span></section>
      <section className="card admin-request-filter"><label className="field"><span>{tr('البحث بالاسم أو البريد أو C# أو النطاق', 'Search name, email, C#, or subdomain')}</span><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} /></label><label className="field"><span>{tr('الحالة', 'Status')}</span><select value={userStatus} onChange={(event) => setUserStatus(event.target.value)}><option value="">{tr('كل الحالات', 'All statuses')}</option><option value="active">{tr('نشط', 'Active')}</option><option value="suspended">{tr('معلق', 'Suspended')}</option></select></label></section>
      <div className="admin-user-layout">
        <section className="admin-user-list stack">
          {filteredUsers.length ? filteredUsers.map((item) => {
            const id = idOf(item);
            const active = selectedUser && idOf(selectedUser) === id;
            return <button type="button" className={`card admin-user-card ${active ? 'active' : ''}`} key={id || text(field(item, 'email'))} onClick={() => setSelectedUser(item)}>
              <div className="row"><strong>{text(field(item, 'name', 'full_name', 'email'))}</strong><span className={`admin-status ${statusTone(field(item, 'status'))}`}>{text(field(item, 'status'))}</span></div>
              <span className="muted">C{text(field(item, 'id', 'user_id'))} · {text(field(item, 'email'))}</span>
              <span className="muted">{tr('النطاق', 'Domain')}: {text(field(item, 'domain', 'subdomain', 'name'))}</span>
              <div className="admin-user-card-footer"><span>{tr('الرصيد المتاح', 'Available balance')}: {text(field(item, 'balance'), tr('غير متاح', 'Unavailable'))}</span><span>{text(field(item, 'role'))}</span></div>
            </button>;
          }) : <Empty title={tr('لا توجد بيانات مستخدمين معروضة ضمن نطاقك.', 'No user data was returned in your scope.')} />}
        </section>
        <section className="card admin-user-detail">
          {selectedUser ? <UserDetail item={selectedUser} lang={lang} tr={tr} services={services} users={users} points={points} setPoints={setPoints} grantDays={grantDays} setGrantDays={setGrantDays} serviceKey={serviceKey} setServiceKey={setServiceKey} role={role} setRole={setRole} financial={financial} setFinancial={setFinancial} assignedTo={assignedTo} setAssignedTo={setAssignedTo} busy={busy} owner={owner} financialOperator={financialOperator} onAction={userAction} onAudit={() => switchTab('audit')} onNotify={(recipient) => { setNotification((value) => ({ ...value, recipient })); switchTab('overview'); }} /> : <Empty title={tr('اختر مستخدماً لرؤية البطاقة التفصيلية وإجراء العمليات المصرح بها.', 'Choose a user to view the detailed card and authorized actions.')} />}
        </section>
      </div>
    </div>
  );

  const renderReviews = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('مراجعة اللقطات', 'Snapshot reviews')}</h1><p className="muted">{tr('تحقق من مقدم اللقطة وإصداراتها، ثم قارن النشر الحالي باللقطة المرسلة وافتح المعاينة المحمية قبل القرار.', 'Verify the submitter and versions, compare the current publication with the submitted snapshot, and open the protected preview before deciding.')}</p></div></section>
      <section className="card admin-request-filter"><label className="field"><span>{tr('البحث في طلبات المواقع', 'Search site requests')}</span><input value={reviewQuery} onChange={(event) => setReviewQuery(event.target.value)} placeholder={tr('اسم الموقع أو العضو أو البريد أو C#', 'Site, member, email, or C#')} /></label></section>
      {filteredReviews.length ? filteredReviews.map((review) => {
        const id = idOf(review);
        const expanded = selectedReview && idOf(selectedReview) === id;
        const pending = isPendingReview(review);
        const memberId = text(field(review, 'user_id', 'userId'), '');
        const reviewerId = text(user?.id, '');
        const selfSubmitted = Boolean(memberId && reviewerId && memberId === reviewerId);
        const baseVersion = field(review, 'baseVersion', 'base_version');
        const currentPublishedVersion = field(review, 'currentPublishedVersion', 'current_published_version', 'publishedVersion', 'published_version');
        const stale = knownBoolean(field(review, 'isStale', 'is_stale'));
        const reviewBusy = busy === `review-${id}-approve` || busy === `review-${id}-reject` || busy === `review-${id}-changes`;
        const preview = text(field(review, 'preview_url', 'snapshot_url'), id ? `/api/admin/reviews/${encodeURIComponent(id)}/preview` : '');
        const memberEmail = text(field(review, 'submitter_email', 'email'), '');
        const memberWhatsapp = text(field(review, 'submitter_whatsapp', 'whatsapp')).replace(/\D/g, '');
        const siteName = text(field(review, 'site_name'), '');
        const publicSite = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(siteName) ? `https://${siteName}.ksa.men` : '';
        return <article className="card admin-review" key={id || text(field(review, 'submitted_at'))}>
          <div className="row admin-review-top"><div><h2>{text(field(review, 'site_name', 'name', 'title'))}</h2><p className="muted">{tr('المقدم', 'Submitted by')}: {text(field(review, 'submitter_name', 'user_name', 'email'))} · {asDate(field(review, 'submitted_at', 'created_at'), lang)}</p></div><span className={`admin-status ${statusTone(field(review, 'status'))}`}>{text(field(review, 'status', 'decision'), tr('قيد المراجعة', 'In review'))}</span></div>
          <dl className="admin-review-provenance" aria-label={tr('مصدر اللقطة وحالتها', 'Snapshot provenance and state')}>
            <div><dt>{tr('العضو', 'Member')}</dt><dd>{memberId ? <bdi dir="ltr">C{memberId}</bdi> : tr('غير متاح', 'Unavailable')}</dd></div>
            <div><dt>{tr('الاسم', 'Name')}</dt><dd>{text(field(review, 'submitter_name', 'user_name', 'name', 'email'), tr('غير متاح', 'Unavailable'))}</dd></div>
            <div><dt>{tr('وقت الإرسال', 'Submitted')}</dt><dd>{asDate(field(review, 'submitted_at', 'created_at'), lang)}</dd></div>
            <div><dt>{tr('إصدار الأساس', 'Base version')}</dt><dd><bdi dir="ltr">{text(baseVersion, tr('غير متاح', 'Unavailable'))}</bdi></dd></div>
            <div><dt>{tr('إصدار النشر الحالي', 'Current published version')}</dt><dd><bdi dir="ltr">{text(currentPublishedVersion, tr('غير متاح', 'Unavailable'))}</bdi></dd></div>
            <div><dt>{tr('حالة الأساس', 'Base state')}</dt><dd><span className={`admin-status ${stale === true ? 'danger' : stale === false ? 'success' : 'neutral'}`}>{stale === true ? tr('قديمة — تغيّر النشر', 'Stale — publication changed') : stale === false ? tr('مطابقة للنشر الحالي', 'Matches current publication') : tr('غير متاح', 'Unavailable')}</span></dd></div>
          </dl>
          <details className="admin-review-comparison"><summary className="admin-review-comparison-heading"><strong>{tr('عرض مقارنة اللقطة', 'View snapshot comparison')}</strong><span className="muted">{tr('افتح تفاصيل الحقول عند الحاجة؛ معاينة اللقطة والقرار مستقلان أدناه.', 'Expand field details as needed; preview and decision remain separately accessible below.')}</span></summary><SnapshotDiff review={review} tr={tr} /></details>
          <div className="admin-actions">
            <button className="button button-quiet" type="button" onClick={() => setSelectedReview(expanded ? null : review)}>{expanded ? tr('إخفاء التفاصيل', 'Hide review details') : pending ? tr('فتح منطقة القرار', 'Open decision area') : tr('عرض تفاصيل القرار', 'View decision details')}</button>
            {preview && <a className="button button-quiet" href={preview} target="_blank" rel="noreferrer">{tr('فتح معاينة اللقطة المحمية', 'Open protected snapshot preview')}</a>}
            {publicSite && <a className="button button-quiet" href={publicSite} target="_blank" rel="noreferrer">{tr('معاينة الموقع', 'Preview site')}</a>}
            {memberEmail && <a className="button button-quiet" href={`mailto:${memberEmail}`}>{tr('إرسال بريد', 'Email member')}</a>}
            {memberWhatsapp && <a className="button button-quiet" href={`https://wa.me/${memberWhatsapp}`} target="_blank" rel="noreferrer">{tr('فتح واتساب', 'Open WhatsApp')}</a>}
          </div>
          {selfSubmitted && <div className="admin-review-guard" role="note"><strong>{tr('يلزم مراجعة مستقلة', 'Independent review required')}</strong><span>{tr('هذه اللقطة مقدمة من حسابك؛ لا يمكنك اعتمادها أو رفضها.', 'This snapshot was submitted by your account, so you cannot approve or reject it.')}</span></div>}
          {expanded && <div className="admin-review-detail stack">{pending ? <><label className="field"><span>{tr('سبب القرار أو طلب التعديل', 'Decision or change-request reason')}</span><textarea rows={2} value={reviewReasons[id] ?? ''} onChange={(event) => setReviewReasons((current) => ({ ...current, [id]: event.target.value }))} /></label><div className="admin-actions"><button className="button" type="button" disabled={!id || selfSubmitted || reviewBusy} onClick={() => decideReview(review, 'approve')}>{tr('اعتماد ونشر ذري', 'Approve & publish atomically')}</button><button className="button button-secondary" type="button" disabled={!id || selfSubmitted || reviewBusy} onClick={() => decideReview(review, 'changes')}>{tr('طلب تعديل', 'Request changes')}</button><button className="button button-danger" type="button" disabled={!id || selfSubmitted || reviewBusy} onClick={() => decideReview(review, 'reject')}>{tr('رفض مع السبب', 'Reject with reason')}</button></div>{owner && <div className="admin-site-decision"><label className="field"><span>{tr('سبب تعليق الموقع أو طلب معالجة بياناته', 'Reason to suspend the site or request data handling')}</span><textarea rows={2} value={siteReasons[text(field(review, 'site_id', 'siteId'), '')] ?? ''} onChange={(event) => setSiteReasons((current) => ({ ...current, [text(field(review, 'site_id', 'siteId'), '')]: event.target.value }))} /></label><div className="admin-actions"><button className="button button-secondary" type="button" onClick={() => decideSite(review, 'suspend')}>{tr('تعليق الموقع بسبب', 'Suspend with reason')}</button><button className="button button-danger" type="button" onClick={() => decideSite(review, 'delete_request')}>{tr('تسجيل طلب معالجة البيانات', 'Record a data-handling request')}</button></div></div>}</> : <p className="admin-finality">{tr('لا تظهر أزرار القرار إلا عندما يعيد الخادم حالة «قيد المراجعة».', 'Decision controls are available only while the server returns a pending review.')}</p>}</div>}
        </article>;
      }) : <Empty title={tr('لا توجد لقطات قيد المراجعة.', 'No snapshots are awaiting review.')} />}
    </div>
  );

  const renderPayments = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('سجل الدفعات التاريخي', 'Historical payment record')}</h1><p className="muted">{tr('هذه السجلات محفوظة للمراجعة الداخلية فقط. طلبات العضوية الجديدة لا تستقبل سعراً أو دفعة أو إيصالاً داخل المنصة.', 'These records are retained only for internal review. New membership requests do not collect a price, payment, or receipt inside the platform.')}</p></div></section><div className="admin-payment-grid">{payments.length ? payments.map((payment) => <article className="card admin-payment" key={idOf(payment)}><div className="row"><div><h2>{tr('سجل موثق', 'Documented record')} #{idOf(payment)}</h2><p className="muted">C{text(field(payment, 'user_id', 'customer_id'))} · {asDate(field(payment, 'created_at', 'submitted_at'), lang)}</p></div><span className={`admin-status ${statusTone(field(payment, 'status', 'decision'))}`}>{text(field(payment, 'status', 'decision'))}</span></div></article>) : <Empty title={tr('لا توجد سجلات دفعات ضمن التفويض المتاح.', 'No payment records were returned in the available authorization scope.')} />}</div></div>
  );

  const renderServices = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('محرك الخدمات والاستحقاقات', 'Services & entitlements')}</h1><p className="muted">{owner ? tr('اضبط مصادر الاستحقاق لكل خدمة واحفظ التغييرات صراحة. تظل حالة الخدمة العامة وإعداداتها الأخرى محفوظة مع كل تحديث.', 'Set the entitlement sources for each service and save changes explicitly. The global service state and every other setting are retained with each update.') : tr('تظهر حالة الخدمات العامة ضمن نطاقك. إعداد مصادر الاستحقاق محصور بالمالك.', 'Global service status is shown within your scope. Entitlement-source settings are reserved for the owner.')}</p></div></section>
      <div className="admin-service-grid">{services.length ? services.map((service) => {
        const key = text(field(service, 'key', 'id'), '');
        const enabled = Boolean(field(service, 'enabled', 'is_enabled'));
        const name = lang === 'ar' ? text(field(service, 'name_ar', 'name', 'title', 'key')) : text(field(service, 'name_en', 'name', 'title', 'key'));
        const loadedPolicy = record(field(service, 'policy')) ?? {};
        const policy = servicePolicies[key] ?? loadedPolicy;
        const savePolicy = () => void mutate(`service-${key}`, () => api(`/api/admin/services/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ enabled, policy }) }), { fresh: true, success: tr('حُفظت سياسة الاستحقاق للخدمة.', 'The service entitlement policy was saved.') });
        return <article className="card admin-service" key={key}><div><h2>{name}</h2><p className="admin-service-key">{key}</p></div><div className="row"><span className={`admin-status ${enabled ? 'success' : 'danger'}`}>{enabled ? tr('مفعلة عالمياً', 'Globally enabled') : tr('معلقة عالمياً', 'Globally paused')}</span>{owner && <button type="button" className="button button-quiet" disabled={!key || busy === `service-${key}`} onClick={() => void mutate(`service-${key}`, () => api(`/api/admin/services/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled, policy }) }), { fresh: true, success: enabled ? tr('تم تعليق الخدمة عالمياً.', 'The service was paused globally.') : tr('تمت إعادة تفعيل الخدمة عالمياً.', 'The service was enabled globally.') })}>{enabled ? tr('تعليق', 'Pause') : tr('إعادة تفعيل', 'Re-enable')}</button>}</div>{owner && <form className="admin-service-policy" onSubmit={(event) => { event.preventDefault(); if (!key) { setError(tr('تعذر تحديد مفتاح الخدمة للحفظ.', 'The service key is unavailable, so this policy cannot be saved.')); return; } savePolicy(); }}><fieldset className="admin-policy-fieldset"><legend>{tr('مصادر الاستحقاق', 'Entitlement sources')}</legend><p className="admin-policy-help">{tr('اختر الطرق التي تمنح الوصول إلى هذه الخدمة.', 'Choose which sources may grant access to this service.')}</p><div className="admin-policy-chips">{entitlementPolicySources.map((source) => { const allowed = policy[source.key] !== false; return <label className="admin-policy-chip" key={source.key}><input type="checkbox" checked={allowed} onChange={(event) => setServicePolicies((current) => ({ ...current, [key]: { ...(current[key] ?? loadedPolicy), [source.key]: event.target.checked } }))} /><span>{tr(source.ar, source.en)}</span></label>; })}</div></fieldset><button className="button" type="submit" disabled={!key || busy === `service-${key}`}>{busy === `service-${key}` ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ سياسة الخدمة', 'Save service policy')}</button></form>}</article>;
      }) : <Empty title={tr('لا يوجد كتالوج خدمات معروض.', 'No service catalog was returned.')} />}</div>
    </div>
  );

  const renderNames = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('الأسماء المحجوزة والنقل', 'Reserved names & transfers')}</h1><p className="muted">{tr('الأسماء التقنية المرتبطة بتشغيل المنصة لا تتاح لتحرير الواجهة، كما لا ينتقل محتوى الموقع مع ملكية الاسم.', 'Technical names used by the platform are not releasable from the UI, and site content never moves with name ownership.')}</p></div></section>
      <section className="admin-grid admin-grid-2">
        <div className="card stack"><h2>{tr('حجز اسم', 'Reserve a name')}</h2><form className="stack" onSubmit={(event) => { event.preventDefault(); if (!nameForm.name || !nameForm.reason) return; void mutate('reserve-name', () => api('/api/admin/names', { method: 'POST', body: JSON.stringify(nameForm) }), { fresh: true, success: tr('تم حجز الاسم مع سبب السياسة.', 'The name was reserved with its policy reason.') }).then((result) => { if (result !== undefined) setNameForm({ name: '', kind: 'policy', reason: '' }); }); }}><label className="field"><span>{tr('الاسم', 'Name')}</span><input value={nameForm.name} onChange={(event) => setNameForm((value) => ({ ...value, name: event.target.value.toLowerCase() }))} pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" required /></label><label className="field"><span>{tr('النوع', 'Kind')}</span><select value={nameForm.kind} onChange={(event) => setNameForm((value) => ({ ...value, kind: event.target.value }))}><option value="policy">{tr('سياسة', 'Policy')}</option><option value="technical">{tr('تقني', 'Technical')}</option></select></label><label className="field"><span>{tr('السبب', 'Reason')}</span><textarea rows={2} value={nameForm.reason} onChange={(event) => setNameForm((value) => ({ ...value, reason: event.target.value }))} required /></label><button className="button" disabled={busy === 'reserve-name'}>{tr('حجز الاسم', 'Reserve name')}</button></form></div>
        <div className="card stack"><h2>{tr('طلبات النقل المقبولة من المستفيد', 'Recipient-accepted transfer requests')}</h2>{transfers.length ? transfers.map((transfer) => { const id = idOf(transfer); const accepted = text(field(transfer, 'status'), '').toLowerCase() === 'accepted'; return <div className="admin-transfer" key={id}><div><strong>{text(field(transfer, 'name'))}</strong><p className="muted">{text(field(transfer, 'from_name', 'from_user', 'sender'))} → {text(field(transfer, 'to_name', 'to_user', 'recipient'))}</p></div><span className={`admin-status ${statusTone(field(transfer, 'status'))}`}>{text(field(transfer, 'status'))}</span>{accepted && <div className="admin-actions"><button className="button button-quiet" type="button" disabled={!id || busy === `transfer-${id}-approve`} onClick={() => void mutate(`transfer-${id}-approve`, () => api(`/api/admin/transfers/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), { fresh: true, success: tr('تم تسجيل اعتماد النقل وفصل المحتوى عن الاسم.', 'The transfer approval was recorded and content remains separate from the name.') })}>{tr('اعتماد', 'Approve')}</button><button className="button button-danger" type="button" disabled={!id || busy === `transfer-${id}-reject`} onClick={() => void mutate(`transfer-${id}-reject`, () => api(`/api/admin/transfers/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }), { fresh: true, success: tr('تم تسجيل رفض النقل.', 'The transfer rejection was recorded.') })}>{tr('رفض', 'Reject')}</button></div>}</div>; }) : <Empty title={tr('لا توجد طلبات نقل.', 'No transfer requests were returned.')} />}</div>
      </section>
      <section className="card stack"><h2>{tr('سجل الأسماء المحجوزة', 'Reserved-name registry')}</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{tr('الاسم', 'Name')}</th><th>{tr('النوع', 'Kind')}</th><th>{tr('السبب', 'Reason')}</th><th>{tr('الإجراء', 'Action')}</th></tr></thead><tbody>{names.length ? names.map((name) => { const nameText = text(field(name, 'name'), ''); const kind = text(field(name, 'kind', 'type'), '').toLowerCase(); const technical = kind === 'technical' || Boolean(field(name, 'technical', 'immutable')); return <tr key={nameText}><td>{nameText}</td><td><span className={`admin-status ${technical ? 'danger' : 'neutral'}`}>{technical ? tr('تقني / غير قابل للتحرير', 'Technical / immutable') : text(field(name, 'kind', 'type'))}</span></td><td>{text(field(name, 'reason'))}</td><td>{technical ? <span className="muted">{tr('محمي للتشغيل', 'Protected for operation')}</span> : <button className="button button-danger button-small" type="button" disabled={busy === `release-${nameText}`} onClick={() => void mutate(`release-${nameText}`, () => api(`/api/admin/names/${encodeURIComponent(nameText)}/release`, { method: 'POST' }), { fresh: true, success: tr('تم تحرير الاسم المحجوز.', 'The reserved name was released.') })}>{tr('تحرير', 'Release')}</button>}</td></tr>; }) : <tr><td colSpan={4}>{tr('لا توجد أسماء محجوزة.', 'No reserved names were returned.')}</td></tr>}</tbody></table></div></section>
    </div>
  );

  const renderContent = () => {
    const selected = contentSlugs.find(([slug]) => slug === contentSlug);
    const ready = content.title_ar.trim().length > 0 && content.title_en.trim().length > 0 && content.body_ar.trim().length >= 20 && content.body_en.trim().length >= 20;
    return <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('المحتوى والتحرير', 'Content editing')}</h1><p className="muted">{tr('محرر ثنائي اللغة للمحتوى المحدد فقط: من نحن، النصوص القانونية، المدونة، الحملات، التواصل والتذييل. لا يُنشئ بيانات رسمية أو اعتماداً قانونياً.', 'A bilingual editor for the selected content only: about, legal copy, journal, campaigns, contact and footer. It does not invent official data or legal approval.')}</p></div></section>
      <section className="admin-content-layout">
        <div className="card admin-content-nav">{contentSlugs.map(([slug, ar, en]) => <button type="button" className={contentSlug === slug ? 'active' : ''} onClick={() => setContentSlug(slug)} key={slug}>{tr(ar, en)}</button>)}</div>
        <div className="card stack"><div className="row"><div><h2>{tr(selected?.[1] ?? '', selected?.[2] ?? '')}</h2><p className="muted">{contentMeta?.state === 'new' ? tr('لا توجد نسخة منشورة أعادها المسار العام؛ ستنشأ فقط عند الحفظ الصريح.', 'The public route returned no published version; one is created only after an explicit save.') : `${tr('آخر نسخة أعادها المسار العام', 'Last version returned by the public route')}: ${asDate(field(contentMeta, 'updated_at', 'updatedAt'), lang)}`}</p></div></div><div className="admin-content-fields"><label className="field"><span>{tr('العنوان العربي', 'Arabic title')}</span><input value={content.title_ar} onChange={(event) => setContent((value) => ({ ...value, title_ar: event.target.value }))} /></label><label className="field"><span>{tr('العنوان الإنجليزي', 'English title')}</span><input dir="ltr" value={content.title_en} onChange={(event) => setContent((value) => ({ ...value, title_en: event.target.value }))} /></label><label className="field"><span>{tr('النص العربي', 'Arabic body')}</span><textarea className="admin-content-editor" rows={14} value={content.body_ar} onChange={(event) => setContent((value) => ({ ...value, body_ar: event.target.value }))} /></label><label className="field"><span>{tr('النص الإنجليزي', 'English body')}</span><textarea className="admin-content-editor" dir="ltr" rows={14} value={content.body_en} onChange={(event) => setContent((value) => ({ ...value, body_en: event.target.value }))} /></label></div><div className="admin-actions"><button className="button" type="button" disabled={!ready || busy === `content-${contentSlug}`} onClick={() => void mutate(`content-${contentSlug}`, () => api(`/api/admin/content/${encodeURIComponent(contentSlug)}`, { method: 'PUT', body: JSON.stringify({ content }) }), { fresh: true, reload: false, success: tr('حُفظت حقول المحتوى عبر مسار الإدارة.', 'The content fields were saved through the administration route.') }).then((response) => { if (response !== undefined) { const payload = record(response); setContentMeta(record(field(payload, 'content')) ?? payload); } })}>{tr('حفظ المحتوى المنشور', 'Save published content')}</button>{!ready && <span className="admin-route-note">{tr('العنوانان مطلوبان، ويجب ألا يقل كل نص عن ٢٠ حرفاً وفق تحقق الخادم.', 'Both titles are required and each body must have at least 20 characters under server validation.')}</span>}</div></div>
      </section>
      <SeasonPanel tr={tr} seasonal={seasonal} setSeasonal={setSeasonal} busy={busy} setError={setError} onSave={() => {
        const startsAt = riyadhInputToEpoch(seasonal.startsAt);
        const endsAt = riyadhInputToEpoch(seasonal.endsAt);
        if (seasonal.enabled && (!startsAt || !endsAt || endsAt <= startsAt)) {
          setError(tr('للتفعيل، أدخل نافذة زمنية صحيحة ومتزايدة بتوقيت الرياض.', 'To enable, provide a valid ascending time window in Riyadh time.'));
          return;
        }
        void mutate('seasonal', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'season', value: { enabled: seasonal.enabled, occasion: seasonal.occasion, starts_at: startsAt, ends_at: endsAt } }) }), { fresh: true, success: tr('حُفظت جدولة المظهر الموسمي بتوقيت الرياض.', 'The seasonal appearance schedule was saved in Riyadh time.') });
      }} />
    </div>;
  };

  const renderPricing = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('التسعير الداخلي', 'Internal pricing')}</h1><p className="muted">{tr('تعرض هذه المساحة قيمة إعداد prices كما يعيدها الخادم فقط. لا توجد قيمة أو عملة أو خطة افتراضية مخترعة في الواجهة.', 'This space renders only the prices setting returned by the server. No amount, currency or plan is invented by the UI.')}</p></div></section><section className="card stack"><label className="field"><span>{tr('إعداد التسعير بصيغة JSON', 'Pricing setting as JSON')}</span><textarea className="admin-content-editor admin-price-editor" dir="ltr" rows={16} value={prices} onChange={(event) => setPrices(event.target.value)} spellCheck={false} placeholder={tr('لا توجد قيمة محملة بعد.', 'No value has been loaded yet.')} /></label><div className="admin-actions"><button className="button" type="button" disabled={!prices.trim() || busy === 'prices'} onClick={() => { const value = parseObject(prices); if (!value) { setError(tr('إعداد التسعير يجب أن يكون كائن JSON صحيحاً؛ لم يُرسل شيء.', 'Pricing must be a valid JSON object; nothing was sent.')); return; } void mutate('prices', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'prices', value }) }), { fresh: true, success: tr('حُفظ إعداد التسعير الداخلي.', 'The internal pricing setting was saved.') }); }}>{tr('حفظ إعداد التسعير', 'Save pricing setting')}</button><span className="admin-route-note">{tr('لا تفعل هذه الواجهة خدمة دفع ولا تنشئ اشتراكاً؛ مسار الدفع والاعتماد منفصل.', 'This UI does not activate a payment service or create a subscription; payment and approval are separate routes.')}</span></div></section></div>
  );

  const renderLock = () => {
    const bankData = field(record(data.settings), 'bank_instructions', 'bank', 'payment_instructions');
    const lockReady = settingsLoaded && Boolean(lock.mode);
    return <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('قفل المنصة وإعدادات التشغيل', 'Platform lock & operating settings')}</h1><p className="muted">{tr('لا تُفترض حالة القفل من الواجهة. تبقى عناصر التعديل معطلة حتى تعيد إعدادات الخادم الحالية، وكلمة المرور الفارغة تحافظ على تجزئتها الحالية.', 'The lock state is never assumed by the UI. Edit controls remain disabled until current server settings return, and a blank password retains the current hash.')}</p></div></section><section className="admin-grid admin-grid-2"><form className="card stack" onSubmit={(event) => { event.preventDefault(); if (!lockReady) return; const value: JsonRecord = { mode: lock.mode, reason: lock.reason, message: lock.message }; if (lock.password) value.password = lock.password; void mutate('platform-lock', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'lock', value }) }), { fresh: true, success: tr('أُرسل وضع القفل المحمّل من الخادم للحفظ.', 'The server-loaded lock mode was sent for saving.') }).then((result) => { if (result !== undefined) setLock((current) => ({ ...current, password: '' })); }); }}><div><h2>{tr('وضع القفل', 'Lock mode')}</h2><p className="muted">{tr('البوابة لا تمنح مصادقة أو وصولاً إلى بيانات خاصة، ولا تتجاوز حماية API.', 'The gate grants neither authentication nor private-data access and cannot bypass API protection.')}</p></div>{!lockReady && <div className="admin-unavailable">{tr('لم تُحمّل حالة القفل من الخادم بعد؛ لا يمكن الحفظ بأية قيمة افتراضية.', 'The server lock state has not loaded; no default value can be saved.')}</div>}<label className="field"><span>{tr('النطاق', 'Scope')}</span><select value={lock.mode} disabled={!lockReady} onChange={(event) => setLock((value) => ({ ...value, mode: event.target.value }))}>{lockModes.map(([value, ar, en]) => <option value={value} key={value}>{tr(ar, en)}</option>)}</select></label><label className="field"><span>{tr('سبب الإغلاق', 'Lock reason')}</span><input disabled={!lockReady} value={lock.reason} onChange={(event) => setLock((value) => ({ ...value, reason: event.target.value }))} /></label><label className="field"><span>{tr('نص بطاقة القفل', 'Lock card message')}</span><textarea disabled={!lockReady} rows={3} value={lock.message} onChange={(event) => setLock((value) => ({ ...value, message: event.target.value }))} /></label><label className="field"><span>{tr('كلمة مرور الوصول الخاص', 'Private access password')}</span><input disabled={!lockReady} type="password" autoComplete="new-password" value={lock.password} placeholder={tr('اتركها فارغة للاحتفاظ بالقيمة الحالية', 'Leave blank to preserve the current value')} onChange={(event) => setLock((value) => ({ ...value, password: event.target.value }))} /></label><button className="button" disabled={!lockReady || busy === 'platform-lock'}>{tr('حفظ القفل', 'Save lock')}</button></form><section className="card stack"><div><h2>{tr('بيانات الحوالة الرسمية', 'Official bank transfer details')}</h2><p className="muted">{tr('لا تُخترع بيانات بنكية. عند غيابها يعرض النظام الغياب ولا يوجّه المستخدم لجهة مجهولة.', 'Bank data is never invented. When absent, the system displays that absence and does not direct users to an unknown recipient.')}</p></div>{bankData === undefined || bankData === null || bankData === '' ? <div className="admin-unavailable">{tr('لم يرد من الإعدادات أي بيانات بنكية رسمية.', 'No official bank information was returned in settings.')}</div> : <pre className="admin-bank-info">{settingText(bankData)}</pre>}<label className="field"><span>{tr('إدخال/تحديث التعليمات البنكية الرسمية فقط', 'Enter/update official bank instructions only')}</span><textarea rows={7} value={bankInstructions} onChange={(event) => setBankInstructions(event.target.value)} placeholder={tr('أدخل بيانات الجهة الرسمية المتحققة فقط', 'Enter verified official recipient details only')} /></label><button type="button" className="button" disabled={!bankInstructions.trim() || busy === 'bank-instructions'} onClick={() => void mutate('bank-instructions', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'bank', value: bankInstructions }) }), { fresh: true, success: tr('حُفظت التعليمات البنكية كما أُدخلت.', 'The bank instructions were saved as entered.') })}>{tr('حفظ التعليمات الرسمية', 'Save official instructions')}</button><p className="muted">{tr('لا تدخل إلا بيانات رسمية متحققة. لا تعيد الواجهة صياغتها ولا تخمنها.', 'Enter verified official data only. The UI neither rewrites nor guesses it.')}</p></section></section></div>;
  };

  const renderEconomics = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('اقتصاديات المنصة', 'Platform economics')}</h1><p className="muted">{tr('كل مؤشر يأتي من بيانات النظام. التكلفة أو الربحية غير المتاحة تبقى «غير متاح» ولا تتحول إلى تقدير.', 'Every metric comes from system data. An unavailable cost or profitability value remains unavailable and is never turned into an estimate.')}</p></div></section><section className="admin-metrics">{economicMetrics.map(([key, ar, en]) => <article className="admin-metric card" key={key}><span className="muted">{tr(ar, en)}</span><strong>{text(valueAt(data.economics, key), tr('غير متاح', 'Unavailable'))}</strong></article>)}</section><section className="admin-grid admin-grid-2"><div className="card stack"><h2>{tr('تسجيل مصروف يدوي', 'Record a manual expense')}</h2><p className="muted">{tr('الإدخال يضيف سجلاً تدقيقياً ولا يختلق تكلفة استهلاك.', 'This input adds an audit record; it does not fabricate a usage cost.')}</p><form className="stack" onSubmit={(event) => { event.preventDefault(); const amount = Number(expense.amount); if (!expense.label.trim() || !Number.isFinite(amount) || amount <= 0) return; void mutate('expense', () => api('/api/admin/expenses', { method: 'POST', body: JSON.stringify({ label: expense.label, amount, notes: expense.notes }) }), { fresh: true, success: tr('تم تسجيل المصروف.', 'The expense was recorded.') }).then((result) => { if (result !== undefined) setExpense({ label: '', amount: '', notes: '' }); }); }}><label className="field"><span>{tr('الوصف', 'Description')}</span><input value={expense.label} onChange={(event) => setExpense((value) => ({ ...value, label: event.target.value }))} /></label><label className="field"><span>{tr('المبلغ', 'Amount')}</span><input inputMode="decimal" value={expense.amount} onChange={(event) => setExpense((value) => ({ ...value, amount: event.target.value }))} /></label><label className="field"><span>{tr('ملاحظات', 'Notes')}</span><textarea rows={2} value={expense.notes} onChange={(event) => setExpense((value) => ({ ...value, notes: event.target.value }))} /></label><button className="button" disabled={busy === 'expense'}>{tr('تسجيل المصروف', 'Record expense')}</button></form></div><div className="card stack"><h2>{tr('خزينة النقاط', 'Points treasury')}</h2><p className="muted">{tr('إصدار النقاط هدفه مستخدم محدد فقط، يمر عبر دفتر الأستاذ ويتطلب التفويض المالي الفعلي.', 'Point issuance is targeted to one user, passes through the ledger and requires actual financial authorization.')}</p><button className="button" type="button" disabled={!financialOperator} onClick={() => switchTab('users')}>{financialOperator ? tr('فتح إصدار النقاط للمستخدم', 'Open user point issuance') : tr('تفويض مالي مطلوب', 'Financial delegation required')}</button><p className="admin-finality">{tr('لا يوجد إصدار جماعي أو رصيد تخميني في هذه الواجهة.', 'There is no bulk issuance or estimated balance in this console.')}</p></div></section></div>
  );

  const renderMembership = () => {
    const matching = membershipRequests.filter((request) => {
      const status = text(field(request, 'status'), '').toLowerCase();
      const haystack = [field(request, 'name'), field(request, 'email'), field(request, 'user_id'), field(request, 'subdomain'), field(request, 'kind')].map((value) => text(value, '').toLowerCase()).join(' ');
      return (!membershipStatus || status === membershipStatus) && (!membershipQuery.trim() || haystack.includes(membershipQuery.trim().toLowerCase()));
    });
    return <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('طلبات العضوية', 'Membership requests')}</h1><p className="muted">{tr('اعتمد تمديد الفترة المجانية أو فعّل العضوية السنوية بعد تحققك الخارجي. كل قرار يصل للعضو في لوحة حسابه وبريده عند تهيئة قناة الإرسال.', 'Approve a free-period extension or activate annual membership after your external verification. Every decision reaches the member in the account console and by email when delivery is configured.')}</p></div></section><section className="card admin-request-filter"><label className="field"><span>{tr('البحث بالاسم أو البريد أو C# أو النطاق', 'Search name, email, C#, or subdomain')}</span><input value={membershipQuery} onChange={(event) => setMembershipQuery(event.target.value)} /></label><label className="field"><span>{tr('الحالة', 'Status')}</span><select value={membershipStatus} onChange={(event) => setMembershipStatus(event.target.value)}><option value="pending">{tr('قيد المراجعة', 'Pending')}</option><option value="approved">{tr('معتمد', 'Approved')}</option><option value="changes_requested">{tr('مطلوب توضيح', 'Changes requested')}</option><option value="rejected">{tr('مرفوض', 'Rejected')}</option><option value="">{tr('كل الحالات', 'All statuses')}</option></select></label></section><section className="admin-membership-grid">{matching.length ? matching.map((request) => { const id = idOf(request); const pending = text(field(request, 'status'), '').toLowerCase() === 'pending'; const annual = field(request, 'kind') === 'annual_contact'; return <article className="card admin-membership-card" key={id}><header><div><p className="admin-eyebrow">{annual ? tr('عضوية سنوية', 'ANNUAL MEMBERSHIP') : tr('تمديد الفترة المجانية', 'FREE PERIOD EXTENSION')}</p><h2>{text(field(request, 'name', 'email'))}</h2><p className="muted">C{text(field(request, 'user_id'))} · {text(field(request, 'email'))}</p></div><span className={`admin-status ${statusTone(field(request, 'status'))}`}>{text(field(request, 'status'))}</span></header><dl className="admin-key-values compact"><div><span>{tr('النطاق', 'Subdomain')}</span><strong>{text(field(request, 'subdomain'))}</strong></div><div><span>{tr('وقت الطلب', 'Requested')}</span><strong>{asDate(field(request, 'created_at'), lang)}</strong></div><div><span>{tr('نهاية الفترة الحالية', 'Current entitlement ends')}</span><strong>{asDate(field(request, 'entitlement_until', 'trial_until'), lang)}</strong></div></dl>{text(field(request, 'member_note'), '') !== '' && <p className="admin-member-note">{text(field(request, 'member_note'))}</p>}{pending ? <><label className="field"><span>{tr('سبب القرار أو التوضيح', 'Decision or clarification reason')}</span><textarea rows={2} value={membershipReasons[id] ?? ''} onChange={(event) => setMembershipReasons((current) => ({ ...current, [id]: event.target.value }))} /></label><div className="admin-actions"><button className="button" type="button" disabled={busy === `membership-${id}-approve`} onClick={() => decideMembership(request, 'approve')}>{annual ? tr('تفعيل سنة', 'Activate one year') : tr('اعتماد التمديد', 'Approve extension')}</button><button className="button button-secondary" type="button" disabled={Boolean(busy?.startsWith(`membership-${id}-`))} onClick={() => decideMembership(request, 'changes_requested')}>{tr('طلب توضيح', 'Request clarification')}</button><button className="button button-danger" type="button" disabled={Boolean(busy?.startsWith(`membership-${id}-`))} onClick={() => decideMembership(request, 'reject')}>{tr('رفض', 'Reject')}</button></div></> : <p className="admin-finality">{text(field(request, 'admin_reason'), tr('تم تسجيل القرار.', 'The decision is recorded.'))}</p>}</article>; }) : <Empty title={tr('لا توجد طلبات مطابقة للفلترة الحالية.', 'No requests match the current filter.')} />}</section></div>;
  };

  const renderGovernance = () => {
    const summary = (governance ?? {}) as JsonRecord;
    const backup = record(summary?.backup);
    const chain = record(summary?.auditChain);
    const dsar = record(summary?.dsar);
    const ropa = Array.isArray(summary?.ropa) ? summary?.ropa as JsonRecord[] : [];
    const averageSeconds = Number(dsar?.averageResolutionSeconds);
    const averageDuration = Number.isFinite(averageSeconds) && averageSeconds >= 0
      ? averageSeconds >= 86_400 ? `${(averageSeconds / 86_400).toFixed(1)} ${tr('يوم', 'days')}` : `${Math.max(1, Math.round(averageSeconds / 3_600))} ${tr('ساعة', 'hours')}`
      : tr('غير متاح', 'Unavailable');
    const reportSummary = record(governanceReport?.governance);
    const reportBackup = record(reportSummary?.backup);
    const reportChain = record(reportSummary?.auditChain);
    const reportDsar = record(reportSummary?.dsar);
    return <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('الحوكمة ومؤشرات الجودة', 'Governance & quality')}</h1><p className="muted">{tr('ملخص خاص بالمالك عن سلامة السجل والنسخ وطلبات الحقوق وسجل أنشطة المعالجة. لا يعرض محتوى الملفات أو المحادثات الخاصة.', 'An owner-only summary of trail integrity, backups, rights requests, and processing activities. It does not display private file or conversation content.')}</p></div></section><section className="admin-metrics admin-governance-metrics"><article className="admin-metric card"><span>{tr('سلامة سلسلة السجل', 'Audit-chain integrity')}</span><strong>{chain?.valid === true ? tr('سليمة', 'Valid') : chain?.available === false ? tr('غير متاحة', 'Unavailable') : tr('تحتاج مراجعة', 'Needs review')}</strong><small>{tr('صفوف مفحوصة', 'Rows checked')}: {text(chain?.checkedRows)}</small></article><article className="admin-metric card"><span>{tr('آخر نسخة محفوظة', 'Latest saved backup')}</span><strong>{backup?.ageSeconds === null || backup?.ageSeconds === undefined ? tr('غير متاح', 'Unavailable') : `${Math.floor(Number(backup.ageSeconds) / 3600)} ${tr('ساعة', 'hours')}`}</strong><small>{tr('عدد النسخ', 'Snapshots')}: {text(backup?.count)}</small></article><article className="admin-metric card"><span>{tr('طلبات الحقوق والخصوصية', 'Rights & privacy requests')}</span><strong>{text(dsar?.total, '0')}</strong><small>{tr('متوسط مدة المعالجة', 'Average handling time')}: {averageDuration}</small></article></section><section className="card admin-governance-report"><div className="admin-section-heading"><div><h2>{tr('تقرير امتثال رسمي محدد النطاق', 'Official scoped compliance report')}</h2><p className="muted">{tr('يُنشأ الملخص بعد إعادة التحقق ويُسجل إنشاؤه في سجل الحوكمة.', 'This summary is generated after fresh verification and its creation is recorded in the governance trail.')}</p></div><button className="button" type="button" disabled={busy === 'governance-report'} onClick={generateGovernanceReport}>{tr('إنشاء التقرير', 'Generate report')}</button></div>{governanceReport && <dl className="admin-report-summary"><div><dt>{tr('وقت الإنشاء', 'Generated')}</dt><dd>{asDate(governanceReport.generatedAt, lang)}</dd></div><div><dt>{tr('سلامة السجل', 'Trail integrity')}</dt><dd>{reportChain?.valid === true ? tr('سليمة', 'Valid') : tr('تحتاج مراجعة', 'Needs review')}</dd></div><div><dt>{tr('عمر آخر نسخة', 'Latest backup age')}</dt><dd>{reportBackup?.ageSeconds === null || reportBackup?.ageSeconds === undefined ? tr('غير متاح', 'Unavailable') : `${Math.floor(Number(reportBackup.ageSeconds) / 3600)} ${tr('ساعة', 'hours')}`}</dd></div><div><dt>{tr('إجمالي طلبات الحقوق', 'Total rights requests')}</dt><dd>{text(reportDsar?.total, '0')}</dd></div><div><dt>{tr('متوسط مدة المعالجة', 'Average handling time')}</dt><dd>{averageDuration}</dd></div><div><dt>{tr('نطاق التقرير', 'Report scope')}</dt><dd>{text(governanceReport.scope, tr('الحوكمة والجودة', 'Governance and quality'))}</dd></div></dl>}</section><section className="card admin-ropa"><div className="admin-section-heading"><div><h2>{tr('سجل أنشطة المعالجة', 'Processing-activity register')}</h2><p className="muted">{tr('المسجل في النظام الحالي.', 'Recorded in the current system.')}</p></div></div>{ropa.length ? <div className="admin-ropa-list">{ropa.map((item) => <article key={idOf(item)}><strong>{text(field(item, 'activity'))}</strong><span>{text(field(item, 'purpose'))}</span><small>{text(field(item, 'legal_basis'))} · {text(field(item, 'retention_policy'))}</small></article>)}</div> : <Empty title={tr('لا توجد أنشطة معالجة معادة من السجل.', 'No processing activities were returned from the register.')} />}</section></div>;
  };

  const renderAudit = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('سجل التدقيق', 'Audit trail')}</h1><p className="muted">{tr('سجل للعمليات الحساسة؛ لا يمنح اطلاعاً على الرسائل أو الملفات الخاصة.', 'A trail for sensitive operations; it does not grant access to private messages or files.')}</p></div></section><section className="card admin-table-wrap"><table className="admin-table"><thead><tr><th>{tr('الوقت', 'Time')}</th><th>{tr('الإجراء', 'Action')}</th><th>{tr('الهدف', 'Target')}</th><th>{tr('بواسطة', 'By')}</th><th>{tr('التفاصيل', 'Details')}</th></tr></thead><tbody>{audit.length ? audit.map((entry, index) => <tr key={`${idOf(entry)}-${index}`}><td>{asDate(field(entry, 'created_at', 'at', 'timestamp'), lang)}</td><td>{text(field(entry, 'action'))}</td><td>{text(field(entry, 'target', 'target_id'))}</td><td>{text(field(entry, 'actor_name', 'actor', 'user_id'))}</td><td><span className="admin-detail-text">{displayJson(field(entry, 'detail', 'details', 'reason'))}</span></td></tr>) : <tr><td colSpan={5}>{tr('لا توجد أحداث تدقيق معروضة.', 'No audit events were returned.')}</td></tr>}</tbody></table></section></div>
  );

  const renderBackup = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('النسخ الاحتياطية المشفرة', 'Encrypted backups')}</h1><p className="muted">{tr('هذه الواجهة تستخدم فقط مسارات النسخ المؤكدة: القائمة، الإنشاء، التنزيل الآمن، تنزيل الملف المشفر وفحص السلامة بعد تحقق حديث. لا توجد استعادة إنتاجية من المتصفح.', 'This UI uses only confirmed backup routes: list, create, sanitized download, encrypted download and integrity verification after fresh verification. There is no production restore from the browser.')}</p></div></section><section className="card stack"><div className="admin-backup-card"><div className="admin-backup-mark">SHA</div><div className="stack"><h2>{tr('نسخ التخزين الحالية', 'Current stored snapshots')}</h2><p className="muted">{tr('لا تفترض الواجهة جدولة ليلية؛ تعرض فقط النسخ التي يعيدها مسار التخزين.', 'The UI does not assume a nightly schedule; it renders only snapshots returned by the storage route.')}</p><div className="admin-actions"><button className="button" type="button" disabled={busy === 'backup-create'} onClick={() => void mutate('backup-create', () => api<unknown>('/api/admin/backups/create', { method: 'POST' }), { fresh: true, reload: false, success: tr('أُنشئت نسخة مشفرة عبر المسار المصرح.', 'An encrypted snapshot was created through the authorized route.') }).then((response) => { if (response !== undefined) void loadBackups(); })}>{tr('إنشاء نسخة الآن', 'Create snapshot now')}</button><button className="button button-quiet" type="button" disabled={busy === 'backups-list'} onClick={() => void loadBackups()}>{tr('تحديث القائمة', 'Refresh list')}</button></div></div></div>{!backupsLoaded ? <p className="muted">{tr('جارٍ طلب قائمة النسخ…', 'Requesting the backup list…')}</p> : nightlyBackups.length ? <div className="admin-backup-list">{nightlyBackups.map((backup) => { const verified = backupVerification[backup.id]; return <article className="admin-backup-item" key={backup.id}><div><strong>{asDate(backup.createdAt, lang)}</strong><p className="admin-mono">SHA-256: {text(backup.sha256, tr('لم ترد بصمة', 'No checksum returned'))}</p><p className="muted">{typeof backup.bytes === 'number' ? `${backup.bytes.toLocaleString()} B` : tr('الحجم غير متاح', 'Size unavailable')}</p>{verified && <div className="admin-verify-result"><strong>{field(verified, 'verified') === true ? tr('نجح فحص السلامة', 'Integrity check passed') : tr('نتيجة فحص السلامة', 'Integrity check result')}</strong><span>SHA-256: {text(field(verified, 'sha256'), tr('غير متاح', 'Unavailable'))}</span><span>{tr('الجداول', 'Tables')}: {text(field(verified, 'tableCount'), tr('غير متاح', 'Unavailable'))} · {tr('الصفوف', 'Rows')}: {text(field(verified, 'rowCount'), tr('غير متاح', 'Unavailable'))} · {tr('وسائط مفقودة', 'Missing media')}: {text(field(verified, 'missingMedia'), tr('غير متاح', 'Unavailable'))}</span></div>}</div><div className="admin-backup-actions"><a className="button button-quiet" href={`/api/admin/backups/${encodeURIComponent(backup.id)}`}>{tr('تنزيل JSON الآمن', 'Download sanitized JSON')}</a><a className="button button-quiet" href={`/api/admin/backups/${encodeURIComponent(backup.id)}/encrypted`}>{tr('تنزيل KSAB المشفر', 'Download encrypted KSAB')}</a><button className="button button-secondary" type="button" disabled={busy === `backup-verify-${backup.id}`} onClick={() => void mutate(`backup-verify-${backup.id}`, () => api<unknown>(`/api/admin/backups/${encodeURIComponent(backup.id)}/verify`, { method: 'POST' }), { fresh: true, reload: false, success: tr('اكتمل فحص سلامة النسخة.', 'Snapshot integrity verification completed.') }).then((response) => { if (response !== undefined) setBackupVerification((current) => ({ ...current, [backup.id]: record(response) })); })}>{tr('تحقق من السلامة', 'Verify integrity')}</button></div></article>; })}</div> : <Empty title={tr('لم تعد قائمة النسخ أي لقطة محفوظة.', 'The backup list returned no stored snapshot.')} />}<div className="admin-unavailable"><strong>{tr('الاستعادة الإنتاجية', 'Production restore')}</strong><span>{tr('فحص السلامة يثبت إمكانية فك تشفير النسخة وبصمتها فقط، ولا يكتب أي بيانات. الاستعادة المعزولة تتم خارج المتصفح ولا يوجد POST/PATCH لاستعادة الإنتاج في هذه الواجهة.', 'Integrity verification only proves decryption and checksum without writing data. Isolated restoration happens outside the browser; this UI has no production restore POST/PATCH action.')}</span></div></section></div>
  );

  let contentView = renderOverview();
  switch (tab) {
    case 'users': contentView = renderUsers(); break;
    case 'reviews': contentView = renderReviews(); break;
    case 'membership': contentView = renderMembership(); break;
    case 'payments': contentView = renderPayments(); break;
    case 'services': contentView = renderServices(); break;
    case 'names': contentView = renderNames(); break;
    case 'content': contentView = renderContent(); break;
    case 'pricing': contentView = renderPricing(); break;
    case 'lock': contentView = renderLock(); break;
    case 'economics': contentView = renderEconomics(); break;
    case 'audit': contentView = renderAudit(); break;
    case 'backup': contentView = renderBackup(); break;
    case 'governance': contentView = renderGovernance(); break;
    default: contentView = renderOverview();
  }

  const activeTab = availableTabs.find((item) => item.id === tab) ?? availableTabs[0];
  const initialLoad = Boolean(loadingTabs[tab]) && !loadedTabs[tab];

  return <main className="admin-console" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <header className="admin-workbench-topbar">
      <div className="admin-brand">
        <span className="admin-brand-glyph" aria-hidden="true"><img src="/assets/logo-emblem.webp" alt=""/></span>
        <div><strong>KSA.MEN</strong><span>{tr('منضدة الإدارة', 'ADMIN WORKBENCH')}</span></div>
      </div>
      <div className="admin-topbar-actions">
        <span className="admin-role-badge"><ShieldCheck size={15} strokeWidth={1.7} />{roleLabel(ownRole, tr)}</span>
        <button type="button" className="button button-quiet" onClick={() => void refresh()}>
          <RefreshCcw size={16} strokeWidth={1.7} />{tr('تحديث الجلسة', 'Refresh session')}
        </button>
        <button type="button" className="button button-quiet" onClick={() => void loadTab(tab)} disabled={Boolean(loadingTabs[tab])}>
          <RefreshCcw size={16} strokeWidth={1.7} />{loadingTabs[tab] ? tr('جار التحميل', 'Loading') : tr('تحديث القسم', 'Refresh section')}
        </button>
      </div>
    </header>
    <div className="admin-workbench">
      <aside className="admin-sidebar">
        <p className="admin-sidebar-label">{tr('مساحات العمل', 'WORKSPACES')}</p>
        <AdminNavigation tabs={availableTabs} activeTab={tab} tr={tr} onSelect={switchTab} />
      </aside>
      <details className="admin-mobile-nav">
        <summary>
          <span>{activeTab ? tr(activeTab.ar, activeTab.en) : tr('الإدارة', 'Administration')}</span>
          <ChevronDown size={18} strokeWidth={1.7} aria-hidden="true" />
        </summary>
        <AdminNavigation tabs={availableTabs} activeTab={tab} tr={tr} onSelect={(nextTab) => { switchTab(nextTab); document.querySelector<HTMLDetailsElement>('.admin-mobile-nav')?.removeAttribute('open'); }} />
      </details>
      <section className="admin-workspace" aria-busy={initialLoad}>
        {error && <div className="admin-alert" role="alert"><span>{error}</span>{freshRequiredTabs[tab] ? <a className="button button-quiet button-small" href="/auth?reauth=1">{tr('إعادة التحقق', 'Reauthenticate')}</a> : <button type="button" onClick={() => setError('')} aria-label={tr('إغلاق', 'Dismiss')}>×</button>}</div>}
        {initialLoad ? <div className="card admin-loading">{tr('يجري تحميل بيانات هذا القسم من النظام…', 'Loading this section from the system…')}</div> : contentView}
      </section>
    </div>
  </main>;
}

function Empty({ title }: { title: string }) {
  return <div className="admin-empty card"><span className="admin-empty-mark">—</span><p>{title}</p></div>;
}

function roleLabel(role: AdminRole, tr: (ar: string, en: string) => string): string {
  if (role === 'owner') return tr('المالك', 'Owner');
  if (role === 'manager') return tr('مدير مسؤول', 'Responsible manager');
  return tr('مشرف', 'Moderator');
}

function AdminNavigation(props: {
  tabs: AdminTabDefinition[];
  activeTab: AdminTab;
  tr: (ar: string, en: string) => string;
  onSelect: (tab: AdminTab) => void;
}) {
  const { tabs: permittedTabs, activeTab, tr, onSelect } = props;
  const groups: Array<{ id: TabGroup; ar: string; en: string }> = [
    { id: 'workspace', ar: 'المتابعة', en: 'Monitor' },
    { id: 'operations', ar: 'التشغيل', en: 'Operate' },
    { id: 'governance', ar: 'الحوكمة', en: 'Govern' },
  ];
  return <nav className="admin-navigation" aria-label={tr('تنقل الإدارة', 'Administration navigation')}>
    {groups.map((group) => {
      const entries = permittedTabs.filter((item) => item.group === group.id);
      if (!entries.length) return null;
      return <div className="admin-nav-group" key={group.id}>
        <p>{tr(group.ar, group.en)}</p>
        {entries.map((item) => {
          const Icon = item.icon;
          return <button type="button" key={item.id} className={activeTab === item.id ? 'active' : ''} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}>
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{tr(item.ar, item.en)}</span>
          </button>;
        })}
      </div>;
    })}
  </nav>;
}

function ProxySitePanel(props: {
  tr: (ar: string, en: string) => string;
  busy: string | null;
  proxySite: { email: string; name: string; authorization: string; profileName: string; title: string; city: string; bio: string };
  setProxySite: (value: { email: string; name: string; authorization: string; profileName: string; title: string; city: string; bio: string } | ((previous: { email: string; name: string; authorization: string; profileName: string; title: string; city: string; bio: string }) => { email: string; name: string; authorization: string; profileName: string; title: string; city: string; bio: string })) => void;
  handover: { id: string; email: string };
  setHandover: (value: { id: string; email: string } | ((previous: { id: string; email: string }) => { id: string; email: string })) => void;
  lastProxy: MaybeRecord;
  setError: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onHandover: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { tr, busy, proxySite, setProxySite, handover, setHandover, lastProxy, onCreate, onHandover } = props;
  const createdSite = record(lastProxy?.site);
  const createdHandover = record(lastProxy?.handover);
  return <div className="card stack"><div><h2>{tr('موقع بالنيابة وتسليم موثق', 'Proxy site & documented handover')}</h2><p className="muted">{tr('تبدأ المسودة بالبيانات الأساسية، ثم تكملها بالصور والأقسام في المحرر المفوّض. لا تنشر بيانات الغير، ولا يكتمل التسليم لمجرد إدخال البريد؛ القبول يتم لاحقاً من لوحة الحساب المتحقق للمستلم.', 'Start with the basic profile, then complete images and sections in the delegated editor. Third-party data is not published, and entering an email never completes a handover; acceptance happens later from the recipient’s verified account dashboard.')}</p></div><form className="stack" onSubmit={onCreate}><div className="admin-form-pair"><label className="field"><span>{tr('بريد المستلم (اختياري عند الإنشاء)', 'Recipient email (optional at creation)')}</span><input type="email" value={proxySite.email} onChange={(event) => setProxySite((value) => ({ ...value, email: event.target.value }))} /></label><label className="field"><span>{tr('اسم النطاق الفرعي', 'Subdomain name')}</span><input value={proxySite.name} pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" onChange={(event) => setProxySite((value) => ({ ...value, name: event.target.value.toLowerCase() }))} required /></label><label className="field"><span>{tr('اسم صاحب الموقع', 'Site owner name')}</span><input value={proxySite.profileName} onChange={(event) => setProxySite((value) => ({ ...value, profileName: event.target.value }))} required /></label><label className="field"><span>{tr('المسمى المهني', 'Professional title')}</span><input value={proxySite.title} onChange={(event) => setProxySite((value) => ({ ...value, title: event.target.value }))} /></label><label className="field"><span>{tr('المدينة', 'City')}</span><input value={proxySite.city} onChange={(event) => setProxySite((value) => ({ ...value, city: event.target.value }))} /></label></div><label className="field"><span>{tr('نبذة الموقع', 'Site biography')}</span><textarea rows={3} value={proxySite.bio} onChange={(event) => setProxySite((value) => ({ ...value, bio: event.target.value }))} /></label><label className="field"><span>{tr('نص أو مرجع التفويض الموثق', 'Documented authorization text or reference')}</span><textarea rows={2} minLength={8} value={proxySite.authorization} onChange={(event) => setProxySite((value) => ({ ...value, authorization: event.target.value }))} required /></label><button className="button" disabled={busy === 'proxy-site'}>{tr('إنشاء مسودة مفوضة', 'Create authorized draft')}</button></form>{createdSite && <div className="admin-proxy-result"><strong>{tr('نتيجة المسار', 'Route result')}</strong><span>{tr('معرف الموقع', 'Site ID')}: <b className="admin-mono">{text(createdSite.id)}</b></span><span>{tr('الحالة', 'Status')}: {text(createdSite.status)}</span><a className="button primary" href={'/dashboard?site='+encodeURIComponent(text(createdSite.id))+'&tab=editor'}>{tr('أكمل الموقع في المحرر','Continue in the site editor')}</a>{createdHandover && <span>{tr('معرف طلب التسليم', 'Handover request ID')}: <b className="admin-mono">{text(createdHandover.id)}</b></span>}</div>}<form className="admin-inline-form" onSubmit={onHandover}><input aria-label={tr('معرف الموقع', 'Site ID')} placeholder={tr('معرف الموقع', 'Site ID')} value={handover.id} onChange={(event) => setHandover((value) => ({ ...value, id: event.target.value }))} /><input aria-label={tr('بريد المستلم', 'Recipient email')} type="email" placeholder={tr('بريد المستلم المتحقق', 'Verified recipient email')} value={handover.email} onChange={(event) => setHandover((value) => ({ ...value, email: event.target.value }))} /><button className="button button-secondary" disabled={busy === 'handover'}>{tr('طلب التسليم', 'Request handover')}</button></form><p className="admin-route-note">{tr('أكمل الموقع في المحرر، وأرسله للمراجعة قبل نشره. يبقى قبول نقل إدارة الموقع لصاحب البريد المتحقق خطوة مستقلة.', 'Complete the site in the editor and submit it for review. Transfer of site management remains a separate acceptance step by the verified email owner.')}</p></div>;
}

function SnapshotDiff({ review, tr }: { review: JsonRecord; tr: (ar: string, en: string) => string }) {
  const diff = record(field(review, 'diff', 'changes', 'delta'));
  const stale = knownBoolean(field(review, 'isStale', 'is_stale'));
  const currentPublication = field(diff, 'before', 'old', 'previous');
  const submittedSnapshot = field(review, 'snapshot') ?? field(diff, 'after', 'new', 'current');
  const rawChanges = field(diff, 'changes') ?? field(review, 'changes');
  const changes = Array.isArray(rawChanges) ? rawChanges.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
  if (stale === true) return <div className="admin-review-comparison-unavailable"><strong>{tr('لا تتوفر مقارنة آمنة للّقطة', 'A safe snapshot comparison is unavailable')}</strong><span>{tr('تغيّر النشر منذ إصدار الأساس؛ اعتمد على الإصدارات ومعاينة اللقطة المحمية بدلاً من مقارنة قبل/بعد غير موثوقة.', 'Publication changed since the base version; use the versions and protected snapshot preview instead of an unreliable before/after comparison.')}</span></div>;
  if (!changes.length) return <div className="admin-diff-grid"><DiffCell tr={tr} label={tr('النشر الحالي', 'Current publication')} value={currentPublication} /><DiffCell tr={tr} label={tr('اللقطة المرسلة', 'Submitted snapshot')} value={submittedSnapshot} changed /></div>;
  return <div className="admin-change-list">{changes.map((change, index) => <article className="admin-change" key={`${text(change.field, 'field')}-${index}`}><header><strong>{text(change.field, tr('حقل متغير', 'Changed field'))}</strong></header><div className="admin-diff-grid"><DiffCell tr={tr} label={tr('النشر الحالي', 'Current publication')} value={field(change, 'before', 'old')} /><DiffCell tr={tr} label={tr('اللقطة المرسلة', 'Submitted snapshot')} value={field(change, 'after', 'new')} changed /></div></article>)}</div>;
}

function DiffCell({ tr, label, value, changed = false }: { tr: (ar: string, en: string) => string; label: string; value: unknown; changed?: boolean }) {
  const image = changedImage(value);
  const unavailable = value === null || value === undefined;
  return <div><span className={`admin-diff-label ${changed ? 'new' : ''}`}>{label}</span>{unavailable ? <p className="admin-diff-unavailable">{tr('لم يُعد الخادم قيمة لهذه الجهة من المقارنة.', 'The server did not return a value for this side of the comparison.')}</p> : image ? <img className="admin-diff-image" src={image} alt={label} /> : <pre>{displayJson(value)}</pre>}</div>;
}

function SeasonPanel(props: {
  tr: (ar: string, en: string) => string;
  seasonal: SeasonalForm;
  setSeasonal: (value: SeasonalForm | ((previous: SeasonalForm) => SeasonalForm)) => void;
  busy: string | null;
  setError: (value: string) => void;
  onSave: () => void;
}) {
  const { tr, seasonal, setSeasonal, busy, onSave } = props;
  return <section className="card stack"><div><h2>{tr('المظهر الموسمي', 'Seasonal appearance')}</h2><p className="muted">{tr('المدخلات المرئية تُفسر بتوقيت Asia/Riyadh وتتحول إلى Epoch بالثواني فقط عند الحفظ. لا يُفعّل أي مظهر بلا نافذة صالحة.', 'Visible inputs are interpreted in Asia/Riyadh and converted to epoch seconds only on save. No appearance is enabled without a valid window.')}</p></div><div className="admin-form-pair"><label className="field"><span>{tr('المناسبة', 'Occasion')}</span><select value={seasonal.occasion} onChange={(event) => setSeasonal((value) => ({ ...value, occasion: event.target.value }))}><option value="eid_al_fitr">{tr('عيد الفطر', 'Eid al-Fitr')}</option><option value="eid_al_adha">{tr('عيد الأضحى', 'Eid al-Adha')}</option><option value="national_day">{tr('اليوم الوطني السعودي', 'Saudi National Day')}</option><option value="founding_day">{tr('يوم التأسيس السعودي', 'Founding Day')}</option></select></label><label className="field admin-check"><input type="checkbox" checked={seasonal.enabled} onChange={(event) => setSeasonal((value) => ({ ...value, enabled: event.target.checked }))} /><span>{tr('تفعيل المظهر خلال النافذة', 'Enable appearance within this window')}</span></label><label className="field"><span>{tr('البداية — الرياض', 'Starts — Riyadh')}</span><input type="datetime-local" value={seasonal.startsAt} onChange={(event) => setSeasonal((value) => ({ ...value, startsAt: event.target.value }))} /></label><label className="field"><span>{tr('النهاية — الرياض', 'Ends — Riyadh')}</span><input type="datetime-local" value={seasonal.endsAt} onChange={(event) => setSeasonal((value) => ({ ...value, endsAt: event.target.value }))} /></label></div><button className="button" type="button" disabled={busy === 'seasonal'} onClick={onSave}>{tr('حفظ جدولة المظهر', 'Save appearance schedule')}</button></section>;
}

type UserDetailProps = {
  item: JsonRecord;
  lang: 'ar' | 'en';
  tr: (ar: string, en: string) => string;
  services: JsonRecord[];
  users: JsonRecord[];
  points: string;
  setPoints: (value: string) => void;
  grantDays: string;
  setGrantDays: (value: string) => void;
  serviceKey: string;
  setServiceKey: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  financial: boolean;
  setFinancial: (value: boolean) => void;
  assignedTo: string;
  setAssignedTo: (value: string) => void;
  busy: string | null;
  owner: boolean;
  financialOperator: boolean;
  onAction: (action: UserAction, payload: JsonRecord, label: string, fresh?: boolean) => void;
  onAudit: () => void;
  onNotify: (recipient: string) => void;
};

function UserDetail(props: UserDetailProps) {
  const { item, lang, tr, services, users, points, setPoints, grantDays, setGrantDays, serviceKey, setServiceKey, role, setRole, financial, setFinancial, assignedTo, setAssignedTo, busy, owner, financialOperator, onAction, onAudit, onNotify } = props;
  const id = idOf(item);
  const whatsapp = text(field(item, 'whatsapp', 'phone'), '');
  const phoneLink = whatsapp.replace(/\D/g, '');
  const siteUrl = text(field(item, 'site_url', 'url', 'domain_url'), '');
  const deletionStatus = field(item, 'deletion_request_status', 'deletion_status');
  const activeServices = field(item, 'services', 'enabled_services');
  const recent = field(item, 'recent_activity', 'activities', 'last_activity');
  const managerCandidates = users.filter((entry) => ['owner', 'manager'].includes(text(field(entry, 'role'), '').toLowerCase()));
  const validDays = Number.isInteger(Number(grantDays)) && Number(grantDays) > 0;
  const validPoints = Number.isInteger(Number(points)) && Number(points) > 0;
  return <div className="stack"><div className="row admin-detail-heading"><div><p className="admin-eyebrow">C{id}</p><h1>{text(field(item, 'name', 'full_name', 'email'))}</h1><p className="muted">{text(field(item, 'email'))}</p></div><span className={`admin-status ${statusTone(field(item, 'status'))}`}>{text(field(item, 'status'))}</span></div><div className="admin-key-values"><div><span>{tr('واتساب', 'WhatsApp')}</span><strong>{whatsapp}</strong></div><div><span>{tr('النطاق', 'Domain')}</span><strong>{text(field(item, 'domain', 'subdomain', 'name'))}</strong></div><div><span>{tr('حالة الموقع', 'Site status')}</span><strong>{text(field(item, 'site_status'))}</strong></div><div><span>{tr('الاشتراك', 'Subscription')}</span><strong>{text(field(item, 'subscription_status', 'entitlement_status'))}</strong></div><div><span>{tr('الاستحقاق', 'Entitlement')}</span><strong>{asDate(field(item, 'entitlement_until', 'expires_at'), lang)}</strong></div><div><span>{tr('الرصيد المتاح', 'Available balance')}</span><strong>{text(field(item, 'balance'), tr('غير متاح', 'Unavailable'))}</strong></div><div><span>{tr('المشرف المسؤول', 'Assigned administrator')}</span><strong>{text(field(item, 'assigned_to', 'manager_name', 'admin_name'))}</strong></div><div><span>{tr('الدور', 'Role')}</span><strong>{text(field(item, 'role'))}</strong></div></div><div className="admin-user-context"><div><h3>{tr('الخدمات المفعلة أو المعلقة', 'Enabled or paused services')}</h3><pre>{displayJson(activeServices ?? [])}</pre></div><div><h3>{tr('آخر النشاطات', 'Recent activity')}</h3><pre>{displayJson(recent ?? [])}</pre></div></div>{deletionStatus !== undefined && <div className="admin-deletion-note"><strong>{tr('طلب حذف البيانات', 'Data deletion request')}</strong><span>{text(deletionStatus)}</span><p>{tr('سجل الحالة فقط؛ لا يقدم هذا المكوّن حذفاً نهائياً أو وعداً بإزالة فورية.', 'Status only; this component offers neither hard deletion nor an immediate-erasure promise.')}</p></div>}<div className="admin-actions">{siteUrl ? <a className="button button-quiet" href={siteUrl} target="_blank" rel="noreferrer">{tr('معاينة الموقع', 'Preview site')}</a> : <span className="admin-route-note">{tr('لم يعد مسار المستخدم رابط معاينة للموقع.', 'The user route did not return a site preview URL.')}</span>}<button className="button" type="button" disabled={busy === `user-${id}-status`} onClick={() => onAction('status', { status: 'active' }, tr('تم إرسال تفعيل الحساب للتحقق بالخادم.', 'Account activation was sent for server validation.'))}>{tr('تفعيل الحساب', 'Activate account')}</button><button className="button button-danger" type="button" disabled={busy === `user-${id}-status`} onClick={() => onAction('status', { status: 'suspended' }, tr('تم إرسال تعليق الحساب للتحقق بالخادم.', 'Account suspension was sent for server validation.'))}>{tr('تعليق', 'Suspend')}</button>{phoneLink && <a className="button button-quiet" href={`https://wa.me/${phoneLink}`} target="_blank" rel="noreferrer">{tr('فتح واتساب', 'Open WhatsApp')}</a>}<button className="button button-quiet" type="button" onClick={() => onNotify(`C${id}`)}>{tr('إشعار', 'Notify')}</button>{owner && <button className="button button-quiet" type="button" onClick={onAudit}>{tr('مراجعة السجل', 'Review audit')}</button>}</div><div className="admin-detail-forms"><div className="admin-mini-form"><h3>{tr('تمديد الاستحقاق', 'Extend entitlement')}</h3><input aria-label={tr('الأيام', 'Days')} inputMode="numeric" value={grantDays} onChange={(event) => setGrantDays(event.target.value.replace(/\D/g, ''))} /><button className="button button-small" type="button" disabled={!validDays} onClick={() => onAction('grant', { days: Number(grantDays) }, tr('تم إرسال إضافة أيام الاستحقاق.', 'Entitlement-day grant was sent.'), true)}>{tr('منح أيام', 'Grant days')}</button></div><div className="admin-mini-form"><h3>{tr('إصدار نقاط', 'Issue points')}</h3><input aria-label={tr('عدد النقاط', 'Point amount')} inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value.replace(/\D/g, ''))} /><button className="button button-small" type="button" disabled={!financialOperator || !validPoints} onClick={() => onAction('points', { amount: Number(points) }, tr('أُرسل إصدار النقاط إلى دفتر الأستاذ.', 'Point issuance was submitted to the ledger.'), true)}>{financialOperator ? tr('إضافة نقاط', 'Add points') : tr('تفويض مالي مطلوب', 'Financial delegation required')}</button></div><div className="admin-mini-form"><h3>{tr('خدمة فردية', 'Individual service')}</h3><select value={serviceKey} onChange={(event) => setServiceKey(event.target.value)}>{services.map((service) => <option key={text(field(service, 'key', 'id'))} value={text(field(service, 'key', 'id'))}>{text(field(service, lang === 'ar' ? 'name_ar' : 'name_en', 'name', 'key', 'id'))}</option>)}</select><div className="admin-actions"><button className="button button-small" type="button" disabled={!serviceKey} onClick={() => onAction('service', { key: serviceKey, mode: 'grant' }, tr('تم إرسال منح الخدمة الفردي.', 'Individual service grant was sent.'))}>{tr('تفعيل', 'Enable')}</button><button className="button button-small button-danger" type="button" disabled={!serviceKey} onClick={() => onAction('service', { key: serviceKey, mode: 'pause' }, tr('تم إرسال تعليق الخدمة الفردي.', 'Individual service pause was sent.'))}>{tr('تعليق', 'Pause')}</button></div></div></div>{owner && <div className="admin-detail-forms"><div className="admin-mini-form"><h3>{tr('الدور والتفويض المالي', 'Role & financial delegation')}</h3><select value={role} onChange={(event) => setRole(event.target.value)}><option value="moderator">{tr('مشرف عادي', 'Moderator')}</option><option value="manager">{tr('مشرف مسؤول', 'Responsible manager')}</option><option value="owner">{tr('مشرف رئيسي', 'Owner')}</option><option value="user">{tr('عضو بلا إدارة', 'Member without administration')}</option></select><label className="admin-check"><input type="checkbox" disabled={role !== 'manager'} checked={financial} onChange={(event) => setFinancial(event.target.checked)} /><span>{tr('تفويض مالي صريح للمدير فقط', 'Explicit financial delegation for a manager only')}</span></label><button className="button button-small" type="button" onClick={() => onAction('role', { role, financial: role === 'manager' && financial }, tr('تم إرسال تعديل الدور لتدقيق الخادم.', 'Role update was submitted for server enforcement.'), true)}>{tr('حفظ الدور', 'Save role')}</button>{text(field(item, 'role')) !== 'moderator' && <button className="button button-small button-secondary" type="button" onClick={() => onAction('role', { role: 'moderator', financial: false }, tr('تم إرسال ترقية المستخدم إلى مشرف عادي.', 'User promotion to moderator was submitted.'), true)}>{tr('ترقية إلى مشرف عادي', 'Promote to moderator')}</button>}{text(field(item, 'role')) === 'moderator' && <button className="button button-small button-quiet" type="button" onClick={() => onAction('role', { role: 'user', financial: false }, tr('تم إرسال إلغاء ترقية المشرف.', 'Moderator promotion removal was submitted.'), true)}>{tr('إلغاء ترقية المشرف', 'Remove moderator role')}</button>}</div><div className="admin-mini-form"><h3>{tr('إسناد مشرف', 'Assign administrator')}</h3><select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">{tr('إلغاء الإسناد', 'Clear assignment')}</option>{managerCandidates.map((candidate) => <option key={idOf(candidate)} value={idOf(candidate)}>{text(field(candidate, 'name', 'email'))} (C{idOf(candidate)})</option>)}</select><button className="button button-small" type="button" onClick={() => onAction('assign', { managerId: assignedTo }, tr('تم إرسال إسناد المشرف.', 'Administrator assignment was sent.'))}>{tr('حفظ الإسناد', 'Save assignment')}</button></div><div className="admin-mini-form"><h3>{tr('هوية الموقع', 'Site branding')}</h3><p className="muted">{tr('يطبق الخادم إعداد الهوية الموروثة على موقع المستخدم الواقع في النطاق.', 'The server applies inherited branding to the in-scope user site.')}</p><button className="button button-small" type="button" onClick={() => onAction('branding', { key: 'platform_branding', mode: 'inherit' }, tr('تم طلب تطبيق الهوية الافتراضية.', 'Default branding inheritance was requested.'))}>{tr('تطبيق الافتراضي', 'Apply default')}</button></div></div>}</div>;
}

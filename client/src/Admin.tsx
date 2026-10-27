import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, useApp } from './lib';
import './admin.css';

type AdminTab =
  | 'overview'
  | 'users'
  | 'reviews'
  | 'payments'
  | 'services'
  | 'names'
  | 'content'
  | 'lock'
  | 'economics'
  | 'audit'
  | 'backup';

type JsonRecord = Record<string, unknown>;
type MaybeRecord = JsonRecord | null | undefined;

type AdminData = Partial<Record<Exclude<AdminTab, 'content' | 'lock' | 'backup'>, unknown>> & {
  settings?: unknown;
  transfers?: unknown;
};

const tabs: { id: AdminTab; ar: string; en: string; owner?: boolean }[] = [
  { id: 'overview', ar: 'نظرة تنفيذية', en: 'Overview' },
  { id: 'users', ar: 'المستخدمون', en: 'Users' },
  { id: 'reviews', ar: 'المراجعات', en: 'Reviews' },
  { id: 'payments', ar: 'المدفوعات', en: 'Payments' },
  { id: 'services', ar: 'الخدمات', en: 'Services' },
  { id: 'names', ar: 'الأسماء', en: 'Names' },
  { id: 'content', ar: 'المحتوى', en: 'Content', owner: true },
  { id: 'lock', ar: 'قفل المنصة', en: 'Platform lock', owner: true },
  { id: 'economics', ar: 'الاقتصاديات', en: 'Economics', owner: true },
  { id: 'audit', ar: 'سجل التدقيق', en: 'Audit' },
  { id: 'backup', ar: 'النسخ الاحتياطي', en: 'Backup', owner: true },
];

const contentSlugs = [
  ['about', 'من نحن', 'About'],
  ['terms', 'الشروط', 'Terms'],
  ['privacy', 'الخصوصية', 'Privacy'],
  ['blog', 'المدونة', 'Blog'],
  ['campaigns', 'الحملات والعروض', 'Campaigns'],
  ['footer', 'التذييل وبيانات التواصل', 'Footer & contact'],
  ['branding', 'الهوية البصرية', 'Branding'],
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
  ['new_registrations', 'التسجيلات الجديدة', 'New registrations'],
  ['published_sites', 'المواقع المنشورة', 'Published sites'],
  ['pending_sites', 'المواقع المعلقة', 'Pending sites'],
  ['review_requests', 'طلبات المراجعة', 'Review requests'],
  ['free_trials', 'التجارب المجانية', 'Free trials'],
  ['subscriptions', 'الاشتراكات', 'Subscriptions'],
  ['payment_requests', 'طلبات الدفع', 'Payment requests'],
  ['referrals', 'الإحالات', 'Referrals'],
  ['treasury_points', 'نقاط الخزينة', 'Treasury points'],
  ['transfers', 'التحويلات', 'Transfers'],
  ['resource_usage', 'استهلاك الموارد', 'Resource usage'],
  ['service_activity', 'نشاط الخدمات', 'Service activity'],
  ['notifications', 'الإشعارات', 'Notifications'],
  ['contact_requests', 'طلبات التواصل', 'Contact requests'],
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

function record(value: unknown): MaybeRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(record(item)));
  const obj = record(value);
  if (!obj) return [];
  for (const key of ['items', 'users', 'reviews', 'payments', 'services', 'names', 'transfers', 'entries', 'audit', 'data']) {
    if (Array.isArray(obj[key])) return records(obj[key]);
  }
  return [];
}

function valueAt(source: unknown, key: string): unknown {
  const direct = record(source);
  if (!direct) return undefined;
  if (key in direct) return direct[key];
  for (const parent of ['metrics', 'stats', 'summary', 'data', 'totals']) {
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

function idOf(item: MaybeRecord): string {
  return text(item?.id ?? item?.user_id ?? item?.site_id ?? item?.payment_id, '');
}

function asDate(value: unknown, lang: 'ar' | 'en'): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric) && numeric > 100000000 ? new Date(numeric * 1000) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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

function field(item: MaybeRecord, ...keys: string[]): unknown {
  if (!item) return undefined;
  for (const key of keys) if (item[key] !== undefined) return item[key];
  return undefined;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export default function Admin() {
  const { user, lang, t, refresh, notify } = useApp();
  const tr = useCallback((ar: string, en: string) => t(ar, en), [t]);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminData>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<JsonRecord | null>(null);
  const [selectedReview, setSelectedReview] = useState<JsonRecord | null>(null);
  const [paymentReasons, setPaymentReasons] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [points, setPoints] = useState('');
  const [grantDays, setGrantDays] = useState('3');
  const [serviceKey, setServiceKey] = useState('');
  const [role, setRole] = useState('moderator');
  const [financial, setFinancial] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [notification, setNotification] = useState({ recipient: '', title: '', body: '' });
  const [nameForm, setNameForm] = useState({ name: '', kind: 'policy', reason: '' });
  const [proxySite, setProxySite] = useState({ email: '', name: '', authorization: '', draft: '{}' });
  const [handover, setHandover] = useState({ id: '', email: '' });
  const [contentSlug, setContentSlug] = useState<(typeof contentSlugs)[number][0]>('about');
  const [content, setContent] = useState('');
  const [contentMeta, setContentMeta] = useState<MaybeRecord>();
  const [lock, setLock] = useState({ mode: 'human_test', reason: '', message: '', password: '' });
  const [bankInstructions, setBankInstructions] = useState('');
  const [seasonal, setSeasonal] = useState({ enabled: false, occasion: 'national_day', starts_at: '', ends_at: '' });
  const [backup, setBackup] = useState<unknown>();
  const [expense, setExpense] = useState({ label: '', amount: '', notes: '' });

  const ownRole = text(user?.role, '').toLowerCase();
  const owner = ownRole === 'owner';
  const financialOperator = owner || (ownRole === 'manager' && Boolean((user as unknown as JsonRecord | undefined)?.financial));

  const handleFailure = useCallback((failure: unknown, fresh = false) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (fresh && /403|fresh|reauth|verify/i.test(message)) {
      window.location.assign('/auth?reauth=1');
      return;
    }
    setError(message || tr('تعذر إكمال العملية. حاول مجدداً.', 'The operation could not be completed. Try again.'));
  }, [tr]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const endpoints: [keyof AdminData, string][] = [
      ['overview', '/api/admin/overview'],
      ['users', '/api/admin/users'],
      ['reviews', '/api/admin/reviews'],
      ['payments', '/api/admin/payments'],
      ['settings', '/api/admin/settings'],
      ['services', '/api/admin/services'],
      ['names', '/api/admin/names'],
      ['transfers', '/api/admin/transfers'],
      ['audit', '/api/admin/audit'],
      ['economics', '/api/admin/economics'],
    ];
    const result = await Promise.allSettled(endpoints.map(([, path]) => api<unknown>(path)));
    const next: AdminData = {};
    result.forEach((item, index) => {
      const [key] = endpoints[index];
      if (item.status === 'fulfilled') next[key] = item.value;
    });
    const rejected = result.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (rejected) handleFailure(rejected.reason);
    setData(next);
    setLoading(false);
  }, [handleFailure]);

  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback(async <T,>(key: string, work: () => Promise<T>, options?: { fresh?: boolean; success?: string; reload?: boolean }) => {
    setBusy(key);
    setError('');
    try {
      const result = await work();
      if (options?.success) notify(options.success);
      if (options?.reload !== false) await load();
      return result;
    } catch (failure) {
      handleFailure(failure, options?.fresh);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [handleFailure, load, notify]);

  const users = useMemo(() => records(data.users), [data.users]);
  const reviews = useMemo(() => records(data.reviews), [data.reviews]);
  const payments = useMemo(() => records(data.payments), [data.payments]);
  const services = useMemo(() => records(data.services), [data.services]);
  const names = useMemo(() => records(data.names), [data.names]);
  const transfers = useMemo(() => records(data.transfers), [data.transfers]);
  const audit = useMemo(() => records(data.audit), [data.audit]);

  useEffect(() => {
    if (!serviceKey && services.length) setServiceKey(text(field(services[0], 'key', 'id'), ''));
  }, [serviceKey, services]);

  useEffect(() => {
    const settings = record(data.settings);
    const lockValue = field(settings, 'platform_lock', 'lock');
    const parsedLock = record(typeof lockValue === 'string' ? safeJson(lockValue) : lockValue);
    if (parsedLock) {
      setLock((current) => ({
        ...current,
        mode: text(field(parsedLock, 'mode'), current.mode),
        reason: text(field(parsedLock, 'reason'), ''),
        message: text(field(parsedLock, 'message', 'card_message'), ''),
      }));
    }
    const seasonalValue = field(settings, 'seasonal', 'seasonal_theme');
    const parsedSeasonal = record(typeof seasonalValue === 'string' ? safeJson(seasonalValue) : seasonalValue);
    if (parsedSeasonal) {
      setSeasonal({
        enabled: Boolean(parsedSeasonal.enabled),
        occasion: text(parsedSeasonal.occasion, 'national_day'),
        starts_at: text(parsedSeasonal.starts_at, ''),
        ends_at: text(parsedSeasonal.ends_at, ''),
      });
    }
    const officialBankInfo = field(settings, 'bank_instructions', 'bank', 'payment_instructions');
    if (officialBankInfo !== undefined && officialBankInfo !== null) {
      setBankInstructions(typeof officialBankInfo === 'string' ? officialBankInfo : JSON.stringify(officialBankInfo, null, 2));
    }
  }, [data.settings]);

  useEffect(() => {
    if (tab !== 'content') return;
    void mutate(`content-load-${contentSlug}`, async () => {
      const response = await api<unknown>(`/api/content/${contentSlug}`);
      const item = record(response);
      setContentMeta(item);
      const raw = field(item, 'content', 'body', 'value');
      setContent(typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw, null, 2));
      return response;
    }, { reload: false });
  }, [contentSlug, mutate, tab]);

  useEffect(() => {
    if (tab !== 'backup' || backup !== undefined) return;
    void mutate('backup-load', () => api<unknown>('/api/admin/backup'), { fresh: true, reload: false })
      .then((response) => { if (response !== undefined) setBackup(response); });
  }, [backup, mutate, tab]);

  const userAction = (action: 'status' | 'role' | 'grant' | 'points' | 'service' | 'assign' | 'branding', payload: JsonRecord, label: string, fresh = true) => {
    if (!selectedUser) return;
    const id = idOf(selectedUser);
    if (!id) return;
    void mutate(`user-${id}-${action}`, () => api(`/api/admin/users/${encodeURIComponent(id)}/action`, {
      method: 'POST', body: JSON.stringify({ action, ...payload }),
    }), { fresh, success: label }).then((result) => { if (result !== undefined) setSelectedUser(null); });
  };

  const decideReview = (review: JsonRecord, decision: 'approve' | 'reject') => {
    const id = idOf(review);
    if (!id) return;
    const reason = reviewReasons[id] ?? '';
    if (decision === 'reject' && !reason.trim()) {
      setError(tr('سبب الرفض مطلوب لحماية مسار المراجعة.', 'A rejection reason is required for the review trail.'));
      return;
    }
    void mutate(`review-${id}-${decision}`, () => api(`/api/admin/reviews/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, reason }),
    }), { fresh: true, success: decision === 'approve' ? tr('تم اعتماد اللقطة ونشرها ذرياً.', 'Snapshot approved and published atomically.') : tr('تم رفض اللقطة مع حفظ السبب.', 'Snapshot rejected with its reason recorded.') });
  };

  const decidePayment = (payment: JsonRecord, decision: 'approve' | 'reject') => {
    const id = idOf(payment);
    if (!id) return;
    const status = text(field(payment, 'status', 'decision'), '').toLowerCase();
    if (/approved|rejected|declined|cancelled/.test(status)) return;
    const reason = paymentReasons[id] ?? '';
    if (decision === 'reject' && !reason.trim()) {
      setError(tr('أدخل سبب الرفض قبل إرسال القرار.', 'Enter a rejection reason before submitting the decision.'));
      return;
    }
    if (decision === 'approve' && !window.confirm(tr('اعتماد الدفع إجراء نهائي الأثر ولا يمكن تكراره. هل تابعت؟', 'Payment approval has a non-repeatable effect. Continue?'))) return;
    void mutate(`payment-${id}-${decision}`, () => api(`/api/admin/payments/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, reason }),
    }), { fresh: true, success: decision === 'approve' ? tr('تم اعتماد الدفع مرة واحدة وإعادة تحميل حالته.', 'Payment approved once and its state was reloaded.') : tr('تم رفض طلب الدفع.', 'Payment request rejected.') });
  };

  const switchTab = (next: AdminTab) => {
    setError('');
    if (next === 'backup') setBackup(undefined);
    setTab(next);
  };

  const renderOverview = () => (
    <div className="stack admin-stack">
      <section className="admin-hero card">
        <div>
          <p className="admin-eyebrow">KSA.MEN / CONTROL ROOM</p>
          <h1 className="page-title">{tr('لوحة القيادة الإدارية', 'Administrative control room')}</h1>
          <p className="muted">{tr('تظهر المؤشرات من النظام مباشرة. القيم غير المتاحة تبقى واضحة ولا تُقدّر.', 'Metrics are rendered from live system data. Unavailable values remain explicit; they are never estimated.')}</p>
        </div>
        <div className="admin-role-card">
          <span className="muted">{tr('جلستك', 'Your session')}</span>
          <strong>{text(user?.name || user?.email)}</strong>
          <span className={`admin-status ${statusTone(user?.role)}`}>{text(user?.role)}</span>
        </div>
      </section>
      <section className="admin-metrics" aria-label={tr('مؤشرات المنصة', 'Platform metrics')}>
        {overviewMetrics.map(([key, ar, en]) => (
          <article className="admin-metric card" key={key}>
            <span className="muted">{tr(ar, en)}</span>
            <strong>{text(valueAt(data.overview, key))}</strong>
          </article>
        ))}
      </section>
      <section className="admin-grid admin-grid-2">
        <div className="card stack">
          <div className="row admin-section-heading"><div><h2>{tr('إشعار آمن', 'Send notification')}</h2><p className="muted">{tr('فردي أو مجموعة أو عمومي؛ يحدد الخادم النطاق النهائي والتفويض.', 'Individual, group, or global; the server determines final scope and authorization.')}</p></div></div>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            if (!notification.recipient.trim() || !notification.title.trim() || !notification.body.trim()) return;
            void mutate('notification', () => api('/api/admin/notifications', { method: 'POST', body: JSON.stringify(notification) }), { success: tr('تم إرسال الإشعار وفق نطاقه المعتمد.', 'Notification sent within its authorized scope.') }).then((result) => {
              if (result !== undefined) setNotification({ recipient: '', title: '', body: '' });
            });
          }}>
            <div className="admin-quick-targets" aria-label={tr('اختيار نطاق سريع', 'Quick scope selection')}>
              <button className="button button-quiet" type="button" onClick={() => setNotification((v) => ({ ...v, recipient: 'all' }))}>{tr('الجميع', 'All')}</button>
              <button className="button button-quiet" type="button" onClick={() => setNotification((v) => ({ ...v, recipient: 'role:manager' }))}>{tr('المديرون', 'Managers')}</button>
              <button className="button button-quiet" type="button" onClick={() => setNotification((v) => ({ ...v, recipient: 'role:moderator' }))}>{tr('المشرفون', 'Moderators')}</button>
            </div>
            <label className="field"><span>{tr('المستلم أو النطاق', 'Recipient or scope')}</span><input value={notification.recipient} onChange={(e) => setNotification((v) => ({ ...v, recipient: e.target.value }))} placeholder="C12 / all / role:manager" /></label>
            <label className="field"><span>{tr('العنوان', 'Title')}</span><input value={notification.title} onChange={(e) => setNotification((v) => ({ ...v, title: e.target.value }))} /></label>
            <label className="field"><span>{tr('النص', 'Body')}</span><textarea rows={3} value={notification.body} onChange={(e) => setNotification((v) => ({ ...v, body: e.target.value }))} /></label>
            <button className="button" disabled={busy === 'notification'}>{tr('إرسال الإشعار', 'Send notification')}</button>
          </form>
        </div>
        <div className="card stack">
          <div><h2>{tr('إنشاء موقع بالنيابة', 'Create a site by proxy')}</h2><p className="muted">{tr('لا تُنشر بيانات الغير بلا تفويض؛ التسليم لاحقاً يتطلب قبول البريد المتحقق منه.', 'Third-party data is never published without authorization; handover later requires verified-email acceptance.')}</p></div>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            if (!proxySite.authorization.trim() || !proxySite.name.trim()) {
              setError(tr('أدخل الاسم والتفويض الموثق قبل الإنشاء.', 'Enter the name and documented authorization before creation.'));
              return;
            }
            void mutate('proxy-site', () => api('/api/admin/sites', { method: 'POST', body: JSON.stringify({ ...proxySite, draft: safeJson(proxySite.draft) }) }), { fresh: true, success: tr('تم إنشاء الموقع بالنيابة وفق التفويض.', 'Site created by proxy under the recorded authorization.') });
          }}>
            <div className="admin-form-pair">
              <label className="field"><span>{tr('البريد (اختياري)', 'Email (optional)')}</span><input type="email" value={proxySite.email} onChange={(e) => setProxySite((v) => ({ ...v, email: e.target.value }))} /></label>
              <label className="field"><span>{tr('الاسم', 'Name')}</span><input value={proxySite.name} onChange={(e) => setProxySite((v) => ({ ...v, name: e.target.value }))} /></label>
            </div>
            <label className="field"><span>{tr('نص/مرجع التفويض', 'Authorization text/reference')}</span><textarea rows={2} value={proxySite.authorization} onChange={(e) => setProxySite((v) => ({ ...v, authorization: e.target.value }))} required /></label>
            <label className="field"><span>{tr('المسودة JSON', 'Draft JSON')}</span><textarea rows={3} value={proxySite.draft} onChange={(e) => setProxySite((v) => ({ ...v, draft: e.target.value }))} /></label>
            <button className="button" disabled={busy === 'proxy-site'}>{tr('إنشاء مسودة مفوضة', 'Create authorized draft')}</button>
          </form>
          <form className="admin-inline-form" onSubmit={(event) => {
            event.preventDefault();
            if (!handover.id || !handover.email) return;
            void mutate('handover', () => api(`/api/admin/sites/${encodeURIComponent(handover.id)}/handover`, { method: 'POST', body: JSON.stringify({ email: handover.email }) }), { fresh: true, success: tr('أُرسل طلب التسليم؛ لا يكتمل حتى قبول بريد متحقق منه.', 'Handover was requested; it completes only after verified-email acceptance.') });
          }}>
            <input aria-label={tr('معرف الموقع', 'Site ID')} placeholder={tr('معرف الموقع', 'Site ID')} value={handover.id} onChange={(e) => setHandover((v) => ({ ...v, id: e.target.value }))} />
            <input aria-label={tr('بريد المستلم', 'Recipient email')} type="email" placeholder={tr('بريد المستلم', 'Recipient email')} value={handover.email} onChange={(e) => setHandover((v) => ({ ...v, email: e.target.value }))} />
            <button className="button button-secondary" disabled={busy === 'handover'}>{tr('طلب التسليم', 'Request handover')}</button>
          </form>
        </div>
      </section>
    </div>
  );

  const renderUsers = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro">
        <div><h1 className="page-title">{tr('المستخدمون وإدارة التفويض', 'Users & delegation')}</h1><p className="muted">{tr('كل تعديل يمر بالخادم وسجل التدقيق. طلبات الحذف تعرض حالتها فقط؛ لا يوجد حذف نهائي من هذه الواجهة.', 'Every change passes through the server and audit trail. Deletion requests show their status only; this console never offers irreversible deletion.')}</p></div>
        <span className="admin-server-note">{tr('التحكم في الواجهة ليس بديلاً عن التحقق بالخادم', 'Server enforcement remains authoritative')}</span>
      </section>
      <div className="admin-user-layout">
        <section className="admin-user-list stack">
          {users.length ? users.map((item) => {
            const id = idOf(item);
            const active = selectedUser && idOf(selectedUser) === id;
            return <button type="button" className={`card admin-user-card ${active ? 'active' : ''}`} key={id || text(field(item, 'email'))} onClick={() => setSelectedUser(item)}>
              <div className="row"><strong>{text(field(item, 'name', 'full_name', 'email'))}</strong><span className={`admin-status ${statusTone(field(item, 'status'))}`}>{text(field(item, 'status'))}</span></div>
              <span className="muted">C{text(field(item, 'id', 'user_id'))} · {text(field(item, 'email'))}</span>
              <span className="muted">{tr('النطاق', 'Domain')}: {text(field(item, 'domain', 'name', 'subdomain'))}</span>
              <div className="admin-user-card-footer"><span>{tr('الرصيد', 'Balance')}: {text(field(item, 'balance'))}</span><span>{text(field(item, 'role'))}</span></div>
            </button>;
          }) : <Empty title={tr('لا توجد بيانات مستخدمين معروضة.', 'No user data was returned.')} />}
        </section>
        <section className="card admin-user-detail">
          {selectedUser ? <UserDetail
            item={selectedUser}
            lang={lang}
            tr={tr}
            services={services}
            points={points}
            setPoints={setPoints}
            grantDays={grantDays}
            setGrantDays={setGrantDays}
            serviceKey={serviceKey}
            setServiceKey={setServiceKey}
            role={role}
            setRole={setRole}
            financial={financial}
            setFinancial={setFinancial}
            assignedTo={assignedTo}
            setAssignedTo={setAssignedTo}
            users={users}
            busy={busy}
            onAction={userAction}
            onAudit={() => switchTab('audit')}
            onNotify={(recipient) => { setNotification((value) => ({ ...value, recipient })); switchTab('overview'); }}
            financialOperator={financialOperator}
          /> : <Empty title={tr('اختر مستخدماً لرؤية البطاقة التفصيلية وإجراء العمليات المصرح بها.', 'Choose a user to view the detailed card and authorized actions.')} />}
        </section>
      </div>
    </div>
  );

  const renderReviews = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('مراجعة اللقطات', 'Snapshot reviews')}</h1><p className="muted">{tr('يعرض الفرق فقط افتراضياً. النسخة المنشورة تبقى مستقلة حتى قرار اعتماد ذري.', 'Only the change set is shown by default. The published version remains independent until an atomic approval decision.')}</p></div></section>
      {reviews.length ? reviews.map((review) => {
        const id = idOf(review);
        const diff = record(field(review, 'diff', 'changes', 'delta'));
        const oldValue = field(diff, 'old', 'before', 'previous');
        const newValue = field(diff, 'new', 'after', 'current');
        const preview = text(field(review, 'preview_url', 'snapshot_url', 'approved_snapshot_url'), '');
        const expanded = selectedReview && idOf(selectedReview) === id;
        return <article className="card admin-review" key={id || text(field(review, 'submitted_at'))}>
          <div className="row admin-review-top"><div><h2>{text(field(review, 'site_name', 'name', 'title'))}</h2><p className="muted">{tr('المقدم', 'Submitted by')}: {text(field(review, 'submitter_name', 'user_name', 'email'))} · {asDate(field(review, 'submitted_at', 'created_at'), lang)}</p></div><span className={`admin-status ${statusTone(field(review, 'status'))}`}>{text(field(review, 'status', 'decision'), tr('قيد المراجعة', 'In review'))}</span></div>
          <div className="admin-diff-grid">
            <div><span className="admin-diff-label">{tr('قبل', 'Before')}</span><pre>{typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue ?? {}, null, 2)}</pre></div>
            <div><span className="admin-diff-label new">{tr('بعد', 'After')}</span><pre>{typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? {}, null, 2)}</pre></div>
          </div>
          <div className="admin-actions">
            <button className="button button-quiet" type="button" onClick={() => setSelectedReview(expanded ? null : review)}>{expanded ? tr('إخفاء التفاصيل', 'Hide details') : tr('معاينة العنصر المتغير', 'Preview changed item')}</button>
            {preview && <a className="button button-quiet" href={preview} target="_blank" rel="noreferrer">{tr('معاينة اللقطة', 'Preview snapshot')}</a>}
          </div>
          {expanded && <div className="admin-review-detail stack"><div className="admin-key-values">{Object.entries(review).filter(([key]) => !['diff', 'changes', 'delta'].includes(key)).map(([key, value]) => <div key={key}><span>{prettyKey(key)}</span><strong>{typeof value === 'object' ? '…' : text(value)}</strong></div>)}</div><label className="field"><span>{tr('سبب الرفض أو ملاحظة القرار', 'Rejection reason or decision note')}</span><textarea rows={2} value={reviewReasons[id] ?? ''} onChange={(e) => setReviewReasons((current) => ({ ...current, [id]: e.target.value }))} /></label><div className="admin-actions"><button className="button" type="button" disabled={busy === `review-${id}-approve`} onClick={() => decideReview(review, 'approve')}>{tr('اعتماد ونشر آمن', 'Approve & publish safely')}</button><button className="button button-danger" type="button" disabled={busy === `review-${id}-reject`} onClick={() => decideReview(review, 'reject')}>{tr('رفض مع السبب', 'Reject with reason')}</button></div></div>}
        </article>;
      }) : <Empty title={tr('لا توجد لقطات قيد المراجعة.', 'No snapshots are awaiting review.')} />}
    </div>
  );

  const renderPayments = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('طلبات الدفع الخاصة', 'Private payment requests')}</h1><p className="muted">{tr('الإيصالات لا تُعرض إلا من رابط مصادق عليه أعاده الخادم. اعتماد الدفع لا يُعاد أثره ولا يُرسل مرتين.', 'Receipts are exposed only through authenticated URLs returned by the server. Approval has a non-repeatable effect and cannot be sent twice.')}</p></div></section>
      <div className="admin-payment-grid">
        {payments.length ? payments.map((payment) => {
          const id = idOf(payment);
          const final = /approved|rejected|declined|cancelled/.test(text(field(payment, 'status', 'decision'), '').toLowerCase());
          const receipt = text(field(payment, 'receipt_url', 'private_receipt_url'), '');
          return <article className="card admin-payment" key={id || text(field(payment, 'created_at'))}>
            <div className="row"><div><h2>{tr('طلب', 'Request')} #{id}</h2><p className="muted">C{text(field(payment, 'user_id', 'customer_id'))} · {asDate(field(payment, 'created_at', 'submitted_at'), lang)}</p></div><span className={`admin-status ${statusTone(field(payment, 'status', 'decision'))}`}>{text(field(payment, 'status', 'decision'))}</span></div>
            <div className="admin-key-values compact"><div><span>{tr('المبلغ', 'Amount')}</span><strong>{text(field(payment, 'amount'))}</strong></div><div><span>{tr('الأيام', 'Days')}</span><strong>{text(field(payment, 'days'))}</strong></div><div><span>{tr('الملاحظات', 'Notes')}</span><strong>{text(field(payment, 'notes'))}</strong></div></div>
            <div className="admin-receipt-safe">{receipt ? <a className="button button-quiet" href={receipt} target="_blank" rel="noreferrer">{tr('فتح الإيصال الخاص', 'Open private receipt')}</a> : <span className="muted">{tr('لا يوجد رابط إيصال مصادق عليه في الاستجابة.', 'No authenticated receipt URL was returned.')}</span>}</div>
            {!final && <><label className="field"><span>{tr('سبب الرفض أو ملاحظة الاعتماد', 'Rejection reason or approval note')}</span><textarea rows={2} value={paymentReasons[id] ?? ''} onChange={(e) => setPaymentReasons((current) => ({ ...current, [id]: e.target.value }))} /></label><div className="admin-actions"><button className="button" disabled={busy === `payment-${id}-approve`} type="button" onClick={() => decidePayment(payment, 'approve')}>{tr('اعتماد مرة واحدة', 'Approve once')}</button><button className="button button-danger" disabled={busy === `payment-${id}-reject`} type="button" onClick={() => decidePayment(payment, 'reject')}>{tr('رفض', 'Reject')}</button></div></>}
            {final && <p className="admin-finality">{tr('القرار نهائي في الواجهة؛ لا يتاح تكرار اعتماد أو رفض الطلب.', 'This request is final in the console; repeat approval or rejection is unavailable.')}</p>}
          </article>;
        }) : <Empty title={tr('لا توجد طلبات دفع حالياً.', 'No payment requests were returned.')} />}
      </div>
    </div>
  );

  const renderServices = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('محرك الخدمات والاستحقاقات', 'Services & entitlements')}</h1><p className="muted">{tr('التفعيل أو التعليق العام يعيد حالة الاستحقاق السابقة عند الإتاحة. المنح والتعليق الفردي من بطاقة المستخدم.', 'Global enablement or pause restores prior entitlement on re-enable. Individual grants and pauses are controlled from a user card.')}</p></div></section>
      <div className="admin-service-grid">
        {services.length ? services.map((service) => {
          const key = text(field(service, 'key', 'id'), '');
          const enabled = Boolean(field(service, 'enabled', 'is_enabled'));
          return <article className="card admin-service" key={key}><div><h2>{text(field(service, 'name', 'title', 'key'))}</h2><p className="muted">{text(field(service, 'description'))}</p></div><div className="row"><span className={`admin-status ${enabled ? 'success' : 'danger'}`}>{enabled ? tr('مفعلة عالمياً', 'Globally enabled') : tr('معلقة عالمياً', 'Globally paused')}</span><button type="button" className="button button-quiet" disabled={!key || busy === `service-${key}`} onClick={() => void mutate(`service-${key}`, () => api(`/api/admin/services/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) }), { fresh: true, success: enabled ? tr('تم تعليق الخدمة عالمياً.', 'Service globally paused.') : tr('تمت إعادة تفعيل الخدمة عالمياً.', 'Service globally re-enabled.') })}>{enabled ? tr('تعليق', 'Pause') : tr('إعادة تفعيل', 'Re-enable')}</button></div></article>;
        }) : <Empty title={tr('لا يوجد كتالوج خدمات معروض.', 'No service catalog was returned.')} />}
      </div>
    </div>
  );

  const renderNames = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('الأسماء المحجوزة والنقل', 'Reserved names & transfers')}</h1><p className="muted">{tr('الأسماء التقنية المرتبطة بتشغيل المنصة غير قابلة للتحرير في الواجهة.', 'Technical names used by the platform are not releasable in the interface.')}</p></div></section>
      <section className="admin-grid admin-grid-2">
        <div className="card stack"><h2>{tr('حجز اسم', 'Reserve a name')}</h2><form className="stack" onSubmit={(event) => { event.preventDefault(); if (!nameForm.name || !nameForm.reason) return; void mutate('reserve-name', () => api('/api/admin/names', { method: 'POST', body: JSON.stringify(nameForm) }), { fresh: true, success: tr('تم حجز الاسم مع سبب السياسة.', 'Name reserved with its policy reason.') }).then((result) => { if (result !== undefined) setNameForm({ name: '', kind: 'policy', reason: '' }); }); }}><label className="field"><span>{tr('الاسم', 'Name')}</span><input value={nameForm.name} onChange={(e) => setNameForm((v) => ({ ...v, name: e.target.value.toLowerCase() }))} required /></label><label className="field"><span>{tr('النوع', 'Kind')}</span><select value={nameForm.kind} onChange={(e) => setNameForm((v) => ({ ...v, kind: e.target.value }))}><option value="policy">{tr('سياسة', 'Policy')}</option><option value="technical">{tr('تقني', 'Technical')}</option></select></label><label className="field"><span>{tr('السبب', 'Reason')}</span><textarea rows={2} value={nameForm.reason} onChange={(e) => setNameForm((v) => ({ ...v, reason: e.target.value }))} required /></label><button className="button" disabled={busy === 'reserve-name'}>{tr('حجز الاسم', 'Reserve name')}</button></form></div>
        <div className="card stack"><h2>{tr('طلبات النقل', 'Transfer requests')}</h2>{transfers.length ? transfers.map((transfer) => { const id = idOf(transfer); return <div className="admin-transfer" key={id}><div><strong>{text(field(transfer, 'name'))}</strong><p className="muted">{text(field(transfer, 'from_user', 'sender'))} → {text(field(transfer, 'to_user', 'recipient'))}</p></div><span className={`admin-status ${statusTone(field(transfer, 'status'))}`}>{text(field(transfer, 'status'))}</span><div className="admin-actions"><button className="button button-quiet" type="button" disabled={!id || busy === `transfer-${id}-approve`} onClick={() => void mutate(`transfer-${id}-approve`, () => api(`/api/admin/transfers/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), { fresh: true, success: tr('تم تسجيل قرار النقل.', 'Transfer decision recorded.') })}>{tr('اعتماد', 'Approve')}</button><button className="button button-danger" type="button" disabled={!id || busy === `transfer-${id}-reject`} onClick={() => void mutate(`transfer-${id}-reject`, () => api(`/api/admin/transfers/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }), { fresh: true, success: tr('تم تسجيل رفض النقل.', 'Transfer rejection recorded.') })}>{tr('رفض', 'Reject')}</button></div></div>; }) : <Empty title={tr('لا توجد طلبات نقل.', 'No transfer requests were returned.')} />}</div>
      </section>
      <section className="card stack"><h2>{tr('سجل الأسماء المحجوزة', 'Reserved-name registry')}</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{tr('الاسم', 'Name')}</th><th>{tr('النوع', 'Kind')}</th><th>{tr('السبب', 'Reason')}</th><th>{tr('الإجراء', 'Action')}</th></tr></thead><tbody>{names.length ? names.map((name) => { const nameText = text(field(name, 'name'), ''); const kind = text(field(name, 'kind', 'type'), '').toLowerCase(); const technical = kind === 'technical' || Boolean(field(name, 'technical', 'immutable')); return <tr key={nameText}><td>{nameText}</td><td><span className={`admin-status ${technical ? 'danger' : 'neutral'}`}>{technical ? tr('تقني / غير قابل للتحرير', 'Technical / immutable') : text(field(name, 'kind', 'type'))}</span></td><td>{text(field(name, 'reason'))}</td><td>{technical ? <span className="muted">{tr('محمي للتشغيل', 'Protected for operation')}</span> : <button className="button button-danger button-small" type="button" disabled={busy === `release-${nameText}`} onClick={() => void mutate(`release-${nameText}`, () => api(`/api/admin/names/${encodeURIComponent(nameText)}/release`, { method: 'POST' }), { fresh: true, success: tr('تم تحرير الاسم المحجوز.', 'Reserved name released.') })}>{tr('تحرير', 'Release')}</button>}</td></tr>; }) : <tr><td colSpan={4}>{tr('لا توجد أسماء محجوزة.', 'No reserved names were returned.')}</td></tr>}</tbody></table></div></section>
    </div>
  );

  const renderContent = () => (
    <div className="stack admin-stack">
      <section className="admin-section-intro"><div><h1 className="page-title">{tr('المحتوى والهوية والمواسم', 'Content, identity & seasons')}</h1><p className="muted">{tr('النصوص القانونية قابلة للتحرير، لكنها لا تُعرض كاعتماد قانوني. لا يُنشأ نص أو معلومة رسمية من الواجهة.', 'Legal copy is editable but is never presented as legal approval. This interface does not invent text or official information.')}</p></div></section>
      <section className="admin-content-layout">
        <div className="card admin-content-nav">{contentSlugs.map(([slug, ar, en]) => <button type="button" className={contentSlug === slug ? 'active' : ''} onClick={() => setContentSlug(slug)} key={slug}>{tr(ar, en)}</button>)}</div>
        <div className="card stack"><div className="row"><div><h2>{tr(contentSlugs.find(([slug]) => slug === contentSlug)?.[1] ?? '', contentSlugs.find(([slug]) => slug === contentSlug)?.[2] ?? '')}</h2><p className="muted">{contentMeta ? `${tr('آخر بيانات محملة', 'Last loaded metadata')}: ${asDate(field(contentMeta, 'updated_at', 'updatedAt'), lang)}` : tr('جار التحميل عند فتح القسم.', 'Loads on opening this section.')}</p></div></div><label className="field"><span>{tr('المحتوى النصي أو JSON', 'Text or JSON content')}</span><textarea className="admin-content-editor" rows={18} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} /></label><div className="admin-actions"><button className="button" type="button" disabled={busy === `content-${contentSlug}`} onClick={() => void mutate(`content-${contentSlug}`, () => api(`/api/admin/content/${contentSlug}`, { method: 'PUT', body: JSON.stringify({ content: safeJson(content) }) }), { fresh: true, success: tr('تم حفظ المحتوى.', 'Content saved.') })}>{tr('حفظ المحتوى', 'Save content')}</button></div></div>
      </section>
      <section className="card stack"><div><h2>{tr('المظهر الموسمي', 'Seasonal appearance')}</h2><p className="muted">{tr('جدولة اختيارية للعيدين واليوم الوطني ويوم التأسيس. لا يُفعّل أي مظهر بلا إعداد محفوظ.', 'Optional scheduling for both Eids, National Day, and Founding Day. No seasonal appearance is enabled without a saved setting.')}</p></div><div className="admin-form-pair"><label className="field"><span>{tr('المناسبة', 'Occasion')}</span><select value={seasonal.occasion} onChange={(e) => setSeasonal((v) => ({ ...v, occasion: e.target.value }))}><option value="eid_al_fitr">{tr('عيد الفطر', 'Eid al-Fitr')}</option><option value="eid_al_adha">{tr('عيد الأضحى', 'Eid al-Adha')}</option><option value="national_day">{tr('اليوم الوطني السعودي', 'Saudi National Day')}</option><option value="founding_day">{tr('يوم التأسيس السعودي', 'Saudi Founding Day')}</option></select></label><label className="field admin-check"><input type="checkbox" checked={seasonal.enabled} onChange={(e) => setSeasonal((v) => ({ ...v, enabled: e.target.checked }))} /><span>{tr('تفعيل المظهر عند النافذة المجدولة', 'Enable appearance during scheduled window')}</span></label><label className="field"><span>{tr('البداية (Epoch)', 'Start (epoch)')}</span><input inputMode="numeric" value={seasonal.starts_at} onChange={(e) => setSeasonal((v) => ({ ...v, starts_at: e.target.value }))} /></label><label className="field"><span>{tr('النهاية (Epoch)', 'End (epoch)')}</span><input inputMode="numeric" value={seasonal.ends_at} onChange={(e) => setSeasonal((v) => ({ ...v, ends_at: e.target.value }))} /></label></div><button className="button" type="button" disabled={busy === 'seasonal'} onClick={() => void mutate('seasonal', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'seasonal', value: seasonal }) }), { fresh: true, success: tr('تم حفظ جدولة المظهر الموسمي.', 'Seasonal schedule saved.') })}>{tr('حفظ الجدولة', 'Save schedule')}</button></section>
    </div>
  );

  const renderLock = () => {
    const bankData = field(record(data.settings), 'bank_instructions', 'bank', 'payment_instructions');
    return <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('قفل المنصة وإعدادات التشغيل', 'Platform lock & operating settings')}</h1><p className="muted">{tr('الوضع الافتراضي الخاص محفوظ في الواجهة. كلمة المرور بوابة عرض مؤقتة وليست بديلاً عن المصادقة.', 'The private default is preserved in the interface. A password is a temporary viewing gate, never a substitute for authentication.')}</p></div></section><section className="admin-grid admin-grid-2"><form className="card stack" onSubmit={(event) => { event.preventDefault(); const value: JsonRecord = { mode: lock.mode, reason: lock.reason, message: lock.message }; if (lock.password) value.password = lock.password; void mutate('platform-lock', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'platform_lock', value }) }), { fresh: true, success: tr('تم حفظ وضع قفل المنصة.', 'Platform lock mode saved.') }).then((result) => { if (result !== undefined) setLock((v) => ({ ...v, password: '' })); }); }}><div><h2>{tr('وضع القفل', 'Lock mode')}</h2><p className="muted">{tr('الخادم يحمي الواجهات والبيانات تحت القفل؛ البوابة لا تكشف محتوى خاصاً.', 'The server protects routes and data under the lock; the gate never exposes private content.')}</p></div><label className="field"><span>{tr('النطاق', 'Scope')}</span><select value={lock.mode} onChange={(e) => setLock((v) => ({ ...v, mode: e.target.value }))}>{lockModes.map(([value, ar, en]) => <option value={value} key={value}>{tr(ar, en)}</option>)}</select></label><label className="field"><span>{tr('سبب الإغلاق', 'Lock reason')}</span><input value={lock.reason} onChange={(e) => setLock((v) => ({ ...v, reason: e.target.value }))} /></label><label className="field"><span>{tr('نص بطاقة القفل', 'Lock card message')}</span><textarea rows={3} value={lock.message} onChange={(e) => setLock((v) => ({ ...v, message: e.target.value }))} /></label><label className="field"><span>{tr('كلمة مرور الوصول الخاص', 'Private access password')}</span><input type="password" autoComplete="new-password" value={lock.password} placeholder={tr('اتركها فارغة للاحتفاظ بالقيمة الحالية', 'Leave blank to preserve the current value')} onChange={(e) => setLock((v) => ({ ...v, password: e.target.value }))} /></label><button className="button" disabled={busy === 'platform-lock'}>{tr('حفظ القفل', 'Save lock')}</button></form><section className="card stack"><div><h2>{tr('بيانات الحوالة الرسمية', 'Official bank transfer details')}</h2><p className="muted">{tr('لا تُخترع بيانات بنكية. عند عدم توافرها يظل استقبال التحويلات معطلاً، ولا يُعرض تحويل إلى جهة مجهولة.', 'Bank details are never invented. When absent, transfer collection remains disabled and no transfer to an unknown party is shown.')}</p></div>{bankData === undefined || bankData === null || bankData === '' ? <div className="admin-unavailable">{tr('لم يرد من الإعدادات أي بيانات بنكية رسمية.', 'No official bank information was returned in settings.')}</div> : <pre className="admin-bank-info">{typeof bankData === 'string' ? bankData : JSON.stringify(bankData, null, 2)}</pre>}<label className="field"><span>{tr('إدخال/تحديث التعليمات البنكية الرسمية فقط', 'Enter/update official bank instructions only')}</span><textarea rows={7} value={bankInstructions} onChange={(event) => setBankInstructions(event.target.value)} placeholder={tr('أدخل بيانات الجهة الرسمية المتحققة فقط', 'Enter verified official recipient details only')} /></label><button type="button" className="button" disabled={busy === 'bank-instructions'} onClick={() => void mutate('bank-instructions', () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'bank_instructions', value: safeJson(bankInstructions) }) }), { fresh: true, success: tr('تم حفظ التعليمات البنكية الرسمية.', 'Official bank instructions saved.') })}>{tr('حفظ التعليمات الرسمية', 'Save official instructions')}</button><p className="muted">{tr('لا تدخل إلا بيانات رسمية متحققة. تُدار المعلومات من قيمة إعداد الخادم ولا تعيد الواجهة صوغها أو تخمينها.', 'Enter only verified official information. It is stored in the server setting; the UI neither rewrites nor guesses it.')}</p></section></section></div>;
  };

  const renderEconomics = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('اقتصاديات المنصة', 'Platform economics')}</h1><p className="muted">{tr('كل مؤشر معروض من بيانات النظام. التكلفة أو الربحية غير المتاحة تبقى “غير متاح” ولا تتحول إلى رقم تقديري.', 'Every metric comes from system data. Unavailable costs or profitability remain unavailable, never an estimate.')}</p></div></section><section className="admin-metrics">{economicMetrics.map(([key, ar, en]) => <article className="admin-metric card" key={key}><span className="muted">{tr(ar, en)}</span><strong>{text(valueAt(data.economics, key), tr('غير متاح', 'Unavailable'))}</strong></article>)}</section><section className="admin-grid admin-grid-2"><div className="card stack"><h2>{tr('تسجيل مصروف يدوي', 'Record a manual expense')}</h2><p className="muted">{tr('الإدخال اليدوي للمصروفات يضيف سجلاً ولا يختلق تكلفة استهلاك.', 'Manual expense entry adds a record; it does not fabricate usage cost.')}</p><form className="stack" onSubmit={(event) => { event.preventDefault(); if (!expense.label || !expense.amount) return; void mutate('expense', () => api('/api/admin/expenses', { method: 'POST', body: JSON.stringify({ label: expense.label, amount: Number(expense.amount), notes: expense.notes }) }), { fresh: true, success: tr('تم تسجيل المصروف.', 'Expense recorded.') }).then((result) => { if (result !== undefined) setExpense({ label: '', amount: '', notes: '' }); }); }}><label className="field"><span>{tr('الوصف', 'Description')}</span><input value={expense.label} onChange={(e) => setExpense((v) => ({ ...v, label: e.target.value }))} /></label><label className="field"><span>{tr('المبلغ', 'Amount')}</span><input inputMode="decimal" value={expense.amount} onChange={(e) => setExpense((v) => ({ ...v, amount: e.target.value }))} /></label><label className="field"><span>{tr('ملاحظات', 'Notes')}</span><textarea rows={2} value={expense.notes} onChange={(e) => setExpense((v) => ({ ...v, notes: e.target.value }))} /></label><button className="button" disabled={!financialOperator || busy === 'expense'}>{financialOperator ? tr('تسجيل المصروف', 'Record expense') : tr('يتطلب تفويضاً مالياً', 'Financial delegation required')}</button></form></div><div className="card stack"><h2>{tr('خزينة النقاط', 'Points treasury')}</h2><p className="muted">{tr('إصدار النقاط محصور بالمالك ويُسجل في دفتر الأستاذ. استخدم بطاقة المستخدم للإصدار المستهدف.', 'Point issuance is owner-only and ledgered. Use a user card for targeted issuance.')}</p><button className="button" type="button" disabled={!owner} onClick={() => switchTab('users')}>{owner ? tr('فتح إصدار النقاط للمستخدم', 'Open user point issuance') : tr('محصور بالمالك', 'Owner only')}</button><p className="admin-finality">{tr('لا يوجد إصدار جماعي أو رصيد تخميني في هذه الواجهة.', 'There is no bulk issuance or estimated balance in this console.')}</p></div></section></div>
  );

  const renderAudit = () => (
    <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('سجل التدقيق', 'Audit trail')}</h1><p className="muted">{tr('سجل للعمليات الحساسة؛ لا يمنح الوصول إلى رسائل المستخدمين الخاصة.', 'A trail for sensitive operations; it does not grant access to users’ private messages.')}</p></div></section><section className="card admin-table-wrap"><table className="admin-table"><thead><tr><th>{tr('الوقت', 'Time')}</th><th>{tr('الإجراء', 'Action')}</th><th>{tr('الهدف', 'Target')}</th><th>{tr('بواسطة', 'By')}</th><th>{tr('التفاصيل', 'Details')}</th></tr></thead><tbody>{audit.length ? audit.map((entry, index) => <tr key={`${idOf(entry)}-${index}`}><td>{asDate(field(entry, 'created_at', 'at', 'timestamp'), lang)}</td><td>{text(field(entry, 'action'))}</td><td>{text(field(entry, 'target', 'target_id'))}</td><td>{text(field(entry, 'actor_name', 'actor', 'user_id'))}</td><td><span className="admin-detail-text">{text(field(entry, 'detail', 'details', 'reason'))}</span></td></tr>) : <tr><td colSpan={5}>{tr('لا توجد أحداث تدقيق معروضة.', 'No audit events were returned.')}</td></tr>}</tbody></table></section></div>
  );

  const renderBackup = () => {
    const info = record(backup);
    const url = text(field(info, 'download_url', 'downloadUrl', 'url'), '');
    const sha = text(field(info, 'sha256', 'sha', 'checksum'), '');
    return <div className="stack admin-stack"><section className="admin-section-intro"><div><h1 className="page-title">{tr('نسخة احتياطية مصادق عليها', 'Authenticated backup')}</h1><p className="muted">{tr('يتطلب هذا المسار تحققاً حديثاً من البريد. لا يُتاح رابط تحميل أو بصمة إلا من استجابة الخادم.', 'This route requires fresh email verification. A download link and checksum are shown only when supplied by the server response.')}</p></div></section><section className="card admin-backup-card"><div className="admin-backup-mark">SHA</div><div className="stack"><h2>{tr('معلومات النسخ والاستعادة', 'Backup & restore information')}</h2>{backup === undefined ? <p className="muted">{tr('جار طلب بيانات النسخة…', 'Requesting backup information…')}</p> : <><div className="admin-key-values"><div><span>{tr('حالة النسخة', 'Backup status')}</span><strong>{text(field(info, 'status'))}</strong></div><div><span>{tr('وقت الإنشاء', 'Created at')}</span><strong>{asDate(field(info, 'created_at', 'createdAt'), lang)}</strong></div><div><span>SHA-256</span><strong className="admin-mono">{sha || tr('لم ترد بصمة', 'No checksum returned')}</strong></div></div><div className="admin-actions">{url ? <a className="button" href={url} target="_blank" rel="noreferrer">{tr('تنزيل النسخة المصادق عليها', 'Download authenticated backup')}</a> : <span className="admin-unavailable">{tr('لم يُعد الخادم رابط تنزيل مصادقاً عليه.', 'The server did not return an authenticated download URL.')}</span>}<button type="button" className="button button-quiet" disabled={busy === 'backup-refresh'} onClick={() => void mutate('backup-refresh', async () => { const response = await api<unknown>('/api/admin/backup'); setBackup(response); return response; }, { fresh: true, reload: false, success: tr('تم تحديث بيانات النسخة.', 'Backup metadata refreshed.') })}>{tr('تحديث', 'Refresh')}</button></div></>}</div></section></div>;
  };

  let contentView = renderOverview();
  switch (tab) {
    case 'users': contentView = renderUsers(); break;
    case 'reviews': contentView = renderReviews(); break;
    case 'payments': contentView = renderPayments(); break;
    case 'services': contentView = renderServices(); break;
    case 'names': contentView = renderNames(); break;
    case 'content': contentView = renderContent(); break;
    case 'lock': contentView = renderLock(); break;
    case 'economics': contentView = renderEconomics(); break;
    case 'audit': contentView = renderAudit(); break;
    case 'backup': contentView = renderBackup(); break;
    default: contentView = renderOverview();
  }

  return <main className="admin-console" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <header className="admin-topbar">
      <div className="admin-brand"><span className="admin-brand-glyph">K</span><div><strong>KSA.MEN</strong><span>{tr('الإدارة', 'ADMINISTRATION')}</span></div></div>
      <div className="admin-topbar-actions"><button type="button" className="button button-quiet" onClick={() => void refresh()}>{tr('تحديث الجلسة', 'Refresh session')}</button><button type="button" className="button button-quiet" onClick={() => void load()} disabled={loading}>{loading ? tr('جار التحميل', 'Loading') : tr('تحديث البيانات', 'Refresh data')}</button></div>
    </header>
    <nav className="admin-tabs" aria-label={tr('تنقل الإدارة', 'Administration navigation')}>
      {tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => switchTab(item.id)}>{tr(item.ar, item.en)}{item.owner && <small>{tr('مالك', 'Owner')}</small>}</button>)}
    </nav>
    {error && <div className="admin-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label={tr('إغلاق', 'Dismiss')}>×</button></div>}
    {loading && !Object.keys(data).length ? <div className="card admin-loading">{tr('يجري تحميل بيانات الإدارة الحية…', 'Loading live administration data…')}</div> : contentView}
  </main>;
}

function Empty({ title }: { title: string }) {
  return <div className="admin-empty card"><span className="admin-empty-mark">—</span><p>{title}</p></div>;
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
  financialOperator: boolean;
  onAction: (action: 'status' | 'role' | 'grant' | 'points' | 'service' | 'assign' | 'branding', payload: JsonRecord, label: string, fresh?: boolean) => void;
  onAudit: () => void;
  onNotify: (recipient: string) => void;
};

function UserDetail(props: UserDetailProps) {
  const { item, lang, tr, services, users, points, setPoints, grantDays, setGrantDays, serviceKey, setServiceKey, role, setRole, financial, setFinancial, assignedTo, setAssignedTo, busy, onAction, onAudit, onNotify, financialOperator } = props;
  const id = idOf(item);
  const whatsapp = text(field(item, 'whatsapp', 'phone'), '');
  const phoneLink = whatsapp.replace(/\D/g, '');
  const siteUrl = text(field(item, 'site_url', 'url', 'domain_url'), '');
  const deletionStatus = field(item, 'deletion_request_status', 'deletion_status');
  const activeServices = field(item, 'services', 'enabled_services');
  const recent = field(item, 'recent_activity', 'activities', 'last_activity');
  const managerCandidates = users.filter((entry) => ['owner', 'manager'].includes(text(field(entry, 'role'), '').toLowerCase()));
  return <div className="stack">
    <div className="row admin-detail-heading"><div><p className="admin-eyebrow">C{id}</p><h1>{text(field(item, 'name', 'full_name', 'email'))}</h1><p className="muted">{text(field(item, 'email'))}</p></div><span className={`admin-status ${statusTone(field(item, 'status'))}`}>{text(field(item, 'status'))}</span></div>
    <div className="admin-key-values"><div><span>{tr('واتساب', 'WhatsApp')}</span><strong>{whatsapp}</strong></div><div><span>{tr('النطاق', 'Domain')}</span><strong>{text(field(item, 'domain', 'subdomain', 'name'))}</strong></div><div><span>{tr('حالة الموقع', 'Site status')}</span><strong>{text(field(item, 'site_status'))}</strong></div><div><span>{tr('الاشتراك', 'Subscription')}</span><strong>{text(field(item, 'subscription_status', 'entitlement_status'))}</strong></div><div><span>{tr('الاستحقاق', 'Entitlement')}</span><strong>{asDate(field(item, 'entitlement_until', 'expires_at'), lang)}</strong></div><div><span>{tr('الرصيد', 'Balance')}</span><strong>{text(field(item, 'balance'))}</strong></div><div><span>{tr('المشرف المسؤول', 'Assigned administrator')}</span><strong>{text(field(item, 'assigned_to', 'manager_name', 'admin_name'))}</strong></div><div><span>{tr('الدور', 'Role')}</span><strong>{text(field(item, 'role'))}</strong></div></div>
    <div className="admin-user-context"><div><h3>{tr('الخدمات المفعلة أو المعلقة', 'Enabled or paused services')}</h3><pre>{typeof activeServices === 'string' ? activeServices : JSON.stringify(activeServices ?? [], null, 2)}</pre></div><div><h3>{tr('آخر النشاطات', 'Recent activity')}</h3><pre>{typeof recent === 'string' ? recent : JSON.stringify(recent ?? [], null, 2)}</pre></div></div>
    {deletionStatus !== undefined && <div className="admin-deletion-note"><strong>{tr('طلب حذف البيانات', 'Data deletion request')}</strong><span>{text(deletionStatus)}</span><p>{tr('هذا سجل حالة فقط. لا تقدم هذه الواجهة حذفاً نهائياً أو وعداً بإزالة فورية.', 'This is status only. This console never offers hard deletion or promises immediate erasure.')}</p></div>}
    <div className="admin-actions"><button className="button button-quiet" type="button" onClick={() => { if (siteUrl) window.open(siteUrl, '_blank', 'noreferrer'); }}>{tr('معاينة', 'Preview')}</button><button className="button" type="button" disabled={busy === `user-${id}-status`} onClick={() => onAction('status', { status: 'approved' }, tr('تم اعتماد حالة المستخدم.', 'User status approved.'))}>{tr('اعتماد', 'Approve')}</button><button className="button button-danger" type="button" disabled={busy === `user-${id}-status`} onClick={() => onAction('status', { status: 'suspended' }, tr('تم تعليق المستخدم.', 'User suspended.'))}>{tr('تعليق', 'Suspend')}</button><button className="button button-quiet" type="button" disabled={busy === `user-${id}-status`} onClick={() => onAction('status', { status: 'published' }, tr('تم إرسال حالة النشر للتحقق بالخادم.', 'Publish status submitted for server validation.'))}>{tr('نشر', 'Publish')}</button>{phoneLink && <a className="button button-quiet" href={`https://wa.me/${phoneLink}`} target="_blank" rel="noreferrer">{tr('فتح واتساب', 'Open WhatsApp')}</a>}<button className="button button-quiet" type="button" onClick={() => onNotify(`C${id}`)}>{tr('إشعار', 'Notify')}</button><button className="button button-quiet" type="button" onClick={onAudit}>{tr('مراجعة السجل', 'Review audit')}</button></div>
    <div className="admin-detail-forms"><div className="admin-mini-form"><h3>{tr('تمديد الاستحقاق', 'Extend entitlement')}</h3><input aria-label={tr('الأيام', 'Days')} inputMode="numeric" value={grantDays} onChange={(e) => setGrantDays(e.target.value)} /><button className="button button-small" type="button" onClick={() => onAction('grant', { days: Number(grantDays) }, tr('تمت إضافة أيام الاستحقاق.', 'Entitlement days granted.'), true)}>{tr('منح أيام', 'Grant days')}</button></div><div className="admin-mini-form"><h3>{tr('إصدار نقاط', 'Issue points')}</h3><input aria-label={tr('عدد النقاط', 'Point amount')} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /><button className="button button-small" type="button" disabled={!financialOperator} onClick={() => onAction('points', { amount: Number(points) }, tr('تم إرسال إصدار النقاط إلى دفتر الأستاذ.', 'Point issuance submitted to the ledger.'), true)}>{financialOperator ? tr('إضافة نقاط', 'Add points') : tr('تفويض مالي مطلوب', 'Financial delegation required')}</button></div><div className="admin-mini-form"><h3>{tr('خدمة فردية', 'Individual service')}</h3><select value={serviceKey} onChange={(e) => setServiceKey(e.target.value)}>{services.map((service) => <option key={text(field(service, 'key', 'id'))} value={text(field(service, 'key', 'id'))}>{text(field(service, 'name', 'key', 'id'))}</option>)}</select><div className="admin-actions"><button className="button button-small" type="button" onClick={() => onAction('service', { key: serviceKey, mode: 'grant' }, tr('تم منح الخدمة فردياً.', 'Service granted individually.'))}>{tr('تفعيل', 'Enable')}</button><button className="button button-small button-danger" type="button" onClick={() => onAction('service', { key: serviceKey, mode: 'pause' }, tr('تم تعليق الخدمة فردياً.', 'Service paused individually.'))}>{tr('تعليق', 'Pause')}</button></div></div></div>
    <div className="admin-detail-forms"><div className="admin-mini-form"><h3>{tr('الدور والتفويض المالي', 'Role & financial delegation')}</h3><select value={role} onChange={(e) => setRole(e.target.value)}><option value="moderator">{tr('مشرف', 'Moderator')}</option><option value="manager">{tr('مدير مسؤول', 'Manager')}</option><option value="owner">{tr('مالك', 'Owner')}</option></select><label className="admin-check"><input type="checkbox" checked={financial} onChange={(e) => setFinancial(e.target.checked)} /><span>{tr('تفويض مالي صريح', 'Explicit financial delegation')}</span></label><button className="button button-small" type="button" onClick={() => onAction('role', { role, financial }, tr('تم إرسال تعديل الدور للتدقيق بالخادم.', 'Role update submitted for server enforcement.'), true)}>{tr('حفظ الدور', 'Save role')}</button></div><div className="admin-mini-form"><h3>{tr('إسناد مشرف', 'Assign administrator')}</h3><select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}><option value="">{tr('اختر مشرفاً', 'Select an administrator')}</option>{managerCandidates.map((candidate) => <option key={idOf(candidate)} value={idOf(candidate)}>{text(field(candidate, 'name', 'email'))} (C{idOf(candidate)})</option>)}</select><button className="button button-small" type="button" onClick={() => onAction('assign', { assignedTo }, tr('تم إسناد المشرف.', 'Administrator assigned.'))}>{tr('إسناد', 'Assign')}</button></div><div className="admin-mini-form"><h3>{tr('هوية الموقع', 'Site branding')}</h3><p className="muted">{tr('تطبيق إعدادات الهوية يحتاج مفتاحاً ونمطاً مخولين من الخادم.', 'Branding changes require a server-authorized key and mode.')}</p><button className="button button-small" type="button" onClick={() => onAction('branding', { key: 'platform_branding', mode: 'inherit' }, tr('تم طلب تطبيق الهوية الافتراضية.', 'Default branding inheritance requested.'))}>{tr('تطبيق الافتراضي', 'Apply default')}</button></div></div>
  </div>;
}

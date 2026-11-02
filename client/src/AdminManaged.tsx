import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Mail, Plus, RefreshCcw, UserRound, Pencil } from 'lucide-react';
import { api, useApp } from './lib';
import { publicationLabel } from './publication';

type Account = { id: number; name: string; email: string; whatsapp: string; subdomain: string; site_id: string; site_status: string; management_status: 'managed' | 'claimed'; managed_by: number };
type Operator = { id: number; name: string; role: string; status: string };
const empty = { name: '', email: '', whatsapp: '', subdomain: '', pin: '', title: '', bio: '', managerId: '', authorized: false };

export default function AdminManaged() {
  const { user, t, notify, lang } = useApp();
  const owner = user?.role === 'owner';
  const [accounts, setAccounts] = useState<Account[]>([]), [operators, setOperators] = useState<Operator[]>([]);
  const [form, setForm] = useState(empty), [expanded, setExpanded] = useState(false), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<Record<number, string>>({}), [assignments, setAssignments] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    try { const result = await api<{ accounts: Account[] }>('/api/admin/managed-accounts'); setAccounts(result.accounts); }
    catch (e) { setError(e instanceof Error ? e.message : t('تعذر التحميل', 'Could not load')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); if (owner) void api<{ users: Operator[] }>('/api/admin/users').then(result => setOperators(result.users.filter(item => ['owner', 'manager', 'moderator'].includes(item.role) && item.status === 'active'))).catch(() => {}); }, [load, owner]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy('create'); setError('');
    try {
      const result = await api<{ siteId: string; editUrl: string }>('/api/admin/managed-accounts', { method: 'POST', body: JSON.stringify({ ...form, managerId: form.managerId ? Number(form.managerId) : undefined }) });
      setForm(empty); setExpanded(false); await load(); notify(t('الحساب جاهز. حرّر هويته ثم انشرها.', 'Account created. Edit the identity, then publish it.'));
      document.getElementById('managed-account-list')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (!result.siteId) throw new Error(t('تعذر إنشاء الحساب', 'Could not create this account'));
    } catch (e) { setError(e instanceof Error ? e.message : t('تعذر إنشاء الحساب', 'Could not create this account')); }
    finally { setBusy(''); }
  }
  async function perform(account: Account, action: 'publish' | 'deliver' | 'assign') {
    if (busy) return; setBusy(`${action}-${account.id}`); setError('');
    try {
      if (action === 'publish') {
        const result = await api<{ published: boolean; url: string }>(`/api/admin/sites/${account.site_id}/publish`, { method: 'POST' });
        if (!result.published) throw new Error(t('لم يكتمل النشر، حدّث الحساب.', 'Publication did not finish. Refresh the account.'));
        notify(t('نُشر الموقع وأصبح متاحاً على رابطه.', 'The site is published and available at its address.'));
      } else if (action === 'deliver') {
        await api(`/api/admin/managed-accounts/${account.id}/deliver`, { method: 'POST', body: JSON.stringify({ email: emails[account.id] || account.email }) });
        notify(t('أُرسلت دعوة الاستلام بالبريد. يبقى الحساب بإدارتك حتى يقبلها صاحبه.', 'An acceptance invitation was emailed. You retain control until its owner accepts.'));
      } else {
        await api(`/api/admin/managed-accounts/${account.id}/assign`, { method: 'POST', body: JSON.stringify({ managerId: Number(assignments[account.id] || account.managed_by) }) });
        notify(t('تم تعيين المشرف المسؤول.', 'Responsible operator assigned.'));
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('تعذر إكمال العملية', 'Could not complete this operation')); }
    finally { setBusy(''); }
  }
  const visible = accounts.filter(item => `${item.name} ${item.subdomain} ${item.email}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="stack admin-stack admin-managed"><section className="admin-section-intro"><div><h1 className="page-title">{t('الحسابات المدارة', 'Managed accounts')}</h1><p className="muted">{t('أنشئ الهوية، حرّرها، وانشرها. اختر مشرفها أو سلّم إدارتها لصاحبها.', 'Create, edit, and publish an identity. Choose its operator or hand control to its owner.')}</p></div><button className="button button-quiet" onClick={() => void load()} disabled={!!busy}><RefreshCcw size={17}/>{t('تحديث', 'Refresh')}</button>{owner && <button className="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><Plus size={18}/>{t('إنشاء حساب مدار', 'Create managed account')}</button>}</section>{error && <div className="admin-alert" role="alert">{error}</div>}{owner && expanded && <form className="card stack" onSubmit={create}><h2>{t('حساب جديد بإدارة فريقك', 'A new account managed by your team')}</h2><div className="admin-managed-form">{(['name', 'email', 'whatsapp', 'subdomain', 'pin', 'title'] as const).map(key => <label className="field" key={key}><span>{{ name: t('اسم صاحب الهوية', 'Identity owner name'), email: t('بريد التواصل والاستلام', 'Contact and acceptance email'), whatsapp: t('واتساب', 'WhatsApp'), subdomain: t('اسم الموقع', 'Site name'), pin: t('PIN من ستة أرقام', 'Six-digit PIN'), title: t('المسمى المهني', 'Professional title') }[key]}</span><input required={key !== 'title'} autoComplete={key === 'pin' ? 'new-password' : 'off'} type={key === 'email' ? 'email' : key === 'pin' ? 'password' : 'text'} inputMode={['whatsapp', 'pin'].includes(key) ? 'numeric' : undefined} dir={['email', 'whatsapp', 'subdomain', 'pin'].includes(key) ? 'ltr' : undefined} pattern={key === 'pin' ? '[0-9]{6}' : key === 'subdomain' ? '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?' : undefined} maxLength={key === 'pin' ? 6 : key === 'subdomain' ? 63 : 254} value={form[key]} onChange={event => setForm({ ...form, [key]: key === 'subdomain' ? event.target.value.toLowerCase() : event.target.value })}/></label>)}<label className="field"><span>{t('المشرف المسؤول', 'Responsible operator')}</span><select value={form.managerId} onChange={event => setForm({ ...form, managerId: event.target.value })}><option value="">{t('بإدارتي', 'Managed by me')}</option>{operators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label className="field"><span>{t('نبذة', 'Biography')}</span><textarea rows={3} value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })}/></label><label className="check"><input required type="checkbox" checked={form.authorized} onChange={event => setForm({ ...form, authorized: event.target.checked })}/><span>{t('أُنشئ هذا الحساب وأديره بتفويض من صاحبه أو بصفته حساباً تجريبياً تحت مسؤولية الإدارة.', 'I create and manage this account with its owner’s authorization or as an administrative test account.')}</span></label><button className="button" disabled={!!busy || !form.authorized}><Check size={17}/>{busy === 'create' ? t('جارٍ الإنشاء', 'Creating') : t('إنشاء الحساب', 'Create account')}</button></form>}<label className="field"><span>{t('البحث في الحسابات', 'Find an account')}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('الاسم أو الموقع أو البريد', 'Name, site, or email')}/></label><section className="admin-managed-list" id="managed-account-list">{loading ? <p>{t('نحمّل حساباتك', 'Loading your accounts')}</p> : visible.map(account => <article className="card stack" key={account.id}><header className="admin-section-heading"><div><p className="admin-eyebrow">{account.management_status === 'claimed' ? t('بإدارة صاحبه', 'OWNER MANAGED') : t('بإدارة الفريق', 'TEAM MANAGED')}</p><h2><UserRound size={20}/>{account.name}</h2><bdi dir="ltr">{account.subdomain}.ksa.men</bdi></div><span className="admin-status">{publicationLabel(account.site_status, lang)}</span></header><div className="admin-actions"><a className="button button-secondary" href={`/dashboard?site=${account.site_id}&tab=editor`}><Pencil size={16}/>{t('تحرير الهوية', 'Edit identity')}</a><button className="button" disabled={!!busy} onClick={() => void perform(account, 'publish')}><Check size={17}/>{busy === `publish-${account.id}` ? t('جارٍ النشر', 'Publishing') : account.site_status === 'published' ? t('نشر أحدث تعديل', 'Publish latest changes') : t('نشر الموقع', 'Publish site')}</button>{account.site_status === 'published' && <a className="button button-quiet" target="_blank" rel="noreferrer" href={`https://${account.subdomain}.ksa.men`}><ExternalLink size={16}/>{t('فتح الموقع', 'Open site')}</a>}</div>{owner && account.management_status === 'managed' && <details><summary>{t('الإدارة وتسليم الحساب', 'Management & acceptance')}</summary><div className="stack"><label className="field"><span>{t('المشرف المسؤول', 'Responsible operator')}</span><select value={assignments[account.id] || account.managed_by} onChange={event => setAssignments({ ...assignments, [account.id]: event.target.value })}>{operators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button-quiet" disabled={!!busy} onClick={() => void perform(account, 'assign')}>{t('تعيين المشرف', 'Assign operator')}</button><label className="field"><span>{t('بريد صاحب الحساب', 'Account owner email')}</span><input type="email" value={emails[account.id] ?? account.email} onChange={event => setEmails({ ...emails, [account.id]: event.target.value })}/></label><p className="muted">{t('تُرسل دعوة مؤقتة. بعد قبولها مرة واحدة تصبح إدارة الحساب لصاحبه.', 'A temporary invitation is emailed. One acceptance gives the owner control.')}</p><button className="button" disabled={!!busy} onClick={() => void perform(account, 'deliver')}><Mail size={17}/>{t('إرسال دعوة الاستلام', 'Email acceptance invitation')}</button></div></details>}</article>)}{!loading && !visible.length && <p>{t('لا توجد حسابات مدارة مطابقة.', 'No matching managed accounts.')}</p>}</section></div>;
}

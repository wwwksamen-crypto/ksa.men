import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, ExternalLink, Trash2, X } from 'lucide-react';
import { api, useApp } from './lib';
import './notifications.css';

export type InboxNotification = { id: string; title: string; body?: string; created_at: number; read_at?: number | null; action_url?: string | null };
type Inbox = { notifications: InboxNotification[]; unread: number; next: { before: number; beforeId: string } | null };
function firstPartyLink(value: string | null | undefined) {
  if (!value) return null;
  try { const u = new URL(value, 'https://ksa.men'); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'ksa.men' || /^[a-z0-9-]+\.ksa\.men$/.test(u.hostname)) ? u.href : null; } catch { return null; }
}
export default function NotificationCenter() {
  const { user, t, lang, notify } = useApp();
  const [data, setData] = useState<Inbox>({ notifications: [], unread: 0, next: null });
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null), generation = useRef(0), mutation = useRef(false), inFlight = useRef(false), userId = useRef(user?.id);
  userId.current = user?.id;
  const publish = useCallback((next: Inbox) => {
    setData(next);
    window.dispatchEvent(new CustomEvent('ksa:notifications-updated', { detail: { ...next, userId: userId.current } }));
  }, []);
  const load = useCallback(async (cursor?: Inbox['next'], force = false) => {
    if (!userId.current || mutation.current || (inFlight.current && !force)) return;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const sequence = ++generation.current, id = userId.current; inFlight.current = true;
    setLoading(true);
    try {
      const next = await api<Inbox>('/api/notifications' + (cursor ? `?before=${cursor.before}&beforeId=${encodeURIComponent(cursor.beforeId)}` : ''), { signal: controller.signal });
      if (sequence !== generation.current || userId.current !== id) return;
      if (cursor) setData(previous => ({ ...next, notifications: [...previous.notifications, ...next.notifications.filter(n => !previous.notifications.some(old => old.id === n.id))] }));
      else { publish(next); setSelected(previous => previous.filter(id => next.notifications.some(n => n.id === id))); }
      setError('');
    } catch (e) { if (!controller.signal.aborted && sequence === generation.current) setError(t('تعذر تحميل التنبيهات. يمكنك المحاولة من جديد.', 'Notifications could not load. Please retry.')); }
    finally { if (sequence === generation.current) { inFlight.current = false; setLoading(false); } }
  }, [publish, t]);
  useEffect(() => {
    generation.current++; abort.current?.abort(); inFlight.current = false; mutation.current = false;
    setOpen(false); setSelected([]); setData({ notifications: [], unread: 0, next: null });
    void load();
    const refresh = () => { if (document.visibilityState !== 'hidden' && navigator.onLine !== false && !dialog.current?.open) void load(); };
    const timer = window.setInterval(refresh, 60000);
    const forced = () => { if (!mutation.current) void load(undefined, true); };
    window.addEventListener('ksa:notifications-refresh', forced); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('ksa:notifications-refresh', forced); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); abort.current?.abort(); generation.current++; };
  }, [user?.id, load]);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current; if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : button.current;
    node.showModal(); node.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    void load(undefined, true);
    return () => { node.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open]);
  async function action(kind: 'read' | 'dismiss', ids: string[] = [], all = false) {
    if (mutation.current || (!all && !ids.length)) return;
    mutation.current = true; setBusy(true); abort.current?.abort(); generation.current++; inFlight.current = false;
    const id = userId.current;
    try {
      const batches=all?[[]]:Array.from({length:Math.ceil(ids.length/80)},(_,index)=>ids.slice(index*80,(index+1)*80));
      for(const batch of batches){if(userId.current!==id)return;await api('/api/notifications/' + kind, { method: 'POST', body: JSON.stringify(kind === 'read' ? { ids:batch } : all ? { scope: 'all' } : { scope: 'selected', ids:batch }) });}
      if (userId.current !== id) return;
      setData(previous => {
        const notifications = kind === 'dismiss' ? (all ? [] : previous.notifications.filter(n => !ids.includes(n.id))) : previous.notifications.map(n => ids.includes(n.id) ? { ...n, read_at: Math.floor(Date.now() / 1000) } : n);
        return { ...previous, notifications, unread: Math.max(0, previous.unread - previous.notifications.filter(n => !n.read_at && (all || ids.includes(n.id))).length) };
      });
      if (kind === 'dismiss') { setSelected(previous => all ? [] : previous.filter(id => !ids.includes(id))); notify(t('أُزيلت التنبيهات من صندوقك.', 'Notifications removed from your inbox.')); }
      setError('');
    } catch (e) { if (id === userId.current) setError(e instanceof Error ? e.message : t('تعذر إكمال الإجراء.', 'Could not complete this action.')); }
    finally { if (userId.current === id) { mutation.current = false; setBusy(false); void load(undefined, true); } }
  }
  const unreadIds = data.notifications.filter(n => !n.read_at).map(n => n.id);
  return <><button ref={button} className="notification-bell icon-button" type="button" onClick={() => { button.current?.focus({ preventScroll: true }); setOpen(true); }} aria-haspopup="dialog" aria-label={t(`إشعاراتي، ${data.unread} غير مقروء`, `My notifications, ${data.unread} unread`)}><Bell size={20}/>{data.unread > 0 && <span aria-hidden="true">{data.unread > 99 ? '99+' : data.unread}</span>}</button>{open && <dialog className="notification-center" ref={dialog} aria-labelledby="notification-center-title" onCancel={e => { e.preventDefault(); setOpen(false); }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }} dir={lang === 'ar' ? 'rtl' : 'ltr'}><header><div><h2 id="notification-center-title">{t('إشعاراتي', 'My notifications')}</h2><p>{t('تحديثاتك في مكان واحد.', 'Your updates, in one place.')}</p></div><button data-close className="icon-button" aria-label={t('إغلاق الإشعارات', 'Close notifications')} onClick={() => setOpen(false)}><X size={20}/></button></header><div className="notification-tools"><button className="button button-quiet" disabled={busy || !unreadIds.length} onClick={() => void action('read', unreadIds)}><CheckCheck size={17}/>{t('قراءة الظاهر', 'Mark shown as read')}</button><button className="button button-quiet" disabled={busy || !selected.length} onClick={() => void action('dismiss', selected)}><Trash2 size={17}/>{t('إزالة المحدد', 'Remove selected')}{selected.length > 0 && <bdi> ({selected.length})</bdi>}</button><button className="button button-quiet" disabled={busy || !data.notifications.length} onClick={() => void action('dismiss', [], true)}>{t('إزالة الجميع', 'Remove all')}</button></div><div className="notification-scroll" aria-busy={busy || loading}>{error && <p role="alert">{error} <button onClick={() => void load(undefined, true)}>{t('إعادة المحاولة', 'Retry')}</button></p>}{!data.notifications.length && <p role="status">{loading ? t('نجهّز تحديثاتك…', 'Loading your updates…') : t('صندوقك هادئ. ستجد التحديثات الجديدة هنا.', 'All clear. New updates will appear here.')}</p>}{data.notifications.map(item => { const link = firstPartyLink(item.action_url); return <article key={item.id} className={!item.read_at ? 'is-unread' : ''}><label className="notification-select"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy} onChange={e => setSelected(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/><span className="sr-only">{t('تحديد', 'Select')} {item.title}</span></label><div><button className="notification-message" onClick={() => void action('read', [item.id])} disabled={busy}><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}<time dateTime={new Date(item.created_at * 1000).toISOString()}>{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at * 1000))}</time></button>{link && <a href={link} className="notification-open"><ExternalLink size={15}/>{t('فتح التحديث', 'Open update')}</a>}</div><button className="icon-button" disabled={busy} onClick={() => void action('dismiss', [item.id])} aria-label={t('إزالة إشعار: ', 'Remove notification: ') + item.title}><Trash2 size={18}/></button></article>; })}{data.next && <button className="button button-quiet" disabled={busy || loading} onClick={() => void load(data.next)}>{t('عرض المزيد', 'Show more')}</button>}</div></dialog>}</>;
}

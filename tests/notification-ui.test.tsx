// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import NotificationCenter from '../client/src/NotificationCenter';
import SessionReturn from '../client/src/SessionReturn';
import AuthPanel from '../client/src/AuthPanel';
import { api, AppContext, setCSRF } from '../client/src/lib';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
const user: any = { id: 2, email: 'member@unit.invalid', role: 'user', name: 'عضو', status: 'active' };
const refresh = vi.fn(async () => {}), notify = vi.fn(), authenticated = vi.fn();
const context = { user, lang: 'ar' as const, t: (ar: string) => ar, refresh, notify };
let rows: any[], calls: Array<{ url: string; body: any }>;
const answer = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function render(node: React.ReactNode) { await act(async () => root.render(<AppContext.Provider value={context}>{node}</AppContext.Provider>)); }
async function click(button: Element | null) { expect(button).not.toBeNull(); await act(async () => (button as HTMLButtonElement).click()); }
const button = (text: string) => [...element.querySelectorAll('button')].find(x => x.textContent?.includes(text)) || null;
async function fill(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
beforeEach(() => {
  vi.clearAllMocks(); rows = [{ id: 'notice-a', title: 'خبر أول', body: 'نص', created_at: 1700000000, read_at: null }, { id: 'notice-b', title: 'خبر ثان', created_at: 1700000001, read_at: null }]; calls = [];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } }); Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
  setCSRF('unit'); element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input), body = options?.body ? JSON.parse(String(options.body)) : null; calls.push({ url, body });
    if (url === '/api/notifications/dismiss') { rows = body.scope === 'all' ? [] : rows.filter(row => !body.ids.includes(row.id)); return answer({ count: 1 }); }
    if (url === '/api/notifications/read') { rows = rows.map(row => body.ids.includes(row.id) ? { ...row, read_at: 1 } : row); return answer({ ok: true }); }
    if (url.startsWith('/api/notifications')) return answer({ notifications: rows, unread: rows.filter(row => !row.read_at).length, next: null });
    if (url === '/api/auth/request') return answer({ challenge: body.backup ? 'backup-code' : 'first-code', message: 'رمزك في الطريق' });
    if (url === '/api/auth/quick' || url === '/api/auth/verify') return answer({ user, csrf: 'restored-csrf' });
    return answer({ error: 'سجّل الدخول أولاً' }, 401);
  });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });

describe('Accessible notification inbox and in-place return', () => {
  it('shows only the bell until opened, and removes selected messages without navigation', async () => {
    await render(<NotificationCenter/>); expect(element.querySelector('dialog')).toBeNull();
    await click(element.querySelector('.notification-bell')); expect(element.querySelector('dialog')?.open).toBe(true);
    expect(element.querySelectorAll('article')).toHaveLength(2);
    await click(element.querySelector('input[type=checkbox]')); await click(button('إزالة المحدد'));
    expect(calls.some(x => x.url === '/api/notifications/dismiss' && x.body.ids[0] === 'notice-a')).toBe(true); expect(element.querySelectorAll('article')).toHaveLength(1);
    await click(button('إزالة الجميع')); expect(element.querySelectorAll('article')).toHaveLength(0);
    await click(element.querySelector('[data-close]')); expect(element.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(element.querySelector('.notification-bell'));
    expect(calls.some(x => x.url === '/api/dashboard')).toBe(false);
  });
  it('marks messages read and restores focus after Escape', async () => {
    await render(<NotificationCenter/>); await click(element.querySelector('.notification-bell')); await click(button('قراءة الظاهر'));
    expect(calls.find(x => x.url === '/api/notifications/read')?.body.ids).toEqual(['notice-a', 'notice-b']);
    await act(async () => element.querySelector('dialog')!.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))); expect(element.querySelector('dialog')).toBeNull();
    expect(element.querySelector('.notification-bell')?.getAttribute('aria-label')).toContain('0 غير مقروء');
  });
  it('requests a single explicit backup and has no free repeated-resend button', async () => {
    await render(<AuthPanel onAuthenticated={authenticated}/>); await submit(element.querySelector('form')!); expect(calls.filter(x => x.url === '/api/auth/request')).toHaveLength(1);
    await click(button('اطلب رسالة احتياطية')); expect(calls.filter(x => x.url === '/api/auth/request')).toHaveLength(2);
    expect(calls.at(-1)!.body).toMatchObject({ backup: true, previousChallenge: 'first-code' });
    expect((button('تم طلب الرسالة الاحتياطية') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the same editor and written value mounted across an inline PIN return', async () => {
    await render(<><textarea aria-label="عملي" defaultValue="كتابة لم تُرسل"/><SessionReturn/></>);
    const editor = element.querySelector('textarea')!; editor.focus();
    await act(async () => window.dispatchEvent(new CustomEvent('ksa:session-required', { detail: { reason: 'login' } })));
    expect(element.querySelector('dialog')?.open).toBe(true); expect(element.querySelector('textarea')).toBe(editor);
    await fill(element.querySelector('input[name=pin]')!, '264913'); const restored = vi.fn(); window.addEventListener('ksa:session-restored', restored, { once: true });
    await submit(element.querySelector('form')!); expect(refresh).toHaveBeenCalledTimes(1); expect(restored).toHaveBeenCalledTimes(1);
    expect(element.querySelector('dialog')).toBeNull(); expect(element.querySelector('textarea')).toBe(editor); expect(editor.value).toBe('كتابة لم تُرسل');
    expect(calls.find(x => x.url === '/api/auth/quick')!.body).toMatchObject({ expectedUserId: 2, email: user.email });
    expect(calls.some(x => /submit|publish/.test(x.url))).toBe(false);
  });
  it('requires email proof for a sensitive return and never treats a permission rejection as a session expiry', async () => {
    await render(<SessionReturn/>);
    await act(async () => window.dispatchEvent(new CustomEvent('ksa:session-required', { detail: { reason: 'reauth' } })));
    expect(element.querySelector('input[name=pin]')).toBeNull(); await submit(element.querySelector('form')!); expect(calls.at(-1)!.body.purpose).toBe('reauth');
    await click(element.querySelector('.session-return > header button'));
    vi.mocked(fetch).mockResolvedValueOnce(answer({ error: 'ليست لديك صلاحية لهذا الإجراء' }, 403)); await act(async () => { await expect(api('/api/admin/forbidden')).rejects.toThrow(); });
    expect(element.querySelector('dialog')).toBeNull();
  });
  it('receives an expired session signal from private requests but does not reopen during failed login attempts', async () => {
    await render(<SessionReturn/>); await act(async () => { await expect(api('/api/draft-probe')).rejects.toThrow(); }); expect(element.querySelector('dialog')?.open).toBe(true);
    await click(element.querySelector('.session-return > header button')); vi.mocked(fetch).mockResolvedValueOnce(answer({ error: 'PIN غير صحيح' }, 401));
    await act(async () => { await expect(api('/api/auth/quick', { method: 'POST', body: '{}' })).rejects.toThrow(); }); expect(element.querySelector('dialog')).toBeNull();
  });
  it('marks every loaded row read and removes any selection through bounded internal batches',async()=>{
    rows=Array.from({length:101},(_,index)=>({id:'batch-'+index,title:'تحديث '+index,created_at:1700000000+index,read_at:null}));
    await render(<NotificationCenter/>);await click(element.querySelector('.notification-bell'));await click(button('قراءة الظاهر'));
    expect(calls.filter(x=>x.url==='/api/notifications/read').map(x=>x.body.ids.length)).toEqual([80,21]);
    await act(async()=>{for(const input of element.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))input.click();});await click(button('إزالة المحدد'));
    expect(calls.filter(x=>x.url==='/api/notifications/dismiss').map(x=>x.body.ids.length)).toEqual([80,21]);expect(rows).toHaveLength(0);
  });

});

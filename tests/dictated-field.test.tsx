// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DictatedInput } from '../client/src/DictatedField';
import type { SpeechResultEvent } from '../client/src/dictation-session';
class Recognition {
  static instances: Recognition[] = [];
  lang = ''; continuous = false; interimResults = false; start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  onstart: (() => void) | null = null; onaudiostart: (() => void) | null = null; onspeechstart: (() => void) | null = null; onspeechend: (() => void) | null = null;
  onresult: ((event: SpeechResultEvent) => void) | null = null; onerror: ((event: { error?: string }) => void) | null = null; onend: (() => void) | null = null;
  constructor() { Recognition.instances.push(this); }
}
const tr = (ar: string, en: string) => ar;
const utterance = (text: string) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
function Harness() { const [value, setValue] = useState(''); return <><DictatedInput label="المهارة" value={value} onChange={setValue} lang="ar" tr={tr} maxLength={100}/><input aria-label="حقل آخر"/></>; }
let root: Root, host: HTMLDivElement;
const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLElement).click()); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; (window as any).SpeechRecognition = Recognition; Recognition.instances = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Harness/>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (window as any).SpeechRecognition; vi.useRealTimers(); });
describe('shared mobile dictated fields — local DOM only', () => {
  it('keeps the labelled input and focus stable through every character and voice corrections', async () => {
    const input = host.querySelector('input')!; input.focus(); const id = input.id;
    expect(host.querySelector(`label[for="${id}"]`)?.textContent).toBe('المهارة');
    for (const value of ['م', 'مه', 'مهار', 'مهارة']) { await type(input, value); expect(host.querySelector('input')).toBe(input); expect(document.activeElement).toBe(input); }
    await click('.dictation-button'); const recognition = Recognition.instances[0];
    await type(input, 'تصحيح يدوي');
    await act(async () => recognition.onresult?.(utterance('خبره')));
    expect(input.value).toBe('تصحيح يدوي خبره'); expect(document.activeElement).toBe(input);
    await click('.dictation-corrections button'); expect(input.value).toBe('تصحيح يدوي خبرة'); expect(host.querySelector('input')).toBe(input);
  });
  it('offers explicit language/manual timing, stops when requested, and never submits its surrounding form', async () => {
    const selects = host.querySelectorAll('select');
    await act(async () => { selects[0].value = 'en'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); selects[1].value = 'manual'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
    await click('.dictation-button'); const recognition = Recognition.instances[0]; expect(recognition.lang).toBe('en-US');
    expect(host.querySelector('.dictation-button')?.getAttribute('type')).toBe('button');
    expect(host.querySelector('.dictation-button')?.getAttribute('aria-pressed')).toBe('true');
    await click('.dictation-button'); expect(recognition.stop).toHaveBeenCalledOnce(); expect(host.querySelector('.dictation-button')?.getAttribute('aria-pressed')).toBe('false');
  });
  it('ignores late results after another field receives focus or the component is removed', async () => {
    await click('.dictation-button'); const recognition = Recognition.instances[0];
    await act(async () => (host.querySelector('input[aria-label="حقل آخر"]') as HTMLInputElement).focus());
    await act(async () => recognition.onresult?.(utterance('لا يكتب'))); expect(host.querySelector('input')!.value).toBe(''); expect(recognition.abort).toHaveBeenCalledOnce();
    await click('.dictation-button'); const second = Recognition.instances[1]; await act(async () => root.render(<p>انتقل المستخدم</p>));
    await act(async () => second.onresult?.(utterance('متأخر'))); expect(host.textContent).toBe('انتقل المستخدم'); expect(second.abort).toHaveBeenCalledOnce();
  });
  it('cancels on page departure or IME composition instead of overwriting unfinished keyboard input', async () => {
    const input = host.querySelector('input')!;
    await type(input,'نص يدوي');await click('.dictation-button');const first=Recognition.instances[0];
    await act(async()=>window.dispatchEvent(new Event('pagehide')));
    await act(async()=>first.onresult?.(utterance('متأخر')));expect(input.value).toBe('نص يدوي');
    await click('.dictation-button');const second=Recognition.instances[1];
    await act(async()=>input.dispatchEvent(new Event('compositionstart',{bubbles:true})));
    await act(async()=>second.onresult?.(utterance('متأخر')));expect(input.value).toBe('نص يدوي');expect(second.abort).toHaveBeenCalledOnce();
  });
  it('cancels when a preview action outside the speech controls is clicked', async () => {
    const action = document.createElement('button');action.textContent='معاينة';host.append(action);
    const input=host.querySelector('input')!;await type(input,'النص المحفوظ');await click('.dictation-button');const recognition=Recognition.instances[0];
    await act(async()=>action.click());expect(recognition.abort).toHaveBeenCalledOnce();
    await act(async()=>recognition.onresult?.(utterance('صوت خلف المعاينة')));expect(input.value).toBe('النص المحفوظ');action.remove();
  });
  it('keeps typing available when recognition is unsupported or permission is denied', async () => {
    delete (window as any).SpeechRecognition; await click('.dictation-button');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('الإملاء غير متاح');
    const input = host.querySelector('input')!; await type(input, 'كتابة سليمة'); expect(input.value).toBe('كتابة سليمة');
    (window as any).SpeechRecognition = Recognition; await click('.dictation-button');
    await act(async () => Recognition.instances[0].onerror?.({ error: 'not-allowed' }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('اسمح باستخدام الميكروفون'); expect(input.disabled).toBe(false);
  });
});

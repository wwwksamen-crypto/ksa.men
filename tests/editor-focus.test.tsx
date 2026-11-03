// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StringList, StructuredList, LinkList, VoiceButton } from '../client/src/Dashboard';
import { EditorRowKeys, appendImage } from '../client/src/editor-state';

const tr = (ar: string, _en: string) => ar;
let container: HTMLDivElement, root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('stable local editor identities — no browser', () => {
  it('retains the same focused input for Arabic/English text, re-render, and saving metadata', async () => {
    let setItems!: React.Dispatch<React.SetStateAction<string[]>>;
    function Harness() { const [items, set] = useState(['قيادة', 'تحليل']); setItems = set; return <StringList title="مهارات" value={items} onChange={set} tr={tr} lang="ar"/>; }
    await act(async () => root.render(<Harness/>));
    const input = container.querySelector('input')!; input.focus();
    for (const text of ['قيادة أ', 'قيادة أنظمة', 'Leadership', 'Leadership advanced']) {
      await act(async () => setItems((current) => [text, current[1]]));
      expect(container.querySelector('input')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe(text);
    }
    await act(async () => root.render(<Harness/>));
    expect(document.activeElement).toBe(input);
  });
  it('keeps the surviving row identity when a preceding row is removed', async () => {
    function Harness() { const [items, set] = useState(['الأول', 'الثاني']); return <StringList title="عضويات" value={items} onChange={set} tr={tr} lang="ar"/>; }
    await act(async () => root.render(<Harness/>));
    const second = container.querySelectorAll('input')[1]; second.focus();
    await act(async () => (container.querySelectorAll('button[aria-label="حذف"]')[0] as HTMLButtonElement).click());
    expect(container.querySelector('input')).toBe(second);
    expect(document.activeElement).toBe(second);
  });
  it('does not recreate a structured title or URL input when its value changes', async () => {
    let changeTitle!: (value: string) => void, changeURL!: (value: string) => void;
    function Harness() {
      const [items, setItems] = useState([{ title: '', organization: '', start: '', end: '', description: '' }]);
      const [links, setLinks] = useState([{ label: '', url: '' }]);
      changeTitle = (title) => setItems((rows) => [{ ...rows[0], title }]);
      changeURL = (url) => setLinks((rows) => [{ ...rows[0], url }]);
      return <><StructuredList title="خبرات" value={items} onChange={setItems} tr={tr} lang="ar"/><LinkList title="روابط" hint="" value={links} onChange={setLinks} max={12} tr={tr}/></>;
    }
    await act(async () => root.render(<Harness/>));
    const title = container.querySelector('input')!;
    title.focus(); await act(async () => changeTitle('مدير')); expect(document.activeElement).toBe(title);
    const url = container.querySelector('input[type="url"]')!;
    (url as HTMLInputElement).focus();
    await act(async () => changeURL('https://x.com/unit'));
    expect(container.querySelector('input[type="url"]')).toBe(url); expect(document.activeElement).toBe(url);
  });
  it('appends a delayed voice result to the latest manual correction exactly once', async () => {
    let recognition: any;
    class Recognition { onresult: any; onend: any; onerror: any; start() { recognition = this; } stop() { this.onend?.(); } }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    let correct!: (text: string) => void;
    function Harness() { const [value, set] = useState('نص'); correct = set; return <><input value={value} readOnly/><VoiceButton value={value} onAppend={set} lang="ar" tr={tr}/></>; }
    await act(async () => root.render(<Harness/>));
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
    await act(async () => correct('كتابة مصححة'));
    const result: any = [{ transcript: 'إضافة صوتية' }]; result.isFinal = true;
    await act(async () => { recognition.onresult({ resultIndex: 0, results: [result] }); recognition.onresult({ resultIndex: 0, results: [result] }); });
    expect(container.querySelector('input')?.value).toBe('كتابة مصححة إضافة صوتية');
    delete (window as any).SpeechRecognition;
  });
  it('retains row IDs on moves and appends images without replacing concurrent additions', () => {
    const keys = new EditorRowKeys(); const initial = keys.resize(3);
    expect(keys.resize(3)).toEqual(initial); keys.move(2, 0);
    expect(keys.resize(3)).toEqual([initial[2], initial[0], initial[1]]);
    keys.remove(1); expect(keys.resize(2)).toEqual([initial[2], initial[1]]);
    expect(appendImage(appendImage([], 'first', 3), 'second', 3)).toEqual(['first', 'second']);
    expect(appendImage(['first'], 'first', 3)).toEqual(['first']);
    expect(() => appendImage(['a','b','c'], 'd', 3)).toThrow('IMAGE_LIST_FULL');
  });
});

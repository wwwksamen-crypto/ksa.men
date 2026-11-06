// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state=vi.hoisted(()=>({lang:'ar' as 'ar'|'en'}));
vi.mock('../client/src/lib',()=>({useApp:()=>({lang:state.lang})}));
import BusinessApproach from '../client/src/BusinessApproach';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;state.lang='ar';host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe('Business approach documents — same-origin accessible download controls',()=>{
 it.each(['ar','en'] as const)('uses the %s copy without a certification claim or mixed interface labels',async lang=>{
  state.lang=lang;await act(async()=>root.render(<BusinessApproach/>));
  expect(host.querySelector('h2')?.textContent).toBe(lang==='ar'?'نهج أعمالنا':'Our business approach');
  const links=Array.from(host.querySelectorAll('a[download]'));expect(links).toHaveLength(2);
  expect(links[0].textContent).toBe(lang==='ar'?'تنزيل النسخة العربية':'Download Arabic version');
  expect(links[1].textContent).toBe(lang==='ar'?'تنزيل النسخة الإنجليزية':'Download English version');
  expect(links.every(a=>a.getAttribute('href')?.startsWith('/assets/documents/'))).toBe(true);
  expect(host.textContent).toContain(lang==='ar'?'ليس شهادة اعتماد':'not a certification');
  expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe(host.querySelector('h2')?.textContent);
 });
});

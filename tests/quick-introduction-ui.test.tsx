// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppContext } from '../client/src/lib';
import QuickIntroduction from '../client/src/QuickIntroduction';
import { quickPhone, safeQuickSite } from '../shared/quick-link';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';document.head.innerHTML='';});
async function mount(response?:unknown,failed=false,lang:'ar'|'en'='ar') {
 const fetch=vi.fn(async()=>failed?new Response('{}',{status:404}):new Response(JSON.stringify(response),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el);const context:any={lang,t:(a:string,b:string)=>lang==='ar'?a:b,user:null,refresh:vi.fn(),notify:vi.fn()};
 await act(async()=>{root.render(<AppContext.Provider value={context}><QuickIntroduction/></AppContext.Provider>);await new Promise(r=>setTimeout(r,10));});return {el,root,fetch};
}
describe('Limited introduction — local DOM only',()=>{
 it('shows the selected identity, correctly normalises Saudi WhatsApp and keeps expiry visible',async()=>{
  const r=await mount({profile:{name:'اسم اختبار',title:'تخصص اختبار',phone:'0555123456',whatsapp:'0555123456',email:'selected@unit.invalid',url:'https://member.ksa.men/'},mode:'business',expiresAt:Math.floor(Date.now()/1000)+86400});
  expect(r.el.querySelector('h1')?.textContent).toBe('اسم اختبار');expect(r.el.querySelector('a[href="https://wa.me/966555123456"]')).not.toBeNull();expect(r.el.querySelector('a[href="tel:+966555123456"]')).not.toBeNull();expect(r.el.querySelector('time')).not.toBeNull();
  for(const link of r.el.querySelectorAll('a'))expect(link.getAttribute('rel')).toContain('noreferrer');
  expect(document.head.innerHTML).not.toContain('selected@unit.invalid');expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('share-logo');
  await act(async()=>r.root.unmount());
 });
 it('does not invent missing fields and hides all payload immediately if the saved lifetime ended',async()=>{
  const r=await mount({profile:{email:'expired@unit.invalid',name:'Do not display'},mode:'professional',expiresAt:Math.floor(Date.now()/1000)-1});expect(r.el.textContent).not.toContain('Do not display');expect(r.el.textContent).not.toContain('expired@unit.invalid');expect(r.el.textContent).toContain('رابط التعارف غير متاح');expect(document.querySelector('link[rel="canonical"]')).toBeNull();await act(async()=>r.root.unmount());
 });
 it('uses a clear unavailable message instead of echoing a failed request or token',async()=>{
  const r=await mount(undefined,true,'en');expect(r.el.textContent).toContain('This introduction link is unavailable');expect(r.el.querySelector('a[href^="mailto:"]')).toBeNull();await act(async()=>r.root.unmount());
 });
 it('rejects hostile/non-platform site destinations and normalises Arabic phone digits',()=>{
  expect(quickPhone('٠٥٥٥١٢٣٤٥٦')).toBe('966555123456');expect(safeQuickSite('javascript:alert(1)')).toBe('');expect(safeQuickSite('https://member.ksa.men.evil.invalid')).toBe('');expect(safeQuickSite('https://user:pass@ksa.men')).toBe('');expect(safeQuickSite('https://member.ksa.men/')).toBe('https://member.ksa.men/');
 });
});

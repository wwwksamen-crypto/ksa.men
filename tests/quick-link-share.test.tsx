// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppContext } from '../client/src/lib';
import QuickLinkShare from '../client/src/QuickLinkShare';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
it('copies and shares only the short URL without personal data and exposes lifetime',async()=>{
 const copy=vi.fn(async()=>{}),share=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText:copy},share});const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el);const ctx:any={lang:'ar',t:(a:string)=>a,notify:vi.fn()};const url='https://ksa.men/q/abcdefghijklmnop';
 await act(async()=>{root.render(<AppContext.Provider value={ctx}><QuickLinkShare url={url} expiresAt={Math.floor(Date.now()/1000)+86400}/></AppContext.Provider>);});
 const buttons=el.querySelectorAll('button');await act(async()=>buttons[0].click());expect(copy).toHaveBeenCalledWith(url);await act(async()=>buttons[1].click());expect(share).toHaveBeenCalledWith({title:'بطاقة تعارف — KSA.MEN',url});expect(el.querySelector('time')).not.toBeNull();await act(async()=>root.unmount());
});
it('disables expired links without attempting copy or share',async()=>{
 const copy=vi.fn(),share=vi.fn();vi.stubGlobal('navigator',{clipboard:{writeText:copy},share});const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el);const ctx:any={lang:'en',t:(_:string,b:string)=>b,notify:vi.fn()};await act(async()=>root.render(<AppContext.Provider value={ctx}><QuickLinkShare url="https://ksa.men/q/abcdefghijklmnop" expiresAt={1}/></AppContext.Provider>));expect(el.textContent).toContain('This link has expired');expect([...el.querySelectorAll('button')].every(b=>b.disabled)).toBe(true);expect(copy).not.toHaveBeenCalled();expect(share).not.toHaveBeenCalled();await act(async()=>root.unmount());
});

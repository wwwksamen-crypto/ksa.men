// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { api, AppContext } from '../client/src/lib';
import SessionReturn from '../client/src/SessionReturn';
import OwnerErasurePanel from '../client/src/OwnerErasurePanel';
vi.mock('../client/src/AuthPanel', () => ({default:(props:any)=><button onClick={props.onAuthenticated}>تحقق محلي مصطنع</button>}));
let box:HTMLDivElement, root:Root;
const flush=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  document.documentElement.lang='ar';localStorage.clear();
  box=document.createElement('div');document.body.append(box);root=createRoot(box);
  Object.defineProperties(HTMLDialogElement.prototype,{
    showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},
    close:{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}},
  });
});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function click(text:string){const button=[...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);expect(button).toBeDefined();await act(async()=>button!.click());await flush();}
describe('Selective step-up — local DOM, no browser or live email',()=>{
  it('keeps reason and scope through the existing modal, and requires a new explicit deletion click after verification',async()=>{
    const impact={impactToken:'local',siteCount:1,mediaCount:0,holdKinds:[],alreadyErased:false,versions:[{id:'local-site',draft:1,published:0}]};
    let verified=false,posts=0;
    vi.stubGlobal('fetch',vi.fn(async(_path:any,init:any)=>{
      if(init?.method==='POST'){posts++;return new Response(JSON.stringify(verified?{erased:true,requestId:'synthetic-proof'}:{error:'أعد التحقق من البريد لإتمام الإجراء الحساس',code:'REAUTH_REQUIRED'}),{status:verified?200:403});}
      return new Response(JSON.stringify(impact));
    }));
    await act(async()=>root.render(<AppContext.Provider value={{user:{id:1,email:'synthetic@unit.invalid',role:'owner'} as any,lang:'ar',t:ar=>ar,refresh:async()=>{},notify:()=>{}}}>
      <OwnerErasurePanel accountId="88" siteId="local-site" onErase={(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)})}/><SessionReturn/>
    </AppContext.Provider>));
    await click('حذف موقع أو حساب');
    const reason=box.querySelector('textarea')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(reason,'سبب محفوظ محلياً');reason.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('حذف نهائي وتسجيل السبب');expect(posts).toBe(1);expect(box.querySelector('dialog[open]')).not.toBeNull();
    expect(reason.value).toBe('سبب محفوظ محلياً');expect((box.querySelector('select') as HTMLSelectElement).value).toBe('site');
    verified=true;await click('تحقق محلي مصطنع');expect(posts).toBe(1);expect(box.querySelector('dialog')).toBeNull();expect(reason.value).toBe('سبب محفوظ محلياً');
    await click('حذف نهائي وتسجيل السبب');expect(posts).toBe(2);expect(box.textContent).toContain('synthetic-proof');
  });
  it('recognizes the stable error code without relying on the Arabic copy and never retries the rejected operation',async()=>{
    const events=vi.fn();window.addEventListener('ksa:session-required',events);
    const request=vi.fn(async()=>new Response(JSON.stringify({message:'Changed wording',code:'REAUTH_REQUIRED'}),{status:403}));vi.stubGlobal('fetch',request);
    try{await expect(api('/api/admin/audit/export')).rejects.toMatchObject({code:'REAUTH_REQUIRED',message:'أعد التحقق من البريد لإتمام الإجراء الحساس.'});expect(events).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();expect(events.mock.calls[0][0].detail.reason).toBe('reauth');}finally{window.removeEventListener('ksa:session-required',events);}
  });
  it('renders the same step-up as clear English in English mode',async()=>{
    document.documentElement.lang='en';vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'أعد التحقق من البريد لإتمام الإجراء الحساس',code:'REAUTH_REQUIRED'}),{status:403})));
    await expect(api('/api/admin/audit/export')).rejects.toMatchObject({message:'Verify your email again to complete this sensitive action.'});
  });
});
